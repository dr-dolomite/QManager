// Run with: bun test components/history/axis.test.ts
import { describe, expect, it } from "bun:test";

import { axisTicks } from "./axis";
import { DAY, HOUR, MINUTE, formatClock, formatSpan } from "./format";

// 2027-01-15 12:00:07 UTC, deliberately off the grid.
const NOW = 1_800_014_407;
const t = ((key: string) => key) as never;

describe("axisTicks", () => {
  it("5m: every minute on the minute", () => {
    const ticks = axisTicks("5m", NOW - 300, NOW, "en");
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const k of ticks) {
      expect(k.t % MINUTE).toBe(0);
      expect(k.label).toBe(formatClock(k.t, "en"));
      expect(k.position).toBeGreaterThan(0.13);
      expect(k.position).toBeLessThan(0.93);
    }
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].t - ticks[i - 1].t).toBe(MINUTE);
  });

  it("1h: every 15 minutes on the quarter hour", () => {
    const ticks = axisTicks("1h", NOW - HOUR, NOW, "en");
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const k of ticks) expect(k.t % (15 * MINUTE)).toBe(0);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].t - ticks[i - 1].t).toBe(15 * MINUTE);
  });

  it("24h: every 6 hours", () => {
    const ticks = axisTicks("24h", NOW - DAY, NOW, "en");
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].t - ticks[i - 1].t).toBe(6 * HOUR);
  });

  it("7d: each local midnight", () => {
    const ticks = axisTicks("7d", NOW - 7 * DAY, NOW, "en");
    expect(ticks.length).toBeGreaterThan(3);
    for (const k of ticks) expect(new Date(k.t * 1000).getHours()).toBe(0);
  });

  it("15d: every third local midnight, stable as the window slides", () => {
    const a = axisTicks("15d", NOW - 15 * DAY, NOW, "en");
    expect(a.length).toBeGreaterThanOrEqual(3);
    for (const k of a) expect(new Date(k.t * 1000).getHours()).toBe(0);
    for (let i = 1; i < a.length; i++) {
      const gap = (a[i].t - a[i - 1].t) / DAY;
      expect(gap).toBeGreaterThan(2.9);
      expect(gap).toBeLessThan(3.1);
    }
    // One day later the same midnights are still ticks (except those that left or entered).
    const b = axisTicks("15d", NOW + DAY - 15 * DAY, NOW + DAY, "en");
    const shared = a.filter((k) => b.some((x) => x.t === k.t));
    expect(shared.length).toBeGreaterThanOrEqual(a.length - 2);
  });

  it("30d: weekly", () => {
    const ticks = axisTicks("30d", NOW - 30 * DAY, NOW, "en");
    expect(ticks.length).toBeGreaterThanOrEqual(3);
  });

  it("returns nothing for an empty window", () => {
    expect(axisTicks("5m", NOW, NOW)).toEqual([]);
  });
});

describe("formatSpan", () => {
  it("shows seconds for a window shorter than a minute", () => {
    const s = formatSpan(NOW - 7, NOW + 3, NOW, t, "en");
    expect(s).toMatch(/\d{2}:\d{2}:\d{2}.*\d{2}:\d{2}:\d{2}/);
  });

  it("stays at minutes for a minute or longer", () => {
    const s = formatSpan(NOW, NOW + 60, NOW, t, "en");
    expect(s).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
