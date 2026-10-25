// =============================================================================
// Live signal: wire format of the broker's public live file (plan L5) and the
// client-side snapshot the shared store hands to consumers.
// =============================================================================

import { normalizeSignalValue } from "./modem-status";

/** Lease tier. Both sample at 1 s today (`aim`'s 200 ms was dropped). */
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
  /**
   * Broker 0.5.0+ (absent from older brokers). LTE SINR, and NR (NSA) from
   * Get Signal Info: `nr_rsrp` is the mean of the NR RX chains, not the
   * strongest chain the AT path reports.
   */
  sinr?: number | null;
  nr_rsrp?: number | null;
  nr_rsrq?: number | null;
  nr_sinr?: number | null;
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
  sinr: number | null;
  nrRsrp: number | null;
  nrRsrq: number | null;
  nrSinr: number | null;
}

const toDb = (x10: number | null | undefined): number | null =>
  x10 === null || x10 === undefined || !Number.isFinite(x10) ? null : Math.round(x10) / 10;

export function sampleDb(sample: LiveSample): LiveSampleDb {
  return {
    rsrp: toDb(sample.rsrp),
    rsrq: toDb(sample.rsrq),
    rssi: toDb(sample.rssi),
    sinr: toDb(sample.sinr),
    nrRsrp: toDb(sample.nr_rsrp),
    nrRsrq: toDb(sample.nr_rsrq),
    nrSinr: toDb(sample.nr_sinr),
  };
}

/** LTE serving values of a live sample, in dB, as the dashboard overlays them. */
export interface LiveLteDb {
  rsrp: number | null;
  rsrq: number | null;
  rssi: number | null;
  sinr: number | null;
}

/**
 * RSRP/RSRQ keep the AT sentinel table. SINR does not: `-20` is the per-port
 * `AT+QSINR` "idle chain" sentinel, but the broker already drops QMI's own
 * invalid value and gates the range, so a live `-20.0` dB is a real reading.
 */
export function liveLteDb(sample: LiveSample): LiveLteDb {
  const db = sampleDb(sample);
  return {
    rsrp: normalizeSignalValue(db.rsrp, "rsrp"),
    rsrq: normalizeSignalValue(db.rsrq, "rsrq"),
    rssi: db.rssi,
    sinr: db.sinr,
  };
}
