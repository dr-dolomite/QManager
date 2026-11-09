// =============================================================================
// Device logs: GET /cgi-bin/quecmanager/system/syslog.sh
// =============================================================================
// The modem's own logs (not QManager's transcript): the system log ring kept by
// logd (`logread`) and the kernel ring (`dmesg`). Read-only.
// Query: ?source=system|kernel&lines=<50..500, default 200>
// =============================================================================

export type DeviceLogSource = "system" | "kernel";

export const DEVICE_LOG_LINES = [100, 200, 500] as const;
export type DeviceLogLines = (typeof DEVICE_LOG_LINES)[number];

/** syslog priority, lowest number = most severe. */
export type DeviceLogLevel =
  | "emerg"
  | "alert"
  | "crit"
  | "err"
  | "warning"
  | "notice"
  | "info"
  | "debug";

export interface DeviceSystemLogEntry {
  /** Epoch seconds, null when the line's time could not be parsed. */
  t: number | null;
  /** The line's own time text as logged (fallback when t is null). */
  ts: string;
  /** syslog facility, e.g. "user", "daemon", "kern"; null if absent. */
  facility: string | null;
  level: DeviceLogLevel | null;
  /** Process name, e.g. "qms"; null if absent. */
  proc: string | null;
  pid: number | null;
  msg: string;
}

export interface DeviceKernelLogEntry {
  /** Seconds since boot (kernel stamp). Wall time = now - uptime + up. */
  up: number;
  /**
   * From the line's `dmesg -r` priority: "kern" for the kernel itself, "user"
   * (or another facility) for user-space writers such as QCMAP that log into
   * the ring. Null when the line had no priority prefix; absent from a backend
   * older than the field.
   */
  facility?: string | null;
  /** The line's priority, null without a prefix; absent from an older backend. */
  level?: DeviceLogLevel | null;
  msg: string;
}

interface DeviceLogBase {
  success: true;
  /** Device wall clock, epoch seconds. */
  now: number;
  /** Seconds since boot (/proc/uptime), for kernel wall times. */
  uptime: number;
  /** Lines in the ring before the lines limit. */
  total: number;
}

export interface DeviceSystemLogResponse extends DeviceLogBase {
  source: "system";
  /** Newest first. */
  entries: DeviceSystemLogEntry[];
}

export interface DeviceKernelLogResponse extends DeviceLogBase {
  source: "kernel";
  /** Newest first. */
  entries: DeviceKernelLogEntry[];
}

export type DeviceLogResponse = DeviceSystemLogResponse | DeviceKernelLogResponse;
