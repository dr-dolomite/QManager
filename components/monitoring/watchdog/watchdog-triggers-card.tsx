"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ActivityIcon, ArrowUpRightIcon, GaugeIcon } from "lucide-react";
import { TbInfoCircleFilled } from "react-icons/tb";
import { PING_PROFILES } from "@/types/modem-status";
import type { WatchdogQualityThresholds } from "@/hooks/use-watchdog-settings";
import { PROFILE_INTERVAL_SEC, type WatchdogForm } from "./use-watchdog-form";

const QUALITY_SETTINGS_HREF = "/system-settings/connection-quality";

// Recovery Triggers — the two independent ways the watchdog decides to act
// (the backend's "dual-trigger model"), merged into one card with Reachability
// and Connection Quality as tabs. Because the backend save is atomic over the
// whole form, the shared Save / Discard pair lives in this card's footer and
// commits every pending change on the page.
export function WatchdogTriggersCard({
  form,
  qualityThresholds,
  defaultTab = "reachability",
}: {
  form: WatchdogForm;
  qualityThresholds: WatchdogQualityThresholds | null;
  defaultTab?: "reachability" | "quality";
}) {
  const { t } = useTranslation("monitoring");
  const [tab, setTab] = useState<"reachability" | "quality">(defaultTab);
  const masterOff = !form.isEnabled;
  const qualityOn = form.qualityEnabled;
  const isCustom = form.intervalChoice === "custom";

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("watchdog.triggers_title")}</CardTitle>
        <CardDescription>{t("watchdog.triggers_description")}</CardDescription>
      </CardHeader>

      {/* flex-1 lets this card absorb the column's spare height when the ladder
          is the taller side (watchdog disabled), keeping the save bar pinned to
          the card foot so both desktop columns end at the same line. */}
      <CardContent className="flex-1">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "reachability" | "quality")}
          className="w-full"
        >
          <TabsList className="w-full">
            <TabsTrigger value="reachability">
              {t("watchdog.tab_reachability")}
            </TabsTrigger>
            <TabsTrigger value="quality">
              {t("watchdog.tab_quality")}
              {/* Live indicator. Quality recovery only actually runs while the
                  watchdog master is on, so the dot has two meanings:
                  - master ON  + quality armed → green pulse (live);
                  - master OFF + quality armed → steady secondary dot (configured
                    but dormant — the daemon is stopped). */}
              {qualityOn &&
                (masterOff ? (
                  <span
                    aria-hidden
                    className="bg-secondary ml-1.5 size-2.5 rounded-full"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="bg-success ml-1.5 size-2.5 animate-pulse rounded-full motion-reduce:animate-none"
                  />
                ))}
            </TabsTrigger>
          </TabsList>

          {/* ---- Reachability (Trigger 1, always on) ---- */}
          <TabsContent
            value="reachability"
            className="mt-4 animate-in fade-in-0 slide-in-from-left-2 duration-200 motion-reduce:animate-none"
          >
            <div className="mb-4">
              <Badge
                variant="outline"
                className="text-muted-foreground border-muted-foreground/30 bg-muted/40 shrink-0 gap-1"
              >
                <ActivityIcon className="size-3" />
                {t("watchdog.trigger_always_on")}
              </Badge>
            </div>

            <FieldSet>
              <FieldGroup>
                <div className="grid grid-cols-1 gap-4 @sm/card:grid-cols-2">
                  {/* Probe interval — mirrors Connection Quality sensitivity,
                      plus a Custom escape hatch. */}
                  <Field>
                    <div className="flex items-center gap-1.5">
                      <FieldLabel htmlFor="probe-interval" className="m-0">
                        {t("watchdog.probe_interval_label")}
                      </FieldLabel>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-info inline-flex"
                            aria-label={t("watchdog.probe_interval_more_info_aria")}
                          >
                            <TbInfoCircleFilled className="size-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>{t("watchdog.probe_interval_tooltip")}</p>
                        </TooltipContent>
                      </Tooltip>
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
                            {t(`watchdog.profile_${p}`)} · {PROFILE_INTERVAL_SEC[p]}
                            s
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">
                          {t("watchdog.probe_interval_custom")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {t("watchdog.probe_interval_description")}
                    </FieldDescription>
                  </Field>

                  {/* Custom interval value (only when Custom is chosen) */}
                  {isCustom ? (
                    <Field className="animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
                      <FieldLabel htmlFor="custom-interval">
                        {t("watchdog.custom_interval_label")}
                      </FieldLabel>
                      <Input
                        id="custom-interval"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max="60"
                        placeholder={t("watchdog.custom_interval_placeholder")}
                        className="tabular-nums"
                        value={form.customInterval}
                        onChange={(e) => form.setCustomInterval(e.target.value)}
                        disabled={masterOff}
                        aria-invalid={!!form.errors.customInterval}
                        aria-describedby={
                          form.errors.customInterval
                            ? "custom-interval-error"
                            : "custom-interval-desc"
                        }
                      />
                      {form.errors.customInterval ? (
                        <FieldError id="custom-interval-error">
                          {form.errors.customInterval}
                        </FieldError>
                      ) : (
                        <FieldDescription id="custom-interval-desc">
                          {t("watchdog.custom_interval_description")}
                        </FieldDescription>
                      )}
                    </Field>
                  ) : (
                    // Keep the grid balanced: a spacer cell on @sm+ so the fail
                    // threshold drops to its own row rather than sitting beside
                    // the interval Select.
                    <div className="hidden @sm/card:block" aria-hidden />
                  )}

                  {/* Fail threshold (consecutive failed probes) */}
                  <Field>
                    <FieldLabel htmlFor="fail-threshold">
                      {t("watchdog.failure_threshold_label")}
                    </FieldLabel>
                    <Input
                      id="fail-threshold"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="20"
                      placeholder={t("watchdog.failure_threshold_placeholder")}
                      className="tabular-nums"
                      value={form.failThreshold}
                      onChange={(e) => form.setFailThreshold(e.target.value)}
                      disabled={masterOff}
                      aria-invalid={!!form.errors.failThreshold}
                      aria-describedby={
                        form.errors.failThreshold
                          ? "fail-threshold-error"
                          : "fail-threshold-desc"
                      }
                    />
                    {form.errors.failThreshold ? (
                      <FieldError id="fail-threshold-error">
                        {form.errors.failThreshold}
                      </FieldError>
                    ) : (
                      <FieldDescription id="fail-threshold-desc">
                        {t("watchdog.failure_threshold_description")}
                      </FieldDescription>
                    )}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="cooldown">
                      {t("watchdog.cooldown_label")}
                    </FieldLabel>
                    <Input
                      id="cooldown"
                      type="number"
                      inputMode="numeric"
                      min="10"
                      max="300"
                      placeholder={t("watchdog.cooldown_placeholder")}
                      className="tabular-nums"
                      value={form.cooldown}
                      onChange={(e) => form.setCooldown(e.target.value)}
                      disabled={masterOff}
                      aria-invalid={!!form.errors.cooldown}
                      aria-describedby={
                        form.errors.cooldown ? "cooldown-error" : "cooldown-desc"
                      }
                    />
                    {form.errors.cooldown ? (
                      <FieldError id="cooldown-error">
                        {form.errors.cooldown}
                      </FieldError>
                    ) : (
                      <FieldDescription id="cooldown-desc">
                        {t("watchdog.cooldown_description")}
                      </FieldDescription>
                    )}
                  </Field>
                </div>

                {/* Live "declares down after ~Ns" derivation. */}
                <div className="bg-muted/30 text-muted-foreground mt-1 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
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

          {/* ---- Connection Quality (Trigger 2, opt-in) ---- */}
          <TabsContent
            value="quality"
            className="mt-4 animate-in fade-in-0 slide-in-from-right-2 duration-200 motion-reduce:animate-none"
          >
            <FieldSet>
              <FieldGroup>
                {/* Enable row + tooltip */}
                <Field orientation="horizontal" className="justify-between">
                  <div className="grid gap-1">
                    <div className="flex items-center gap-1.5">
                      <FieldLabel htmlFor="quality-enabled" className="m-0">
                        {t("watchdog.quality_enable_label")}
                      </FieldLabel>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-info inline-flex"
                            aria-label={t("watchdog.quality_more_info_aria")}
                          >
                            <TbInfoCircleFilled className="size-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>{t("watchdog.quality_tooltip")}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <FieldDescription>
                      {t("watchdog.quality_description")}
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

                {!qualityOn ? (
                  <div className="text-muted-foreground bg-muted/20 flex items-center gap-2 rounded-lg border p-3 text-sm">
                    <GaugeIcon className="size-4 shrink-0" />
                    <span>{t("watchdog.quality_off_hint")}</span>
                  </div>
                ) : (
                  <div className="grid gap-4 animate-in fade-in-0 slide-in-from-top-1 duration-300 motion-reduce:animate-none">
                    {/* Read-only view of the SHARED thresholds recovery acts on.
                        Editing lives on the Connection Quality page. */}
                    <div className="bg-muted/20 grid gap-2.5 rounded-lg border p-3">
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
                          <span className="tabular-nums text-sm font-semibold">
                            {qualityThresholds
                              ? `${qualityThresholds.latency_ms} ms`
                              : "—"}
                          </span>
                        </div>
                        <div className="grid gap-0.5">
                          <span className="text-muted-foreground text-xs">
                            {t("watchdog.quality_loss_readonly_label")}
                          </span>
                          <span className="tabular-nums text-sm font-semibold">
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

                    {/* Recovery debounce — the only quality knob the watchdog
                        owns: how sustained a breach must be before it acts. */}
                    <Field className="@sm/card:max-w-[16rem]">
                      <FieldLabel htmlFor="quality-consecutive">
                        {t("watchdog.quality_consecutive_label")}
                      </FieldLabel>
                      <Input
                        id="quality-consecutive"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max="60"
                        placeholder={t(
                          "watchdog.quality_consecutive_placeholder",
                        )}
                        className="tabular-nums"
                        value={form.qualityConsecutive}
                        onChange={(e) =>
                          form.setQualityConsecutive(e.target.value)
                        }
                        disabled={masterOff}
                        aria-invalid={!!form.errors.consecutive}
                        aria-describedby={
                          form.errors.consecutive
                            ? "quality-consecutive-error"
                            : "quality-consecutive-desc"
                        }
                      />
                      {form.errors.consecutive ? (
                        <FieldError id="quality-consecutive-error">
                          {form.errors.consecutive}
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
        </Tabs>
      </CardContent>

      {/* Shared, atomic Save / Discard — commits every pending change on the
          page, not just this card's tab. */}
      <CardFooter className="flex items-center justify-between gap-3 border-t pt-4">
        <div className="flex min-w-0 items-center gap-1.5">
          {form.isDirty ? (
            <>
              <span className="relative flex size-2 shrink-0" aria-hidden>
                <span className="bg-primary/50 absolute inline-flex size-full animate-ping rounded-full motion-reduce:hidden" />
                <span className="bg-primary relative inline-flex size-2 rounded-full" />
              </span>
              <p className="truncate text-xs font-medium">
                {form.hasValidationErrors
                  ? t("watchdog.save_fix_errors")
                  : t("watchdog.save_unsaved")}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground truncate text-xs">
              {t("watchdog.save_all_saved")}
            </p>
          )}
        </div>

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
            disabled={!form.canSave}
            onClick={() => void form.submit()}
          />
        </div>
      </CardFooter>
    </Card>
  );
}
