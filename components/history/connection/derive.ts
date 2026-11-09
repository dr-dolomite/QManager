import { HISTORY_RANGES } from "@/types/history";

import {
  LOSS_SLOW_PCT,
  type ConnectionBucket,
  type ConnectionHistory,
  type ConnectionLimits,
} from "./types";

// =============================================================================
// Connection History: pure derivations (tiles, reachability strip, charts)
// =============================================================================
// No React, no i18n: the components format what these return. Definitions follow
// docs/features/history.md §6: no data = `len - up - down` (the radio being off
// counts as no data), `x` counts entries into the fault state, and "slow or
// lossy" is never stored, so a changed limit recolours past buckets too.
// =============================================================================

export type StripKind = "up" | "slow" | "down" | "nodata";

export interface BucketDurations {
  up: number;
  down: number;
  /** Radio off plus time nothing was sampled. */
  nodata: number;
}

export function bucketDurations(b: ConnectionBucket): BucketDurations {
  const up = b.st.up ?? 0;
  const down = b.st.down ?? 0;
  return { up, down, nodata: Math.max(0, b.len - up - down) };
}

/**
 * The colour a bucket is drawn in. Any outage wins (a 30-second drop must stay
 * visible in a 12-hour bucket); then no data when nothing was observed (a
 * partly covered bucket is graded on what it saw); then slow or lossy against the user's limits; otherwise responsive.
 */
export function bucketKind(b: ConnectionBucket, limits: ConnectionLimits): StripKind {
  const { up, down } = bucketDurations(b);
  if (b.x > 0 || down > 0) return "down";
  if (up <= 0) return "nodata";
  const latency = b.m.lat_ms?.avg;
  const loss = b.m.loss_pct?.avg;
  if ((latency !== undefined && latency > limits.latencyMs) || (loss !== undefined && loss >= LOSS_SLOW_PCT)) {
    return "slow";
  }
  return "up";
}

/** Index of the bucket containing `t` (epoch seconds), clamped; -1 when empty. */
export function bucketIndexAt(buckets: readonly ConnectionBucket[], t: number): number {
  if (buckets.length === 0) return -1;
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (t >= buckets[i].t) return i;
  }
  return 0;
}

export interface ConnectionSummary {
  upSec: number;
  downSec: number;
  /** Outage entries across the range (sum of `x`). */
  outages: number;
  /** 0..100, or null when nothing was observed. */
  availability: number | null;
  /** Median of the per-bucket average latency, or null without a reading. */
  medianLatency: number | null;
  /** Buckets graded slow or lossy, out of the buckets that have data. */
  slowBuckets: number;
  gradedBuckets: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarise(history: ConnectionHistory, limits: ConnectionLimits): ConnectionSummary {
  let up = 0;
  let down = 0;
  let outages = 0;
  let slow = 0;
  let graded = 0;
  const latencies: number[] = [];
  for (const b of history.buckets) {
    up += b.st.up ?? 0;
    down += b.st.down ?? 0;
    outages += b.x;
    const avg = b.m.lat_ms?.avg;
    if (avg !== undefined) latencies.push(avg);
    const kind = bucketKind(b, limits);
    if (kind !== "nodata") graded += 1;
    if (kind === "slow") slow += 1;
  }
  const observed = up + down;

  let availability: number | null = null;
  if (observed > 0) {
    const raw = (up / observed) * 100;
    // Floor, never round up: an outage must not read as a perfect 100.
    availability = Math.floor(raw * 100) / 100;
    if (down === 0) availability = 100;
    else if (availability >= 100) availability = 99.99;
  }

  return {
    upSec: up,
    downSec: down,
    outages,
    availability,
    medianLatency: median(latencies),
    slowBuckets: slow,
    gradedBuckets: graded,
  };
}

/**
 * Epoch second the page has been collecting since, when that falls inside the
 * window the strip shows (a new install); null when history covers the window.
 */
export function collectingSince(history: ConnectionHistory): number | null {
  if (history.buckets.length === 0) return null;
  if (history.since === null) return null;
  return history.since > history.buckets[0].t ? history.since : null;
}

/**
 * A history whose collector has no trusted clock answers with no buckets. The
 * cards still need a window to draw their empty state in, so lay out empty
 * buckets ending at "now".
 */
export function withBuckets(history: ConnectionHistory): ConnectionHistory {
  if (history.buckets.length > 0) return history;
  const { bucketSec, count } = HISTORY_RANGES[history.range];
  const first = Math.floor(history.now / bucketSec) * bucketSec - (count - 1) * bucketSec;
  return {
    ...history,
    buckets: Array.from({ length: count }, (_, i) => ({
      t: first + i * bucketSec,
      len: bucketSec,
      st: {},
      x: 0,
      m: {},
    })),
  };
}

/** True while there is nothing to read yet: a new install or an untrusted clock. */
export function isCollecting(history: ConnectionHistory): boolean {
  return history.since === null || !history.clock_trusted;
}
