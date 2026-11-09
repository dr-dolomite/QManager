// =============================================================================
// Logs: shape constants
// =============================================================================
// The loaded list and its skeleton import the same geometry from here, so the
// handoff never jumps (Skeleton-Mirror Rule). The page column and the card
// shell are the Cellular History family's, so this page cannot drift from its
// History siblings.
// =============================================================================

export { HISTORY_CARD, HISTORY_PAGE } from "@/components/history/cellular/shapes";

/** Rows per page offered in the footer; the first is the default. */
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const LOGS = {
  /** The list bleeds to the card edge so row hover reaches it. Paging keeps it short. */
  SCROLLER: "-mx-6",
  /** Tab switch, filter and the line budget share one wrapping row. */
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
  DAY: "text-on-surface-variant px-6 pt-3 pb-1 text-xs font-semibold first:pt-1",
  /** Range on the left; rows per page, page count and the four arrows on the right. */
  FOOT: "text-on-surface-variant border-border flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t pt-4 text-[0.8125rem]",
  FOOT_NAV: "flex flex-wrap items-center gap-x-6 gap-y-3",
  FOOT_LABEL: "text-on-surface text-sm font-medium tabular-nums",
  SKELETON_ROWS: 10,
  /** Keeps the empty and error states about as tall as a page of rows. */
  STATE_H: "min-h-52",
} as const;
