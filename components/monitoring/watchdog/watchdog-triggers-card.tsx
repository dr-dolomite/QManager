"use client";

import { useState } from "react";
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
import { ActivityIcon, GaugeIcon } from "lucide-react";
import { TbInfoCircleFilled } from "react-icons/tb";
import type { WatchdogForm } from "./use-watchdog-form";

// Recovery Triggers — the two independent ways the watchdog decides to act
// (the backend's "dual-trigger model"), merged into one card with Reachability
// and Connection Quality as tabs, the way the Custom SIM Profiles editor groups
// its panels. Because the backend save is atomic over the whole form, the
// shared Save / Discard pair lives in this card's footer and commits every
// pending change on the page (triggers, recovery ladder, and master toggle).
export function WatchdogTriggersCard({
  form,
  defaultTab = "reachability",
}: {
  form: WatchdogForm;
  defaultTab?: "reachability" | "quality";
}) {
  const { t } = useTranslation("monitoring");
  const [tab, setTab] = useState<"reachability" | "quality">(defaultTab);
  const masterOff = !form.isEnabled;
  const qualityOn = form.qualityEnabled;

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
              {/* Live indicator. Quality monitoring only actually runs while the
                  watchdog master is on, so the dot has two meanings:
                  - master ON  + quality armed → green pulse (the same the Traffic
                    Engine tabs use when a service is live);
                  - master OFF + quality armed → steady secondary dot (configured
                    but dormant — the daemon is stopped, so nothing is running). */}
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
                  <Field>
                    <FieldLabel htmlFor="max-failures">
                      {t("watchdog.failure_threshold_label")}
                    </FieldLabel>
                    <Input
                      id="max-failures"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="20"
                      placeholder={t("watchdog.failure_threshold_placeholder")}
                      className="tabular-nums"
                      value={form.maxFailures}
                      onChange={(e) => form.setMaxFailures(e.target.value)}
                      disabled={masterOff}
                      aria-invalid={!!form.errors.maxFailures}
                      aria-describedby={
                        form.errors.maxFailures
                          ? "max-failures-error"
                          : "max-failures-desc"
                      }
                    />
                    {form.errors.maxFailures ? (
                      <FieldError id="max-failures-error">
                        {form.errors.maxFailures}
                      </FieldError>
                    ) : (
                      <FieldDescription id="max-failures-desc">
                        {t("watchdog.failure_threshold_description")}
                      </FieldDescription>
                    )}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="check-interval">
                      {t("watchdog.check_interval_label")}
                    </FieldLabel>
                    <Select
                      value={form.checkInterval}
                      onValueChange={form.setCheckInterval}
                      disabled={masterOff}
                    >
                      <SelectTrigger id="check-interval">
                        <SelectValue
                          placeholder={t("watchdog.check_interval_label")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">
                          {t("watchdog.check_interval_5s")}
                        </SelectItem>
                        <SelectItem value="10">
                          {t("watchdog.check_interval_10s")}
                        </SelectItem>
                        <SelectItem value="15">
                          {t("watchdog.check_interval_15s")}
                        </SelectItem>
                        <SelectItem value="30">
                          {t("watchdog.check_interval_30s")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {t("watchdog.check_interval_description")}
                    </FieldDescription>
                  </Field>

                  <Field className="@sm/card:col-span-2">
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
                      className="tabular-nums @sm/card:max-w-[12rem]"
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
                  <div className="text-muted-foreground flex items-center gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
                    <GaugeIcon className="size-4 shrink-0" />
                    <span>{t("watchdog.quality_off_hint")}</span>
                  </div>
                ) : (
                  <div className="animate-in fade-in-0 slide-in-from-top-1 duration-300 motion-reduce:animate-none">
                    <div className="grid grid-cols-1 gap-4 @sm/card:grid-cols-3">
                      <Field>
                        <FieldLabel htmlFor="latency-ceiling">
                          {t("watchdog.latency_ceiling_label")}
                        </FieldLabel>
                        <Input
                          id="latency-ceiling"
                          type="number"
                          inputMode="numeric"
                          min="0"
                          max="10000"
                          placeholder={t("watchdog.latency_ceiling_placeholder")}
                          className="tabular-nums"
                          value={form.latencyCeiling}
                          onChange={(e) =>
                            form.setLatencyCeiling(e.target.value)
                          }
                          disabled={masterOff}
                          aria-invalid={!!form.errors.latency}
                          aria-describedby={
                            form.errors.latency
                              ? "latency-ceiling-error"
                              : "latency-ceiling-desc"
                          }
                        />
                        {form.errors.latency ? (
                          <FieldError id="latency-ceiling-error">
                            {form.errors.latency}
                          </FieldError>
                        ) : (
                          <FieldDescription id="latency-ceiling-desc">
                            {t("watchdog.latency_ceiling_description")}
                          </FieldDescription>
                        )}
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="loss-ceiling">
                          {t("watchdog.loss_ceiling_label")}
                        </FieldLabel>
                        <Input
                          id="loss-ceiling"
                          type="number"
                          inputMode="numeric"
                          min="0"
                          max="100"
                          placeholder={t("watchdog.loss_ceiling_placeholder")}
                          className="tabular-nums"
                          value={form.lossCeiling}
                          onChange={(e) => form.setLossCeiling(e.target.value)}
                          disabled={masterOff}
                          aria-invalid={!!form.errors.loss}
                          aria-describedby={
                            form.errors.loss
                              ? "loss-ceiling-error"
                              : "loss-ceiling-desc"
                          }
                        />
                        {form.errors.loss ? (
                          <FieldError id="loss-ceiling-error">
                            {form.errors.loss}
                          </FieldError>
                        ) : (
                          <FieldDescription id="loss-ceiling-desc">
                            {t("watchdog.loss_ceiling_description")}
                          </FieldDescription>
                        )}
                      </Field>

                      <Field>
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

                    {form.errors.noCeiling && (
                      <FieldError
                        id="quality-no-ceiling-error"
                        className="mt-4"
                      >
                        {form.errors.noCeiling}
                      </FieldError>
                    )}
                  </div>
                )}
              </FieldGroup>
            </FieldSet>
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* Shared, atomic Save / Discard — commits every pending change on the
          page, not just this card's tab. The dirty hint makes that scope clear
          when the edit happened in the recovery ladder or the master toggle. */}
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
