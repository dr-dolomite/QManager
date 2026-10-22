"use client";

import { cn } from "@/lib/utils";

import { LIVE_WINDOW_MS, type LivePoint } from "./use-live-lead";
import { LIVE } from "./shapes";

// =============================================================================
// The 30 s trace under the live lead
// =============================================================================
// A plain SVG polyline, not recharts: it redraws five times a second on a phone
// held at a mast, so it carries no axes, no tooltip, no animation and no layout
// work beyond one `points` string. The x axis is the modem's own sample clock
// (never the browser's), anchored at the right edge on the newest sample.
//
// The y axis fits the window plus the session peak, so the gap between the
// trace and the dashed peak line IS the distance back to the best heading.
// It never zooms past a 6 dB span: a 0.4 dB wobble drawn edge to edge would
// read as a swing worth rotating for.
// =============================================================================

const VIEW_W = 300;
const VIEW_H = 48;
/** Inset so a 2px stroke at the extremes is not clipped by the viewBox. */
const PAD_Y = 3;
const MIN_SPAN_DB = 6;

export function LiveSparkline({
  points,
  peak,
  inkClass,
}: {
  points: LivePoint[];
  peak: number | null;
  /** Ramp ink for the current reading, or neutral ink when muted. */
  inkClass: string;
}) {
  const values = points
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  if (peak !== null) values.push(peak);

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = -100;
    hi = -94;
  }
  if (hi - lo < MIN_SPAN_DB) {
    const mid = (hi + lo) / 2;
    lo = mid - MIN_SPAN_DB / 2;
    hi = mid + MIN_SPAN_DB / 2;
  }

  const x = (dt: number) =>
    ((dt + LIVE_WINDOW_MS) / LIVE_WINDOW_MS) * VIEW_W;
  const y = (v: number) =>
    PAD_Y + (1 - (v - lo) / (hi - lo)) * (VIEW_H - PAD_Y * 2);

  // Null values break the line: a scan or a lost registration is a hole in the
  // trace, never a plunge to the floor.
  const segments: string[] = [];
  let current: string[] = [];
  for (const p of points) {
    if (p.value === null) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(`${x(p.dt).toFixed(1)},${y(p.value).toFixed(1)}`);
  }
  if (current.length > 0) segments.push(current.join(" "));

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className={cn(LIVE.SPARK, inkClass)}
      aria-hidden="true"
      focusable="false"
    >
      {peak !== null && (
        <line
          x1={0}
          x2={VIEW_W}
          y1={y(peak)}
          y2={y(peak)}
          className="stroke-on-surface-variant"
          strokeWidth={1}
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
          opacity={0.6}
        />
      )}
      {segments.map((pts, i) =>
        // A lone sample has no length to stroke, so it draws nothing.
        pts.includes(" ") ? (
          <polyline
            key={i}
            points={pts}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null,
      )}
    </svg>
  );
}
