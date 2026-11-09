// =============================================================================
// Cellular History: signal metric definitions and chart data helpers
// =============================================================================
// Pure data and functions (no JSX) shared by the four signal charts. The y
// domains are fixed on purpose: a chart whose scale re-derives itself from the
// data would draw the same reading at a different height on every poll, and
// the four cards could never be compared by eye.
// =============================================================================

import type { CellularBucket, CellularHistory, CellularMetric } from "@/types/history";

export type SignalMetricId = "rsrp" | "sinr" | "rsrq" | "rssi";

export interface SignalMetricSpec {
  id: SignalMetricId;
  lte: CellularMetric;
  /** RSSI has no NR counterpart in the data, so its NR series never renders. */
  nr: CellularMetric | null;
  unit: "dBm" | "dB";
  domain: [number, number];
  ticks: number[];
  /** Decimal places in readouts. */
  decimals: 0 | 1;
}

/** Card order: the 2x2 grid reads RSRP SINR / RSRQ RSSI. */
export const SIGNAL_METRICS: readonly SignalMetricSpec[] = [
  {
    id: "rsrp",
    lte: "lte_rsrp",
    nr: "nr_rsrp",
    unit: "dBm",
    domain: [-140, -60],
    ticks: [-140, -120, -100, -80, -60],
    decimals: 0,
  },
  {
    id: "sinr",
    lte: "lte_sinr",
    nr: "nr_sinr",
    unit: "dB",
    domain: [-10, 30],
    ticks: [-10, 0, 10, 20, 30],
    decimals: 1,
  },
  {
    id: "rsrq",
    lte: "lte_rsrq",
    nr: "nr_rsrq",
    unit: "dB",
    domain: [-20, -3],
    ticks: [-20, -15, -10, -5],
    decimals: 0,
  },
  {
    id: "rssi",
    lte: "lte_rssi",
    nr: null,
    unit: "dBm",
    domain: [-110, -40],
    ticks: [-110, -90, -70, -50],
    decimals: 0,
  },
];

/** A reading with a true minus sign, so negative dBm figures align and read. */
export function formatReading(value: number | null, decimals: 0 | 1): string {
  if (value === null) return "—";
  const text = decimals === 0 ? String(Math.round(value)) : value.toFixed(1);
  return text.replace("-", "−");
}

// --- Chart points ------------------------------------------------------------

export type PointState = "ok" | "down" | "nodata";

export interface SignalPoint {
  /** Bucket centre, epoch seconds: where the point is plotted. */
  t: number;
  start: number;
  end: number;
  /** Plot values, clamped into the fixed domain; null breaks the line. */
  lte: number | null;
  nr: number | null;
  /** Readings as measured, for readouts and tooltips. */
  lteRaw: number | null;
  nrRaw: number | null;
  /** Seconds of service loss inside the bucket. */
  downSec: number;
  state: PointState;
}

function clamp(value: number, [lo, hi]: [number, number]): number {
  return Math.min(hi, Math.max(lo, value));
}

function coveredSeconds(b: CellularBucket): number {
  return Object.values(b.st).reduce((sum, v) => sum + (v ?? 0), 0);
}

/**
 * One point per bucket. A bucket with no reading, or one that spent half its
 * recorded time without service, plots as null so the line breaks there
 * instead of bridging an outage with a made-up slope.
 */
export function buildSignalPoints(
  history: CellularHistory,
  spec: SignalMetricSpec,
  lteOnly: boolean,
): SignalPoint[] {
  return history.buckets.map((b) => {
    const downSec = b.st.down ?? 0;
    const mostlyDown = downSec > 0 && downSec >= coveredSeconds(b) / 2;
    const lteRaw = b.m[spec.lte]?.avg ?? null;
    const nrRaw = lteOnly || !spec.nr ? null : (b.m[spec.nr]?.avg ?? null);
    const hasReading = lteRaw !== null || nrRaw !== null;
    const state: PointState = !hasReading
      ? downSec > 0
        ? "down"
        : "nodata"
      : "ok";
    return {
      t: b.t + b.len / 2,
      start: b.t,
      end: b.t + b.len,
      lte: lteRaw === null || mostlyDown ? null : clamp(lteRaw, spec.domain),
      nr: nrRaw === null || mostlyDown ? null : clamp(nrRaw, spec.domain),
      lteRaw,
      nrRaw,
      downSec,
      state,
    };
  });
}

export interface GapBand {
  x1: number;
  x2: number;
}

/**
 * Runs of buckets that were without service, or had no reading after
 * collection began. Buckets before `since` are not gaps: nothing was recorded
 * yet, and shading them would paint a fresh install as one long outage.
 */
export function buildGapBands(
  history: CellularHistory,
  points: readonly SignalPoint[],
): GapBand[] {
  if (!history.clock_trusted || history.since === null) return [];
  const since = history.since;
  const lastIndex = points.length - 1;
  const bands: GapBand[] = [];
  points.forEach((p, i) => {
    if (p.end <= since) return;
    const bucket = history.buckets[i];
    const barelyStarted = i === lastIndex && bucket.len < history.bucket_sec / 10;
    const gap =
      (p.downSec > 0 || bucket.x > 0 || p.state !== "ok") &&
      !(barelyStarted && p.state === "nodata");
    if (!gap) return;
    const prev = bands[bands.length - 1];
    if (prev && prev.x2 === p.start) prev.x2 = p.end;
    else bands.push({ x1: p.start, x2: p.end });
  });
  return bands;
}

/** Buckets that carry at least one reading for this metric. */
export function countReadingBuckets(points: readonly SignalPoint[]): number {
  return points.reduce((n, p) => (p.lteRaw !== null || p.nrRaw !== null ? n + 1 : n), 0);
}

/**
 * The readout when nothing is hovered: the newest reading among the last two
 * buckets. The newest bucket is partial and can be seconds old, so looking one
 * further back stops the figure flashing to a dash at every bucket boundary.
 */
export function latestPoint(points: readonly SignalPoint[]): SignalPoint | null {
  for (let i = points.length - 1; i >= Math.max(0, points.length - 2); i--) {
    if (points[i].state === "ok") return points[i];
  }
  return points.length > 0 ? points[points.length - 1] : null;
}
