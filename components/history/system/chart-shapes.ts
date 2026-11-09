// =============================================================================
// System Health: stability lanes and metric charts, geometry constants
// =============================================================================
// The loaded cards and their skeletons import the same numbers from here, so
// the handoff never jumps (Skeleton-Mirror Rule). The card shell, header and
// plot geometry are the Cellular History family's (../cellular/shapes and
// ../cellular/signal-shapes); only what is specific to the lanes, the crash
// notches and the wash lives here.
// =============================================================================

/** The wash under an area series: the stroke's own ink, top to bottom (Area-Fill Rule). */
export const AREA_WASH = { TOP: 0.32, BOTTOM: 0 } as const;

/** Stability lanes. Every class is spelled in full: Tailwind cannot see a built one. */
export const LANE = {
  /** Name | track | count; the count column folds away in a narrow card. */
  GRID: "grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3.5 @max-xl/card:grid-cols-[3.25rem_minmax(0,1fr)] @max-xl/card:gap-x-3",
  NAME: "text-sm font-medium text-on-surface",
  TRACK_H: "h-[26px]",
  TRACK:
    "relative h-[26px] cursor-crosshair touch-pan-y rounded-inline outline-none",
  COUNT:
    "min-w-24 text-right text-[0.8125rem] whitespace-nowrap text-on-surface-variant tabular-nums @max-xl/card:sr-only",
  COUNT_VALUE: "font-semibold text-on-surface",
  /** The axis row sits under the track column only. */
  AXIS: "relative h-[18px] text-[0.6875rem] text-on-surface-variant tabular-nums",
  /** Marks reach 4px past the track and wear a card-colour outline (shape cue). */
  MARK_BAD:
    "absolute -top-1 -bottom-1 min-w-1 rounded-[2px] bg-destructive shadow-[0_0_0_1.5px_var(--surface)]",
  MARK_WARN:
    "absolute -top-1 -bottom-1 min-w-1 rounded-[2px] bg-warning shadow-[0_0_0_1.5px_var(--surface)]",
  /** A planned restart is a short gap in the card colour. */
  MARK_PLAN: "absolute inset-y-0 min-w-[3px] rounded-[2px] bg-surface",
  CUT: "absolute inset-y-0 min-w-[3px] bg-surface",
  CURSOR:
    "pointer-events-none absolute -top-[5px] -bottom-[5px] w-px -translate-x-1/2 bg-on-surface opacity-55",
} as const;

/** No data before collection began: a hatched band, its right edge square. */
export const NO_DATA_BAND = {
  backgroundColor: "var(--surface)",
  backgroundImage:
    "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in oklch, var(--border) 70%, transparent) 5px 6px)",
  boxShadow: "inset 0 0 0 1px var(--border)",
} as const;

/** The track's own running ink; with a no-data band the `run` segment carries it instead. */
export const TRACK_RUNNING = "bg-success";

/** The running segment that follows a no-data band; its rounded left edge sits on top. */
export const RUN_AFTER_GAP =
  "absolute inset-y-0 right-0 rounded-inline bg-success shadow-[-1.5px_0_0_var(--surface)]";

/** Pixel slop around the pointer when picking nearby incidents for a tooltip. */
export const TIP_TOLERANCE_PX = 6;

/** Y-axis gutter: wide enough for "100%" without touching the card edge. */
export const PLOT_AXIS_W = 44;

/** Lane axis ticks closer to the start label than this fraction of the track are dropped; the next band folds away in a narrow card. */
export const LANE_TICK_MIN = 0.2;
export const LANE_TICK_WIDE_ONLY = 0.34;

/** Metric plot layers. */
export const PLOT = {
  /** Crash rule: faint, one pixel, behind the series. */
  CRASH_RULE:
    "absolute inset-y-0 w-px -translate-x-1/2 bg-destructive-on-surface opacity-35",
  /** Crash notch: a small downward triangle above the plot edge. */
  CRASH_NOTCH:
    "absolute -top-[7px] h-1.5 w-2 -translate-x-1/2 bg-destructive-on-surface",
  OFF_BAND:
    "absolute inset-y-0 min-w-0.5 rounded-[2px] bg-surface-container-high opacity-70",
  HEAT_BAND:
    "absolute inset-y-0 min-w-[3px] rounded-[2px] bg-warning opacity-[0.16]",
  CROSSHAIR:
    "absolute inset-y-0 w-px -translate-x-1/2 bg-on-surface-variant opacity-60",
  DOT: "absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-primary-on-surface",
  TRIP_LABEL:
    "absolute left-1.5 -translate-y-full pb-1 text-[0.6875rem] whitespace-nowrap text-on-surface-variant tabular-nums",
} as const;

/** Triangle clip for a crash notch. */
export const NOTCH_CLIP = "polygon(0 0, 100% 0, 50% 100%)";
