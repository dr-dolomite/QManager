"use client";

// =============================================================================
// Radio events: data access (TEMPORARY mock)
// =============================================================================
// The only place the events card reads from. It mirrors the return shape of
// the future `useHistoryEvents(series, range, { types, page, pageSize })`
// (docs/features/history.md §7): `{ data, isLoading, error, refresh }`, keeps
// the previous page on screen while the next one loads, and reports the
// collector's "now" next to the data so relative day words stay consistent.
// Swapping to the real hook is a one-function change here.
// =============================================================================

import { useCallback, useEffect, useState } from "react";

import type {
  CellularEventType,
  HistoryEventsResponse,
  HistoryRange,
} from "@/types/history";

import { mockCellularEvents, type MockScenario } from "./mock-fixture";

export interface EventsQuery {
  /** Undefined means every type. */
  types: CellularEventType[] | undefined;
  /** Zero-based. */
  page: number;
  pageSize: number;
}

export interface CellularEventsResult {
  data: HistoryEventsResponse | null;
  /** Collector's now, epoch seconds, for Today / Yesterday labels. */
  nowSec: number;
  isLoading: boolean;
  error: boolean;
  refresh: () => void;
}

interface Settled {
  key: string;
  data: HistoryEventsResponse | null;
  failed: boolean;
  nowSec: number;
}

const MOCK_LATENCY_MS = 280;

export function useCellularEventsMock(
  range: HistoryRange,
  query: EventsQuery,
  scenario: MockScenario,
): CellularEventsResult {
  const { types, page, pageSize } = query;
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const key = [scenario, range, types?.join(",") ?? "*", page, pageSize, nonce].join("|");

  useEffect(() => {
    if (scenario === "loading") return;
    const id = window.setTimeout(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      if (scenario === "error") {
        setSettled({ key, data: null, failed: true, nowSec });
        return;
      }
      setSettled({
        key,
        data: mockCellularEvents(range, { types, page, pageSize }, scenario, nowSec),
        failed: false,
        nowSec,
      });
    }, MOCK_LATENCY_MS);
    return () => window.clearTimeout(id);
  }, [key, scenario, range, types, page, pageSize]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  if (scenario === "loading") {
    return { data: null, nowSec: 0, isLoading: true, error: false, refresh };
  }
  const current = settled?.key === key;
  // Keep the previous page up while the next loads; only a first load (or a
  // retry after a failure) shows the skeleton.
  const stale = !current && settled?.data ? settled : null;
  const shown = current ? settled : stale;
  return {
    data: shown?.data ?? null,
    nowSec: shown?.nowSec ?? 0,
    isLoading: !shown,
    error: current && settled.failed,
    refresh,
  };
}
