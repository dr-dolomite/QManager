"use client";

import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import { formatDuration } from "@/components/history/format";
import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { PREV_BOOT, THIS_BOOT, type UseSystemLogsReturn } from "@/hooks/use-system-logs";
import { cn } from "@/lib/utils";
import type { DeviceLogResponse } from "@/types/device-syslog";
import type { LogEntry } from "@/types/system-logs";

import {
  BUSY_SPAN_SEC,
  dayKeyOf,
  deviceProblems,
  formatClockSeconds,
  isNearRotation,
  parseLogTimestamp,
  systemCoverage,
} from "./derive";
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
//
// With the journal backend the response also counts the whole boot in view
// (`counts`, `latest_problem`), so Severity and Latest problem speak for the
// boot rather than the lines read, and their captions name it ("in this boot",
// "in the previous boot"). The log file is one file across every boot, so with
// a past boot chosen its caption says so instead of lending it to that boot.
// Without those fields the tiles read the window, as before.
//
// The System tab gets the same strip (DeviceLogsSummary), following the System /
// Kernel switch: Severity and Latest problem over the device lines read, then
// Covers (system: how much time the lines read span, warning under a minute,
// when one process is pushing older lines out of the ring) or Since boot
// (kernel: uptime and the ring's line count). The kernel tiles count only the
// kernel's own lines: QCMAP writes user-facility warnings into the ring every
// few seconds. That copy lives in history `logs.summary.device.*`.
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

type CoverState = "unread" | "busy" | "resting";
const COVER_FACE = {
  unread: { disc: "neutral", glyph: "hourglass_top" },
  busy: { disc: "warning", glyph: "speed" },
  resting: { disc: "neutral", glyph: "schedule" },
} satisfies Record<CoverState, Face>;

type BootState = "unread" | "read";
const BOOT_FACE = {
  unread: { disc: "neutral", glyph: "hourglass_top" },
  read: { disc: "neutral", glyph: "timer" },
} satisfies Record<BootState, Face>;

type BootScope = "this" | "prev" | "older";

/** Seconds on the rows' clock: the line's own stamp, else its epoch. */
function problemSec(e: LogEntry): number | null {
  return parseLogTimestamp(e.timestamp) ?? (typeof e.t === "number" ? e.t : null);
}

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
  const { entries, stats, counts, latestProblem: bootProblem, isLoading, lastReadAtSec, boot } = logs;
  const K = "logs.band";
  const B = "logs.summary.boot";
  const scope: BootScope = boot === THIS_BOOT ? "this" : boot === PREV_BOOT ? "prev" : "older";

  if (isLoading) return <LogsSummarySkeleton />;

  const read = lastReadAtSec !== null;

  // ── Severity ────────────────────────────────────────────────────────────
  // The whole boot when the journal counts it, else the lines read.
  let errors = 0;
  let warnings = 0;
  if (counts) {
    errors = counts.ERROR ?? 0;
    warnings = counts.WARN ?? 0;
  } else {
    for (const e of entries) {
      if (e.level === "ERROR") errors++;
      else if (e.level === "WARN") warnings++;
    }
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
  const severityCaption = counts
    ? {
        unread: t(`${K}.severity.caption_unread`),
        errors: th(`${B}.${scope}.caption_errors`, { count: warnings }),
        warnings: th(`${B}.${scope}.caption_warnings`),
        clean: th(`${B}.${scope}.caption_clean`),
      }[severity]
    : {
        unread: t(`${K}.severity.caption_unread`),
        errors: t(`${K}.severity.caption_errors`, { count: warnings, lines: entries.length }),
        warnings: t(`${K}.severity.caption_warnings`, { count: entries.length }),
        clean: t(`${K}.severity.caption_clean`, { count: entries.length }),
      }[severity];

  // ── Latest problem ──────────────────────────────────────────────────────
  const wholeBoot = bootProblem !== undefined;
  const problem = !read ? null : wholeBoot ? bootProblem : latestProblem(entries);
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
    latestCaption = wholeBoot
      ? th(`${B}.${scope}.caption_none`)
      : th("logs.summary.latest.caption_none", { count: entries.length });
  } else if (problem) {
    const sec = problemSec(problem);
    const newest = entries[entries.length - 1];
    const newestSec = newest ? parseLogTimestamp(newest.timestamp) : null;
    if (sec === null) {
      latestValue = problem.timestamp || DASH;
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
          !stats
            ? t(`${K}.file.caption_unread`)
            : scope === "this"
              ? t(`${K}.file.caption`, { count: stats.current_lines, rotated: stats.rotated_files })
              : th("logs.summary.file.caption_all", { count: stats.current_lines })
        }
      />
    </div>
  );
}

/** "14:40:12", with the date in front when the line is from an earlier day than `refSec`. */
function clockOrDate(sec: number, refSec: number, locale: string): string {
  const clock = formatClockSeconds(sec, locale);
  if (dayKeyOf(sec) === dayKeyOf(refSec)) return clock;
  const day = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(sec * 1000);
  return `${day}, ${clock}`;
}

/**
 * The System tab's strip. `device` is the response for the source in view, or
 * null when none has landed (the tiles then read as unread).
 */
export function DeviceLogsSummary({ device }: { device: DeviceLogResponse | null }) {
  const { t } = useTranslation("system-settings");
  const { t: th, i18n } = useTranslation("history");
  const locale = i18n.language;
  const K = "logs.band";
  const D = "logs.summary.device";
  const unreadCaption = t(`${K}.severity.caption_unread`);

  if (!device) {
    return (
      <div className={LOGS_SUMMARY.GRID} aria-label={th(`${D}.head`)} role="group">
        <Tile face={SEVERITY_FACE.unread} eyebrow={t(`${K}.severity.eyebrow`)} value={DASH} caption={unreadCaption} />
        <Tile face={LATEST_FACE.unread} eyebrow={th("logs.summary.latest.eyebrow")} value={DASH} caption={unreadCaption} />
        <Tile face={COVER_FACE.unread} eyebrow={th(`${D}.cover.eyebrow`)} value={DASH} caption={unreadCaption} />
      </div>
    );
  }

  const kernel = device.source === "kernel";
  const { counted, errors, warnings, latest: problem } = deviceProblems(device);

  // ── Severity ────────────────────────────────────────────────────────────
  const severity: SeverityState = errors > 0 ? "errors" : warnings > 0 ? "warnings" : "clean";
  const severityValue = {
    errors: t(`${K}.severity.errors`, { count: errors }),
    warnings: t(`${K}.severity.warnings`, { count: warnings }),
    clean: t(`${K}.severity.clean`),
  }[severity];
  // The kernel counts its own lines only, so its captions say "kernel lines".
  const severityCaption = kernel
    ? {
        errors: th(`${D}.kernel.caption_errors`, { count: warnings, lines: counted }),
        warnings: th(`${D}.kernel.caption_warnings`, { count: counted }),
        clean: th(`${D}.kernel.caption_clean`, { count: counted }),
      }[severity]
    : {
        errors: t(`${K}.severity.caption_errors`, { count: warnings, lines: counted }),
        warnings: t(`${K}.severity.caption_warnings`, { count: counted }),
        clean: t(`${K}.severity.caption_clean`, { count: counted }),
      }[severity];

  // ── Latest problem ──────────────────────────────────────────────────────
  const latest: LatestState = problem === null ? "none" : problem.tone;
  let latestValue = th("logs.summary.latest.none");
  let latestCaption = kernel
    ? th(`${D}.kernel.caption_none`, { count: counted })
    : th("logs.summary.latest.caption_none", { count: counted });
  if (problem) {
    latestValue =
      problem.sec === null
        ? problem.rawTime || DASH
        : clockOrDate(problem.sec, device.now, locale);
    latestCaption = problem.tag ? `${problem.tag}: ${problem.message}` : problem.message;
  }

  // ── Covers (system) / Since boot (kernel) ───────────────────────────────
  let third: ReactElement;
  if (kernel) {
    third = (
      <Tile
        face={BOOT_FACE.read}
        eyebrow={th(`${D}.boot.eyebrow`)}
        value={formatDuration(device.uptime, th)}
        caption={th(`${D}.boot.caption`, { count: device.total })}
      />
    );
  } else {
    const { spanSec, top } = systemCoverage(device);
    const cover: CoverState =
      spanSec === null ? "unread" : spanSec < BUSY_SPAN_SEC ? "busy" : "resting";
    const lines = device.entries.length;
    const caption =
      cover === "unread"
        ? th(`${D}.cover.caption_untimed`)
        : top === null
          ? th(`${D}.cover.caption_lines`, { count: lines })
          : cover === "busy"
            ? th(`${D}.cover.caption_busy`, { proc: top.proc, share: top.share })
            : th(`${D}.cover.caption_top`, { count: lines, proc: top.proc, share: top.share });
    third = (
      <Tile
        face={COVER_FACE[cover]}
        eyebrow={th(`${D}.cover.eyebrow`)}
        value={spanSec === null ? DASH : formatDuration(spanSec, th)}
        caption={caption}
        title={caption}
      />
    );
  }

  return (
    <div className={LOGS_SUMMARY.GRID} aria-label={th(`${D}.head`)} role="group">
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
      {third}
    </div>
  );
}
