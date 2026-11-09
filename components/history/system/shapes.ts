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
