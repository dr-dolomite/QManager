// =============================================================================
// System Health history: the "system" series (history_series_system.sh)
// =============================================================================
// Narrows the generic history contract (types/history.ts) for
// /history/system-health. See docs/features/history.md (System Health).
// =============================================================================

import type {
  HistoryBucket,
  HistoryEvent,
  HistorySeriesResponse,
} from "@/types/history";
import type { NetworkEventType, ThermalPart } from "@/types/modem-status";

/** `throttled` while any heat-driven cooling device is engaged. */
export type SystemState = "normal" | "throttled";

/**
 * cpu: % busy. mem_pct: % in use, mem_mb: MiB in use. temp_c: hottest valid
 * modem sensor, whole °C. st_*: storage in KiB (System = rootfs, App data =
 * /usrdata, Temporary files = /tmp), sampled once an hour, so most buckets
 * carry no storage reading.
 */
export type SystemMetric =
  | "cpu"
  | "mem_pct"
  | "mem_mb"
  | "temp_c"
  | "st_sys_used"
  | "st_sys_size"
  | "st_app_used"
  | "st_app_size"
  | "st_tmp_used"
  | "st_tmp_size";

export type SystemHistory = HistorySeriesResponse<SystemState, SystemMetric>;
export type SystemBucket = HistoryBucket<SystemState, SystemMetric>;

/** Event types recorded by the series. */
export const SYSTEM_EVENT_TYPES = [
  "device_reboot",
  "modem_crash",
  "modem_recovered",
  "thermal_throttled",
  "thermal_recovered",
] as const satisfies readonly NetworkEventType[];

export type SystemEventType = (typeof SYSTEM_EVENT_TYPES)[number];

/** Why the device restarted (from the `cause=` field of device_reboot). */
export type RebootCause =
  | "unexpected"
  | "update"
  | "scheduled"
  | "user"
  | "watchdog";

export const STORAGE_AREAS = ["sys", "app", "tmp"] as const;
export type StorageArea = (typeof STORAGE_AREAS)[number];

/**
 * Raw event row formats (HistoryEvent from history/events.sh, newest first):
 * - device_reboot: t = when the device was back up; message
 *   "cause=<RebootCause> off=<seconds>" (off is "-" when unknown).
 *   The offline span is [t - off, t].
 * - modem_crash: onset; `end` = t of the next modem_recovered (null = ongoing).
 * - modem_recovered: the paired recovery (not listed on its own in the UI).
 * - thermal_throttled: onset; `end` = t of the next thermal_recovered (null =
 *   ongoing); message "Thermal throttling started (LTE, 5G)", the parenthesis
 *   naming the parts (LTE, 5G, mmWave, modem, CPU, Ethernet), may be absent.
 * - thermal_recovered: the paired recovery.
 */
export type SystemRawEvent = HistoryEvent;

/** One normalised incident the page draws (lanes, markers, events list). */
export type SystemIncident =
  | {
      kind: "reboot";
      /** Offline start (epoch s); equals `end` when the offline time is unknown. */
      start: number;
      /** Back online (epoch s). */
      end: number;
      cause: RebootCause;
      /** Offline seconds, null when unknown. */
      offSec: number | null;
    }
  | {
      kind: "modem";
      start: number;
      /** null while the modem is still restarting. */
      end: number | null;
    }
  | {
      kind: "heat";
      start: number;
      /** null while still throttling. */
      end: number | null;
      parts: ThermalPart[];
      /** Peak temp_c over the span (bucket max), null when no reading. */
      peakC: number | null;
    };

const PART_BY_NAME: Record<string, ThermalPart> = {
  lte: "lte",
  "5g": "nr",
  mmwave: "mmwave",
  modem: "modem",
  cpu: "cpu",
  ethernet: "ethernet",
};

/** "Thermal throttling started (LTE, 5G)" -> ["lte", "nr"]. */
export function parseThermalParts(message: string): ThermalPart[] {
  const open = message.lastIndexOf("(");
  const close = message.lastIndexOf(")");
  if (open < 0 || close <= open) return [];
  const out: ThermalPart[] = [];
  for (const raw of message.slice(open + 1, close).split(",")) {
    const part = PART_BY_NAME[raw.trim().toLowerCase()];
    if (part && !out.includes(part)) out.push(part);
  }
  return out;
}

const CAUSES: readonly RebootCause[] = [
  "unexpected",
  "update",
  "scheduled",
  "user",
  "watchdog",
];

/** "cause=update off=95" -> { cause: "update", offSec: 95 }. */
export function parseRebootMessage(message: string): {
  cause: RebootCause;
  offSec: number | null;
} {
  let cause: RebootCause = "unexpected";
  let offSec: number | null = null;
  for (const field of message.trim().split(/\s+/)) {
    const [key, value] = field.split("=");
    if (key === "cause" && (CAUSES as readonly string[]).includes(value)) {
      cause = value as RebootCause;
    } else if (key === "off" && /^\d+$/.test(value ?? "")) {
      offSec = Number(value);
    }
  }
  return { cause, offSec };
}
