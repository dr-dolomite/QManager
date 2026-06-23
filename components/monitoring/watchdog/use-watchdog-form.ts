"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSaveFlash } from "@/components/ui/save-button";
import { PING_PROFILES, type PingProfile } from "@/types/modem-status";
import type {
  WatchdogSettings,
  WatchdogSavePayload,
} from "@/hooks/use-watchdog-settings";

// -----------------------------------------------------------------------------
// useWatchdogForm — the single form-state coordinator for the watchdog page.
// -----------------------------------------------------------------------------
// The page splits the surface into grouped cards (Status, Recovery Triggers,
// Recovery Ladder), but the backend save is ATOMIC: one `save_settings` POST
// carrying every field. So one hook owns the whole form — every value, every
// validation rule, the dirty check, the submit, and the discard — and the cards
// each consume the slice they render.
//
// Probe interval: the Reachability tab mirrors the Connection Quality sensitivity
// Select (the 4 named profiles) plus a "Custom" escape hatch (1-60s). The named
// profile rides UCI `ping_profile.profile`; Custom rides `ping_profile.
// interval_override`. The watchdog is the single writer for the override, so the
// form models the choice as: a fallback `probeProfile` (always one of the 4
// names) + a `useCustomInterval` flag + the custom value.
//
// The consuming component is keyed on a signature of `settings` (see
// `watchdog.tsx`), so this hook remounts and re-seeds its `useState` defaults
// from fresh server values after every save / background refetch. That keeps the
// initial-value pattern honest without a setState-in-effect (forbidden by the
// project's React-Compiler lint rules).

// Probe interval per named profile, in seconds. Mirrors the ping daemon's
// profile→interval table (the daemon is the source of truth; this is only for
// previewing the effective interval before save).
export const PROFILE_INTERVAL_SEC: Record<PingProfile, number> = {
  sensitive: 1,
  regular: 2,
  relaxed: 5,
  quiet: 10,
};

export const CUSTOM_INTERVAL_MIN = 1;
export const CUSTOM_INTERVAL_MAX = 60;

export interface WatchdogFormErrors {
  failThreshold: string | null;
  customInterval: string | null;
  cooldown: string | null;
  maxReboots: string | null;
  backupSim: string | null;
  consecutive: string | null;
  ssrGrace: string | null;
  primaryRecheckInterval: string | null;
}

export interface WatchdogForm {
  // Master
  isEnabled: boolean;
  setIsEnabled: (v: boolean) => void;

  // Probe interval (mirrored sensitivity Select + Custom override)
  intervalChoice: string; // one of PING_PROFILES, or "custom"
  setIntervalChoice: (v: string) => void;
  customInterval: string;
  setCustomInterval: (v: string) => void;
  effectiveInterval: number | null; // resolved seconds, null when invalid
  estimatedDownSecs: number | null; // effectiveInterval × failThreshold

  // Reachability recovery policy
  failThreshold: string;
  setFailThreshold: (v: string) => void;
  cooldown: string;
  setCooldown: (v: string) => void;

  // Recovery ladder tiers
  tier1Enabled: boolean;
  setTier1Enabled: (v: boolean) => void;
  tier2Enabled: boolean;
  setTier2Enabled: (v: boolean) => void;
  tier3Enabled: boolean;
  setTier3Enabled: (v: boolean) => void;
  tier4Enabled: boolean;
  setTier4Enabled: (v: boolean) => void;
  backupSimSlot: string;
  setBackupSimSlot: (v: string) => void;
  maxRebootsPerHour: string;
  setMaxRebootsPerHour: (v: string) => void;

  // Auto fail-back to primary SIM (nested in Tier 3). Opt-in; interval in minutes.
  primaryRecheckEnabled: boolean;
  setPrimaryRecheckEnabled: (v: boolean) => void;
  primaryRecheckInterval: string;
  setPrimaryRecheckInterval: (v: string) => void;

  // Connection-quality recovery (acts on the shared thresholds)
  qualityEnabled: boolean;
  setQualityEnabled: (v: boolean) => void;
  qualityConsecutive: string;
  setQualityConsecutive: (v: string) => void;

  // SSR-aware hold (wait out a recoverable baseband restart before recovering)
  ssrAware: boolean;
  setSsrAware: (v: boolean) => void;
  ssrGrace: string;
  setSsrGrace: (v: string) => void;

  // Derived
  errors: WatchdogFormErrors;
  hasValidationErrors: boolean;
  isDirty: boolean;
  canSave: boolean;

  // Flow
  isSaving: boolean;
  saved: boolean;
  submit: () => Promise<void>;
  discard: () => void;
}

interface UseWatchdogFormArgs {
  settings: WatchdogSettings;
  isSaving: boolean;
  error: string | null;
  saveSettings: (payload: WatchdogSavePayload) => Promise<boolean>;
}

const isIntInRange = (raw: string, min: number, max: number) => {
  const n = Number(raw);
  return !(raw === "" || isNaN(n) || !Number.isInteger(n) || n < min || n > max);
};

const isValidProfile = (v: string): v is PingProfile =>
  (PING_PROFILES as readonly string[]).includes(v);

export function useWatchdogForm({
  settings,
  isSaving,
  error,
  saveSettings,
}: UseWatchdogFormArgs): WatchdogForm {
  const { t } = useTranslation("monitoring");
  const { saved, markSaved } = useSaveFlash();

  const [isEnabled, setIsEnabled] = useState(settings.enabled);

  // Probe interval — fallback named profile + custom-override flag/value.
  const seedProfile: PingProfile = isValidProfile(settings.probe_profile)
    ? settings.probe_profile
    : "relaxed";
  const [probeProfile, setProbeProfile] = useState<PingProfile>(seedProfile);
  const [useCustomInterval, setUseCustomInterval] = useState(
    settings.interval_override != null,
  );
  const [customInterval, setCustomInterval] = useState(
    settings.interval_override != null ? String(settings.interval_override) : "",
  );

  const [failThreshold, setFailThreshold] = useState(
    String(settings.fail_threshold),
  );
  // check_interval is no longer user-edited; carried verbatim so the atomic save
  // never resets it.
  const checkInterval = String(settings.check_interval);
  const [cooldown, setCooldown] = useState(String(settings.cooldown));
  const [tier1Enabled, setTier1Enabled] = useState(settings.tier1_enabled);
  const [tier2Enabled, setTier2Enabled] = useState(settings.tier2_enabled);
  const [tier3Enabled, setTier3Enabled] = useState(settings.tier3_enabled);
  const [tier4Enabled, setTier4Enabled] = useState(settings.tier4_enabled);
  const [backupSimSlot, setBackupSimSlot] = useState(
    settings.backup_sim_slot != null ? String(settings.backup_sim_slot) : "",
  );
  const [maxRebootsPerHour, setMaxRebootsPerHour] = useState(
    String(settings.max_reboots_per_hour),
  );
  const [qualityEnabled, setQualityEnabled] = useState(settings.quality_enabled);
  const [qualityConsecutive, setQualityConsecutive] = useState(
    String(settings.quality_consecutive),
  );
  const [ssrAware, setSsrAware] = useState(settings.ssr_aware);
  const [ssrGrace, setSsrGrace] = useState(String(settings.ssr_grace));
  const [primaryRecheckEnabled, setPrimaryRecheckEnabled] = useState(
    settings.primary_recheck_enabled,
  );
  const [primaryRecheckInterval, setPrimaryRecheckInterval] = useState(
    String(settings.primary_recheck_interval),
  );

  // --- Interval choice as one control value ---
  const intervalChoice = useCustomInterval ? "custom" : probeProfile;
  const setIntervalChoice = useCallback(
    (v: string) => {
      if (v === "custom") {
        setUseCustomInterval(true);
        // Seed the custom field from the current effective interval so the input
        // isn't blank when the user switches to Custom.
        setCustomInterval((prev) =>
          prev !== "" ? prev : String(PROFILE_INTERVAL_SEC[probeProfile]),
        );
      } else if (isValidProfile(v)) {
        setUseCustomInterval(false);
        setProbeProfile(v);
      }
    },
    [probeProfile],
  );

  // --- Derived interval values ---
  const effectiveInterval = useMemo<number | null>(() => {
    if (useCustomInterval) {
      return isIntInRange(customInterval, CUSTOM_INTERVAL_MIN, CUSTOM_INTERVAL_MAX)
        ? Number(customInterval)
        : null;
    }
    return PROFILE_INTERVAL_SEC[probeProfile];
  }, [useCustomInterval, customInterval, probeProfile]);

  const estimatedDownSecs = useMemo<number | null>(() => {
    if (effectiveInterval == null) return null;
    if (!isIntInRange(failThreshold, 1, 20)) return null;
    return effectiveInterval * Number(failThreshold);
  }, [effectiveInterval, failThreshold]);

  // --- Validation (mirrors the CGI field ranges) ---
  const errors = useMemo<WatchdogFormErrors>(() => {
    const failThresholdErr =
      failThreshold && !isIntInRange(failThreshold, 1, 20)
        ? t("watchdog.failure_threshold_error")
        : null;
    const customIntervalErr =
      useCustomInterval &&
      customInterval &&
      !isIntInRange(customInterval, CUSTOM_INTERVAL_MIN, CUSTOM_INTERVAL_MAX)
        ? t("watchdog.custom_interval_error")
        : null;
    const cooldownErr =
      cooldown && !isIntInRange(cooldown, 10, 300)
        ? t("watchdog.cooldown_error")
        : null;
    const maxRebootsErr =
      maxRebootsPerHour && !isIntInRange(maxRebootsPerHour, 1, 10)
        ? t("watchdog.max_reboots_error")
        : null;
    const backupSimErr =
      tier3Enabled && !backupSimSlot
        ? t("watchdog.backup_sim_required_error")
        : null;
    const consecutiveErr =
      qualityEnabled &&
      qualityConsecutive &&
      !isIntInRange(qualityConsecutive, 1, 60)
        ? t("watchdog.quality_consecutive_error")
        : null;
    const ssrGraceErr =
      ssrAware && ssrGrace && !isIntInRange(ssrGrace, 10, 120)
        ? t("watchdog.ssr_grace_error")
        : null;
    // Auto fail-back interval is only meaningful when the toggle is on. An empty
    // field while enabled is handled as a save-blocking "missing" below, not a
    // range error (mirrors the customInterval pattern).
    const primaryRecheckIntervalErr =
      primaryRecheckEnabled &&
      primaryRecheckInterval &&
      !isIntInRange(primaryRecheckInterval, 5, 1440)
        ? t("watchdog.primary_recheck_interval_error")
        : null;

    return {
      failThreshold: failThresholdErr,
      customInterval: customIntervalErr,
      cooldown: cooldownErr,
      maxReboots: maxRebootsErr,
      backupSim: backupSimErr,
      consecutive: consecutiveErr,
      ssrGrace: ssrGraceErr,
      primaryRecheckInterval: primaryRecheckIntervalErr,
    };
  }, [
    t,
    failThreshold,
    useCustomInterval,
    customInterval,
    cooldown,
    maxRebootsPerHour,
    tier3Enabled,
    backupSimSlot,
    qualityEnabled,
    qualityConsecutive,
    ssrAware,
    ssrGrace,
    primaryRecheckEnabled,
    primaryRecheckInterval,
  ]);

  const hasValidationErrors = useMemo(
    () => Object.values(errors).some(Boolean),
    [errors],
  );

  // An empty custom field while Custom is selected isn't a range error but still
  // can't be saved.
  const customIntervalMissing =
    useCustomInterval && customInterval.trim() === "";

  // Same rule for the auto fail-back interval: empty while the toggle is on
  // blocks the save without being a range error.
  const primaryRecheckIntervalMissing =
    primaryRecheckEnabled && primaryRecheckInterval.trim() === "";

  const isDirty = useMemo(
    () =>
      isEnabled !== settings.enabled ||
      probeProfile !== seedProfile ||
      useCustomInterval !== (settings.interval_override != null) ||
      customInterval !==
        (settings.interval_override != null
          ? String(settings.interval_override)
          : "") ||
      failThreshold !== String(settings.fail_threshold) ||
      cooldown !== String(settings.cooldown) ||
      tier1Enabled !== settings.tier1_enabled ||
      tier2Enabled !== settings.tier2_enabled ||
      tier3Enabled !== settings.tier3_enabled ||
      tier4Enabled !== settings.tier4_enabled ||
      backupSimSlot !==
        (settings.backup_sim_slot != null
          ? String(settings.backup_sim_slot)
          : "") ||
      maxRebootsPerHour !== String(settings.max_reboots_per_hour) ||
      qualityEnabled !== settings.quality_enabled ||
      qualityConsecutive !== String(settings.quality_consecutive) ||
      ssrAware !== settings.ssr_aware ||
      ssrGrace !== String(settings.ssr_grace) ||
      primaryRecheckEnabled !== settings.primary_recheck_enabled ||
      primaryRecheckInterval !== String(settings.primary_recheck_interval),
    [
      settings,
      seedProfile,
      isEnabled,
      probeProfile,
      useCustomInterval,
      customInterval,
      failThreshold,
      cooldown,
      tier1Enabled,
      tier2Enabled,
      tier3Enabled,
      tier4Enabled,
      backupSimSlot,
      maxRebootsPerHour,
      qualityEnabled,
      qualityConsecutive,
      ssrAware,
      ssrGrace,
      primaryRecheckEnabled,
      primaryRecheckInterval,
    ],
  );

  const canSave =
    !hasValidationErrors &&
    !customIntervalMissing &&
    !primaryRecheckIntervalMissing &&
    isDirty &&
    !isSaving;

  const submit = useCallback(async () => {
    if (
      hasValidationErrors ||
      customIntervalMissing ||
      primaryRecheckIntervalMissing ||
      !isDirty ||
      isSaving
    )
      return;

    const payload: WatchdogSavePayload = {
      action: "save_settings",
      enabled: isEnabled,
      fail_threshold: parseInt(failThreshold, 10),
      check_interval: parseInt(checkInterval, 10),
      cooldown: parseInt(cooldown, 10),
      tier1_enabled: tier1Enabled,
      tier2_enabled: tier2Enabled,
      tier3_enabled: tier3Enabled,
      tier4_enabled: tier4Enabled,
      backup_sim_slot: backupSimSlot ? parseInt(backupSimSlot, 10) : null,
      max_reboots_per_hour: parseInt(maxRebootsPerHour, 10),
      quality_enabled: qualityEnabled,
      quality_consecutive: parseInt(qualityConsecutive || "5", 10),
      ssr_aware: ssrAware,
      ssr_grace: parseInt(ssrGrace || "45", 10),
      primary_recheck_enabled: primaryRecheckEnabled,
      primary_recheck_interval: parseInt(primaryRecheckInterval || "30", 10),
      probe_profile: probeProfile,
      interval_override: useCustomInterval
        ? parseInt(customInterval, 10)
        : null,
    };

    const ok = await saveSettings(payload);
    if (ok) {
      markSaved();
      toast.success(t("watchdog.toast_save_success"));
    } else {
      toast.error(error || t("watchdog.toast_save_error"));
    }
  }, [
    hasValidationErrors,
    customIntervalMissing,
    primaryRecheckIntervalMissing,
    isDirty,
    isSaving,
    isEnabled,
    failThreshold,
    checkInterval,
    cooldown,
    tier1Enabled,
    tier2Enabled,
    tier3Enabled,
    tier4Enabled,
    backupSimSlot,
    maxRebootsPerHour,
    qualityEnabled,
    qualityConsecutive,
    ssrAware,
    ssrGrace,
    primaryRecheckEnabled,
    primaryRecheckInterval,
    probeProfile,
    useCustomInterval,
    customInterval,
    saveSettings,
    markSaved,
    error,
    t,
  ]);

  // Discard resets every field to the server-truth in `settings`.
  const discard = useCallback(() => {
    setIsEnabled(settings.enabled);
    setProbeProfile(seedProfile);
    setUseCustomInterval(settings.interval_override != null);
    setCustomInterval(
      settings.interval_override != null
        ? String(settings.interval_override)
        : "",
    );
    setFailThreshold(String(settings.fail_threshold));
    setCooldown(String(settings.cooldown));
    setTier1Enabled(settings.tier1_enabled);
    setTier2Enabled(settings.tier2_enabled);
    setTier3Enabled(settings.tier3_enabled);
    setTier4Enabled(settings.tier4_enabled);
    setBackupSimSlot(
      settings.backup_sim_slot != null ? String(settings.backup_sim_slot) : "",
    );
    setMaxRebootsPerHour(String(settings.max_reboots_per_hour));
    setQualityEnabled(settings.quality_enabled);
    setQualityConsecutive(String(settings.quality_consecutive));
    setSsrAware(settings.ssr_aware);
    setSsrGrace(String(settings.ssr_grace));
    setPrimaryRecheckEnabled(settings.primary_recheck_enabled);
    setPrimaryRecheckInterval(String(settings.primary_recheck_interval));
  }, [settings, seedProfile]);

  return {
    isEnabled,
    setIsEnabled,
    intervalChoice,
    setIntervalChoice,
    customInterval,
    setCustomInterval,
    effectiveInterval,
    estimatedDownSecs,
    failThreshold,
    setFailThreshold,
    cooldown,
    setCooldown,
    tier1Enabled,
    setTier1Enabled,
    tier2Enabled,
    setTier2Enabled,
    tier3Enabled,
    setTier3Enabled,
    tier4Enabled,
    setTier4Enabled,
    backupSimSlot,
    setBackupSimSlot,
    maxRebootsPerHour,
    setMaxRebootsPerHour,
    qualityEnabled,
    setQualityEnabled,
    qualityConsecutive,
    setQualityConsecutive,
    ssrAware,
    setSsrAware,
    ssrGrace,
    setSsrGrace,
    primaryRecheckEnabled,
    setPrimaryRecheckEnabled,
    primaryRecheckInterval,
    setPrimaryRecheckInterval,
    errors,
    hasValidationErrors,
    isDirty,
    canSave,
    isSaving,
    saved,
    submit,
    discard,
  };
}
