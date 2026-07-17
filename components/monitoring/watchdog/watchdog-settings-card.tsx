"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "motion/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ActivityIcon,
  ArrowUpRightIcon,
  CheckIcon,
  PowerIcon,
  RadioIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "lucide-react";
import { TbInfoCircleFilled } from "react-icons/tb";
import { cn } from "@/lib/utils";
import { PING_PROFILES } from "@/types/modem-status";
import type { WatchdogQualityThresholds } from "@/hooks/use-watchdog-settings";
import { PROFILE_INTERVAL_SEC, type WatchdogForm } from "./use-watchdog-form";

const QUALITY_SETTINGS_HREF = "/system-settings/connection-quality";

type SettingsTab = "detection" | "quality" | "recovery";

// -----------------------------------------------------------------------------
// Watchdog settings — one card, three tabs (Detection / Quality / Recovery),
// one atomic Save. Because the backend save carries every field in a single
// POST, the sticky save bar at the card foot commits the whole form, not just
// the visible tab. Each tab label carries a destructive error dot when a field
// on it is invalid; a blocked Save jumps to the first offending tab and focuses
// the field.
// -----------------------------------------------------------------------------
export function WatchdogSettingsCard({
  form,
  qualityThresholds,
}: {
  form: WatchdogForm;
  qualityThresholds: WatchdogQualityThresholds | null;
}) {
  const { t } = useTranslation("monitoring");
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<SettingsTab>("detection");
  const masterOff = !form.isEnabled;

  // Empty-while-required blockers the hook folds into canSave but doesn't expose
  // as named errors — recomputed here so the tab dots + jump logic see them.
  const customIntervalMissing =
    form.intervalChoice === "custom" && form.customInterval.trim() === "";
  const primaryRecheckIntervalMissing =
    form.primaryRecheckEnabled && form.primaryRecheckInterval.trim() === "";

  const e = form.errors;
  const tabErrors: Record<SettingsTab, boolean> = {
    detection:
      !!e.failThreshold ||
      !!e.customInterval ||
      !!e.cooldown ||
      customIntervalMissing,
    quality: !!e.consecutive,
    recovery:
      !!e.ssrGrace ||
      !!e.backupSim ||
      !!e.primaryRecheckInterval ||
      !!e.maxReboots ||
      primaryRecheckIntervalMissing,
  };

  const blocked =
    form.hasValidationErrors ||
    customIntervalMissing ||
    primaryRecheckIntervalMissing;

  // --- Focus-first-invalid on a blocked save --------------------------------
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const registerField = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      fieldRefs.current[id] = el;
    },
    [],
  );
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(
    null,
  );
  // Focus runs after the tab switch has mounted the target field. This is a DOM
  // side effect (focus/scroll), never a setState-in-effect.
  useEffect(() => {
    if (!focusReq) return;
    const raf = requestAnimationFrame(() => {
      const el = fieldRefs.current[focusReq.id];
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({
          block: "center",
          behavior: reduceMotion ? "auto" : "smooth",
        });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [focusReq, reduceMotion]);

  const orderedErrors: { tab: SettingsTab; id: string; present: boolean }[] = [
    {
      tab: "detection",
      id: "custom-interval",
      present: !!e.customInterval || customIntervalMissing,
    },
    { tab: "detection", id: "fail-threshold", present: !!e.failThreshold },
    { tab: "detection", id: "cooldown", present: !!e.cooldown },
    { tab: "quality", id: "quality-consecutive", present: !!e.consecutive },
    { tab: "recovery", id: "ssr-grace", present: !!e.ssrGrace },
    { tab: "recovery", id: "backup-sim-slot", present: !!e.backupSim },
    {
      tab: "recovery",
      id: "primary-recheck-interval",
      present: !!e.primaryRecheckInterval || primaryRecheckIntervalMissing,
    },
    { tab: "recovery", id: "max-reboots", present: !!e.maxReboots },
  ];

  const handleSave = () => {
    if (blocked) {
      const first = orderedErrors.find((f) => f.present);
      if (first) {
        setTab(first.tab);
        setFocusReq((prev) => ({ id: first.id, n: (prev?.n ?? 0) + 1 }));
      }
      return;
    }
    void form.submit();
  };

  const isCustom = form.intervalChoice === "custom";
  const qualityOn = form.qualityEnabled;

  // Human-readable list of the tabs that currently hold an error.
  const erroredTabNames = (["detection", "quality", "recovery"] as const)
    .filter((tk) => tabErrors[tk])
    .map((tk) => t(`watchdog.tab_${tk}`));

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("watchdog.settings_title")}</CardTitle>
        <CardDescription>{t("watchdog.settings_description")}</CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as SettingsTab)}
          className="min-h-0 flex-1"
        >
          <TabsList className="w-full">
            {(["detection", "quality", "recovery"] as const).map((tk) => (
              <TabsTrigger key={tk} value={tk} className="gap-1.5">
                {t(`watchdog.tab_${tk}`)}
                {tabErrors[tk] && (
                  <span
                    aria-label={t("watchdog.tab_has_errors_aria")}
                    className="bg-destructive size-1.5 rounded-full"
                  />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ================= DETECTION ================= */}
          <TabsContent
            value="detection"
            className="mt-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          >
            <FieldSet>
              <FieldGroup>
                <div className="grid grid-cols-1 gap-4 @sm/card:grid-cols-2">
                  {/* Probe interval */}
                  <Field>
                    <div className="flex items-center gap-1.5">
                      <FieldLabel htmlFor="probe-interval" className="m-0">
                        {t("watchdog.probe_interval_label")}
                      </FieldLabel>
                      <InfoTip
                        text={t("watchdog.probe_interval_tooltip")}
                        aria={t("watchdog.probe_interval_more_info_aria")}
                      />
                    </div>
                    <Select
                      value={form.intervalChoice}
                      onValueChange={form.setIntervalChoice}
                      disabled={masterOff}
                    >
                      <SelectTrigger id="probe-interval">
                        <SelectValue
                          placeholder={t("watchdog.probe_interval_label")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {PING_PROFILES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {t(`watchdog.profile_${p}`)} ({PROFILE_INTERVAL_SEC[p]}
                            s)
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">
                          {t("watchdog.probe_interval_custom")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {!isCustom && form.effectiveInterval != null ? (
                      <FieldDescription>
                        {t("watchdog.probe_interval_effective", {
                          secs: form.effectiveInterval,
                        })}
                      </FieldDescription>
                    ) : (
                      <FieldDescription>
                        {t("watchdog.probe_interval_description")}
                      </FieldDescription>
                    )}
                  </Field>

                  {/* Fail threshold */}
                  <Field>
                    <FieldLabel htmlFor="fail-threshold">
                      {t("watchdog.failure_threshold_label")}
                    </FieldLabel>
                    <Input
                      ref={registerField("fail-threshold")}
                      id="fail-threshold"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="20"
                      placeholder={t("watchdog.failure_threshold_placeholder")}
                      className="tabular-nums"
                      value={form.failThreshold}
                      onChange={(ev) => form.setFailThreshold(ev.target.value)}
                      disabled={masterOff}
                      aria-invalid={!!e.failThreshold}
                      aria-describedby={
                        e.failThreshold
                          ? "fail-threshold-error"
                          : "fail-threshold-desc"
                      }
                    />
                    {e.failThreshold ? (
                      <FieldError id="fail-threshold-error">
                        {e.failThreshold}
                      </FieldError>
                    ) : (
                      <FieldDescription id="fail-threshold-desc">
                        {t("watchdog.failure_threshold_description")}
                      </FieldDescription>
                    )}
                  </Field>
                </div>

                {/* Custom interval — revealed in an inset panel. */}
                {isCustom && (
                  <div className="animate-in fade-in-0 slide-in-from-top-1 rounded-lg border bg-muted/20 p-4 duration-200 motion-reduce:animate-none">
                    <Field className="@sm/card:max-w-[18rem]">
                      <FieldLabel htmlFor="custom-interval">
                        {t("watchdog.custom_interval_label")}
                      </FieldLabel>
                      <Input
                        ref={registerField("custom-interval")}
                        id="custom-interval"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max="60"
                        placeholder={t("watchdog.custom_interval_placeholder")}
                        className="tabular-nums"
                        value={form.customInterval}
                        onChange={(ev) => form.setCustomInterval(ev.target.value)}
                        disabled={masterOff}
                        aria-invalid={!!e.customInterval}
                        aria-describedby={
                          e.customInterval
                            ? "custom-interval-error"
                            : "custom-interval-desc"
                        }
                      />
                      {e.customInterval ? (
                        <FieldError id="custom-interval-error">
                          {e.customInterval}
                        </FieldError>
                      ) : (
                        <FieldDescription id="custom-interval-desc">
                          {t("watchdog.custom_interval_description")}
                        </FieldDescription>
                      )}
                    </Field>
                  </div>
                )}

                {/* Cooldown */}
                <Field className="@sm/card:max-w-[18rem]">
                  <FieldLabel htmlFor="cooldown">
                    {t("watchdog.cooldown_label")}
                  </FieldLabel>
                  <Input
                    ref={registerField("cooldown")}
                    id="cooldown"
                    type="number"
                    inputMode="numeric"
                    min="10"
                    max="300"
                    placeholder={t("watchdog.cooldown_placeholder")}
                    className="tabular-nums"
                    value={form.cooldown}
                    onChange={(ev) => form.setCooldown(ev.target.value)}
                    disabled={masterOff}
                    aria-invalid={!!e.cooldown}
                    aria-describedby={
                      e.cooldown ? "cooldown-error" : "cooldown-desc"
                    }
                  />
                  {e.cooldown ? (
                    <FieldError id="cooldown-error">{e.cooldown}</FieldError>
                  ) : (
                    <FieldDescription id="cooldown-desc">
                      {t("watchdog.cooldown_description")}
                    </FieldDescription>
                  )}
                </Field>

                {/* Live "declares down after ~Ns" derivation. */}
                <div className="bg-muted/30 text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <ActivityIcon className="text-foreground/70 size-4 shrink-0" />
                  {form.estimatedDownSecs != null ? (
                    <span>
                      {t("watchdog.declares_down_preview", {
                        secs: form.estimatedDownSecs,
                      })}
                    </span>
                  ) : (
                    <span>{t("watchdog.declares_down_unknown")}</span>
                  )}
                </div>
              </FieldGroup>
            </FieldSet>
          </TabsContent>

          {/* ================= QUALITY ================= */}
          <TabsContent
            value="quality"
            className="mt-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          >
            <FieldSet>
              <FieldGroup>
                {/* State-tinted opt-in row. */}
                <div
                  className={cn(
                    "rounded-lg border p-4 transition-colors duration-300 motion-reduce:transition-none",
                    qualityOn
                      ? "border-primary/30 bg-primary/5"
                      : "bg-muted/20",
                  )}
                >
                  <Field orientation="horizontal" className="justify-between">
                    <div className="grid min-w-0 gap-1">
                      <div className="flex items-center gap-1.5">
                        <FieldLabel htmlFor="quality-enabled" className="m-0">
                          {t("watchdog.quality_enable_label")}
                        </FieldLabel>
                        <InfoTip
                          text={t("watchdog.quality_tooltip")}
                          aria={t("watchdog.quality_more_info_aria")}
                        />
                      </div>
                      <FieldDescription>
                        {qualityOn
                          ? t("watchdog.quality_on_hint")
                          : t("watchdog.quality_off_hint")}
                      </FieldDescription>
                    </div>
                    <Switch
                      id="quality-enabled"
                      checked={qualityOn}
                      onCheckedChange={form.setQualityEnabled}
                      disabled={masterOff}
                      aria-label={t("watchdog.quality_enable_label")}
                    />
                  </Field>
                </div>

                {qualityOn && (
                  <div className="animate-in fade-in-0 slide-in-from-top-1 grid gap-4 duration-300 motion-reduce:animate-none">
                    {/* Read-only view of the SHARED thresholds recovery acts on. */}
                    <div className="bg-muted/20 grid gap-2.5 rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {t("watchdog.quality_thresholds_readonly_title")}
                        </span>
                        <Link
                          href={QUALITY_SETTINGS_HREF}
                          className="text-primary inline-flex items-center gap-0.5 text-xs font-medium hover:underline"
                        >
                          {t("watchdog.quality_thresholds_link")}
                          <ArrowUpRightIcon className="size-3" />
                        </Link>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="grid gap-0.5">
                          <span className="text-muted-foreground text-xs">
                            {t("watchdog.quality_latency_readonly_label")}
                          </span>
                          <span className="text-sm font-semibold tabular-nums">
                            {qualityThresholds
                              ? `${qualityThresholds.latency_ms} ms`
                              : "—"}
                          </span>
                        </div>
                        <div className="grid gap-0.5">
                          <span className="text-muted-foreground text-xs">
                            {t("watchdog.quality_loss_readonly_label")}
                          </span>
                          <span className="text-sm font-semibold tabular-nums">
                            {qualityThresholds
                              ? `${qualityThresholds.loss_pct} %`
                              : "—"}
                          </span>
                        </div>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {t("watchdog.quality_thresholds_shared_note")}
                      </p>
                    </div>

                    <Field className="@sm/card:max-w-[18rem]">
                      <FieldLabel htmlFor="quality-consecutive">
                        {t("watchdog.quality_consecutive_label")}
                      </FieldLabel>
                      <Input
                        ref={registerField("quality-consecutive")}
                        id="quality-consecutive"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max="60"
                        placeholder={t("watchdog.quality_consecutive_placeholder")}
                        className="tabular-nums"
                        value={form.qualityConsecutive}
                        onChange={(ev) =>
                          form.setQualityConsecutive(ev.target.value)
                        }
                        disabled={masterOff}
                        aria-invalid={!!e.consecutive}
                        aria-describedby={
                          e.consecutive
                            ? "quality-consecutive-error"
                            : "quality-consecutive-desc"
                        }
                      />
                      {e.consecutive ? (
                        <FieldError id="quality-consecutive-error">
                          {e.consecutive}
                        </FieldError>
                      ) : (
                        <FieldDescription id="quality-consecutive-desc">
                          {t("watchdog.quality_consecutive_description")}
                        </FieldDescription>
                      )}
                    </Field>
                  </div>
                )}
              </FieldGroup>
            </FieldSet>
          </TabsContent>

          {/* ================= RECOVERY ================= */}
          <TabsContent
            value="recovery"
            className="mt-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          >
            {/* Step zero — wait out a recoverable baseband restart before the
                ladder may act. A precondition, not a rung. */}
            <div className="mb-6 rounded-lg border bg-muted/20 p-4">
              <Field orientation="horizontal" className="justify-between">
                <div className="grid min-w-0 gap-1">
                  <div className="flex items-center gap-1.5">
                    <FieldLabel htmlFor="ssr-aware" className="m-0">
                      {t("watchdog.ssr_aware_label")}
                    </FieldLabel>
                    <InfoTip
                      text={t("watchdog.ssr_aware_tooltip")}
                      aria={t("watchdog.ssr_aware_more_info_aria")}
                    />
                  </div>
                  <FieldDescription>
                    {t("watchdog.ssr_aware_description")}
                  </FieldDescription>
                </div>
                <Switch
                  id="ssr-aware"
                  checked={form.ssrAware}
                  onCheckedChange={form.setSsrAware}
                  disabled={masterOff}
                  aria-label={t("watchdog.ssr_aware_label")}
                />
              </Field>

              {form.ssrAware && (
                <div className="animate-in fade-in-0 slide-in-from-top-1 mt-3 duration-300 motion-reduce:animate-none">
                  <Field className="@sm/card:max-w-[18rem]">
                    <FieldLabel htmlFor="ssr-grace">
                      {t("watchdog.ssr_grace_label")}
                    </FieldLabel>
                    <Input
                      ref={registerField("ssr-grace")}
                      id="ssr-grace"
                      type="number"
                      inputMode="numeric"
                      min="10"
                      max="120"
                      placeholder={t("watchdog.ssr_grace_placeholder")}
                      className="tabular-nums"
                      value={form.ssrGrace}
                      onChange={(ev) => form.setSsrGrace(ev.target.value)}
                      disabled={masterOff}
                      aria-invalid={!!e.ssrGrace}
                      aria-describedby={
                        e.ssrGrace ? "ssr-grace-error" : "ssr-grace-desc"
                      }
                    />
                    {e.ssrGrace ? (
                      <FieldError id="ssr-grace-error">{e.ssrGrace}</FieldError>
                    ) : (
                      <FieldDescription id="ssr-grace-desc">
                        {t("watchdog.ssr_grace_description")}
                      </FieldDescription>
                    )}
                  </Field>
                </div>
              )}
            </div>

            <ol>
              {/* Tier 1 — Network re-registration */}
              <LadderStep
                index={1}
                icon={<RefreshCwIcon className="size-4" />}
                name={t("watchdog.tier_1_name")}
                description={t("watchdog.tier_1_description")}
                atCommand="AT+COPS=2 → AT+COPS=0"
                enabled={form.tier1Enabled}
                onToggle={form.setTier1Enabled}
                masterOff={masterOff}
              />

              {/* Tier 2 — Radio toggle (skipped under tower lock) */}
              <LadderStep
                index={2}
                icon={<RadioIcon className="size-4" />}
                name={t("watchdog.tier_2_name")}
                description={t("watchdog.tier_2_description")}
                atCommand="AT+CFUN=0 → AT+CFUN=1"
                enabled={form.tier2Enabled}
                onToggle={form.setTier2Enabled}
                masterOff={masterOff}
                info={t("watchdog.tier_2_tooltip")}
                infoAria={t("watchdog.tier_2_more_info_aria")}
              />

              {/* Tier 3 — SIM failover (backup slot lives here) */}
              <LadderStep
                index={3}
                icon={<RotateCcwIcon className="size-4" />}
                name={t("watchdog.tier_3_name")}
                description={t("watchdog.tier_3_description")}
                atCommand="AT+QUIMSLOT=N"
                enabled={form.tier3Enabled}
                onToggle={form.setTier3Enabled}
                masterOff={masterOff}
              >
                {form.tier3Enabled && (
                  <div className="grid gap-4">
                    <Field className="@sm/card:max-w-[18rem]">
                      <FieldLabel htmlFor="backup-sim-slot">
                        {t("watchdog.backup_sim_label")}
                      </FieldLabel>
                      <Select
                        value={form.backupSimSlot}
                        onValueChange={form.setBackupSimSlot}
                        disabled={masterOff}
                      >
                        <SelectTrigger
                          id="backup-sim-slot"
                          ref={registerField("backup-sim-slot")}
                          aria-invalid={!!e.backupSim}
                          aria-describedby={
                            e.backupSim ? "backup-sim-error" : undefined
                          }
                        >
                          <SelectValue
                            placeholder={t("watchdog.backup_sim_placeholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">
                            {t("watchdog.backup_sim_slot_1")}
                          </SelectItem>
                          <SelectItem value="2">
                            {t("watchdog.backup_sim_slot_2")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {e.backupSim ? (
                        <FieldError id="backup-sim-error">
                          {e.backupSim}
                        </FieldError>
                      ) : (
                        <FieldDescription>
                          {t("watchdog.backup_sim_description")}
                        </FieldDescription>
                      )}
                    </Field>

                    {/* Auto fail-back — periodic, blind swap-back to primary. */}
                    <div className="rounded-lg border bg-muted/20 p-4">
                      <Field
                        orientation="horizontal"
                        className="justify-between"
                      >
                        <div className="grid min-w-0 gap-1">
                          <div className="flex items-center gap-1.5">
                            <FieldLabel htmlFor="primary-recheck" className="m-0">
                              {t("watchdog.primary_recheck_label")}
                            </FieldLabel>
                            <InfoTip
                              text={t("watchdog.primary_recheck_tooltip")}
                              aria={t("watchdog.primary_recheck_more_info_aria")}
                            />
                          </div>
                          <FieldDescription>
                            {t("watchdog.primary_recheck_description")}
                          </FieldDescription>
                        </div>
                        <Switch
                          id="primary-recheck"
                          checked={form.primaryRecheckEnabled}
                          onCheckedChange={form.setPrimaryRecheckEnabled}
                          disabled={masterOff}
                          aria-label={t("watchdog.primary_recheck_label")}
                        />
                      </Field>

                      {form.primaryRecheckEnabled && (
                        <div className="animate-in fade-in-0 slide-in-from-top-1 mt-3 duration-300 motion-reduce:animate-none">
                          <Field className="@sm/card:max-w-[18rem]">
                            <FieldLabel htmlFor="primary-recheck-interval">
                              {t("watchdog.primary_recheck_interval_label")}
                            </FieldLabel>
                            <Input
                              ref={registerField("primary-recheck-interval")}
                              id="primary-recheck-interval"
                              type="number"
                              inputMode="numeric"
                              min="5"
                              max="1440"
                              placeholder={t(
                                "watchdog.primary_recheck_interval_placeholder",
                              )}
                              className="tabular-nums"
                              value={form.primaryRecheckInterval}
                              onChange={(ev) =>
                                form.setPrimaryRecheckInterval(ev.target.value)
                              }
                              disabled={masterOff}
                              aria-invalid={!!e.primaryRecheckInterval}
                              aria-describedby={
                                e.primaryRecheckInterval
                                  ? "primary-recheck-interval-error"
                                  : "primary-recheck-interval-desc"
                              }
                            />
                            {e.primaryRecheckInterval ? (
                              <FieldError id="primary-recheck-interval-error">
                                {e.primaryRecheckInterval}
                              </FieldError>
                            ) : (
                              <FieldDescription id="primary-recheck-interval-desc">
                                {t(
                                  "watchdog.primary_recheck_interval_description",
                                )}
                              </FieldDescription>
                            )}
                          </Field>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </LadderStep>

              {/* Tier 4 — Reboot (reboot cap lives here) */}
              <LadderStep
                index={4}
                icon={<PowerIcon className="size-4" />}
                name={t("watchdog.tier_4_name")}
                description={t("watchdog.tier_4_description")}
                atCommand="reboot"
                tone="caution"
                enabled={form.tier4Enabled}
                onToggle={form.setTier4Enabled}
                masterOff={masterOff}
                isLast
              >
                {form.tier4Enabled && (
                  <Field className="@sm/card:max-w-[18rem]">
                    <FieldLabel htmlFor="max-reboots">
                      {t("watchdog.max_reboots_label")}
                    </FieldLabel>
                    <Input
                      ref={registerField("max-reboots")}
                      id="max-reboots"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="10"
                      placeholder={t("watchdog.max_reboots_placeholder")}
                      className="tabular-nums"
                      value={form.maxRebootsPerHour}
                      onChange={(ev) =>
                        form.setMaxRebootsPerHour(ev.target.value)
                      }
                      disabled={masterOff}
                      aria-invalid={!!e.maxReboots}
                      aria-describedby={
                        e.maxReboots ? "max-reboots-error" : "max-reboots-desc"
                      }
                    />
                    {e.maxReboots ? (
                      <FieldError id="max-reboots-error">
                        {e.maxReboots}
                      </FieldError>
                    ) : (
                      <FieldDescription id="max-reboots-desc">
                        {t("watchdog.max_reboots_description")}
                      </FieldDescription>
                    )}
                  </Field>
                )}
              </LadderStep>
            </ol>
          </TabsContent>
        </Tabs>

        {/* ---- Sticky save bar — commits every pending change on the page. ---- */}
        <div className="bg-card/95 supports-[backdrop-filter]:bg-card/80 sticky bottom-0 z-10 -mx-6 -mb-6 mt-6 flex shrink-0 items-center justify-between gap-3 rounded-b-xl border-t px-6 py-4 backdrop-blur">
          <SaveStatus
            t={t}
            isDirty={form.isDirty}
            blocked={blocked}
            saved={form.saved}
            erroredTabNames={erroredTabNames}
          />
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={form.discard}
              disabled={!form.isDirty || form.isSaving}
            >
              {t("watchdog.save_discard")}
            </Button>
            <SaveButton
              type="button"
              size="sm"
              isSaving={form.isSaving}
              saved={form.saved}
              disabled={!form.isDirty || form.isSaving}
              onClick={handleSave}
              label={t("watchdog.save_button")}
              savingLabel={t("watchdog.save_saving")}
              savedLabel={t("watchdog.save_saved_flash")}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// SaveStatus — the four-state truthful save line.
// -----------------------------------------------------------------------------
function SaveStatus({
  t,
  isDirty,
  blocked,
  saved,
  erroredTabNames,
}: {
  t: (k: string, o?: Record<string, unknown>) => string;
  isDirty: boolean;
  blocked: boolean;
  saved: boolean;
  erroredTabNames: string[];
}) {
  if (isDirty && blocked) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="bg-destructive size-2 shrink-0 rounded-full" aria-hidden />
        <p className="text-destructive truncate text-xs font-medium">
          {t("watchdog.save_fix_errors_in", {
            tabs: erroredTabNames.join(", "),
          })}
        </p>
      </div>
    );
  }
  if (isDirty) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="relative flex size-2 shrink-0" aria-hidden>
          <span className="bg-primary/50 absolute inline-flex size-full animate-ping rounded-full motion-reduce:hidden" />
          <span className="bg-primary relative inline-flex size-2 rounded-full" />
        </span>
        <p className="truncate text-xs font-medium">
          {t("watchdog.save_unsaved")}
        </p>
      </div>
    );
  }
  if (saved) {
    return (
      <div className="text-success flex min-w-0 items-center gap-1.5">
        <CheckIcon className="size-3.5 shrink-0" aria-hidden />
        <p className="truncate text-xs font-medium">
          {t("watchdog.save_saved_flash")}
        </p>
      </div>
    );
  }
  return (
    <p className="text-muted-foreground truncate text-xs">
      {t("watchdog.save_all_saved")}
    </p>
  );
}

// -----------------------------------------------------------------------------
// InfoTip — keyboard-focusable info tooltip trigger.
// -----------------------------------------------------------------------------
function InfoTip({ text, aria }: { text: string; aria: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-info inline-flex shrink-0" aria-label={aria}>
          <TbInfoCircleFilled className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// -----------------------------------------------------------------------------
// LadderStep — one rung of the recovery ladder: numbered node in a left rail
// with a connector to the next rung, lucide icon, enable switch, AT-command
// chip, and inline sub-config.
// -----------------------------------------------------------------------------
function LadderStep({
  index,
  icon,
  name,
  description,
  atCommand,
  enabled,
  onToggle,
  masterOff,
  info,
  infoAria,
  tone = "neutral",
  isLast = false,
  children,
}: {
  index: number;
  icon: React.ReactNode;
  name: string;
  description: string;
  atCommand: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  masterOff: boolean;
  info?: string;
  infoAria?: string;
  tone?: "neutral" | "caution";
  isLast?: boolean;
  children?: React.ReactNode;
}) {
  const active = enabled && !masterOff;
  const switchId = `tier${index}-enabled`;

  return (
    <li className={cn("flex gap-3", !isLast && "pb-6")}>
      {/* Left rail: numbered node + connector */}
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            active
              ? "bg-secondary text-secondary-foreground border-transparent"
              : "bg-muted/40 text-muted-foreground border-border",
          )}
        >
          {index}
        </span>
        {!isLast && (
          <span
            aria-hidden
            className={cn(
              "mt-1.5 w-px flex-1 transition-colors duration-300",
              active ? "bg-secondary" : "bg-border",
            )}
          />
        )}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1 pb-0.5">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
                aria-hidden
              >
                {icon}
              </span>
              <span
                className={cn(
                  "truncate text-sm font-semibold",
                  !active && "text-muted-foreground",
                )}
              >
                {name}
              </span>
              {info && <InfoTip text={info} aria={infoAria ?? ""} />}
            </div>
            <p className="text-muted-foreground text-xs">{description}</p>
            <code
              className={cn(
                "mt-0.5 w-fit rounded border px-1.5 py-0.5 font-mono text-[11px] leading-tight",
                tone === "caution"
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
            >
              {atCommand}
            </code>
          </div>

          <Switch
            id={switchId}
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={masterOff}
            aria-label={name}
          />
        </div>

        {children && <div className="mt-3">{children}</div>}
      </div>
    </li>
  );
}
