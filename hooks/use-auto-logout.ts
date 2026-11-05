"use client";

import { useEffect, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { isRebooting } from "@/lib/reboot";
import { startVisibleInterval } from "@/lib/visible-interval";
import {
  evaluateConnection,
  reportConnectionState,
  INITIAL_CONNECTION_STATE,
  type ConnectionState,
} from "@/lib/reboot/connection";

const CHECK_ENDPOINT = "/cgi-bin/quecmanager/auth/check.sh";

/**
 * How often to ping check.sh while the dashboard is open (ms).
 * Kept short so the offline backstop (FAILURE_THRESHOLD consecutive misses)
 * fires within ~10s while still requiring several failures to filter out a
 * single transient blip. check.sh is cheap (cookie check, no modem contact).
 */
const POLL_INTERVAL_MS = 3_000;

function clearSessionCookie() {
  document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
}

/**
 * Polls auth/check.sh every POLL_INTERVAL_MS while the dashboard is mounted
 * and the tab is visible. A hidden tab does not poll; on becoming visible it
 * checks at once with the failure counter reset, so time spent hidden (or a
 * slow network wake-up) never counts toward the offline redirect.
 *
 * check.sh skips auth and always answers HTTP 200 with {authenticated:bool},
 * so this poller must inspect BOTH the transport and the body:
 *
 * - Transport failure (network error OR non-2xx) → counts toward the offline
 *     threshold:
 *     - at WARN_AT fails  → shows the "reconnecting" banner
 *     - at FAILURE_THRESHOLD fails → redirect:
 *         * if a reboot we initiated is in flight → /reboot/ countdown
 *         * otherwise (unexplained silence)       → /login/?reason=offline
 * - Reachable but {authenticated:false} → session is gone (e.g. a reboot wiped
 *     /tmp sessions, or it simply expired) → redirect to /login/ immediately.
 *     This is the normal recovery path once the device returns.
 * - Reachable and authenticated         → resets the counter and hides banner.
 *
 * Note: a bare `await authFetch()` is NOT enough — fetch only rejects on a true
 * network error, so a 5xx (or a dev-proxy 502 while the modem is down) would
 * otherwise be miscounted as a success and defeat the whole poller.
 */
export function useAutoLogout() {
  const stateRef = useRef<ConnectionState>(INITIAL_CONNECTION_STATE);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      let reachable = false;
      // Assume authenticated unless the body explicitly says otherwise, so a
      // parse hiccup on an otherwise-OK response never force-logs-out the user.
      let authenticated = true;
      let setupRequired = false;
      try {
        // authFetch handles 401 → redirect internally (check.sh won't 401, but
        // other call sites share the wrapper). response.ok must be checked: a
        // resolved 5xx is still a failed poll.
        const res = await authFetch(CHECK_ENDPOINT);
        reachable = res.ok;
        if (res.ok) {
          try {
            const json = await res.json();
            authenticated = json?.authenticated !== false;
            setupRequired = json?.setup_required === true;
          } catch {
            /* OK status, unreadable body — treat as reachable, auth unknown */
          }
        }
      } catch {
        reachable = false;
      }
      if (cancelled) return;

      // Device is up but our session is gone — recover straight to login rather
      // than waiting for some other endpoint's 401. Skip during setup mode
      // (no session is expected) to avoid a redirect loop.
      if (reachable && !authenticated && !setupRequired) {
        clearSessionCookie();
        window.location.href = "/login/?reason=offline";
        return;
      }

      const { state, showBanner, action } = evaluateConnection(
        stateRef.current,
        reachable
      );
      stateRef.current = state;
      reportConnectionState(showBanner);

      if (action === "redirect") {
        if (isRebooting()) {
          window.location.href = "/reboot/";
        } else {
          clearSessionCookie();
          window.location.href = "/login/?reason=offline";
        }
      }
    };

    const stop = startVisibleInterval(
      () => {
        if (!cancelled) void tick();
      },
      POLL_INTERVAL_MS,
      {
        // The first check still waits one interval, as before.
        immediate: false,
        onResume: () => {
          stateRef.current = INITIAL_CONNECTION_STATE;
          reportConnectionState(false);
        },
      },
    );

    return () => {
      cancelled = true;
      stop();
    };
  }, []);
}
