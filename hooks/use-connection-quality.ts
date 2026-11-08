"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { startVisibleInterval } from "@/lib/visible-interval";
import type {
  CqGetResponse,
  CqLastOutage,
  CqLive,
  CqWdMutationResult,
  SaveProbeBody,
  SaveThresholdsBody,
  SlotLive,
  UseConnectionQualityReturn,
} from "@/types/cq-watchdog";

// =============================================================================
// useConnectionQuality: Connection Quality settings + live probe state
// =============================================================================
// GET  → { success, settings, cadence, tables, is_default, live, last_outage }
// POST → { action: "save_probe", sensitivity, targets }
//        { action: "save_thresholds", latency: {...}, loss: {...} }
//        success: { success: true }
//        failure: { success: false, error, field?, detail? }
//
// The GET is polled every 5 s while the tab is visible (the `live` block moves
// with the probe). Polls are silent: they never flip `isLoading`, and a failed
// poll keeps the last good `data` and only sets `error`. `settings` keeps its
// object identity while the values are unchanged so a form seeded from it does
// not reset under the user's hands.
//
// Mutations never throw: they return a `CqWdMutationResult`, so a handler
// toasts from the call's own result, never from hook state read after `await`.
//
// CGI: /cgi-bin/quecmanager/monitoring/connection_quality.sh
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/monitoring/connection_quality.sh";
const POLL_MS = 5_000;

const EMPTY_SLOT: SlotLive = { state: "standby", rtt_ms: null };

function emptyLive(): CqLive {
  return {
    reachable: null,
    last_leg: 0,
    slots: [{ ...EMPTY_SLOT }, { ...EMPTY_SLOT }, { ...EMPTY_SLOT }, { ...EMPTY_SLOT }],
  };
}

function normaliseLive(raw: unknown): CqLive {
  if (!raw || typeof raw !== "object") return emptyLive();
  const r = raw as Partial<CqLive>;
  const fallback = emptyLive();
  const slots = fallback.slots.map((blank, i) => {
    const s = Array.isArray(r.slots) ? r.slots[i] : undefined;
    return s && typeof s === "object" ? { ...blank, ...s } : blank;
  }) as CqLive["slots"];
  return {
    reachable: typeof r.reachable === "boolean" ? r.reachable : null,
    last_leg: typeof r.last_leg === "number" ? r.last_leg : 0,
    slots,
  };
}

function normaliseOutage(raw: unknown): CqLastOutage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<CqLastOutage>;
  if (typeof r.duration_s !== "number" || typeof r.ended_ago_s !== "number") {
    return null;
  }
  return {
    duration_s: r.duration_s,
    ended_ago_s: r.ended_ago_s,
    wan_changed: typeof r.wan_changed === "boolean" ? r.wan_changed : null,
  };
}

/** Values-only equality for the small, key-stable settings object. */
function sameValues(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useConnectionQuality(): UseConnectionQualityReturn {
  const { t } = useTranslation("errors");
  const [data, setData] = useState<CqGetResponse | null>(null);
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

      const next: CqGetResponse = {
        ...json,
        live: normaliseLive(json.live),
        last_outage: normaliseOutage(json.last_outage),
      };
      setData((prev) => ({
        ...next,
        settings:
          prev && sameValues(prev.settings, next.settings)
            ? prev.settings
            : next.settings,
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
              json?.detail,
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

  const saveProbe = useCallback(
    (body: Omit<SaveProbeBody, "action">) =>
      post({ action: "save_probe", ...body }),
    [post],
  );

  const saveThresholds = useCallback(
    (body: Omit<SaveThresholdsBody, "action">) =>
      post({ action: "save_thresholds", ...body }),
    [post],
  );

  return {
    data,
    isLoading,
    error,
    isSaving,
    saveProbe,
    saveThresholds,
    refresh: fetchData,
  };
}
