"use client";

import type { CellularHistory } from "@/types/history";

import { SignalChart, SignalChartSkeleton } from "./signal-chart";
import { SIGNAL_METRICS } from "./signal-metrics";
import { SIGNALS_GRID, SIGNALS_GRID_INNER } from "./signal-shapes";

export interface SignalChartsProps {
  history: CellularHistory;
  /** Hide the 5G NR series and its legend everywhere. */
  lteOnly: boolean;
}

/**
 * RSRP, SINR, RSRQ and RSSI as a 2x2 grid of cards (one column in a narrow
 * container). The cards share the History cursor, so hovering any plot marks
 * the same moment on all four.
 */
export function SignalCharts({ history, lteOnly }: SignalChartsProps) {
  return (
    <div className={SIGNALS_GRID}>
      <div className={SIGNALS_GRID_INNER}>
        {SIGNAL_METRICS.map((spec) => (
          <SignalChart key={spec.id} spec={spec} history={history} lteOnly={lteOnly} />
        ))}
      </div>
    </div>
  );
}

/** Skeleton for the same grid; mounts while the series loads. */
export function SignalChartsSkeleton() {
  return (
    <div className={SIGNALS_GRID}>
      <div className={SIGNALS_GRID_INNER}>
        {SIGNAL_METRICS.map((spec) => (
          <SignalChartSkeleton key={spec.id} spec={spec} />
        ))}
      </div>
    </div>
  );
}
