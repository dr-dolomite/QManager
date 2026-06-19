"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { QualityThresholdsSettings } from "@/types/modem-status";

// =============================================================================
// useQualityThresholds — read/write latency & packet-loss event thresholds
// =============================================================================
// GET  → { success: true, thresholds: { latency: { preset }, loss: { preset } },
//          isDefault }
// POST → { action: "save", latency_preset, loss_preset }
//        The nested settings shape is flattened to flat wire keys here because
//        the shell CGI parses flat fields.
//        success: { success: true, ... }
//        failure: { success: false, error, detail }
//
// Save rejects on failure so the calling card's try/catch can toast it; the
// message is also stored in `saveError` for the inline alert.
//
// CGI: /cgi-bin/quecmanager/system/quality_thresholds.sh
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/system/quality_thresholds.sh";

interface QualityThresholdsGetResponse {
  success: boolean;
  thresholds?: QualityThresholdsSettings;
  isDefault?: boolean;
  error?: string;
  detail?: string;
}

interface QualityThresholdsSaveResponse {
  success: boolean;
  error?: string;
  detail?: string;
}

export interface UseQualityThresholdsReturn {
  thresholds: QualityThresholdsSettings | undefined;
  isDefault: boolean;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  save: (settings: QualityThresholdsSettings) => Promise<void>;
}

export function useQualityThresholds(): UseQualityThresholdsReturn {
  const [thresholds, setThresholds] = useState<
    QualityThresholdsSettings | undefined
  >(undefined);
  const [isDefault, setIsDefault] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  const fetchThresholds = useCallback(async () => {
    try {
      const response = await authFetch(ENDPOINT);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json: QualityThresholdsGetResponse = await response.json();
      if (!mountedRef.current) return;

      if (!json.success || !json.thresholds) {
        setError(
          json.detail || json.error || "Failed to load quality thresholds",
        );
        setIsLoading(false);
        return;
      }

      setThresholds(json.thresholds);
      setIsDefault(json.isDefault ?? false);
      setError(null);
      setIsLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      const message =
        err instanceof Error ? err.message : "Failed to load quality thresholds";
      setError(message);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchThresholds();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchThresholds]);

  const save = useCallback(async (settings: QualityThresholdsSettings) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      // Flatten the nested client shape to the flat wire keys the CGI parses.
      // Custom raw values ride along only when their side's preset is `custom`.
      const body: Record<string, string | number> = {
        action: "save",
        latency_preset: settings.latency.preset,
        loss_preset: settings.loss.preset,
      };
      if (settings.latency.preset === "custom" && settings.latency.custom_ms != null) {
        body.latency_custom_ms = settings.latency.custom_ms;
      }
      if (settings.loss.preset === "custom" && settings.loss.custom_pct != null) {
        body.loss_custom_pct = settings.loss.custom_pct;
      }

      const response = await authFetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: QualityThresholdsSaveResponse = await response.json();
      if (!json.success) {
        throw new Error(json.detail || json.error || "Failed to save");
      }

      if (mountedRef.current) {
        // Saving an explicit preset clears the "using defaults" state.
        setThresholds(settings);
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
    thresholds,
    isDefault,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
  };
}
