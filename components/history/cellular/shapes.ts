import { TILE_SHAPE } from "@/components/cellular/tile-shape";

// =============================================================================
// Cellular History — family shape constants
// =============================================================================
// The loaded page and its skeleton import the same geometry from here, so the
// handoff never jumps (Skeleton-Mirror Rule). The page column is full width and
// recomposes on the `@container/main` steps; each card declares its own
// `@container/card` for what happens inside it.
// =============================================================================

/** Page column: full width, never capped (Full-Width Page Rule). */
export const HISTORY_PAGE = "@container/main mx-auto flex flex-col gap-5 p-2";

/** The summary strip: four tiles, the shared glance-tile geometry. */
export const SUMMARY_SHAPE = {
  GRID: TILE_SHAPE.GRID,
  TILE_HEIGHT: TILE_SHAPE.HEIGHT,
  TILES: 4,
} as const;

/** The shared card shell for every History card. */
export const HISTORY_CARD =
  "@container/card gap-5 rounded-card border-0 bg-surface px-6 py-6 shadow-[var(--shadow-whisper)]";

/**
 * A card header's line boxes, for skeletons. `CardTitle` is `leading-none`, so
 * `text-xl` is a 20px box; the 14px description resolves to 20px.
 */
export const HEADER_SHAPE = {
  TITLE: "h-5 w-32",
  DESCRIPTION: "h-5 w-64 max-w-full",
  GAP: "gap-1",
} as const;

/** Connection strip geometry. */
export const STRIP_SHAPE = {
  /** The bar row: 36px, 32px in a narrow card. */
  BARS: "flex h-9 gap-[3px] @max-2xl/card:h-8 @max-2xl/card:gap-0.5",
  BAR: "min-w-0 flex-1 rounded-inline",
  /** Tick row under the bars: a 16px line box plus its 8px lead. */
  AXIS: "relative mt-2 h-4 text-[0.6875rem] text-on-surface-variant tabular-nums",
  AXIS_HEIGHT: "h-4",
} as const;

/** Legend dot sizes. */
export const LEGEND_DOT = "size-2 flex-none rounded-pill";
