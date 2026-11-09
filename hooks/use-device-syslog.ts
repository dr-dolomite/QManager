"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { startVisibleInterval } from "@/lib/visible-interval";
import type {
  DeviceLogLines,
  DeviceLogResponse,
  DeviceLogSource,
} from "@/types/device-syslog";

// =============================================================================
// useDeviceSyslog: the modem's own logs (system log ring or kernel ring)
// =============================================================================
// GET system/syslog.sh?source=system|kernel&lines=<n>   (read-only, newest first)
//
// Refetches every 10 s while the tab is visible (startVisibleInterval) and at
// once when `source` or `lines` changes. The previous response stays in `data`
// while the next one loads (`isLoading` is true, `data` is not cleared), so a
// source or size switch never flashes back to a skeleton. A response for a query
// that has since been replaced is dropped (AbortController).
//
// `paused` (a dialog is open, say) tears the interval down and fetches nothing;
// unpausing fetches at once. While paused, `isLoading` is false.
//
// `error` is set only when the current query has no data to show: a failed
// poll behind an on-screen response keeps that response and retries next tick.
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/system/syslog.sh";
const POLL_MS = 10_000;
const FALLBACK_ERROR = "Failed to load device logs";

export interface UseDeviceSyslogOptions {
  /** Suspend polling and fetching entirely. */
  paused?: boolean;
}

export interface UseDeviceSyslogReturn {
  /** Latest successful response; stays the previous query's while a new one loads. */
  data: DeviceLogResponse | null;
  /** A fetch for the current query has not settled yet (never true while paused). */
  isLoading: boolean;
  /** Resolved message when the current query failed and has no data; else null. */
  error: string | null;
  /** Refetch the current query now. */
  refresh: () => void;
}

interface EnvelopeError {
  code?: string;
  detail?: string;
}

interface ResourceState {
  /** URL that `data` answers. */
  dataUrl: string | null;
  data: DeviceLogResponse | null;
  /** Fetch key (url + refresh count) that last settled, success or failure. */
  settledKey: string | null;
  /** Fetch key the failure belongs to. */
  errorKey: string | null;
  errorInfo: EnvelopeError | null;
}

const INITIAL: ResourceState = {
  dataUrl: null,
  data: null,
  settledKey: null,
  errorKey: null,
  errorInfo: null,
};

export function useDeviceSyslog(
  source: DeviceLogSource,
  lines: DeviceLogLines,
  opts: UseDeviceSyslogOptions = {},
): UseDeviceSyslogReturn {
  const paused = opts.paused ?? false;
  const { t } = useTranslation("errors");
  const [state, setState] = useState<ResourceState>(INITIAL);
  const [nonce, setNonce] = useState(0);

  const url = `${ENDPOINT}?source=${source}&lines=${lines}`;
  const key = `${url}#${nonce}`;

  useEffect(() => {
    if (paused) return;

    const controller = new AbortController();
    let inFlight = false;

    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const resp = await authFetch(url, { signal: controller.signal });
        const json = (await resp.json()) as DeviceLogResponse &
          EnvelopeError & { error?: string; success: boolean };
        if (controller.signal.aborted) return;
        if (!json.success) {
          setState((prev) => ({
            ...prev,
            settledKey: key,
            errorKey: key,
            errorInfo: { code: json.error, detail: json.detail },
          }));
          return;
        }
        setState({ dataUrl: url, data: json, settledKey: key, errorKey: null, errorInfo: null });
      } catch {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          settledKey: key,
          errorKey: key,
          errorInfo: {},
        }));
      } finally {
        inFlight = false;
      }
    };

    // Paused while the tab is hidden; fetches at once when shown again.
    const stop = startVisibleInterval(() => void load(), POLL_MS);
    return () => {
      controller.abort();
      stop();
    };
  }, [url, key, paused]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // A failure only counts when nothing for this query is on screen.
  const failed = state.errorKey === key && state.dataUrl !== url ? state.errorInfo : null;
  const error = useMemo(
    () =>
      failed
        ? resolveErrorMessage(t, failed.code, failed.detail, FALLBACK_ERROR)
        : null,
    [failed, t],
  );

  return {
    data: state.data,
    isLoading: !paused && state.settledKey !== key,
    error,
    refresh,
  };
}
