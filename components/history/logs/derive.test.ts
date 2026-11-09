// Run with: bun test components/history/logs
import { describe, expect, it } from "bun:test";

import type { LogEntry } from "@/types/system-logs";

import {
  groupByDay,
  paginate,
  kernelWallSec,
  qmanagerLines,
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
