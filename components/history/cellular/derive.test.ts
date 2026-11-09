// Run with: bun test components/history/cellular/derive.test.ts
import { describe, expect, it } from "bun:test";

import type { CellularBucket, CellularHistory } from "@/types/history";

import { bucketDurations, bucketIndexAt, bucketKind, collectingSince, summarise } from "./derive";

const bucket = (over: Partial<CellularBucket> & { st?: CellularBucket["st"] }): CellularBucket => ({
  t: 0,
  len: 1800,
  st: {},
  x: 0,
  m: {},
  ...over,
});

const history = (buckets: CellularBucket[], since: number | null = 0): CellularHistory => ({
  success: true,
  series: "cellular",
  range: "24h",
  bucket_sec: 1800,
  now: 100000,
  clock_trusted: true,
  since,
  states: ["nr", "lte", "down", "off"],
  fault: ["down"],
  metrics: [],
  current: null,
  last_fault: null,
  buckets,
});

describe("bucketKind", () => {
  it("majority radio wins", () => {
    expect(bucketKind(bucket({ st: { nr: 1000, lte: 700 } }))).toBe("nr");
    expect(bucketKind(bucket({ st: { nr: 200, lte: 1500 } }))).toBe("lte");
  });
  it("any outage wins, by x or by down seconds", () => {
    expect(bucketKind(bucket({ st: { nr: 1700, down: 20 } }))).toBe("down");
    expect(bucketKind(bucket({ st: { nr: 1800 }, x: 1 }))).toBe("down");
  });
  it("no coverage, off and barely seen buckets are no data", () => {
    expect(bucketKind(bucket({}))).toBe("nodata");
    expect(bucketKind(bucket({ st: { off: 1800 } }))).toBe("nodata");
    expect(bucketKind(bucket({ st: { nr: 400 } }))).toBe("nodata");
  });
  it("coverage counts from when collecting began", () => {
    const b = bucket({ t: 0, len: 9504, st: { nr: 1094 } });
    expect(bucketKind(b)).toBe("nodata");
    expect(bucketKind(b, 8400)).toBe("nr");
    expect(bucketKind(b, 0)).toBe("nodata");
    expect(bucketKind(b, 20000)).toBe("nodata");
  });
});

describe("bucketDurations", () => {
  it("no data is the uncovered part", () => {
    expect(bucketDurations(bucket({ st: { nr: 600, lte: 300, down: 100 } }))).toEqual({
      nr: 600,
      lte: 300,
      down: 100,
      nodata: 800,
    });
  });
});

describe("summarise", () => {
  it("availability excludes no data and floors below 100 when an outage exists", () => {
    const s = summarise(
      history([bucket({ st: { nr: 1700, down: 100 }, x: 1 }), bucket({ st: { lte: 1800 } })]),
    );
    expect(s.outages).toBe(1);
    expect(s.availability).toBeCloseTo(97.22, 2);
    expect(s.nrShare).toBeCloseTo((1700 / 3500) * 100, 5);
    expect(s.lteOnly).toBe(false);
  });
  it("never reads 100 with an outage in the range", () => {
    const s = summarise(history([bucket({ st: { nr: 1_000_000, down: 1 }, x: 1 })]));
    expect(s.availability).toBe(99.99);
  });
  it("is null with nothing observed and lteOnly without NR", () => {
    const s = summarise(history([bucket({})]));
    expect(s.availability).toBeNull();
    expect(s.nrShare).toBeNull();
    expect(summarise(history([bucket({ st: { lte: 900 } })])).lteOnly).toBe(true);
  });
});

describe("bucketIndexAt and collectingSince", () => {
  const buckets = [bucket({ t: 0 }), bucket({ t: 1800 }), bucket({ t: 3600 })];
  it("finds the containing bucket, clamped", () => {
    expect(bucketIndexAt(buckets, 2000)).toBe(1);
    expect(bucketIndexAt(buckets, -5)).toBe(0);
    expect(bucketIndexAt(buckets, 99999)).toBe(2);
    expect(bucketIndexAt([], 1)).toBe(-1);
  });
  it("reports collecting only when history starts inside the window", () => {
    expect(collectingSince(history(buckets, -100))).toBeNull();
    expect(collectingSince(history(buckets, 2500))).toBe(2500);
    expect(collectingSince(history(buckets, null))).toBeNull();
  });
});
