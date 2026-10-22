"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RefreshCcwIcon } from "lucide-react";

import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import LanConfigCard from "@/components/local-network/lan-config-card";

import { LinkStateStrip } from "./link-state-strip";
import { EthernetPortCard } from "./ethernet-port-card";
import { CARD_GRID, PAGE_ROOT } from "./shapes";
import type { EthernetPortChange, EthernetStatus } from "./types";

// =============================================================================
// Ethernet Status — page shell (ledger U4.12, ported from the RM520N fork)
// =============================================================================
// Owns the data: the GET, the 10 s poll and the port apply (speed limit with
// its confirm-poll, PCIe ASPM policy settled on the response). Renders a header
// with a Refresh pill, the link strip, then the Ethernet Port card beside the
// LAN Config card.
//
// A failed refresh is reported: `pollFailed` is set on every failure and
// cleared on every success (the old card swallowed every error once it had
// data, so a dead poll looked healthy forever). With a held reading the strip
// shows "Not responding"; with none it shows one spanning notice.
//
// `{success: false, error: "interface_not_found"}` is not a failed read: the
// target's GET says that when there is no eth0, and the shell maps it to
// `interface_present: false` (the fork's GET sends the field directly).
//
// The poll stands down while an apply is in flight (`savingRef`): the apply
// drops the link on purpose, and the confirm-poll is what watches it return.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/ethernet.sh";
const K = "ethernet";

/** Fallback when the POST omits `disconnect_window_seconds` (the target sends 5). */
const DEFAULT_WINDOW_SEC = 5;
const MAX_POLLS = 6;
const POLL_INTERVAL_MS = 1500;

const ABSENT_STATUS: EthernetStatus = {
  link_status: "down",
  speed: "Unknown",
  duplex: "Unknown",
  auto_negotiation: "Unknown",
  speed_limit: "",
  supports_2500: false,
  interface_present: false,
  aspm_supported: false,
  aspm_policy: "",
  aspm_configured: "",
};

/** Picks the GET's fields (drops `success` and anything the UI does not read). */
function toStatus(data: EthernetStatus): EthernetStatus {
  return {
    link_status: data.link_status,
    speed: data.speed,
    duplex: data.duplex,
    auto_negotiation: data.auto_negotiation,
    speed_limit: data.speed_limit,
    supports_2500: data.supports_2500,
    interface_present: data.interface_present,
    aspm_supported: data.aspm_supported === true,
    aspm_policy: data.aspm_policy ?? "",
    aspm_configured: data.aspm_configured ?? "",
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const EthernetStatusComponent = () => {
  const { t } = useTranslation("local-network");

  const [status, setStatus] = useState<EthernetStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);

  const mountedRef = useRef(true);
  // Read by the interval, which closes over its first render.
  const savingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchStatus = useCallback(async (silent = false) => {
    if (silent && savingRef.current) return;
    if (!silent) setIsLoading(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        if (data.error === "interface_not_found") {
          setPollFailed(false);
          setStatus(ABSENT_STATUS);
          return;
        }
        throw new Error("unsuccessful response");
      }

      setPollFailed(false);
      setStatus(toStatus(data));
    } catch {
      if (mountedRef.current) setPollFailed(true);
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => fetchStatus(true), 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Polls until the link is back up at the requested limit. Runs while
  // `savingRef` is still set, so the exhausted re-sync goes non-silent.
  const confirmSpeedChange = async (
    requested: string,
    windowSec: number,
  ): Promise<boolean> => {
    await sleep(windowSec * 1000);

    for (let i = 0; i < MAX_POLLS; i++) {
      if (!mountedRef.current) return false;
      try {
        const pollResp = await authFetch(CGI_ENDPOINT);
        if (pollResp.ok) {
          const pollData = await pollResp.json();
          if (!mountedRef.current) return false;
          if (
            pollData.success === true &&
            pollData.speed_limit === requested &&
            pollData.link_status === "up" &&
            pollData.speed &&
            pollData.speed !== "Unknown"
          ) {
            setStatus(toStatus(pollData));
            setPollFailed(false);
            return true;
          }
        }
      } catch {
        // The PHY may still be renegotiating; retry.
      }
      if (i < MAX_POLLS - 1) await sleep(POLL_INTERVAL_MS);
    }

    if (mountedRef.current) await fetchStatus();
    return false;
  };

  // One POST carries whichever fields changed. The ASPM write is synchronous
  // and read back by the CGI, so an ASPM-only apply settles on its response;
  // a speed change bounces the link and is confirmed by polling.
  const handleApply = async (change: EthernetPortChange): Promise<boolean> => {
    const speed = change.speed_limit;
    setIsSaving(true);
    savingRef.current = true;

    try {
      let windowSec = DEFAULT_WINDOW_SEC;
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(change),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!mountedRef.current) return false;

        if (!data.success) {
          toast.error(
            resolveErrorMessage(
              t,
              data.error,
              data.detail,
              t(`${K}.settings.toast_error`),
            ),
          );
          return false;
        }
        if (typeof data.aspm_policy === "string") {
          const active: string = data.aspm_policy;
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  aspm_policy: active,
                  aspm_configured: change.aspm_policy ?? prev.aspm_configured,
                }
              : prev,
          );
        }
        if (speed === undefined) {
          toast.success(t(`${K}.settings.toast_aspm_success`));
          return true;
        }
        if (typeof data.disconnect_window_seconds === "number") {
          windowSec = data.disconnect_window_seconds;
        }
      } catch {
        if (!mountedRef.current) return false;
        // Without a speed change nothing bounced the link: this is a real failure.
        if (speed === undefined) {
          toast.error(t(`${K}.settings.toast_error`));
          return false;
        }
        // A network error mid-POST usually means the PHY bounced under the
        // request. Confirm against the link instead of reporting a false failure.
      }

      const confirmed = await confirmSpeedChange(speed, windowSec);
      if (!mountedRef.current) return confirmed;
      // An exhausted poll is not a save: the link never came back at the speed.
      if (confirmed) {
        toast.success(t(`${K}.settings.toast_success`));
      } else {
        toast.error(t(`${K}.settings.toast_confirm_error`));
      }
      return confirmed;
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  };

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className="flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end">
          <div className="flex max-w-[41rem] flex-col gap-1.5">
            <h1 className="text-3xl font-bold tracking-[-0.02em]">
              {t(`${K}.page.title`)}
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed text-pretty">
              {t(`${K}.page.description`)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto">
            <Button
              type="button"
              variant="tonal-neutral"
              size="action"
              onClick={() => fetchStatus()}
              disabled={isSaving || isLoading}
            >
              <RefreshCcwIcon className="size-4" aria-hidden="true" />
              {t(`${K}.page.refresh`)}
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem} aria-live="polite" aria-atomic="false">
        <LinkStateStrip
          status={status}
          isLoading={isLoading}
          pollFailed={pollFailed}
        />
      </motion.div>

      <motion.div variants={staggerItem} className={CARD_GRID}>
        <EthernetPortCard
          speedLimit={status?.speed_limit ?? ""}
          supports2500={status?.supports_2500 ?? false}
          aspmPolicy={status?.aspm_policy ?? ""}
          aspmSupported={status?.aspm_supported ?? false}
          isSaving={isSaving}
          hasStatus={status !== null}
          pollFailed={pollFailed}
          interfacePresent={status?.interface_present !== false}
          onApply={handleApply}
        />
        <LanConfigCard />
      </motion.div>
    </motion.div>
  );
};

export default EthernetStatusComponent;
