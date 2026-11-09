import type { DeviceKernelLogEntry, DeviceLogLevel } from "@/types/device-syslog";
import type { LogEntry, LogLevel } from "@/types/system-logs";

import { parseLogTimestamp } from "@/components/system-settings/logs/derive";

// =============================================================================
// Logs card: pure helpers
// =============================================================================
// Both log sources (QManager's own transcript and the device's system log)
// collapse onto four visible levels, so one chip vocabulary serves both and no
// two levels share a glyph. Kept free of React so the mapping is testable.
// =============================================================================

export type LogTone = "error" | "warn" | "info" | "debug";

/** QManager's four levels onto the shared four. */
export function toneOfQManager(level: LogLevel): LogTone {
  switch (level) {
    case "ERROR":
      return "error";
    case "WARN":
      return "warn";
    case "INFO":
      return "info";
    default:
      return "debug";
  }
}

/**
 * The eight syslog priorities onto the shared four: emerg, alert, crit and err
 * are all "something failed"; notice reads as information. A line with no
 * parsed priority has no tone, and the row shows no level chip rather than a
 * made-up one.
 */
export function toneOfSyslog(level: DeviceLogLevel | null): LogTone | null {
  switch (level) {
    case "emerg":
    case "alert":
    case "crit":
    case "err":
      return "error";
    case "warning":
      return "warn";
    case "notice":
    case "info":
      return "info";
    case "debug":
      return "debug";
    default:
      return null;
  }
}

/** A kernel line's stamp (seconds since boot) as device wall-clock seconds. */
export function kernelWallSec(entry: DeviceKernelLogEntry, now: number, uptime: number): number {
  return Math.floor(now - uptime + entry.up);
}

/** "14:40:12", 24-hour in every locale. */
export function formatClockSeconds(sec: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(sec * 1000);
}

/** A local calendar-day key, so rows group under one heading per day. */
export function dayKeyOf(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** One row as the list draws it, whichever source it came from. */
export interface LogLineView {
  key: string;
  /** Epoch seconds, or null when the line's time could not be read. */
  sec: number | null;
  /** The device's own time text, shown when `sec` is null. */
  rawTime: string;
  tone: LogTone | null;
  tag: string | null;
  message: string;
}

/** Newest-first rows from QManager's oldest-first window, level-filtered upstream. */
export function qmanagerLines(entries: LogEntry[], cap: number): LogLineView[] {
  const seen = new Map<string, number>();
  const out: LogLineView[] = [];
  for (let i = entries.length - 1; i >= 0 && out.length < cap; i--) {
    const e = entries[i];
    const base = `${e.timestamp}|${e.component}|${e.pid}|${e.message}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({
      key: n === 0 ? base : `${base}#${n}`,
      sec: parseLogTimestamp(e.timestamp),
      rawTime: e.timestamp,
      tone: toneOfQManager(e.level),
      tag: e.component || null,
      message: e.message,
    });
  }
  return out;
}

export interface DayGroup {
  /** Null for the leading rows of an unreadable time, which get no heading. */
  sec: number | null;
  rows: LogLineView[];
}

/** Groups consecutive rows by local day; an unreadable time joins its neighbour. */
export function groupByDay(rows: LogLineView[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let lastKey: string | null = null;
  for (const row of rows) {
    const key: string | null = row.sec === null ? lastKey : dayKeyOf(row.sec);
    const last = groups[groups.length - 1];
    if (last && key === lastKey) {
      last.rows.push(row);
    } else {
      groups.push({ sec: row.sec, rows: [row] });
      lastKey = key;
    }
  }
  return groups;
}
