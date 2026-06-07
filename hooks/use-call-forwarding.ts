"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

// =============================================================================
// useCallForwarding — Network-level unconditional call forwarding (AT+CCFC)
// =============================================================================
// Unlike SMS forwarding (app-level), this reflects NETWORK truth: the carrier
// owns the state, queried live via AT+CCFC=0,2. Some carriers reject the
// supplementary-service interrogation entirely (CME ERROR 257), which is a
// first-class "not supported on this network" state, not a generic failure.
//
// Backend: GET/POST /cgi-bin/quecmanager/cellular/call_forwarding.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/call_forwarding.sh";

// ─── Types ─────────────────────────────────────────────────────────────────

export type CallForwardingStatus =
  | "active" // network confirms forwarding is on
  | "inactive" // network confirms forwarding is off
  | "network_rejected" // carrier blocks reading/controlling forwarding
  | "query_failed" // modem/AT error reading state
  | "unknown"; // not yet queried

export interface CallForwardingState {
  status: CallForwardingStatus;
  number: string; // network-reported active number (when active)
  lastNumber: string; // remembered number for prefill
}

export interface UseCallForwardingReturn {
  state: CallForwardingState;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  setForwarding: (number: string) => Promise<boolean>;
  disableForwarding: () => Promise<boolean>;
  refresh: () => void;
}

const INITIAL_STATE: CallForwardingState = {
  status: "unknown",
  number: "",
  lastNumber: "",
};

// Map a backend error code to a typed status (else null = not a CF status code).
function statusFromError(code: string | undefined | null): CallForwardingStatus | null {
  switch (code) {
    case "cf_network_rejected":
      return "network_rejected";
    case "cf_query_failed":
      return "query_failed";
    default:
      return null;
  }
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useCallForwarding(): UseCallForwardingReturn {
  const { t } = useTranslation("errors");
  const [state, setState] = useState<CallForwardingState>(INITIAL_STATE);
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
  // Query live network state
  // ---------------------------------------------------------------------------
  const fetchState = useCallback(
    async (silent = false) => {
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
          const mapped = statusFromError(json.error);
          if (mapped) {
            // Carrier-rejection / query-failure are expected states, surfaced
            // as status (and last_number, if the backend echoed it) — not as a
            // blocking error.
            setState((prev) => ({
              status: mapped,
              number: "",
              lastNumber: json.last_number ?? prev.lastNumber,
            }));
            return;
          }
          setError(
            resolveErrorMessage(
              t,
              json.error,
              json.detail,
              "Failed to read call forwarding state",
            ),
          );
          return;
        }

        setState({
          status: json.active ? "active" : "inactive",
          number: json.number ?? "",
          lastNumber: json.last_number ?? json.number ?? "",
        });
      } catch (err) {
        if (!mountedRef.current) return;
        if (!silent) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to read call forwarding state",
          );
        }
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

  // ---------------------------------------------------------------------------
  // Shared POST helper for set / disable
  // ---------------------------------------------------------------------------
  const post = useCallback(
    async (
      body: Record<string, unknown>,
      fallback: string,
    ): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          const mapped = statusFromError(json.error);
          if (mapped === "network_rejected") {
            setState((prev) => ({ ...prev, status: "network_rejected" }));
          }
          setError(resolveErrorMessage(t, json.error, json.detail, fallback));
          return false;
        }

        await fetchState(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(err instanceof Error ? err.message : fallback);
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchState, t],
  );

  const setForwarding = useCallback(
    (number: string) =>
      post({ action: "set", number }, "Failed to set call forwarding"),
    [post],
  );

  const disableForwarding = useCallback(
    () => post({ action: "disable" }, "Failed to disable call forwarding"),
    [post],
  );

  return {
    state,
    isLoading,
    isSaving,
    error,
    setForwarding,
    disableForwarding,
    refresh: fetchState,
  };
}
