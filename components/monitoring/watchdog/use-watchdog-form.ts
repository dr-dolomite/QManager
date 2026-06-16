"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSaveFlash } from "@/components/ui/save-button";
import type {
  WatchdogSettings,
  WatchdogSavePayload,
} from "@/hooks/use-watchdog-settings";

// -----------------------------------------------------------------------------
// useWatchdogForm — the single form-state coordinator for the redesigned page.
// -----------------------------------------------------------------------------
// The old design kept all of this inside one giant settings card. The redesign
// splits the surface into four grouped cards (Status, Detection, Quality,
// Recovery Ladder), but the backend save is still ATOMIC: one `save_settings`
// POST carrying every field. So one hook owns the whole form — every value,
// every validation rule, the dirty check, the submit, and the discard — and the
// cards each consume the slice they render. A dirty-triggered save bar reads
// `isDirty` / `canSave` / `submit` from here.
//
// The consuming component is keyed on a signature of `settings` (see
// `watchdog.tsx`), so this hook remounts and re-seeds its `useState` defaults
// from fresh server values after every save / background refetch. That keeps the
// initial-value pattern honest without a setState-in-effect (forbidden by the
// project's React-Compiler lint rules).

export interface WatchdogFormErrors {
  maxFailures: string | null;
  cooldown: string | null;
  maxReboots: string | null;
  backupSim: string | null;
  latency: string | null;
  loss: string | null;
  consecutive: string | null;
  noCeiling: string | null;
  ssrGrace: string | null;
}

export interface WatchdogForm {
  // Master
  isEnabled: boolean;
  setIsEnabled: (v: boolean) => void;

  // Reachability detection
  maxFailures: string;
  setMaxFailures: (v: string) => void;
  checkInterval: string;
  setCheckInterval: (v: string) => void;
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

  // Connection-quality trigger
  qualityEnabled: boolean;
  setQualityEnabled: (v: boolean) => void;
  latencyCeiling: string;
  setLatencyCeiling: (v: string) => void;
  lossCeiling: string;
  setLossCeiling: (v: string) => void;
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

export function useWatchdogForm({
  settings,
  isSaving,
  error,
  saveSettings,
}: UseWatchdogFormArgs): WatchdogForm {
  const { t } = useTranslation("monitoring");
  const { saved, markSaved } = useSaveFlash();

  const [isEnabled, setIsEnabled] = useState(settings.enabled);
  const [maxFailures, setMaxFailures] = useState(String(settings.max_failures));
  const [checkInterval, setCheckInterval] = useState(
    String(settings.check_interval),
  );
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
  const [latencyCeiling, setLatencyCeiling] = useState(
    String(settings.latency_ceiling_ms),
  );
  const [lossCeiling, setLossCeiling] = useState(
    String(settings.loss_ceiling_pct),
  );
  const [qualityConsecutive, setQualityConsecutive] = useState(
    String(settings.quality_consecutive),
  );
  const [ssrAware, setSsrAware] = useState(settings.ssr_aware);
  const [ssrGrace, setSsrGrace] = useState(String(settings.ssr_grace));

  // --- Validation (mirrors the CGI field ranges in watchdog.sh) ---
  const errors = useMemo<WatchdogFormErrors>(() => {
    const maxFailuresErr =
      maxFailures && !isIntInRange(maxFailures, 1, 20)
        ? t("watchdog.failure_threshold_error")
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
    // Quality rules only apply while quality monitoring is on.
    const latencyErr =
      qualityEnabled && latencyCeiling && !isIntInRange(latencyCeiling, 0, 10000)
        ? t("watchdog.latency_ceiling_error")
        : null;
    const lossErr =
      qualityEnabled && lossCeiling && !isIntInRange(lossCeiling, 0, 100)
        ? t("watchdog.loss_ceiling_error")
        : null;
    const consecutiveErr =
      qualityEnabled &&
      qualityConsecutive &&
      !isIntInRange(qualityConsecutive, 1, 60)
        ? t("watchdog.quality_consecutive_error")
        : null;
    // With quality on, both ceilings at 0 means the trigger can never fire.
    const noCeilingErr =
      qualityEnabled &&
      Number(latencyCeiling) === 0 &&
      Number(lossCeiling) === 0
        ? t("watchdog.quality_no_ceiling_error")
        : null;
    // Grace window only matters while SSR-aware hold is on.
    const ssrGraceErr =
      ssrAware && ssrGrace && !isIntInRange(ssrGrace, 10, 120)
        ? t("watchdog.ssr_grace_error")
        : null;

    return {
      maxFailures: maxFailuresErr,
      cooldown: cooldownErr,
      maxReboots: maxRebootsErr,
      backupSim: backupSimErr,
      latency: latencyErr,
      loss: lossErr,
      consecutive: consecutiveErr,
      noCeiling: noCeilingErr,
      ssrGrace: ssrGraceErr,
    };
  }, [
    t,
    maxFailures,
    cooldown,
    maxRebootsPerHour,
    tier3Enabled,
    backupSimSlot,
    qualityEnabled,
    latencyCeiling,
    lossCeiling,
    qualityConsecutive,
    ssrAware,
    ssrGrace,
  ]);

  const hasValidationErrors = useMemo(
    () => Object.values(errors).some(Boolean),
    [errors],
  );

  const isDirty = useMemo(
    () =>
      isEnabled !== settings.enabled ||
      maxFailures !== String(settings.max_failures) ||
      checkInterval !== String(settings.check_interval) ||
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
      latencyCeiling !== String(settings.latency_ceiling_ms) ||
      lossCeiling !== String(settings.loss_ceiling_pct) ||
      qualityConsecutive !== String(settings.quality_consecutive) ||
      ssrAware !== settings.ssr_aware ||
      ssrGrace !== String(settings.ssr_grace),
    [
      settings,
      isEnabled,
      maxFailures,
      checkInterval,
      cooldown,
      tier1Enabled,
      tier2Enabled,
      tier3Enabled,
      tier4Enabled,
      backupSimSlot,
      maxRebootsPerHour,
      qualityEnabled,
      latencyCeiling,
      lossCeiling,
      qualityConsecutive,
      ssrAware,
      ssrGrace,
    ],
  );

  const canSave = !hasValidationErrors && isDirty && !isSaving;

  const submit = useCallback(async () => {
    if (hasValidationErrors || !isDirty || isSaving) return;

    const payload: WatchdogSavePayload = {
      action: "save_settings",
      enabled: isEnabled,
      max_failures: parseInt(maxFailures, 10),
      check_interval: parseInt(checkInterval, 10),
      cooldown: parseInt(cooldown, 10),
      tier1_enabled: tier1Enabled,
      tier2_enabled: tier2Enabled,
      tier3_enabled: tier3Enabled,
      tier4_enabled: tier4Enabled,
      backup_sim_slot: backupSimSlot ? parseInt(backupSimSlot, 10) : null,
      max_reboots_per_hour: parseInt(maxRebootsPerHour, 10),
      quality_enabled: qualityEnabled,
      latency_ceiling_ms: parseInt(latencyCeiling || "0", 10),
      loss_ceiling_pct: parseInt(lossCeiling || "0", 10),
      quality_consecutive: parseInt(qualityConsecutive || "5", 10),
      ssr_aware: ssrAware,
      ssr_grace: parseInt(ssrGrace || "45", 10),
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
    isDirty,
    isSaving,
    isEnabled,
    maxFailures,
    checkInterval,
    cooldown,
    tier1Enabled,
    tier2Enabled,
    tier3Enabled,
    tier4Enabled,
    backupSimSlot,
    maxRebootsPerHour,
    qualityEnabled,
    latencyCeiling,
    lossCeiling,
    qualityConsecutive,
    ssrAware,
    ssrGrace,
    saveSettings,
    markSaved,
    error,
    t,
  ]);

  // Discard resets every field to the server-truth in `settings`.
  const discard = useCallback(() => {
    setIsEnabled(settings.enabled);
    setMaxFailures(String(settings.max_failures));
    setCheckInterval(String(settings.check_interval));
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
    setLatencyCeiling(String(settings.latency_ceiling_ms));
    setLossCeiling(String(settings.loss_ceiling_pct));
    setQualityConsecutive(String(settings.quality_consecutive));
    setSsrAware(settings.ssr_aware);
    setSsrGrace(String(settings.ssr_grace));
  }, [settings]);

  return {
    isEnabled,
    setIsEnabled,
    maxFailures,
    setMaxFailures,
    checkInterval,
    setCheckInterval,
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
    latencyCeiling,
    setLatencyCeiling,
    lossCeiling,
    setLossCeiling,
    qualityConsecutive,
    setQualityConsecutive,
    ssrAware,
    setSsrAware,
    ssrGrace,
    setSsrGrace,
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
