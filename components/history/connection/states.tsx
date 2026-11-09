"use client";

import { useTranslation } from "react-i18next";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { HISTORY_RANGES, type HistoryRange } from "@/types/history";

import { MetricChartsSkeleton } from "./metric-charts";
import { ReachabilityCardSkeleton } from "./reachability-card";
import { EVENTS, HEADER_SHAPE, HISTORY_CARD } from "./shapes";
import { SummaryTilesSkeleton } from "./summary-tiles";

// =============================================================================
// Connection History: loading and error states
// =============================================================================
// The skeleton reproduces the loaded page from the same shape constants
// (summary tiles, the strip's bar count for the range, the chart plot height,
// the event table's row heights), so the handoff does not jump. The error
// condition replaces the whole body; it never falls through to empty cards.
// =============================================================================

function CardHeaderSkeleton() {
  return (
    <CardHeader className="gap-1 px-0">
      <div className={cn("flex flex-col", HEADER_SHAPE.GAP)}>
        <Skeleton className={cn(HEADER_SHAPE.TITLE, "rounded-inline")} />
        <Skeleton className={cn(HEADER_SHAPE.DESCRIPTION, "rounded-inline")} />
      </div>
    </CardHeader>
  );
}

export function ConnectionHistorySkeleton({
  range,
  label,
}: {
  range: HistoryRange;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <SummaryTilesSkeleton />
      <ReachabilityCardSkeleton count={HISTORY_RANGES[range].count} />
      <MetricChartsSkeleton />

      {/* The Sites card draws its own states once it mounts. */}
      <Card className={HISTORY_CARD}>
        <CardHeaderSkeleton />
        <Skeleton className="h-36 w-full rounded-field" />
      </Card>

      <Card className={HISTORY_CARD}>
        <CardHeaderSkeleton />
        <div className="flex flex-col">
          <Skeleton className={cn(EVENTS.HEAD_H, "rounded-inline")} />
          {Array.from({ length: EVENTS.SKELETON_ROWS }, (_, i) => (
            <div key={i} className={cn("flex items-center gap-3", EVENTS.ROW_H)}>
              <Skeleton className="size-[30px] flex-none rounded-pill" />
              <Skeleton className="h-4 w-52 rounded-inline" />
              <Skeleton className="ml-auto h-4 w-14 rounded-inline" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function ConnectionHistoryError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation("history");
  return (
    <ConditionScreen
      tone="destructive"
      glyph="cloud_off"
      ariaRole="alert"
      title={t("connection.states.error.title")}
      description={t("connection.states.error.description")}
      onRetry={onRetry}
      retryLabel={t("connection.states.retry")}
    />
  );
}
