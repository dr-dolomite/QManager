"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ManagedSite,
  AddSiteFormData,
  SiteStatus,
  SiteSnapshot,
} from "@/types/site-manager";

const STORAGE_KEY = "qm_managed_sites";
const POLL_INTERVAL = 30_000; // 30 seconds

function generateId(): string {
  return `site_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadSites(): ManagedSite[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ManagedSite[];
  } catch {
    return [];
  }
}

function saveSites(sites: ManagedSite[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sites));
}

function buildBaseUrl(address: string, port?: number): string {
  const proto = port === 443 ? "https" : "http";
  const portSuffix = port && port !== 80 && port !== 443 ? `:${port}` : "";
  return `${proto}://${address}${portSuffix}`;
}

const PROXY_ENDPOINT = "/cgi-bin/quecmanager/site_manager/proxy.sh";

async function probeSite(
  address: string,
  port?: number,
  password?: string
): Promise<{ status: SiteStatus; snapshot?: SiteSnapshot; authFailed?: boolean }> {
  if (!password) {
    return { status: "unknown", authFailed: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(PROXY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: controller.signal,
      body: JSON.stringify({ address, port: port || 80, password }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { status: response.status === 401 ? "online" : "degraded" };
    }

    const data = await response.json();

    // Proxy returned an auth error from the remote device
    if (data.auth_failed) {
      return { status: "degraded", authFailed: true };
    }

    // Proxy returned an explicit error wrapper
    if (data.success === false && !data.modem_reachable && !data.timestamp) {
      return { status: "degraded" };
    }

    // Valid modem data — check if modem is reachable
    if (data.modem_reachable === false) {
      return { status: "degraded" };
    }

    const snapshot: SiteSnapshot = {
      model: data.device?.model,
      firmware: data.device?.firmware,
      operator: data.network?.carrier,
      connectionType: data.nr?.state === "connected"
        ? data.lte?.state === "connected"
          ? "NR5G-NSA"
          : "NR5G-SA"
        : data.lte?.state === "connected"
          ? "LTE"
          : undefined,
      band: data.nr?.state === "connected"
        ? data.nr?.band
        : data.lte?.band,
      rsrp: data.nr?.state === "connected"
        ? data.nr?.rsrp
        : data.lte?.rsrp,
      rsrq: data.nr?.state === "connected"
        ? data.nr?.rsrq
        : data.lte?.rsrq,
      sinr: data.nr?.state === "connected"
        ? data.nr?.sinr
        : data.lte?.sinr,
      ipAddress: data.network?.wan_ipv4,
    };
    return { status: "online", snapshot };
  } catch {
    clearTimeout(timeout);
    return { status: "offline" };
  }
}

export function useSiteManager() {
  const [sites, setSites] = useState<ManagedSite[]>(() => loadSites());
  const isLoading = false;
  const [isPolling, setIsPolling] = useState(false);
  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Poll all sites periodically
  const pollAllSites = useCallback(async () => {
    const current = loadSites();
    if (current.length === 0) return;

    setIsPolling(true);

    const updated = await Promise.all(
      current.map(async (site) => {
        const result = await probeSite(site.address, site.port, site.password);
        return {
          ...site,
          status: result.status,
          snapshot: result.snapshot ?? site.snapshot,
          lastSeen:
            result.status === "online" ? Date.now() : site.lastSeen,
        };
      })
    );

    if (!mountedRef.current) return;
    setSites(updated);
    saveSites(updated);
    setIsPolling(false);
  }, []);

  // Start polling on mount
  useEffect(() => {
    // Initial poll — schedule as microtask to avoid sync setState in effect
    const initialTimeout = setTimeout(() => pollAllSites(), 0);

    intervalRef.current = setInterval(pollAllSites, POLL_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [pollAllSites]);

  const addSite = useCallback((formData: AddSiteFormData) => {
    const newSite: ManagedSite = {
      id: generateId(),
      name: formData.name,
      address: formData.address,
      port: formData.port,
      password: formData.password,
      notes: formData.notes,
      addedAt: Date.now(),
      status: "unknown",
    };

    setSites((prev) => {
      const next = [...prev, newSite];
      saveSites(next);
      return next;
    });

    // Probe the new site immediately
    probeSite(newSite.address, newSite.port, newSite.password).then((result) => {
      if (!mountedRef.current) return;
      setSites((prev) => {
        const next = prev.map((s) =>
          s.id === newSite.id
            ? {
                ...s,
                status: result.status,
                snapshot: result.snapshot,
                lastSeen:
                  result.status === "online" ? Date.now() : undefined,
              }
            : s
        );
        saveSites(next);
        return next;
      });
    });

    return newSite;
  }, []);

  const removeSite = useCallback((id: string) => {
    setSites((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveSites(next);
      return next;
    });
  }, []);

  const updateSite = useCallback(
    (id: string, updates: Partial<AddSiteFormData>) => {
      setSites((prev) => {
        const next = prev.map((s) =>
          s.id === id ? { ...s, ...updates } : s
        );
        saveSites(next);
        return next;
      });
    },
    []
  );

  const refreshSite = useCallback(async (id: string) => {
    const current = loadSites();
    const site = current.find((s) => s.id === id);
    if (!site) return;

    const result = await probeSite(site.address, site.port, site.password);

    if (!mountedRef.current) return;
    setSites((prev) => {
      const next = prev.map((s) =>
        s.id === id
          ? {
              ...s,
              status: result.status,
              snapshot: result.snapshot ?? s.snapshot,
              lastSeen:
                result.status === "online" ? Date.now() : s.lastSeen,
            }
          : s
      );
      saveSites(next);
      return next;
    });
  }, []);

  const openSite = useCallback((site: ManagedSite) => {
    const baseUrl = buildBaseUrl(site.address, site.port);
    window.open(`${baseUrl}/dashboard`, "_blank", "noopener,noreferrer");
  }, []);

  return {
    sites,
    isLoading,
    isPolling,
    addSite,
    removeSite,
    updateSite,
    refreshSite,
    pollAllSites,
    openSite,
  };
}
