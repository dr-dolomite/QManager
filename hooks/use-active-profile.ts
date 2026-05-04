"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { ProfileSummary, ProfileListResponse } from "@/types/sim-profile";

const CGI_BASE = "/cgi-bin/quecmanager/profiles";
const POLL_INTERVAL_MS = 30_000;

export interface UseActiveProfileReturn {
  activeProfile: ProfileSummary | null;
  isVerizonActive: boolean;
  isLoading: boolean;
  refresh: () => void;
}

export function useActiveProfile(): UseActiveProfileReturn {
  const [activeProfile, setActiveProfile] = useState<ProfileSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchActive = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const resp = await authFetch(`${CGI_BASE}/list.sh`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data: ProfileListResponse = await resp.json();
      if (!mountedRef.current) return;

      const active = data.active_profile_id
        ? (data.profiles ?? []).find((p) => p.id === data.active_profile_id) ?? null
        : null;

      setActiveProfile(active);
    } catch {
      // keep stale data on error
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActive();
    const id = setInterval(fetchActive, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchActive]);

  return {
    activeProfile,
    isVerizonActive: activeProfile?.mno === "Verizon",
    isLoading,
    refresh: fetchActive,
  };
}
