"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  LanConfigStatus,
  LanConfigSaveResponse,
} from "@/types/lan-config";

// =============================================================================
// useLanConfig — LAN Gateway/Subnet Hook
// =============================================================================
// Fetches the current br-lan IPv4 address + subnet on mount. Provides
// saveLanConfig to change network.lan.ipaddr / netmask.
//
// CRITICAL — self-severing apply: committing a new LAN IP and reloading the
// network rebinds br-lan, which kills THIS HTTP connection. When the address
// actually changes, the browser's current origin (the old IP) becomes
// unreachable. So unlike the old WoL hook, there is NO retry loop against the
// old origin — the backend flushes its response BEFORE the reload, and on
// success we flip straight to an "applied" state carrying the new address.
// The card surfaces a persistent banner telling the user to reconnect and
// browse to the new IP.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/network/lan_config.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/lan_config.sh";

export interface LanApplied {
  /** Address the device will be reachable at after the reload */
  newIpaddr: string;
  /** CIDR prefix that was applied */
  prefix: number;
  /** Seconds the LAN is expected to be unreachable */
  windowSeconds: number;
  /**
   * True when the backend bounced the LAN port carrier — a DHCP upstream router
   * reconnects automatically, so the banner can say so instead of asking for a
   * manual cable re-plug.
   */
  carrierBounce: boolean;
}

export interface SaveLanConfigResult {
  success: boolean;
  errorCode?: string;
  errorDetail?: string;
}

export interface UseLanConfigReturn {
  /** Current LAN config (null before first fetch) */
  data: LanConfigStatus | null;
  /** True while the initial fetch is in progress */
  isLoading: boolean;
  /** True while the POST save request is in-flight */
  isSaving: boolean;
  /** Set once a change has been committed + the reload armed (drives the banner) */
  applied: LanApplied | null;
  /** Error message if fetch or save failed */
  error: string | null;
  /** Re-fetch LAN config */
  refresh: () => Promise<void>;
  /** Apply a new gateway IP + prefix. Returns raw error codes on failure. */
  saveLanConfig: (ipaddr: string, prefix: number) => Promise<SaveLanConfigResult>;
}

export function useLanConfig(): UseLanConfigReturn {
  const { t } = useTranslation("errors");
  const [data, setData] = useState<LanConfigStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [applied, setApplied] = useState<LanApplied | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current LAN config
  // ---------------------------------------------------------------------------
  const fetchConfig = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setIsLoading(true);
      setError(null);

      try {
        const resp = await authFetch(CGI_ENDPOINT);
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
              json.detail,
              "Failed to fetch LAN settings",
            ),
          );
          return;
        }

        setData(json as LanConfigStatus);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to fetch LAN settings",
        );
      } finally {
        if (mountedRef.current && !silent) {
          setIsLoading(false);
        }
      }
    },
    [t],
  );

  // Fetch on mount
  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // ---------------------------------------------------------------------------
  // Save LAN config
  // ---------------------------------------------------------------------------
  const saveLanConfig = useCallback(
    async (ipaddr: string, prefix: number): Promise<SaveLanConfigResult> => {
      setError(null);
      setIsSaving(true);

      let resp: Response;
      try {
        resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ipaddr, prefix }),
        });
      } catch (err) {
        const detail =
          err instanceof Error ? err.message : "Failed to save LAN settings";
        if (mountedRef.current) {
          setError(detail);
          setIsSaving(false);
        }
        return { success: false, errorDetail: detail };
      }

      if (!resp.ok) {
        let json: LanConfigSaveResponse | null = null;
        try {
          json = await resp.json();
        } catch {
          // ignore parse error
        }
        if (mountedRef.current) {
          setError(
            resolveErrorMessage(
              t,
              json?.error,
              json?.detail,
              `HTTP ${resp.status}: ${resp.statusText}`,
            ),
          );
          setIsSaving(false);
        }
        return {
          success: false,
          errorCode: json?.error,
          errorDetail: json?.detail,
        };
      }

      let json: LanConfigSaveResponse;
      try {
        json = await resp.json();
      } catch {
        if (mountedRef.current) {
          setError("Failed to parse save response");
          setIsSaving(false);
        }
        return { success: false };
      }

      if (!json.success) {
        if (mountedRef.current) {
          setError(
            resolveErrorMessage(
              t,
              json.error,
              json.detail,
              "Failed to save LAN settings",
            ),
          );
          setIsSaving(false);
        }
        return {
          success: false,
          errorCode: json.error,
          errorDetail: json.detail,
        };
      }

      // --- Success: the reload is armed; the old origin is about to die. -------
      // Do NOT poll — flip straight to the applied state. The card shows a
      // persistent banner with the new address.
      if (mountedRef.current) {
        setIsSaving(false);
        setApplied({
          newIpaddr: json.new_ipaddr ?? ipaddr,
          prefix: json.prefix ?? prefix,
          windowSeconds: json.disconnect_window_seconds ?? 15,
          carrierBounce: json.carrier_bounce ?? false,
        });
      }
      return { success: true };
    },
    [t],
  );

  return {
    data,
    isLoading,
    isSaving,
    applied,
    error,
    refresh: fetchConfig,
    saveLanConfig,
  };
}
