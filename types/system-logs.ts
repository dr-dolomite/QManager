// =============================================================================
// System Logs — the shape `system/logs.sh` actually serves
// =============================================================================

/**
 * The four levels `logs.sh` recognises. Its awk pass drops any line whose level
 * is not in this set, so the union is exhaustive by construction — a widened
 * union here would be a lie until the backend widens too.
 */
export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** The rail's selection: an exact level, or every level. */
export type LevelFilter = LogLevel | "all";

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

export interface LogEntry {
  /** `YYYY-MM-DD HH:MM:SS`, in the device's local time. */
  timestamp: string;
  level: LogLevel;
  component: string;
  /** Present but empty when the log line carried no PID. */
  pid: string;
  message: string;
  /** Journal sequence number; absent from the pre-journal backend. */
  seq?: number;
  /** Epoch seconds when the journal knows the wall time; null when it does not. */
  t?: number | null;
}

/** One boot the journal holds lines for. */
export interface LogBoot {
  /** The boot's id, as the `boot` query parameter accepts it. */
  boot: number | string;
  first_seq?: number;
  last_seq?: number;
  /** Epoch seconds of the boot's first and last line, null when unknown. */
  first?: number | null;
  last?: number | null;
}

export type LogCounts = Partial<Record<LogLevel, number>>;

export interface LogStats {
  current_size_kb: number;
  current_lines: number;
  rotated_files: number;
}

export interface LogsResponse {
  success: boolean;
  entries: LogEntry[];
  /**
   * Line-counted from the very string the CGI serialises into `entries`, so it
   * is equal to `entries.length` by construction. Kept in the payload and
   * deliberately unread — "N of N" is not a fact about the log.
   */
  total: number;
  stats: LogStats;
  available_components: string[];
  // ── Journal fields (qmanager_logd); every one is absent from the old backend ──
  /** The boot this response reads. */
  boot?: number | string;
  /** The boot the device is running now. */
  this_boot?: number | string;
  /** The newest sequence number in the queried boot; the poll's `after` cursor. */
  head_seq?: number;
  /** More lines exist before the oldest returned one. */
  has_more?: boolean;
  boots?: LogBoot[];
  counts?: LogCounts;
  latest_problem?: LogEntry | null;
  error?: string;
  detail?: string;
}
