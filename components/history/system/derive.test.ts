// Run with: bun test components/history/system
import { describe, expect, it } from "bun:test";

import type { HistoryEvent } from "@/types/history";
import { parseRebootMessage, parseThermalParts, type SystemBucket } from "@/types/system-history";

import {
  coversRange,
  cpuSummary,
  deriveIncidents,
  laneCounts,
  latestTempC,
  storageReadings,
} from "./derive";
import { systemFixture } from "./mock-fixture";

const NOW = 1_800_000_700;

const bucket = (t: number, m: SystemBucket["m"] = {}, len = 1800): SystemBucket => ({
  t,
  len,
  st: {},
  x: 0,
  m,
});

const stat = (v: number, n = 1) => ({ n, avg: v, min: v, max: v });

const ev = (
  timestamp: number,
  type: HistoryEvent["type"],
  message: string,
  end?: number | null,
): HistoryEvent => ({
  timestamp,
  type,
  severity: "info",
  radio: null,
  message,
  ...(end !== undefined ? { end } : {}),
});

describe("parsers", () => {
  it("reads cause and off from a reboot row", () => {
    expect(parseRebootMessage("cause=update off=95")).toEqual({ cause: "update", offSec: 95 });
    expect(parseRebootMessage("cause=scheduled off=-")).toEqual({
      cause: "scheduled",
      offSec: null,
    });
  });

  it("falls back to an unexpected restart on junk", () => {
    expect(parseRebootMessage("")).toEqual({ cause: "unexpected", offSec: null });
    expect(parseRebootMessage("cause=meteor off=12x")).toEqual({
      cause: "unexpected",
      offSec: null,
    });
  });

  it("names the throttled parts, ignoring unknown ones and duplicates", () => {
    expect(parseThermalParts("Thermal throttling started (LTE, 5G)")).toEqual(["lte", "nr"]);
    expect(parseThermalParts("Thermal throttling started (5G, 5g, toaster)")).toEqual(["nr"]);
    expect(parseThermalParts("Thermal throttling started")).toEqual([]);
    expect(parseThermalParts("Thermal throttling started ()")).toEqual([]);
  });
});

describe("deriveIncidents", () => {
  const buckets = [
    bucket(NOW - 7200, { temp_c: stat(60) }),
    bucket(NOW - 5400, { temp_c: { n: 6, avg: 90, min: 70, max: 111 } }),
    bucket(NOW - 3600, { temp_c: stat(64) }),
    bucket(NOW - 1800, { temp_c: stat(50) }, 1800),
  ];

  it("starts a reboot at t minus the offline time", () => {
    const [r] = deriveIncidents(
      [ev(NOW - 1000, "device_reboot", "cause=update off=95")],
      buckets,
    );
    expect(r).toEqual({
      kind: "reboot",
      start: NOW - 1095,
      end: NOW - 1000,
      cause: "update",
      offSec: 95,
    });
  });

  it("keeps an unknown offline time as a zero-length span", () => {
    const [r] = deriveIncidents([ev(NOW - 1000, "device_reboot", "cause=user off=-")], buckets);
    expect(r).toMatchObject({ start: NOW - 1000, end: NOW - 1000, offSec: null });
  });

  it("pairs a crash with its recovery and drops the recovery row", () => {
    const out = deriveIncidents(
      [
        ev(NOW - 900, "modem_recovered", "Modem recovered"),
        ev(NOW - 940, "modem_crash", "Modem crashed", NOW - 900),
      ],
      buckets,
    );
    expect(out).toEqual([{ kind: "modem", start: NOW - 940, end: NOW - 900 }]);
  });

  it("leaves an unrecovered crash ongoing", () => {
    const [m] = deriveIncidents([ev(NOW - 25, "modem_crash", "x", null)], buckets);
    expect(m).toEqual({ kind: "modem", start: NOW - 25, end: null });
  });

  it("ends an unpaired crash at a later device restart", () => {
    const out = deriveIncidents(
      [
        ev(NOW - 500, "device_reboot", "cause=unexpected off=100"),
        ev(NOW - 900, "modem_crash", "x", null),
      ],
      buckets,
    );
    const modem = out.find((i) => i.kind === "modem");
    expect(modem).toEqual({ kind: "modem", start: NOW - 900, end: NOW - 600 });
    expect(laneCounts(out).modemOngoing).toBe(false);
  });

  it("ends a crash at a restart whose offline time is unknown", () => {
    const out = deriveIncidents(
      [ev(NOW - 500, "device_reboot", "cause=unexpected off=-"), ev(NOW - 900, "modem_crash", "x", null)],
      buckets,
    );
    expect(out.find((i) => i.kind === "modem")).toMatchObject({ end: NOW - 500 });
  });

  it("ignores a restart that came before the crash", () => {
    const out = deriveIncidents(
      [ev(NOW - 20, "modem_crash", "x", null), ev(NOW - 500, "device_reboot", "cause=user off=60")],
      buckets,
    );
    expect(out.find((i) => i.kind === "modem")).toEqual({ kind: "modem", start: NOW - 20, end: null });
  });

  it("lets only the newest unpaired crash stay ongoing", () => {
    const out = deriveIncidents(
      [ev(NOW - 20, "modem_crash", "x", null), ev(NOW - 300, "modem_crash", "x", null)],
      buckets,
    );
    expect(out).toEqual([
      { kind: "modem", start: NOW - 20, end: null },
      { kind: "modem", start: NOW - 300, end: NOW - 20 },
    ]);
  });

  it("takes the heat peak from the buckets under the span", () => {
    const [h] = deriveIncidents(
      [ev(NOW - 5000, "thermal_throttled", "Thermal throttling started (5G)", NOW - 4000)],
      buckets,
    );
    expect(h).toMatchObject({ kind: "heat", parts: ["nr"], peakC: 111, end: NOW - 4000 });
  });

  it("runs an ongoing heat span to the end of the window", () => {
    const [h] = deriveIncidents(
      [ev(NOW - 5000, "thermal_throttled", "Thermal throttling started (CPU)", null)],
      buckets,
    );
    expect(h).toMatchObject({ end: null, peakC: 111 });
  });

  it("reports no peak when no bucket under the span has a reading", () => {
    const [h] = deriveIncidents(
      [ev(NOW - 5000, "thermal_throttled", "Thermal throttling started", NOW - 4900)],
      [bucket(NOW - 7200), bucket(NOW - 5400), bucket(NOW - 3600)],
    );
    expect(h).toMatchObject({ parts: [], peakC: null });
  });

  it("returns newest first and drops stray recovery rows", () => {
    const out = deriveIncidents(
      [
        ev(NOW - 100, "thermal_recovered", "cleared"),
        ev(NOW - 1000, "device_reboot", "cause=scheduled off=80"),
        ev(NOW - 3000, "modem_crash", "x", NOW - 2960),
        ev(NOW - 2960, "modem_recovered", "y"),
      ],
      buckets,
    );
    expect(out.map((i) => i.kind)).toEqual(["reboot", "modem"]);
    expect(out[0].start).toBeGreaterThan(out[1].start);
  });

  it("keeps an incident that began before the window and reaches into it", () => {
    const winStart = buckets[0].t;
    const [r] = deriveIncidents(
      [ev(winStart + 20, "device_reboot", "cause=unexpected off=300")],
      buckets,
    );
    expect(r.start).toBeLessThan(winStart);
    expect(r.kind).toBe("reboot");
  });

  it("drops an incident that ended before the window", () => {
    const winStart = buckets[0].t;
    const out = deriveIncidents(
      [ev(winStart - 500, "modem_crash", "x", winStart - 460)],
      buckets,
    );
    expect(out).toEqual([]);
  });

  it("keeps everything when there are no buckets to bound the window", () => {
    const out = deriveIncidents([ev(NOW - 100, "modem_crash", "x", null)], []);
    expect(out).toHaveLength(1);
  });
});

describe("summaries", () => {
  it("counts lanes and flags what is still going", () => {
    const incidents = deriveIncidents(
      [
        ev(NOW - 10, "modem_crash", "x", null),
        ev(NOW - 500, "thermal_throttled", "Thermal throttling started (5G)", NOW - 400),
        ev(NOW - 900, "device_reboot", "cause=unexpected off=60"),
        ev(NOW - 1500, "device_reboot", "cause=user off=60"),
      ],
      [bucket(NOW - 1800, {}, 1800)],
    );
    expect(laneCounts(incidents)).toEqual({
      reboots: 2,
      unexpectedReboots: 1,
      modem: 1,
      heat: 1,
      modemOngoing: true,
      heatOngoing: false,
    });
  });

  it("weights the processor average by readings and finds the peak bucket", () => {
    const s = cpuSummary([
      bucket(0, { cpu: { n: 1, avg: 10, min: 10, max: 10 } }),
      bucket(1800, { cpu: { n: 3, avg: 20, min: 5, max: 56 } }),
      bucket(3600),
    ]);
    expect(s).toEqual({ avg: 17.5, peak: 56, peakAt: 1800 });
    expect(cpuSummary([bucket(0)])).toBeNull();
  });

  it("reads storage now and at the first reading, skipping unread buckets", () => {
    const m = (used: number) => ({
      st_sys_used: stat(used),
      st_sys_size: stat(100_000),
    });
    const out = storageReadings([bucket(0, m(60_000)), bucket(1800), bucket(3600, m(62_000))]);
    expect(out).toEqual([{ area: "sys", usedKiB: 62_000, sizeKiB: 100_000, startKiB: 60_000 }]);
    // A single reading has nothing to compare against.
    expect(storageReadings([bucket(0, m(60_000))])[0].startKiB).toBeNull();
    expect(storageReadings([bucket(0)])).toEqual([]);
  });

  it("finds the latest temperature", () => {
    expect(latestTempC([bucket(0, { temp_c: stat(50) }), bucket(1800)])).toBe(50);
    expect(latestTempC([bucket(0)])).toBeNull();
  });
});

describe("systemFixture", () => {
  for (const range of ["24h", "7d", "30d"] as const) {
    it(`shapes the ${range} response like the collector`, () => {
      const { history, events } = systemFixture(range, "healthy", NOW);
      const spec = { "24h": [48, 1800], "7d": [56, 10800], "30d": [60, 43200] }[range];
      expect(history.buckets).toHaveLength(spec[0]);
      expect(history.buckets.every((b) => b.t % spec[1] === 0)).toBe(true);
      const last = history.buckets[history.buckets.length - 1];
      expect(last.t + last.len).toBe(NOW);
      expect(last.len).toBeLessThanOrEqual(spec[1]);
      expect(events.events.every((e) => e.timestamp <= NOW)).toBe(true);
      expect(coversRange(history)).toBe(true);
    });
  }

  it("leaves st short where the device was off", () => {
    const { history } = systemFixture("30d", "healthy", NOW);
    expect(history.buckets.some((b) => b.len - ((b.st.normal ?? 0) + (b.st.throttled ?? 0)) > 60)).toBe(
      true,
    );
  });

  it("gives storage to only some buckets", () => {
    const { history } = systemFixture("24h", "healthy", NOW);
    const withStorage = history.buckets.filter((b) => b.m.st_sys_used).length;
    expect(withStorage).toBeGreaterThan(0);
    expect(withStorage).toBeLessThan(history.buckets.length);
  });

  it("derives the story's incidents from its own rows", () => {
    const { history, events } = systemFixture("30d", "healthy", NOW);
    const inc = deriveIncidents(events.events, history.buckets);
    const c = laneCounts(inc);
    expect(c.reboots).toBe(8);
    expect(c.modem).toBe(8);
    expect(c.heat).toBe(4);
    expect(c.modemOngoing || c.heatOngoing).toBe(false);
    expect(inc.find((i) => i.kind === "heat")).toMatchObject({ peakC: expect.any(Number) });
  });

  it("starts a modem crash that is still going", () => {
    const { history, events } = systemFixture("24h", "modem", NOW);
    const c = laneCounts(deriveIncidents(events.events, history.buckets));
    expect(c.modemOngoing).toBe(true);
  });

  it("reports throttling now in the hot scenario", () => {
    const { history, events, status } = systemFixture("24h", "hot", NOW);
    expect(laneCounts(deriveIncidents(events.events, history.buckets)).heatOngoing).toBe(true);
    expect(status.thermal.throttling).toBe(true);
    expect(status.thermal.parts).toEqual(["nr"]);
  });

  it("fills the system area in the storage scenario", () => {
    const { history } = systemFixture("7d", "storage", NOW);
    const sys = storageReadings(history.buckets).find((r) => r.area === "sys");
    expect(sys && Math.round((sys.usedKiB / sys.sizeKiB) * 100)).toBe(94);
  });

  it("has no events and little data on a fresh install", () => {
    const { history, events } = systemFixture("24h", "fresh", NOW);
    expect(events.events).toEqual([]);
    expect(coversRange(history)).toBe(false);
    expect(history.buckets.filter((b) => b.m.cpu)).toHaveLength(2);
  });
});
