import { describe, it, expect } from "bun:test";
import {
  deriveConnectionLabel,
  formatCarrierComponents,
  formatUptime,
} from "./format";

describe("deriveConnectionLabel", () => {
  it("returns 'connected' when LTE state is connected", () => {
    expect(deriveConnectionLabel("connected", "disconnected")).toBe("connected");
  });

  it("returns 'connected' when NR state is connected (SA)", () => {
    expect(deriveConnectionLabel("disconnected", "connected")).toBe("connected");
  });

  it("returns 'connected' when both are connected (NSA)", () => {
    expect(deriveConnectionLabel("connected", "connected")).toBe("connected");
  });

  it("returns 'searching' when either state is searching and neither is connected", () => {
    expect(deriveConnectionLabel("searching", "disconnected")).toBe("searching");
    expect(deriveConnectionLabel("disconnected", "searching")).toBe("searching");
  });

  it("returns 'limited' when either state is limited and neither is connected/searching", () => {
    expect(deriveConnectionLabel("limited", "disconnected")).toBe("limited");
    expect(deriveConnectionLabel("disconnected", "limited")).toBe("limited");
  });

  it("returns 'inactive' when either state is inactive and neither is connected/searching/limited", () => {
    expect(deriveConnectionLabel("inactive", "disconnected")).toBe("inactive");
    expect(deriveConnectionLabel("inactive", "unknown")).toBe("inactive");
  });

  it("returns 'disconnected' for the all-disconnected fallback", () => {
    expect(deriveConnectionLabel("disconnected", "disconnected")).toBe("disconnected");
  });

  it("returns 'unknown' for two unknowns", () => {
    expect(deriveConnectionLabel("unknown", "unknown")).toBe("unknown");
  });

  it("returns 'error' when either side errored and nothing better is true", () => {
    expect(deriveConnectionLabel("error", "disconnected")).toBe("error");
  });
});

describe("formatCarrierComponents", () => {
  it("returns an empty array for empty input", () => {
    expect(formatCarrierComponents([])).toEqual([]);
  });

  it("flattens a fully-populated component", () => {
    expect(
      formatCarrierComponents([{ band: "B3", bandwidth_mhz: 15, pci: 42 }]),
    ).toEqual([{ band: "B3", bandwidth: 15, pci: 42 }]);
  });

  it("preserves order across multiple components (PCC first)", () => {
    expect(
      formatCarrierComponents([
        { band: "B3", bandwidth_mhz: 15, pci: 42 },
        { band: "B1", bandwidth_mhz: 10, pci: 7 },
      ]),
    ).toEqual([
      { band: "B3", bandwidth: 15, pci: 42 },
      { band: "B1", bandwidth: 10, pci: 7 },
    ]);
  });

  it("nulls pci when missing", () => {
    expect(
      formatCarrierComponents([{ band: "B3", bandwidth_mhz: 15, pci: null }]),
    ).toEqual([{ band: "B3", bandwidth: 15, pci: null }]);
  });

  it("nulls bandwidth when 0", () => {
    expect(
      formatCarrierComponents([{ band: "B3", bandwidth_mhz: 0, pci: 42 }]),
    ).toEqual([{ band: "B3", bandwidth: null, pci: 42 }]);
  });

  it("nulls both when only the band label is present", () => {
    expect(
      formatCarrierComponents([{ band: "B3", bandwidth_mhz: 0, pci: null }]),
    ).toEqual([{ band: "B3", bandwidth: null, pci: null }]);
  });

  it("filters out entries with empty band string", () => {
    expect(
      formatCarrierComponents([
        { band: "B3", bandwidth_mhz: 15, pci: 42 },
        { band: "", bandwidth_mhz: 10, pci: 7 },
      ]),
    ).toEqual([{ band: "B3", bandwidth: 15, pci: 42 }]);
  });

  it("treats non-finite bandwidth as missing", () => {
    expect(
      formatCarrierComponents([{ band: "B3", bandwidth_mhz: NaN, pci: 42 }]),
    ).toEqual([{ band: "B3", bandwidth: null, pci: 42 }]);
  });

  it("preserves pci 0 (not treated as missing)", () => {
    expect(
      formatCarrierComponents([{ band: "B3", bandwidth_mhz: 15, pci: 0 }]),
    ).toEqual([{ band: "B3", bandwidth: 15, pci: 0 }]);
  });

  it("mixed CA: one full + one bandwidth-less", () => {
    expect(
      formatCarrierComponents([
        { band: "B3", bandwidth_mhz: 15, pci: 42 },
        { band: "B1", bandwidth_mhz: 0, pci: 7 },
      ]),
    ).toEqual([
      { band: "B3", bandwidth: 15, pci: 42 },
      { band: "B1", bandwidth: null, pci: 7 },
    ]);
  });
});

describe("formatUptime", () => {
  it("formats >= 1 day as '<d>d <h>h'", () => {
    const seconds = 3 * 86400 + 14 * 3600 + 7 * 60;
    expect(formatUptime(seconds)).toEqual({ key: "days", days: 3, hours: 14 });
  });

  it("formats >= 1 hour, < 1 day as '<h>h <m>m'", () => {
    const seconds = 5 * 3600 + 23 * 60;
    expect(formatUptime(seconds)).toEqual({ key: "hours", hours: 5, minutes: 23 });
  });

  it("formats < 1 hour as '<m>m'", () => {
    expect(formatUptime(42 * 60)).toEqual({ key: "minutes", minutes: 42 });
  });

  it("formats 0 as '0m'", () => {
    expect(formatUptime(0)).toEqual({ key: "minutes", minutes: 0 });
  });

  it("treats negative or non-finite values as 0", () => {
    expect(formatUptime(-100)).toEqual({ key: "minutes", minutes: 0 });
    expect(formatUptime(NaN)).toEqual({ key: "minutes", minutes: 0 });
  });

  it("truncates sub-minute seconds at the day boundary (86399s stays in hours bucket)", () => {
    const seconds = 23 * 3600 + 59 * 60 + 59;
    expect(formatUptime(seconds)).toEqual({ key: "hours", hours: 23, minutes: 59 });
  });

  it("promotes exactly 86400s to the days bucket", () => {
    expect(formatUptime(86400)).toEqual({ key: "days", days: 1, hours: 0 });
  });

  it("promotes exactly 3600s to the hours bucket", () => {
    expect(formatUptime(3600)).toEqual({ key: "hours", hours: 1, minutes: 0 });
  });
});
