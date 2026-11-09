"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CellularHistory } from "@/types/history";
import { formatDuration, formatSince, formatWhen } from "@/components/history/format";

import { summarise } from "./derive";
import { SUMMARY_SHAPE } from "./shapes";

// =============================================================================
// Summary strip — four glance tiles over the range
// =============================================================================
// Connected for / Last outage / Availability / Time on 5G, in the shared
// `TILE_SHAPE` geometry. The body is neutral and the disc is the only coloured
// element (The Data-Ink Rule): success while connected, destructive while down,
// the NR identity fill on the 5G share, neutral for a count or a fact.
// =============================================================================

const NEUTRAL_TILE = "bg-surface-container text-on-surface";
const DISC = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  success: "bg-success text-success-foreground",
  destructive: "bg-destructive text-destructive-foreground",
  nr: "bg-primary text-primary-foreground",
} as const;

const EYEBROW = "truncate text-xs font-semibold text-on-surface-variant";
const CAPTION = "truncate text-xs text-on-surface-variant";
const VALUE = "truncate text-xl leading-[1.1] font-semibold tabular-nums";

function Tile({
  glyph,
  disc,
  eyebrow,
  value,
  unit,
  caption,
}: {
  glyph: MaterialSymbolName;
  disc: keyof typeof DISC;
  eyebrow: string;
  value: string;
  /** Appended in the muted step, e.g. the % after a figure. */
  unit?: string;
  caption: string;
}) {
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
            <span className="ml-0.5 text-sm font-semibold text-on-surface-variant">
              {unit}
            </span>
          ) : null}
        </span>
        <span className={CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

function formatAvailability(pct: number): string {
  return pct >= 100 ? "100" : pct.toFixed(2);
}

export function SummaryTiles({ history }: { history: CellularHistory }) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;
  const now = history.now;
  const summary = summarise(history);
  const cur = history.current;
  const dash = "—";

  // Tile 1: how long the current state has held.
  let connected: React.ComponentProps<typeof Tile>;
  if (!cur) {
    connected = {
      glyph: "signal_cellular_alt",
      disc: "neutral",
      eyebrow: t("cellular.summary.connected.label"),
      value: dash,
      caption: t("cellular.summary.collecting"),
    };
  } else if (cur.state === "down") {
    connected = {
      glyph: "signal_cellular_off",
      disc: "destructive",
      eyebrow: t("cellular.summary.disconnected.label"),
      value: formatDuration(now - cur.since, t),
      caption: t("cellular.summary.since", { when: formatSince(cur.since, now, t, locale) }),
    };
  } else if (cur.state === "off") {
    connected = {
      glyph: "power_settings_new",
      disc: "neutral",
      eyebrow: t("cellular.summary.off.label"),
      value: formatDuration(now - cur.since, t),
      caption: t("cellular.summary.since", { when: formatSince(cur.since, now, t, locale) }),
    };
  } else {
    connected = {
      glyph: "signal_cellular_alt",
      disc: "success",
      eyebrow: t("cellular.summary.connected.label"),
      value: formatDuration(now - cur.since, t),
      caption: t("cellular.summary.since", { when: formatSince(cur.since, now, t, locale) }),
    };
  }

  // Tile 2: the newest completed outage.
  const fault = history.last_fault;
  const lastOutage: React.ComponentProps<typeof Tile> = fault
    ? {
        glyph: "history",
        disc: "neutral",
        eyebrow: t("cellular.summary.last_outage.label"),
        value: formatDuration(fault.end - fault.start, t),
        caption: formatWhen(fault.start, now, t, locale),
      }
    : {
        glyph: "history",
        disc: "neutral",
        eyebrow: t("cellular.summary.last_outage.label"),
        value: t("cellular.summary.last_outage.none"),
        caption: t("cellular.summary.last_outage.none_caption"),
      };

  // Tile 3: share of observed time that was not an outage.
  const availability: React.ComponentProps<typeof Tile> =
    summary.availability === null
      ? {
          glyph: "percent",
          disc: "neutral",
          eyebrow: t("cellular.summary.availability.label"),
          value: dash,
          caption: t("cellular.summary.collecting"),
        }
      : {
          glyph: "percent",
          disc: "neutral",
          eyebrow: t("cellular.summary.availability.label"),
          value: formatAvailability(summary.availability),
          unit: "%",
          caption:
            summary.outages > 0
              ? t("cellular.summary.availability.outages", { count: summary.outages })
              : t("cellular.summary.availability.none"),
        };

  // Tile 4: how much of the radio time the 5G NR leg carried.
  const nrShare = summary.nrShare;
  const onNr = Math.round(nrShare ?? 0);
  const nr: React.ComponentProps<typeof Tile> =
    nrShare === null
      ? {
          glyph: "cell_tower",
          disc: "neutral",
          eyebrow: t("cellular.summary.nr.label"),
          value: dash,
          caption: t("cellular.summary.collecting"),
        }
      : {
          glyph: "cell_tower",
          disc: summary.lteOnly ? "neutral" : "nr",
          eyebrow: t("cellular.summary.nr.label"),
          value: String(onNr),
          unit: "%",
          caption: summary.lteOnly
            ? t("cellular.summary.nr.lte_only")
            : t("cellular.summary.nr.lte_share", { percent: 100 - onNr }),
        };

  return (
    <div className={SUMMARY_SHAPE.GRID}>
      <Tile {...connected} />
      <Tile {...lastOutage} />
      <Tile {...availability} />
      <Tile {...nr} />
    </div>
  );
}

export function SummaryTilesSkeleton() {
  return (
    <div className={SUMMARY_SHAPE.GRID}>
      {Array.from({ length: SUMMARY_SHAPE.TILES }, (_, i) => (
        <Skeleton
          key={i}
          className={cn(SUMMARY_SHAPE.TILE_HEIGHT, "rounded-tile")}
        />
      ))}
    </div>
  );
}
