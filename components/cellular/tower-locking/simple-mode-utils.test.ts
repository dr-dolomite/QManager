import { describe, it, expect } from "bun:test";
import {
  lteCarriersFromQcainfo,
  nrCarriersFromQcainfo,
  defaultScsForBand,
  compositeValue,
  parseCompositeValue,
} from "./simple-mode-utils";
import type { CarrierComponent, ModemStatus } from "@/types/modem-status";

const lteCC = (overrides: Partial<CarrierComponent> = {}): CarrierComponent => ({
  type: "PCC",
  technology: "LTE",
  band: "B3",
  earfcn: 1850,
  bandwidth_mhz: 15,
  pci: 100,
  rsrp: -85,
  rsrq: -10,
  rssi: -65,
  sinr: 12,
  ...overrides,
});

const nrCC = (overrides: Partial<CarrierComponent> = {}): CarrierComponent => ({
  type: "PCC",
  technology: "NR",
  band: "N41",
  earfcn: 506700,
  bandwidth_mhz: 100,
  pci: 222,
  rsrp: -88,
  rsrq: -11,
  rssi: null,
  sinr: 14,
  ...overrides,
});

const modemWith = (carriers: CarrierComponent[]): Pick<ModemStatus, "network"> => ({
  network: { carrier_components: carriers } as ModemStatus["network"],
});

describe("lteCarriersFromQcainfo", () => {
  it("returns empty array for empty input", () => {
    expect(lteCarriersFromQcainfo(modemWith([]) as ModemStatus)).toEqual([]);
  });

  it("filters out non-LTE carriers", () => {
    const result = lteCarriersFromQcainfo(
      modemWith([lteCC(), nrCC()]) as ModemStatus,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.earfcn).toBe(1850);
  });

  it("drops carriers with null earfcn or pci", () => {
    const result = lteCarriersFromQcainfo(
      modemWith([
        lteCC({ earfcn: null }),
        lteCC({ pci: null }),
        lteCC({ earfcn: 1300, pci: 50 }),
      ]) as ModemStatus,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.earfcn).toBe(1300);
  });

  it("drops carriers with unparseable band", () => {
    const result = lteCarriersFromQcainfo(
      modemWith([lteCC({ band: "B?" })]) as ModemStatus,
    );
    expect(result).toEqual([]);
  });

  it("sorts PCC before SCC", () => {
    const result = lteCarriersFromQcainfo(
      modemWith([
        lteCC({ type: "SCC", earfcn: 41690, pci: 444 }),
        lteCC({ type: "PCC", earfcn: 1850, pci: 100 }),
      ]) as ModemStatus,
    );
    expect(result[0]?.type).toBe("PCC");
    expect(result[1]?.type).toBe("SCC");
  });

  it("preserves QCAINFO order within SCC group", () => {
    const result = lteCarriersFromQcainfo(
      modemWith([
        lteCC({ type: "PCC", earfcn: 1850, pci: 100 }),
        lteCC({ type: "SCC", earfcn: 41690, pci: 444 }),
        lteCC({ type: "SCC", earfcn: 6300, pci: 222 }),
      ]) as ModemStatus,
    );
    expect(result.map((c) => c.earfcn)).toEqual([1850, 41690, 6300]);
  });

  it("dedupes by composite earfcn:pci", () => {
    const result = lteCarriersFromQcainfo(
      modemWith([
        lteCC({ earfcn: 1850, pci: 100 }),
        lteCC({ earfcn: 1850, pci: 100, type: "SCC" }),
      ]) as ModemStatus,
    );
    expect(result).toHaveLength(1);
  });

  it("populates bandNumber from band string", () => {
    const result = lteCarriersFromQcainfo(
      modemWith([lteCC({ band: "B41" })]) as ModemStatus,
    );
    expect(result[0]?.bandNumber).toBe(41);
  });
});

describe("nrCarriersFromQcainfo", () => {
  it("filters non-NR carriers", () => {
    const result = nrCarriersFromQcainfo(
      modemWith([lteCC(), nrCC()]) as ModemStatus,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.bandNumber).toBe(41);
  });

  it("sorts PCC first", () => {
    const result = nrCarriersFromQcainfo(
      modemWith([
        nrCC({ type: "SCC", earfcn: 627264, pci: 333 }),
        nrCC({ type: "PCC" }),
      ]) as ModemStatus,
    );
    expect(result[0]?.type).toBe("PCC");
  });
});

describe("defaultScsForBand", () => {
  it("returns 15 for sub-3GHz FR1 bands", () => {
    expect(defaultScsForBand(1)).toBe(15);
    expect(defaultScsForBand(3)).toBe(15);
    expect(defaultScsForBand(5)).toBe(15);
    expect(defaultScsForBand(7)).toBe(15);
    expect(defaultScsForBand(20)).toBe(15);
    expect(defaultScsForBand(28)).toBe(15);
    expect(defaultScsForBand(66)).toBe(15);
    expect(defaultScsForBand(71)).toBe(15);
  });

  it("returns 30 for mid/high FR1 bands", () => {
    expect(defaultScsForBand(38)).toBe(30);
    expect(defaultScsForBand(40)).toBe(30);
    expect(defaultScsForBand(41)).toBe(30);
    expect(defaultScsForBand(77)).toBe(30);
    expect(defaultScsForBand(78)).toBe(30);
    expect(defaultScsForBand(79)).toBe(30);
  });

  it("returns 120 for FR2 bands", () => {
    expect(defaultScsForBand(257)).toBe(120);
    expect(defaultScsForBand(258)).toBe(120);
    expect(defaultScsForBand(260)).toBe(120);
    expect(defaultScsForBand(261)).toBe(120);
  });

  it("returns null for unknown band", () => {
    expect(defaultScsForBand(999)).toBeNull();
  });
});

describe("compositeValue / parseCompositeValue", () => {
  it("round-trips earfcn and pci", () => {
    expect(compositeValue(1850, 100)).toBe("1850:100");
    expect(parseCompositeValue("1850:100")).toEqual({ earfcn: 1850, pci: 100 });
  });

  it("returns null for malformed input", () => {
    expect(parseCompositeValue("foo")).toBeNull();
    expect(parseCompositeValue("1850")).toBeNull();
    expect(parseCompositeValue("1850:abc")).toBeNull();
    expect(parseCompositeValue("")).toBeNull();
  });

  it("returns null when either half is empty", () => {
    expect(parseCompositeValue(":100")).toBeNull();
    expect(parseCompositeValue("1850:")).toBeNull();
    expect(parseCompositeValue(":")).toBeNull();
  });
});

describe("nrCarriersFromQcainfo — FR2", () => {
  it("parses FR2 band numbers from NR carrier", () => {
    const result = nrCarriersFromQcainfo(
      modemWith([nrCC({ band: "N257", earfcn: 2070000, pci: 555 })]) as ModemStatus,
    );
    expect(result[0]?.bandNumber).toBe(257);
  });
});
