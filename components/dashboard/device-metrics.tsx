"use client";

import React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  TbAlertTriangleFilled,
  TbCircleArrowDownFilled,
  TbCircleArrowUpFilled,
  TbInfoCircleFilled,
} from "react-icons/tb";

import type { DeviceStatus, LteStatus, NrStatus } from "@/types/modem-status";
import {
  formatBitsPerSec,
  formatUptime,
  calculateLteDistance,
  calculateNrDistance,
  formatDistance,
  formatTemperature,
} from "@/types/modem-status";
import { useUnitPreferences } from "@/hooks/use-system-settings";
import { useBandwidthSettings } from "@/hooks/use-bandwidth-settings";
import { useBandwidthMonitor } from "@/hooks/use-bandwidth-monitor";
import { useTranslation } from "react-i18next";

interface DeviceMetricsComponentProps {
  deviceData: DeviceStatus | null;
  lteData: LteStatus | null;
  nrData: NrStatus | null;
  /**
   * Live LTE Timing Advance from the on-demand radio-details endpoint.
   * Preferred while the page is mounted; falls back to the poller's last-known
   * `lteData.ta` when null/undefined (before first on-demand fetch / stale).
   */
  liveLteTa?: number | null;
  /** Live NR Timing Advance (NTA) from the on-demand endpoint; same fallback rule. */
  liveNrTa?: number | null;
  isLoading: boolean;
}

// --- Warning thresholds ---
const TEMP_WARN = 60; // °C
const TEMP_DANGER = 75; // °C
const CPU_WARN = 70; // percentage
const CPU_DANGER = 90; // percentage

// --- Animated metric progress bar ---
function MetricBar({
  value,
  max = 100,
  warnAt,
  dangerAt,
}: {
  value: number;
  max?: number;
  warnAt: number;
  dangerAt: number;
}) {
  const pct = Math.min((value / max) * 100, 100);
  const colorClass =
    value >= dangerAt
      ? "bg-destructive"
      : value >= warnAt
        ? "bg-warning"
        : "bg-primary";
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <motion.div
        className={cn("h-full rounded-full", colorClass)}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: pct / 100 }}
        style={{ originX: 0 }}
        transition={{ type: "spring", stiffness: 180, damping: 24 }}
      />
    </div>
  );
}

// =============================================================================
// LiveTrafficRow — the 5-state Live Traffic row
// =============================================================================
// Driven SOLELY by the opt-in WebSocket bandwidth monitor. There is NO poller
// `.traffic` fallback. Composes:
//   - useBandwidthSettings → is the feature enabled? is websocat installed?
//   - useBandwidthMonitor  → live connection flags + rx/tx speeds
// into ONE row whose left label never moves; only the trailing right-hand slot
// changes between the five mutually-exclusive states:
//   loading | disabled | connecting | connected | unavailable
// =============================================================================

type LiveTrafficState =
  | "loading"
  | "disabled"
  | "connecting"
  | "connected"
  | "unavailable";

// A quiet pulsing status dot shared by connecting/connected.
function StatusDot({
  tone,
  reduceMotion,
}: {
  tone: "muted" | "success";
  reduceMotion: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        tone === "success" ? "bg-success" : "bg-muted-foreground/60",
        !reduceMotion && "animate-pulse",
      )}
    />
  );
}

function LiveTrafficRow() {
  const { t } = useTranslation("dashboard");
  const reduceMotion = useReducedMotion();

  // Settings: tells us whether the feature is on and whether the dependency is present.
  const {
    settings,
    dependencies,
    isLoading: settingsLoading,
  } = useBandwidthSettings();

  // Live monitor: connection flags + live speeds (bits/s).
  const { isConnected, wsError, currentDownload, currentUpload } =
    useBandwidthMonitor();

  // Derive the single state discriminant.
  const state: LiveTrafficState = settingsLoading
    ? "loading"
    : !settings?.enabled
      ? "disabled"
      : isConnected
        ? "connected"
        : wsError
          ? "unavailable"
          : "connecting";

  const websocatMissing = dependencies?.websocat_installed === false;

  let trailing: React.ReactNode;

  switch (state) {
    case "loading":
      trailing = <Skeleton className="h-4 w-28" />;
      break;

    case "disabled":
      // Off by config. Never a fake "0 Mbps" — tell the truth, then offer the switch.
      trailing = websocatMissing ? (
        // Dependency missing: a toggle won't help. Quiet hint + tooltip, no dead link.
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-sm">
            {t("metrics.live_traffic_unavailable")}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex"
                aria-label={t("metrics.live_traffic_status_aria")}
              >
                <TbInfoCircleFilled className="size-3 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-[16rem]">
                {t("metrics.live_traffic_missing_dependency_tooltip")}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">
            {t("metrics.live_traffic_off")}
          </span>
          <span aria-hidden="true" className="text-muted-foreground/50">
            ·
          </span>
          <Link
            href="/system-settings/bandwidth-monitor"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("metrics.live_traffic_turn_on")}
          </Link>
        </div>
      );
      break;

    case "connecting":
      trailing = (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <StatusDot tone="muted" reduceMotion={reduceMotion} />
          <span>{t("metrics.live_traffic_connecting")}</span>
        </div>
      );
      break;

    case "connected":
      trailing = (
        <div className="flex items-center gap-x-2">
          <div className="flex items-center gap-1">
            <TbCircleArrowDownFilled className="text-info size-5" />
            <p className="font-semibold text-sm tabular-nums">
              {formatBitsPerSec(currentDownload)}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <TbCircleArrowUpFilled className="text-purple-500 size-5" />
            <p className="font-semibold text-sm tabular-nums">
              {formatBitsPerSec(currentUpload)}
            </p>
          </div>
        </div>
      );
      break;

    case "unavailable":
      // Enabled but the live feed dropped. The hook auto-reconnects with backoff,
      // so there is no manual retry control — the tooltip tells the honest story.
      trailing = (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-sm">
            {t("metrics.live_traffic_unavailable")}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex"
                aria-label={t("metrics.live_traffic_status_aria")}
              >
                <TbAlertTriangleFilled className="size-3 text-warning" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-[16rem]">
                {t("metrics.live_traffic_reconnecting_tooltip")}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      );
      break;
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <p className="font-semibold text-muted-foreground text-sm">
          {t("metrics.live_traffic")}
        </p>
        {state === "connected" && (
          <Badge
            variant="outline"
            className="bg-success/15 text-success border-success/30 gap-1 px-1.5 py-0 text-[10px]"
          >
            <StatusDot tone="success" reduceMotion={reduceMotion} />
            {t("metrics.live_traffic_live_badge")}
          </Badge>
        )}
      </div>
      {/* Cross-fade only the trailing slot when the state flips; the label never moves. */}
      <motion.div
        key={state}
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        aria-live="polite"
      >
        {trailing}
      </motion.div>
    </div>
  );
}

const DeviceMetricsComponent = ({
  deviceData,
  lteData,
  nrData,
  liveLteTa,
  liveNrTa,
  isLoading,
}: DeviceMetricsComponentProps) => {
  const { t } = useTranslation("dashboard");
  const unitPrefs = useUnitPreferences();
  const temp = deviceData?.temperature ?? null;
  const cpu = deviceData?.cpu_usage ?? null;
  const memUsed = deviceData?.memory_used_mb ?? 0;
  const memTotal = deviceData?.memory_total_mb ?? 0;

  // Uptime values — read directly from poll data (no seconds displayed,
  // so no need for 1-second client-side interpolation)
  const displayDevUptime = deviceData?.uptime_seconds ?? 0;
  const displayConnUptime = deviceData?.conn_uptime_seconds ?? 0;

  const isTempHigh = temp !== null && temp >= TEMP_WARN;
  const isCpuHigh = cpu !== null && cpu >= CPU_WARN;
  const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
  // Prefer the live on-demand TA; fall back to the poller's last-known value.
  const lteTa = liveLteTa ?? lteData?.ta ?? null;
  const nrTa = liveNrTa ?? nrData?.ta ?? null;
  const lteDistance =
    lteTa !== null && lteTa > 0 ? calculateLteDistance(lteTa) : null;
  const nrDistance =
    nrTa !== null && nrTa > 0 ? calculateNrDistance(nrTa) : null;

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader className="-mb-4">
          <CardTitle className="text-lg font-semibold">
            {t("metrics.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i}>
                <Separator />
                <div className="flex items-center justify-between py-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader className="-mb-4">
        <CardTitle className="text-lg font-semibold tabular-nums">
          {t("metrics.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {/* Modem Temperature */}
          <Separator />
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">
                {t("metrics.modem_temperature")}
              </p>
              <div className="flex items-center gap-1.5">
                {isTempHigh && (
                  <Badge className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30">
                    <TbAlertTriangleFilled className="text-warning" />
                    {t("metrics.high_temp_warning")}
                  </Badge>
                )}
                <p className="font-semibold text-sm tabular-nums">
                  {formatTemperature(temp, unitPrefs?.tempUnit)}
                </p>
              </div>
            </div>
            {temp !== null && (
              <MetricBar
                value={temp}
                max={100}
                warnAt={TEMP_WARN}
                dangerAt={TEMP_DANGER}
              />
            )}
          </div>

          {/* CPU Usage */}
          <Separator />
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">
                {t("metrics.cpu_usage")}
              </p>
              <div className="flex items-center gap-1.5">
                {isCpuHigh && (
                  <Badge className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30">
                    <TbAlertTriangleFilled className="text-warning" />
                    {t("metrics.high_cpu_warning")}
                  </Badge>
                )}
                <p className="font-semibold text-sm tabular-nums">
                  {cpu !== null ? `${cpu}%` : "-"}
                </p>
              </div>
            </div>
            {cpu !== null && (
              <MetricBar
                value={cpu}
                max={100}
                warnAt={CPU_WARN}
                dangerAt={CPU_DANGER}
              />
            )}
          </div>

          {/* Memory Usage */}
          <Separator />
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">
                {t("metrics.memory_usage")}
              </p>
              <p className="font-semibold text-sm tabular-nums">
                {memTotal > 0 ? `${memUsed} MB / ${memTotal} MB` : "-"}
              </p>
            </div>
            {memTotal > 0 && (
              <MetricBar value={memPct} max={100} warnAt={70} dangerAt={90} />
            )}
          </div>

          {/* Live Traffic — driven solely by the opt-in WebSocket monitor */}
          <Separator />
          <LiveTrafficRow />

          {/* LTE Cell Distance */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              {t("metrics.lte_cell_distance")}
            </p>

            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex"
                    aria-label={t("metrics.more_info_aria")}
                  >
                    <TbInfoCircleFilled className="size-5 text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {/* Will show in Hexadecimal form */}
                  {lteTa !== null && lteTa > 0 ? (
                    <p>{t("metrics.lte_distance_tooltip", { ta: lteTa })}</p>
                  ) : (
                    <p>{t("metrics.ta_unavailable")}</p>
                  )}
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-sm tabular-nums">
                {formatDistance(lteDistance, unitPrefs?.distanceUnit)}
              </p>
            </div>
          </div>

          {/* NR Cell Distance */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              {t("metrics.nr_cell_distance")}
            </p>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex"
                    aria-label={t("metrics.more_info_aria")}
                  >
                    <TbInfoCircleFilled className="size-5 text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {/* Will show in Hexadecimal form */}
                  {nrTa !== null && nrTa > 0 ? (
                    <p>{t("metrics.nr_distance_tooltip", { ta: nrTa })}</p>
                  ) : (
                    <p>{t("metrics.ta_unavailable")}</p>
                  )}
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-sm tabular-nums">
                {formatDistance(nrDistance, unitPrefs?.distanceUnit)}
              </p>
            </div>
          </div>

          {/* Connection Uptime */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              {t("metrics.connection_uptime")}
            </p>
            <p className="font-semibold text-sm tabular-nums">
              {displayConnUptime > 0 ? formatUptime(displayConnUptime) : "-"}
            </p>
          </div>

          {/* Device Uptime */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              {t("metrics.device_uptime")}
            </p>
            <p className="font-semibold text-sm tabular-nums">
              {displayDevUptime > 0 ? formatUptime(displayDevUptime) : "-"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DeviceMetricsComponent;
