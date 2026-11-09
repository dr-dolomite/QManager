"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import { formatDuration, formatSince, formatWhen } from "@/components/history/format";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { summarise } from "./derive";
import { SUMMARY_SHAPE } from "./shapes";
import type { ConnectionHistory, ConnectionLimits } from "./types";

// =============================================================================
// Summary strip: four glance tiles over the range
// =============================================================================
// Online for / Last outage / Availability / Median latency, in the shared
// `TILE_SHAPE` geometry. The body is neutral and the disc is the only coloured
// element (The Data-Ink Rule): success while online, destructive while offline,
// neutral for a count or a fact.
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
  /** Appended in the muted step, e.g. the % after a figure. */
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

function formatAvailability(pct: number): string {
  return pct >= 100 ? "100" : pct.toFixed(2);
}

export function SummaryTiles({
  history,
  limits,
}: {
  history: ConnectionHistory;
  limits: ConnectionLimits;
}) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;
  const now = history.now;
  const summary = summarise(history, limits);
  const cur = history.current;
  const dash = "—";
  const collecting = t("connection.tiles.collecting");

  // Tile 1: how long the current state has held.
  let online: TileProps;
  if (!cur) {
    online = {
      glyph: "public",
      disc: "neutral",
      eyebrow: t("connection.tiles.online.label"),
      value: dash,
      caption: collecting,
    };
  } else {
    const held = {
      value: formatDuration(now - cur.since, t),
      caption: t("connection.tiles.since", { when: formatSince(cur.since, now, t, locale) }),
    };
    online =
      cur.state === "down"
        ? {
            glyph: "wifi_off",
            disc: "destructive",
            eyebrow: t("connection.tiles.offline.label"),
            ...held,
          }
        : cur.state === "off"
          ? {
              glyph: "power_settings_new",
              disc: "neutral",
              eyebrow: t("connection.tiles.radio_off.label"),
              ...held,
            }
          : {
              glyph: "public",
              disc: "success",
              eyebrow: t("connection.tiles.online.label"),
              ...held,
            };
  }

  // Tile 2: the newest completed outage. An untrusted clock answers
  // last_fault:null whatever the store holds, so it is not "none".
  const fault = history.last_fault;
  const lastOutage: TileProps = !history.clock_trusted
    ? {
        glyph: "history",
        disc: "neutral",
        eyebrow: t("connection.tiles.last_outage.label"),
        value: dash,
        caption: collecting,
      }
    : fault
    ? {
        glyph: "history",
        disc: "neutral",
        eyebrow: t("connection.tiles.last_outage.label"),
        value: formatDuration(fault.end - fault.start, t),
        caption: formatWhen(fault.start, now, t, locale),
      }
    : {
        glyph: "history",
        disc: "neutral",
        eyebrow: t("connection.tiles.last_outage.label"),
        value: t("connection.tiles.last_outage.none"),
        caption: t("connection.tiles.last_outage.none_caption"),
      };

  // Tile 3: share of observed time that was not an outage.
  const availability: TileProps =
    summary.availability === null
      ? {
          glyph: "percent",
          disc: "neutral",
          eyebrow: t("connection.tiles.availability.label"),
          value: dash,
          caption: collecting,
        }
      : {
          glyph: "percent",
          disc: "neutral",
          eyebrow: t("connection.tiles.availability.label"),
          value: formatAvailability(summary.availability),
          unit: "%",
          caption:
            summary.outages > 0
              ? t("connection.tiles.availability.outages", { count: summary.outages })
              : t("connection.tiles.availability.none"),
        };

  // Tile 4: the typical round trip, and how often it was over the limit.
  const median: TileProps =
    summary.medianLatency === null
      ? {
          glyph: "speed",
          disc: "neutral",
          eyebrow: t("connection.tiles.median.label"),
          value: dash,
          caption: collecting,
        }
      : {
          glyph: "speed",
          disc: "neutral",
          eyebrow: t("connection.tiles.median.label"),
          value: String(Math.round(summary.medianLatency)),
          unit: "ms",
          caption:
            summary.slowBuckets > 0
              ? t("connection.tiles.median.slow", {
                  slow: summary.slowBuckets,
                  total: summary.gradedBuckets,
                })
              : t("connection.tiles.median.within"),
        };

  return (
    <div className={SUMMARY_SHAPE.GRID}>
      <Tile {...online} />
      <Tile {...lastOutage} />
      <Tile {...availability} />
      <Tile {...median} />
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
