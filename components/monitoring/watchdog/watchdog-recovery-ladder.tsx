"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TbInfoCircleFilled } from "react-icons/tb";
import { cn } from "@/lib/utils";
import type { WatchdogForm } from "./use-watchdog-form";

// Recovery Ladder — the "what does it do" half of the feature. The old design
// rendered the four tiers as four loose switches, with the backup-SIM picker and
// reboot cap floating off in a separate field grid. Here they are what the
// backend actually models: an ordered escalation ladder, gentlest first. Each
// step shows its order number, the AT commands it issues, an enable switch, and
// its own inline sub-config (backup SIM inside Tier 3, reboot cap inside Tier 4).
// The numbering is meaningful — the order is the behaviour — so it is a genuine
// sequence, not decorative scaffolding.
export function WatchdogRecoveryLadder({ form }: { form: WatchdogForm }) {
  const { t } = useTranslation("monitoring");
  const masterOff = !form.isEnabled;
  const ssrOn = form.ssrAware;

  return (
    <Card className="@container/card h-full flex flex-col">
      <CardHeader>
        <CardTitle>{t("watchdog.recovery_steps_title")}</CardTitle>
        <CardDescription>
          {t("watchdog.recovery_steps_description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        {/* Step zero — wait out a recoverable baseband (radio firmware) restart
            before the ladder is allowed to act. A precondition, not a rung, so
            it sits above the numbered sequence on its own muted surface. */}
        <div className="mb-5 rounded-lg border bg-muted/20 p-3">
          <Field orientation="horizontal" className="justify-between">
            <div className="grid min-w-0 gap-1">
              <div className="flex items-center gap-1.5">
                <FieldLabel htmlFor="ssr-aware" className="m-0">
                  {t("watchdog.ssr_aware_label")}
                </FieldLabel>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-info inline-flex shrink-0"
                      aria-label={t("watchdog.ssr_aware_more_info_aria")}
                    >
                      <TbInfoCircleFilled className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>{t("watchdog.ssr_aware_tooltip")}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <FieldDescription>
                {t("watchdog.ssr_aware_description")}
              </FieldDescription>
            </div>
            <Switch
              id="ssr-aware"
              checked={ssrOn}
              onCheckedChange={form.setSsrAware}
              disabled={masterOff}
              aria-label={t("watchdog.ssr_aware_label")}
            />
          </Field>

          {ssrOn && (
            <div className="mt-3 animate-in fade-in-0 slide-in-from-top-1 duration-300 motion-reduce:animate-none">
              <Field className="@sm/card:max-w-[16rem]">
                <FieldLabel htmlFor="ssr-grace">
                  {t("watchdog.ssr_grace_label")}
                </FieldLabel>
                <Input
                  id="ssr-grace"
                  type="number"
                  inputMode="numeric"
                  min="10"
                  max="120"
                  placeholder={t("watchdog.ssr_grace_placeholder")}
                  className="tabular-nums"
                  value={form.ssrGrace}
                  onChange={(e) => form.setSsrGrace(e.target.value)}
                  disabled={masterOff}
                  aria-invalid={!!form.errors.ssrGrace}
                  aria-describedby={
                    form.errors.ssrGrace ? "ssr-grace-error" : "ssr-grace-desc"
                  }
                />
                {form.errors.ssrGrace ? (
                  <FieldError id="ssr-grace-error">
                    {form.errors.ssrGrace}
                  </FieldError>
                ) : (
                  <FieldDescription id="ssr-grace-desc">
                    {t("watchdog.ssr_grace_description")}
                  </FieldDescription>
                )}
              </Field>
            </div>
          )}
        </div>

        <ol className="flex flex-col h-full">
          {/* Tier 1 — Network re-registration */}
          <Step
            index={1}
            name={t("watchdog.tier_1_name")}
            description={t("watchdog.tier_1_description")}
            atCommand="AT+COPS=2 → AT+COPS=0"
            enabled={form.tier1Enabled}
            onToggle={form.setTier1Enabled}
            masterOff={masterOff}
          />

          {/* Tier 2 — Radio toggle (skipped under tower lock) */}
          <Step
            index={2}
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
          <Step
            index={3}
            name={t("watchdog.tier_3_name")}
            description={t("watchdog.tier_3_description")}
            atCommand="AT+QUIMSLOT=N"
            enabled={form.tier3Enabled}
            onToggle={form.setTier3Enabled}
            masterOff={masterOff}
          >
            {form.tier3Enabled && (
              <Field className="@sm/card:max-w-[16rem]">
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
                    aria-invalid={!!form.errors.backupSim}
                    aria-describedby={
                      form.errors.backupSim ? "backup-sim-error" : undefined
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
                {form.errors.backupSim ? (
                  <FieldError id="backup-sim-error">
                    {form.errors.backupSim}
                  </FieldError>
                ) : (
                  <FieldDescription>
                    {t("watchdog.backup_sim_description")}
                  </FieldDescription>
                )}
              </Field>
            )}
          </Step>

          {/* Tier 4 — Reboot (reboot cap lives here) */}
          <Step
            index={4}
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
              <Field className="@sm/card:max-w-[16rem]">
                <FieldLabel htmlFor="max-reboots">
                  {t("watchdog.max_reboots_label")}
                </FieldLabel>
                <Input
                  id="max-reboots"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="10"
                  placeholder={t("watchdog.max_reboots_placeholder")}
                  className="tabular-nums"
                  value={form.maxRebootsPerHour}
                  onChange={(e) => form.setMaxRebootsPerHour(e.target.value)}
                  disabled={masterOff}
                  aria-invalid={!!form.errors.maxReboots}
                  aria-describedby={
                    form.errors.maxReboots
                      ? "max-reboots-error"
                      : "max-reboots-desc"
                  }
                />
                {form.errors.maxReboots ? (
                  <FieldError id="max-reboots-error">
                    {form.errors.maxReboots}
                  </FieldError>
                ) : (
                  <FieldDescription id="max-reboots-desc">
                    {t("watchdog.max_reboots_description")}
                  </FieldDescription>
                )}
              </Field>
            )}
          </Step>
        </ol>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Step — one rung of the ladder. The numbered node sits in a left rail with a
// connector line to the next rung, so the four steps read as one ordered
// sequence rather than four independent switches.
// -----------------------------------------------------------------------------
function Step({
  index,
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
    <li
      className="flex flex-1 gap-3 animate-in fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none"
      style={{ animationDelay: `${(index - 1) * 60}ms`, animationFillMode: "both" }}
    >
      {/* Left rail: numbered node + connector */}
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
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
              "mt-1 w-px flex-1 transition-colors duration-300",
              active ? "bg-secondary" : "bg-border",
            )}
          />
        )}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "truncate text-sm font-semibold",
                  !active && "text-muted-foreground",
                )}
              >
                {name}
              </span>
              {info && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-info inline-flex shrink-0"
                      aria-label={infoAria}
                    >
                      <TbInfoCircleFilled className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>{info}</p>
                  </TooltipContent>
                </Tooltip>
              )}
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
