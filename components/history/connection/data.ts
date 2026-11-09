"use client";

import { useHistoryEvents, useHistorySeries } from "@/hooks/use-history";
import type { HistoryRange } from "@/types/history";

import type {
  ConnectionEventType,
  ConnectionEventsResponse,
  ConnectionHistory,
  ConnectionMetric,
  ConnectionState,
} from "./types";

// =============================================================================
// Connection History: data access
// =============================================================================
// The only place the page reads from: thin wrappers over the core
// `useHistorySeries` / `useHistoryEvents` (docs/features/history.md §7), which
// refetch every 30 s while the tab is visible, refetch at once on a range or
// page change and keep the previous data on screen while the next one loads.
// =============================================================================

export interface SeriesResult {
  data: ConnectionHistory | null;
  isLoading: boolean;
  error: boolean;
  refresh: () => void;
}

export function useConnectionSeries(range: HistoryRange): SeriesResult {
  const { data, isLoading, error, refresh } = useHistorySeries<ConnectionState, ConnectionMetric>(
    "connection",
    range,
  );
  return { data, isLoading, error: error !== null, refresh };
}

export interface EventsQuery {
  /** Undefined means every type. */
  types: readonly ConnectionEventType[] | undefined;
  /** Zero-based. */
  page: number;
  pageSize: number;
}

export interface EventsResult {
  data: ConnectionEventsResponse | null;
  isLoading: boolean;
  error: boolean;
  refresh: () => void;
}

export function useConnectionEvents(range: HistoryRange, query: EventsQuery): EventsResult {
  const { types, page, pageSize } = query;
  const { data, isLoading, error, refresh } = useHistoryEvents("connection", range, {
    types: types ? [...types] : undefined,
    page,
    pageSize,
  });
  return { data, isLoading, error: error !== null, refresh };
}
