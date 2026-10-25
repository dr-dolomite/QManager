import { describe, expect, it } from "bun:test";

import { liveLteDb, type LiveSample } from "./live-signal";

const sample = (over: Partial<LiveSample>): LiveSample => ({
  seq: 1,
  t: 1,
  reg: true,
  rsrp: -900,
  rsrq: -74,
  rssi: -628,
  sinr: 264,
  pci: 295,
  earfcn: 150,
  band: "B1",
  bw: 20,
  ca: null,
  ...over,
});

describe("liveLteDb", () => {
  it("converts x10 integers to dB", () => {
    expect(liveLteDb(sample({}))).toEqual({ rsrp: -90, rsrq: -7.4, rssi: -62.8, sinr: 26.4 });
  });

  it("keeps a genuine -20.0 dB SINR (the AT per-port sentinel does not apply)", () => {
    expect(liveLteDb(sample({ sinr: -200 })).sinr).toBe(-20);
  });

  it("still drops the RSRP floor sentinel and a missing SINR", () => {
    const db = liveLteDb(sample({ rsrp: -1400, sinr: undefined }));
    expect(db.rsrp).toBeNull();
    expect(db.sinr).toBeNull();
  });
});
