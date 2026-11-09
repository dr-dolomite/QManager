"use client";

import { useTranslation } from "react-i18next";

import { formatDuration } from "@/components/history/format";
import { cn } from "@/lib/utils";
import type { ThermalPart } from "@/types/modem-status";
import type { SystemIncident } from "@/types/system-history";

// =============================================================================
// Tooltip rows shared by the stability lanes and the metric charts
// =============================================================================
// Both surfaces list the incidents near the pointer in the same words:
// "Modem crashed - Back in 38s", "Unexpected restart - Off 6m 12s",
// "Planned restart - Off 1m 35s", "Throttled (5G) - Peak 111 °C". A dot beside
// each row repeats the lane colour, so colour is never the only channel.
// =============================================================================

export type TipTone = "ok" | "bad" | "plan" | "warn" | "line" | "nodata";

const DOT: Record<TipTone, string> = {
  ok: "bg-success",
  bad: "bg-destructive",
  plan: "ring-1 ring-inset ring-on-surface-variant",
  warn: "bg-warning",
  line: "bg-primary-on-surface",
  nodata: "bg-surface-container-high ring-1 ring-inset ring-border",
};

export function TipRow({
  tone,
  label,
  value,
}: {
  tone: TipTone;
  label: string;
  value?: string;
}) {
  return (
    <li className="flex items-center gap-2 text-on-surface-variant">
      <span
        aria-hidden
        className={cn("size-2 flex-none rounded-pill", DOT[tone])}
      />
      {label}
      {value ? (
        <span className="ml-auto pl-3 font-semibold whitespace-nowrap text-popover-foreground tabular-nums">
          {value}
        </span>
      ) : null}
    </li>
  );
}

/** One row per incident, in the order given. */
export function IncidentRows({
  incidents,
}: {
  incidents: readonly SystemIncident[];
}) {
  const { t } = useTranslation("history");
  const { t: tDash } = useTranslation("dashboard");

  const partsLabel = (parts: ThermalPart[]) =>
    parts.map((p) => tDash(`thermal.parts.${p}`)).join(", ");

  return (
    <>
      {incidents.map((i) => {
        if (i.kind === "modem") {
          return (
            <TipRow
              key={`m-${i.start}`}
              tone="bad"
              label={t("system.charts.tip.modem_crashed")}
              value={
                i.end === null
                  ? t("system.charts.tip.restarting")
                  : t("system.charts.tip.back_in", {
                      duration: formatDuration(i.end - i.start, t),
                    })
              }
            />
          );
        }
        if (i.kind === "reboot") {
          const crash = i.cause === "unexpected";
          return (
            <TipRow
              key={`r-${i.start}-${i.end}`}
              tone={crash ? "bad" : "plan"}
              label={t(
                crash
                  ? "system.charts.tip.unexpected"
                  : "system.charts.tip.planned",
              )}
              value={
                i.offSec === null
                  ? undefined
                  : t("system.charts.tip.off_for", {
                      duration: formatDuration(i.offSec, t),
                    })
              }
            />
          );
        }
        return (
          <TipRow
            key={`h-${i.start}`}
            tone="warn"
            label={
              i.parts.length > 0
                ? t("system.charts.tip.throttled", {
                    parts: partsLabel(i.parts),
                  })
                : t("system.charts.tip.throttled_bare")
            }
            value={
              i.end === null
                ? t("system.charts.tip.throttling_now")
                : i.peakC === null
                  ? undefined
                  : t("system.charts.tip.peak", { temp: Math.round(i.peakC) })
            }
          />
        );
      })}
    </>
  );
}
