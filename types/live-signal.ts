// =============================================================================
// Live signal: wire format of the broker's public live file (plan L5) and the
// client-side snapshot the shared store hands to consumers.
// =============================================================================

/** Lease tier. `aim` samples at 200 ms, `watch` at 1 s. */
export type LiveTier = "aim" | "watch";

export type LiveQmiState = "up" | "down" | "unavailable";

/** One secondary carrier. `ca` lists SCCs only; the serving cell is on the sample. */
export interface LiveCaCarrier {
  band: string | null;
  earfcn: number | null;
  pci: number | null;
  bw: number | null;
  active: boolean;
}

/**
 * One broker sample. Signal values are integers x10 (-955 = -95.5 dB); use
 * `sampleDb` for dB numbers. Any serving field is null when unregistered or
 * while a scan is running.
 */
export interface LiveSample {
  seq: number;
  /** Boot-clock ms on the modem. Not comparable to the browser clock. */
  t: number;
  reg: boolean | null;
  rsrp: number | null;
  rsrq: number | null;
  rssi: number | null;
  pci: number | null;
  earfcn: number | null;
  band: string | null;
  bw: number | null;
  ca: LiveCaCarrier[] | null;
}

/** The live file as served at `/qmlive/<token>.json`. */
export interface LiveFile {
  v: 1;
  /** Daemon start (boot ms). A changed value means the broker restarted. */
  run: number;
  seq: number;
  period_ms: number;
  qmi_state: LiveQmiState;
  ssr_count: number;
  scan: boolean;
  samples: LiveSample[];
}

/** Lease CGI answer, normalised by the transport in the hook. */
export type LiveLeaseResult =
  | {
      kind: "ok";
      url: string;
      periodMs: number;
      renewS: number;
    }
  | { kind: "unavailable" }
  | { kind: "error"; code?: string };

export type LiveSignalState =
  | "connecting"
  | "live"
  | "stale"
  | "paused"
  | "unavailable";

export interface LiveSignalSnapshot {
  state: LiveSignalState;
  /** Newest sample in the ring, or null before the first one. */
  latest: LiveSample | null;
  /** Oldest to newest, at most 150 samples. A new array whenever samples change. */
  samples: readonly LiveSample[];
  /** Browser ms when the newest sample landed; null before the first. */
  receivedAtMs: number | null;
  qmiState: LiveQmiState | null;
  scan: boolean;
  ssrCount: number;
  /** Cadence the broker reports for the file (not the lease). */
  periodMs: number | null;
}

/** dB view of a sample's x10 integers, one decimal at most. */
export interface LiveSampleDb {
  rsrp: number | null;
  rsrq: number | null;
  rssi: number | null;
}

const toDb = (x10: number | null): number | null =>
  x10 === null || !Number.isFinite(x10) ? null : Math.round(x10) / 10;

export function sampleDb(sample: LiveSample): LiveSampleDb {
  return {
    rsrp: toDb(sample.rsrp),
    rsrq: toDb(sample.rsrq),
    rssi: toDb(sample.rssi),
  };
}
