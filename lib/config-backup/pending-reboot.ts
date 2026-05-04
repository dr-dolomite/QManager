// lib/config-backup/pending-reboot.ts
//
// Local-storage helper for tracking whether the user has a pending modem
// reboot queued by a config restore. The reboot itself is user-initiated
// (we cannot reboot the modem from the modem without killing our own UI),
// so this key persists across navigation/reload until the user dismisses
// or reboots.

const STORAGE_KEY = "qmanager_pending_reboot";

export interface PendingReboot {
  since: number;
  source: "config_restore" | "verizon_revert";
}

export function readPendingReboot(): PendingReboot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingReboot;
    if (typeof parsed?.since !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setPendingReboot(source: PendingReboot["source"] = "config_restore"): void {
  if (typeof window === "undefined") return;
  const value: PendingReboot = { since: Date.now(), source };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    // Notify same-tab listeners — the storage event only fires cross-tab
    window.dispatchEvent(new Event("qmanager:pending-reboot-changed"));
  } catch {
    /* localStorage unavailable — silently degrade */
  }
}

export function clearPendingReboot(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event("qmanager:pending-reboot-changed"));
  } catch {
    /* noop */
  }
}

// React-style subscription hook for the pending-reboot flag
import { useEffect, useState } from "react";

export function usePendingReboot(): PendingReboot | null {
  const [state, setState] = useState<PendingReboot | null>(null);

  useEffect(() => {
    setState(readPendingReboot());

    const sync = () => setState(readPendingReboot());
    window.addEventListener("storage", sync); // cross-tab updates
    window.addEventListener("qmanager:pending-reboot-changed", sync); // same-tab updates
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("qmanager:pending-reboot-changed", sync);
    };
  }, []);

  return state;
}
