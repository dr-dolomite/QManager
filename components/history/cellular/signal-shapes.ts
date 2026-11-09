// =============================================================================
// Cellular History: signal charts and radio events, geometry constants
// =============================================================================
// The loaded cards and their skeletons import the same numbers from here, so
// the handoff never jumps (Skeleton-Mirror Rule). The card shell itself is the
// family's `HISTORY_CARD` from ./shapes.
// =============================================================================

/** The 2x2 chart grid: one column until its own container is wide enough. */
export const SIGNALS_GRID =
  "@container/signals";
export const SIGNALS_GRID_INNER =
  "grid grid-cols-1 gap-5 @3xl/signals:grid-cols-2";

/** Header actions: beside the title on a wide card, on their own row below it. */
export const HEADER_ACTIONS =
  "col-span-2 col-start-1 row-span-1 row-start-3 flex flex-wrap items-center justify-self-start gap-2 @lg/card:col-span-1 @lg/card:col-start-2 @lg/card:row-span-2 @lg/card:row-start-1 @lg/card:justify-self-end";

export const CARD_HEADER = "gap-1 px-0";
export const CARD_TITLE = "col-start-1 min-w-0 text-lg leading-tight";
export const CARD_DESC = "text-on-surface-variant col-start-1 text-sm";

export const CHART = {
  /** Plot plus its time axis, identical in every state. */
  AREA: "relative h-[12.5rem]",
  FILL: "absolute inset-0 aspect-auto",
  /** Numbers, not classes: recharts takes them as props. */
  AXIS_W: 40,
  X_AXIS_H: 24,
  MARGIN: { top: 8, right: 4, bottom: 0, left: 0 },
  TICK_INK:
    "[&_.recharts-cartesian-axis-tick_text]:fill-on-surface-variant [&_.recharts-cartesian-axis-tick_text]:tabular-nums [&_.recharts-cartesian-axis-tick_text]:text-[0.6875rem] [&_.recharts-cartesian-axis-tick_text]:font-medium",
  TOOLTIP:
    "bg-surface-container-high grid min-w-[10.5rem] gap-1 rounded-field px-3 py-2.5 text-xs leading-5 tabular-nums shadow-lg",
  TOOLTIP_TITLE: "mb-0.5 font-semibold",
  TOOLTIP_ROW: "text-on-surface-variant flex items-center gap-2",
  TOOLTIP_VALUE: "text-on-surface ml-auto pl-3 font-semibold",
  DOT: "size-2 flex-none rounded-pill",
  /** Readout beside the title: dot, label, figure. */
  READOUT: "flex items-baseline gap-4",
  READOUT_ITEM: "text-on-surface-variant inline-flex items-center gap-1.5 text-xs whitespace-nowrap",
  READOUT_VALUE:
    "text-on-surface min-w-[3ch] text-right text-[0.9375rem] font-semibold tabular-nums",
  /** "Collecting since" caption centred in the plot area. */
  COLLECTING:
    "text-on-surface-variant pointer-events-none absolute inset-y-2 right-1 left-10 flex items-center justify-center text-xs font-medium",
} as const;

/** Radio events table. */
export const EVENTS = {
  ROW_H: "h-14",
  HEAD_H: "h-9",
  /** Rows shown by the skeleton: the default page size. */
  SKELETON_ROWS: 5,
  /** Fixed column widths; the event column takes the rest. */
  COL_RADIO: "w-24",
  COL_TIME: "w-40",
  /**
   * Below 34rem of card width the Time column folds under the message. Every
   * class is spelled out in full: Tailwind cannot see a class built by
   * concatenation.
   */
  WIDE_ONLY: "hidden @[34rem]/card:table-cell",
  NARROW_ONLY: "@[34rem]/card:hidden",
  RADIO_HEAD: "pr-6 text-right @[34rem]/card:pr-3 @[34rem]/card:text-left",
  RADIO_CELL: "pr-6 @[34rem]/card:pr-3",
  RADIO_ALIGN: "flex justify-end @[34rem]/card:justify-start",
  DISC: "grid size-[30px] flex-none place-items-center rounded-full",
  EMPTY_H: "min-h-[17.5rem]",
} as const;

export const PAGE_SIZES = [5, 10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 5;
