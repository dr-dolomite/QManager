// =============================================================================
// imei-settings.ts — QManager IMEI Mangling Settings Types
// =============================================================================
// TypeScript interfaces for the IMEI Settings feature.
//
// Backend contract:
//   GET/POST /cgi-bin/quecmanager/cellular/imei.sh
// =============================================================================

// --- Backup IMEI Config -----------------------------------------------------

/** Backup IMEI configuration stored in /etc/qmanager/imei_backup.json */
export interface BackupImeiConfig {
  /** Whether backup IMEI auto-recovery is enabled */
  enabled: boolean;
  /** The 15-digit backup IMEI (empty string when not set) */
  imei: string;
}

// --- API Responses -----------------------------------------------------------

/** Response from GET /cgi-bin/quecmanager/cellular/imei.sh */
export interface ImeiSettingsResponse {
  success: boolean;
  /** Current IMEI from poller cache (empty string if not available yet) */
  current_imei: string;
  /** IMEI written since boot that takes effect at the next reboot (empty when none; absent on older backends) */
  pending_imei?: string;
  /** Backup IMEI configuration */
  backup: BackupImeiConfig;
  error?: string;
}

/** POST body for /cgi-bin/quecmanager/cellular/imei.sh */
export interface ImeiSaveRequest {
  /** "set_imei" to write new IMEI, "save_backup" to persist backup config, "reboot" to restart */
  action: "set_imei" | "save_backup" | "reboot";
  /** New IMEI — required when action is "set_imei" */
  imei?: string;
  /** Backup enabled flag — required when action is "save_backup" */
  enabled?: boolean;
  /** Backup IMEI — required when action is "save_backup" and enabled is true */
  backup_imei?: string;
}

/** Response from POST /cgi-bin/quecmanager/cellular/imei.sh */
export interface ImeiSaveResponse {
  success: boolean;
  error?: string;
  detail?: string;
  /** Whether a reboot is required for changes to take effect */
  reboot_required?: boolean;
}
