"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { DEBUG_LEASE_MIN, type UseLogDebugReturn } from "@/hooks/use-log-debug";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { cn } from "@/lib/utils";

import { LOGS } from "./shapes";

// =============================================================================
// Logs: the "Debug logging" page action, and the chip that says it is on
// =============================================================================
// An operational action, not a draft setting, so it lives with the page's other
// header actions and commits on click (no CardFoot). Off: "Debug logging (30
// min)" turns detailed lines on. On: the action becomes a plain "Stop debug
// logging", and the fact that the log is running verbose is a Fact-Is-Info chip
// with the time left, in the QManager tab's toolbar (the lease only changes
// QManager's log). Only the chip carries a fill, so the action and the fact are
// not two loud controls. Hidden when the device cannot lease (an older backend
// reads as unavailable).
//
// The page owns the lease (`useLogDebug`) so its state survives a tab switch;
// both the action and the DEBUG filter's empty state turn it on through
// `useDebugLeaseToggle`, so they share one set of toasts.
// =============================================================================

/** "29:41" — minutes and seconds left, two-digit seconds. */
function formatLeft(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Turn the lease on or off, confirming the outcome with one toast. */
export function useDebugLeaseToggle(debug: UseLogDebugReturn) {
  const { t } = useTranslation("history");
  const { setEnabled } = debug;
  return useCallback(
    async (enable: boolean) => {
      const result = await setEnabled(enable);
      if (result.ok) {
        toast.success(
          t(enable ? "logs.debug.toast.enabled" : "logs.debug.toast.disabled", {
            minutes: DEBUG_LEASE_MIN,
          }),
        );
        return;
      }
      toast.error(
        resolveErrorMessage(
          t,
          result.error,
          result.detail,
          t(enable ? "logs.debug.toast.enable_failed" : "logs.debug.toast.disable_failed"),
        ),
      );
    },
    [setEnabled, t],
  );
}

export function DebugLeaseAction({
  debug,
  onToggle,
}: {
  debug: UseLogDebugReturn;
  onToggle: (enable: boolean) => Promise<void>;
}) {
  const { t } = useTranslation("history");

  if (!debug.available) return null;

  return (
    <Button
      type="button"
      variant="tonal-neutral"
      size="action"
      onClick={() => void onToggle(!debug.active)}
      disabled={debug.isBusy}
      aria-label={
        debug.active
          ? t("logs.debug.stop_aria", { left: formatLeft(debug.remainingSec) })
          : t("logs.debug.start_aria", { minutes: DEBUG_LEASE_MIN })
      }
    >
      <MaterialSymbol
        name={debug.isBusy ? "progress_activity" : debug.active ? "close" : "bug_report"}
        size={LOGS.ACTION_GLYPH}
        aria-hidden="true"
        className={cn(debug.isBusy && "motion-safe:animate-spin")}
      />
      {debug.active ? t("logs.debug.stop") : t("logs.debug.start", { minutes: DEBUG_LEASE_MIN })}
    </Button>
  );
}

/** "Debug logging on (29:41)", only while the lease runs. */
export function DebugLeaseBadge({ debug }: { debug: UseLogDebugReturn }) {
  const { t } = useTranslation("history");
  if (!debug.active) return null;
  return (
    <Badge variant="info" className="tabular-nums">
      <MaterialSymbol name="bug_report" filled size={12} aria-hidden="true" />
      {t("logs.debug.badge", { left: formatLeft(debug.remainingSec) })}
    </Badge>
  );
}
