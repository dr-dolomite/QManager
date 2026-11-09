import type { BadgeVariant } from "@/components/ui/badge";

import type { Tone } from "./derive";

// Connection History > Sites: this card's geometry and tone contract, imported
// by the loaded views AND their skeletons.

// -----------------------------------------------------------------------------
// Card shell
// -----------------------------------------------------------------------------

/** The shared History card shell (`HISTORY_CARD` in the cellular family, restated). */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-surface px-6 py-6 shadow-[var(--shadow-whisper)]";

/** Pinned to column 1, or a wrapped action leaves column 2 for the description. */
export const CARD_TITLE = "col-start-1 min-w-0 text-lg leading-tight";
export const CARD_DESC = "text-on-surface-variant col-start-1 text-sm";
export const CARD_HEADER = "gap-1 px-0";

/** Header actions: beside the title on a wide card, on their own row below it. */
export const HEADER_ACTIONS =
  "col-span-2 col-start-1 row-span-1 row-start-3 flex flex-wrap items-center justify-self-start gap-2 @lg/card:col-span-1 @lg/card:col-start-2 @lg/card:row-span-2 @lg/card:row-start-1 @lg/card:justify-self-end";

/** Figures retarget on the standard clock. */
export const TRANSITION_INK =
  "transition-[color,opacity] duration-[var(--duration-standard)] ease-standard";

/** A site's latency: it reads as a verdict against the limit, so healthy is green. */
export const SITE_INK = {
  ok: "text-success-on-surface",
  warn: "text-warning-on-surface",
  bad: "text-destructive-on-surface",
} as const satisfies Record<Tone, string>;

// -----------------------------------------------------------------------------
// Sites grid
// -----------------------------------------------------------------------------

/** Bare cells (One-Nest): three columns on a phone, auto-fill on a wider card. */
export const SITES = {
  GRID: "grid grid-cols-3 gap-x-2 gap-y-3 @lg/card:grid-cols-[repeat(auto-fill,minmax(6.75rem,1fr))] @lg/card:gap-x-3 @lg/card:gap-y-4",
  /** The whole cell is the button that selects the site. */
  CELL: "focus-visible:ring-ring/50 flex min-w-0 flex-col items-center gap-1.5 rounded-tile px-0.5 py-1 text-center outline-none focus-visible:ring-[3px]",
  CELL_BUTTON: "group cursor-pointer",
  TILE: "bg-surface-container-high mb-1 grid size-14 flex-none place-items-center rounded-tile transition-[background-color,box-shadow] duration-[var(--duration-quick)] ease-out",
  /** Selected: the primary-container plate, ringed. */
  TILE_HOVER: "group-hover:bg-[color-mix(in_oklch,var(--surface-container-high),var(--on-surface)_8%)]",
  TILE_SELECTED:
    "bg-primary-container ring-2 ring-primary group-hover:bg-primary-container",
  MARK: "size-7",
  MONOGRAM: "text-on-surface-variant text-xl leading-none font-bold",
  FAVICON: "size-7 rounded-inline object-contain",
  LABEL: "max-w-full truncate text-[0.8125rem] leading-5 font-medium",
  LABEL_H: "h-5",
  VALUE: "text-[0.8125rem] leading-5 font-semibold tabular-nums",
  VALUE_H: "h-5",
  QUIET: "text-on-surface-variant font-medium",
  CHECKING: "opacity-45",
  /** The default list length, so a first-load skeleton matches the usual grid. */
  SKELETON_COUNT: 13,
} as const;

/** The Live toggle: a pulsing dot beside its label. */
export const LIVE = {
  DOT: "relative size-2 flex-none rounded-pill bg-on-surface-variant",
  DOT_ON: "bg-primary-on-surface",
  HALO: "animate-live-ping absolute inset-0 rounded-pill bg-primary-on-surface",
} as const;

// -----------------------------------------------------------------------------
// Selected-site panel
// -----------------------------------------------------------------------------

export const DETAIL = {
  /** The card's one inner container. */
  ROOT: "bg-surface-container flex flex-col gap-3 rounded-hero px-5 pt-4 pb-3",
  HEAD: "flex flex-wrap items-center gap-x-3 gap-y-2",
  PLATE: "bg-surface-container-high grid size-9 flex-none place-items-center rounded-inline",
  PLATE_MARK: "size-[1.125rem]",
  PLATE_FAVICON: "size-[1.125rem] rounded-[2px] object-contain",
  PLATE_MONOGRAM: "text-on-surface-variant text-[0.9375rem] leading-none font-bold",
  NAME: "min-w-0 truncate text-[0.9375rem] font-semibold",
  STATS: "ms-auto flex flex-wrap items-baseline gap-x-5 gap-y-1",
  STAT: "text-on-surface-variant inline-flex items-baseline gap-1.5 text-xs whitespace-nowrap",
  STAT_VALUE: "text-on-surface text-sm font-semibold tabular-nums",
  CLOSE: "flex-none",
  /** Plot plus its time axis, identical in every state. */
  CHART_AREA: "relative h-[10rem]",
  CHART_FILL: "absolute inset-0 aspect-auto",
  AXIS_W: 40,
  X_AXIS_H: 24,
  MARGIN: { top: 8, right: 4, bottom: 0, left: 0 },
  TICK_INK:
    "[&_.recharts-cartesian-axis-tick_text]:fill-on-surface-variant [&_.recharts-cartesian-axis-tick_text]:tabular-nums [&_.recharts-cartesian-axis-tick_text]:text-[0.6875rem] [&_.recharts-cartesian-axis-tick_text]:font-medium",
  LIMIT_LABEL:
    "fill-chart-threshold text-[0.6875rem] font-medium tabular-nums",
  TOOLTIP:
    "bg-surface-container-high grid min-w-[10.5rem] gap-1 rounded-field px-3 py-2.5 text-xs leading-5 tabular-nums shadow-lg",
  TOOLTIP_TITLE: "mb-0.5 font-semibold",
  TOOLTIP_ROW: "text-on-surface-variant flex items-center gap-2",
  TOOLTIP_VALUE: "text-on-surface ml-auto pl-3 font-semibold",
  DOT: "size-2 flex-none rounded-pill",
  EMPTY:
    "text-on-surface-variant pointer-events-none absolute inset-y-2 right-1 left-10 flex items-center justify-center text-xs font-medium",
} as const;

// -----------------------------------------------------------------------------
// Manage sites dialog
// -----------------------------------------------------------------------------

export const DIALOG = {
  /** A card container, so the interval pill can fall back to a Select on a phone. */
  CONTENT: "@container/card gap-5 rounded-card sm:max-w-xl",
  ROW: "flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5",
  ROW_LABEL: "text-[0.84375rem] font-medium",
  WELL: "bg-surface-container max-h-72 overflow-y-auto rounded-tile",
  LIST: "divide-border flex flex-col divide-y py-1",
  ITEM: "grid min-h-12 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-1.5 pr-2 pl-3.5",
  LOGO: "bg-surface-container-high grid size-8 flex-none place-items-center rounded-inline",
  LOGO_MARK: "size-4",
  LOGO_FAVICON: "size-4 rounded-[2px] object-contain",
  LOGO_MONOGRAM: "text-on-surface-variant text-[0.8125rem] leading-none font-bold",
  HOST: "font-mono text-[0.78125rem] leading-5 font-medium [overflow-wrap:anywhere]",
  EMPTY: "text-on-surface-variant px-3.5 py-3 text-sm",
  ADD: "flex gap-2",
  ERROR: "text-destructive-on-surface -mt-3 text-[0.78125rem]",
  FOOTER: "flex-row items-center justify-end gap-2",
  COUNT: "text-on-surface-variant me-auto text-[0.78125rem] tabular-nums",
} as const;

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

/** The two condition tones this surface can reach, keyed onto `BadgeVariant`. */
export type ConditionTone = Extract<BadgeVariant, "muted" | "destructive">;

export const CONDITION = {
  ROOT: "flex flex-col items-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION: "mt-1 px-4",
} as const;

/** The block IS the state. The retry pill is drawn from the container's own ink. */
export const CONDITION_TONE = {
  muted: {
    ROOT: "bg-surface-container text-on-surface",
    DISC: "bg-surface-container-high text-on-surface-variant",
    ACTION: "bg-on-surface/10 text-on-surface hover:bg-on-surface/15",
  },
  destructive: {
    ROOT: "bg-destructive-container text-on-destructive-container",
    DISC: "bg-destructive text-destructive-foreground",
    ACTION:
      "bg-on-destructive-container/10 text-on-destructive-container hover:bg-on-destructive-container/15",
  },
} satisfies Record<ConditionTone, { ROOT: string; DISC: string; ACTION: string }>;

/** A stale-data notice: non-blocking, above the content, never replacing it. */
export const NOTICE =
  "rounded-field bg-destructive-container text-on-destructive-container flex items-center gap-2 px-3.5 py-2 text-xs leading-4 font-medium";

/** A quiet fact above the content: the link is down, so the figures below are expected. */
export const NOTICE_QUIET =
  "rounded-field bg-surface-container text-on-surface-variant flex items-center gap-2 px-3.5 py-2 text-xs leading-4 font-medium";
