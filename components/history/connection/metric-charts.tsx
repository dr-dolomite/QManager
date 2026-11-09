"use client";

import { CHART_SPECS } from "./chart-metrics";
import { MetricChart, MetricChartSkeleton } from "./metric-chart";
import { SIGNALS_GRID, SIGNALS_GRID_INNER } from "./shapes";
import type { ConnectionHistory, ConnectionLimits } from "./types";

/**
 * Latency, packet loss, jitter and DNS lookup as a 2x2 grid of cards (one column
 * in a narrow container). The cards share the History cursor, so hovering any
 * plot marks the same moment on all four.
 */
export function MetricCharts({
  history,
  limits,
}: {
  history: ConnectionHistory;
  limits: ConnectionLimits;
}) {
  return (
    <div className={SIGNALS_GRID}>
      <div className={SIGNALS_GRID_INNER}>
        {CHART_SPECS.map((spec) => (
          <MetricChart key={spec.id} spec={spec} history={history} limits={limits} />
        ))}
      </div>
    </div>
  );
}

/** Skeleton for the same grid; mounts while the series loads. */
export function MetricChartsSkeleton() {
  return (
    <div className={SIGNALS_GRID}>
      <div className={SIGNALS_GRID_INNER}>
        {CHART_SPECS.map((spec) => (
          <MetricChartSkeleton key={spec.id} />
        ))}
      </div>
    </div>
  );
}
