"use client";

import React, { useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2Icon,
  AlertCircleIcon,
  MinusCircleIcon,
  PauseIcon,
  Loader2,
  RadarIcon,
  RefreshCcwIcon,
  AlertTriangleIcon,
  PlayIcon,
} from "lucide-react";
import { formatTimeAgo } from "@/types/modem-status";

const CONTROL_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/control.sh";

// =============================================================================
// CellMapperStatusCard — Shows collector, GPS, adapter, account status, and
// the last measurement block, with Pause/Resume and Restart action buttons.
// =============================================================================

interface CellMapperStatusCardProps {
  onRefresh?: () => void;
  status: {
    service: {
      enabled: boolean;
      collector_state: "running" | "paused" | "stopped" | "error" | "starting";
      uploader_state: "running" | "idle" | "error";
      last_measurement: {
        type: string;
        provider: string;
        band: string;
        signal: number;
        timestamp: number;
      } | null;
      last_upload: {
        timestamp: number;
        batch_size: number;
        status: string;
      } | null;
    };
    account: {
      linked: boolean;
      username: string | null;
      linked_at: number | null;
    };
    gps: {
      source: string;
      fix: {
        type: string;
        lat: number;
        lon: number;
        alt: number;
        sats: number;
        speed_kmh: number;
        hdop: number;
      } | null;
    };
    adapter: {
      detected: boolean;
      name: string | null;
    };
    errors: Array<{
      ts: number;
      source: string;
      msg: string;
      count: number;
    }>;
  } | null;
  isLoading: boolean;
  isStale: boolean;
  lastUpdated: number | null;
}

// ─── Badge style maps ────────────────────────────────────────────────────────

const COLLECTOR_BADGE: Record<
  string,
  { className: string; icon: React.ReactNode }
> = {
  running: {
    className:
      "bg-success/15 text-success hover:bg-success/20 border-success/30",
    icon: <CheckCircle2Icon className="h-3 w-3" />,
  },
  paused: {
    className:
      "bg-warning/15 text-warning hover:bg-warning/20 border-warning/30",
    icon: <PauseIcon className="h-3 w-3" />,
  },
  error: {
    className:
      "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30 animate-pulse motion-reduce:animate-none",
    icon: <AlertCircleIcon className="h-3 w-3" />,
  },
  stopped: {
    className:
      "bg-muted/50 text-muted-foreground border-muted-foreground/30",
    icon: <MinusCircleIcon className="h-3 w-3" />,
  },
  starting: {
    className:
      "bg-info/15 text-info hover:bg-info/20 border-info/30",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
};

const GPS_BADGE: Record<
  string,
  { className: string; icon: React.ReactNode }
> = {
  "3D": {
    className:
      "bg-success/15 text-success hover:bg-success/20 border-success/30",
    icon: <RadarIcon className="h-3 w-3" />,
  },
  "2D": {
    className:
      "bg-warning/15 text-warning hover:bg-warning/20 border-warning/30",
    icon: <RadarIcon className="h-3 w-3" />,
  },
  none: {
    className:
      "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30 animate-pulse motion-reduce:animate-none",
    icon: <AlertCircleIcon className="h-3 w-3" />,
  },
};

// ─── Component ───────────────────────────────────────────────────────────────

export function CellMapperStatusCard({
  status,
  isLoading,
  isStale,
  lastUpdated,
  onRefresh,
}: CellMapperStatusCardProps) {
  const { t } = useTranslation("monitoring");
  const [controlLoading, setControlLoading] = useState<"pause" | "resume" | "restart" | null>(null);

  const sendControlAction = useCallback(
    async (action: "pause" | "resume" | "restart") => {
      setControlLoading(action);
      try {
        const resp = await authFetch(CONTROL_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await resp.json();
        if (data.success) {
          toast.success(data.message ?? `Collector ${action} successful`);
          onRefresh?.();
        } else {
          toast.error(data.detail ?? data.error ?? `Failed to ${action} collector`);
        }
      } catch {
        toast.error(`Failed to ${action} collector`);
      } finally {
        setControlLoading(null);
      }
    },
    [onRefresh],
  );

  // Compute human-readable "ago" string for stale warnings
  const staleAgo = useMemo(() => {
    if (lastUpdated === null) return "";
    const seconds = Math.round((Date.now() - lastUpdated) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.round(minutes / 60)}h`;
  }, [lastUpdated]);

  // ── Collector badge label map (i18n, memoised) ──────────────────────────
  const collectorBadgeLabels = useMemo<Record<string, string>>(
    () => ({
      running: t("cellmapper.collector_state_running"),
      paused: t("cellmapper.collector_state_paused"),
      stopped: t("cellmapper.collector_state_stopped"),
      error: t("cellmapper.collector_state_error"),
      starting: t("cellmapper.collector_state_starting"),
    }),
    [t],
  );

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("cellmapper.status_title")}</CardTitle>
          <CardDescription>{t("cellmapper.status_description")}</CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex justify-between items-center">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-32" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Derive values from status ─────────────────────────────────────────────
  const service = status?.service;
  const account = status?.account;
  const gps = status?.gps;
  const adapter = status?.adapter;

  const collectorState = service?.collector_state ?? "stopped";
  const collectorBadge =
    COLLECTOR_BADGE[collectorState] ?? COLLECTOR_BADGE.stopped;
  const collectorLabel =
    collectorBadgeLabels[collectorState] ?? collectorBadgeLabels.stopped;

  // GPS badge
  const gpsFix = gps?.fix ?? null;
  const gpsFixType = gpsFix?.type ?? "none";
  const gpsBadge = GPS_BADGE[gpsFixType] ?? GPS_BADGE.none;
  const gpsLabel = gpsFix
    ? t("cellmapper.gps_sats", { type: gpsFixType, sats: gpsFix.sats })
    : t("cellmapper.gps_no_fix");

  // Account badge
  const isLinked = account?.linked ?? false;
  const accountBadge = isLinked
    ? {
        className:
          "bg-success/15 text-success hover:bg-success/20 border-success/30",
        icon: <CheckCircle2Icon className="h-3 w-3" />,
        label: account?.username ?? t("cellmapper.account_linked"),
      }
    : {
        className:
          "bg-muted/50 text-muted-foreground border-muted-foreground/30",
        icon: <MinusCircleIcon className="h-3 w-3" />,
        label: t("cellmapper.account_not_linked"),
      };

  // Last measurement
  const lastMeasurement = service?.last_measurement ?? null;

  // Pause/Resume toggle
  const isPaused = collectorState === "paused";

  // ── Definition-list rows ──────────────────────────────────────────────────
  const statusRows: { label: string; value: React.ReactNode }[] = [
    {
      label: t("cellmapper.row_collector"),
      value: (
        <AnimatePresence mode="wait">
          <motion.div
            key={collectorState}
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{
              duration: 0.18,
              type: "spring",
              stiffness: 400,
              damping: 24,
            }}
          >
            <Badge variant="outline" className={collectorBadge.className}>
              {collectorBadge.icon}
              {collectorLabel}
            </Badge>
          </motion.div>
        </AnimatePresence>
      ),
    },
    {
      label: t("cellmapper.row_gps"),
      value: (
        <AnimatePresence mode="wait">
          <motion.div
            key={gpsFixType}
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{
              duration: 0.18,
              type: "spring",
              stiffness: 400,
              damping: 24,
            }}
          >
            <Badge variant="outline" className={gpsBadge.className}>
              {gpsBadge.icon}
              {gpsLabel}
            </Badge>
          </motion.div>
        </AnimatePresence>
      ),
    },
    {
      label: t("cellmapper.row_adapter"),
      value: adapter?.detected && adapter?.name ? (
        <span className="text-sm font-semibold">{adapter.name}</span>
      ) : (
        <span className="text-sm font-semibold text-muted-foreground">
          {t("cellmapper.adapter_not_detected")}
        </span>
      ),
    },
    {
      label: t("cellmapper.row_account"),
      value: (
        <Badge variant="outline" className={accountBadge.className}>
          {accountBadge.icon}
          {accountBadge.label}
        </Badge>
      ),
    },
  ];

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("cellmapper.status_title")}</CardTitle>
        <CardDescription>{t("cellmapper.status_description")}</CardDescription>
      </CardHeader>
      <CardContent aria-live="polite">
        <div className="grid gap-2">
          {/* Stale data warning ------------------------------------------------ */}
          {isStale && (
            <Alert>
              <AlertTriangleIcon className="size-4" />
              <AlertDescription>
                {t("cellmapper.stale_data_warning", { ago: staleAgo })}
              </AlertDescription>
            </Alert>
          )}

          {/* Status rows -------------------------------------------------------- */}
          <motion.div
            className="grid gap-2"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: {
                transition: {
                  staggerChildren: 0.05,
                  delayChildren: 0.05,
                },
              },
            }}
          >
            {statusRows.map((row) => (
              <motion.div
                key={row.label}
                variants={{
                  hidden: { opacity: 0, x: -6 },
                  visible: { opacity: 1, x: 0 },
                }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <Separator />
                <div className="flex items-center justify-between pt-2">
                  <p className="text-sm font-semibold text-muted-foreground">
                    {row.label}
                  </p>
                  <div className="text-sm font-semibold">{row.value}</div>
                </div>
              </motion.div>
            ))}
          </motion.div>

          {/* Last measurement block --------------------------------------------- */}
          <Separator />
          <div className="pt-1 space-y-0.5">
            <p className="text-sm font-semibold text-muted-foreground">
              {t("cellmapper.row_last_measurement")}
            </p>
            {lastMeasurement ? (
              <div className="pl-0 pt-1">
                <p className="text-sm font-semibold">
                  {lastMeasurement.provider} · {lastMeasurement.band}
                </p>
                <p className="text-sm text-muted-foreground">
                  {lastMeasurement.signal} dBm ·{" "}
                  {formatTimeAgo(lastMeasurement.timestamp)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground pt-1">
                {t("cellmapper.last_measurement_waiting")}
              </p>
            )}
          </div>

          {/* Action buttons ----------------------------------------------------- */}
          <Separator />
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                sendControlAction(isPaused ? "resume" : "pause")
              }
              disabled={
                collectorState === "error" ||
                collectorState === "starting" ||
                controlLoading !== null
              }
            >
              {controlLoading === "pause" || controlLoading === "resume" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isPaused ? (
                <>
                  <PlayIcon className="size-3.5" />
                  {t("cellmapper.action_resume")}
                </>
              ) : (
                <>
                  <PauseIcon className="size-3.5" />
                  {t("cellmapper.action_pause")}
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sendControlAction("restart")}
              disabled={controlLoading !== null}
            >
              {controlLoading === "restart" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCcwIcon className="size-3.5" />
              )}
              {t("cellmapper.action_restart")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
