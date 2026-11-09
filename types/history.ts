// =============================================================================
// History: generic series + events contract (docs/features/history.md §6–7)
// =============================================================================
// Mirrors GET history/series.sh and GET history/events.sh. Series-agnostic:
// a page narrows S (state ids) and M (metric ids) with its own aliases.
// =============================================================================

import type { EventSeverity, NetworkEventType } from "@/types/modem-status";

export type HistoryRange = "24h" | "7d" | "30d";

export interface HistoryRangeSpec {
  /** Seconds per returned bucket. */
  bucketSec: number;
  /** Buckets returned for the range (the last one is partial). */
  count: number;
}

export const HISTORY_RANGES: Record<HistoryRange, HistoryRangeSpec> = {
  "24h": { bucketSec: 1800, count: 48 },
  "7d": { bucketSec: 10800, count: 56 },
  "30d": { bucketSec: 43200, count: 60 },
};

export const HISTORY_RANGE_ORDER: readonly HistoryRange[] = ["24h", "7d", "30d"];

export interface HistoryMetricStat {
  n: number;
  avg: number;
  min: number;
  max: number;
}

export interface HistoryBucket<S extends string, M extends string> {
  /** Bucket start, UTC epoch seconds (multiple of bucket_sec). */
  t: number;
  /** Bucket length in seconds; below bucket_sec only for the current bucket. */
  len: number;
  /** Seconds spent in each state. no data = len - sum(st). */
  st: Partial<Record<S, number>>;
  /** Entries into a fault state inside this bucket. */
  x: number;
  /** Metrics with at least one reading; absent = no reading. */
  m: Partial<Record<M, HistoryMetricStat>>;
}

export interface HistorySeriesResponse<S extends string, M extends string> {
  success: true;
  series: string;
  range: HistoryRange;
  bucket_sec: number;
  /** Collector's now (mono + offset), epoch seconds. */
  now: number;
  clock_trusted: boolean;
  /** Start of the oldest stored row; null before the first row. */
  since: number | null;
  states: S[];
  fault: S[];
  metrics: M[];
  /** Current state run (this boot); null while nothing is sampled. */
  current: { state: S; since: number } | null;
  /** Newest completed fault run within retention. */
  last_fault: { start: number; end: number } | null;
  /** Oldest first; always `count` entries when clock_trusted. */
  buckets: HistoryBucket<S, M>[];
}

export type HistoryRadio = "lte" | "nr" | null;

export interface HistoryEvent {
  timestamp: number;
  type: NetworkEventType;
  severity: EventSeverity;
  radio: HistoryRadio;
  message: string;
}

export interface HistoryEventsResponse {
  success: true;
  series: string;
  range: HistoryRange;
  /** Events matching the type filter in the range. */
  total: number;
  /** Per-type counts over the range, ignoring the type filter. */
  counts: Partial<Record<NetworkEventType, number>>;
  /** Newest first, one page. */
  events: HistoryEvent[];
}

// --- Cellular series ---------------------------------------------------------

export type CellularState = "nr" | "lte" | "down" | "off";

export type CellularMetric =
  | "lte_rsrp"
  | "lte_rsrq"
  | "lte_sinr"
  | "lte_rssi"
  | "nr_rsrp"
  | "nr_rsrq"
  | "nr_sinr";

export type CellularHistory = HistorySeriesResponse<CellularState, CellularMetric>;
export type CellularBucket = HistoryBucket<CellularState, CellularMetric>;

/** Cellular event types recorded by the series (and offered by the filter). */
export const CELLULAR_EVENT_TYPES = [
  "signal_lost",
  "signal_restored",
  "nr_anchor",
  "pci_change",
  "scc_pci_change",
  "band_change",
  "ca_change",
] as const satisfies readonly NetworkEventType[];

export type CellularEventType = (typeof CELLULAR_EVENT_TYPES)[number];
