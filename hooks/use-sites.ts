"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "@/lib/auth-fetch";
import type { HistoryRange } from "@/types/history";
import type { MutationResult } from "@/types/mutation-result";
import type {
  SitesConfig,
  SitesFailure,
  SitesRange,
  SitesResponse,
} from "@/types/sites";

// Sites monitor: polls the sites CGI, faster while a sweep runs or a check is pending.
// A second, opt-in loop reads the live values (`range=now`) every 2 s.

const ENDPOINT = "/cgi-bin/quecmanager/monitoring/sites.sh";
const IDLE_POLL_MS = 30_000;
const BUSY_POLL_MS = 3_000;
/** Each "now" read renews the daemon's live lease, so it polls only while the tab is visible. */
const LIVE_POLL_MS = 2_000;
/** A check the daemon never picked up stops counting as pending after this. */
const PENDING_TIMEOUT_MS = 90_000;

interface PendingCheck {
  sinceMs: number;
  baseline: number | null;
  sawChecking: boolean;
}

export interface UseSitesReturn {
  /** The saved config and the series for `dataRange`, on the idle cadence. */
  data: SitesResponse | null;
  /** The range `data` was read for; it lags `range` until the new read lands. */
  dataRange: HistoryRange | null;
  /** Epoch seconds when `data` was read: the right edge of the range's bucket grid. */
  dataNow: number | null;
  /**
   * The live sweep (a fresh connect time per site about every 2 s), or null
   * while Live is off or before its first read lands. It carries no series.
   */
  liveData: SitesResponse | null;
  isLoading: boolean;
  error: string | null;
  /** True from a successful check-now until the sweep it asked for lands. */
  checkPending: boolean;
  refresh: () => void;
  checkNow: () => Promise<MutationResult>;
  save: (config: SitesConfig) => Promise<MutationResult>;
}

async function postSites(body: object): Promise<MutationResult> {
  try {
    const res = await authFetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, code: null, error: `HTTP ${res.status}` };
    const json = (await res.json()) as SitesResponse | SitesFailure;
    if (!json.success) {
      // `invalid_field` carries `reason` instead of `detail`.
      return {
        ok: false,
        code: json.error ?? null,
        error: json.detail ?? json.reason ?? null,
      };
    }
    return { ok: true, code: null, error: null };
  } catch (err) {
    return {
      ok: false,
      code: null,
      error: err instanceof Error ? err.message : null,
    };
  }
}

/**
 * @param range The page range the series is read for.
 * @param live  Run the 2 s live loop beside the range read (visible tab only).
 */
export function useSites(range: HistoryRange, live: boolean): UseSitesReturn {
  const [data, setData] = useState<SitesResponse | null>(null);
  const [dataRange, setDataRange] = useState<HistoryRange | null>(null);
  const [dataNow, setDataNow] = useState<number | null>(null);
  const [liveData, setLiveData] = useState<SitesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkPending, setCheckPending] = useState(false);

  const mountedRef = useRef(true);
  const seqRef = useRef(0);
  const liveSeqRef = useRef(0);
  const rangeRef = useRef(range);
  const checkedAtRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingCheck | null>(null);

  const fetchRange = useCallback(async (r: HistoryRange) => {
    // Only the newest request may land, so a slow 30 d read never overwrites 24 h.
    const seq = ++seqRef.current;
    try {
      const res = await authFetch(`${ENDPOINT}?range=${r}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SitesResponse | SitesFailure;
      if (!mountedRef.current || seq !== seqRef.current) return;
      if (!json.success) throw new Error(json.detail ?? json.error);

      setData(json);
      setDataRange(r);
      setDataNow(Math.floor(Date.now() / 1000));
      setError(null);
      checkedAtRef.current = json.checked_at;

      const pending = pendingRef.current;
      if (pending) {
        if (json.checking) pending.sawChecking = true;
        const landed =
          !json.checking &&
          (pending.sawChecking || json.checked_at !== pending.baseline);
        if (landed || Date.now() - pending.sinceMs > PENDING_TIMEOUT_MS) {
          pendingRef.current = null;
          setCheckPending(false);
        }
      }
    } catch (err) {
      if (!mountedRef.current || seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to read sites");
    } finally {
      if (mountedRef.current && seq === seqRef.current) setIsLoading(false);
    }
  }, []);

  const fetchLive = useCallback(async () => {
    const seq = ++liveSeqRef.current;
    try {
      const res = await authFetch(`${ENDPOINT}?range=${"now" satisfies SitesRange}`);
      if (!res.ok) return;
      const json = (await res.json()) as SitesResponse | SitesFailure;
      if (!mountedRef.current || seq !== liveSeqRef.current) return;
      if (json.success) setLiveData(json);
    } catch {
      // A missed live read keeps the last one; the range read carries the errors.
    }
  }, []);

  const dropLiveReads = useCallback(() => {
    liveSeqRef.current++;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    rangeRef.current = range;
    void fetchRange(range);
  }, [range, fetchRange]);

  const busy = (data?.checking ?? false) || checkPending;
  const cadence = busy ? BUSY_POLL_MS : IDLE_POLL_MS;
  useEffect(() => {
    const id = window.setInterval(
      () => void fetchRange(rangeRef.current),
      cadence,
    );
    return () => window.clearInterval(id);
  }, [cadence, fetchRange]);

  // A disabled monitor has nothing live to show, so Live reads nothing.
  const liveActive = live && data?.enabled !== false;
  useEffect(() => {
    if (!liveActive) return;

    let id: number | null = null;
    const stop = () => {
      if (id !== null) window.clearInterval(id);
      id = null;
    };
    const start = () => {
      if (id === null) id = window.setInterval(() => void fetchLive(), LIVE_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void fetchLive();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") {
      void fetchLive();
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      // Invalidate in-flight reads and forget the sweep, so a later Live starts clean.
      dropLiveReads();
      setLiveData(null);
    };
  }, [liveActive, fetchLive, dropLiveReads]);

  const refresh = useCallback(() => {
    void fetchRange(rangeRef.current);
  }, [fetchRange]);

  const checkNow = useCallback(async () => {
    const result = await postSites({ action: "check_now" });
    if (result.ok && mountedRef.current) {
      pendingRef.current = {
        sinceMs: Date.now(),
        baseline: checkedAtRef.current,
        sawChecking: false,
      };
      setCheckPending(true);
      void fetchRange(rangeRef.current);
    }
    return result;
  }, [fetchRange]);

  const save = useCallback(
    async (config: SitesConfig) => {
      const result = await postSites({ action: "save", ...config });
      if (result.ok && mountedRef.current) void fetchRange(rangeRef.current);
      return result;
    },
    [fetchRange],
  );

  return {
    data,
    dataRange,
    dataNow,
    liveData: liveActive ? liveData : null,
    isLoading,
    error,
    checkPending,
    refresh,
    checkNow,
    save,
  };
}
