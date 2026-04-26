"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

const STATUS_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/status.sh";
const SIGNIN_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/signin.sh";
const SIGNOUT_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/signout.sh";
const UPLOAD_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/upload.sh";

const POLL_INTERVAL_MS = 5000;
const STALE_THRESHOLD_MS = 15000; // 3 missed polls

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CellMapperStatus {
  service: {
    enabled: boolean;
    collector_state: "running" | "paused" | "stopped" | "error" | "starting";
    uploader_state: "running" | "idle" | "error" | "needs_reauth" | "backoff";
    last_measurement: {
      type: string;
      provider: string;
      band: string;
      signal: number;
      timestamp: number;
    } | null;
    last_upload: {
      timestamp: number;
      batch_size: number;
      status: string;
    } | null;
    uploader_failures: number;
    uploader_needs_reauth: boolean;
  };
  account: {
    linked: boolean;
    username: string | null;
    linked_at: number | null;
  };
  gps: {
    source: string;
    fix: {
      type: string; // "3D", "2D", "none"
      lat: number;
      lon: number;
      alt: number;
      sats: number;
      speed_kmh: number;
      hdop: number;
    } | null;
  };
  buffer: {
    pending_count: number;
    pending_size_bytes: number;
    oldest_age_sec: number | null;
  };
  adapter: {
    detected: boolean;
    name: string | null;
  };
  errors: Array<{
    ts: number;
    source: string;
    msg: string;
    count: number;
  }>;
}

export interface UseCellMapperReturn {
  status: CellMapperStatus | null;
  isLoading: boolean;
  error: string | null;
  isStale: boolean;
  lastUpdated: number | null;
  // Actions
  signIn: (username: string, password: string) => Promise<boolean>;
  signOut: () => Promise<boolean>;
  triggerUpload: () => Promise<boolean>;
  refresh: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useCellMapper(): UseCellMapperReturn {
  const { t } = useTranslation("monitoring");
  const [status, setStatus] = useState<CellMapperStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current status
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(STATUS_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(
          resolveErrorMessage(
            t,
            json.error,
            undefined,
            "Failed to fetch CellMapper status"
          )
        );
        return;
      }

      setStatus(json.data ?? json);
      const now = Date.now();
      setLastUpdated(now);
      setIsStale(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch CellMapper status"
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, [t]);

  // ---------------------------------------------------------------------------
  // Polling + staleness detection
  // ---------------------------------------------------------------------------
  useEffect(() => {
    fetchStatus();
    const id = setInterval(() => fetchStatus(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // Check staleness on each tick (separate from fetch interval)
  useEffect(() => {
    const staleId = setInterval(() => {
      if (!mountedRef.current) return;
      setIsStale((prev) => {
        if (lastUpdated === null) return prev;
        return Date.now() - lastUpdated > STALE_THRESHOLD_MS;
      });
    }, 1000);
    return () => clearInterval(staleId);
  }, [lastUpdated]);

  // ---------------------------------------------------------------------------
  // Sign in
  // ---------------------------------------------------------------------------
  const signIn = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      try {
        const resp = await authFetch(SIGNIN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });

        if (!resp.ok) return false;

        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (json.success) {
          await fetchStatus(true); // silent refresh
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchStatus]
  );

  // ---------------------------------------------------------------------------
  // Sign out
  // ---------------------------------------------------------------------------
  const signOut = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await authFetch(SIGNOUT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!resp.ok) return false;

      const json = await resp.json();
      if (!mountedRef.current) return false;

      if (json.success) {
        await fetchStatus(true); // silent refresh
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // Trigger upload flush
  // ---------------------------------------------------------------------------
  const triggerUpload = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await authFetch(UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!resp.ok) return false;

      const json = await resp.json();
      if (!mountedRef.current) return false;

      return json.success === true;
    } catch {
      return false;
    }
  }, []);

  return {
    status,
    isLoading,
    error,
    isStale,
    lastUpdated,
    signIn,
    signOut,
    triggerUpload,
    refresh: fetchStatus,
  };
}
