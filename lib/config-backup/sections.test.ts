// lib/config-backup/sections.test.ts
import { describe, it, expect } from "bun:test";
import { BACKUP_SECTIONS, computeDisabledKeys } from "./sections";
import type { BackupSectionKey } from "@/types/config-backup";

describe("sections", () => {
  it("profiles checked disables overlap group", () => {
    const d = computeDisabledKeys({
      profiles: true,
      network_mode_apn: false,
      ttl_hl: false,
      imei: false,
      sms_alerts: false,
      watchdog: false,
      alert_routing: false,
      connection_quality: false,
      sites: false,
      metrics: false,
      sms_storage: false,
      bands: false,
      tower_lock: false,
    });
    expect(d.has("network_mode_apn")).toBe(true);
    expect(d.has("ttl_hl")).toBe(true);
    expect(d.has("imei")).toBe(true);
    expect(d.has("bands")).toBe(false);
  });

  it("overlap member checked disables profiles", () => {
    const d = computeDisabledKeys({
      profiles: false,
      network_mode_apn: true,
      ttl_hl: false,
      imei: false,
      sms_alerts: false,
      watchdog: false,
      alert_routing: false,
      connection_quality: false,
      sites: false,
      metrics: false,
      sms_storage: false,
      bands: false,
      tower_lock: false,
    });
    expect(d.has("profiles")).toBe(true);
    expect(d.has("network_mode_apn")).toBe(false);
  });

  it("BACKUP_SECTIONS contains all 12 expected keys", () => {
    const expected: BackupSectionKey[] = [
      "sms_alerts",
      "alert_routing",
      "connection_quality",
      "sites",
      "metrics",
      "sms_storage",
      "watchdog",
      "network_mode_apn",
      "bands",
      "tower_lock",
      "ttl_hl",
      "imei",
      "profiles",
    ];
    const actual = BACKUP_SECTIONS.map((s) => s.key).sort();
    expect(actual).toEqual([...expected].sort());
  });

  it("all four overlap keys checked → disabled set has all 4", () => {
    const d = computeDisabledKeys({
      profiles: true,
      network_mode_apn: true,
      ttl_hl: true,
      imei: true,
      sms_alerts: false,
      watchdog: false,
      alert_routing: false,
      connection_quality: false,
      sites: false,
      metrics: false,
      sms_storage: false,
      bands: false,
      tower_lock: false,
    });
    expect(d.has("profiles")).toBe(true);
    expect(d.has("network_mode_apn")).toBe(true);
    expect(d.has("ttl_hl")).toBe(true);
    expect(d.has("imei")).toBe(true);
  });
});
