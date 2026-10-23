// =============================================================================
// data-used.ts: types for the Data Used counter and the storage CGI
// =============================================================================
// Mirrors network/data_used.sh, network/data_used_reset.sh and
// system/storage.sh (docs/features/data-used.md).
// =============================================================================

/** GET network/data_used.sh. `available` is false before the first sample. */
export type DataUsedResponse =
  | { success: true; available: false }
  | {
      success: true;
      available: true;
      /** Download bytes since the last reset. */
      rx_bytes: number;
      /** Upload bytes since the last reset. */
      tx_bytes: number;
      /** Epoch seconds of the last reset; 0 when the clock read 1970. */
      since: number;
      /** Epoch seconds of the last sample; 0 when the clock read 1970. */
      updated: number;
      /** False while the cellular netdev is missing (counting paused). */
      iface_present: boolean;
      /** The counter has not been refreshed for 90 s (sampler stopped). */
      stale: boolean;
      /**
       * Where the last sample came from: `wds` is the modem's own per-call
       * counter (QMI WDS packet statistics, complete); `netdev` is the
       * rmnet_ipa0 fallback, which misses hardware-offloaded LAN traffic.
       * Absent from older backends, read as `netdev`.
       */
      source?: DataUsedSource;
    };

export type DataUsedSource = "wds" | "netdev";

export interface DataUsed {
  rxBytes: number;
  txBytes: number;
  /** Epoch seconds, or null when unknown. */
  since: number | null;
  stale: boolean;
  source: DataUsedSource;
}

/** Result of a reset: the backend error code on failure, for the toast. */
export interface DataUsedResetResult {
  success: boolean;
  error?: string;
  detail?: string;
}

/** GET system/storage.sh */
export interface StorageResponse {
  success: boolean;
  storage: {
    mount: string;
    total_kb: number;
    used_kb: number;
    available_kb: number;
  } | null;
}
