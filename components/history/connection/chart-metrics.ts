// =============================================================================
// Connection History: chart definitions and data helpers
// =============================================================================
// Pure data and functions (no JSX) shared by the four metric charts. Unlike a
// signal chart, a connection metric has no natural range, so the y top is
// derived: the 95th percentile with headroom, never below the metric's floor or
// the user's limit, snapped to a round number so the axis ticks read cleanly.
// =============================================================================

import { HISTORY_RANGES } from "@/types/history";

import type {
  ConnectionHistory,
  ConnectionLimits,
  ConnectionMetric,
} from "./types";

export type ChartId = "latency" | "loss" | "jitter" | "dns";

export interface ChartSpec {
  id: ChartId;
  metric: ConnectionMetric;
  unit: "ms" | "%";
  kind: "line" | "bars";
  /** The y top is never lower than this, so a quiet link does not look wild. */
  floor: number;
  /** Which user limit is drawn as the dashed line, if any. */
  limit: "latency" | "loss" | null;
}

/** Card order: the 2x2 grid reads Latency Packet loss / Jitter DNS lookup. */
export const CHART_SPECS: readonly ChartSpec[] = [
  { id: "latency", metric: "lat_ms", unit: "ms", kind: "line", floor: 300, limit: "latency" },
  { id: "loss", metric: "loss_pct", unit: "%", kind: "bars", floor: 40, limit: "loss" },
  { id: "jitter", metric: "jit_ms", unit: "ms", kind: "line", floor: 20, limit: null },
  { id: "dns", metric: "dns_ms", unit: "ms", kind: "line", floor: 60, limit: null },
];

export function limitFor(spec: ChartSpec, limits: ConnectionLimits): number | null {
  if (spec.limit === "latency") return limits.latencyMs;
  if (spec.limit === "loss") return limits.lossPct;
  return null;
}

const NICE = [20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000];

/** The smallest round number at or above `value`. */
export function niceCeil(value: number): number {
  for (const n of NICE) if (value <= n) return n;
  return Math.ceil(value / 500) * 500;
}

/** A reading as the page writes it: whole milliseconds, loss with one decimal under 10. */
export function formatMetric(value: number | null, unit: "ms" | "%"): string {
  if (value === null) return "—";
  if (unit === "%") return value < 10 ? value.toFixed(1) : String(Math.round(value));
  return String(Math.round(value));
}

export interface ChartScale {
  /** Top of the y axis; the bottom is always 0. */
  top: number;
  /** 0, half, top. */
  ticks: number[];
}

export function chartScale(
  history: ConnectionHistory,
  spec: ChartSpec,
  limit: number | null,
): ChartScale {
  const values = history.buckets
    .map((b) => b.m[spec.metric]?.avg)
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);
  const p95 = values.length > 0 ? values[Math.floor(values.length * 0.95)] : 0;
  const top = niceCeil(Math.max(p95 * 1.25, spec.floor, limit !== null ? limit * 1.2 : 0));
  return { top, ticks: [0, Math.round(top / 2), top] };
}

// --- Chart points ------------------------------------------------------------

export type PointState = "ok" | "down" | "nodata";

export interface ChartPoint {
  /** Bucket centre, epoch seconds: where the point is plotted. */
  t: number;
  start: number;
  /** End of the covered part of the bucket (the current bucket is partial). */
  end: number;
  /** Plot value, clamped into the axis; null breaks the line and draws no bar. */
  v: number | null;
  /** The bucket average as measured, for readouts and tooltips. */
  raw: number | null;
  /** The bucket's worst reading. */
  peak: number | null;
  /** Seconds of outage inside the bucket. */
  downSec: number;
  state: PointState;
}

/**
 * One point per bucket. A bucket that spent half its recorded time down plots as
 * null so the line breaks there instead of bridging an outage with an invented
 * slope; the outage band marks it instead.
 */
export function buildChartPoints(
  history: ConnectionHistory,
  spec: ChartSpec,
  top: number,
): ChartPoint[] {
  const { bucketSec } = HISTORY_RANGES[history.range];
  return history.buckets.map((b) => {
    const up = b.st.up ?? 0;
    const down = b.st.down ?? 0;
    const mostlyDown = down > 0 && down >= (up + down) / 2;
    const stat = b.m[spec.metric];
    const raw = stat?.avg ?? null;
    const state: PointState = raw === null ? (down > 0 ? "down" : "nodata") : "ok";
    return {
      t: b.t + bucketSec / 2,
      start: b.t,
      end: b.t + b.len,
      v: raw === null || mostlyDown ? null : Math.min(top, raw),
      raw,
      peak: stat?.max ?? null,
      downSec: down,
      state,
    };
  });
}

export interface OutageBand {
  /** Fractions of the plot width, 0..1. */
  from: number;
  to: number;
}

/**
 * Runs of buckets with an outage in them, as fractions of the window. Buckets
 * before collection began are not gaps, so a fresh install is not painted as one
 * long outage.
 */
export function buildOutageBands(history: ConnectionHistory): OutageBand[] {
  const { buckets, since } = history;
  if (!history.clock_trusted || since === null || buckets.length === 0) return [];
  const { bucketSec } = HISTORY_RANGES[history.range];
  const n = buckets.length;
  const bands: OutageBand[] = [];
  buckets.forEach((b, i) => {
    if (b.t + bucketSec <= since) return;
    if ((b.st.down ?? 0) <= 0 && b.x <= 0) return;
    const from = i / n;
    const to = (i + 1) / n;
    const prev = bands[bands.length - 1];
    if (prev && prev.to === from) prev.to = to;
    else bands.push({ from, to });
  });
  return bands;
}

/** Buckets that carry a reading for this metric. */
export function countReadingBuckets(points: readonly ChartPoint[]): number {
  return points.reduce((n, p) => (p.raw !== null ? n + 1 : n), 0);
}

/**
 * The readout when nothing is hovered: the newest reading among the last two
 * buckets. The newest bucket is partial and can be seconds old, so looking one
 * further back stops the figure flashing to a dash at every bucket boundary.
 */
export function latestPoint(points: readonly ChartPoint[]): ChartPoint | null {
  for (let i = points.length - 1; i >= Math.max(0, points.length - 2); i--) {
    if (points[i].state === "ok") return points[i];
  }
  return points.length > 0 ? points[points.length - 1] : null;
}
