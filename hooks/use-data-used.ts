"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  DataUsed,
  DataUsedResetResult,
  DataUsedResponse,
} from "@/types/data-used";

// =============================================================================
// useDataUsed: the persistent Data Used counter (ledger B5.21)
// =============================================================================
// GET  /cgi-bin/quecmanager/network/data_used.sh        (polled every 10 s)
// POST /cgi-bin/quecmanager/network/data_used_reset.sh  (answers after the
//      sampler has zeroed and persisted the counter, so success is final)
//
// The sampler refreshes every 30 s; 10 s keeps the card within a third of a
// sample. A failed poll keeps the last value; `data` is null until a sample
// exists or while the counter is unavailable.
// =============================================================================

const FETCH_ENDPOINT = "/cgi-bin/quecmanager/network/data_used.sh";
const RESET_ENDPOINT = "/cgi-bin/quecmanager/network/data_used_reset.sh";
const POLL_MS = 10_000;

export interface UseDataUsedReturn {
  data: DataUsed | null;
  isLoading: boolean;
  isResetting: boolean;
  /** Returns the backend result; the caller toasts from it. */
  reset: () => Promise<DataUsedResetResult>;
}

function toDataUsed(json: DataUsedResponse): DataUsed | null {
  if (!json.success || !json.available) return null;
  return {
    rxBytes: json.rx_bytes,
    txBytes: json.tx_bytes,
    since: json.since > 0 ? json.since : null,
    stale: json.stale,
    source: json.source === "wds" ? "wds" : "netdev",
  };
}

export function useDataUsed(): UseDataUsedReturn {
  const [data, setData] = useState<DataUsed | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const resp = await authFetch(FETCH_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json: DataUsedResponse = await resp.json();
      if (!mountedRef.current) return;
      setData(toDataUsed(json));
    } catch {
      // Keep the last value; the next poll retries.
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchData();
    const id = window.setInterval(() => void fetchData(), POLL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
    };
  }, [fetchData]);

  const reset = useCallback(async (): Promise<DataUsedResetResult> => {
    setIsResetting(true);
    try {
      const resp = await authFetch(RESET_ENDPOINT, { method: "POST" });
      if (!resp.ok) return { success: false, detail: `HTTP ${resp.status}` };
      const json: DataUsedResetResult = await resp.json();
      if (json.success) await fetchData();
      return json.success
        ? { success: true }
        : { success: false, error: json.error, detail: json.detail };
    } catch (err) {
      return {
        success: false,
        detail: err instanceof Error ? err.message : undefined,
      };
    } finally {
      if (mountedRef.current) setIsResetting(false);
    }
  }, [fetchData]);

  return { data, isLoading, isResetting, reset };
}
