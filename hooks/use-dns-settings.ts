"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

// =============================================================================
// useDnsSettings — Custom DNS Fetch & Save Hook
// =============================================================================
// Fetches current DNS mode, NIC, and server list on mount.
// Provides saveDns for applying or reverting custom DNS configuration.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/network/dns.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/dns.sh";

export interface DnsSettingsData {
  /** Current mode: "enabled" = custom DNS active, "disabled" = carrier DNS */
  mode: "enabled" | "disabled";
  /** Raw comma-separated IPv4 DNS string from backend e.g. "8.8.8.8,1.1.1.1" */
  currentDNS: string;
  /** Raw comma-separated IPv6 DNS string from backend e.g. "2606:4700:4700::1111" */
  currentDNS6: string;
  /** Active NIC determined by IP passthrough state: "lan" or "lan_bind4" */
  nic: "lan" | "lan_bind4";
  /** Primary IPv4 DNS server (parsed from currentDNS[0]) */
  dns1: string;
  /** Secondary IPv4 DNS server (parsed from currentDNS[1]) */
  dns2: string;
  /** Tertiary IPv4 DNS server (parsed from currentDNS[2]) */
  dns3: string;
  /** Primary IPv6 DNS server (parsed from currentDNS6[0]) */
  dns1v6: string;
  /** Secondary IPv6 DNS server (parsed from currentDNS6[1]) */
  dns2v6: string;
}

export interface SaveDnsParams {
  mode: "enabled" | "disabled";
  nic: string;
  dns1: string;
  dns2: string;
  dns3: string;
  dns1v6: string;
  dns2v6: string;
}

export interface UseDnsSettingsReturn {
  /** Current DNS data (null before first fetch) */
  data: DnsSettingsData | null;
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /** True while a save operation is in progress */
  isSaving: boolean;
  /** Error message if fetch or save failed */
  error: string | null;
  /** Apply new DNS settings. Returns true on success. */
  saveDns: (params: SaveDnsParams) => Promise<boolean>;
  /** Re-fetch DNS settings */
  refresh: () => void;
}

export function useDnsSettings(): UseDnsSettingsReturn {
  const { t } = useTranslation("errors");
  const [data, setData] = useState<DnsSettingsData | null>(null);
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
  // Fetch current DNS settings
  // ---------------------------------------------------------------------------
  const fetchDns = useCallback(async (silent = false) => {
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
        setError(resolveErrorMessage(t, json.error, undefined, "Failed to fetch DNS settings"));
        return;
      }

      // Parse the comma-separated DNS strings into individual fields. The
      // backend joins the IPv6 odhcpd list with commas too, so both families
      // share the same split/trim/filter logic.
      const parts = (json.currentDNS || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const parts6 = (json.currentDNS6 || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);

      setData({
        mode: json.mode === "enabled" ? "enabled" : "disabled",
        currentDNS: json.currentDNS || "",
        currentDNS6: json.currentDNS6 || "",
        nic: json.nic === "lan_bind4" ? "lan_bind4" : "lan",
        dns1: parts[0] || "",
        dns2: parts[1] || "",
        dns3: parts[2] || "",
        dns1v6: parts6[0] || "",
        dns2v6: parts6[1] || "",
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch DNS settings",
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, [t]);

  // Fetch on mount
  useEffect(() => {
    fetchDns();
  }, [fetchDns]);

  // ---------------------------------------------------------------------------
  // Save DNS settings
  // ---------------------------------------------------------------------------
  const saveDns = useCallback(
    async (params: SaveDnsParams): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(resolveErrorMessage(t, json.error, json.detail, "Failed to apply DNS settings"));
          return false;
        }

        // Silent re-fetch to update local state
        await fetchDns(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to apply DNS settings",
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchDns, t],
  );

  return {
    data,
    isLoading,
    isSaving,
    error,
    saveDns,
    refresh: fetchDns,
  };
}
