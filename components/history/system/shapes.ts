export {
  HEADER_SHAPE,
  HISTORY_CARD,
  HISTORY_PAGE,
  LEGEND_DOT,
  SUMMARY_SHAPE,
} from "@/components/history/cellular/shapes";

// =============================================================================
// System Health: shape constants
// =============================================================================
// The loaded cards and their skeletons import the same geometry from here, so
// the handoff never jumps (Skeleton-Mirror Rule). The page column, the card
// shell, the header line boxes and the summary strip are the Cellular History
// family's, re-exported so this page cannot drift from its sibling.
// =============================================================================

/** The 2x2 grid of chart and storage cards: one column until the page is wide. */
export const METRICS_GRID = "grid grid-cols-1 gap-5 @3xl/main:grid-cols-2";

/** Storage card: three areas, each name/figure, meter, caption. */
export const STORAGE = {
  AREAS: 3,
  LIST: "flex flex-col gap-6",
  /** Name and percent share a baseline. */
  TOP: "flex items-baseline justify-between gap-3",
  /** The meter's wrapper: the tooltip trigger, and the anchor for the tick. */
  METER: "relative my-2 rounded-pill outline-none focus-visible:ring-2 focus-visible:ring-ring",
  /** Where the area stood at the start of the range. */
  TICK: "bg-on-surface-variant absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-inline",
  BOTTOM: "text-on-surface-variant flex items-baseline justify-between gap-3 text-xs tabular-nums",
  /** Skeleton line boxes. */
  NAME_SK: "h-5 w-24",
  PCT_SK: "h-5 w-9",
  CAPTION_SK: "h-4 w-28",
  DELTA_SK: "h-4 w-24",
  METER_SK: "h-2 w-full",
} as const;

/** System events list. */
export const EVENTS = {
  /** Rows shown at first, and added per "Show more". */
  PAGE: 5,
  /** Every row: a 32px disc and two text lines, the time at the end. */
  ROW: "-mx-6 grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-6 py-1.5 transition-colors duration-[var(--duration-quick)] ease-out hover:bg-surface-container",
  DISC: "grid size-8 flex-none place-items-center rounded-pill",
  DAY: "text-on-surface-variant pt-3 pb-1 text-xs font-semibold first:pt-0",
  FOOT: "text-on-surface-variant border-border flex items-center justify-between gap-3 border-t pt-4 text-[0.8125rem]",
  SKELETON_ROWS: 5,
  EMPTY_H: "min-h-44",
} as const;

/** Logs card: a toolbar, a scrolling list of one-line-ish rows, a quiet foot. */
export const LOGS = {
  /** Rows kept on screen; the scroller does the rest. */
  MAX_ROWS: 100,
  /** The scroller bleeds to the card edge so row hover reaches it. */
  SCROLLER:
    "-mx-6 max-h-[26rem] overflow-y-auto overscroll-contain [scrollbar-width:thin]",
  /** Tab switch, filter and trailing action share one wrapping row. */
  TOOLBAR: "flex flex-wrap items-center gap-x-3 gap-y-3",
  /**
   * A row: time, then level and tag, then the raw line. Stacks on a narrow card
   * (time + chips over the message) and becomes one line at the 2xl step.
   * `contents` on the meta group puts the chips straight into the grid columns.
   */
  ROW_FULL:
    "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-6 py-2 transition-colors duration-[var(--duration-quick)] ease-out hover:bg-surface-container @2xl/card:grid-cols-[4.5rem_6.5rem_8rem_minmax(0,1fr)] @2xl/card:items-baseline",
  ROW_PLAIN:
    "grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 px-6 py-2 transition-colors duration-[var(--duration-quick)] ease-out hover:bg-surface-container",
  META: "flex min-w-0 items-center gap-2 @2xl/card:contents",
  TIME: "text-on-surface-variant truncate text-[0.8125rem] tabular-nums",
  MESSAGE:
    "text-on-surface col-span-2 min-w-0 font-mono text-xs leading-relaxed [overflow-wrap:anywhere] @2xl/card:col-span-1",
  MESSAGE_PLAIN:
    "text-on-surface min-w-0 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]",
  DAY: "bg-surface text-on-surface-variant sticky top-0 z-10 px-6 pt-3 pb-1 text-xs font-semibold first:pt-1",
  FOOT: "text-on-surface-variant border-border flex items-center justify-between gap-3 border-t pt-4 text-[0.8125rem]",
  SKELETON_ROWS: 6,
  /** Keeps the empty and error states as tall as the list they replace. */
  STATE_H: "min-h-52",
} as const;
