import type { HistoryEvent } from "@/types/history";
import type { ThermalPart, ThermalStatus } from "@/types/modem-status";
import {
  parseRebootMessage,
  parseThermalParts,
  type StorageArea,
  type SystemBucket,
  type SystemHistory,
  type SystemIncident,
  type SystemMetric,
} from "@/types/system-history";

// =============================================================================
// System Health: pure derivations
// =============================================================================
// Everything the page computes from the two reads (the bucketed series and the
// raw event rows) lives here, so the lanes, the markers, the tiles and the event
// list all agree on one set of incidents, and none of it needs a render to test.
// =============================================================================

/** Live values from the status poll that the tiles and charts fold in. */
export interface LiveStatus {
  /** Seconds since the device booted, or null before the first poll. */
  uptimeSec: number | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
  thermal: ThermalStatus | null;
}

function windowOf(buckets: SystemBucket[]): { start: number; end: number } | null {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (!first || !last) return null;
  return { start: first.t, end: last.t + last.len };
}

/** Highest `temp_c` reading over the buckets touching [start, end]. */
function peakTemp(buckets: SystemBucket[], start: number, end: number): number | null {
  let peak: number | null = null;
  for (const b of buckets) {
    if (b.t + b.len < start || b.t > end) continue;
    const max = b.m.temp_c?.max;
    if (max !== undefined && (peak === null || max > peak)) peak = max;
  }
  return peak;
}

/**
 * A crash row with no paired recovery is only still going if nothing happened
 * after it. A device restart that begins at or after the crash ended it (the
 * modem went down with the device), and an older unpaired crash is superseded
 * by the next crash. Only the newest crash with no later restart stays ongoing.
 */
function closeStaleCrashes(incidents: SystemIncident[]): void {
  const reboots = incidents.flatMap((i) => (i.kind === "reboot" ? [i.start] : []));
  const crashes = incidents.flatMap((i) => (i.kind === "modem" ? [i] : []));
  for (const c of crashes) {
    if (c.end !== null) continue;
    const restart = reboots.filter((r) => r >= c.start).sort((a, b) => a - b)[0];
    if (restart !== undefined) {
      c.end = restart;
      continue;
    }
    const next = crashes
      .filter((o) => o !== c && o.start > c.start)
      .sort((a, b) => a.start - b.start)[0];
    if (next) c.end = next.start;
  }
}

/**
 * Pair the raw event rows into incidents, newest first.
 *
 * - `device_reboot` carries the moment the device was back up; it was offline
 *   for `off` seconds before that (unknown off: a zero-length span at `t`).
 * - `modem_crash` and `thermal_throttled` are onsets; `end` is the paired
 *   recovery (null = still going). Their recovery rows are dropped.
 * - An incident that began before the window but reaches into it is kept
 *   (its recovery or reboot row is what the endpoint returned); one that ended
 *   before the window is not.
 */
export function deriveIncidents(
  events: HistoryEvent[],
  buckets: SystemBucket[],
): SystemIncident[] {
  const win = windowOf(buckets);
  const out: SystemIncident[] = [];

  for (const e of events) {
    if (e.type === "device_reboot") {
      const { cause, offSec } = parseRebootMessage(e.message);
      out.push({
        kind: "reboot",
        start: offSec === null ? e.timestamp : e.timestamp - offSec,
        end: e.timestamp,
        cause,
        offSec,
      });
    } else if (e.type === "modem_crash") {
      out.push({ kind: "modem", start: e.timestamp, end: e.end ?? null });
    } else if (e.type === "thermal_throttled") {
      const end = e.end ?? null;
      out.push({
        kind: "heat",
        start: e.timestamp,
        end,
        parts: parseThermalParts(e.message),
        peakC: win ? peakTemp(buckets, e.timestamp, end ?? win.end) : null,
      });
    }
  }

  closeStaleCrashes(out);

  const overlaps = (i: SystemIncident) =>
    win === null || ((i.end ?? Infinity) >= win.start && i.start <= win.end);
  return out.filter(overlaps).sort((a, b) => b.start - a.start);
}

// --- Summary ----------------------------------------------------------------

export interface LaneCounts {
  reboots: number;
  unexpectedReboots: number;
  modem: number;
  heat: number;
  modemOngoing: boolean;
  heatOngoing: boolean;
}

export function laneCounts(incidents: SystemIncident[]): LaneCounts {
  const c: LaneCounts = {
    reboots: 0,
    unexpectedReboots: 0,
    modem: 0,
    heat: 0,
    modemOngoing: false,
    heatOngoing: false,
  };
  for (const i of incidents) {
    if (i.kind === "reboot") {
      c.reboots += 1;
      if (i.cause === "unexpected") c.unexpectedReboots += 1;
    } else if (i.kind === "modem") {
      c.modem += 1;
      if (i.end === null) c.modemOngoing = true;
    } else {
      c.heat += 1;
      if (i.end === null) c.heatOngoing = true;
    }
  }
  return c;
}

export interface CpuSummary {
  /** Mean over every reading in the range, whole percent. */
  avg: number;
  /** Highest bucket maximum, with the start of the bucket that held it. */
  peak: number;
  peakAt: number;
}

export function cpuSummary(buckets: SystemBucket[]): CpuSummary | null {
  let sum = 0;
  let n = 0;
  let peak = -Infinity;
  let peakAt = 0;
  for (const b of buckets) {
    const s = b.m.cpu;
    if (!s || s.n <= 0) continue;
    sum += s.avg * s.n;
    n += s.n;
    if (s.max > peak) {
      peak = s.max;
      peakAt = b.t;
    }
  }
  return n === 0 ? null : { avg: sum / n, peak, peakAt };
}

/** The newest `avg` of a metric, or null when no bucket has a reading. */
export function latestMetric(buckets: SystemBucket[], metric: SystemMetric): number | null {
  for (let i = buckets.length - 1; i >= 0; i--) {
    const s = buckets[i].m[metric];
    if (s && s.n > 0) return s.avg;
  }
  return null;
}

/** The hottest reading in the newest bucket that has one (whole °C). */
export function latestTempC(buckets: SystemBucket[]): number | null {
  for (let i = buckets.length - 1; i >= 0; i--) {
    const s = buckets[i].m.temp_c;
    if (s && s.n > 0) return s.max;
  }
  return null;
}

// --- Storage ------------------------------------------------------------------

export interface StorageReading {
  area: StorageArea;
  usedKiB: number;
  sizeKiB: number;
  /** Used KiB at the first reading in the range; null when that is the newest one. */
  startKiB: number | null;
}

const STORAGE_METRICS: Record<StorageArea, { used: SystemMetric; size: SystemMetric }> = {
  sys: { used: "st_sys_used", size: "st_sys_size" },
  app: { used: "st_app_used", size: "st_app_size" },
  tmp: { used: "st_tmp_used", size: "st_tmp_size" },
};

/**
 * Storage is sampled hourly, so most buckets carry no reading: "now" is the
 * newest bucket that has one, "range start" the oldest. Areas without any
 * reading are left out.
 */
export function storageReadings(buckets: SystemBucket[]): StorageReading[] {
  const out: StorageReading[] = [];
  for (const area of ["sys", "app", "tmp"] as const) {
    const { used, size } = STORAGE_METRICS[area];
    let first: number | null = null;
    let last: { used: number; size: number } | null = null;
    let readings = 0;
    for (const b of buckets) {
      const u = b.m[used];
      const s = b.m[size];
      if (!u || !s || u.n <= 0 || s.n <= 0 || s.avg <= 0) continue;
      if (first === null) first = u.avg;
      last = { used: u.avg, size: s.avg };
      readings += 1;
    }
    if (last === null) continue;
    out.push({
      area,
      usedKiB: last.used,
      sizeKiB: last.size,
      startKiB: readings === 1 ? null : first,
    });
  }
  return out;
}

// --- Page-level -------------------------------------------------------------

/** "Collecting": the clock is not trusted yet, or nothing has been stored. */
export function isCollecting(history: SystemHistory): boolean {
  return !history.clock_trusted || history.since === null;
}

/** The stored data reaches back to the start of the range. */
export function coversRange(history: SystemHistory): boolean {
  const first = history.buckets[0];
  if (history.since === null || !first) return false;
  return history.since <= first.t + history.bucket_sec;
}

/** Parts the poller reports as currently slowed down; null when not throttling. */
export function throttleParts(status: LiveStatus | null): ThermalPart[] | null {
  const th = status?.thermal;
  return th?.throttling ? th.parts : null;
}
