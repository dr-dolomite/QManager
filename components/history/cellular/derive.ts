import type { CellularBucket, CellularHistory } from "@/types/history";

// =============================================================================
// Cellular History — pure derivations (tiles and connection strip)
// =============================================================================
// No React, no i18n: the components format what these return. Definitions follow
// docs/features/history.md §6–7: no data = `len - sum(st)`, and `x` counts the
// entries into a fault state inside the bucket.
// =============================================================================

export type StripKind = "nr" | "lte" | "down" | "nodata";

/** A bucket below this share of radio time (of its length) reads as no data. */
const MIN_COVERAGE = 0.5;

export interface BucketDurations {
  nr: number;
  lte: number;
  down: number;
  nodata: number;
}

/** Seconds per state in one bucket; `off` and uncovered time are both "no data". */
export function bucketDurations(b: CellularBucket): BucketDurations {
  const nr = b.st.nr ?? 0;
  const lte = b.st.lte ?? 0;
  const down = b.st.down ?? 0;
  return { nr, lte, down, nodata: Math.max(0, b.len - nr - lte - down) };
}

/**
 * The colour a bucket is drawn in. Any outage wins (a 30-second drop must stay
 * visible in a 12-hour bucket); otherwise the majority radio; a bucket the
 * collector barely saw is no data.
 */
export function bucketKind(b: CellularBucket, since: number | null = null): StripKind {
  const { nr, lte, down } = bucketDurations(b);
  if (b.x > 0 || down > 0) return "down";
  // Coverage counts from when collecting began, so the bucket a new install
  // starts in (up to 12 h on 30d) is not blanked for its uncollected head.
  const head = since !== null && since > b.t ? since - b.t : 0;
  const span = head > 0 && head < b.len ? b.len - head : b.len;
  if (nr + lte <= 0 || (span > 0 && (nr + lte) / span < MIN_COVERAGE)) return "nodata";
  return nr >= lte ? "nr" : "lte";
}

/** Index of the bucket containing `t` (epoch seconds), clamped; -1 when empty. */
export function bucketIndexAt(buckets: readonly CellularBucket[], t: number): number {
  if (buckets.length === 0) return -1;
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (t >= buckets[i].t) return i;
  }
  return 0;
}

export interface CellularSummary {
  nrSec: number;
  lteSec: number;
  downSec: number;
  /** Outage entries across the range (sum of `x`). */
  outages: number;
  /** 0..100, or null when nothing was observed. */
  availability: number | null;
  /** 0..100 share of radio time on 5G NR, or null without radio time. */
  nrShare: number | null;
  /** No bucket in the range recorded any NR time. */
  lteOnly: boolean;
}

export function summarise(history: CellularHistory): CellularSummary {
  let nr = 0;
  let lte = 0;
  let down = 0;
  let outages = 0;
  for (const b of history.buckets) {
    nr += b.st.nr ?? 0;
    lte += b.st.lte ?? 0;
    down += b.st.down ?? 0;
    outages += b.x;
  }
  const observed = nr + lte + down;
  const radio = nr + lte;

  let availability: number | null = null;
  if (observed > 0) {
    const raw = (1 - down / observed) * 100;
    // Floor, never round up: an outage must not read as a perfect 100.
    availability = Math.floor(raw * 100) / 100;
    if (down === 0) availability = 100;
    else if (availability >= 100) availability = 99.99;
  }

  return {
    nrSec: nr,
    lteSec: lte,
    downSec: down,
    outages,
    availability,
    nrShare: radio > 0 ? (nr / radio) * 100 : null,
    lteOnly: nr === 0,
  };
}

/**
 * Epoch second the page has been collecting since, when that falls inside the
 * window the strip shows (a new install); null when history covers the window.
 */
export function collectingSince(history: CellularHistory): number | null {
  if (history.buckets.length === 0) return null;
  if (history.since === null) return null;
  return history.since > history.buckets[0].t ? history.since : null;
}
