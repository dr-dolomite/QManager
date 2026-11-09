"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { HistoryCursorProvider } from "@/components/history/history-cursor";
import { RangeControl } from "@/components/history/range-control";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { CellularHistory as CellularHistoryData, HistoryRange } from "@/types/history";

import { ConnectionCard } from "./connection-card";
import { summarise } from "./derive";
import { mockCellularHistory, type MockScenario } from "./mock-fixture";
import { RadioEventsCard } from "./radio-events-card";
import { HISTORY_PAGE } from "./shapes";
import { SignalCharts } from "./signal-charts";
import { CellularHistoryError, CellularHistorySkeleton } from "./states";
import { SummaryTiles } from "./summary-tiles";

// =============================================================================
// Cellular History — /history/cellular
// =============================================================================
// Header with the range control, then the summary strip, the connection strip,
// the four signal charts and the radio events table. The range and the shared
// cursor are the only page-level state; every card follows them.
//
// DATA ACCESS LIVES IN ONE PLACE: `useCellularHistoryMock`. It returns the same
// `{ data, isLoading, error, refresh }` as the real `useHistorySeries`, so the
// swap is one line. The mock scenario is read from `?mock=` so every state can
// be previewed (normal | empty | lte_only | error | loading).
// =============================================================================

const SCENARIOS: readonly MockScenario[] = ["normal", "empty", "lte_only", "error", "loading"];

function useMockScenario(): MockScenario {
  const param = useSearchParams().get("mock");
  return SCENARIOS.find((s) => s === param) ?? "normal";
}

interface HistoryResult {
  data: CellularHistoryData | null;
  isLoading: boolean;
  error: boolean;
  refresh: () => void;
}

/** TEMPORARY: stands in for `useHistorySeries<CellularState, CellularMetric>("cellular", range)`. */
function useCellularHistoryMock(range: HistoryRange, scenario: MockScenario): HistoryResult {
  const [nowSec] = React.useState(() => Math.floor(Date.now() / 1000));
  // An "error" scenario recovers after a retry, like a real transient failure.
  const [phase, setPhase] = React.useState<"idle" | "retrying" | "recovered">("idle");
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  const failing = scenario === "error" && phase === "idle";
  const loading = scenario === "loading" || phase === "retrying";
  const effective: MockScenario = scenario === "error" ? "normal" : scenario;

  const data = React.useMemo(
    () => (failing || loading ? null : mockCellularHistory(range, effective, nowSec)),
    [failing, loading, range, effective, nowSec],
  );

  const refresh = React.useCallback(() => {
    setPhase("retrying");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPhase("recovered"), 1100);
  }, []);

  return { data, isLoading: loading, error: failing, refresh };
}

export default function CellularHistory() {
  const { t } = useTranslation("history");
  const [range, setRange] = React.useState<HistoryRange>("24h");
  const scenario = useMockScenario();
  const { data, isLoading, error, refresh } = useCellularHistoryMock(range, scenario);

  const lteOnly = data ? summarise(data).lteOnly : false;

  return (
    <HistoryCursorProvider>
      <motion.div
        className={HISTORY_PAGE}
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem}>
          <CellularPageHeader
            title={t("cellular.page.title")}
            description={t("cellular.page.description")}
            actions={
              <RangeControl value={range} onChange={setRange} keyPrefix="cellular.range" />
            }
          />
        </motion.div>

        {isLoading ? (
          <CellularHistorySkeleton range={range} label={t("cellular.states.loading_sr")} />
        ) : error || !data ? (
          <CellularHistoryError onRetry={refresh} />
        ) : (
          <>
            <motion.div variants={staggerItem}>
              <SummaryTiles history={data} />
            </motion.div>
            <motion.div variants={staggerItem}>
              <ConnectionCard history={data} />
            </motion.div>
            <motion.div variants={staggerItem}>
              <SignalCharts history={data} lteOnly={lteOnly} />
            </motion.div>
            <motion.div variants={staggerItem}>
              <RadioEventsCard range={range} scenario={scenario} />
            </motion.div>
          </>
        )}
      </motion.div>
    </HistoryCursorProvider>
  );
}
