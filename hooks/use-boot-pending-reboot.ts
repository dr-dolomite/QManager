"use client";

import { useEffect, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { setPendingReboot } from "@/lib/config-backup/pending-reboot";

const ENDPOINT = "/cgi-bin/quecmanager/system/pending_reboot.sh";

interface PendingRebootResponse {
  verizon: boolean;
}

/**
 * Polls the backend once on app load for any boot-emitted pending-reboot flags.
 * The CGI clears its own flags on read (clear-on-read), so this is a
 * fire-once effect per boot cycle.
 *
 * Call this hook inside a top-level authenticated client component so it runs
 * once the user session is established. The ref guard prevents re-fire on
 * subsequent navigations or React Strict Mode double-invoke.
 */
export function useBootPendingReboot(): void {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    let cancelled = false;
    (async () => {
      try {
        const resp = await authFetch(ENDPOINT);
        if (!resp.ok || cancelled) return;
        const data = (await resp.json()) as PendingRebootResponse;
        if (data.verizon) {
          setPendingReboot("verizon_revert");
        }
      } catch {
        // Network or auth failure — silently ignore, banner is best-effort
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
