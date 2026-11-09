import type { TFunction } from "i18next";

// =============================================================================
// History formatting — clock, day-and-time and duration, shared by every
// History page (strip tooltips, tiles, chart axes and tooltips, event rows)
// =============================================================================
// Times are the browser's local time: the modem has no timezone of its own the
// UI can trust, and the person reading the page lives where their device does.
// `t` is the `history` namespace's TFunction; the shared words live under
// `shared.*` (today, yesterday, now, duration units).
// =============================================================================

export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86400;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "14:40", 24-hour in every locale. */
export function formatClock(sec: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(sec * 1000);
}

function startOfDay(sec: number): number {
  const d = new Date(sec * 1000);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
}

/** "Today", "Yesterday", or "Nov 8". */
export function formatDay(
  sec: number,
  nowSec: number,
  t: TFunction,
  locale?: string,
): string {
  const diff = startOfDay(nowSec) - startOfDay(sec);
  if (diff === 0) return t("shared.today");
  if (Math.round(diff / DAY) === 1) return t("shared.yesterday");
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(
    sec * 1000,
  );
}

/** "Today, 14:40" / "Yesterday, 21:42" / "Nov 8, 21:42". */
export function formatWhen(
  sec: number,
  nowSec: number,
  t: TFunction,
  locale?: string,
): string {
  return `${formatDay(sec, nowSec, t, locale)}, ${formatClock(sec, locale)}`;
}

/** "14:40" for today, otherwise the full day-and-time. */
export function formatSince(
  sec: number,
  nowSec: number,
  t: TFunction,
  locale?: string,
): string {
  return startOfDay(sec) === startOfDay(nowSec)
    ? formatClock(sec, locale)
    : formatWhen(sec, nowSec, t, locale);
}

/**
 * "45s", "2m 14s", "3h 21m", "2d 4h": two units at most, the second one only
 * when it carries information. Unit words come from `shared.duration.*`.
 */
export function formatDuration(totalSec: number, t: TFunction): string {
  const s = Math.max(0, Math.round(totalSec));
  const unit = (key: "d" | "h" | "m" | "s", value: number | string) =>
    t(`shared.duration.${key}`, { value });
  if (s < MINUTE) return unit("s", s);
  const m = Math.floor(s / MINUTE);
  if (m < 60) return `${unit("m", m)} ${unit("s", pad2(s % MINUTE))}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${unit("h", h)} ${unit("m", pad2(m % 60))}`;
  return `${unit("d", Math.floor(h / 24))} ${unit("h", h % 24)}`;
}
