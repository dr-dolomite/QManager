"use client";

import * as React from "react";

import { useHistoryEvents, useHistorySeries } from "@/hooks/use-history";
import { useModemStatus } from "@/hooks/use-modem-status";
import type { HistoryRange } from "@/types/history";
import type { SystemMetric, SystemState } from "@/types/system-history";

import type { LiveStatus } from "./derive";
import { SystemHealthView } from "./system-health-view";

// =============================================================================
// System Health: /history/system-health
// =============================================================================
// Reads the `system` series and its event rows through the shared history hooks
// and folds in the live values from the status poll (uptime, memory in use, the
// heat-throttling snapshot).
// =============================================================================

function LivePage() {
  const [range, setRange] = React.useState<HistoryRange>("5m");
  const series = useHistorySeries<SystemState, SystemMetric>("system", range);
  const events = useHistoryEvents("system", range, { page: 0, pageSize: 100 });
  const { data: modem } = useModemStatus();

  const status: LiveStatus | null = modem
    ? {
        uptimeSec: modem.device?.uptime_seconds || null,
        memUsedMb: modem.device?.memory_total_mb ? modem.device.memory_used_mb : null,
        memTotalMb: modem.device?.memory_total_mb || null,
        thermal: modem.thermal ?? null,
      }
    : null;

  const refreshSeries = series.refresh;
  const refreshEvents = events.refresh;
  const retry = React.useCallback(() => {
    refreshSeries();
    refreshEvents();
  }, [refreshSeries, refreshEvents]);

  return (
    <SystemHealthView
      range={range}
      onRangeChange={setRange}
      history={series.data}
      events={events.data}
      error={series.error ?? events.error}
      onRetry={retry}
      status={status}
    />
  );
}

export default function SystemHealth() {
  return <LivePage />;
}
