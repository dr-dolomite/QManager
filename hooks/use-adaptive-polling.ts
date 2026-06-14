"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { AdaptivePollingSettings, PollerTier } from "@/types/modem-status";

// =============================================================================
// useAdaptivePolling — read/write the UI-aware poller backoff settings
// =============================================================================
// GET  → { success: true,
//          settings: { enabled, active_grace, idle_interval, idle_threshold,
//                      deep_idle_interval },
//          isDefault, tier }
//        `tier` is the LIVE current backoff tier the poller is running at,
//        read by the backend from status.json.
// POST → { action: "save", enabled, active_grace, idle_interval,
//          idle_threshold, deep_idle_interval }
//        success: { success: true }
//        failure: { success: false, error, detail }
//
// Save rejects on failure so the calling card's try/catch can toast it; the
// message is also stored in `saveError` for the inline alert.
//
// A light 10 s silent refresh keeps the live-tier badge fresh while the card is
// open (mirrors the use-watchdog-settings setInterval pattern).
//
// CGI: /cgi-bin/quecmanager/system/adaptive_polling.sh
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/system/adaptive_polling.sh";
const TIER_REFRESH_MS = 10_000;

interface AdaptivePollingGetResponse {
  success: boolean;
  settings?: AdaptivePollingSettings;
  isDefault?: boolean;
  tier?: PollerTier;
  error?: string;
  detail?: string;
}

interface AdaptivePollingSaveResponse {
  success: boolean;
  error?: string;
  detail?: string;
}

export interface UseAdaptivePollingReturn {
  settings: AdaptivePollingSettings | undefined;
  isDefault: boolean;
  tier: PollerTier | undefined;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  save: (next: AdaptivePollingSettings) => Promise<void>;
  refresh: () => void;
}

export function useAdaptivePolling(): UseAdaptivePollingReturn {
  const [settings, setSettings] = useState<AdaptivePollingSettings | undefined>(
    undefined,
  );
  const [isDefault, setIsDefault] = useState(false);
  const [tier, setTier] = useState<PollerTier | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  // `silent` skips the loading spinner — used by the periodic tier refresh so
  // it never flashes a skeleton over a populated card.
  const fetchSettings = useCallback(async (silent = false) => {
    if (!silent && mountedRef.current) setIsLoading(true);
    try {
      const response = await authFetch(ENDPOINT);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json: AdaptivePollingGetResponse = await response.json();
      if (!mountedRef.current) return;

      if (!json.success || !json.settings) {
        if (!silent) {
          setError(
            json.detail || json.error || "Failed to load adaptive polling",
          );
        }
        setIsLoading(false);
        return;
      }

      setSettings(json.settings);
      setIsDefault(json.isDefault ?? false);
      setTier(json.tier);
      setError(null);
      setIsLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      if (!silent) {
        const message =
          err instanceof Error ? err.message : "Failed to load adaptive polling";
        setError(message);
      }
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchSettings();
    const id = setInterval(() => {
      fetchSettings(true);
    }, TIER_REFRESH_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchSettings]);

  const save = useCallback(async (next: AdaptivePollingSettings) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const response = await authFetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          enabled: next.enabled,
          active_grace: next.active_grace,
          idle_interval: next.idle_interval,
          idle_threshold: next.idle_threshold,
          deep_idle_interval: next.deep_idle_interval,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: AdaptivePollingSaveResponse = await response.json();
      if (!json.success) {
        throw new Error(json.detail || json.error || "Failed to save");
      }

      if (mountedRef.current) {
        // Optimistic: an explicit save clears the "using defaults" state.
        setSettings(next);
        setIsDefault(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      if (mountedRef.current) setSaveError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  }, []);

  return {
    settings,
    isDefault,
    tier,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
    refresh: fetchSettings,
  };
}
