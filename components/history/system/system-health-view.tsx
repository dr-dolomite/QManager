"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { HistoryCursorProvider } from "@/components/history/history-cursor";
import { RangeControl } from "@/components/history/range-control";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { HistoryEventsResponse, HistoryRange } from "@/types/history";
import type { SystemHistory } from "@/types/system-history";

import {
  coversRange,
  deriveIncidents,
  isCollecting,
  latestTempC,
  throttleParts,
  type LiveStatus,
} from "./derive";
import { LogsCard } from "./logs-card";
import { MetricChartCard } from "./metric-chart-card";
import { HISTORY_PAGE, METRICS_GRID } from "./shapes";
import { StabilityCard } from "./stability-card";
import {
  SystemHealthCollecting,
  SystemHealthError,
  SystemHealthSkeleton,
} from "./states";
import { StorageCard } from "./storage-card";
import { SummaryTiles } from "./summary-tiles";
import { SystemEventsCard } from "./system-events-card";

// =============================================================================
// System Health: the page body, independent of where its data comes from
// =============================================================================
// Header with the range control, then the summary strip, the stability lanes,
// the 2x2 grid of processor / memory / temperature charts and storage, and the
// system events list. The range and the shared cursor are the only page-level
// state. A new install or an untrusted clock answers with no history to show,
// which is "collecting", not an error. The hooks keep the previous range on
// screen while the next one loads, so the skeleton only shows on the first fetch.
// =============================================================================

export interface SystemHealthViewProps {
  range: HistoryRange;
  onRangeChange: (range: HistoryRange) => void;
  history: SystemHistory | null;
  events: HistoryEventsResponse | null;
  /** Set only when a read failed and there is nothing to show. */
  error: string | null;
  onRetry: () => void;
  status: LiveStatus | null;
}

function Loaded({
  history,
  events,
  status,
}: {
  history: SystemHistory;
  events: HistoryEventsResponse;
  status: LiveStatus | null;
}) {
  const incidents = React.useMemo(
    () => deriveIncidents(events.events, history.buckets),
    [events.events, history.buckets],
  );
  const startSec = history.buckets[0]?.t ?? history.now;
  const tempC = latestTempC(history.buckets);

  return (
    <>
      <motion.div variants={staggerItem}>
        <SummaryTiles history={history} incidents={incidents} status={status} />
      </motion.div>
      <motion.div variants={staggerItem}>
        <StabilityCard
          incidents={incidents}
          range={history.range}
          startSec={startSec}
          nowSec={history.now}
          since={history.since}
        />
      </motion.div>
      <motion.div variants={staggerItem} className={METRICS_GRID}>
        {(["cpu", "mem", "temp"] as const).map((kind) => (
          <MetricChartCard
            key={kind}
            kind={kind}
            history={history}
            incidents={incidents}
            range={history.range}
            tripC={status?.thermal?.trip_c ?? null}
            throttleParts={throttleParts(status)}
            memTotalMb={status?.memTotalMb ?? null}
          />
        ))}
        <StorageCard history={history} />
      </motion.div>
      <motion.div variants={staggerItem}>
        <SystemEventsCard
          incidents={incidents}
          range={history.range}
          nowSec={history.now}
          covered={coversRange(history)}
          tempC={tempC}
        />
      </motion.div>
      <motion.div variants={staggerItem}>
        <LogsCard />
      </motion.div>
    </>
  );
}

export function SystemHealthView({
  range,
  onRangeChange,
  history,
  events,
  error,
  onRetry,
  status,
}: SystemHealthViewProps) {
  const { t } = useTranslation("history");

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
            title={t("system.page.title")}
            description={t("system.page.description")}
            actions={<RangeControl value={range} onChange={onRangeChange} keyPrefix="system.range" />}
          />
        </motion.div>

        {error ? (
          <SystemHealthError onRetry={onRetry} />
        ) : !history || !events ? (
          <SystemHealthSkeleton label={t("system.states.loading_sr")} />
        ) : isCollecting(history) ? (
          <SystemHealthCollecting clockTrusted={history.clock_trusted} />
        ) : (
          <Loaded history={history} events={events} status={status} />
        )}
      </motion.div>
    </HistoryCursorProvider>
  );
}
