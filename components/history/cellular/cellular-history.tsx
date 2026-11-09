"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { HistoryCursorProvider } from "@/components/history/history-cursor";
import { RangeControl } from "@/components/history/range-control";
import { useHistorySeries } from "@/hooks/use-history";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { CellularMetric, CellularState, HistoryRange } from "@/types/history";

import { ConnectionCard } from "./connection-card";
import { summarise } from "./derive";
import { RadioEventsCard } from "./radio-events-card";
import { HISTORY_PAGE } from "./shapes";
import { SignalCharts } from "./signal-charts";
import { CellularHistoryError, CellularHistorySkeleton } from "./states";
import { SummaryTiles } from "./summary-tiles";

// =============================================================================
// Cellular History — /monitoring/history/cellular
// =============================================================================
// Header with the range control, then the summary strip, the connection strip,
// the four signal charts and the radio events table. The range and the shared
// cursor are the only page-level state; every card follows them.
//
// Data: `useHistorySeries` for the series; the events card reads its own page
// through `useHistoryEvents`. A new install or an untrusted clock answers with
// no buckets and `since: null`, which every card renders as "Collecting", not
// as an error. The hook keeps the previous range on screen while the next one
// loads, so the skeleton only shows on the first fetch.
// =============================================================================

export default function CellularHistory() {
  const { t } = useTranslation("history");
  const [range, setRange] = React.useState<HistoryRange>("24h");
  const { data, error, refresh } = useHistorySeries<CellularState, CellularMetric>(
    "cellular",
    range,
  );

  // An empty window (collecting) is not "LTE only": keep every chart.
  const lteOnly = data && data.buckets.length > 0 ? summarise(data).lteOnly : false;

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

        {error ? (
          <CellularHistoryError onRetry={refresh} />
        ) : !data ? (
          <CellularHistorySkeleton range={range} label={t("cellular.states.loading_sr")} />
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
              <RadioEventsCard range={range} nowSec={data.now} />
            </motion.div>
          </>
        )}
      </motion.div>
    </HistoryCursorProvider>
  );
}
