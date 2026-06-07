"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLinkIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";

import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EASE_OUT_EXPO, DUR } from "@/lib/motion";

// =============================================================================
// LanReconnecting — post-apply reconnect probe for the LAN address editor
// =============================================================================
// Shown after a successful LAN IP change. The apply is self-severing: the device
// rebinds br-lan (and, on a real change, bounces the carrier), so the old origin
// dies and the new address only becomes reachable once the upstream router has
// re-run DHCP.
//
// Strategy (bounded; grace + ceiling derived from the apply kind — see below):
//   • grace window — the device is definitely down/rebinding, don't probe yet.
//   • probe window — poll the new address once per second.
//   • success → navigate to http://<new-ip>/ immediately.
//   • still failing at the ceiling → fall back to the manual banner.
//
// The redirect is EVENT-DRIVEN: we navigate the instant the device answers, not
// on a fixed timer. The ceiling is only when we give up and show the link.
//
// Timing is anchored to the backend's measured apply sequence (lan_config.sh):
// network reload at +1s, then on a real change the carrier bounce takes members
// down at +4s and back up at +8s (the deterministic "modem floor"), after which
// a cable-sense upstream router re-runs DHCP — so the new gateway is typically
// reachable from the browser at ~+11–18s. We therefore start probing at +8s and
// let the ceiling ride the backend's own `disconnect_window_seconds` (30s on a
// real change). A no-op apply (same IP, no bounce) only blips for the reload, so
// it gets a much shorter grace + ceiling.
//
// Why a no-cors probe works across origins: the new IP is a DIFFERENT origin, so
// a normal fetch couldn't READ its response (CORS) — but we only need to know
// whether the device ANSWERS. `fetch(url, { mode: "no-cors" })` resolves on any
// HTTP response (opaque) and rejects on a connection failure, which is exactly
// the reachability signal we want. Each probe is AbortController-bounded so an
// unreachable host doesn't hang the poll. The final navigation is a top-level
// window.location change, which is not subject to CORS at all.
// =============================================================================

const POLL_INTERVAL_MS = 1000;
const PROBE_TIMEOUT_MS = 1500; // per-probe abort so an unreachable host can't hang
const OPEN_GRACE_MS = 600; // tiny settle before navigating after a hit

// Compact progress ring (card-sized; mirrors the reboot countdown's language).
const RING_SIZE = 104;
const RING_RADIUS = 46;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_STROKE = 5;

type Phase = "connecting" | "opening" | "manual";

interface LanReconnectingProps {
  /** Address the device will be reachable at after the reload, e.g. "192.168.2.1" */
  newIpaddr: string;
  /** CIDR prefix that was applied */
  prefix: number;
  /** Backend estimate of the unreachable window — used only for the manual-banner copy */
  windowSeconds: number;
  /** True when the backend bounced the carrier (DHCP clients reconnect on their own) */
  carrierBounce: boolean;
}

export function LanReconnecting({
  newIpaddr,
  prefix,
  windowSeconds,
  carrierBounce,
}: LanReconnectingProps) {
  const { t } = useTranslation("local-network");

  // A real change bounces the carrier (modem floor +8s, gateway ~+11–18s), so we
  // grace 8s and ride the backend's 30s window. A no-op only blips for the
  // network reload, so it gets a short grace + ceiling.
  const grace = carrierBounce ? 8 : 2;
  const ceiling = carrierBounce
    ? Math.max(windowSeconds, 24)
    : Math.max(windowSeconds, 8);

  const [remaining, setRemaining] = useState(ceiling);
  const [phase, setPhase] = useState<Phase>("connecting");

  const remainingRef = useRef(ceiling);
  const pollingRef = useRef(false);
  const navigatedRef = useRef(false);

  const url = `http://${newIpaddr}`;
  const address = `${newIpaddr}/${prefix}`;

  // Single guarded navigation (survives StrictMode's double-invoke).
  const goToNewAddress = () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    window.location.href = url;
  };

  // One reachability probe. Resolves true if the device answered at all.
  const probe = async (): Promise<boolean> => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      await fetch(`${url}/?_qm=${Date.now()}`, {
        mode: "no-cors",
        cache: "no-store",
        redirect: "manual",
        signal: ctrl.signal,
      });
      return true;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  };

  // Keep the ref in sync so the poll interval reads the latest value.
  useEffect(() => {
    remainingRef.current = remaining;
  }, [remaining]);

  // Countdown (display only) — pure decrement in a timer callback.
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining((prev) => (prev <= 0 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Ceiling — flip to the manual banner if nothing answered in time.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!navigatedRef.current) setPhase("manual");
    }, ceiling * 1000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ceiling derives from props that don't change; run once
  }, []);

  // Poll the new address through the grace→ceiling window; navigate on first hit.
  useEffect(() => {
    const id = setInterval(async () => {
      const r = remainingRef.current;
      if (r > ceiling - grace) return; // still in the grace period
      if (r <= 0) {
        clearInterval(id);
        return;
      }
      if (pollingRef.current || navigatedRef.current) return;
      pollingRef.current = true;
      const reachable = await probe();
      if (reachable && !navigatedRef.current) {
        clearInterval(id);
        setPhase("opening");
        window.setTimeout(goToNewAddress, OPEN_GRACE_MS);
        return;
      }
      pollingRef.current = false;
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- url/probe/grace/ceiling derive from props that don't change; run once
  }, []);

  // Determinate ring: fills as the grace→ceiling window elapses. The redirect is
  // event-driven (probe success), so the centre shows a spinner, not a number.
  const progress = Math.min(1, (ceiling - remaining) / ceiling);
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

  const addressLink = (
    <a
      href={url}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4 tabular-nums"
    >
      <ExternalLinkIcon className="size-3.5" />
      {url}
    </a>
  );

  return (
    <motion.div
      key="reconnecting"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: DUR.base, ease: EASE_OUT_EXPO }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {phase === "manual" ? (
          // --- Fallback: device didn't answer in time — point the user manually ---
          <motion.div
            key="manual"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.fast, ease: EASE_OUT_EXPO }}
          >
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertTitle>{t("lan_config.applied_title")}</AlertTitle>
              <AlertDescription>
                <p>
                  {t(
                    carrierBounce
                      ? "lan_config.applied_body_auto"
                      : "lan_config.applied_body",
                    { address, seconds: windowSeconds },
                  )}
                </p>
                {addressLink}
              </AlertDescription>
            </Alert>
          </motion.div>
        ) : (
          // --- Active: progress ring while we grace + probe the new address -----
          <motion.div
            key="connecting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.fast, ease: EASE_OUT_EXPO }}
            className="flex flex-col items-center gap-5 py-2 text-center"
          >
            <div
              role="status"
              aria-label={
                phase === "opening"
                  ? t("lan_config.reconnecting_opening")
                  : t("lan_config.reconnecting_title")
              }
              className="relative"
              style={{ width: RING_SIZE, height: RING_SIZE }}
            >
              <svg
                width={RING_SIZE}
                height={RING_SIZE}
                viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                className="-rotate-90"
                aria-hidden="true"
              >
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  className="stroke-muted/20"
                  strokeWidth={RING_STROKE}
                />
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  className="stroke-primary"
                  strokeWidth={RING_STROKE}
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={phase === "opening" ? 0 : dashOffset}
                  strokeLinecap="round"
                  style={{
                    transition: "stroke-dashoffset 1s linear",
                    filter:
                      "drop-shadow(0 0 6px color-mix(in oklch, var(--primary) 30%, transparent))",
                  }}
                />
              </svg>

              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner className="size-6" />
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-[15px] font-medium text-foreground">
                {phase === "opening"
                  ? t("lan_config.reconnecting_opening")
                  : t("lan_config.reconnecting_title")}
              </p>
              <p className="mx-auto max-w-prose text-[13px] text-muted-foreground">
                {t("lan_config.reconnecting_auto_note")}
              </p>
            </div>

            {addressLink}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
