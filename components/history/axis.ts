import { DAY, HOUR, formatClock } from "@/components/history/format";
import type { HistoryRange } from "@/types/history";

// =============================================================================
// Bucket-axis ticks — one tick vocabulary for every History surface
// =============================================================================
// The strip and the charts must label the same moments, so the ticks are
// derived once from the range: every 6 h at local 00/06/12/18 for 24 hours,
// each local midnight (weekday) for 7 days, each week (a date) for 30 days.
// `position` is the fraction along the window, 0 at `startSec`, 1 at `endSec`.
// Ticks too close to either edge are dropped so they never collide with the
// "<range> ago" and "Now" labels that anchor the ends.
// =============================================================================

export interface AxisTick {
  /** Epoch seconds. */
  t: number;
  /** 0..1 along the window. */
  position: number;
  label: string;
}

const EDGE_MIN = 0.13;
const EDGE_MAX = 0.93;

export function axisTicks(
  range: HistoryRange,
  startSec: number,
  endSec: number,
  locale?: string,
): AxisTick[] {
  const span = endSec - startSec;
  if (span <= 0) return [];
  const out: AxisTick[] = [];
  const push = (at: number, label: string) => {
    const position = (at - startSec) / span;
    if (position > EDGE_MIN && position < EDGE_MAX) out.push({ t: at, position, label });
  };

  const first = new Date(startSec * 1000);
  if (range === "24h") {
    const d = new Date(first);
    d.setMinutes(0, 0, 0);
    d.setHours(Math.ceil(d.getHours() / 6) * 6);
    for (let at = d.getTime() / 1000; at < endSec; at += 6 * HOUR) {
      push(at, formatClock(at, locale));
    }
  } else if (range === "7d") {
    const d = new Date(first);
    d.setHours(24, 0, 0, 0);
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
    for (let at = d.getTime() / 1000; at < endSec; at += DAY) {
      push(at, fmt.format(at * 1000));
    }
  } else {
    const d = new Date(first);
    d.setHours(24, 0, 0, 0);
    const fmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
    for (let at = d.getTime() / 1000 + 2 * DAY; at < endSec; at += 7 * DAY) {
      push(at, fmt.format(at * 1000));
    }
  }
  return out;
}
