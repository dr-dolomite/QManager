import { DAY, HOUR, MINUTE, formatClock } from "@/components/history/format";
import type { HistoryRange } from "@/types/history";

// =============================================================================
// Bucket-axis ticks — one tick vocabulary for every History surface
// =============================================================================
// The strip and the charts must label the same moments, so the ticks are
// derived once from the range: every minute on the minute for 5 minutes, every
// 15 min on the quarter hour for 1 hour, every 6 h at local 00/06/12/18 for
// 24 hours, each local midnight (weekday) for 7 days, every third local
// midnight (a date) for 15 days, each week (a date) for 30 days.
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
  if (range === "5m") {
    // Every minute on the minute (clock).
    for (let at = Math.ceil(startSec / MINUTE) * MINUTE; at < endSec; at += MINUTE) {
      push(at, formatClock(at, locale));
    }
  } else if (range === "1h") {
    // Every 15 min at :00/:15/:30/:45 (clock).
    const step = 15 * MINUTE;
    for (let at = Math.ceil(startSec / step) * step; at < endSec; at += step) {
      push(at, formatClock(at, locale));
    }
  } else if (range === "24h") {
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
  } else if (range === "15d") {
    // Every third local midnight. Anchored to a fixed calendar phase (days since
    // the epoch, mod 3) so the labels do not hop as the window slides.
    const fmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
    const d = new Date(first);
    d.setHours(24, 0, 0, 0);
    for (let n = 0; n < 40 && d.getTime() / 1000 < endSec; n++) {
      const dayIndex = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / (DAY * 1000));
      if (dayIndex % 3 === 0) push(d.getTime() / 1000, fmt.format(d));
      d.setDate(d.getDate() + 1);
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
