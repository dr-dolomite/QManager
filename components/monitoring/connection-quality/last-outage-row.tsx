"use client";

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { HintIcon } from "@/components/ui/hint-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CqLastOutage } from "@/types/cq-watchdog";

import { ROW, SKELETON_LOCAL } from "./shapes";

// The last cleared outage this boot. Both figures come from the modem's own
// clock (debounced link edges), so the length reads "About ...".

const K = "connection_quality.last_outage";

type Unit = "s" | "min" | "h" | "d";

/** Each unit, its size in seconds, and the unit its remainder is counted in. */
const UNITS: Record<Unit, { size: number; next: Unit | null; nextSize: number }> = {
  d: { size: 86400, next: "h", nextSize: 3600 },
  h: { size: 3600, next: "min", nextSize: 60 },
  min: { size: 60, next: "s", nextSize: 1 },
  s: { size: 1, next: null, nextSize: 1 },
};

function unitFor(totalSec: number): Unit {
  if (totalSec >= 86400) return "d";
  if (totalSec >= 3600) return "h";
  if (totalSec >= 60) return "min";
  return "s";
}

/** Coarsest two units: "42 s", "2 min 10 s", "1 h 5 min", "3 d 4 h". A zero tail is dropped. */
function formatSpan(totalSec: number, t: TFunction): string {
  const s = Math.max(0, Math.round(totalSec));
  const unit = unitFor(s);
  const { size, next, nextSize } = UNITS[unit];
  const first = t(`${K}.unit.${unit}`, { n: Math.floor(s / size) });
  if (!next) return first;
  const rest = Math.floor((s % size) / nextSize);
  return rest > 0 ? `${first} ${t(`${K}.unit.${next}`, { n: rest })}` : first;
}

/** The leading unit only: "5 min", "1 h", "2 d". */
function formatAgo(totalSec: number, t: TFunction): string {
  const s = Math.max(0, Math.round(totalSec));
  const unit = unitFor(s);
  return t(`${K}.unit.${unit}`, { n: Math.floor(s / UNITS[unit].size) });
}

export interface LastOutageRowProps {
  outage: CqLastOutage | null;
  /** `live.reachable`: false means the link is down right now. */
  reachable: boolean | null;
}

export function LastOutageRow({ outage, reachable }: LastOutageRowProps) {
  const { t } = useTranslation("monitoring");

  const down = reachable === false;

  let ended: string | null = null;
  if (outage && !down) {
    const base =
      outage.ended_ago_s < 60
        ? t(`${K}.ended_now`)
        : t(`${K}.ended`, { ago: formatAgo(outage.ended_ago_s, t) });
    ended =
      outage.wan_changed === null
        ? base
        : t(`${K}.ended_with_wan`, {
            ended: base,
            wan: t(outage.wan_changed ? `${K}.wan_changed` : `${K}.wan_same`),
          });
  }

  return (
    <div className={outage && !down ? ROW.ROOT_TALL : ROW.ROOT}>
      <span className={ROW.KEY}>
        {t(`${K}.label`)}
        <HintIcon label={t(`${K}.hint_label`)}>{t(`${K}.hint`)}</HintIcon>
      </span>
      {down ? (
        <span className={cn(ROW.VALUE, "text-destructive-on-surface")}>{t(`${K}.down_now`)}</span>
      ) : outage ? (
        <span className={ROW.VALUE_STACK}>
          <span className="whitespace-nowrap">
            {t(`${K}.about`, { value: formatSpan(outage.duration_s, t) })}
          </span>
          <span className={ROW.SECOND}>{ended}</span>
        </span>
      ) : (
        <span className={cn(ROW.VALUE, ROW.QUIET)}>{t(`${K}.none`)}</span>
      )}
    </div>
  );
}

export function LastOutageSkeleton() {
  return (
    <div className={ROW.ROOT} aria-hidden="true">
      <Skeleton className={cn(SKELETON_LOCAL.ROW_TEXT, "w-20")} />
      <Skeleton className={cn(SKELETON_LOCAL.ROW_TEXT, "w-28")} />
    </div>
  );
}
