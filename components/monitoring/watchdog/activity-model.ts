import {
  ArrowRightLeftIcon,
  ChevronsUpIcon,
  CircleCheckIcon,
  CircleOffIcon,
  CirclePowerIcon,
  CircleXIcon,
  ClockAlertIcon,
  HourglassIcon,
  InfoIcon,
  MoonIcon,
  PlaneIcon,
  PlayIcon,
  RadioIcon,
  RefreshCcwDotIcon,
  RefreshCwIcon,
  RepeatIcon,
  RotateCwIcon,
  TriangleAlertIcon,
  Undo2Icon,
  CardSimIcon,
  type LucideIcon,
} from "lucide-react";

import type { EventSeverity, NetworkEvent } from "@/types/modem-status";

import { CLOCK_PLAUSIBLE_AFTER, isTier, type TFn } from "./derive";
import { LOG_LIMIT, type ActivityTone } from "./shapes";

// The recovery activity model: one place that turns the event ring's rows into
// what the card draws. A row is told apart by its machine `code` (contract 6);
// a row from before the upgrade has none, so its English text is matched to the
// same codes. Each code owns one tone and one glyph.

type EventCode =
  | "wd_tier_start"
  | "wd_succeeded"
  | "wd_escalate"
  | "wd_holdoff"
  | "wd_ssr_hold"
  | "wd_radio_paused"
  | "wd_budget_spent"
  | "wd_ping_stale"
  | "wd_tier4_reboot"
  | "sim_swap"
  | "sim_revert"
  | "sim_failback"
  | "sim_failback_giveup";

const KNOWN_CODES: ReadonlySet<string> = new Set<EventCode>([
  "wd_tier_start",
  "wd_succeeded",
  "wd_escalate",
  "wd_holdoff",
  "wd_ssr_hold",
  "wd_radio_paused",
  "wd_budget_spent",
  "wd_ping_stale",
  "wd_tier4_reboot",
  "sim_swap",
  "sim_revert",
  "sim_failback",
  "sim_failback_giveup",
]);

/** The two types the watchdog writes. Everything else belongs to another page. */
const WATCHDOG_TYPES: ReadonlySet<string> = new Set([
  "watchcat_recovery",
  "sim_failover",
]);

/** Pre-upgrade rows carry no code, so the English text stands in for it. */
function inferCode(event: NetworkEvent): EventCode | null {
  const m = event.message;
  if (event.type === "watchcat_recovery") {
    if (/rebooting system \(Tier 4\)/i.test(m)) return "wd_tier4_reboot";
    if (/recovery succeeded/i.test(m)) return "wd_succeeded";
    if (/escalating to Tier/i.test(m)) return "wd_escalate";
    if (/all recovery steps tried/i.test(m)) return "wd_holdoff";
    if (/baseband restart/i.test(m)) return "wd_ssr_hold";
    if (/radio is off/i.test(m)) return "wd_radio_paused";
    if (/reboot limit|reboots paused/i.test(m)) return "wd_budget_spent";
    if (/probe not reporting/i.test(m)) return "wd_ping_stale";
    if (
      /starting recovery|re-registering|toggling radio|connection quality degraded/i.test(m)
    ) {
      return "wd_tier_start";
    }
    return null;
  }
  if (event.type === "sim_failover") {
    if (/rechecks stopped/i.test(m)) return "sim_failback_giveup";
    if (/revert/i.test(m)) return "sim_revert";
    if (/recheck|failed back|backup slot|staying on/i.test(m)) return "sim_failback";
    if (/SIM slot|failover confirmed|swap/i.test(m)) return "sim_swap";
  }
  return null;
}

function codeOf(event: NetworkEvent): EventCode | null {
  return event.code && KNOWN_CODES.has(event.code)
    ? (event.code as EventCode)
    : inferCode(event);
}

type Reason = "outage" | "quality" | "carrier";

const parseTier = (m: string): 1 | 2 | 3 | 4 | null => {
  const hit = /Tier (\d)/i.exec(m);
  const n = hit ? Number(hit[1]) : NaN;
  return isTier(n) ? n : null;
};

const parseSlot = (m: string): string | null => /slot (\d)/i.exec(m)?.[1] ?? null;

function parseReason(m: string): { reason: Reason; minutes: number | null } | null {
  if (/stuck on one carrier|carrier aggregation/i.test(m)) {
    const minutes = /for (\d+) min/i.exec(m)?.[1];
    return { reason: "carrier", minutes: minutes ? Number(minutes) : null };
  }
  if (/quality/i.test(m)) return { reason: "quality", minutes: null };
  if (/unreachable|connectivity restored|internet/i.test(m)) {
    return { reason: "outage", minutes: null };
  }
  return null;
}

/** "starting recovery (Tier N) - <reason>" names the reason; its action row does not. */
const isReasonRow = (m: string) => /starting recovery \(Tier \d\)/i.test(m);

const TIER_START_WINDOW_SEC = 20;

interface Source {
  event: NetworkEvent;
  code: EventCode | null;
  /** Reason lifted from a merged "starting recovery" row. */
  reason?: { reason: Reason; minutes: number | null } | null;
  synthetic?: boolean;
}

export interface ActivityRow {
  key: string;
  timestamp: number;
  tone: ActivityTone;
  glyph: LucideIcon;
  title: string;
  /** The reason in plain words; null falls back to the row's category. */
  detail: string | null;
  /** The category word shown when there is no detail. */
  category: string;
  severity: EventSeverity;
}

const TIER_GLYPH: Record<1 | 2 | 3 | 4, LucideIcon> = {
  1: RefreshCwIcon,
  2: RadioIcon,
  3: CardSimIcon,
  4: CirclePowerIcon,
};

/** The row's identity inside the feed. Message included: two rows can share a second. */
export const activityKey = (e: NetworkEvent) =>
  `${e.timestamp}-${e.type}-${e.code ?? ""}-${e.message}`;

/** Drops the "starting recovery" row a step's own action row already explains. */
function mergeTierStarts(sources: Source[]): Source[] {
  const absorbed = new Set<Source>();
  for (const row of sources) {
    if (row.code !== "wd_tier_start" || !isReasonRow(row.event.message)) continue;
    const tier = parseTier(row.event.message);
    if (!tier) continue;
    const reason = parseReason(row.event.message);
    const twin = sources.find((other) => {
      if (other === row || absorbed.has(other)) return false;
      if (Math.abs(other.event.timestamp - row.event.timestamp) > TIER_START_WINDOW_SEC) {
        return false;
      }
      if (tier === 1) return other.code === "wd_tier_start" && /re-registering/i.test(other.event.message);
      if (tier === 2) return other.code === "wd_tier_start" && /toggling radio/i.test(other.event.message);
      if (tier === 3) return other.code === "sim_swap" && other.event.severity === "warning";
      return other.code === "wd_tier4_reboot";
    });
    if (!twin) continue;
    absorbed.add(row);
    if (tier !== 3) twin.reason = reason;
  }
  return sources.filter((row) => !absorbed.has(row));
}

/** A restart the ring still holds is not drawn twice. */
const REBOOT_MATCH_SEC = 120;
const isRebootRow = (row: Source, epoch: number) =>
  row.code === "wd_tier4_reboot" &&
  Math.abs(row.event.timestamp - epoch) <= REBOOT_MATCH_SEC;

/** Severity first: the tone a row of unknown shape falls back to. */
const SEVERITY_TONE: Record<EventSeverity, ActivityTone> = {
  info: "muted",
  warning: "warning",
  error: "destructive",
};

function present(
  source: Source,
  t: TFn,
): Pick<ActivityRow, "tone" | "glyph" | "title" | "detail"> {
  const { event, code, reason } = source;
  const m = event.message;
  const sev = event.severity;
  const slot = parseSlot(m);
  const tier = parseTier(m);

  const reasonDetail = (r: { reason: Reason; minutes: number | null } | null | undefined) => {
    if (!r) return null;
    return r.reason === "carrier" && r.minutes
      ? t("watchdog.activity.row.reason.carrierFor", { min: r.minutes })
      : t(`watchdog.activity.row.reason.${r.reason}`);
  };

  switch (code) {
    case "wd_tier_start": {
      const own = parseReason(m);
      const detail = reasonDetail(reason ?? (isReasonRow(m) ? own : null));
      if (tier) {
        return {
          tone: "muted",
          glyph: TIER_GLYPH[tier],
          title: t(`watchdog.activity.row.tierStart.${tier}`),
          detail,
        };
      }
      return {
        tone: "muted",
        glyph: PlayIcon,
        title: t("watchdog.activity.row.recoveryStart"),
        detail: reasonDetail(own),
      };
    }
    case "wd_succeeded": {
      const r = parseReason(m)?.reason ?? "outage";
      return {
        tone: "success",
        glyph: CircleCheckIcon,
        title: tier
          ? t(`watchdog.activity.row.succeeded.${r}`, { tier })
          : t(`watchdog.activity.row.succeededNoTier.${r}`),
        detail: null,
      };
    }
    case "wd_escalate":
      return {
        tone: "warning",
        glyph: ChevronsUpIcon,
        title: tier
          ? t("watchdog.activity.row.escalate", { tier })
          : t("watchdog.activity.row.escalateNext"),
        detail: t("watchdog.activity.row.escalateDetail"),
      };
    case "wd_holdoff": {
      const minutes = Number(/pausing (\d+) min/i.exec(m)?.[1]);
      return {
        tone: "warning",
        glyph: HourglassIcon,
        title: Number.isFinite(minutes)
          ? t("watchdog.activity.row.holdoff", { min: minutes })
          : t("watchdog.activity.row.holdoffNow"),
        detail: t("watchdog.activity.row.holdoffDetail"),
      };
    }
    case "wd_ssr_hold":
      return {
        tone: "info",
        glyph: RefreshCcwDotIcon,
        title: t("watchdog.activity.row.ssrHold"),
        detail: t("watchdog.activity.row.ssrHoldDetail"),
      };
    case "wd_radio_paused":
      return {
        tone: "info",
        glyph: PlaneIcon,
        title: t("watchdog.activity.row.radioPaused"),
        detail: t("watchdog.activity.row.radioPausedDetail"),
      };
    case "wd_budget_spent": {
      const n = /\((\d+) per hour\)/i.exec(m)?.[1];
      return {
        tone: "warning",
        glyph: MoonIcon,
        title: t("watchdog.activity.row.budgetSpent"),
        detail: n
          ? t("watchdog.activity.row.budgetSpentHourly", { n })
          : t("watchdog.activity.row.budgetSpentLong"),
      };
    }
    case "wd_ping_stale":
      return {
        tone: "warning",
        glyph: ClockAlertIcon,
        title: t("watchdog.activity.row.pingStale"),
        detail: t("watchdog.activity.row.pingStaleDetail"),
      };
    case "wd_tier4_reboot":
      return {
        tone: "destructive",
        glyph: RotateCwIcon,
        title: t("watchdog.activity.row.tier4Reboot"),
        detail: reasonDetail(reason),
      };
    case "sim_swap":
      return {
        tone: sev === "error" ? "destructive" : sev === "warning" ? "warning" : "info",
        glyph: ArrowRightLeftIcon,
        title:
          sev === "error"
            ? t("watchdog.activity.row.swapFailed")
            : sev === "warning"
              ? t("watchdog.activity.row.swapStart")
              : t("watchdog.activity.row.swapDone"),
        detail: slot ? t("watchdog.activity.row.slot", { slot }) : null,
      };
    case "sim_revert":
      return {
        tone: SEVERITY_TONE[sev],
        glyph: Undo2Icon,
        title:
          sev === "error"
            ? t("watchdog.activity.row.revertFailed")
            : sev === "warning"
              ? t("watchdog.activity.row.revertBackupFailed")
              : t("watchdog.activity.row.revertRequested"),
        detail:
          sev === "info" ? t("watchdog.activity.row.revertByUser") : slot ? t("watchdog.activity.row.slot", { slot }) : null,
      };
    case "sim_failback": {
      const done = /failed back/i.test(m);
      const checking = /rechecking primary/i.test(m);
      return {
        tone: sev === "error" ? "destructive" : done ? "success" : "muted",
        glyph: RepeatIcon,
        title:
          sev === "error"
            ? t("watchdog.activity.row.failbackFailed")
            : done
              ? t("watchdog.activity.row.failbackDone")
              : checking
                ? t("watchdog.activity.row.failbackTry")
                : t("watchdog.activity.row.failbackStay"),
        detail: slot ? t("watchdog.activity.row.slot", { slot }) : null,
      };
    }
    case "sim_failback_giveup":
      return {
        tone: "warning",
        glyph: CircleOffIcon,
        title: t("watchdog.activity.row.giveup"),
        detail: t("watchdog.activity.row.giveupDetail"),
      };
    default:
      // Unknown shape: the backend's own words, at its own severity.
      return {
        tone: SEVERITY_TONE[sev],
        glyph: sev === "error" ? CircleXIcon : sev === "warning" ? TriangleAlertIcon : InfoIcon,
        title: m.replace(/^Watchcat:\s*/i, ""),
        detail: null,
      };
  }
}

/**
 * The newest rows the card draws: the watchdog's own events, merged where one
 * step wrote two lines, plus any restart the ring no longer holds (the
 * watchdog's reboot ledger survives the reboot it causes).
 */
export function buildActivityRows(
  events: readonly NetworkEvent[],
  recentReboots: readonly number[],
  t: TFn,
): ActivityRow[] {
  const sources: Source[] = events
    .filter((event) => WATCHDOG_TYPES.has(event.type))
    .map((event) => ({ event, code: codeOf(event) }));

  const merged = mergeTierStarts(sources);

  for (const epoch of recentReboots) {
    if (epoch <= CLOCK_PLAUSIBLE_AFTER) continue;
    if (merged.some((row) => isRebootRow(row, epoch))) continue;
    merged.push({
      event: {
        timestamp: epoch,
        type: "watchcat_recovery",
        message: "Watchcat: rebooting system (Tier 4)",
        severity: "error",
        code: "wd_tier4_reboot",
      },
      code: "wd_tier4_reboot",
      synthetic: true,
    });
  }

  return merged
    .sort((a, b) => b.event.timestamp - a.event.timestamp)
    .slice(0, LOG_LIMIT)
    .map((source) => ({
      key: activityKey(source.event),
      timestamp: source.event.timestamp,
      severity: source.event.severity,
      category:
        source.event.type === "sim_failover"
          ? t("watchdog.activity.type.failover")
          : t("watchdog.activity.type.recovery"),
      ...present(source, t),
    }));
}
