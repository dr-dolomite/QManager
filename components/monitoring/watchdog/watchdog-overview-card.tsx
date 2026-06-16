"use client";

import React, { useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
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
import { Skeleton } from "@/components/ui/skeleton";
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
import type { WatchdogForm } from "./use-watchdog-form";

interface WatchdogOverviewCardProps {
  form: WatchdogForm;
  autoDisabled: boolean;
  revertSim: () => Promise<boolean>;
}

type HeroTone = "success" | "warning" | "destructive" | "info" | "muted";

const STATE_META: Record<
  WatchcatState,
  { tone: HeroTone; icon: React.ReactNode; pulse?: boolean }
> = {
  monitor: { tone: "success", icon: <CheckCircle2Icon className="size-5" /> },
  suspect: { tone: "warning", icon: <TriangleAlertIcon className="size-5" /> },
  recovery: {
    tone: "destructive",
    icon: <AlertCircleIcon className="size-5" />,
    pulse: true,
  },
  cooldown: { tone: "info", icon: <ClockIcon className="size-5" /> },
  locked: { tone: "muted", icon: <LockIcon className="size-5" /> },
  disabled: { tone: "muted", icon: <MinusCircleIcon className="size-5" /> },
  // Calm, patient — the modem is self-healing a baseband restart and we are
  // deliberately holding off. Info tone (never destructive); the Activity icon
  // reads as "vitals recovering" and a gentle pulse signals it is in progress.
  ssr_hold: {
    tone: "info",
    icon: <ActivityIcon className="size-5" />,
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

export function WatchdogOverviewCard({
  form,
  autoDisabled,
  revertSim,
}: WatchdogOverviewCardProps) {
  const { t } = useTranslation("monitoring");
  const { data: modemStatus, isLoading } = useModemStatus({ pollInterval: 5000 });
  const [isReverting, setIsReverting] = useState(false);

  const tierLabels = useMemo<Record<number, string>>(
    () => ({
      0: t("watchdog.tier_label_none"),
      1: t("watchdog.tier_label_1"),
      2: t("watchdog.tier_label_2"),
      3: t("watchdog.tier_label_3"),
      4: t("watchdog.tier_label_4"),
    }),
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
  const simFailover = modemStatus?.sim_failover;
  const daemonReporting = watchcat?.enabled;
  // Master switch tracks the FORM value (applies on save), not the live daemon.
  const masterOn = form.isEnabled;

  const header = (
    <CardHeader>
      <CardTitle>{t("watchdog.status_title")}</CardTitle>
      <CardDescription>{t("watchdog.overview_description")}</CardDescription>
      <CardAction>
        <Switch
          id="watchdog-enabled"
          checked={masterOn}
          onCheckedChange={form.setIsEnabled}
          aria-label={t("watchdog.enable_label")}
        />
      </CardAction>
    </CardHeader>
  );

  // ---- Loading ----
  if (isLoading) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-16 w-full rounded-lg" />
            <div className="grid grid-cols-2 gap-2.5 @sm/card:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- Master off (settings disabled, regardless of daemon) ----
  if (!masterOn) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent>
          {autoDisabled && <AutoDisabledAlert />}
          <StateHero
            tone="muted"
            icon={<PowerOffIcon className="size-5" />}
            title={t("watchdog.state_off_title")}
            subtitle={t("watchdog.state_off_subtitle")}
          />
        </CardContent>
      </Card>
    );
  }

  // ---- Enabled in settings but daemon hasn't reported yet ----
  if (!daemonReporting) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent>
          {autoDisabled && <AutoDisabledAlert />}
          <StateHero
            tone="info"
            icon={<Loader2 className="size-5 animate-spin motion-reduce:animate-none" />}
            title={t("watchdog.state_starting_title")}
            subtitle={t("watchdog.status_starting")}
          />
        </CardContent>
      </Card>
    );
  }

  // ---- Live ----
  const stateKey = (watchcat!.state as WatchcatState) || "disabled";
  const meta = STATE_META[stateKey] ?? STATE_META.disabled;

  const tiles: { label: string; value: React.ReactNode; key: string }[] = [
    {
      key: "step",
      label: t("watchdog.status_row_current_step"),
      value: tierLabels[watchcat!.current_tier] || tierLabels[0],
    },
    {
      key: "failed",
      label: t("watchdog.status_row_failed_checks"),
      value: <span className="tabular-nums">{watchcat!.failure_count}</span>,
    },
    {
      key: "recoveries",
      label: t("watchdog.status_row_total_recoveries"),
      value: <span className="tabular-nums">{watchcat!.total_recoveries}</span>,
    },
    {
      key: "reboots",
      label: t("watchdog.status_row_reboots_this_hour"),
      value: <span className="tabular-nums">{watchcat!.reboots_this_hour}</span>,
    },
    {
      // Always shown; reads "—" until a cooldown is actually counting down.
      key: "cooldown",
      label: t("watchdog.status_row_cooldown"),
      value:
        watchcat!.cooldown_remaining > 0 ? (
          <span className="tabular-nums">
            {t("watchdog.status_cooldown_remaining", {
              count: watchcat!.cooldown_remaining,
            })}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      // Always shown; reads "—" until the watchdog has recovered at least once.
      key: "last",
      label: t("watchdog.status_row_last_recovery"),
      value:
        watchcat!.last_recovery_time != null ? (
          <span className="truncate">
            {tierLabels[watchcat!.last_recovery_tier ?? 0]}
            <span className="text-muted-foreground">
              {" · "}
              {formatTimeAgo(watchcat!.last_recovery_time)}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <Card className="@container/card">
      {header}
      <CardContent>
        {autoDisabled && <AutoDisabledAlert />}

        <AnimatePresence mode="wait">
          <motion.div
            key={stateKey}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: DUR.base, ease: EASE_OUT_EXPO }}
          >
            <StateHero
              tone={meta.tone}
              icon={meta.icon}
              pulse={meta.pulse}
              title={stateLabels[stateKey] ?? stateLabels.disabled}
              subtitle={stateBlurbs[stateKey] ?? ""}
            />
          </motion.div>
        </AnimatePresence>

        <div className="mt-4 grid grid-cols-2 gap-2.5 @sm/card:grid-cols-3">
          {tiles.map((tile) => (
            <StatTile key={tile.key} label={tile.label} value={tile.value} />
          ))}
        </div>

        {simFailover?.active && (
          <div className="mt-4 border-t pt-4">
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

  function AutoDisabledAlert() {
    return (
      <Alert variant="destructive" className="mb-4">
        <TriangleAlertIcon className="size-4" />
        <AlertDescription>
          <p>{t("watchdog.auto_disabled_alert")}</p>
        </AlertDescription>
      </Alert>
    );
  }
}

// -----------------------------------------------------------------------------
// State hero — the single "what is it doing right now" focal element.
// -----------------------------------------------------------------------------
function StateHero({
  tone,
  icon,
  title,
  subtitle,
  pulse,
}: {
  tone: HeroTone;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  pulse?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full border",
          TONE_RING[tone],
          pulse && "animate-pulse motion-reduce:animate-none",
        )}
      >
        {icon}
      </span>
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate text-base font-semibold">{title}</span>
        {subtitle && (
          <span className="text-muted-foreground truncate text-xs">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Stat tile — the Live Data Tile atom: a label over a tabular value.
// -----------------------------------------------------------------------------
function StatTile({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 rounded-lg border bg-card p-3">
      <span className="text-muted-foreground truncate text-xs font-medium">
        {label}
      </span>
      <span className="truncate text-sm font-semibold">{value}</span>
    </div>
  );
}
