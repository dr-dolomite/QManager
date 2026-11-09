"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import { formatDuration, formatSince, formatWhen } from "@/components/history/format";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { SystemHistory, SystemIncident } from "@/types/system-history";

import {
  cpuSummary,
  latestMetric,
  type LiveStatus,
} from "./derive";
import { SUMMARY_SHAPE } from "./shapes";

// =============================================================================
// Summary strip: four glance tiles
// =============================================================================
// Up for / Modem restarts / Processor / Memory, in the shared `TILE_SHAPE`
// geometry. The body is neutral and the disc is the only coloured element (The
// Data-Ink Rule): success while the device is up, destructive while the modem is
// restarting, neutral for a count or a figure. "Up for" and "Memory" are live
// values from the status poll; the other two summarise the chosen range.
// =============================================================================

const NEUTRAL_TILE = "bg-surface-container text-on-surface";
const DISC = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  success: "bg-success text-success-foreground",
  destructive: "bg-destructive text-destructive-foreground",
} as const;

const EYEBROW = "truncate text-xs font-semibold text-on-surface-variant";
const CAPTION = "truncate text-xs text-on-surface-variant";
const VALUE = "truncate text-xl leading-[1.1] font-semibold tabular-nums";

interface TileProps {
  glyph: MaterialSymbolName;
  disc: keyof typeof DISC;
  eyebrow: string;
  value: string;
  /** Appended in the muted step, e.g. "% avg" after a figure. */
  unit?: string;
  caption: string;
}

function Tile({ glyph, disc, eyebrow, value, unit, caption }: TileProps) {
  return (
    <div className={cn(TILE_SHAPE.ROOT, NEUTRAL_TILE)}>
      <span className={cn(TILE_SHAPE.DISC, DISC[disc])}>
        <MaterialSymbol name={glyph} filled size={28} />
      </span>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className={EYEBROW}>{eyebrow}</span>
        <span className={VALUE}>
          {value}
          {unit ? (
            <span className="ml-0.5 text-sm font-semibold text-on-surface-variant">{unit}</span>
          ) : null}
        </span>
        <span className={CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

interface MemoryNow {
  pct: number;
  usedMb: number;
  totalMb: number;
}

/** Live memory from the status poll; the newest bucket when it has not landed. */
function memoryNow(status: LiveStatus | null, history: SystemHistory): MemoryNow | null {
  if (status && status.memUsedMb !== null && status.memTotalMb) {
    return {
      pct: (status.memUsedMb / status.memTotalMb) * 100,
      usedMb: status.memUsedMb,
      totalMb: status.memTotalMb,
    };
  }
  const pct = latestMetric(history.buckets, "mem_pct");
  const used = latestMetric(history.buckets, "mem_mb");
  if (pct === null || used === null || pct <= 0) return null;
  return { pct, usedMb: used, totalMb: (used / pct) * 100 };
}

export function SummaryTiles({
  history,
  incidents,
  status,
}: {
  history: SystemHistory;
  incidents: SystemIncident[];
  status: LiveStatus | null;
}) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;
  const now = history.now;
  const dash = "—";
  const rangeName = t(`system.range.${history.range}`);

  // Up for: how long since the device last came up.
  const uptime = status?.uptimeSec ?? null;
  const upFor: TileProps =
    uptime === null
      ? {
          glyph: "timer",
          disc: "neutral",
          eyebrow: t("system.summary.up.label"),
          value: dash,
          caption: t("system.summary.collecting"),
        }
      : {
          glyph: "timer",
          disc: "success",
          eyebrow: t("system.summary.up.label"),
          value: formatDuration(uptime, t),
          caption: t("system.summary.since", {
            when: formatSince(now - uptime, now, t, locale),
          }),
        };

  // Modem restarts: the count in range, or the live one.
  const crashes = incidents.filter((i) => i.kind === "modem");
  const ongoing = crashes.find((i) => i.end === null);
  const done = crashes.filter((i) => i.end !== null);
  let modem: TileProps;
  if (ongoing) {
    modem = {
      glyph: "sync_problem",
      disc: "destructive",
      eyebrow: t("system.summary.modem.live_label"),
      value: t("system.summary.modem.restarting"),
      caption: t("system.summary.modem.for", {
        duration: formatDuration(Math.max(0, now - ongoing.start), t),
      }),
    };
  } else if (done.length > 0) {
    modem = {
      glyph: "sync_problem",
      disc: "neutral",
      eyebrow: t("system.summary.modem.label"),
      value: String(done.length),
      caption: t("system.summary.modem.last", {
        when: formatWhen(done[0].start, now, t, locale),
      }),
    };
  } else {
    modem = {
      glyph: "sync_problem",
      disc: "neutral",
      eyebrow: t("system.summary.modem.label"),
      value: t("system.summary.modem.none"),
      caption: t("system.summary.modem.none_caption", { range: rangeName }),
    };
  }

  // Processor: mean and busiest moment of the range.
  const cpu = cpuSummary(history.buckets);
  const processor: TileProps = cpu
    ? {
        glyph: "memory",
        disc: "neutral",
        eyebrow: t("system.summary.processor.label"),
        value: String(Math.round(cpu.avg)),
        unit: t("system.summary.processor.unit"),
        caption: t("system.summary.processor.peak", {
          percent: Math.round(cpu.peak),
          when: formatWhen(cpu.peakAt, now, t, locale),
        }),
      }
    : {
        glyph: "memory",
        disc: "neutral",
        eyebrow: t("system.summary.processor.label"),
        value: dash,
        caption: t("system.summary.collecting"),
      };

  // Memory: in use right now.
  const mem = memoryNow(status, history);
  const memory: TileProps = mem
    ? {
        glyph: "memory_alt",
        disc: "neutral",
        eyebrow: t("system.summary.memory.label"),
        value: String(Math.round(mem.pct)),
        unit: "%",
        caption: t("system.summary.memory.in_use", {
          used: Math.round(mem.usedMb),
          total: Math.round(mem.totalMb),
        }),
      }
    : {
        glyph: "memory_alt",
        disc: "neutral",
        eyebrow: t("system.summary.memory.label"),
        value: dash,
        caption: t("system.summary.collecting"),
      };

  return (
    <div className={SUMMARY_SHAPE.GRID}>
      <Tile {...upFor} />
      <Tile {...modem} />
      <Tile {...processor} />
      <Tile {...memory} />
    </div>
  );
}

export function SummaryTilesSkeleton() {
  return (
    <div className={SUMMARY_SHAPE.GRID}>
      {Array.from({ length: SUMMARY_SHAPE.TILES }, (_, i) => (
        <Skeleton key={i} className={cn(SUMMARY_SHAPE.TILE_HEIGHT, "rounded-tile")} />
      ))}
    </div>
  );
}
