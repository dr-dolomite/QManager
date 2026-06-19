"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { PingProfile } from "@/types/modem-status";

// =============================================================================
// usePingProfile — read/write the ping-daemon sensitivity profile + targets
// =============================================================================
// GET  → { success: true, profile, target1, target2 }
// POST → { action: "save", profile, target_1, target_2 }
//        success: { success: true, ... }
//        failure: { success: false, error, detail }
//
// Save rejects on failure so the calling card's try/catch can toast the error;
// it also stores the message in `saveError` for the inline alert.
//
// CGI: /cgi-bin/quecmanager/system/ping_profile.sh
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/system/ping_profile.sh";

interface PingProfileGetResponse {
  success: boolean;
  profile?: PingProfile;
  target1?: string;
  target2?: string;
  // Probe interval is owned jointly with the Watchdog: when the Watchdog sets a
  // Custom interval it writes `interval_override`, which wins over the profile's
  // derived interval. The Sensitivity card reflects this read-only.
  interval_override?: number | null;
  effective_interval?: number;
  error?: string;
  detail?: string;
}

interface PingProfileSaveResponse {
  success: boolean;
  error?: string;
  detail?: string;
}

export interface SavePingProfileArgs {
  profile: PingProfile;
  target_1: string;
  target_2: string;
}

export interface UsePingProfileReturn {
  profile: PingProfile | undefined;
  target1: string | undefined;
  target2: string | undefined;
  /** Custom probe interval set by the Watchdog; null = none (use profile). */
  intervalOverride: number | null;
  /** Effective probe interval in seconds (override if set, else profile). */
  effectiveInterval: number | undefined;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  save: (args: SavePingProfileArgs) => Promise<void>;
}

export function usePingProfile(): UsePingProfileReturn {
  const [profile, setProfile] = useState<PingProfile | undefined>(undefined);
  const [target1, setTarget1] = useState<string | undefined>(undefined);
  const [target2, setTarget2] = useState<string | undefined>(undefined);
  const [intervalOverride, setIntervalOverride] = useState<number | null>(null);
  const [effectiveInterval, setEffectiveInterval] = useState<
    number | undefined
  >(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  const fetchProfile = useCallback(async () => {
    try {
      const response = await authFetch(ENDPOINT);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json: PingProfileGetResponse = await response.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.detail || json.error || "Failed to load ping profile");
        setIsLoading(false);
        return;
      }

      setProfile(json.profile);
      setTarget1(json.target1);
      setTarget2(json.target2);
      setIntervalOverride(json.interval_override ?? null);
      setEffectiveInterval(json.effective_interval);
      setError(null);
      setIsLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      const message =
        err instanceof Error ? err.message : "Failed to load ping profile";
      setError(message);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchProfile();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchProfile]);

  const save = useCallback(async (args: SavePingProfileArgs) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const response = await authFetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          profile: args.profile,
          target_1: args.target_1,
          target_2: args.target_2,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: PingProfileSaveResponse = await response.json();
      if (!json.success) {
        throw new Error(json.detail || json.error || "Failed to save");
      }

      if (mountedRef.current) {
        // Reflect the just-saved values so dirty detection settles.
        setProfile(args.profile);
        setTarget1(args.target_1);
        setTarget2(args.target_2);
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
    profile,
    target1,
    target2,
    intervalOverride,
    effectiveInterval,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
  };
}
