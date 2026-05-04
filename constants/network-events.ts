import type { NetworkEventType } from "@/types/modem-status";

/** Tab categories used by the monitoring Network Events card */
export type EventTabCategory = "bandChanges" | "dataConnection" | "networkMode";

/** Maps each NetworkEventType to its tab category */
export const EVENT_TAB_CATEGORIES: Record<NetworkEventType, EventTabCategory> =
  {
    band_change: "bandChanges",
    pci_change: "bandChanges",
    scc_pci_change: "bandChanges",
    nr_anchor: "bandChanges",
    ca_change: "bandChanges",
    network_mode: "networkMode",
    signal_lost: "networkMode",
    signal_restored: "networkMode",
    internet_lost: "dataConnection",
    internet_restored: "dataConnection",
    high_latency: "dataConnection",
    latency_recovered: "dataConnection",
    high_packet_loss: "dataConnection",
    packet_loss_recovered: "dataConnection",
    watchcat_recovery: "dataConnection",
    sim_failover: "dataConnection",
    sim_swap_detected: "dataConnection",
    airplane_mode: "networkMode",
    profile_applied: "dataConnection",
    profile_failed: "dataConnection",
    profile_deactivated: "dataConnection",
    verizon_mpdn_applied: "dataConnection",
    verizon_mpdn_reverted: "dataConnection",
    config_backup_collected: "dataConnection",
    config_restore_started: "dataConnection",
    config_restore_section_success: "dataConnection",
    config_restore_section_failed: "dataConnection",
    config_restore_section_skipped: "dataConnection",
    config_restore_completed: "dataConnection",
    wol_changed: "dataConnection",
  };
