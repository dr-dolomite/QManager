// lib/config-backup/sections.ts
import type { BackupSectionMeta, BackupSectionKey } from "@/types/config-backup";

export const BACKUP_SECTIONS: BackupSectionMeta[] = [
  // Connection: what the modem attaches with. Picker order, not apply order
  // (the worker owns that: CFG_BACKUP_APPLY_ORDER).
  { key: "network_mode_apn", group: "connection", overlapGroup: "profile", defaultChecked: true },
  { key: "bands", group: "connection", overlapGroup: null, defaultChecked: true },
  { key: "tower_lock", group: "connection", overlapGroup: null, defaultChecked: false },
  { key: "ttl_hl", group: "connection", overlapGroup: "profile", defaultChecked: false },
  { key: "imei", group: "connection", overlapGroup: "profile", defaultChecked: false },
  { key: "profiles", group: "connection", overlapGroup: "profile-parent", defaultChecked: false },
  // Monitoring and alerts: how QManager watches the link and who it tells.
  { key: "watchdog", group: "monitoring", overlapGroup: null, defaultChecked: false },
  { key: "connection_quality", group: "monitoring", overlapGroup: null, defaultChecked: false },
  { key: "sites", group: "monitoring", overlapGroup: null, defaultChecked: false },
  { key: "metrics", group: "monitoring", overlapGroup: null, defaultChecked: false },
  { key: "sms_alerts", group: "monitoring", overlapGroup: null, defaultChecked: false },
  { key: "sms_storage", group: "monitoring", overlapGroup: null, defaultChecked: false },
  { key: "alert_routing", group: "monitoring", overlapGroup: null, defaultChecked: false },
];

export type SelectionMap = Record<BackupSectionKey, boolean>;

const PROFILE_MEMBERS: BackupSectionKey[] = ["network_mode_apn", "ttl_hl", "imei"];

/**
 * Returns the set of section keys that should be UI-disabled given the current
 * selection. Implements the profile overlap rule: checking "profiles" disables
 * the three sections it covers, and checking any of those disables "profiles".
 *
 * Caller contract: the UI is responsible for treating checked + disabled as
 * effectively unchecked (i.e. render `checked={selection[key] && !disabled.has(key)}`).
 * This function does not mutate the selection.
 */
export function computeDisabledKeys(selection: SelectionMap): Set<BackupSectionKey> {
  const disabled = new Set<BackupSectionKey>();
  if (selection.profiles) {
    for (const m of PROFILE_MEMBERS) disabled.add(m);
  }
  if (PROFILE_MEMBERS.some((m) => selection[m])) {
    disabled.add("profiles");
  }
  return disabled;
}

export function initialSelection(): SelectionMap {
  const sel = {} as SelectionMap;
  for (const s of BACKUP_SECTIONS) sel[s.key] = s.defaultChecked;
  return sel;
}

export function selectedKeys(selection: SelectionMap): BackupSectionKey[] {
  return BACKUP_SECTIONS.map((s) => s.key).filter((k) => selection[k]);
}
