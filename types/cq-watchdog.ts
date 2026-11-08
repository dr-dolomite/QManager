/**
 * Connection Quality × Watchdog wire types and hook contracts.
 *
 * Mirrors the frozen contracts `docs/plans/2026-11-07-cq-watchdog-contracts.md`
 * §5 (GET/POST of `monitoring/connection_quality.sh` and
 * `monitoring/watchdog.sh`), §3 (the watchdog status object), §9 Amendment 1
 * and Amendment 3. The frontend keeps NO mirror of the sensitivity or preset
 * tables: they arrive in the CQ GET (`tables`).
 */

// ─── Shared ─────────────────────────────────────────────────────────────────

export const SENSITIVITIES = ["sensitive", "regular", "relaxed", "quiet"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const QUALITY_PRESETS = ["standard", "tolerant", "very-tolerant", "custom"] as const;
export type QualityPreset = (typeof QUALITY_PRESETS)[number];
export type NamedQualityPreset = Exclude<QualityPreset, "custom">;

/** Why a recovery episode, hold-off or success happened (Amendment 3 adds carrier). */
export type RecoveryReason = "outage" | "quality" | "carrier";

/**
 * Outcome of a POST, RETURNED (not only stored) so a handler toasts from the
 * call's own result, never from hook state read after `await`.
 */
export interface CqWdMutationResult {
  ok: boolean;
  /** Already-translated reason (via `resolveErrorMessage`), or null on success. */
  message: string | null;
  /** Backend error code (`invalid_field`, `save_failed`, …), or null. */
  code: string | null;
  /** The rejected request key (`targets[2]`, `latency.custom_ms`, `tier3_enabled`, …), or null. */
  field: string | null;
}

// ─── Connection Quality GET (§5.1 + Amendment 1 A + A3.1) ───────────────────

export interface SensitivityRow {
  interval_sec: number;
  fail_secs: number;
  recover_secs: number;
  window_sec: number;
  quality_debounce_sec: number;
  quality_debounce_vt_sec: number;
}

export interface CqTables {
  sensitivity: Record<Sensitivity, SensitivityRow>;
  presets: {
    latency: Record<NamedQualityPreset, number>;
    loss: Record<NamedQualityPreset, number>;
    custom_range: { latency_ms: [number, number]; loss_pct: [number, number] };
  };
}

export interface CqSettings {
  sensitivity: Sensitivity;
  /** Exactly 4 slots: slot 1 alone, slots 2-4 in parallel when slot 1 misses. */
  targets: [string, string, string, string];
  latency: { preset: QualityPreset; custom_ms: number | null };
  loss: { preset: QualityPreset; custom_pct: number | null };
}

export interface CqCadence {
  interval_sec: number;
  fail_secs: number;
  recover_secs: number;
  window_sec: number;
}

/**
 * ok = answered this cycle (rtt_ms set); miss = probed, no answer;
 * skipped = no route for its address family; standby = not probed because a
 * lower slot answered. Stale or missing cache: every slot standby.
 */
export type SlotState = "ok" | "miss" | "skipped" | "standby";
export interface SlotLive {
  state: SlotState;
  rtt_ms: number | null;
}

export interface CqLive {
  /** null = probe cache stale or missing (unknown, never "down"). */
  reachable: boolean | null;
  /** Answering slot 1-4, 0 = none. */
  last_leg: number;
  slots: [SlotLive, SlotLive, SlotLive, SlotLive];
}

/** The last cleared outage this boot (debounced edges, so "about"). */
export interface CqLastOutage {
  duration_s: number;
  ended_ago_s: number;
  /** null = unknown whether the WAN IP changed. */
  wan_changed: boolean | null;
}

export interface CqGetResponse {
  success: true;
  settings: CqSettings;
  cadence: CqCadence;
  tables: CqTables;
  /** No threshold preset has ever been saved. */
  is_default: boolean;
  live: CqLive;
  /** null until an outage clears this boot. */
  last_outage: CqLastOutage | null;
}

// ─── Connection Quality POST (§5.2) ─────────────────────────────────────────

export interface SaveProbeBody {
  action: "save_probe";
  sensitivity: Sensitivity;
  targets: [string, string, string, string];
}

export interface SaveThresholdsBody {
  action: "save_thresholds";
  /** custom_ms required when preset is custom; ignored (stored value kept) otherwise. */
  latency: { preset: QualityPreset; custom_ms?: number };
  loss: { preset: QualityPreset; custom_pct?: number };
}

export interface UseConnectionQualityReturn {
  /** Last good GET; null until the first lands. */
  data: CqGetResponse | null;
  isLoading: boolean;
  /** Translated reason when the last GET failed, else null. */
  error: string | null;
  isSaving: boolean;
  saveProbe: (body: Omit<SaveProbeBody, "action">) => Promise<CqWdMutationResult>;
  saveThresholds: (body: Omit<SaveThresholdsBody, "action">) => Promise<CqWdMutationResult>;
  /** Re-GET. Never pass it an event: `onClick={() => refresh()}`. */
  refresh: () => Promise<void>;
}

// ─── Watchdog GET (§5.3 + §3 + Amendment 1 C + A3) ──────────────────────────

export interface WatchdogSettingsV2 {
  enabled: boolean;
  act_after_sec: number; // 15-600
  step_wait_sec: number; // 10-300
  tier1_enabled: boolean;
  tier2_enabled: boolean;
  tier3_enabled: boolean;
  tier4_enabled: boolean;
  backup_sim_slot: 1 | 2 | null;
  max_reboots_per_hour: number; // 1-10
  quality_enabled: boolean;
  quality_after_sec: number; // 30-1800
  ssr_aware: boolean;
  ssr_grace_sec: number; // 10-120
  failback_enabled: boolean;
  failback_every_min: number; // 5-1440
  carrier_enabled: boolean; // A3.3, default false
  carrier_after_min: number; // A3.3, 5-240, default 15
}

export const WATCHDOG_RANGES = {
  act_after_sec: [15, 600],
  step_wait_sec: [10, 300],
  max_reboots_per_hour: [1, 10],
  quality_after_sec: [30, 1800],
  ssr_grace_sec: [10, 120],
  failback_every_min: [5, 1440],
  carrier_after_min: [5, 240],
} as const satisfies Partial<Record<keyof WatchdogSettingsV2, readonly [number, number]>>;

export interface WatchdogEffective {
  /** max(act_after_sec, fail_secs of the stored sensitivity) */
  act_after_sec: number;
  /** max(step_wait_sec, recover_secs + 20): the OUTAGE value */
  step_wait_sec: number;
  /** CQ limits raised to floors max(latency, 50) ms, max(loss, 10) % */
  quality_limits: { latency_ms: number; loss_pct: number };
  carrier_enabled: boolean;
  carrier_after_min: number;
}

export type WatchdogDaemonState =
  | "monitor"
  | "suspect"
  | "ssr_hold"
  | "recovery"
  | "cooldown"
  | "holdoff"
  | "radio_off"
  | "locked"
  | "disabled";

/**
 * §3 state object. Every `*_until` / `*_at` / `last_ssr_mono` is a MONO
 * deadline (device uptime seconds): remaining = deadline − `mono`, minus the
 * seconds elapsed since the GET landed. Epoch fields (`*_time`) are wall clock
 * and may be null while the device clock is insane (1970 rule).
 */
export interface WatchdogStatus {
  timestamp: number;
  state: WatchdogDaemonState;
  enabled: boolean;
  current_tier: number; // 0-4
  recovery_reason: RecoveryReason | null;
  last_recovery_time: number | null;
  last_recovery_tier: number | null;
  last_recovery_reason: RecoveryReason | null;
  /** In memory: "since last restart". */
  total_recoveries: number;
  /** A3.2, in memory. Tier 4 and natural recoveries never set these. */
  last_success_time: number | null;
  last_success_tier: number | null;
  last_success_reason: RecoveryReason | null;
  last_success_took_s: number | null;
  failure_count: number;
  failure_secs: number;
  cooldown_remaining: number;
  step_wait_until: number | null;
  holdoff_until: number | null;
  holdoff_reason: RecoveryReason | null;
  holdoff_carrier_level: number; // 0-2: 15 → 30 → 60 min
  reboots_this_hour: number;
  reboot_budget_exhausted: boolean;
  reboot_rest_reason: "hourly" | "long_outage" | null;
  ssr_hold: boolean;
  ssr_hold_until: number | null;
  last_ssr_mono: number | null;
  quality_breach_secs: number;
  /** A3.3: seconds of the current single-carrier run, 0 when none. */
  carrier_single_secs: number;
  /** A3.3: last component-carrier count; null when unknown or the trigger is off. */
  carrier_cc: number | null;
  failback_active: boolean;
  failback_failures: number; // 0-3; 3 = gave up
  failback_next_at: number | null;
  sim_failover_active: boolean;
  original_sim_slot: number | null;
  current_sim_slot: number | null;
  /** Ping cache stale for more than 5 min. */
  ping_stale: boolean;
  mono: number;
  stale_after: number;
  // Amendment 1 C
  offline_secs: number;
  reboot_limit: number;
  reboot_rest_until: number | null;
  holdoff_quality_level: number; // 0-2
  /** Tiers run in the current episode, in order; [] when idle. */
  tiers_tried: number[];
}

export interface WatchdogFailoverRecord {
  active: boolean;
  original_slot?: number | null;
  current_slot?: number | null;
  switched_at?: number | null;
  reason?: RecoveryReason | string | null;
  confirmed?: boolean;
  revert_pending?: boolean;
}

export interface WatchdogGetResponse {
  success: true;
  settings: WatchdogSettingsV2;
  effective: WatchdogEffective;
  /** null when the daemon has not written a state file (the CGI sends `{}`). */
  status: WatchdogStatus | null;
  sim_failover: WatchdogFailoverRecord;
  /** ≤ 5 epochs of the watchdog's own reboots, newest first. */
  recent_reboots: number[];
  sim_dual_capable: boolean;
  /** A pre-upgrade auto-disable flag is still present. */
  auto_disabled: boolean;
}

// ─── Watchdog POST (§5.4 + Amendment 1 B) ───────────────────────────────────

/** Any subset of settings; an absent key is untouched; backup_sim_slot null clears. */
export type WatchdogSettingsPatch = Partial<WatchdogSettingsV2>;

export interface UseWatchdogReturn {
  /** Last good GET; null until the first lands. Polled every 5 s while visible. */
  data: WatchdogGetResponse | null;
  /**
   * `settings` keeps object identity across polls while the values are
   * unchanged, so forms seeded from it don't reset mid-edit.
   */
  settings: WatchdogSettingsV2 | null;
  /** performance.now() ms when `data` landed: to count mono deadlines down between polls. */
  receivedAt: number | null;
  isLoading: boolean;
  /** Translated reason when the last GET failed, else null. */
  error: string | null;
  isSaving: boolean;
  saveSettings: (patch: WatchdogSettingsPatch) => Promise<CqWdMutationResult>;
  revertSim: () => Promise<CqWdMutationResult>;
  retryFailback: () => Promise<CqWdMutationResult>;
  refresh: () => Promise<void>;
}
