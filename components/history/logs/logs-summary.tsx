"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import { isNearRotation, relativeAge } from "@/components/system-settings/logs/derive";
import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import type { FeedState, UseSystemLogsReturn } from "@/hooks/use-system-logs";
import { cn } from "@/lib/utils";

import { LOGS_SUMMARY } from "./shapes";

// =============================================================================
// Logs: the summary strip over the QManager tab
// =============================================================================
// Three glance tiles about QManager's own log: Severity (errors and warnings in
// the lines read), Feed (is the 10 s refresh delivering, and how long ago), and
// Log file (size, lines, archives, and a warning as it nears rotation). The
// System Health tile language: neutral body, the disc is the only colour, and
// every state of a tile wears its own glyph. Copy lives in system-settings
// `logs.band.*`, where it has been translated since the old System Logs page.
// =============================================================================

const NEUTRAL_TILE = "bg-surface-container text-on-surface";
const DISC = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  primary: "bg-primary text-primary-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  destructive: "bg-destructive text-destructive-foreground",
} as const;
type Disc = keyof typeof DISC;

const EYEBROW = "truncate text-xs font-semibold text-on-surface-variant";
const CAPTION = "truncate text-xs text-on-surface-variant";
const VALUE = "truncate text-xl leading-[1.1] font-semibold tabular-nums";
const DASH = "—";

interface Face {
  disc: Disc;
  glyph: MaterialSymbolName;
}

type SeverityState = "unread" | "errors" | "warnings" | "clean";
const SEVERITY_FACE = {
  unread: { disc: "neutral", glyph: "hourglass_top" },
  errors: { disc: "destructive", glyph: "error" },
  warnings: { disc: "warning", glyph: "warning" },
  clean: { disc: "success", glyph: "check_circle" },
} satisfies Record<SeverityState, Face>;

/** Bound to the hook's own union, so a fourth feed state fails the build. */
const FEED_FACE = {
  live: { disc: "primary", glyph: "graphic_eq" },
  paused: { disc: "neutral", glyph: "schedule" },
  stopped: { disc: "neutral", glyph: "cloud_off" },
} satisfies Record<FeedState, Face>;

type FileState = "unread" | "filling" | "resting";
const FILE_FACE = {
  unread: { disc: "neutral", glyph: "hourglass_top" },
  filling: { disc: "warning", glyph: "priority_high" },
  resting: { disc: "neutral", glyph: "storage" },
} satisfies Record<FileState, Face>;

function Tile({
  face,
  eyebrow,
  value,
  caption,
}: {
  face: Face;
  eyebrow: string;
  value: string;
  caption: string;
}) {
  return (
    <div className={cn(TILE_SHAPE.ROOT, NEUTRAL_TILE)}>
      <span className={cn(TILE_SHAPE.DISC, DISC[face.disc])}>
        <MaterialSymbol name={face.glyph} filled size={28} aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className={EYEBROW}>{eyebrow}</span>
        <span className={VALUE}>{value}</span>
        <span className={CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

function TileSkeleton() {
  return (
    <div className={cn(TILE_SHAPE.ROOT, NEUTRAL_TILE)}>
      <Skeleton className={cn(TILE_SHAPE.DISC, "rounded-pill")} />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <Skeleton className="h-4 w-20 rounded-inline" />
        <Skeleton className="h-[22px] w-28 rounded-inline" />
        <Skeleton className="h-4 w-36 rounded-inline" />
      </div>
    </div>
  );
}

export function LogsSummarySkeleton() {
  return (
    <div className={LOGS_SUMMARY.GRID} aria-hidden="true">
      <TileSkeleton />
      <TileSkeleton />
      <TileSkeleton />
    </div>
  );
}

export function LogsSummary({ logs }: { logs: UseSystemLogsReturn }) {
  const { t } = useTranslation("system-settings");
  const { entries, stats, isLoading, feedState, lastReadAtSec } = logs;
  const K = "logs.band";

  // A one-second tick for the Feed caption's age: a reading that changes while
  // the user watches, not an animation.
  const [nowSec, setNowSec] = React.useState(() => Math.floor(Date.now() / 1000));
  React.useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  if (isLoading) return <LogsSummarySkeleton />;

  const read = lastReadAtSec !== null;

  // ── Severity ────────────────────────────────────────────────────────────
  let errors = 0;
  let warnings = 0;
  for (const e of entries) {
    if (e.level === "ERROR") errors++;
    else if (e.level === "WARN") warnings++;
  }
  const severity: SeverityState = !read
    ? "unread"
    : errors > 0
      ? "errors"
      : warnings > 0
        ? "warnings"
        : "clean";
  const severityValue = {
    unread: DASH,
    errors: t(`${K}.severity.errors`, { count: errors }),
    warnings: t(`${K}.severity.warnings`, { count: warnings }),
    clean: t(`${K}.severity.clean`),
  }[severity];
  const severityCaption = {
    unread: t(`${K}.severity.caption_unread`),
    errors: t(`${K}.severity.caption_errors`, { count: warnings, lines: entries.length }),
    warnings: t(`${K}.severity.caption_warnings`, { count: entries.length }),
    clean: t(`${K}.severity.caption_clean`, { count: entries.length }),
  }[severity];

  // ── Feed ────────────────────────────────────────────────────────────────
  const age = relativeAge(read ? Math.max(0, nowSec - lastReadAtSec) : 0);
  const ageText = t(`logs.time.${age.unit}`, { value: age.count });
  const feedCaption = !read
    ? t(`${K}.feed.caption_unread`)
    : t(`${K}.feed.caption_${feedState}`, { age: ageText });

  // ── Log file ────────────────────────────────────────────────────────────
  const file: FileState = !stats
    ? "unread"
    : isNearRotation(stats.current_size_kb)
      ? "filling"
      : "resting";

  return (
    <div className={LOGS_SUMMARY.GRID} aria-label={t(`${K}.head`)} role="group">
      <Tile
        face={SEVERITY_FACE[severity]}
        eyebrow={t(`${K}.severity.eyebrow`)}
        value={severityValue}
        caption={severityCaption}
      />
      <Tile
        face={FEED_FACE[feedState]}
        eyebrow={t(`${K}.feed.eyebrow`)}
        value={t(`${K}.feed.${feedState}`)}
        caption={feedCaption}
      />
      <Tile
        face={FILE_FACE[file]}
        eyebrow={t(`${K}.file.eyebrow`)}
        value={stats ? t(`${K}.file.size`, { size: stats.current_size_kb }) : DASH}
        caption={
          stats
            ? t(`${K}.file.caption`, { count: stats.current_lines, rotated: stats.rotated_files })
            : t(`${K}.file.caption_unread`)
        }
      />
    </div>
  );
}
