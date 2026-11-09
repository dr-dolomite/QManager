"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "@/lib/auth-fetch";

// =============================================================================
// useLogDebug — the 30-minute "Debug logging" lease on QManager's journal
// =============================================================================
// Backend: GET/POST /cgi-bin/quecmanager/system/log_debug.sh
//   GET                    -> { success, active, expires_in, available }
//   POST {"enable": bool}  -> the same shape
//
// The countdown runs on the browser's clock from `expires_in` (seconds left as
// the device sees it), so a skewed browser clock cannot shorten or stretch it.
// When it reaches zero the lease is read again: the device is the authority on
// whether it actually lapsed. An older backend without the endpoint reads as
// `available: false`, which hides the control.
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/system/log_debug.sh";

/** How long one lease lasts, for copy only; the device decides the real span. */
export const DEBUG_LEASE_MIN = 30;

interface LeaseResponse {
  success?: boolean;
  active?: boolean;
  expires_in?: number;
  available?: boolean;
  error?: string;
  detail?: string;
}

export interface LogDebugResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

export interface UseLogDebugReturn {
  /** False until the first read lands, and when the device cannot lease. */
  available: boolean;
  active: boolean;
  /** Seconds left on the lease while active, else 0. */
  remainingSec: number;
  isBusy: boolean;
  /** Turn detailed logging on (true) or stop it early (false). */
  setEnabled: (enable: boolean) => Promise<LogDebugResult>;
}

interface LeaseState {
  available: boolean;
  active: boolean;
  /** Browser epoch ms at which the lease ends, while active. */
  endsAtMs: number | null;
}

const INITIAL: LeaseState = { available: false, active: false, endsAtMs: null };

function toState(data: LeaseResponse): LeaseState {
  const left = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 0;
  const active = data.active === true && left > 0;
  return {
    available: data.available === true,
    active,
    endsAtMs: active ? Date.now() + left * 1000 : null,
  };
}

export function useLogDebug(): UseLogDebugReturn {
  const [lease, setLease] = useState<LeaseState>(INITIAL);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isBusy, setIsBusy] = useState(false);
  const [readNonce, setReadNonce] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The read: on mount, and again whenever the countdown runs out.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const resp = await authFetch(ENDPOINT, { signal: controller.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as LeaseResponse;
        if (controller.signal.aborted) return;
        setLease(data.success ? toState(data) : INITIAL);
        setNowMs(Date.now());
      } catch {
        if (controller.signal.aborted) return;
        setLease(INITIAL);
      }
    })();
    return () => controller.abort();
  }, [readNonce]);

  // The countdown tick, only while a lease runs.
  const endsAtMs = lease.endsAtMs;
  useEffect(() => {
    if (endsAtMs === null) return;
    const id = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      if (now >= endsAtMs) {
        clearInterval(id);
        setReadNonce((n) => n + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [endsAtMs]);

  const setEnabled = useCallback(async (enable: boolean): Promise<LogDebugResult> => {
    setIsBusy(true);
    try {
      const resp = await authFetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable }),
      });
      const data = (await resp.json().catch(() => ({}))) as LeaseResponse;
      if (!mountedRef.current) return { ok: false };
      if (!resp.ok || !data.success) {
        return { ok: false, error: data.error, detail: data.detail };
      }
      setLease(toState(data));
      setNowMs(Date.now());
      return { ok: true };
    } catch {
      return { ok: false };
    } finally {
      if (mountedRef.current) setIsBusy(false);
    }
  }, []);

  const remainingSec =
    lease.active && lease.endsAtMs !== null
      ? Math.max(0, Math.ceil((lease.endsAtMs - nowMs) / 1000))
      : 0;

  return {
    available: lease.available,
    active: lease.active && remainingSec > 0,
    remainingSec,
    isBusy,
    setEnabled,
  };
}
