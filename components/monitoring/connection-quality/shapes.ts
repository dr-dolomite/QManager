import type { BadgeVariant } from "@/components/ui/badge";
import type { SlotState } from "@/types/cq-watchdog";

// Connection Quality: this family's geometry, imported by the loaded views AND
// their skeletons. Restated here, never imported across families.

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper, as on the other Monitoring pages. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** Probe Targets beside Sensitivity and Quality, one height, stacked below 58rem. */
export const PAIR =
  "grid grid-cols-1 items-stretch gap-5 @[58rem]/main:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]";

/** A pair cell hands its full height to the card inside it. */
export const CARD_CELL = "flex min-w-0 flex-col";

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card flex-1 gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";

/** The body column. `flex-1` lets a pair card hand its slack to the foot's `mt-auto`. */
export const CARD_BODY = "flex flex-1 flex-col gap-4";

export const CARD_TITLE = "col-start-1 min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant col-start-1 text-sm";

export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The 42px action height every pill button and field shares here. */
const CONTROL_H = "h-[2.625rem]";

// -----------------------------------------------------------------------------
// Groups and eyebrows
// -----------------------------------------------------------------------------

export const EYEBROW =
  "text-on-surface-variant min-w-0 truncate text-[0.6875rem] leading-[1.125rem] font-semibold tracking-[0.02em] uppercase";

/** An eyebrow over its rows: 9px between them, 5px between rows. */
export const GROUP = "flex flex-col gap-[0.5625rem]";
/** min-h-5 is the HintIcon trigger, so a head with or without one keeps one height. */
export const GROUP_HEAD = "flex min-h-5 flex-wrap items-center gap-x-2 gap-y-2 px-1";
export const ROW_STACK = "flex flex-col gap-[0.3125rem]";

/** Eyebrow left, a control right; below the card breakpoint the control wraps under. */
export const METRIC_HEAD =
  "flex min-h-[2.625rem] flex-wrap items-center gap-x-3 gap-y-[0.5625rem] pl-1";

/** A failed save, left in the foot until the next edit or save. */
export const FAILED = {
  ROOT: "text-destructive-on-surface inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold",
  GLYPH: "size-3.5 flex-none",
} as const;

/** The live verdict in the foot: a dot and a sentence, the sentence carries the meaning. */
export const VERDICT = {
  ROOT: "inline-flex items-center gap-2 text-[0.8125rem] font-semibold",
  DOT: "size-2 flex-none rounded-pill",
} as const;

export type VerdictTone = "success" | "destructive" | "muted";

export const VERDICT_TONE: Record<VerdictTone, { ink: string; dot: string }> = {
  success: { ink: "text-success-on-surface", dot: "bg-success" },
  destructive: { ink: "text-destructive-on-surface", dot: "bg-destructive" },
  muted: { ink: "text-on-surface-variant", dot: "bg-on-surface-variant" },
};

// -----------------------------------------------------------------------------
// Probe Targets: four slots
// -----------------------------------------------------------------------------

/** Slot 1 is the primary; 2-4 are the fallbacks, pinged together. */
export const SLOT_INDEXES = [0, 1, 2, 3] as const;
export const PRIMARY_SLOTS = [0] as const;
export const FALLBACK_SLOTS = [1, 2, 3] as const;

/**
 * One slot: a 28px number disc (it carries the live state), the 42px field and
 * the live value on the right edge. Below the card's `@sm` the value drops under
 * the field so the field keeps its width.
 */
export const SLOT = {
  ROOT: "flex flex-col gap-1",
  ROW: "grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 rounded-tile p-1.5 transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] @sm/card:grid-cols-[1.75rem_minmax(0,1fr)_auto]",
  /** The answering slot: a success tint under the row, the field stays a field. */
  ROW_LIT: "bg-success-container text-on-success-container",
  DISC: "grid size-7 flex-none place-items-center rounded-pill text-[0.8125rem] leading-none font-semibold tabular-nums transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
  VALUE:
    "col-start-2 min-w-0 text-[0.8125rem] leading-5 font-medium tabular-nums text-on-surface-variant @sm/card:col-start-3 @sm/card:min-w-[5.5rem] @sm/card:text-right",
  VALUE_MISS: "font-semibold text-destructive-on-surface",
  VALUE_LIT: "font-semibold text-on-success-container",
} as const;

export const SLOT_DISC: Record<SlotState, string> = {
  ok: "bg-success text-success-foreground",
  miss: "bg-destructive text-destructive-foreground",
  // No route for this address type: an empty ring, neither a pass nor a fail.
  skipped: "border border-dashed border-outline text-on-surface-variant",
  standby: "bg-surface-container-high text-on-surface-variant",
};

/** A probe target is an identifier the device echoes back verbatim, so mono. */
const FIELD_H = `${CONTROL_H} pointer-coarse:h-11`;
export const FIELD_MONO = `${FIELD_H} min-w-0 flex-1 font-mono text-[0.84375rem] font-medium`;
/** On the lit row's tint the field lifts off with the card's own ground. */
export const FIELD_LIT = "bg-card/70";

/** Indented past the disc and gap, so it starts at the field's edge. */
export const FIELD_ERROR = "text-destructive-on-surface pl-[3.25rem] text-xs leading-relaxed";

// -----------------------------------------------------------------------------
// Pill rows
// -----------------------------------------------------------------------------

export const ROW = {
  ROOT: `flex ${CONTROL_H} min-w-0 items-center justify-between gap-4 rounded-pill bg-surface-container px-4 text-[0.8125rem] leading-5 font-semibold`,
  /** A row with a second line under its value. */
  ROOT_TALL:
    "flex min-h-[2.625rem] min-w-0 items-center justify-between gap-4 rounded-tile bg-surface-container px-4 py-2 text-[0.8125rem] leading-5 font-semibold",
  KEY: "text-on-surface-variant flex min-w-0 items-center gap-1.5",
  VALUE: "flex min-w-0 items-center gap-1.5 whitespace-nowrap tabular-nums",
  VALUE_STACK: "flex min-w-0 flex-col items-end text-right tabular-nums",
  SECOND: "text-on-surface-variant text-xs leading-[1.125rem] font-medium",
  QUIET: "text-on-surface-variant font-medium",
  /** The over-limit notch, centred on the 20px line box beside its figure. */
  ALERT: "size-3.5 flex-none text-warning-on-surface",
} as const;

// -----------------------------------------------------------------------------
// Sensitivity and Quality
// -----------------------------------------------------------------------------

/**
 * The four sensitivities side by side. The chosen column is one primary-container
 * block from its name down to its last row; the others stay quiet.
 */
export const SENS_GRID = {
  TABLE: "w-full table-fixed border-separate border-spacing-0 text-center",
  KEY: "w-[5.25rem] pr-2 text-left text-xs font-semibold text-on-surface-variant @md/card:w-28 @md/card:text-[0.8125rem]",
  HEAD: "px-1 pt-2 pb-1.5 text-xs font-semibold break-words text-on-surface-variant @md/card:text-[0.8125rem]",
  CELL: "px-1 py-2 text-xs font-medium tabular-nums text-on-surface-variant @md/card:text-[0.8125rem]",
  SEL: "bg-primary-container font-semibold text-on-primary-container",
  SEL_FIRST: "rounded-t-tile",
  SEL_LAST: "rounded-b-tile",
} as const;

/** The preset pill takes the full row; its segments share the width. */
export const PRESET_FIELD =
  "@2xl/card:w-full [&_[data-slot=toggle-group]]:w-full [&_[data-slot=toggle-group-item]]:flex-1 [&_[data-slot=toggle-group-item]]:px-2.5";

/** The custom limit field: a compact numeric input plus its unit. */
export const CUSTOM_FIELD = {
  WRAP: "flex items-center gap-1.5",
  INPUT:
    "h-9 w-24 px-3 text-right text-[0.8125rem] font-semibold tabular-nums pointer-coarse:h-11",
  UNIT: "text-on-surface-variant text-[0.8125rem] font-medium",
  ERROR: "text-destructive-on-surface px-1 text-xs leading-relaxed",
  /** The limit shown as text while a named preset is on: quiet, it is the default. */
  VALUE: "text-on-surface-variant text-[0.8125rem] font-medium tabular-nums",
} as const;

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

export type ConditionTone = Extract<BadgeVariant, "warning" | "destructive">;

export const CONDITION = {
  ROOT: "flex flex-col items-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION: "mt-1 px-4",
  /** A state block fills the card body instead of a form. */
  SCREEN: "min-h-0 flex-1 justify-center",
} as const;

/** A condition block IS the state; the action pill is drawn from its own ink. */
export const CONDITION_TONE = {
  warning: {
    ROOT: "bg-warning-container text-on-warning-container",
    DISC: "bg-warning text-warning-foreground",
    ACTION:
      "bg-on-warning-container/10 text-on-warning-container hover:bg-on-warning-container/15",
  },
  destructive: {
    ROOT: "bg-destructive-container text-on-destructive-container",
    DISC: "bg-destructive text-destructive-foreground",
    ACTION:
      "bg-on-destructive-container/10 text-on-destructive-container hover:bg-on-destructive-container/15",
  },
} satisfies Record<ConditionTone, { ROOT: string; DISC: string; ACTION: string }>;

// -----------------------------------------------------------------------------
// Skeletons: placeholder boxes from the loaded constants
// -----------------------------------------------------------------------------

export const SKELETON_LOCAL = {
  EYEBROW: "h-3 w-24 rounded-inline",
  DISC: "size-7 flex-none rounded-pill",
  FIELD: `${FIELD_H} min-w-0 flex-1 rounded-field`,
  VALUE: "h-3 w-14 rounded-inline",
  ROW_TEXT: "h-3 rounded-inline",
  /** SegmentedField's 42px track; full width where the Select stands in for it. */
  SEGMENT: `${CONTROL_H} w-full rounded-pill @xl/card:w-[26rem]`,
  /** The preset track: full width at every size. */
  PRESET: `${CONTROL_H} w-full rounded-pill`,
  /** The sensitivity table: name row plus three rows. */
  GRID: "h-[8.5rem] w-full rounded-tile",
  /** The limit figure / custom field beside a metric's eyebrow. */
  LIMIT: "h-9 w-20 rounded-field",
  ACTION: `${CONTROL_H} w-28 rounded-pill`,
} as const;
