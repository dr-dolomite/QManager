"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { InstallResult } from "@/types/video-optimizer";

// =============================================================================
// useTailscale — Fetch & Action Hook for Tailscale VPN Management
// =============================================================================
// Fetches Tailscale status on mount (tiered: not installed → stopped → full).
// Provides action methods for connect, disconnect, logout, service, boot,
// exit-node and network-fixes toggles, install, update and uninstall.
// Adaptive polling: 10s normal, 3s during auth wait.
//
// Update: the official build is replaced in place and tailscaled restarts, so
// the tunnel (and this page, when it is served over it) drops for a few
// seconds. `runUpdate` therefore tolerates a window of failed progress polls
// instead of reading them as a failed update.
//
// Every action RETURNS its outcome (`TailscaleActionResult`) instead of parking
// the failure reason in hook state: a caller that toasts after an `await` would
// read a stale closure of that state. The `error` field is the status READ only.
//
// Backend: GET/POST /cgi-bin/quecmanager/vpn/tailscale.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/vpn/tailscale.sh";

const POLL_NORMAL_MS = 10_000;
const POLL_AUTH_MS = 3_000;

const INSTALL_POLL_MS = 2_000;
/** Failed progress reads this long in a row mean the update is not coming back. */
const UPDATE_FAIL_TOLERANCE_MS = 20_000;
/** Upper bound on one update, download over cellular included. */
const UPDATE_MAX_MS = 10 * 60_000;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TailscaleSelf {
  hostname: string;
  dns_name: string;
  tailscale_ips: string[];
  online: boolean;
  os: string;
  relay: string;
}

export interface TailscaleTailnet {
  name: string;
  magic_dns_suffix: string;
  magic_dns_enabled: boolean;
}

export interface TailscalePeer {
  hostname: string;
  dns_name: string;
  tailscale_ips: string[];
  os: string;
  online: boolean;
  last_seen: string;
  relay: string;
  exit_node: boolean;
}

/** Where an install comes from: Tailscale's own build or the Tiny opkg build. */
export type TailscaleInstallSource = "official" | "tiny";

export interface TailscaleStatus {
  installed: boolean;
  daemon_running?: boolean;
  enabled_on_boot?: boolean;
  version?: string;
  backend_state?: string;
  auth_url?: string;
  self?: TailscaleSelf;
  tailnet?: TailscaleTailnet;
  peers?: TailscalePeer[];
  health?: string[];
  install_variant?: TailscaleInstallSource | "opkg";
  /** Newest version from the installed source, "" when it could not be determined. */
  latest_version?: string;
  /** Official and Tiny builds; always false on a legacy build. */
  update_available?: boolean;
  /** An unknown opkg build. It cannot be updated in place. */
  legacy_build?: boolean;
  /**
   * Reachability fixes for tailnet devices (fw4 zone + routing rule). Absent on
   * the Tiny build, whose own service sets that up.
   */
  net_fixes_enabled?: boolean;
  /** The firmware trusts the Tiny build's package feed, so it can be installed. */
  tiny_available?: boolean;
  /** An install or update holds the lock; the other fields may be absent. */
  busy?: "install" | "update";
  exit_node_advertised?: boolean;
  /** Tailscale SSH server (tailscaled's RunSSH pref); null when unreadable. */
  ssh_enabled?: boolean | null;
  error_detail?: string;
  other_vpn_installed?: boolean;
  other_vpn_name?: string;
}

/** `install_status` also reports which operation is (or was) running. */
export interface TailscaleInstallResult extends InstallResult {
  op?: "install" | "update";
}

/**
 * The outcome of one mutation. `reason` is the backend's own explanation,
 * already resolved through `resolveErrorMessage`; it is empty when the backend
 * gave none, so the caller supplies its translated fallback.
 */
export interface TailscaleActionResult {
  ok: boolean;
  reason: string;
}

export interface UseTailscaleReturn {
  status: TailscaleStatus | null;
  isLoading: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isTogglingService: boolean;
  isTogglingBoot: boolean;
  isTogglingExitNode: boolean;
  isTogglingSsh: boolean;
  isUninstalling: boolean;
  isUpdating: boolean;
  isTogglingNetFixes: boolean;
  installResult: TailscaleInstallResult;
  error: string | null;
  connect: () => Promise<TailscaleActionResult>;
  disconnect: () => Promise<TailscaleActionResult>;
  logout: () => Promise<TailscaleActionResult>;
  startService: () => Promise<TailscaleActionResult>;
  stopService: () => Promise<TailscaleActionResult>;
  setBootEnabled: (enabled: boolean) => Promise<TailscaleActionResult>;
  setExitNodeAdvertised: (enabled: boolean) => Promise<TailscaleActionResult>;
  setSshEnabled: (enabled: boolean) => Promise<TailscaleActionResult>;
  uninstall: () => Promise<TailscaleActionResult>;
  setNetFixes: (enabled: boolean) => Promise<TailscaleActionResult>;
  checkUpdate: (force?: boolean) => Promise<TailscaleActionResult>;
  runUpdate: () => Promise<TailscaleActionResult>;
  runInstall: (source?: TailscaleInstallSource) => Promise<void>;
  refresh: () => void;
}

interface PostResponse {
  success: boolean;
  error?: string;
  detail?: string;
}

interface InstallStatusResponse extends PostResponse {
  status?: TailscaleInstallResult["status"];
  message?: string;
  log?: string;
  op?: "install" | "update";
}

interface CheckUpdateResponse extends PostResponse {
  latest_version?: string;
  update_available?: boolean;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const OK: TailscaleActionResult = { ok: true, reason: "" };

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useTailscale(): UseTailscaleReturn {
  const { t } = useTranslation("errors");
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isTogglingService, setIsTogglingService] = useState(false);
  const [isTogglingBoot, setIsTogglingBoot] = useState(false);
  const [isTogglingExitNode, setIsTogglingExitNode] = useState(false);
  const [isTogglingSsh, setIsTogglingSsh] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isTogglingNetFixes, setIsTogglingNetFixes] = useState(false);
  const [installResult, setInstallResult] = useState<TailscaleInstallResult>({
    success: true,
    status: "idle",
  });
  const installPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const updatingRef = useRef(false);
  const updateCheckedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (installPollRef.current) clearInterval(installPollRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current status
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(
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
          setError(
            resolveErrorMessage(
              t,
              json.error,
              undefined,
              "Failed to fetch Tailscale status",
            ),
          );
          return;
        }

        // While an install or update holds the lock the CGI answers with a bare
        // `{installed, busy}`. Layered over a good payload it keeps the card on
        // screen; replacing it would read as "service stopped".
        if (json.busy) {
          setStatus((prev) =>
            prev?.installed ? { ...prev, busy: json.busy } : json,
          );
          return;
        }

        setStatus(json);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch Tailscale status",
        );
      } finally {
        if (mountedRef.current && !silent) {
          setIsLoading(false);
        }
      }
    },
    [t],
  );

  // ---------------------------------------------------------------------------
  // Adaptive polling — faster during auth wait
  // ---------------------------------------------------------------------------
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const isAuthWaiting =
      status?.backend_state === "NeedsLogin" && !!status?.auth_url;
    const interval = isAuthWaiting ? POLL_AUTH_MS : POLL_NORMAL_MS;

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchStatus(true), interval);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus, status?.backend_state, status?.auth_url]);

  // ---------------------------------------------------------------------------
  // POST helper
  // ---------------------------------------------------------------------------
  const postAction = useCallback(
    async (body: Record<string, unknown>): Promise<PostResponse> => {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      return resp.json();
    },
    [],
  );

  /**
   * One mutation: POST, refetch on success, return the outcome. `setBusy` is
   * the flag the caller owns for the duration of the call.
   */
  const runAction = useCallback(
    async (
      body: Record<string, unknown>,
      setBusy?: (busy: boolean) => void,
    ): Promise<TailscaleActionResult> => {
      setBusy?.(true);
      try {
        const json = await postAction(body);
        if (!json.success) {
          return {
            ok: false,
            reason: resolveErrorMessage(t, json.error, json.detail, ""),
          };
        }
        await fetchStatus(true);
        return OK;
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : "",
        };
      } finally {
        if (mountedRef.current) setBusy?.(false);
      }
    },
    [postAction, fetchStatus, t],
  );

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const connect = useCallback(
    () => runAction({ action: "connect" }, setIsConnecting),
    [runAction],
  );

  const disconnect = useCallback(
    () => runAction({ action: "disconnect" }, setIsDisconnecting),
    [runAction],
  );

  const logout = useCallback(
    () => runAction({ action: "logout" }, setIsDisconnecting),
    [runAction],
  );

  const startService = useCallback(
    () => runAction({ action: "start_service" }, setIsTogglingService),
    [runAction],
  );

  const stopService = useCallback(
    () => runAction({ action: "stop_service" }, setIsTogglingService),
    [runAction],
  );

  const setBootEnabled = useCallback(
    (enabled: boolean) =>
      runAction({ action: "set_boot_enabled", enabled }, setIsTogglingBoot),
    [runAction],
  );

  const setExitNodeAdvertised = useCallback(
    (enabled: boolean) =>
      runAction({ action: "set_exit_node", enabled }, setIsTogglingExitNode),
    [runAction],
  );

  const setSshEnabled = useCallback(
    (enabled: boolean) =>
      runAction({ action: "set_ssh", enabled }, setIsTogglingSsh),
    [runAction],
  );

  const uninstall = useCallback(
    () => runAction({ action: "uninstall" }, setIsUninstalling),
    [runAction],
  );

  // ---------------------------------------------------------------------------
  // Network fixes (reachability for tailnet devices)
  // ---------------------------------------------------------------------------
  const setNetFixes = useCallback(
    (enabled: boolean) =>
      runAction({ action: "set_net_fixes", enabled }, setIsTogglingNetFixes),
    [runAction],
  );

  // ---------------------------------------------------------------------------
  // Install and update (both background jobs reported through install_status)
  // ---------------------------------------------------------------------------
  const stopInstallPolling = useCallback(() => {
    if (installPollRef.current) {
      clearInterval(installPollRef.current);
      installPollRef.current = null;
    }
  }, []);

  /** Normalise one install_status read; a backend error code beats its prose. */
  const toInstallResult = useCallback(
    (r: InstallStatusResponse): TailscaleInstallResult => ({
      success: r.success,
      status: r.status ?? "idle",
      message:
        r.status === "error"
          ? resolveErrorMessage(t, r.error, r.detail, r.message ?? "")
          : r.message,
      detail: r.detail,
      log: r.log,
      op: r.op,
    }),
    [t],
  );

  const pollInstallStatus = useCallback(async () => {
    try {
      const json = (await postAction({
        action: "install_status",
      })) as InstallStatusResponse;
      if (!mountedRef.current) return;
      const r = toInstallResult(json);
      setInstallResult(r);
      if (r.status === "complete" || r.status === "error") {
        stopInstallPolling();
        await fetchStatus(true);
      }
    } catch {
      // Silently retry on next poll
    }
  }, [postAction, toInstallResult, stopInstallPolling, fetchStatus]);

  const runInstall = useCallback(
    async (source: TailscaleInstallSource = "official") => {
    stopInstallPolling();
    setInstallResult({ success: true, status: "running", op: "install" });
    try {
      const json = await postAction({ action: "install", source });
      if (!mountedRef.current) return;
      if (!json.success) {
        // Refused up front (another VPN, install already running, ...): no
        // background job exists to poll.
        setInstallResult({
          success: false,
          status: "error",
          message: resolveErrorMessage(t, json.error, json.detail, ""),
        });
        return;
      }
      installPollRef.current = setInterval(pollInstallStatus, INSTALL_POLL_MS);
    } catch (err) {
      if (mountedRef.current) {
        setInstallResult({
          success: false,
          status: "error",
          message: err instanceof Error ? err.message : "",
        });
      }
    }
    },
    [postAction, pollInstallStatus, stopInstallPolling, t],
  );

  /**
   * Ask for the newest version of the installed source. Merges the answer into `status`
   * instead of refetching, so the card does not flicker for a background read.
   */
  const checkUpdate = useCallback(
    async (force = false): Promise<TailscaleActionResult> => {
      try {
        const json = (await postAction({
          action: "check_update",
          ...(force ? { force: true } : {}),
        })) as CheckUpdateResponse;
        if (!json.success) {
          return {
            ok: false,
            reason: resolveErrorMessage(t, json.error, json.detail, ""),
          };
        }
        if (mountedRef.current) {
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  latest_version: json.latest_version ?? prev.latest_version,
                  update_available:
                    json.update_available ?? prev.update_available,
                }
              : prev,
          );
        }
        return OK;
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : "",
        };
      }
    },
    [postAction, t],
  );

  // One background check per visit, once an updatable (official or Tiny) build
  // is known to be installed. The CGI caches the answer, so this is cheap, and a failure
  // simply leaves the page without an update badge.
  const shouldCheckUpdate =
    !!status?.installed && !status.legacy_build && !status.busy;
  useEffect(() => {
    if (!shouldCheckUpdate || updateCheckedRef.current) return;
    updateCheckedRef.current = true;
    void checkUpdate();
  }, [shouldCheckUpdate, checkUpdate]);

  /**
   * Start the update and follow it to the end. The tunnel restarts partway
   * through, so a run of failed progress reads is expected and tolerated; only
   * a longer silence is reported as a failure. The loop deliberately outlives
   * the component so the toast still lands if the user navigates away.
   */
  const runUpdate = useCallback(async (): Promise<TailscaleActionResult> => {
    if (updatingRef.current) return { ok: false, reason: "" };
    updatingRef.current = true;
    setIsUpdating(true);
    setInstallResult({ success: true, status: "running", op: "update" });

    const fail = (reason: string): TailscaleActionResult => {
      if (mountedRef.current) {
        setInstallResult({
          success: false,
          status: "error",
          message: reason,
          op: "update",
        });
      }
      return { ok: false, reason };
    };

    try {
      const started = await postAction({ action: "update" });
      if (!started.success) {
        return fail(resolveErrorMessage(t, started.error, started.detail, ""));
      }

      const startedAt = Date.now();
      let failingSince: number | null = null;
      while (Date.now() - startedAt < UPDATE_MAX_MS) {
        await sleep(INSTALL_POLL_MS);
        try {
          const json = (await postAction({
            action: "install_status",
          })) as InstallStatusResponse;
          failingSince = null;
          const r = toInstallResult({ ...json, op: json.op ?? "update" });
          if (mountedRef.current) setInstallResult(r);
          if (r.status === "complete") {
            await fetchStatus(true);
            return OK;
          }
          if (r.status === "error") {
            await fetchStatus(true);
            return { ok: false, reason: r.message ?? "" };
          }
        } catch {
          failingSince ??= Date.now();
          if (Date.now() - failingSince > UPDATE_FAIL_TOLERANCE_MS) {
            return fail("");
          }
        }
      }
      return fail("");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "");
    } finally {
      updatingRef.current = false;
      if (mountedRef.current) setIsUpdating(false);
    }
  }, [postAction, toInstallResult, fetchStatus, t]);

  return {
    status,
    isLoading,
    isConnecting,
    isDisconnecting,
    isTogglingService,
    isTogglingBoot,
    isTogglingExitNode,
    isTogglingSsh,
    isUninstalling,
    isUpdating,
    isTogglingNetFixes,
    installResult,
    error,
    connect,
    disconnect,
    logout,
    startService,
    stopService,
    setBootEnabled,
    setExitNodeAdvertised,
    setSshEnabled,
    uninstall,
    setNetFixes,
    checkUpdate,
    runUpdate,
    runInstall,
    refresh: fetchStatus,
  };
}
