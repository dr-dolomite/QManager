"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { DEBUG_LEASE_MIN, useLogDebug } from "@/hooks/use-log-debug";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { cn } from "@/lib/utils";

// =============================================================================
// Logs: the "Debug logging" page action
// =============================================================================
// An operational action, not a draft setting, so it lives with the page's other
// header actions and commits on click (no CardFoot). Off: "Debug logging" turns
// detailed lines on for 30 minutes. On: the same pill becomes the brand-tonal
// "Stop debug logging" with the time left beside it, so the fact that the log
// is running verbose and the way out are one control. Hidden when the device
// cannot lease (an older backend reads as unavailable).
// =============================================================================

const ACTION_GLYPH = 18;

/** "29:41" — minutes and seconds left, two-digit seconds. */
function formatLeft(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function DebugLeaseAction() {
  const { t } = useTranslation("history");
  const debug = useLogDebug();

  if (!debug.available) return null;

  const toggle = async () => {
    const enable = !debug.active;
    const result = await debug.setEnabled(enable);
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
  };

  const left = formatLeft(debug.remainingSec);

  return (
    <Button
      type="button"
      variant={debug.active ? "tonal" : "tonal-neutral"}
      size="action"
      onClick={() => void toggle()}
      disabled={debug.isBusy}
      aria-label={
        debug.active ? t("logs.debug.stop_aria", { left }) : t("logs.debug.start_aria", { minutes: DEBUG_LEASE_MIN })
      }
    >
      <MaterialSymbol
        name={debug.isBusy ? "progress_activity" : debug.active ? "close" : "bug_report"}
        filled={debug.active && !debug.isBusy}
        size={ACTION_GLYPH}
        aria-hidden="true"
        className={cn(debug.isBusy && "motion-safe:animate-spin")}
      />
      {debug.active ? t("logs.debug.stop") : t("logs.debug.start", { minutes: DEBUG_LEASE_MIN })}
      {debug.active ? (
        <span className="font-medium tabular-nums">
          {left}
        </span>
      ) : null}
    </Button>
  );
}
