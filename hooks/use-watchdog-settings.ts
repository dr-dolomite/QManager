"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { startVisibleInterval } from "@/lib/visible-interval";
import type {
  CqWdMutationResult,
  UseWatchdogReturn,
  WatchdogGetResponse,
  WatchdogSettingsPatch,
} from "@/types/cq-watchdog";

// =============================================================================
// useWatchdogSettings: watchdog settings + live daemon status
// =============================================================================
// GET  → { success, settings, effective, status, sim_failover, recent_reboots,
//          sim_dual_capable, auto_disabled }
//        `status` is `{}` while the daemon has written no state file → null.
// POST → { action: "save_settings", ...keys }   (settings keys are TOP-LEVEL,
//                                                not nested under `settings`)
//        { action: "revert_sim" } | { action: "retry_failback" }
//        success: { success: true }
//        failure: { success: false, error, field?, detail? }
//
// Polled every 5 s while the tab is visible; polls are silent and keep the last
// good `data` on failure. `settings` keeps its object identity while the values
// are unchanged so forms seeded from it don't reset mid-edit. `receivedAt` lets
// the page count mono deadlines (`*_until`) down between polls.
//
// Mutations never throw: they return a `CqWdMutationResult`.
//
// CGI: /cgi-bin/quecmanager/monitoring/watchdog.sh
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/monitoring/watchdog.sh";
const POLL_MS = 5_000;

interface Snapshot {
  data: WatchdogGetResponse;
  receivedAt: number;
}

/** Values-only equality for the small, key-stable settings object. */
function sameValues(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `{}` (no state file) and any non-object read as no status. */
function normaliseStatus(raw: unknown): WatchdogGetResponse["status"] {
  if (!raw || typeof raw !== "object" || Object.keys(raw).length === 0) {
    return null;
  }
  return raw as WatchdogGetResponse["status"];
}

export function useWatchdogSettings(): UseWatchdogReturn {
  const { t } = useTranslation("errors");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const resp = await authFetch(ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json?.success || !json.settings) {
        setError(
          resolveErrorMessage(t, json?.error, json?.detail, "Unknown error"),
        );
        return;
      }

      const next: WatchdogGetResponse = {
        ...json,
        status: normaliseStatus(json.status),
        sim_failover: json.sim_failover ?? { active: false },
        recent_reboots: Array.isArray(json.recent_reboots)
          ? json.recent_reboots.filter(
              (v: unknown): v is number =>
                typeof v === "number" && Number.isFinite(v),
            )
          : [],
        sim_dual_capable: json.sim_dual_capable === true,
        auto_disabled: json.auto_disabled === true,
      };
      const receivedAt = performance.now();
      setSnapshot((prev) => ({
        receivedAt,
        data: {
          ...next,
          settings:
            prev && sameValues(prev.data.settings, next.settings)
              ? prev.data.settings
              : next.settings,
        },
      }));
      setError(null);
    } catch {
      if (mountedRef.current) {
        setError(resolveErrorMessage(t, "unknown", undefined, "Unknown error"));
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    mountedRef.current = true;
    const stop = startVisibleInterval(() => void fetchData(), POLL_MS);
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [fetchData]);

  const post = useCallback(
    async (body: object): Promise<CqWdMutationResult> => {
      setIsSaving(true);
      try {
        const resp = await authFetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();

        if (!json?.success) {
          return {
            ok: false,
            message: resolveErrorMessage(
              t,
              json?.error,
              json?.detail ?? json?.reason,
              "Unknown error",
            ),
            code: typeof json?.error === "string" ? json.error : null,
            field: typeof json?.field === "string" ? json.field : null,
          };
        }

        await fetchData();
        return { ok: true, message: null, code: null, field: null };
      } catch {
        return {
          ok: false,
          message: resolveErrorMessage(t, "unknown", undefined, "Unknown error"),
          code: null,
          field: null,
        };
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchData, t],
  );

  const saveSettings = useCallback(
    (patch: WatchdogSettingsPatch) => post({ action: "save_settings", ...patch }),
    [post],
  );
  const revertSim = useCallback(() => post({ action: "revert_sim" }), [post]);
  const retryFailback = useCallback(
    () => post({ action: "retry_failback" }),
    [post],
  );

  return {
    data: snapshot?.data ?? null,
    settings: snapshot?.data.settings ?? null,
    receivedAt: snapshot?.receivedAt ?? null,
    isLoading,
    error,
    isSaving,
    saveSettings,
    revertSim,
    retryFailback,
    refresh: fetchData,
  };
}
