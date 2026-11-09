// =============================================================================
// System Health: metric chart definitions and pure data helpers
// =============================================================================
// No JSX. The y domains are fixed on purpose: a scale that re-derives itself
// from the data would draw the same reading at a different height on every
// poll, and the three cards could never be compared by eye.
// =============================================================================

import type {
  SystemHistory,
  SystemIncident,
  SystemMetric,
} from "@/types/system-history";

export type MetricKind = "cpu" | "mem" | "temp";

export interface MetricSpec {
  kind: MetricKind;
  metric: SystemMetric;
  domain: [number, number];
  ticks: number[];
  unit: "%" | "°C";
  /** Area washed with the stroke's own ink; temperature is a bare line. */
  area: boolean;
}

export const METRIC_SPECS: Record<MetricKind, MetricSpec> = {
  cpu: {
    kind: "cpu",
    metric: "cpu",
    domain: [0, 100],
    ticks: [0, 50, 100],
    unit: "%",
    area: true,
  },
  mem: {
    kind: "mem",
    metric: "mem_pct",
    domain: [0, 100],
    ticks: [0, 50, 100],
    unit: "%",
    area: true,
  },
  temp: {
    kind: "temp",
    metric: "temp_c",
    domain: [20, 120],
    ticks: [20, 70, 120],
    unit: "°C",
    area: false,
  },
};

export interface MetricPoint {
  /** Bucket midpoint, epoch seconds: where the point is plotted. */
  t: number;
  start: number;
  end: number;
  /** Plot value clamped into the domain; null breaks the line. */
  v: number | null;
  /** Reading as measured. */
  raw: number | null;
  /** Memory in use, MiB (memory chart only). */
  mb: number | null;
}

function clamp(value: number, [lo, hi]: [number, number]): number {
  return Math.min(hi, Math.max(lo, value));
}

/** One point per bucket at its midpoint; a bucket with no reading plots as null. */
export function buildMetricPoints(
  history: SystemHistory,
  spec: MetricSpec,
): MetricPoint[] {
  return history.buckets.map((b) => {
    const raw = b.m[spec.metric]?.avg ?? null;
    const mb = spec.kind === "mem" ? (b.m.mem_mb?.avg ?? null) : null;
    return {
      t: b.t + b.len / 2,
      start: b.t,
      end: b.t + b.len,
      v: raw === null ? null : clamp(raw, spec.domain),
      raw,
      mb,
    };
  });
}

/** Index of the bucket holding `t`, or -1 outside the plotted window. */
export function pointIndexAt(
  points: readonly MetricPoint[],
  t: number,
): number {
  const n = points.length;
  if (n === 0 || t < points[0].start || t > points[n - 1].end) return -1;
  for (let i = n - 1; i >= 0; i--) {
    if (t >= points[i].start) return i;
  }
  return 0;
}

/**
 * The readout when nothing is hovered: the newest reading among the last two
 * buckets. The newest bucket is partial and can be seconds old, so looking one
 * further back stops the figure flashing to a dash at every bucket boundary.
 */
export function latestMetricPoint(
  points: readonly MetricPoint[],
): MetricPoint | null {
  for (let i = points.length - 1; i >= Math.max(0, points.length - 2); i--) {
    if (points[i].raw !== null) return points[i];
  }
  return points.length > 0 ? points[points.length - 1] : null;
}

export function countReadings(points: readonly MetricPoint[]): number {
  return points.reduce((n, p) => (p.raw !== null ? n + 1 : n), 0);
}

/** Header readout ink: warning within 10 degrees of the trip, destructive at or over it. */
export function heatReadoutTone(
  value: number | null,
  tripC: number | null,
): "warning" | "destructive" | null {
  if (value === null || tripC === null) return null;
  if (value >= tripC) return "destructive";
  if (value >= tripC - 10) return "warning";
  return null;
}

// --- Incident geometry --------------------------------------------------------

/** Fraction 0..1 of `t` along the window, clamped. */
export function fraction(t: number, startSec: number, endSec: number): number {
  const span = endSec - startSec;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (t - startSec) / span));
}

/** Left and width (percent of the window) for a span; `end` null runs to the window's end. */
export function spanPercent(
  start: number,
  end: number | null,
  startSec: number,
  endSec: number,
): { left: number; width: number } {
  const l = fraction(start, startSec, endSec) * 100;
  const r = fraction(end ?? endSec, startSec, endSec) * 100;
  return { left: l, width: Math.max(0, r - l) };
}

/** True when the span overlaps the window at all. */
export function inWindow(
  incident: SystemIncident,
  startSec: number,
  endSec: number,
): boolean {
  return incident.start <= endSec && (incident.end ?? endSec) >= startSec;
}

/** A crash: the modem restarted itself, or the device restarted unexpectedly. */
export function isCrash(incident: SystemIncident): boolean {
  return (
    incident.kind === "modem" ||
    (incident.kind === "reboot" && incident.cause === "unexpected")
  );
}

/** Incidents whose span, widened by `tolSec`, holds `t`. */
export function nearIncidents(
  incidents: readonly SystemIncident[],
  t: number,
  tolSec: number,
  nowSec: number,
): SystemIncident[] {
  return incidents.filter(
    (i) => i.start - tolSec <= t && (i.end ?? nowSec) + tolSec >= t,
  );
}

/** True when `t` falls inside a period the device was off. */
export function deviceOffAt(
  incidents: readonly SystemIncident[],
  t: number,
): boolean {
  return incidents.some(
    (i) => i.kind === "reboot" && t >= i.start && t <= i.end,
  );
}
