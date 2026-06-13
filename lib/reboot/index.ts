// lib/reboot/index.ts
//
// Single source of truth for modem reboot intent.
//
// Two flavors of reboot:
//   - rebootNow(source)        immediate: fire reboot.sh, then enter the flow
//   - requestRebootLater(src)  deferred:  persist a banner flag for later
//
// enterRebootFlow() is the shared UX tail (mark in-flight → clear cookie →
// navigate to the /reboot/ countdown). Callers that fire their OWN reboot
// request (imei.sh / mbn.sh) or need reboot.sh's response (config restore)
// call enterRebootFlow directly instead of rebootNow.

export type RebootSource =
  | "config_restore"
  | "verizon_revert"
  | "imei"
  | "tailscale"
  | "netbird"
  | "mbn"
  | "manual"
  | "software_update"
  | "ipa_offload";

const REBOOT_CGI = "/cgi-bin/quecmanager/system/reboot.sh";

/** sessionStorage key the /reboot/ countdown page reads-and-clears on mount. */
export const REBOOT_SESSION_KEY = "qm_rebooting";

/**
 * Delay before navigating away, giving the fire-and-forget reboot POST time to
 * reach the device before the page unloads (navigation cancels in-flight fetch).
 */
export const REBOOT_NAV_DELAY_MS = 2000;

/** True if a reboot we initiated is in flight (countdown not yet consumed). */
export function isRebooting(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(REBOOT_SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Shared UX tail. Marks the in-flight flag (storing the originating source so
 * it survives the navigation for debugging/telemetry), clears the logged-in
 * cookie, then navigates to the /reboot/ countdown after REBOOT_NAV_DELAY_MS.
 * Does NOT fire any reboot request — the caller is responsible for that.
 */
export function enterRebootFlow(source: RebootSource): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    try {
      window.sessionStorage.setItem(REBOOT_SESSION_KEY, source);
    } catch {
      /* sessionStorage unavailable — countdown guard will bounce home, acceptable */
    }
    document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
    window.location.href = "/reboot/";
  }, REBOOT_NAV_DELAY_MS);
}

/**
 * Immediate reboot for the simple call sites: fire-and-forget POST to reboot.sh,
 * then enter the countdown flow. Errors are swallowed — a reboot may have started
 * even if the response was cut off, so we always proceed to the countdown.
 */
export function rebootNow(source: RebootSource): void {
  if (typeof window === "undefined") return;
  void fetch(REBOOT_CGI, { method: "POST" }).catch(() => {});
  enterRebootFlow(source);
}

/** Deferred reboot: persist the banner flag for the user to action later. */
export { setPendingReboot as requestRebootLater } from "./pending";

// Re-export the rest of the pending API so consumers have one import path.
export {
  readPendingReboot,
  clearPendingReboot,
  usePendingReboot,
  type PendingReboot,
} from "./pending";
