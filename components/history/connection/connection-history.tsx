"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { HistoryCursorProvider } from "@/components/history/history-cursor";
import { RangeControl } from "@/components/history/range-control";
import { useModemStatus } from "@/hooks/use-modem-status";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { HistoryRange } from "@/types/history";

import { ConnectionEventsCard } from "./connection-events-card";
import { useConnectionSeries } from "./data";
import { withBuckets } from "./derive";
import { MetricCharts } from "./metric-charts";
import { ReachabilityCard } from "./reachability-card";
import { HISTORY_PAGE } from "./shapes";
import { SitesCard } from "./sites/sites-card";
import { ConnectionHistoryError, ConnectionHistorySkeleton } from "./states";
import { SummaryTiles } from "./summary-tiles";
import { DEFAULT_LIMITS, type ConnectionLimits } from "./types";

// =============================================================================
// Connection History: /monitoring/history/connection
// =============================================================================
// Header with the range control, then the summary strip, the reachability
// strip, the four metric charts, the Sites card and the connection events table.
// The range and the shared cursor are the only page-level state; every card
// follows them. The limits are the user's Connection Quality cuts.
// =============================================================================

/** The status feed only supplies the cuts, which change rarely. */
const LIMITS_POLL_MS = 30_000;

function useLimits(): ConnectionLimits {
  const thresholds = useModemStatus({ pollInterval: LIMITS_POLL_MS }).data?.connectivity
    ?.thresholds;
  const latencyMs = thresholds?.latency_ms;
  const lossPct = thresholds?.loss_pct;
  return React.useMemo(
    () => ({
      latencyMs: latencyMs && latencyMs > 0 ? latencyMs : DEFAULT_LIMITS.latencyMs,
      lossPct: lossPct && lossPct > 0 ? lossPct : DEFAULT_LIMITS.lossPct,
    }),
    [latencyMs, lossPct],
  );
}

export default function ConnectionHistory() {
  const { t } = useTranslation("history");
  const [range, setRange] = React.useState<HistoryRange>("24h");
  const { data, isLoading, error, refresh } = useConnectionSeries(range);
  const limits = useLimits();

  // A collector without a trusted clock answers with no buckets; the cards still
  // need a window to draw their collecting state in.
  const history = React.useMemo(() => (data ? withBuckets(data) : null), [data]);

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
            title={t("connection.page.title")}
            description={t("connection.page.description")}
            actions={<RangeControl value={range} onChange={setRange} keyPrefix="connection.range" />}
          />
        </motion.div>

        {isLoading ? (
          <ConnectionHistorySkeleton range={range} label={t("connection.states.loading_sr")} />
        ) : error || !history ? (
          <ConnectionHistoryError onRetry={refresh} />
        ) : (
          <>
            <motion.div variants={staggerItem}>
              <SummaryTiles history={history} limits={limits} />
            </motion.div>
            <motion.div variants={staggerItem}>
              <ReachabilityCard history={history} limits={limits} />
            </motion.div>
            <motion.div variants={staggerItem}>
              <MetricCharts history={history} limits={limits} />
            </motion.div>
            <motion.div variants={staggerItem}>
              <SitesCard range={range} latencyLimitMs={limits.latencyMs} />
            </motion.div>
            <motion.div variants={staggerItem}>
              <ConnectionEventsCard range={range} nowSec={history.now} />
            </motion.div>
          </>
        )}
      </motion.div>
    </HistoryCursorProvider>
  );
}
