"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { PublicOverview } from "@/types/public-overview";

// =============================================================================
// usePublicOverview — Polling hook for the unauthenticated overview card.
// =============================================================================
// Mirrors useModemStatus' shape and lifecycle but uses plain `fetch` (NOT
// authFetch). The endpoint is unauthenticated by design; sending a session
// cookie would be harmless but pointless.
// =============================================================================

const FETCH_ENDPOINT = "/cgi-bin/quecmanager/public/overview.sh";
// Pre-login cadence: a passerby on the landing page does not need 0.5 Hz
// refresh. 5 s keeps the card feeling live without hammering the device CGI.
const POLL_INTERVAL = 5000;
const STALE_THRESHOLD_SECONDS = 15;

export interface UsePublicOverviewReturn {
  data: PublicOverview | null;
  isLoading: boolean;
  isStale: boolean;
  error: string | null;
  refresh: () => void;
}

export function usePublicOverview(): UsePublicOverviewReturn {
  const [data, setData] = useState<PublicOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    // Cancel any in-flight request before starting a new one. Prevents an
    // older response from clobbering newer state (e.g. when the user clicks
    // Retry while the previous poll is still in flight).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(FETCH_ENDPOINT, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json = (await response.json()) as PublicOverview;
      if (!mountedRef.current || controller.signal.aborted) return;

      setData(json);
      setError(null);

      if (json.state === "ok") {
        const now = Math.floor(Date.now() / 1000);
        const age = now - json.timestamp;
        setIsStale(age > STALE_THRESHOLD_SECONDS);
      } else {
        // Non-ok states (setup_required / unavailable) are explicit backend
        // states, not stale data — the empty-state UI handles them.
        setIsStale(false);
      }
      setIsLoading(false);
    } catch (err) {
      // AbortError from our own controller is expected — swallow it silently.
      if (controller.signal.aborted) return;
      if (!mountedRef.current) return;
      const message =
        err instanceof Error ? err.message : "Failed to fetch overview";
      setError(message);
      setIsStale(true);
      setIsLoading(false);
      // Retain prior `data` — never blank a working card on a transient error.
    }
  }, []);

  const refresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    mountedRef.current = true;

    const startPolling = () => {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(fetchData, POLL_INTERVAL);
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    // Initial fetch is unconditional (cold-start the card even if the tab is
    // hidden — first paint should still have data when the user comes back).
    fetchData();
    if (typeof document === "undefined" || !document.hidden) {
      startPolling();
    }

    // Pause polling when the tab is hidden, refresh + resume when it returns.
    // Keeps a backgrounded landing page from waking the device CGI every 5 s
    // and conserves battery on mobile.
    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchData();
        startPolling();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      mountedRef.current = false;
      stopPolling();
      abortRef.current?.abort();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [fetchData]);

  return { data, isLoading, isStale, error, refresh };
}
