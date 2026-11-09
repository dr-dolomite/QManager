import { HISTORY_RANGES, type HistoryRange } from "@/types/history";
import type { SiteBucket } from "@/types/sites";

// Connection History > Sites: pure derivations. The latency limit is the
// poller's own cut, handed in by the page.

export type Tone = "ok" | "warn" | "bad";

/** Amber over the limit, red past twice the limit. */
export function latencyTone(ms: number, limitMs: number): Tone {
  if (ms > limitMs * 2) return "bad";
  if (ms > limitMs) return "warn";
  return "ok";
}

export interface MsParts {
  value: string;
  unit: "ms" | "s";
}

/** Under 10 ms keeps a decimal; 1000 ms and up reads in seconds. */
export function msParts(ms: number): MsParts {
  if (ms >= 1000) return { value: (ms / 1000).toFixed(1), unit: "s" };
  if (ms < 10) return { value: ms.toFixed(1), unit: "ms" };
  return { value: String(Math.round(ms)), unit: "ms" };
}

export interface UnitLabels {
  ms: string;
  s: string;
  /** The placeholder for a figure that was not measured. */
  dash: string;
}

/** A figure and its translated unit as one string, for captions and rows. */
export function msText(ms: number, units: UnitLabels): string {
  const p = msParts(ms);
  return `${p.value} ${units[p.unit]}`;
}

// -----------------------------------------------------------------------------
// Range statistics
// -----------------------------------------------------------------------------

/** Mean of answered samples over the range the CGI returned. */
export function siteAverage(series: SiteBucket[]): number | null {
  let sum = 0;
  let count = 0;
  for (const b of series) {
    if (b.ms === null || b.ok <= 0) continue;
    sum += b.ms * b.ok;
    count += b.ok;
  }
  return count > 0 ? sum / count : null;
}

export interface SiteStats {
  average: number | null;
  fastest: number | null;
  slowest: number | null;
  /** 0..100, or null when nothing was sampled. */
  answeredPct: number | null;
}

export function siteStats(series: SiteBucket[]): SiteStats {
  let fastest: number | null = null;
  let slowest: number | null = null;
  let taken = 0;
  let answered = 0;
  for (const b of series) {
    taken += b.n;
    answered += b.ok;
    if (b.min !== null && (fastest === null || b.min < fastest)) fastest = b.min;
    if (b.max !== null && (slowest === null || b.max > slowest)) slowest = b.max;
  }
  return {
    average: siteAverage(series),
    fastest,
    slowest,
    answeredPct: taken > 0 ? (answered / taken) * 100 : null,
  };
}

// -----------------------------------------------------------------------------
// The page's bucket grid
// -----------------------------------------------------------------------------

export interface SitePoint {
  /** Bucket start, epoch seconds (UTC-aligned to the range's bucket length). */
  start: number;
  end: number;
  /** Bucket midpoint: the shared cursor's coordinate, as on the other charts. */
  t: number;
  /** Mean of answered samples; null when none answered or nothing was sampled. */
  ms: number | null;
  /** Fastest and slowest answered sample in the bucket. */
  min: number | null;
  max: number | null;
  /** Samples taken. */
  n: number;
  /** Samples answered. */
  ok: number;
}

/**
 * One point per bucket of the page's grid, oldest first, ending with the bucket
 * that holds `nowSec`. The CGI aligns its buckets to the same UTC multiples, so
 * a series entry lands on its slot by start time; slots with no entry are empty.
 */
export function buildSitePoints(
  series: SiteBucket[],
  range: HistoryRange,
  nowSec: number,
): SitePoint[] {
  const { bucketSec, count } = HISTORY_RANGES[range];
  const last = Math.floor(nowSec / bucketSec) * bucketSec;
  const first = last - (count - 1) * bucketSec;
  const byStart = new Map<number, SiteBucket>();
  for (const b of series) byStart.set(Math.floor(b.ts / bucketSec) * bucketSec, b);

  const points: SitePoint[] = [];
  for (let i = 0; i < count; i++) {
    const start = first + i * bucketSec;
    const b = byStart.get(start);
    points.push({
      start,
      end: start + bucketSec,
      t: start + bucketSec / 2,
      ms: b && b.ok > 0 ? b.ms : null,
      min: b?.min ?? null,
      max: b?.max ?? null,
      n: b?.n ?? 0,
      ok: b?.ok ?? 0,
    });
  }
  return points;
}

/** Index of the slot containing `t`, or -1 when `t` falls outside the grid. */
export function pointIndexAt(points: readonly SitePoint[], t: number): number {
  if (points.length === 0) return -1;
  if (t < points[0].start || t >= points[points.length - 1].end) return -1;
  for (let i = points.length - 1; i >= 0; i--) {
    if (t >= points[i].start) return i;
  }
  return -1;
}

/** Nice round y-axis tops, so the limit line and ticks fall on tidy values. */
export function niceTop(raw: number): number {
  if (raw <= 0) return 100;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= raw) ?? 10;
  return step * mag;
}

/** y-axis top: 25 % over the 95th-percentile reading, never below the floor or 1.2x the limit. */
export function chartTop(points: readonly SitePoint[], limitMs: number): number {
  const values = points
    .map((p) => p.ms)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const p95 = values.length > 0 ? values[Math.floor(values.length * 0.95)] : 0;
  return niceTop(Math.max(p95 * 1.25, 300, limitMs * 1.2));
}

// -----------------------------------------------------------------------------
// Sites list editing
// -----------------------------------------------------------------------------

export const MAX_SITES = 32;

/** Lower-cases and strips a scheme, credentials, path, query and port. */
export function normalizeHost(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^[^@/]*@/, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
}

/** Mirrors the daemon's host check: 3-253 of [a-z0-9.-], a dot, clean edges. */
export function isValidHost(host: string): boolean {
  if (host.length < 3 || host.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  if (!host.includes(".")) return false;
  if (/^[.-]|[.-]$/.test(host)) return false;
  return !/\.\.|\.-|-\./.test(host);
}

export type HostError = "invalid" | "duplicate" | "full";

export function hostError(host: string, existing: readonly string[]): HostError | null {
  if (!isValidHost(host)) return "invalid";
  if (existing.includes(host)) return "duplicate";
  if (existing.length >= MAX_SITES) return "full";
  return null;
}
