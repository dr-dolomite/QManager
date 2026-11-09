// Run with: bun test components/history/logs
import { describe, expect, it } from "bun:test";

import type {
  DeviceKernelLogResponse,
  DeviceSystemLogEntry,
  DeviceSystemLogResponse,
} from "@/types/device-syslog";
import type { LogEntry } from "@/types/system-logs";

import {
  deviceProblems,
  systemCoverage,
  groupByDay,
  paginate,
  kernelWallSec,
  modemNowSec,
  parseLogTimestamp,
  qmanagerLines,
  rowClockOffset,
  toneOfSyslog,
  type LogLineView,
} from "./derive";

const entry = (timestamp: string, message: string): LogEntry => ({
  timestamp,
  level: "INFO",
  component: "poller",
  pid: "",
  message,
});

describe("toneOfSyslog", () => {
  it("collapses the eight priorities onto four tones", () => {
    expect(["emerg", "alert", "crit", "err"].map((l) => toneOfSyslog(l as never))).toEqual([
      "error",
      "error",
      "error",
      "error",
    ]);
    expect(toneOfSyslog("warning")).toBe("warn");
    expect(toneOfSyslog("notice")).toBe("info");
    expect(toneOfSyslog("info")).toBe("info");
    expect(toneOfSyslog("debug")).toBe("debug");
    expect(toneOfSyslog(null)).toBeNull();
  });
});

describe("kernelWallSec", () => {
  it("is now minus uptime plus the stamp", () => {
    expect(kernelWallSec({ up: 100, msg: "x" }, 10_000, 600)).toBe(9_500);
  });
});

describe("qmanagerLines", () => {
  it("returns newest first, capped, with unique keys for repeated lines", () => {
    const rows = qmanagerLines(
      [
        entry("2026-11-09 10:00:00", "a"),
        entry("2026-11-09 10:00:01", "same"),
        entry("2026-11-09 10:00:01", "same"),
      ],
      2,
    );
    expect(rows.map((r) => r.message)).toEqual(["same", "same"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});

describe("groupByDay", () => {
  const row = (sec: number | null, key: string): LogLineView => ({
    key,
    sec,
    rawTime: "",
    tone: null,
    tag: null,
    message: key,
  });

  it("splits at the local midnight and lets an unreadable time join its neighbour", () => {
    const day1 = new Date(2026, 10, 9, 12).getTime() / 1000;
    const day2 = new Date(2026, 10, 8, 12).getTime() / 1000;
    const groups = groupByDay([row(day1, "a"), row(null, "b"), row(day2, "c")]);
    expect(groups.map((g) => g.rows.map((r) => r.key))).toEqual([["a", "b"], ["c"]]);
  });

  it("gives leading unreadable rows a group with no heading", () => {
    const groups = groupByDay([row(null, "a")]);
    expect(groups[0].sec).toBeNull();
  });
});

describe("paginate", () => {
  const rows: LogLineView[] = Array.from({ length: 23 }, (_, i) => ({
    key: String(i),
    sec: null,
    rawTime: "",
    tone: null,
    tag: null,
    message: `m${i}`,
  }));

  it("slices one page and reports the range", () => {
    const v = paginate(rows, 1, 10);
    expect(v.page).toBe(1);
    expect(v.pageCount).toBe(3);
    expect([v.from, v.to]).toEqual([11, 20]);
    expect(v.rows[0].message).toBe("m10");
  });

  it("clamps a stale index onto the last page", () => {
    const v = paginate(rows, 9, 10);
    expect(v.page).toBe(2);
    expect([v.from, v.to]).toEqual([21, 23]);
  });

  it("reads an empty list as page 1 of 1", () => {
    const v = paginate([], 4, 10);
    expect([v.page, v.pageCount, v.from, v.to]).toEqual([0, 1, 0, 0]);
  });
});

const sysEntry = (
  t: number | null,
  level: DeviceSystemLogEntry["level"],
  proc: string | null,
  msg: string,
): DeviceSystemLogEntry => ({ t, ts: t === null ? "" : "stamp", facility: "user", level, proc, pid: null, msg });

const sysLog = (entries: DeviceSystemLogEntry[]): DeviceSystemLogResponse => ({
  success: true,
  source: "system",
  now: 2000,
  uptime: 500,
  total: entries.length,
  entries,
});

describe("deviceProblems", () => {
  it("counts errors and warnings and keeps the newest problem", () => {
    const p = deviceProblems(
      sysLog([
        sysEntry(1010, "debug", "qms", "tick"),
        sysEntry(1009, "warning", "netifd", "newest warning"),
        sysEntry(1008, "crit", "procd", "older crit"),
        sysEntry(1007, "err", "procd", "oldest err"),
      ]),
    );
    expect(p).toMatchObject({ counted: 4, errors: 2, warnings: 1 });
    expect(p.latest).toEqual({
      tone: "warn",
      sec: 1009,
      rawTime: "stamp",
      tag: "netifd",
      message: "newest warning",
    });
  });

  it("has no latest problem in a clean window", () => {
    const p = deviceProblems(sysLog([sysEntry(1, "info", "qms", "a")]));
    expect(p).toEqual({ counted: 1, errors: 0, warnings: 0, latest: null });
  });

  it("counts only the kernel's own lines in the kernel ring", () => {
    const kernel: DeviceKernelLogResponse = {
      success: true,
      source: "kernel",
      now: 2000,
      uptime: 500,
      total: 4,
      entries: [
        { up: 400, facility: "user", level: "warning", msg: "QCMAP:bringup v6" },
        { up: 300, facility: "kern", level: "info", msg: "link up" },
        { up: 46, facility: "kern", level: "err", msg: "probe failed" },
        { up: 1, msg: "older backend line" },
      ],
    };
    const p = deviceProblems(kernel);
    expect(p).toMatchObject({ counted: 3, errors: 1, warnings: 0 });
    expect(p.latest).toEqual({
      tone: "error",
      sec: 1546,
      rawTime: "",
      tag: null,
      message: "probe failed",
    });
  });
});

describe("systemCoverage", () => {
  it("spans the stamped lines and names the busiest process", () => {
    const c = systemCoverage(
      sysLog([
        sysEntry(1010, "debug", "qms", "a"),
        sysEntry(null, null, null, "continuation"),
        sysEntry(1004, "debug", "qms", "b"),
        sysEntry(1000, "notice", "procd", "c"),
      ]),
    );
    expect(c).toEqual({ spanSec: 10, top: { proc: "qms", share: 50 } });
  });

  it("has no span under two stamps", () => {
    expect(systemCoverage(sysLog([sysEntry(5, "info", null, "x")]))).toEqual({
      spanSec: null,
      top: null,
    });
  });
});

describe("rowClockOffset / modemNowSec", () => {
  // A modem two hours ahead of the viewer: the stamp reads 2 h later than `t`.
  const stamp = "2026-11-10 14:00:00";
  const local = parseLogTimestamp(stamp) as number;
  const timed: LogEntry = { ...entry(stamp, "x"), t: local - 7200 };

  it("is the newest timed entry's stamp minus its epoch", () => {
    expect(rowClockOffset([entry(stamp, "untimed"), timed])).toBe(7200);
  });

  it("is 0 when no entry carries an epoch", () => {
    expect(rowClockOffset([entry(stamp, "untimed")])).toBe(0);
  });

  it("takes the journal's newest line on the rows' clock", () => {
    const boots = [{ boot: 2, last: local - 7200 + 60 }, { boot: 1, last: local - 90_000 }];
    expect(modemNowSec([timed], boots, 7200)).toBe(local + 60);
  });

  it("falls back to the newest line read, then null", () => {
    expect(modemNowSec([timed], [], 7200)).toBe(local);
    expect(modemNowSec([], [], 0)).toBeNull();
  });
});
