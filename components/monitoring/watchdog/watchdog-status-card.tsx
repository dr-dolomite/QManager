"use client";

import React, { useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  InfoIcon,
  Loader2,
  CheckCircle2Icon,
  TriangleAlertIcon,
  AlertCircleIcon,
  ClockIcon,
  LockIcon,
  MinusCircleIcon,
  PowerOffIcon,
  ActivityIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DUR, EASE_OUT_EXPO } from "@/lib/motion";
import { useModemStatus } from "@/hooks/use-modem-status";
import { formatTimeAgo } from "@/types/modem-status";
import type { WatchcatState } from "@/types/modem-status";
import type {
  WatchdogSettings,
  WatchdogLiveStatus,
  SimFailoverInfo,
} from "@/hooks/use-watchdog-settings";
import type { WatchdogForm } from "./use-watchdog-form";

interface WatchdogStatusCardProps {
  form: WatchdogForm;
  /** Server-truth settings — the hero reflects SAVED state, never form drafts. */
  settings: WatchdogSettings;
  /** Full daemon state-file passthrough (carries quality_breach_count). */
  liveStatus: WatchdogLiveStatus | null;
  simFailover: SimFailoverInfo | null;
  autoDisabled: boolean;
  revertSim: () => Promise<boolean>;
}

type HeroTone = "success" | "warning" | "destructive" | "info" | "muted";

const STATE_META: Record<
  WatchcatState,
  { tone: HeroTone; icon: React.ReactNode; pulse?: boolean }
> = {
  monitor: { tone: "success", icon: <CheckCircle2Icon className="size-6" /> },
  suspect: { tone: "warning", icon: <TriangleAlertIcon className="size-6" /> },
  recovery: {
    tone: "destructive",
    icon: <AlertCircleIcon className="size-6" />,
    pulse: true,
  },
  cooldown: { tone: "info", icon: <ClockIcon className="size-6" /> },
  locked: { tone: "muted", icon: <LockIcon className="size-6" /> },
  disabled: { tone: "muted", icon: <MinusCircleIcon className="size-6" /> },
  // Calm, patient — the modem is self-healing a baseband restart and we are
  // deliberately holding off. Info tone (never destructive); the Activity icon
  // reads as "vitals recovering" and a gentle pulse signals it is in progress.
  ssr_hold: {
    tone: "info",
    icon: <ActivityIcon className="size-6" />,
    pulse: true,
  },
};

const TONE_RING: Record<HeroTone, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  info: "bg-info/15 text-info border-info/30",
  muted: "bg-muted/50 text-muted-foreground border-muted-foreground/25",
};

const TONE_TILE: Record<HeroTone, string> = {
  success: "border-success/25 bg-success/5",
  warning: "border-warning/25 bg-warning/5",
  destructive: "border-destructive/25 bg-destructive/5",
  info: "border-info/25 bg-info/5",
  muted: "border-border bg-muted/20",
};

export function WatchdogStatusCard({
  form,
  settings,
  liveStatus,
  simFailover,
  autoDisabled,
  revertSim,
}: WatchdogStatusCardProps) {
  const { t } = useTranslation("monitoring");
  const { data: modemStatus, isLoading } = useModemStatus({
    pollInterval: 5000,
  });
  const [isReverting, setIsReverting] = useState(false);
  const reduceMotion = useReducedMotion();

  const stepLabel = useCallback(
    (tier: number | null | undefined) =>
      tier
        ? t("watchdog.tier_label_short", { n: tier })
        : t("watchdog.tier_label_none"),
    [t],
  );

  const stateLabels = useMemo<Record<string, string>>(
    () => ({
      monitor: t("watchdog.status_badge_monitoring"),
      suspect: t("watchdog.status_badge_suspect"),
      recovery: t("watchdog.status_badge_recovery"),
      cooldown: t("watchdog.status_badge_cooldown"),
      locked: t("watchdog.status_badge_locked"),
      disabled: t("watchdog.status_badge_disabled"),
      ssr_hold: t("watchdog.status_badge_ssr_hold"),
    }),
    [t],
  );

  const stateBlurbs = useMemo<Record<string, string>>(
    () => ({
      monitor: t("watchdog.state_blurb_monitor"),
      suspect: t("watchdog.state_blurb_suspect"),
      recovery: t("watchdog.state_blurb_recovery"),
      cooldown: t("watchdog.state_blurb_cooldown"),
      locked: t("watchdog.state_blurb_locked"),
      disabled: t("watchdog.state_blurb_disabled"),
      ssr_hold: t("watchdog.state_blurb_ssr_hold"),
    }),
    [t],
  );

  const handleRevertSim = useCallback(async () => {
    setIsReverting(true);
    try {
      const ok = await revertSim();
      if (ok) toast.success(t("watchdog.toast_sim_revert_success"));
      else toast.error(t("watchdog.toast_sim_revert_error"));
    } finally {
      setIsReverting(false);
    }
  }, [revertSim, t]);

  const watchcat = modemStatus?.watchcat;
  const daemonReporting = watchcat?.enabled;
  // Saved-State Honesty: the branch reflects SAVED settings + daemon truth, not
  // the (possibly dirty) master toggle. The toggle applies on Save.
  const savedEnabled = settings.enabled;

  const header = (
    <CardHeader>
      <CardTitle>{t("watchdog.status_live_title")}</CardTitle>
      <CardDescription>{t("watchdog.overview_description")}</CardDescription>
      <CardAction>
        <Switch
          id="watchdog-enabled"
          checked={form.isEnabled}
          onCheckedChange={form.setIsEnabled}
          aria-label={t("watchdog.enable_label")}
        />
      </CardAction>
    </CardHeader>
  );

  // ---- Loading (Skeleton-Mirror handled by the page-level skeleton) ----
  if (isLoading && !watchcat) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent>
          <StateTile
            tone="muted"
            icon={<Loader2 className="size-6 animate-spin motion-reduce:animate-none" />}
            title={t("watchdog.state_starting_title")}
            subtitle={t("watchdog.status_starting")}
            reduceMotion={reduceMotion}
          />
        </CardContent>
      </Card>
    );
  }

  // ---- Off (saved disabled) ----
  if (!savedEnabled) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent className="grid gap-4">
          {autoDisabled && <AutoDisabledAlert t={t} />}
          <StateTile
            tone="muted"
            icon={<PowerOffIcon className="size-6" />}
            title={t("watchdog.state_off_title")}
            subtitle={t("watchdog.state_off_subtitle")}
            reduceMotion={reduceMotion}
          />
        </CardContent>
      </Card>
    );
  }

  // ---- Settling (saved enabled, daemon not reporting yet) ----
  if (!daemonReporting) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent className="grid gap-4">
          {autoDisabled && <AutoDisabledAlert t={t} />}
          <StateTile
            tone="info"
            icon={<Loader2 className="size-6 animate-spin motion-reduce:animate-none" />}
            title={t("watchdog.state_starting_title")}
            subtitle={t("watchdog.status_starting")}
            reduceMotion={reduceMotion}
          />
        </CardContent>
      </Card>
    );
  }

  // ---- Live ----
  const stateKey = (watchcat!.state as WatchcatState) || "disabled";
  const meta = STATE_META[stateKey] ?? STATE_META.disabled;
  const runningTier = watchcat!.current_tier;

  const stats: {
    key: string;
    label: string;
    value: React.ReactNode;
    tint?: "warning";
  }[] = [
    {
      key: "step",
      label: t("watchdog.status_row_current_step"),
      value: stepLabel(watchcat!.current_tier),
    },
    {
      key: "failed",
      label: t("watchdog.status_row_failed_checks"),
      value: watchcat!.failure_count,
      tint: watchcat!.failure_count > 0 ? "warning" : undefined,
    },
    // Cooldown only when actually counting down — an honest readout of the
    // 90s SIM-settle floor when a Tier-3 swap is settling.
    ...(watchcat!.cooldown_remaining > 0
      ? [
          {
            key: "cooldown",
            label: t("watchdog.status_row_cooldown"),
            value: t("watchdog.status_cooldown_remaining", {
              count: watchcat!.cooldown_remaining,
            }),
          },
        ]
      : []),
    {
      key: "recoveries",
      label: t("watchdog.status_row_total_recoveries"),
      value: watchcat!.total_recoveries,
    },
    {
      key: "reboots",
      label: t("watchdog.status_row_reboots_this_hour"),
      value: watchcat!.reboots_this_hour,
      tint: watchcat!.reboots_this_hour > 0 ? "warning" : undefined,
    },
    // Quality breach counter — only from the CGI state-file passthrough; older
    // daemons omit it, so hide the stat entirely when undefined.
    ...(typeof liveStatus?.quality_breach_count === "number"
      ? [
          {
            key: "breaches",
            label: t("watchdog.status_row_quality_breaches"),
            value: liveStatus.quality_breach_count,
            tint:
              liveStatus.quality_breach_count > 0
                ? ("warning" as const)
                : undefined,
          },
        ]
      : []),
    {
      key: "last",
      label: t("watchdog.status_row_last_recovery"),
      value:
        watchcat!.last_recovery_time != null ? (
          watchcat!.last_recovery_tier ? (
            <span>
              {stepLabel(watchcat!.last_recovery_tier)}
              <span className="text-muted-foreground font-normal">
                {" "}
                ({formatTimeAgo(watchcat!.last_recovery_time)})
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground font-normal">
              {formatTimeAgo(watchcat!.last_recovery_time)}
            </span>
          )
        ) : (
          <span className="text-muted-foreground font-normal">
            {t("watchdog.tier_label_none")}
          </span>
        ),
    },
  ];

  return (
    <Card className="@container/card">
      {header}
      <CardContent className="grid gap-5">
        {autoDisabled && <AutoDisabledAlert t={t} />}

        {/* Screen-reader announcement of state-name changes. */}
        <p className="sr-only" role="status" aria-live="polite">
          {t("watchdog.status_state_announce", {
            state: stateLabels[stateKey] ?? stateLabels.disabled,
          })}
        </p>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={stateKey}
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.98 }}
            transition={{ duration: reduceMotion ? 0 : DUR.base, ease: EASE_OUT_EXPO }}
          >
            <StateTile
              tone={meta.tone}
              icon={meta.icon}
              pulse={meta.pulse}
              title={stateLabels[stateKey] ?? stateLabels.disabled}
              subtitle={stateBlurbs[stateKey] ?? ""}
              reduceMotion={reduceMotion}
            />
          </motion.div>
        </AnimatePresence>

        {/* Hairline divider, then the counter strip. */}
        <div className="border-t pt-5">
          <div className="flex flex-wrap gap-x-10 gap-y-5">
            {stats.map((s) => (
              <div key={s.key} className="grid gap-1">
                <span className="text-muted-foreground text-xs font-medium">
                  {s.label}
                </span>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    s.tint === "warning" && "text-warning",
                  )}
                >
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Read-only ladder stepper — the SAVED enabled state of the four tiers,
            with the currently-running tier highlighted. Saved-State Honesty:
            reads server truth, never form drafts. */}
        <HeroLadder
          t={t}
          savedTiers={[
            settings.tier1_enabled,
            settings.tier2_enabled,
            settings.tier3_enabled,
            settings.tier4_enabled,
          ]}
          runningTier={runningTier}
        />

        {simFailover?.active && (
          <div className="border-t pt-5">
            <Alert className="mb-3">
              <InfoIcon className="size-4" />
              <AlertDescription>
                <p>
                  {t("watchdog.status_sim_failover_message", {
                    current_slot: simFailover.current_slot,
                    switched_at: simFailover.switched_at
                      ? formatTimeAgo(simFailover.switched_at)
                      : t("watchdog.status_sim_failover_recently"),
                    original_slot: simFailover.original_slot,
                  })}
                </p>
              </AlertDescription>
            </Alert>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isReverting}>
                  {isReverting ? (
                    <>
                      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                      {t("watchdog.status_sim_reverting")}
                    </>
                  ) : (
                    t("watchdog.status_sim_revert_button")
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("watchdog.status_sim_revert_dialog_title")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("watchdog.status_sim_revert_dialog_description", {
                      original_slot: simFailover.original_slot,
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {t("watchdog.status_sim_revert_cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={handleRevertSim}>
                    {t("watchdog.status_sim_revert_confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AutoDisabledAlert({ t }: { t: (k: string) => string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon className="size-4" />
      <AlertDescription>
        <p>{t("watchdog.auto_disabled_alert")}</p>
      </AlertDescription>
    </Alert>
  );
}

// -----------------------------------------------------------------------------
// State tile — the single "what is it doing right now" focal element.
// -----------------------------------------------------------------------------
function StateTile({
  tone,
  icon,
  title,
  subtitle,
  pulse,
  reduceMotion,
}: {
  tone: HeroTone;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  pulse?: boolean;
  reduceMotion: boolean | null;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border p-4",
        TONE_TILE[tone],
      )}
    >
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-full border",
          TONE_RING[tone],
          pulse && !reduceMotion && "animate-pulse motion-reduce:animate-none",
        )}
      >
        {icon}
      </span>
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate text-base font-semibold">{title}</span>
        {subtitle && (
          <span className="text-muted-foreground text-sm">{subtitle}</span>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Hero ladder — a compact, read-only stepper of the four recovery tiers showing
// their SAVED enabled state and which one (if any) is running right now.
// -----------------------------------------------------------------------------
function HeroLadder({
  t,
  savedTiers,
  runningTier,
}: {
  t: (k: string, o?: Record<string, unknown>) => string;
  savedTiers: boolean[];
  runningTier: number;
}) {
  const names = [
    t("watchdog.tier_1_name"),
    t("watchdog.tier_2_name"),
    t("watchdog.tier_3_name"),
    t("watchdog.tier_4_name"),
  ];

  return (
    <div
      className="border-t pt-5"
      aria-label={t("watchdog.hero_ladder_label")}
      role="group"
    >
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">
          {t("watchdog.hero_ladder_label")}
        </span>
      </div>
      <ol className="flex items-center gap-1.5">
        {savedTiers.map((enabled, i) => {
          const tier = i + 1;
          const running = runningTier === tier;
          const srText = running
            ? t("watchdog.hero_ladder_step_running", { name: names[i] })
            : enabled
              ? t("watchdog.hero_ladder_step_enabled", { name: names[i] })
              : t("watchdog.hero_ladder_step_disabled", { name: names[i] });
          return (
            <li key={tier} className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                  running
                    ? "border-warning/40 bg-warning/15 text-warning ring-warning/30 ring-2"
                    : enabled
                      ? "border-transparent bg-secondary text-secondary-foreground"
                      : "border-border bg-muted/40 text-muted-foreground",
                )}
                aria-hidden
              >
                {tier}
              </span>
              <span className="sr-only">{srText}</span>
              {i < savedTiers.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "h-px min-w-4 flex-1",
                    enabled && savedTiers[i + 1] ? "bg-secondary" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
