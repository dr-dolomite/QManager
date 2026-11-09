"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { startVisibleInterval } from "@/lib/visible-interval";
import type { NetworkEventType } from "@/types/modem-status";
import type {
  HistoryEventsResponse,
  HistoryRange,
  HistorySeriesResponse,
} from "@/types/history";

// =============================================================================
// useHistorySeries / useHistoryEvents: the generic history reads
// =============================================================================
// GET history/series.sh  (bucketed states + metrics for one series and range)
// GET history/events.sh  (paged event list + per-type counts)
// Series-agnostic: a page names its series id and narrows the state and metric
// ids with the generics. docs/features/history.md §6-7.
//
// Both refetch every 30 s (every 10 s on the 5 minutes and 1 hour ranges, whose
// buckets are 10 s and 60 s) while the tab is visible (startVisibleInterval) and
// at once when the range, page or type filter changes. The previous response
// stays in `data` while the next one loads (`isLoading` is true, `data` is not
// cleared), so a range switch never flashes back to a skeleton. A response for
// a query that has since been replaced is dropped (AbortController).
//
// `error` is set only when the current query has no data to show: a failed
// poll behind an on-screen response keeps that response and retries next tick.
// =============================================================================

const SERIES_ENDPOINT = "/cgi-bin/quecmanager/history/series.sh";
const EVENTS_ENDPOINT = "/cgi-bin/quecmanager/history/events.sh";
const POLL_MS = 30_000;
/** The 5 minutes and 1 hour ranges hold 10 s and 60 s buckets, so they poll faster. */
const SHORT_POLL_MS = 10_000;

/** Refetch cadence for a range. */
export function historyPollMs(range: HistoryRange): number {
  return range === "5m" || range === "1h" ? SHORT_POLL_MS : POLL_MS;
}
const FALLBACK_ERROR = "Failed to load history";

export interface UseHistoryReturn<T> {
  /** Latest successful response; stays the previous query's while a new one loads. */
  data: T | null;
  /** A fetch for the current query has not settled yet. */
  isLoading: boolean;
  /** Resolved message when the current query failed and has no data; else null. */
  error: string | null;
  /** Refetch the current query now. */
  refresh: () => void;
}

interface EnvelopeError {
  code?: string;
  detail?: string;
}

interface ResourceState<T> {
  /** URL that `data` answers. */
  dataUrl: string | null;
  data: T | null;
  /** Fetch key (url + refresh count) that last settled, success or failure. */
  settledKey: string | null;
  /** Fetch key the failure belongs to. */
  errorKey: string | null;
  errorInfo: EnvelopeError | null;
}

const INITIAL: ResourceState<never> = {
  dataUrl: null,
  data: null,
  settledKey: null,
  errorKey: null,
  errorInfo: null,
};

function useHistoryResource<T extends { success: boolean }>(
  url: string,
  pollMs: number,
): UseHistoryReturn<T> {
  const { t } = useTranslation("errors");
  const [state, setState] = useState<ResourceState<T>>(INITIAL);
  const [nonce, setNonce] = useState(0);
  const key = `${url}#${nonce}`;

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;

    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const resp = await authFetch(url, { signal: controller.signal });
        const json = (await resp.json()) as T & EnvelopeError & { error?: string };
        if (controller.signal.aborted) return;
        if (!json.success) {
          setState((prev) => ({
            ...prev,
            settledKey: key,
            errorKey: key,
            errorInfo: { code: json.error, detail: json.detail },
          }));
          return;
        }
        setState({ dataUrl: url, data: json, settledKey: key, errorKey: null, errorInfo: null });
      } catch {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          settledKey: key,
          errorKey: key,
          errorInfo: {},
        }));
      } finally {
        inFlight = false;
      }
    };

    // Paused while the tab is hidden; fetches at once when shown again.
    const stop = startVisibleInterval(() => void load(), pollMs);
    return () => {
      controller.abort();
      stop();
    };
  }, [url, key, pollMs]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // A failure only counts when nothing for this query is on screen.
  const failed = state.errorKey === key && state.dataUrl !== url ? state.errorInfo : null;
  const error = useMemo(
    () =>
      failed
        ? resolveErrorMessage(t, failed.code, failed.detail, FALLBACK_ERROR)
        : null,
    [failed, t],
  );

  return {
    data: state.data,
    isLoading: state.settledKey !== key,
    error,
    refresh,
  };
}

/** Bucketed state and metric history for one series and range. */
export function useHistorySeries<S extends string, M extends string>(
  series: string,
  range: HistoryRange,
): UseHistoryReturn<HistorySeriesResponse<S, M>> {
  const url = `${SERIES_ENDPOINT}?series=${encodeURIComponent(series)}&range=${range}`;
  return useHistoryResource<HistorySeriesResponse<S, M>>(url, historyPollMs(range));
}

export interface HistoryEventsOptions {
  /** Omit or leave empty for every type. */
  types?: NetworkEventType[];
  /** Zero-based. */
  page: number;
  /** 1..100. */
  pageSize: number;
}

/** One page of events (newest first) with per-type counts for the range. */
export function useHistoryEvents(
  series: string,
  range: HistoryRange,
  opts: HistoryEventsOptions,
): UseHistoryReturn<HistoryEventsResponse> {
  const { page, pageSize } = opts;
  const types = opts.types && opts.types.length > 0 ? opts.types.join(",") : "";
  const params = new URLSearchParams({
    series,
    range,
    limit: String(pageSize),
    offset: String(page * pageSize),
  });
  if (types) params.set("types", types);
  const url = `${EVENTS_ENDPOINT}?${params.toString().replace(/%2C/g, ",")}`;
  return useHistoryResource<HistoryEventsResponse>(url, historyPollMs(range));
}
