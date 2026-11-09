"use client";

import { useCallback, useEffect, useState } from "react";

import { authFetch } from "@/lib/auth-fetch";
import { startVisibleInterval } from "@/lib/visible-interval";
import type { HistoryRange } from "@/types/history";

import type {
  ConnectionEventType,
  ConnectionEventsResponse,
  ConnectionHistory,
} from "./types";

// =============================================================================
// Connection History: data access
// =============================================================================
// The only place the page reads from. It has the contract of the core
// `useHistorySeries` / `useHistoryEvents` (docs/features/history.md §7):
// `{ data, isLoading, error, refresh }`, a refetch every 30 s while the tab is
// visible, an immediate refetch when the range or page changes, and the previous
// data kept on screen while the next request loads (no skeleton flash on a range
// switch). Swapping to the core hook is a change to this file only.
// =============================================================================

const CGI = "/cgi-bin/quecmanager/history";

/** Buckets are 30 minutes wide at the finest grain; twice a minute is plenty. */
const POLL_MS = 30_000;

interface Settled<T> {
  /** The request this result answers. */
  key: string;
  data: T | null;
  failed: boolean;
  /** Browser clock when the response landed, epoch seconds. */
  fetchedAtSec: number;
}

interface HistoryFetch<T> {
  data: T | null;
  /** Browser epoch seconds when `data` landed; 0 before the first response. */
  fetchedAtSec: number;
  isLoading: boolean;
  error: boolean;
  refresh: () => void;
}

function useHistoryFetch<T extends { success: boolean }>(url: string): HistoryFetch<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await authFetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = (await response.json()) as T;
        if (json.success !== true) throw new Error("History request failed");
        if (cancelled) return;
        setSettled({
          key: url,
          data: json,
          failed: false,
          fetchedAtSec: Math.floor(Date.now() / 1000),
        });
      } catch {
        if (cancelled) return;
        // A failed poll never blanks data this request already answered.
        setSettled((prev) =>
          prev && prev.key === url && prev.data
            ? prev
            : { key: url, data: null, failed: true, fetchedAtSec: 0 },
        );
      }
    };
    // Paused while the tab is hidden; fetches at once when shown again.
    // `nonce` is a dependency only to restart the loop for a manual retry.
    const stop = startVisibleInterval(() => void load(), POLL_MS);
    return () => {
      // A response for a request that was replaced must not overwrite the new one.
      cancelled = true;
      stop();
    };
  }, [url, nonce]);

  const refresh = useCallback(() => {
    // Back to the skeleton: a retry that shows the error until it lands reads as
    // a button that did nothing.
    setSettled(null);
    setNonce((n) => n + 1);
  }, []);

  const current = settled !== null && settled.key === url;
  return {
    data: settled?.data ?? null,
    fetchedAtSec: settled?.fetchedAtSec ?? 0,
    // Only a first load (or a retry) shows the skeleton; a new range or page
    // keeps what is on screen until it lands.
    isLoading: settled === null || (!current && settled.data === null),
    error: settled !== null && current && settled.failed,
    refresh,
  };
}

export interface SeriesResult {
  data: ConnectionHistory | null;
  isLoading: boolean;
  error: boolean;
  refresh: () => void;
}

/** TEMPORARY twin of `useHistorySeries<ConnectionState, ConnectionMetric>("connection", range)`. */
export function useConnectionSeries(range: HistoryRange): SeriesResult {
  const { data, isLoading, error, refresh } = useHistoryFetch<ConnectionHistory>(
    `${CGI}/series.sh?series=connection&range=${range}`,
  );
  return { data, isLoading, error, refresh };
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
  /** Browser epoch seconds, for the Today / Yesterday words. */
  nowSec: number;
  isLoading: boolean;
  error: boolean;
  refresh: () => void;
}

/** TEMPORARY twin of `useHistoryEvents("connection", range, { types, page, pageSize })`. */
export function useConnectionEvents(range: HistoryRange, query: EventsQuery): EventsResult {
  const { types, page, pageSize } = query;
  const params = new URLSearchParams({
    series: "connection",
    range,
    limit: String(pageSize),
    offset: String(page * pageSize),
  });
  if (types && types.length > 0) params.set("types", types.join(","));

  const { data, fetchedAtSec, isLoading, error, refresh } =
    useHistoryFetch<ConnectionEventsResponse>(`${CGI}/events.sh?${params.toString()}`);
  return { data, nowSec: fetchedAtSec, isLoading, error, refresh };
}
