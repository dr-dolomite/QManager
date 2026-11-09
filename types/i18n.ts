// types/i18n.ts
export type LanguageCode = string; // BCP-47 (e.g., "en", "zh-CN", "fr", "ar")

export type Namespace =
  | "common"
  | "sidebar"
  | "dashboard"
  | "cellular"
  | "local-network"
  | "monitoring"
  | "system-settings"
  | "onboarding"
  | "events"
  | "errors"
  | "at-commands"
  | "history";

export interface LanguageMeta {
  code: LanguageCode;
  native_name: string;
  english_name: string;
  rtl: boolean;
  bundled: boolean;
}

/**
 * Non-terminal install states the UI renders. The worker's own words
 * (`running` + a `start|fetch_catalog|...` step) are normalised into these by
 * `getLanguagePackInstallStatus`. `cancelling` is the transient state after a
 * cancel request is accepted but before the worker unwinds.
 */
export type LanguagePackInstallStep =
  | "pending"
  | "downloading"
  | "verifying"
  | "extracting"
  | "validating"
  | "installing"
  | "cancelling";

/** Terminal states the poller stops on. `idle` is the resting state. */
export type LanguagePackInstallTerminal = "done" | "cancelled" | "failed" | "idle";

export interface LanguagePackInstallState {
  state: LanguagePackInstallStep | LanguagePackInstallTerminal;
  code?: LanguageCode;
  progress: number; // 0..100
  /** Machine step key (== state while running); used for a stable label. */
  step?: string;
  /** Human fallback emitted by the worker, quoted as machine voice. */
  message?: string;
  /** A backend error code, kept unresolved so the UI can translate it. */
  error_code?: string;
}

export interface RemoteManifestEntry {
  code: LanguageCode;
  native_name: string;
  english_name: string;
  rtl: boolean;
  version: string;
  /** Oldest app release the pack was validated against; absent = compatible. */
  app_min_version?: string;
  completeness: number;
  size_bytes: number;
  sha256: string;
  url: string;
  contributors?: string[];
}

export interface RemoteManifest {
  manifest_version: 1;
  generated_at: string;
  packs: RemoteManifestEntry[];
}
