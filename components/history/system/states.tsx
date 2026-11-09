"use client";

import { useTranslation } from "react-i18next";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { MetricChartCardSkeleton } from "./metric-chart-card";
import { CardHeaderSkeleton } from "./parts";
import { EVENTS, HISTORY_CARD, METRICS_GRID } from "./shapes";
import { StabilityCardSkeleton } from "./stability-card";
import { StorageCardSkeleton } from "./storage-card";
import { SummaryTilesSkeleton } from "./summary-tiles";

// =============================================================================
// System Health: loading, error, collecting and empty states
// =============================================================================
// The skeleton reproduces the loaded page from the same shape constants, so the
// handoff does not jump. The error and collecting conditions replace the whole
// body; they never fall through to empty cards.
// =============================================================================

export function EventsCardSkeleton() {
  return (
    <Card className={HISTORY_CARD}>
      <CardHeaderSkeleton />
      <div className="flex flex-col">
        <Skeleton className="mb-1 h-4 w-14 rounded-inline" />
        {Array.from({ length: EVENTS.SKELETON_ROWS }, (_, i) => (
          <div key={i} className={EVENTS.ROW}>
            <div className="flex items-center gap-3">
              <Skeleton className="size-8 flex-none rounded-pill" />
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-52 max-w-full rounded-inline" />
                <Skeleton className="h-4 w-28 rounded-inline" />
              </div>
            </div>
            <Skeleton className="h-4 w-10 rounded-inline" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function SystemHealthSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <SummaryTilesSkeleton />
      <StabilityCardSkeleton />
      <div className={METRICS_GRID}>
        <MetricChartCardSkeleton kind="cpu" />
        <MetricChartCardSkeleton kind="mem" />
        <MetricChartCardSkeleton kind="temp" />
        <StorageCardSkeleton />
      </div>
      <EventsCardSkeleton />
    </div>
  );
}

export function SystemHealthError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation("history");
  return (
    <ConditionScreen
      tone="destructive"
      glyph="cloud_off"
      ariaRole="alert"
      title={t("system.states.error.title")}
      description={t("system.states.error.description")}
      onRetry={onRetry}
      retryLabel={t("system.states.retry")}
    />
  );
}

/** Nothing stored yet: a new install, or a clock the modem does not trust. */
export function SystemHealthCollecting({ clockTrusted }: { clockTrusted: boolean }) {
  const { t } = useTranslation("history");
  return (
    <ConditionScreen
      tone="neutral"
      glyph={clockTrusted ? "hourglass_top" : "schedule"}
      ariaRole="status"
      title={t(clockTrusted ? "system.states.collecting.title" : "system.states.clock.title")}
      description={t(
        clockTrusted ? "system.states.collecting.description" : "system.states.clock.description",
      )}
    />
  );
}
