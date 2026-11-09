"use client";

import { useCallback, useEffect, useState } from "react";

const CHECK_ENDPOINT = "/cgi-bin/quecmanager/auth/check.sh";
const LOGIN_ENDPOINT = "/cgi-bin/quecmanager/auth/login.sh";
const LOGOUT_ENDPOINT = "/cgi-bin/quecmanager/auth/logout.sh";
const PASSWORD_ENDPOINT = "/cgi-bin/quecmanager/auth/password.sh";

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

export function isLoggedIn(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.includes("qm_logged_in=1");
}

function clearIndicatorCookie() {
  document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
}

// ---------------------------------------------------------------------------
// Hook for login page (setup detection + login/setup actions)
// ---------------------------------------------------------------------------

export type LoginStatus = "loading" | "ready" | "setup_required";

/**
 * Machine-readable failure codes from auth/login.sh. The UI branches on these
 * and supplies its own translated copy; `detail` is the backend's English
 * fallback, not something to render when a locale string exists.
 */
export type LoginError =
  | "invalid_password"
  | "rate_limited"
  | "setup_required"
  | "network"
  | (string & {});

export interface LoginResult {
  success: boolean;
  error?: LoginError;
  /** Backend's English detail. Diagnostic fallback only. */
  detail?: string;
  /** Seconds until the lockout lifts. Present when error is "rate_limited". */
  retry_after?: number;
  /**
   * Free attempts left before the lockout ladder engages. Present on both
   * "invalid_password" and "rate_limited".
   *
   * This reaches 0 while the form is still USABLE: once the ladder has
   * engaged, the backend's count stays at the maximum until a successful
   * login or an hour of quiet. Zero means "the next wrong password re-locks",
   * not "you cannot try", so callers must not render it as a count.
   */
  attempts_remaining?: number;
}

export interface LockoutState {
  active: boolean;
  retryAfter: number;
  attemptsRemaining: number;
}

/**
 * Mirrors MAX_ATTEMPTS in scripts/usr/lib/qmanager/cgi_auth.sh. Only an
 * optimistic value before check.sh answers; every number the UI shows comes
 * from the backend.
 */
const DEFAULT_MAX_ATTEMPTS = 5;

const NO_LOCKOUT: LockoutState = {
  active: false,
  retryAfter: 0,
  attemptsRemaining: DEFAULT_MAX_ATTEMPTS,
};

function toCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : undefined;
}

export function useLogin() {
  const [status, setStatus] = useState<LoginStatus>("loading");
  const [lockout, setLockout] = useState<LockoutState>(NO_LOCKOUT);

  useEffect(() => {
    // If already logged in, redirect to dashboard
    if (isLoggedIn()) {
      window.location.href = "/dashboard/";
      return;
    }

    // Setup detection plus the live lockout state. `no-store` matters: a
    // cached copy would show an enabled button during a lockout the server is
    // still enforcing. Seeding from check.sh is what makes a lockout survive a
    // page reload.
    fetch(CHECK_ENDPOINT, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setStatus(data.setup_required ? "setup_required" : "ready");
        if (data.rate_limited === true) {
          setLockout({
            active: true,
            retryAfter: toCount(data.retry_after) ?? 0,
            attemptsRemaining: 0,
          });
        } else {
          setLockout({
            active: false,
            retryAfter: 0,
            attemptsRemaining:
              toCount(data.attempts_remaining) ?? DEFAULT_MAX_ATTEMPTS,
          });
        }
      })
      .catch(() => setStatus("ready"));
  }, []);

  const login = useCallback(
    async (password: string): Promise<LoginResult> => {
      try {
        const resp = await fetch(LOGIN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = await resp.json();

        if (data.success) {
          // Cookie is set by the backend — just redirect
          window.location.href = "/dashboard/";
          return { success: true };
        }

        if (data.error === "setup_required") {
          setStatus("setup_required");
          return { success: false, error: "setup_required" };
        }

        const attemptsRemaining = toCount(data.attempts_remaining);

        // Branch on the code, never on the truthiness of `retry_after`: a
        // lockout with under a second left reports `retry_after: 0`.
        if (data.error === "rate_limited") {
          const retryAfter = toCount(data.retry_after) ?? 0;
          setLockout({ active: true, retryAfter, attemptsRemaining: 0 });
          return {
            success: false,
            error: "rate_limited",
            detail: data.detail,
            retry_after: retryAfter,
            attempts_remaining: 0,
          };
        }

        if (attemptsRemaining !== undefined) {
          setLockout((prev) => ({ ...prev, attemptsRemaining }));
        }

        // The code stays in `error` and `detail` travels separately. Folding
        // detail into error used to hand English text to resolveErrorMessage,
        // so every locale showed the English failure.
        return {
          success: false,
          error: data.error || "invalid_password",
          detail: data.detail,
          attempts_remaining: attemptsRemaining,
        };
      } catch {
        return { success: false, error: "network", detail: "Connection failed" };
      }
    },
    []
  );

  const setup = useCallback(
    async (
      password: string,
      confirm: string,
      enforceStrong: boolean = true
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const resp = await fetch(LOGIN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, confirm, enforce_strong: enforceStrong }),
        });
        const data = await resp.json();

        if (data.success) {
          window.location.href = "/dashboard/";
          return { success: true };
        }

        return {
          success: false,
          error: data.detail || data.error || "Setup failed",
        };
      } catch {
        return { success: false, error: "Connection failed" };
      }
    },
    []
  );

  return { status, login, setup, lockout };
}

// ---------------------------------------------------------------------------
// Standalone setup (used by onboarding wizard — does NOT redirect on success)
// ---------------------------------------------------------------------------

/**
 * Creates the initial password and session without redirecting.
 * Used by the onboarding wizard so it can advance steps instead of
 * immediately sending the user to the dashboard.
 */
export async function setupPassword(
  password: string,
  confirm: string,
  enforceStrong: boolean = true
): Promise<{ success: boolean; error?: string; sshSynced?: boolean }> {
  try {
    const resp = await fetch(LOGIN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, confirm, enforce_strong: enforceStrong }),
    });
    const data = await resp.json();

    if (data.success) {
      // `ssh_synced` is false when the device could not also set the SSH
      // password; an older backend omits it, which reads as synced.
      return { success: true, sshSynced: data.ssh_synced !== false };
    }

    return {
      success: false,
      error: data.detail || data.error || "Setup failed",
    };
  } catch {
    return { success: false, error: "Connection failed" };
  }
}

// ---------------------------------------------------------------------------
// Actions (used by sidebar menu / change password dialog)
// ---------------------------------------------------------------------------

export async function logout(): Promise<void> {
  try {
    await fetch(LOGOUT_ENDPOINT, { method: "POST" });
  } catch {
    // Ignore network errors on logout
  } finally {
    clearIndicatorCookie();
    // Land on the public Overview splash ("/"), not the bare login form. The
    // indicator cookie is cleared above, so "/" renders OverviewCard directly.
    window.location.href = "/";
  }
}

/**
 * Check the current web password without changing it (`verify_only`). The
 * session and the password are untouched. A wrong password counts toward the
 * same lockout as sign-in, so a locked-out caller gets `rate_limited` back.
 */
export async function verifyPassword(
  current: string
): Promise<{ success: boolean; error?: string; detail?: string }> {
  try {
    const resp = await fetch(PASSWORD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: current, verify_only: true }),
    });
    const data = await resp.json();
    if (data.success) return { success: true };
    return { success: false, error: data.error, detail: data.detail };
  } catch {
    return { success: false };
  }
}

export async function changePassword(
  current: string,
  newPassword: string,
  enforceStrong: boolean = true
): Promise<{ success: boolean; error?: string; detail?: string }> {
  try {
    const resp = await fetch(PASSWORD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: current,
        new_password: newPassword,
        enforce_strong: enforceStrong,
      }),
    });
    const data = await resp.json();

    if (data.success) {
      clearIndicatorCookie();
      window.location.href = "/login/";
      return { success: true };
    }

    // `error` is the backend code (errors.json), `detail` its English text;
    // the caller resolves the pair through resolveErrorMessage.
    return { success: false, error: data.error, detail: data.detail };
  } catch {
    return { success: false };
  }
}
