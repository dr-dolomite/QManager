import type {
  HistoryBucket,
  HistoryEvent,
  HistoryEventsResponse,
  HistorySeriesResponse,
} from "@/types/history";
import type { NetworkEventType } from "@/types/modem-status";

// =============================================================================
// Connection History: series types (docs/features/history.md, series `connection`)
// =============================================================================
// Kept beside the page so the shared `types/history.ts` stays untouched. When
// the aliases move there, this file becomes a re-export.
// =============================================================================

/** `off` is the radio being off: no data, never an outage. `down` is the fault. */
export type ConnectionState = "up" | "down" | "off";

export type ConnectionMetric = "lat_ms" | "jit_ms" | "loss_pct" | "dns_ms";

export type ConnectionHistory = HistorySeriesResponse<ConnectionState, ConnectionMetric>;
export type ConnectionBucket = HistoryBucket<ConnectionState, ConnectionMetric>;

/** Event types the series records, in filter order. */
export const CONNECTION_EVENT_TYPES = [
  "internet_lost",
  "internet_restored",
  "high_latency",
  "latency_recovered",
  "high_packet_loss",
  "packet_loss_recovered",
  "watchcat_recovery",
  "sim_failover",
] as const satisfies readonly NetworkEventType[];

export type ConnectionEventType = (typeof CONNECTION_EVENT_TYPES)[number];

/**
 * An event row. Onset rows (`internet_lost`, `high_latency`, `high_packet_loss`)
 * may carry `end`: a number is when it recovered, `null` means it is ongoing.
 * Absent on older cores, in which case no "Lasted" is shown.
 */
export type ConnectionEvent = HistoryEvent & { end?: number | null };

export type ConnectionEventsResponse = Omit<HistoryEventsResponse, "events"> & {
  events: ConnectionEvent[];
};

/** The user's Connection Quality cuts the page grades against. */
export interface ConnectionLimits {
  latencyMs: number;
  lossPct: number;
}

/** Used until the status feed reports the real cuts. */
export const DEFAULT_LIMITS: ConnectionLimits = { latencyMs: 250, lossPct: 30 };

/** A bucket whose average loss reaches this share reads as slow or lossy. */
export const LOSS_SLOW_PCT = 5;
