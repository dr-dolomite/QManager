"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

const SETTINGS_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/settings.sh";
const STATUS_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/status.sh";
const PURGE_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/purge.sh";
const EXPORT_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/export.sh";
const GPS_TEST_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/gps-test.sh";
const TEST_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/test.sh";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CellMapperSettings {
  enabled: boolean;
  gps_source: "modem" | "gpsd_local" | "gpsd_remote" | "nmea" | "nmea_udp" | "http";
  gpsd_host: string;
  gpsd_port: number;
  nmea_device: string;
  nmea_baud: number;
  http_gps_url: string;
  http_gps_auth: string;
  nmea_udp_port: number;
  interval_moving: number;
  interval_stopped: number;
  neighbor_interval: number;
  speed_threshold: number;
  upload_target: "cellmapper" | "custom";
  custom_url: string;
  custom_auth: string;
  custom_format: string;
  custom_gzip: boolean;
  batch_size: number;
  upload_interval: number;
  retry_enabled: boolean;
  upload_policy: "always" | "lan_only" | "scheduled";
  buffer_size_mb: number;
  buffer_age_days: number;
  consent_accepted: boolean;
  consent_endpoint: string;
  log_level: string;
  // Read-only account fields
  username: string | null;
  linked_at: number | null;
}

export interface BufferStats {
  pending_count: number;
  pending_size_bytes: number;
  oldest_age_sec: number | null;
}

export interface UseCellMapperSettingsReturn {
  settings: CellMapperSettings | null;
  bufferStats: BufferStats | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveSettings: (partial: Partial<CellMapperSettings>) => Promise<boolean>;
  purgeBuffer: () => Promise<boolean>;
  exportCsv: () => Promise<void>;
  testGps: () => Promise<{ success: boolean; message: string; fixType?: string; satellites?: number }>;
  testConnection: () => Promise<{ success: boolean; message: string }>;
  testEndpoint: () => Promise<{ success: boolean; message: string }>;
  refresh: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useCellMapperSettings(): UseCellMapperSettingsReturn {
  const { t } = useTranslation("errors");
  const [settings, setSettings] = useState<CellMapperSettings | null>(null);
  const [bufferStats, setBufferStats] = useState<BufferStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current settings + buffer stats
  // ---------------------------------------------------------------------------
  const fetchSettings = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);

      try {
        const [settingsResp, statusResp] = await Promise.all([
          authFetch(SETTINGS_ENDPOINT),
          authFetch(STATUS_ENDPOINT),
        ]);

        const settingsData = await settingsResp.json();
        const statusData = await statusResp.json();

        if (!mountedRef.current) return;

        if (settingsData.success) {
          // Map the flat response to CellMapperSettings (fields map 1:1)
          setSettings(settingsData as unknown as CellMapperSettings);
        } else {
          setError(resolveErrorMessage(t, settingsData.error, settingsData.detail, "Failed to fetch settings"));
        }

        if (statusData.success) {
          setBufferStats(statusData.buffer);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(
            err instanceof Error ? err.message : "Failed to load settings"
          );
        }
      } finally {
        if (mountedRef.current && !silent) {
          setIsLoading(false);
        }
      }
    },
    [t]
  );

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ---------------------------------------------------------------------------
  // Save settings (partial update)
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(
    async (partial: Partial<CellMapperSettings>): Promise<boolean> => {
      setIsSaving(true);
      setError(null);

      try {
        const resp = await authFetch(SETTINGS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(partial),
        });

        const data = await resp.json();
        if (!mountedRef.current) return false;

        if (data.success) {
          await fetchSettings(true); // silent re-fetch
          return true;
        } else {
          setError(resolveErrorMessage(t, data.error, data.detail, "Failed to save settings"));
          return false;
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Save failed");
        }
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [t, fetchSettings]
  );

  // ---------------------------------------------------------------------------
  // Purge local buffer
  // ---------------------------------------------------------------------------
  const purgeBuffer = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await authFetch(PURGE_ENDPOINT, { method: "POST" });
      const data = await resp.json();
      if (data.success) {
        await fetchSettings(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [fetchSettings]);

  // ---------------------------------------------------------------------------
  // Export buffer as CSV
  // ---------------------------------------------------------------------------
  const exportCsv = useCallback(async (): Promise<void> => {
    try {
      const resp = await authFetch(EXPORT_ENDPOINT);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cellmapper-export-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* noop */
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Test GPS fix
  // ---------------------------------------------------------------------------
  const testGps = useCallback(async (): Promise<{
    success: boolean;
    message: string;
    fixType?: string;
    satellites?: number;
  }> => {
    try {
      const resp = await authFetch(GPS_TEST_ENDPOINT, { method: "POST" });
      const data = await resp.json();
      return {
        success: !!data.success,
        message: data.message || data.error || "",
        fixType: data.fix?.fix_type,
        satellites: data.fix?.satellites,
      };
    } catch {
      return { success: false, message: "Request failed" };
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Test CellMapper account connection
  // ---------------------------------------------------------------------------
  const testConnection = useCallback(async (): Promise<{
    success: boolean;
    message: string;
  }> => {
    try {
      const resp = await authFetch(TEST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_auth" }),
      });
      const data = await resp.json();
      return {
        success: !!data.success,
        message: data.message || data.error || "",
      };
    } catch {
      return { success: false, message: "Request failed" };
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Test custom upload endpoint
  // ---------------------------------------------------------------------------
  const testEndpoint = useCallback(async (): Promise<{
    success: boolean;
    message: string;
  }> => {
    try {
      const resp = await authFetch(TEST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_endpoint" }),
      });
      const data = await resp.json();
      return {
        success: !!data.success,
        message: data.message || data.error || "",
      };
    } catch {
      return { success: false, message: "Request failed" };
    }
  }, []);

  return {
    settings,
    bufferStats,
    isLoading,
    isSaving,
    error,
    saveSettings,
    purgeBuffer,
    exportCsv,
    testGps,
    testConnection,
    testEndpoint,
    refresh: () => fetchSettings(),
  };
}
