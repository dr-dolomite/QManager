"use client";

import { useCallback, useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  IpaOffloadState,
  IpaOffloadGetResponse,
  IpaOffloadPostResponse,
} from "@/types/ipa-offload";

// =============================================================================
// useIpaOffload: read/toggle IPA hardware offload.
// =============================================================================
// Backend: /cgi-bin/quecmanager/system/ipa_offload.sh
//   GET                                  → { available, enabled }
//   POST {"action":"enable"|"disable"}   → { enabled, pending_reboot_required }
//
// PESSIMISTIC: the toggle never optimistically flips local state. On a
// successful POST we silently re-fetch the authoritative {available,enabled}
// so the Switch reflects what the device actually wrote. The toggle takes
// effect only after a reboot, so the component is responsible for the
// deferred-reboot affordance.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/ipa_offload.sh";

export interface UseIpaOffloadReturn {
  state: IpaOffloadState | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  setEnabled: (enabled: boolean) => Promise<boolean>;
  refresh: () => void;
}

export function useIpaOffload(): UseIpaOffloadReturn {
  const { t } = useTranslation("errors");
  const [state, setState] = useState<IpaOffloadState | null>(null);
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

  // ─── Fetch current state ────────────────────────────────────────────────
  const fetchState = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);

      try {
        const resp = await authFetch(CGI_ENDPOINT);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json: IpaOffloadGetResponse = await resp.json();
        if (!mountedRef.current) return;

        if (!json.success) {
          setError(
            resolveErrorMessage(
              t,
              json.error,
              json.detail,
              "Failed to read offload state",
            ),
          );
          return;
        }

        setState({ available: json.available, enabled: json.enabled });
      } catch (err) {
        if (!mountedRef.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to read offload state",
        );
      } finally {
        if (mountedRef.current && !silent) {
          setIsLoading(false);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // ─── Toggle (pessimistic) ───────────────────────────────────────────────
  const setEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: enabled ? "enable" : "disable" }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json: IpaOffloadPostResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(
            resolveErrorMessage(
              t,
              json.error,
              json.detail,
              "Failed to update offload",
            ),
          );
          return false;
        }

        // Pessimistic: re-read authoritative state instead of flipping locally.
        await fetchState(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to update offload",
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchState, t],
  );

  const refresh = useCallback(() => {
    fetchState();
  }, [fetchState]);

  return { state, isLoading, isSaving, error, setEnabled, refresh };
}
