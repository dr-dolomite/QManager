"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { PingProfile } from "@/types/modem-status";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/watchdog.sh";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WatchdogSettings {
  enabled: boolean;
  // Reachability: number of consecutive FAILED PROBES (raw streak_fail from the
  // ping daemon) before recovery. Renamed from the old `max_failures`, whose
  // unit was watchdog loop cycles — the daemon now reads the raw probe streak.
  fail_threshold: number;
  // Watchdog loop / quality-sampling cadence. No longer the reachability knob;
  // kept here as pass-through (not user-edited in the new UI).
  check_interval: number;
  cooldown: number;
  tier1_enabled: boolean;
  tier2_enabled: boolean;
  tier3_enabled: boolean;
  tier4_enabled: boolean;
  backup_sim_slot: number | null;
  max_reboots_per_hour: number;
  // Connection-quality RECOVERY (opt-in, default off). The thresholds it acts on
  // are the SHARED quality_thresholds owned by the Connection Quality page; the
  // watchdog owns only whether to recover (`quality_enabled`) and how sustained a
  // breach must be (`quality_consecutive`).
  quality_enabled: boolean;
  quality_consecutive: number;
  // SSR-aware hold: let a recoverable baseband restart self-heal before the
  // recovery ladder may act. Default on (the daemon defaults to 1/45 too).
  ssr_aware: boolean;
  ssr_grace: number;
  // Auto fail-back to the primary SIM after a Tier-3 failover. Because the
  // inactive SIM slot cannot be health-checked passively, this is a BLIND
  // periodic swap-back-and-retest — each attempt is a real outage — so it is
  // opt-in (default off). The interval is in MINUTES (5–1440). UCI:
  // quecmanager.watchcat.{primary_recheck_enabled,primary_recheck_interval}.
  primary_recheck_enabled: boolean;
  primary_recheck_interval: number;
  // Probe interval ownership. The Watchdog page mirrors the Connection Quality
  // sensitivity Select and can override the interval with a custom value. These
  // map to UCI `quecmanager.ping_profile.{profile,interval_override}`; the GET
  // returns them top-level, the hook folds them in here, and they ride the same
  // atomic save back out (CGI routes them to the ping_profile section).
  probe_profile: PingProfile;
  interval_override: number | null;
}

export type WatchdogSavePayload = WatchdogSettings & {
  action: "save_settings";
};

/**
 * Read-only resolved view of the SHARED quality thresholds, surfaced on the
 * Watchdog quality tab so the user can see what recovery acts on. Editing lives
 * on the Connection Quality page (single writer).
 */
export interface WatchdogQualityThresholds {
  latency_ms: number;
  loss_pct: number;
  latency_preset: string;
  loss_preset: string;
}

export interface WatchdogLiveStatus {
  timestamp: number;
  enabled: boolean;
  state: string;
  current_tier: number;
  failure_count: number;
  last_recovery_time: number | null;
  last_recovery_tier: number | null;
  total_recoveries: number;
  cooldown_remaining: number;
  sim_failover_active: boolean;
  original_sim_slot: number | null;
  current_sim_slot: number | null;
  reboots_this_hour: number;
  quality_breach_count?: number;
  quality_enabled?: boolean;
  last_recovery_reason?: string;
  // Optional (older daemons won't emit them): currently holding for a
  // self-healing baseband SSR, and the monotonic seconds when one was last seen.
  ssr_hold?: boolean;
  last_ssr_detected?: number | null;
}

export interface SimFailoverInfo {
  active: boolean;
  original_slot?: number;
  current_slot?: number;
  switched_at?: number;
}

export interface SimSwapInfo {
  detected: boolean;
  matching_profile_id?: string;
  matching_profile_name?: string;
  dismissed?: boolean;
}

export interface UseWatchdogSettingsReturn {
  settings: WatchdogSettings | null;
  /** Effective probe interval in seconds (override if set, else profile). */
  effectiveInterval: number | null;
  /** Read-only resolved view of the shared quality thresholds. */
  qualityThresholds: WatchdogQualityThresholds | null;
  status: WatchdogLiveStatus | null;
  simFailover: SimFailoverInfo | null;
  simSwap: SimSwapInfo | null;
  autoDisabled: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveSettings: (payload: WatchdogSavePayload) => Promise<boolean>;
  dismissSimSwap: () => Promise<boolean>;
  revertSim: () => Promise<boolean>;
  refresh: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useWatchdogSettings(): UseWatchdogSettingsReturn {
  const { t } = useTranslation("errors");
  const [settings, setSettings] = useState<WatchdogSettings | null>(null);
  const [effectiveInterval, setEffectiveInterval] = useState<number | null>(
    null,
  );
  const [qualityThresholds, setQualityThresholds] =
    useState<WatchdogQualityThresholds | null>(null);
  const [status, setStatus] = useState<WatchdogLiveStatus | null>(null);
  const [simFailover, setSimFailover] = useState<SimFailoverInfo | null>(null);
  const [simSwap, setSimSwap] = useState<SimSwapInfo | null>(null);
  const [autoDisabled, setAutoDisabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current settings + live status
  // ---------------------------------------------------------------------------
  const fetchSettings = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(resolveErrorMessage(t, json.error, undefined, "Failed to fetch watchdog settings"));
        return;
      }

      // Fold the top-level probe-interval fields into settings so the form and
      // the atomic save treat them as part of one settings object.
      setSettings({
        ...json.settings,
        probe_profile: json.probe_profile,
        interval_override: json.interval_override ?? null,
      });
      setEffectiveInterval(
        typeof json.effective_interval === "number"
          ? json.effective_interval
          : null,
      );
      setQualityThresholds(json.quality_thresholds ?? null);
      setStatus(json.status && json.status.timestamp ? json.status : null);
      setSimFailover(json.sim_failover || null);
      setSimSwap(json.sim_swap || null);
      setAutoDisabled(json.auto_disabled === true);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch watchdog settings"
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    fetchSettings();
    const id = setInterval(() => {
      fetchSettings(true);
    }, 30_000);
    return () => clearInterval(id);
  }, [fetchSettings]);

  // ---------------------------------------------------------------------------
  // Save settings
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(
    async (payload: WatchdogSavePayload): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          // watchdog CGI uses `reason` rather than `detail`
          setError(resolveErrorMessage(t, json.error, json.reason, "Failed to save watchdog settings"));
          return false;
        }

        // Silent re-fetch to sync state
        await fetchSettings(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to save settings"
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchSettings, t]
  );

  // ---------------------------------------------------------------------------
  // Dismiss SIM swap notification
  // ---------------------------------------------------------------------------
  const dismissSimSwap = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss_sim_swap" }),
      });

      if (!resp.ok) return false;

      const json = await resp.json();
      if (!mountedRef.current) return false;

      if (json.success) {
        setSimSwap((prev) =>
          prev ? { ...prev, detected: false, dismissed: true } : prev
        );
      }
      return json.success;
    } catch {
      return false;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Request SIM revert (watchcat picks up the flag)
  // ---------------------------------------------------------------------------
  const revertSim = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revert_sim" }),
      });

      if (!resp.ok) return false;

      const json = await resp.json();
      return json.success;
    } catch {
      return false;
    }
  }, []);

  return {
    settings,
    effectiveInterval,
    qualityThresholds,
    status,
    simFailover,
    simSwap,
    autoDisabled,
    isLoading,
    isSaving,
    error,
    saveSettings,
    dismissSimSwap,
    revertSim,
    refresh: fetchSettings,
  };
}
