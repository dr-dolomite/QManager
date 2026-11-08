// types/config-backup.ts

/** Canonical section keys. Order matters for apply sequence. */
export type BackupSectionKey =
  | "sms_alerts"
  | "alert_routing"
  | "sms_storage"
  | "connection_quality"
  | "sites"
  | "metrics"
  | "watchdog"
  | "network_mode_apn"
  | "bands"
  | "tower_lock"
  | "ttl_hl"
  | "imei"
  | "profiles";

/** Overlap group used by the mutual-disable logic in the backup card */
export type OverlapGroup = "profile" | "profile-parent" | null;

/** The two groups the section picker is split into (labels via i18n). */
export type BackupSectionGroup = "connection" | "monitoring";

/** Metadata describing one section in the UI. Labels live in the
 *  `system-settings` catalog under `config_backup.sections.<key>`. */
export interface BackupSectionMeta {
  key: BackupSectionKey;
  group: BackupSectionGroup;
  overlapGroup: OverlapGroup;
  defaultChecked: boolean;
}

/** Header fields of a backup envelope (NOT encrypted, but bound as AAD) */
export interface BackupEnvelopeHeader {
  magic: "QMBACKUP";
  version: 1;
  created_at: string; // ISO 8601
  device: {
    model: string;
    firmware: string;
    imei: string;
    qmanager_version: string;
  };
  sections_included: BackupSectionKey[];
}

/** Full envelope (header + KDF/cipher parameters + ciphertext) */
export interface BackupEnvelope extends BackupEnvelopeHeader {
  kdf: {
    algo: "PBKDF2-SHA256";
    iter: number;
    salt: string; // base64
  };
  cipher: {
    algo: "AES-256-GCM";
    iv: string;          // base64, 12 bytes
    ciphertext: string;  // base64, includes 16-byte GCM tag appended
  };
}

/** Plaintext payload shape (what gets encrypted) */
export interface BackupPayload {
  schema: 1;
  sections: Partial<Record<BackupSectionKey, unknown>>;
}

/** Per-section status during a restore run */
export type SectionStatus =
  | "pending"
  | "running"
  | `retrying:${number}`
  | "success"
  | "failed"
  | "skipped:incompatible"
  | "skipped:not_in_backup"
  | "skipped:sim_mismatch";

/** One row in the restore progress file */
export interface SectionProgress {
  key: BackupSectionKey;
  status: SectionStatus;
  attempts: number;
  message?: string;
  started_at?: number;
  completed_at?: number;
}

/** Full progress file written by the worker */
export interface RestoreProgress {
  job_id: string;
  status: "idle" | "running" | "done" | "cancelled";
  started_at: number;
  completed_at?: number;
  sections: SectionProgress[];
  summary?: {
    success: number;
    failed: number;
    skipped: number;
  };
  /** True if any applied section queued an NVM/state change that requires
   *  a modem reboot to take effect (IMEI write, profile activation, etc.).
   *  Surfaced to the user as a "Reboot now or later" dialog post-restore. */
  reboot_required?: boolean;
}

/** Restore card state machine states */
export type RestoreUiState =
  | "idle"
  | "reading"
  | "password_required"
  | "password_incorrect"
  | "model_warning"
  | "ready"
  | "applying"
  | "success"
  | "partial_success"
  | "failed";

/** Error codes shared between layers */
export type BackupErrorCode =
  | "invalid_envelope"
  | "wrong_version"
  | "decrypt_failed"
  | "tampered_header"
  | "collect_failed"
  | "apply_failed"
  | "apply_unsupported"
  | "worker_crashed"
  | "restore_in_progress"
  | "invalid_json";
