"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CircleAlertIcon,
  CircleHelpIcon,
  CirclePauseIcon,
  CircleXIcon,
  ClockAlertIcon,
  GaugeIcon,
  HourglassIcon,
  LayersIcon,
  LoaderCircleIcon,
  LockIcon,
  PlaneIcon,
  PowerIcon,
  PowerOffIcon,
  RefreshCcwDotIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TimerIcon,
  type LucideIcon,
} from "lucide-react";

import type {
  CqGetResponse,
  RecoveryReason,
  WatchdogEffective,
  WatchdogSettingsV2,
  WatchdogStatus,
} from "@/types/cq-watchdog";
import type { ConnectivityStatus, WatchcatStatus } from "@/types/modem-status";

import type { ClockSnapshot } from "./use-clock";
import { STRIP, type DiscTone, type FigureTone } from "./shapes";

// Watchdog — the surface's ONE derived model. Every child reads this; no
// component re-infers a state from a payload.

/** `t` as the derived model needs it: a key, optional values, a string back. */
export type TFn = (key: string, options?: Record<string, unknown>) => string;

// -----------------------------------------------------------------------------
// The recovery ladder
// -----------------------------------------------------------------------------

export type TierIndex = 1 | 2 | 3 | 4;

/** Escalation order, gentlest first. The one place the four rungs are listed. */
export const TIERS: readonly TierIndex[] = [1, 2, 3, 4];

/** Rung copy keys. The names live HERE and nowhere else on the surface. */
export const TIER_NAME_KEY: Record<TierIndex, string> = {
  1: "watchdog.ladder.tier1.name",
  2: "watchdog.ladder.tier2.name",
  3: "watchdog.ladder.tier3.name",
  4: "watchdog.ladder.tier4.name",
};

/** What the rung costs the user. Stated in the rung, never in a tooltip. */
export const TIER_CONSEQUENCE_KEY: Record<TierIndex, string> = {
  1: "watchdog.ladder.tier1.consequence",
  2: "watchdog.ladder.tier2.consequence",
  3: "watchdog.ladder.tier3.consequence",
  4: "watchdog.ladder.tier4.consequence",
};

/** The step as a gerund, for "Step 2 running: restarting the radio". */
const TIER_ACTION_KEY: Record<TierIndex, string> = {
  1: "watchdog.phase.action.1",
  2: "watchdog.phase.action.2",
  3: "watchdog.phase.action.3",
  4: "watchdog.phase.action.4",
};

export const isTier = (n: number | null | undefined): n is TierIndex =>
  n === 1 || n === 2 || n === 3 || n === 4;

/** The reasons that stop at step 2 (contract 5.4: quality and carrier). */
export const STOPS_AT_STEP_2: ReadonlySet<RecoveryReason> = new Set([
  "quality",
  "carrier",
]);

/** The 15 -> 30 -> 60 min hold-off steps (quality and carrier). */
const HOLDOFF_MINUTES = [15, 30, 60] as const;

// -----------------------------------------------------------------------------
// Formatting
// -----------------------------------------------------------------------------

export interface Formatters {
  t: TFn;
  /** "20 s", "1 min 5 s", "2 h 10 min": a duration in words and units. */
  duration: (seconds: number) => string;
  /** The hero numeral: "21 s", "1:32", "47 min", "1 h 12 min". */
  figure: (seconds: number) => string;
  /** A time of day in the app's locale. */
  clock: (epochMs: number) => string;
}

function durationText(t: TFn, seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return t("watchdog.duration.seconds", { s });
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0
      ? t("watchdog.duration.minutes", { m })
      : t("watchdog.duration.minutesSeconds", { m, s: r });
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m === 0
    ? t("watchdog.duration.hours", { h })
    : t("watchdog.duration.hoursMinutes", { h, m });
}

function figureText(t: TFn, seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return t("watchdog.duration.seconds", { s });
  if (s < 600) {
    const r = String(s % 60).padStart(2, "0");
    return `${Math.floor(s / 60)}:${r}`;
  }
  if (s < 3600) return t("watchdog.duration.minutes", { m: Math.floor(s / 60) });
  return durationText(t, s);
}

export function useFormatters(): Formatters {
  const { t, i18n } = useTranslation("monitoring");
  const language = i18n.language;
  return useMemo<Formatters>(() => {
    const tf = t as unknown as TFn;
    return {
      t: tf,
      duration: (seconds) => durationText(tf, seconds),
      figure: (seconds) => figureText(tf, seconds),
      clock: (epochMs) =>
        new Date(epochMs).toLocaleTimeString(language, {
          hour: "2-digit",
          minute: "2-digit",
        }),
    };
  }, [t, language]);
}

/** Seconds since the GET landed, never negative. */
export function elapsedSince(receivedAt: number | null, clock: ClockSnapshot): number {
  if (receivedAt === null) return 0;
  return Math.max(0, (clock.perfMs - receivedAt) / 1000);
}

/**
 * Seconds left until a MONO deadline: the deadline minus the status' own mono,
 * minus the seconds elapsed since the GET landed. Null when there is no deadline.
 */
export function remainingUntil(
  deadline: number | null | undefined,
  status: Pick<WatchdogStatus, "mono">,
  receivedAt: number | null,
  clock: ClockSnapshot,
): number | null {
  if (deadline === null || deadline === undefined || !Number.isFinite(deadline)) {
    return null;
  }
  const mono = Number.isFinite(status.mono) ? status.mono : 0;
  return Math.max(0, Math.ceil(deadline - mono - elapsedSince(receivedAt, clock)));
}

// -----------------------------------------------------------------------------
// The phase ladder
// -----------------------------------------------------------------------------

/**
 * What the surface knows about the watchdog, in one closed set. The daemon's own
 * states are split where one state reads as two (a hold-off is outage, quality or
 * carrier) and joined by the synthetic ones the daemon cannot report about itself.
 */
export type WatchdogPhase =
  | "off"
  | "unknown"
  | "starting"
  | "not_running"
  | "auto_disabled"
  | "monitor"
  | "suspect"
  | "recovery"
  | "cooldown"
  | "holdoff_outage"
  | "holdoff_quality"
  | "holdoff_carrier"
  | "radio_off"
  | "ssr_hold"
  | "ping_stale"
  | "locked"
  | "disabled";

/**
 * One poller Tier-1.5 period is ~20s, and a save backgrounds the unit restart,
 * so a healthy start can take ~30s to reach the page. Three periods is the
 * honest floor before calling it silent.
 */
export const GRACE_MS = 60_000;

/**
 * A modem with no battery RTC boots at Jan 1970 and stays there without a
 * registered SIM, which makes every clock-difference staleness check read
 * "stale" forever. Below this epoch the modem clock is not evidence.
 */
export const CLOCK_PLAUSIBLE_AFTER = 1_600_000_000;

/**
 * The daemon is enabled AND still reporting (the poller's `watchcat` block
 * carries the heartbeat age). A block with no age fields (an older backend)
 * counts as live: absence of evidence is not staleness.
 */
export function isWatchcatLive(watchcat: WatchcatStatus | null): boolean {
  if (!watchcat?.enabled) return false;
  const { age_sec: age, stale_after: limit } = watchcat;
  return !(age != null && limit != null && age > limit);
}

export interface PhaseInput {
  /** Saved truth, not the draft. The hero never reports a half-edited form. */
  settingsEnabled: boolean;
  autoDisabled: boolean;
  /** The watchdog GET's state object; null when the daemon wrote none. */
  status: WatchdogStatus | null;
  /** The poller's `watchcat` block, used only for the heartbeat age. */
  watchcat: WatchcatStatus | null;
  pastGrace: boolean;
}

/**
 * Resolution is ordered and total: a standing config fact outranks a live
 * reading, and not knowing outranks guessing.
 */
export function derivePhase({
  settingsEnabled,
  autoDisabled,
  status,
  watchcat,
  pastGrace,
}: PhaseInput): WatchdogPhase {
  if (autoDisabled) return "auto_disabled";
  if (!settingsEnabled) return "off";

  // Enabled but the daemon has not written (or no longer says it is) running.
  if (!status || status.enabled === false) {
    return pastGrace ? "not_running" : "starting";
  }
  // It WAS reporting and the heartbeat went quiet: no grace.
  if (watchcat?.enabled && !isWatchcatLive(watchcat)) return "not_running";

  switch (status.state) {
    case "locked":
      return "locked";
    case "radio_off":
      return "radio_off";
    case "ssr_hold":
      return "ssr_hold";
    case "disabled":
      return "disabled";
    case "recovery":
      return "recovery";
    case "cooldown":
      return "cooldown";
    case "holdoff":
      return status.holdoff_reason === "quality"
        ? "holdoff_quality"
        : status.holdoff_reason === "carrier"
          ? "holdoff_carrier"
          : "holdoff_outage";
    case "suspect":
      return status.ping_stale ? "ping_stale" : "suspect";
    case "monitor":
    default:
      return status.ping_stale ? "ping_stale" : "monitor";
  }
}

/** Phases that are the daemon's own report; every other phase has no figures. */
const REPORTING_PHASES: ReadonlySet<WatchdogPhase> = new Set([
  "monitor",
  "suspect",
  "recovery",
  "cooldown",
  "holdoff_outage",
  "holdoff_quality",
  "holdoff_carrier",
  "radio_off",
  "ssr_hold",
  "ping_stale",
  "locked",
  "disabled",
]);

export interface PhaseStyle {
  disc: DiscTone;
  glyph: LucideIcon;
  /** The glyph turns: a step is running. */
  spin?: boolean;
}

/**
 * Seventeen phases, seventeen distinct glyphs: the discs are told apart by
 * shape, never by colour alone (the containers are 1.03:1 apart).
 */
export const PHASE_STYLE: Record<WatchdogPhase, PhaseStyle> = {
  off: { disc: "neutral", glyph: PowerOffIcon },
  unknown: { disc: "neutral", glyph: CircleHelpIcon },
  starting: { disc: "info", glyph: PowerIcon },
  not_running: { disc: "bad", glyph: CircleXIcon },
  auto_disabled: { disc: "bad", glyph: CircleAlertIcon },
  monitor: { disc: "good", glyph: ShieldCheckIcon },
  suspect: { disc: "alert", glyph: ShieldAlertIcon },
  recovery: { disc: "info", glyph: LoaderCircleIcon, spin: true },
  cooldown: { disc: "info", glyph: TimerIcon },
  holdoff_outage: { disc: "alert", glyph: HourglassIcon },
  holdoff_quality: { disc: "alert", glyph: GaugeIcon },
  holdoff_carrier: { disc: "alert", glyph: LayersIcon },
  radio_off: { disc: "neutral", glyph: PlaneIcon },
  ssr_hold: { disc: "info", glyph: RefreshCcwDotIcon },
  ping_stale: { disc: "alert", glyph: ClockAlertIcon },
  locked: { disc: "neutral", glyph: LockIcon },
  disabled: { disc: "neutral", glyph: CirclePauseIcon },
};

// -----------------------------------------------------------------------------
// The status card
// -----------------------------------------------------------------------------

export interface HeroFigure {
  key: "offline" | "recoveries" | "lastFix" | "reboots";
  eyebrow: string;
  /** Already-formatted figure, or null when there is no reading. */
  value: string | null;
  /** What a screen reader says for a null value. */
  valueSr: string;
  caption: string;
  tone: FigureTone;
}

export interface HeroView {
  phase: WatchdogPhase;
  title: string;
  blurb: string;
  /** The blurb carries a live figure and must not jitter. */
  blurbNumeric: boolean;
  style: PhaseStyle;
  figures: HeroFigure[];
}

export interface HeroInput {
  phase: WatchdogPhase;
  status: WatchdogStatus | null;
  settings: WatchdogSettingsV2;
  effective: WatchdogEffective;
  simDual: boolean;
  receivedAt: number | null;
  clock: ClockSnapshot;
  fmt: Formatters;
  /** Relative time for an epoch ("2h ago"). */
  timeAgo: (epochSec: number) => string;
}

/** A counter that was read `elapsed` seconds ago keeps counting while it is above zero. */
const liveCount = (value: number | null | undefined, elapsed: number): number => {
  const v = Number.isFinite(value) ? (value as number) : 0;
  return v > 0 ? v + Math.floor(elapsed) : 0;
};

/** Seconds of the current stretch that matches the reason, 0 when none. */
function stretchSecs(
  reason: RecoveryReason,
  status: WatchdogStatus,
  elapsed: number,
): number {
  if (reason === "quality") return liveCount(status.quality_breach_secs, elapsed);
  if (reason === "carrier") return liveCount(status.carrier_single_secs, elapsed);
  return liveCount(status.offline_secs ?? status.failure_secs, elapsed);
}

/** The reason the first figure speaks of: the running episode, else whatever is ticking. */
function figureReason(status: WatchdogStatus, elapsed: number): RecoveryReason | null {
  if (status.recovery_reason) return status.recovery_reason;
  for (const reason of ["outage", "quality", "carrier"] as const) {
    if (stretchSecs(reason, status, elapsed) > 0) return reason;
  }
  return null;
}

/** The tiers the saved config would actually run, for "what is next". */
export function armedTiers(
  settings: WatchdogSettingsV2,
  simDual: boolean,
  budgetExhausted: boolean,
): Record<TierIndex, boolean> {
  return {
    1: settings.tier1_enabled,
    2: settings.tier2_enabled,
    3: settings.tier3_enabled && settings.backup_sim_slot !== null && simDual,
    4: settings.tier4_enabled && !budgetExhausted,
  };
}

/**
 * Phase plus four readings, each honest about absence: a missing figure is
 * `null` and renders as an em dash, never as a zero the device never reported.
 */
export function deriveHero(input: HeroInput): HeroView {
  const { phase, status, settings, effective, simDual, receivedAt, clock, fmt } = input;
  const { t } = fmt;
  const known = REPORTING_PHASES.has(phase) && status !== null;
  const elapsed = elapsedSince(receivedAt, clock);
  const left = (deadline: number | null | undefined) =>
    known ? remainingUntil(deadline, status, receivedAt, clock) : null;
  const at = (seconds: number) => fmt.clock(clock.epochMs + seconds * 1000);
  const reason: RecoveryReason = known ? (status.recovery_reason ?? "outage") : "outage";
  const tier = known ? status.current_tier : 0;

  let title = "";
  let blurb = "";
  let blurbNumeric = false;

  switch (phase) {
    case "off":
      title = t("watchdog.phase.off.title");
      blurb = t("watchdog.phase.off.blurb");
      break;
    case "unknown":
      title = t("watchdog.phase.unknown.title");
      blurb = t("watchdog.phase.unknown.blurb");
      break;
    case "starting":
      title = t("watchdog.phase.starting.title");
      blurb = t("watchdog.phase.starting.blurb");
      break;
    case "not_running":
      title = t("watchdog.phase.not_running.title");
      blurb = t("watchdog.phase.not_running.blurb");
      break;
    case "auto_disabled":
      title = t("watchdog.phase.auto_disabled.title");
      blurb = t("watchdog.phase.auto_disabled.blurb");
      break;
    case "monitor":
      title = t("watchdog.phase.monitor.title");
      blurb = t("watchdog.phase.monitor.blurb", {
        time: fmt.duration(effective.act_after_sec),
      });
      break;
    case "suspect": {
      const secs = known ? liveCount(status.offline_secs ?? status.failure_secs, elapsed) : 0;
      title = t("watchdog.phase.suspect.title");
      blurb =
        secs > 0
          ? t("watchdog.phase.suspect.blurb", { time: fmt.duration(secs) })
          : t("watchdog.phase.suspect.blurbNow");
      blurbNumeric = secs > 0;
      break;
    }
    case "recovery": {
      const secs = known ? stretchSecs(reason, status, elapsed) : 0;
      title = isTier(tier)
        ? t("watchdog.phase.recovery.title", { tier, action: t(TIER_ACTION_KEY[tier]) })
        : t("watchdog.phase.recovery.titleGeneric");
      blurb =
        secs > 0
          ? t(`watchdog.phase.recovery.blurb.${reason}`, { time: fmt.duration(secs) })
          : t("watchdog.phase.recovery.blurbNow");
      blurbNumeric = secs > 0;
      break;
    }
    case "cooldown": {
      const secs =
        known
          ? (left(status.step_wait_until) ?? Math.max(0, status.cooldown_remaining ?? 0))
          : 0;
      title =
        secs > 0 && isTier(tier)
          ? t("watchdog.phase.cooldown.title", { tier, time: fmt.duration(secs) })
          : isTier(tier)
            ? t("watchdog.phase.cooldown.titleChecking", { tier })
            : t("watchdog.phase.cooldown.titleGeneric");
      blurbNumeric = secs > 0;
      const armed = armedTiers(settings, simDual, known && status.reboot_budget_exhausted);
      const next = TIERS.find(
        (n) =>
          n > (tier || 0) && armed[n] && !(STOPS_AT_STEP_2.has(reason) && n > 2),
      );
      blurb = next
        ? t(`watchdog.phase.cooldown.next.${reason}`, { tier: next })
        : t(`watchdog.phase.cooldown.last.${reason}`);
      break;
    }
    case "holdoff_outage": {
      const secs = left(known ? status.holdoff_until : null);
      title =
        secs !== null && secs > 0
          ? t("watchdog.phase.holdoff.outage.title", { time: fmt.duration(secs) })
          : t("watchdog.phase.holdoff.outage.titleNow");
      blurb =
        secs !== null && secs > 0
          ? t("watchdog.phase.holdoff.outage.blurb", { time: at(secs) })
          : t("watchdog.phase.holdoff.outage.blurbNow");
      blurbNumeric = true;
      break;
    }
    case "holdoff_quality":
    case "holdoff_carrier": {
      const which = phase === "holdoff_quality" ? "quality" : "carrier";
      const level = known
        ? which === "quality"
          ? status.holdoff_quality_level
          : status.holdoff_carrier_level
        : 0;
      const minutes = HOLDOFF_MINUTES[Math.min(2, Math.max(0, level ?? 0))];
      const secs = left(known ? status.holdoff_until : null);
      title = t(`watchdog.phase.holdoff.${which}.title`, {
        time: fmt.duration(minutes * 60),
      });
      blurb =
        secs !== null && secs > 0
          ? t(`watchdog.phase.holdoff.${which}.blurb`, { time: at(secs) })
          : t(`watchdog.phase.holdoff.${which}.blurbNow`);
      blurbNumeric = true;
      break;
    }
    case "radio_off":
      title = t("watchdog.phase.radio_off.title");
      blurb = t("watchdog.phase.radio_off.blurb");
      break;
    case "ssr_hold": {
      const secs = left(known ? status.ssr_hold_until : null);
      title =
        secs !== null && secs > 0
          ? t("watchdog.phase.ssr_hold.title", { time: fmt.duration(secs) })
          : t("watchdog.phase.ssr_hold.titleNow");
      blurb = t("watchdog.phase.ssr_hold.blurb");
      break;
    }
    case "ping_stale":
      title = t("watchdog.phase.ping_stale.title");
      blurb = t("watchdog.phase.ping_stale.blurb");
      break;
    case "locked":
      title = t("watchdog.phase.locked.title");
      blurb = t("watchdog.phase.locked.blurb");
      break;
    case "disabled":
      title = t("watchdog.phase.disabled.title");
      blurb = t("watchdog.phase.disabled.blurb");
      break;
  }

  return {
    phase,
    title,
    blurb,
    blurbNumeric,
    style: PHASE_STYLE[phase],
    figures: [
      offlineFigure(input, known ? status : null, elapsed),
      recoveriesFigure(fmt, known ? status : null),
      lastFixFigure(input, known ? status : null),
      rebootsFigure(input, known ? status : null, left),
    ],
  };
}

function offlineFigure(
  input: HeroInput,
  status: WatchdogStatus | null,
  elapsed: number,
): HeroFigure {
  const { fmt, clock, effective, settings } = input;
  const { t } = fmt;
  const noReading: HeroFigure = {
    key: "offline",
    eyebrow: t("watchdog.hero.offline.eyebrow"),
    value: null,
    valueSr: t("watchdog.hero.absent"),
    caption: t("watchdog.hero.noReading"),
    tone: "neutral",
  };
  if (!status) return noReading;

  const reason = figureReason(status, elapsed);
  const secs = reason ? stretchSecs(reason, status, elapsed) : 0;
  if (!reason || secs <= 0) {
    return {
      ...noReading,
      valueSr: t("watchdog.hero.none"),
      caption: t("watchdog.hero.linkUp"),
    };
  }
  if (reason === "quality") {
    return {
      key: "offline",
      eyebrow: t("watchdog.hero.quality.eyebrow"),
      value: fmt.figure(secs),
      valueSr: "",
      caption: t("watchdog.hero.quality.caption", {
        ms: effective.quality_limits.latency_ms,
        pct: effective.quality_limits.loss_pct,
      }),
      tone: "alert",
    };
  }
  if (reason === "carrier") {
    return {
      key: "offline",
      eyebrow: t("watchdog.hero.carrier.eyebrow"),
      value: fmt.figure(secs),
      valueSr: "",
      caption: t("watchdog.hero.carrier.caption", {
        time: fmt.duration(settings.carrier_after_min * 60),
      }),
      tone: "alert",
    };
  }
  return {
    key: "offline",
    eyebrow: t("watchdog.hero.offline.eyebrow"),
    value: fmt.figure(secs),
    valueSr: "",
    caption: t("watchdog.hero.offline.caption", {
      time: fmt.clock(clock.epochMs - secs * 1000),
    }),
    tone: "bad",
  };
}

function recoveriesFigure(fmt: Formatters, status: WatchdogStatus | null): HeroFigure {
  const { t } = fmt;
  return {
    key: "recoveries",
    eyebrow: t("watchdog.hero.recoveries.eyebrow"),
    value: status ? String(status.total_recoveries ?? 0) : null,
    valueSr: t("watchdog.hero.absent"),
    caption: t("watchdog.hero.recoveries.caption"),
    tone: "neutral",
  };
}

function lastFixFigure(input: HeroInput, status: WatchdogStatus | null): HeroFigure {
  const { fmt, timeAgo } = input;
  const { t } = fmt;
  const base = {
    key: "lastFix" as const,
    eyebrow: t("watchdog.hero.lastFix.eyebrow"),
    valueSr: t("watchdog.hero.absent"),
    tone: "neutral" as const,
  };
  if (!status) {
    return { ...base, value: null, caption: t("watchdog.hero.noReading") };
  }
  const tier = status.last_success_tier;
  if (!isTier(tier)) {
    return {
      ...base,
      value: null,
      valueSr: t("watchdog.hero.none"),
      caption: t("watchdog.hero.lastFix.none"),
    };
  }
  const took = status.last_success_took_s;
  const reason = status.last_success_reason;
  const reasonWord =
    reason === "quality" || reason === "carrier"
      ? t(`watchdog.hero.lastFix.reason.${reason}`)
      : null;
  const caption = reasonWord
    ? took != null
      ? t("watchdog.hero.lastFix.captionReasonTook", {
          tier,
          reason: reasonWord,
          time: fmt.duration(took),
        })
      : t("watchdog.hero.lastFix.captionReason", { tier, reason: reasonWord })
    : took != null
      ? t("watchdog.hero.lastFix.captionTook", { tier, time: fmt.duration(took) })
      : t("watchdog.hero.lastFix.caption", { tier });
  return {
    ...base,
    value:
      status.last_success_time != null && status.last_success_time > CLOCK_PLAUSIBLE_AFTER
        ? timeAgo(status.last_success_time)
        : null,
    caption,
  };
}

function rebootsFigure(
  input: HeroInput,
  status: WatchdogStatus | null,
  left: (deadline: number | null | undefined) => number | null,
): HeroFigure {
  const { fmt, clock, settings } = input;
  const { t } = fmt;
  const base = {
    key: "reboots" as const,
    eyebrow: t("watchdog.hero.reboots.eyebrow"),
    valueSr: t("watchdog.hero.absent"),
  };
  if (!status) {
    return {
      ...base,
      value: null,
      caption: t("watchdog.hero.noReading"),
      tone: "neutral",
    };
  }
  const limit = status.reboot_limit || settings.max_reboots_per_hour;
  const used = status.reboots_this_hour ?? 0;
  const value = t("watchdog.hero.reboots.value", { used, limit });
  if (status.reboot_budget_exhausted) {
    const secs = left(status.reboot_rest_until);
    const caption =
      status.reboot_rest_reason === "long_outage"
        ? t("watchdog.hero.reboots.restingLong")
        : secs !== null && secs > 0
          ? t("watchdog.hero.reboots.resting", {
              time: fmt.clock(clock.epochMs + secs * 1000),
            })
          : t("watchdog.hero.reboots.restingNow");
    return { ...base, value, caption, tone: "alert" };
  }
  return {
    ...base,
    value,
    caption: settings.tier4_enabled
      ? t("watchdog.hero.reboots.caption")
      : t("watchdog.hero.reboots.off"),
    tone: used > 0 ? "alert" : "neutral",
  };
}

// -----------------------------------------------------------------------------
// The probe strip
// -----------------------------------------------------------------------------

export type StripBar =
  | { kind: "none" }
  | { kind: "miss" }
  | { kind: "ok"; heightPct: number; ms: number };

export type StripView =
  | { kind: "empty" }
  | {
      kind: "bars";
      bars: StripBar[];
      total: number;
      missed: number;
      /** Seconds between two probes, for each bar's "N s ago" tooltip. */
      intervalSec: number;
      minutes: number;
    };

/** The poller's own probe history, oldest first, left-padded to the slot count. */
export function deriveStrip(
  connectivity: ConnectivityStatus | null,
  phase: WatchdogPhase,
): StripView {
  const all = connectivity?.latency_history ?? [];
  if (phase === "unknown" || all.length === 0) return { kind: "empty" };

  const history = all.slice(-STRIP.SLOTS);
  const answered = history.filter((v): v is number => v !== null);
  const max = Math.max(1, ...answered);
  const pad: StripBar[] = Array.from(
    { length: STRIP.SLOTS - history.length },
    () => ({ kind: "none" }),
  );
  const bars: StripBar[] = history.map((v) =>
    v === null
      ? { kind: "miss" }
      : {
          kind: "ok",
          heightPct: Math.round(STRIP.FLOOR_PCT + STRIP.SPAN_PCT * (v / max)),
          ms: Math.round(v),
        },
  );
  const interval = connectivity?.history_interval_sec ?? 0;

  return {
    kind: "bars",
    bars: [...pad, ...bars],
    total: history.length,
    missed: history.length - answered.length,
    intervalSec: interval,
    minutes: Math.max(1, Math.round((history.length * interval) / 60)),
  };
}

// -----------------------------------------------------------------------------
// The ladder's per-step state
// -----------------------------------------------------------------------------

export type RungState =
  | "idle"
  | "tried"
  | "running"
  | "resting"
  | "unused"
  | "unavailable";

export interface RungView {
  state: RungState;
  /** While running: the step is acting now ("recovery") or being checked ("cooldown"). */
  running: "recovery" | "cooldown" | null;
  /** A state worth reading, replacing the cost line; null keeps the cost line. */
  caption: string | null;
}

export interface FailbackView {
  state: "idle" | "scheduled" | "trying" | "gaveUp";
  caption: string | null;
}

export interface RungsInput {
  phase: WatchdogPhase;
  status: WatchdogStatus | null;
  simDual: boolean;
  receivedAt: number | null;
  clock: ClockSnapshot;
  fmt: Formatters;
}

const IDLE_RUNG: RungView = { state: "idle", running: null, caption: null };

/** Per-step state from the daemon's own report, never the draft. */
export function deriveRungs(input: RungsInput): Record<TierIndex, RungView> {
  const { phase, status, simDual, receivedAt, clock, fmt } = input;
  const { t } = fmt;
  const out: Record<TierIndex, RungView> = {
    1: IDLE_RUNG,
    2: IDLE_RUNG,
    3: IDLE_RUNG,
    4: IDLE_RUNG,
  };
  if (!simDual) {
    out[3] = {
      state: "unavailable",
      running: null,
      caption: t("watchdog.ladder.state.needsSecondSim"),
    };
  }
  if (!status || !REPORTING_PHASES.has(phase)) return out;

  const tried = new Set(status.tiers_tried ?? []);
  const current = status.current_tier;
  const acting = phase === "recovery" || phase === "cooldown";
  const reason =
    status.recovery_reason ??
    (phase.startsWith("holdoff") ? status.holdoff_reason : null);

  for (const tier of TIERS) {
    if (tier === 3 && !simDual) continue;

    if (tier >= 3 && reason && STOPS_AT_STEP_2.has(reason)) {
      out[tier] = {
        state: "unused",
        running: null,
        caption: t(`watchdog.ladder.state.unused.${reason}`),
      };
      continue;
    }

    if (tier === 4 && status.reboot_budget_exhausted) {
      const secs = remainingUntil(status.reboot_rest_until, status, receivedAt, clock);
      out[4] = {
        state: "resting",
        running: null,
        caption:
          status.reboot_rest_reason === "long_outage"
            ? t("watchdog.ladder.state.restingLong")
            : secs !== null && secs > 0
              ? t("watchdog.ladder.state.resting", {
                  time: fmt.clock(clock.epochMs + secs * 1000),
                  used: status.reboots_this_hour ?? 0,
                  limit: status.reboot_limit,
                })
              : t("watchdog.ladder.state.restingNow", {
                  used: status.reboots_this_hour ?? 0,
                  limit: status.reboot_limit,
                }),
      };
      continue;
    }

    if (acting && current === tier) {
      const secs =
        phase === "cooldown"
          ? (remainingUntil(status.step_wait_until, status, receivedAt, clock) ??
            Math.max(0, status.cooldown_remaining ?? 0))
          : 0;
      out[tier] = {
        state: "running",
        running: phase === "cooldown" ? "cooldown" : "recovery",
        caption:
          phase === "cooldown" && secs > 0
            ? t("watchdog.ladder.state.checking", { time: fmt.duration(secs) })
            : phase === "cooldown"
              ? t("watchdog.ladder.state.checkingNow")
              : t("watchdog.ladder.state.running"),
      };
      continue;
    }

    if (tried.has(tier)) {
      const lastAt =
        status.last_recovery_tier === tier &&
        status.last_recovery_time != null &&
        status.last_recovery_time > CLOCK_PLAUSIBLE_AFTER
          ? status.last_recovery_time
          : null;
      out[tier] = {
        state: "tried",
        running: null,
        caption:
          lastAt !== null
            ? t("watchdog.ladder.state.triedAt", { time: fmt.clock(lastAt * 1000) })
            : t("watchdog.ladder.state.tried"),
      };
      continue;
    }

    if (tier === 3 && status.sim_failover_active) {
      out[3] = {
        state: "idle",
        running: null,
        caption: t("watchdog.ladder.state.onBackup", {
          slot: status.current_sim_slot ?? "?",
        }),
      };
    }
  }
  return out;
}

/** The failback child row: when the next try is, or that it gave up. */
export function deriveFailback(input: {
  status: WatchdogStatus | null;
  receivedAt: number | null;
  clock: ClockSnapshot;
  fmt: Formatters;
}): FailbackView {
  const { status, receivedAt, clock, fmt } = input;
  const { t } = fmt;
  if (!status || !status.sim_failover_active) return { state: "idle", caption: null };

  if (status.failback_failures >= 3) {
    return { state: "gaveUp", caption: t("watchdog.ladder.failback.gaveUp") };
  }
  if (status.failback_active) {
    return { state: "trying", caption: t("watchdog.ladder.failback.trying") };
  }
  const secs = remainingUntil(status.failback_next_at, status, receivedAt, clock);
  if (secs === null) return { state: "idle", caption: null };
  return {
    state: "scheduled",
    caption:
      status.failback_failures > 0
        ? t("watchdog.ladder.failback.nextFailed", {
            time: fmt.duration(secs),
            n: status.failback_failures,
          })
        : t("watchdog.ladder.failback.next", { time: fmt.duration(secs) }),
  };
}

// -----------------------------------------------------------------------------
// Detection facts: sensitivity, clamps and quality limits
// -----------------------------------------------------------------------------

export interface SensitivityFacts {
  /** Null when Connection Quality could not be read. */
  name: string | null;
  /** Seconds before the link reads down. 0 = unknown. */
  failSecs: number;
  /** Seconds before the link reads up again. 0 = unknown. */
  recoverSecs: number;
}

/**
 * The stored sensitivity's cadence. Without the Connection Quality read it is
 * recovered from the watchdog's own effective values, which only differ from
 * the stored ones when the sensitivity raised them.
 */
export function deriveSensitivityFacts(
  cq: CqGetResponse | null,
  saved: WatchdogSettingsV2,
  effective: WatchdogEffective,
): SensitivityFacts {
  if (cq) {
    const row = cq.tables.sensitivity[cq.settings.sensitivity];
    if (row) {
      return {
        name: cq.settings.sensitivity,
        failSecs: row.fail_secs,
        recoverSecs: row.recover_secs,
      };
    }
  }
  return {
    name: null,
    failSecs:
      effective.act_after_sec > saved.act_after_sec ? effective.act_after_sec : 0,
    recoverSecs:
      effective.step_wait_sec > saved.step_wait_sec ? effective.step_wait_sec - 20 : 0,
  };
}

export interface LimitFact {
  /** The value Connection Quality is set to; null when it could not be read. */
  raw: number | null;
  /** What the watchdog acts on, after the floor. */
  effective: number;
}

export interface QualityLimits {
  latency: LimitFact;
  loss: LimitFact;
}

export function deriveQualityLimits(
  cq: CqGetResponse | null,
  effective: WatchdogEffective,
): QualityLimits {
  let rawLat: number | null = null;
  let rawLoss: number | null = null;
  if (cq) {
    const { latency, loss } = cq.settings;
    rawLat =
      latency.preset === "custom"
        ? latency.custom_ms
        : (cq.tables.presets.latency[latency.preset] ?? null);
    rawLoss =
      loss.preset === "custom"
        ? loss.custom_pct
        : (cq.tables.presets.loss[loss.preset] ?? null);
  }
  return {
    latency: { raw: rawLat, effective: effective.quality_limits.latency_ms },
    loss: { raw: rawLoss, effective: effective.quality_limits.loss_pct },
  };
}

// -----------------------------------------------------------------------------
// The outage timeline
// -----------------------------------------------------------------------------

/** One integer check for the form and the timeline, mirroring the CGI ranges. */
export const isIntInRange = (raw: string, min: number, max: number): boolean => {
  const n = Number(raw);
  return !(raw.trim() === "" || isNaN(n) || !Number.isInteger(n) || n < min || n > max);
};

/** The daemon holds at least this long after a SIM switch before rechecking. */
const SIM_SWITCH_MIN_WAIT = 90;

export interface TimelineInput {
  enabled: boolean;
  tiers: Record<TierIndex, boolean>;
  hasSlot: boolean;
  /** Draft "start recovery after", already clamped to the sensitivity. */
  actSecs: number;
  /** Draft "wait between steps", already clamped to the sensitivity. */
  waitSecs: number;
  failSecs: number;
  sensitivityName: string | null;
  /** Reboots are resting right now. */
  resting: boolean;
  /** Seconds offline right now, or null when the link is up. */
  nowSecs: number | null;
}

export type TimelineLabel =
  | { key: "quiet" }
  | { key: "markedDown"; name: string | null }
  | { key: "step"; tier: TierIndex }
  | { key: "reboot" }
  | { key: "rebootResting" }
  | { key: "holdoff" }
  | { key: "now" };

export interface TimelineRow {
  id: string;
  label: TimelineLabel;
  seconds: number;
  state: "" | "done" | "rest" | "now";
}

export type TimelineNote = "off" | "none";

export interface TimelineView {
  rows: TimelineRow[];
  note: TimelineNote | null;
  /** The disclosure's summary: the reboot time, or the live offline time. */
  summary: { kind: "reboot" | "last" | "now"; seconds: number } | null;
}

/**
 * When each armed step runs into an outage, from the EFFECTIVE values the
 * daemon would use: declare at the clamped start time, then one wait per step
 * (the backup SIM step settles for at least 90 s), then the hold-off.
 */
export function deriveTimeline({
  enabled,
  tiers,
  hasSlot,
  actSecs,
  waitSecs,
  failSecs,
  sensitivityName,
  resting,
  nowSecs,
}: TimelineInput): TimelineView {
  if (!enabled) return { rows: [], note: "off", summary: null };
  const armed = TIERS.filter((n) => tiers[n] && (n !== 3 || hasSlot));
  if (armed.length === 0) return { rows: [], note: "none", summary: null };

  const raw: Omit<TimelineRow, "state">[] = [
    { id: "quiet", label: { key: "quiet" }, seconds: 0 },
  ];
  if (failSecs > 0) {
    raw.push({
      id: "marked",
      label: { key: "markedDown", name: sensitivityName },
      seconds: failSecs,
    });
  }
  let at = actSecs;
  let rebootAt: number | null = null;
  let lastAt = actSecs;
  for (const tier of armed) {
    lastAt = at;
    if (tier === 4) {
      rebootAt = at;
      raw.push({
        id: "t4",
        label: { key: resting ? "rebootResting" : "reboot" },
        seconds: at,
      });
    } else {
      raw.push({ id: `t${tier}`, label: { key: "step", tier }, seconds: at });
    }
    at += tier === 3 ? Math.max(waitSecs, SIM_SWITCH_MIN_WAIT) : waitSecs;
  }
  raw.push({ id: "holdoff", label: { key: "holdoff" }, seconds: at });

  const rows: TimelineRow[] = raw.map((row) => ({
    ...row,
    state:
      nowSecs !== null && row.seconds <= nowSecs
        ? "done"
        : row.id === "t4" && resting
          ? "rest"
          : "",
  }));
  if (nowSecs !== null) {
    const idx = rows.findIndex((row) => row.seconds > nowSecs);
    const nowRow: TimelineRow = {
      id: "now",
      label: { key: "now" },
      seconds: nowSecs,
      state: "now",
    };
    if (idx === -1) rows.push(nowRow);
    else rows.splice(idx, 0, nowRow);
  }

  return {
    rows,
    note: null,
    summary:
      nowSecs !== null
        ? { kind: "now", seconds: nowSecs }
        : rebootAt !== null
          ? { kind: "reboot", seconds: rebootAt }
          : { kind: "last", seconds: lastAt },
  };
}

// -----------------------------------------------------------------------------
// Relative time
// -----------------------------------------------------------------------------

const DAY_SEC = 86_400;

/**
 * One relative-time formatter for the whole surface, so the hero's "last fix"
 * and the log's rows cannot drift apart. The shared `formatTimeAgo` in
 * types/modem-status.ts is English-only.
 */
export function useTimeAgo(): (epochSec: number) => string {
  const { t } = useTranslation("monitoring");
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      30_000,
    );
    return () => clearInterval(id);
  }, []);

  return useCallback(
    (epochSec: number) => {
      const diff = Math.max(0, nowSec - epochSec);
      if (diff < 60) return t("watchdog.activity.time.just_now");
      if (diff < 3600)
        return t("watchdog.activity.time.minutes", {
          count: Math.floor(diff / 60),
        });
      if (diff < DAY_SEC)
        return t("watchdog.activity.time.hours", {
          count: Math.floor(diff / 3600),
        });
      return t("watchdog.activity.time.days", {
        count: Math.floor(diff / DAY_SEC),
      });
    },
    [nowSec, t],
  );
}

// -----------------------------------------------------------------------------
// The grace gate
// -----------------------------------------------------------------------------

/**
 * Whether the grace window has elapsed, measured against the poll's own
 * `receivedAtMs` rather than a clock read during render — a `Date.now()` there
 * is what `react-hooks/purity` flags, and the rule bails per component.
 *
 * The anchor moves when the saved master switch flips, so enabling the
 * watchdog restarts the window instead of instantly declaring it silent.
 */
export function useGraceGate(
  receivedAtMs: number | null,
  settingsEnabled: boolean,
): boolean {
  const [anchor, setAnchor] = useState<number | null>(receivedAtMs);
  const [prevEnabled, setPrevEnabled] = useState(settingsEnabled);

  if (prevEnabled !== settingsEnabled) {
    setPrevEnabled(settingsEnabled);
    setAnchor(receivedAtMs);
  } else if (anchor === null && receivedAtMs !== null) {
    setAnchor(receivedAtMs);
  }

  return anchor !== null && receivedAtMs !== null
    ? receivedAtMs - anchor > GRACE_MS
    : false;
}
