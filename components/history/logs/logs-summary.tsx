"use client";

import { useTranslation } from "react-i18next";

import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import type { UseSystemLogsReturn } from "@/hooks/use-system-logs";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/types/system-logs";

import { dayKeyOf, formatClockSeconds, isNearRotation, parseLogTimestamp } from "./derive";
import { LOGS_SUMMARY } from "./shapes";

// =============================================================================
// Logs: the summary strip over the QManager tab
// =============================================================================
// Three glance tiles about QManager's own log: Severity (errors and warnings in
// the lines read), Latest problem (when the newest error or warning was logged,
// and by what), and Log file (size, lines, archives, and a warning as it nears
// rotation). The System Health tile language: neutral body, the disc is the
// only colour, and every state of a tile wears its own glyph. Severity and Log
// file copy lives in system-settings `logs.band.*` (translated since the old
// System Logs page); Latest problem's in history `logs.summary.latest.*`.
//
// Latest problem shows the line's clock time, not "12m ago": the stamp is the
// modem's local time, and the browser's clock or timezone may differ. The date
// is added only when the line is from an earlier day than the newest line read.
// =============================================================================

const NEUTRAL_TILE = "bg-surface-container text-on-surface";
const DISC = {
  neutral: "bg-surface-container-high text-on-surface-variant",
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

type LatestState = "unread" | "error" | "warn" | "none";
const LATEST_FACE = {
  unread: { disc: "neutral", glyph: "hourglass_top" },
  error: { disc: "destructive", glyph: "error" },
  warn: { disc: "warning", glyph: "warning" },
  none: { disc: "success", glyph: "check_circle" },
} satisfies Record<LatestState, Face>;

type FileState = "unread" | "filling" | "resting";
const FILE_FACE = {
  unread: { disc: "neutral", glyph: "hourglass_top" },
  filling: { disc: "warning", glyph: "priority_high" },
  resting: { disc: "neutral", glyph: "storage" },
} satisfies Record<FileState, Face>;

/** The newest ERROR or WARN line in an oldest-first window. */
function latestProblem(entries: LogEntry[]): LogEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.level === "ERROR" || e.level === "WARN") return e;
  }
  return null;
}

function Tile({
  face,
  eyebrow,
  value,
  caption,
  title,
}: {
  face: Face;
  eyebrow: string;
  value: string;
  caption: string;
  /** The full caption on hover, for a log line the tile truncates. */
  title?: string;
}) {
  return (
    <div className={cn(TILE_SHAPE.ROOT, NEUTRAL_TILE)}>
      <span className={cn(TILE_SHAPE.DISC, DISC[face.disc])}>
        <MaterialSymbol name={face.glyph} filled size={28} aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className={EYEBROW}>{eyebrow}</span>
        <span className={VALUE}>{value}</span>
        <span className={CAPTION} title={title}>
          {caption}
        </span>
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
  const { t: th, i18n } = useTranslation("history");
  const locale = i18n.language;
  const { entries, stats, isLoading, lastReadAtSec } = logs;
  const K = "logs.band";

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

  // ── Latest problem ──────────────────────────────────────────────────────
  const problem = read ? latestProblem(entries) : null;
  const latest: LatestState = !read
    ? "unread"
    : problem === null
      ? "none"
      : problem.level === "ERROR"
        ? "error"
        : "warn";
  let latestValue = DASH;
  let latestCaption = t(`${K}.severity.caption_unread`);
  if (latest === "none") {
    latestValue = th("logs.summary.latest.none");
    latestCaption = th("logs.summary.latest.caption_none", { count: entries.length });
  } else if (problem) {
    const sec = parseLogTimestamp(problem.timestamp);
    const newestSec = parseLogTimestamp(entries[entries.length - 1].timestamp);
    if (sec === null) {
      latestValue = problem.timestamp;
    } else {
      const clock = formatClockSeconds(sec, locale);
      const earlierDay = newestSec !== null && dayKeyOf(sec) !== dayKeyOf(newestSec);
      latestValue = earlierDay
        ? `${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(sec * 1000)}, ${clock}`
        : clock;
    }
    latestCaption = problem.component
      ? `${problem.component}: ${problem.message}`
      : problem.message;
  }

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
        face={LATEST_FACE[latest]}
        eyebrow={th("logs.summary.latest.eyebrow")}
        value={latestValue}
        caption={latestCaption}
        title={problem ? latestCaption : undefined}
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
