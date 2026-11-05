"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import {
  createModemStatusStore,
  documentVisibility,
  type ModemStatusSubscription,
} from "@/lib/modem-status-store";
import type { ModemStatus } from "@/types/modem-status";

// =============================================================================
// useModemStatus — Polling Hook for QManager Dashboard
// =============================================================================
// Reads the cached modem status JSON from the CGI endpoint at a regular
// interval. Provides loading/error states and staleness detection.
//
// Usage:
//   const { data, isLoading, isStale, receivedAtMs, error, refresh } =
//     useModemStatus();
//
// The hook does NOT touch the modem — it only reads the pre-built JSON cache.
// All mounted instances share ONE poll (lib/modem-status-store.ts, ledger
// B5.28): the loop runs at the fastest instance's interval and each instance
// still receives results at its own `pollInterval`.
// =============================================================================

/** How often to poll the CGI endpoint (ms) */
const DEFAULT_POLL_INTERVAL = 2000;

/** CGI endpoint path (proxied in dev via next.config.ts rewrites) */
const FETCH_ENDPOINT = "/cgi-bin/quecmanager/at_cmd/fetch_data.sh";

const modemStatusStore = createModemStatusStore({
  fetchStatus: async () => {
    const response = await authFetch(FETCH_ENDPOINT);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return (await response.json()) as ModemStatus;
  },
  // The store reads the clock once per landed response, never during render
  // (what `react-hooks/purity` guards); consumers get it as `receivedAtMs`.
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
  visibility: documentVisibility,
});

export interface UseModemStatusOptions {
  /** Polling interval in ms (default: 2000) */
  pollInterval?: number;
  /** Whether polling is active (default: true) */
  enabled?: boolean;
}

export interface UseModemStatusReturn {
  /** The latest modem status data (null before first successful fetch) */
  data: ModemStatus | null;
  /** True during the very first fetch (before any data is available) */
  isLoading: boolean;
  /** True if the data's timestamp is older than the stale threshold */
  isStale: boolean;
  /**
   * Browser wall-clock ms at the moment the current `data` LANDED in this
   * client. `null` until the first successful fetch.
   *
   * This exists so consumers that measure elapsed time against a snapshot can
   * do it without reading a clock during render. It is deliberately NOT
   * `data.timestamp`: that field is stamped by the modem, and comparing it to a
   * browser `Date.now()` compares two unsynchronised clocks. It is deliberately
   * NOT a ticking value either — it changes only when a snapshot arrives, which
   * is what makes a render that consumes it idempotent.
   */
  receivedAtMs: number | null;
  /** Error message if the last fetch failed */
  error: string | null;
  /** Manually trigger an immediate refresh */
  refresh: () => void;
}

export function useModemStatus(
  options: UseModemStatusOptions = {}
): UseModemStatusReturn {
  const { pollInterval = DEFAULT_POLL_INTERVAL, enabled = true } = options;

  const [data, setData] = useState<ModemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [receivedAtMs, setReceivedAtMs] = useState<number | null>(null);

  const subscriptionRef = useRef<ModemStatusSubscription | null>(null);

  // Subscribe to the shared poll. A changed interval re-subscribes, which
  // fetches at once, as the per-instance interval used to on re-run.
  useEffect(() => {
    if (!enabled) return;

    const subscription = modemStatusStore.subscribe(pollInterval, (event) => {
      if (event.kind === "data") {
        setData(event.data);
        setError(null);
        setReceivedAtMs(event.receivedAtMs);
        setIsStale(event.isStale);
      } else {
        // Don't clear existing data on error — show stale data with error
        // indicator, but do mark it stale.
        setError(event.message);
        setIsStale(true);
      }
      // Clear loading state after the first settled fetch
      setIsLoading(false);
    });
    subscriptionRef.current = subscription;

    return () => {
      subscription.unsubscribe();
      if (subscriptionRef.current === subscription) {
        subscriptionRef.current = null;
      }
    };
  }, [pollInterval, enabled]);

  // Manual refresh
  const refresh = useCallback(() => {
    subscriptionRef.current?.refresh();
  }, []);

  return { data, isLoading, isStale, receivedAtMs, error, refresh };
}
