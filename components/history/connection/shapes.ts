// =============================================================================
// Connection History: shape constants
// =============================================================================
// The loaded page and its skeleton import the same geometry from here, so the
// handoff never jumps (Skeleton-Mirror Rule). The History family's geometry
// lives with the first History page; this file is the one place Connection
// History reads it from, plus what is only true of this page.
// =============================================================================

export {
  HEADER_SHAPE,
  HISTORY_CARD,
  HISTORY_PAGE,
  LEGEND_DOT,
  STRIP_SHAPE,
  SUMMARY_SHAPE,
} from "../cellular/shapes";

export {
  CARD_DESC,
  CARD_HEADER,
  CARD_TITLE,
  CHART,
  DEFAULT_PAGE_SIZE,
  EVENTS,
  HEADER_ACTIONS,
  PAGE_SIZES,
  SIGNALS_GRID,
  SIGNALS_GRID_INNER,
} from "../cellular/signal-shapes";

/** The four metric cards, in 2x2 reading order. */
export const CHART_IDS = ["latency", "loss", "jitter", "dns"] as const;

/** Events table: the Lasted column's width, beside the shared Time column. */
export const LASTED = {
  COL: "w-24",
  HEAD: "pr-6 text-right @[34rem]/card:pr-3",
  CELL: "pr-6 text-right @[34rem]/card:pr-3",
} as const;
