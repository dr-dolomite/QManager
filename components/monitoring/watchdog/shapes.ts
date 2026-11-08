import type { BadgeVariant } from "@/components/ui/badge";

// Watchdog — the /monitoring/watchdog family's geometry and tone contract.
// Skeletons import the same constants the loaded views do (Skeleton-Mirror).
// Geometry is RESTATED from its sibling /monitoring families, never imported.

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** The lucide glyph inside a pill. */
export const PILL_GLYPH = "size-4";

/** The rest tone for a ghost pill in the page header. */
export const HEADER_PILL =
  "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";

/**
 * Ladder 7fr beside Detection 5fr, one height (Symmetric-Pair). Stacks below
 * 56rem. Each card keeps its own height: Detection's disclosures grow and
 * shrink, so the pair is top-aligned rather than stretched.
 */
export const PAIR =
  "grid grid-cols-1 items-start gap-5 @4xl/main:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]";

/** A pair cell: a grid track holding one card. */
export const PAIR_CELL = "grid min-w-0";

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

/** The one anchor card on this surface: the status card. */
export const HERO_SHELL =
  "@container/card gap-5 rounded-hero border-0 bg-card py-7 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";
export const HERO_PAD = "px-7";

export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** A `CardAction` that keeps the title's line, so the description spans under both. */
export const HEAD_ACTION = "row-span-1 self-center";
export const HEAD_DESC_SPAN = "col-span-2";

export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em] uppercase";

/** A small section label over a run of rows (Group-Before-You-Pad). */
export const GROUP_LABEL =
  "text-on-surface-variant flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.02em] uppercase";

// -----------------------------------------------------------------------------
// The status card
// -----------------------------------------------------------------------------

/** The disc carries the phase colour; the card body stays neutral. */
export const DISC_TONE = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  good: "bg-success text-success-foreground",
  alert: "bg-warning text-warning-foreground",
  bad: "bg-destructive text-destructive-foreground",
  info: "bg-primary text-primary-foreground",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/** The one ambient loop on this surface: the loader glyph while a step runs. */
export const GLYPH_SPIN = "motion-safe:animate-spin";

/** Scoped to two properties, and every custom property takes `var()`. */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none";

/** Ink for a figure reporting something standing. Neutral is the default. */
export const FIGURE_TONE = {
  neutral: "",
  alert: "text-warning-on-surface",
  bad: "text-destructive-on-surface",
} as const;

export type FigureTone = keyof typeof FIGURE_TONE;

/**
 * Phase on the left edge, four figures on the right edge, the probe strip
 * under both. The figures recompose on the card's own width: receipt rows
 * under 30rem, a 2x2 grid to 44rem, one row of four above that, and beside the
 * phase once the card is wide enough to hold both.
 */
export const STATUS = {
  BODY: "flex flex-col gap-5",
  HEAD: "flex flex-wrap items-center gap-x-8 gap-y-4",
  PHASE: "flex min-w-0 flex-[1_1_18rem] items-center gap-3.5",
  DISC: "grid size-11 flex-none place-items-center rounded-pill",
  GLYPH: "size-[1.375rem]",
  TEXT: "flex min-w-0 flex-col gap-0.5",
  TITLE: "text-xl leading-[1.2] font-bold tracking-[-0.01em] text-pretty",
  BLURB: "text-on-surface-variant text-[0.8125rem] text-pretty",
  BLURB_NUM: "text-on-surface-variant text-[0.8125rem] text-pretty tabular-nums",
  FIGS: "grid flex-[1_1_100%] grid-cols-1 gap-2.5 @[30rem]/card:grid-cols-2 @[30rem]/card:gap-x-7 @[30rem]/card:gap-y-4 @[44rem]/card:grid-cols-4 @[64rem]/card:flex-[0_1_auto] @[64rem]/card:grid-cols-[repeat(4,auto)]",
  /** A receipt row on a phone (grid placement); a stacked figure above 30rem (flex ignores placement). */
  FIG: "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 @[30rem]/card:flex @[30rem]/card:flex-col @[30rem]/card:items-start @[30rem]/card:gap-0.5",
  FIG_EYEBROW: "col-start-1 row-start-1 whitespace-nowrap",
  FIG_VALUE:
    "col-start-2 row-span-2 row-start-1 text-xl leading-[1.15] font-bold tracking-[-0.01em] tabular-nums @[30rem]/card:col-auto @[30rem]/card:row-auto",
  FIG_CAPTION:
    "text-on-surface-variant col-start-1 row-start-2 text-xs text-pretty tabular-nums",
} as const;

/** A line placeholder's height for the phase title, eyebrow and figure value. */
const STATUS_LINE = {
  TITLE: "h-5",
  BLURB: "h-3.5",
  EYEBROW: "h-3",
  VALUE: "h-[1.375rem]",
} as const;

const STRIP_HEIGHT = "h-10";

/** One bar per probe, newest on the right. A failed probe is a full red bar. */
export const STRIP = {
  /** Slots drawn, so a short history still reads as "the last N, padded". */
  SLOTS: 60,
  ROOT: "flex flex-col gap-2",
  HEAD: "text-on-surface-variant flex items-center justify-between gap-3 text-xs",
  TITLE: "text-on-surface text-[0.8125rem] font-semibold",
  HEIGHT: STRIP_HEIGHT,
  BARS: `flex ${STRIP_HEIGHT} items-end gap-0.5`,
  /** The full-height hover target around a bar, so a short bar is no harder to read. */
  CELL: "flex h-full min-w-0 flex-1 items-end",
  TIP: "text-xs tabular-nums",
  /** A data mark, not a role shape: the 3px radius keeps 60 bars from fusing. */
  BAR: "w-full min-w-0 rounded-[3px]",
  BAR_OK: "bg-primary",
  BAR_MISS: "h-full bg-destructive",
  BAR_NONE: "h-full bg-surface-container-high",
  FOOT: "text-on-surface-variant flex items-center justify-between gap-3 text-xs tabular-nums",
  EMPTY: `rounded-field bg-surface-container text-on-surface-variant grid ${STRIP_HEIGHT} place-items-center px-3 text-xs`,
  /** Bar height = floor + span × (value / max), in percent. */
  FLOOR_PCT: 22,
  SPAN_PCT: 60,
} as const;

// -----------------------------------------------------------------------------
// The recovery ladder
// -----------------------------------------------------------------------------

const RUNG_MIN_HEIGHT = "min-h-14";

/**
 * One rung: a numbered disc that carries the step's state, a name over one
 * cost-or-state line, and its control. Below a 30rem card the control takes a
 * second row under the text. A rung's own fields (backup slot, reboot cap)
 * hang in a `SUB` row aligned to the text column.
 */
export const RUNG = {
  STACK: "flex flex-col gap-1",
  MIN_HEIGHT: RUNG_MIN_HEIGHT,
  ROOT: `-mx-3 grid ${RUNG_MIN_HEIGHT} grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-tile px-3 py-2 @[30rem]/card:grid-cols-[2rem_minmax(0,1fr)_auto] @[30rem]/card:items-center`,
  REST: "text-on-surface",
  TRANSITION:
    "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
  DISC: "col-start-1 row-start-1 mt-0.5 grid size-8 flex-none place-items-center rounded-pill text-[0.8125rem] font-semibold tabular-nums @[30rem]/card:mt-0",
  /** A child row's disc is a small glyph, not a numbered disc. */
  DISC_CHILD: "size-6 justify-self-center",
  DISC_REST: "bg-surface-container-high text-on-surface-variant",
  /** Running: a step is in progress or being checked. */
  DISC_RUNNING: "bg-primary text-primary-foreground",
  /** Tried in this round. */
  DISC_DONE: "bg-success text-success-foreground",
  /** Resting or gave up: a standing limit, not a failure. */
  DISC_LIMIT: "bg-warning text-warning-foreground",
  /** Not used for this reason, or not available on this modem. */
  DISC_NA: "bg-surface-container text-on-surface-variant",
  DONE_GLYPH: "size-4",
  TEXT: "col-start-2 row-start-1 flex min-w-0 flex-col gap-px",
  NAME: "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-pretty",
  NAME_INACTIVE: "text-on-surface-variant",
  COST: "text-on-surface-variant text-[0.78125rem] text-pretty tabular-nums",
  /** The cost line when the step is in a state worth reading. */
  COST_STATE: "text-on-surface text-[0.78125rem] text-pretty tabular-nums",
  CONTROLS:
    "col-start-2 row-start-2 flex items-center gap-2.5 justify-self-end @[30rem]/card:col-start-3 @[30rem]/card:row-start-1",
  /** Aligned to the text column, under the name and cost line. */
  SUB: "col-start-2 col-end-[-1] flex flex-wrap items-center gap-x-3 gap-y-2 pb-1",
  SUB_LABEL: "text-on-surface-variant inline-flex items-center gap-1.5 text-[0.8125rem] whitespace-nowrap",
  ERROR: "text-destructive-on-surface col-start-2 col-end-[-1] text-xs leading-[1.5]",
} as const;

/** The master row: a plain key-left / pill-right row at the head of the ladder. */
export const MASTER = {
  ROW: "flex min-h-[2.625rem] flex-wrap items-center justify-between gap-x-4 gap-y-2",
  KEY: "text-sm font-semibold",
} as const;

// -----------------------------------------------------------------------------
// Fields
// -----------------------------------------------------------------------------

const FIELD_HEIGHT = "h-[2.625rem]";

/** A compact number with its unit inside the field (InputGroup). */
export const NUM_FIELD = {
  HEIGHT: FIELD_HEIGHT,
  GROUP: `${FIELD_HEIGHT} w-auto flex-none data-[disabled=true]:opacity-50`,
  /** The group dims as a whole; the input's own disabled dim would compound. */
  INPUT:
    "h-full w-[3.5rem] flex-none pr-1.5 pl-3 text-right text-[0.9375rem] font-semibold tabular-nums disabled:opacity-100 md:text-[0.9375rem]",
  UNIT: "text-on-surface-variant pr-3 pl-0 text-[0.8125rem] font-normal whitespace-nowrap group-data-[disabled=true]/input-group:opacity-100",
} as const;

// -----------------------------------------------------------------------------
// Disclosures ("Advanced", "If the link drops")
// -----------------------------------------------------------------------------

export const DISCLOSURE = {
  ROOT: "flex flex-col",
  TRIGGER:
    "group/disclosure -mx-2 flex min-h-[2.625rem] w-[calc(100%+1rem)] items-center gap-2 rounded-field px-2 text-left text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
  CHEV: "text-on-surface-variant size-4 flex-none transition-transform duration-[var(--duration-quick)] ease-[var(--ease-quick)] group-data-[state=open]/disclosure:rotate-90 motion-reduce:transition-none",
  SUMMARY:
    "text-on-surface-variant ml-auto min-w-0 truncate text-[0.78125rem] font-normal tabular-nums",
  SUMMARY_LIVE: "text-primary-on-surface font-medium",
  BODY: "flex flex-col gap-4 pt-1 pb-2",
} as const;

// -----------------------------------------------------------------------------
// Detection
// -----------------------------------------------------------------------------

/** Receipt rows: key left, control right. */
export const DETECT = {
  BODY: "flex flex-1 flex-col gap-5",
  /** The read-only fact line at the head of the card. */
  READ: "flex min-h-[2.625rem] flex-wrap items-center justify-between gap-x-4 gap-y-1",
  READ_TEXT: "text-sm font-medium tabular-nums",
  READ_NOTE: "text-on-surface-variant font-normal",
  GROUP: "flex flex-col gap-3",
  ROW: "flex min-h-[2.625rem] flex-wrap items-center justify-between gap-x-4 gap-y-2",
  KEY: "inline-flex items-center gap-1.5 text-sm font-medium",
  SUBKEY: "text-on-surface-variant inline-flex items-center gap-1.5 text-sm",
  CAPTION:
    "text-on-surface-variant flex flex-wrap items-center gap-x-2 text-[0.78125rem] text-pretty tabular-nums",
  /** The value the clamp turns a typed number into: "-> 20 s". */
  EFFECTIVE: "text-primary-on-surface inline-flex items-center gap-1 text-[0.8125rem] font-medium tabular-nums",
  LINK: "text-primary-on-surface inline-flex items-center gap-0.5 text-[0.8125rem] font-medium underline-offset-4 hover:underline",
  /** A field and its inline readout, kept on one line. */
  LINE: "ml-auto flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1",
  ERROR: "text-destructive-on-surface basis-full text-right text-xs leading-[1.5]",
  /** Five segments fit a 30rem card only at the tighter padding. */
  PRESET_PILL: "[&_[data-slot=toggle-group-item]]:px-3",
  /** The consequence line that stays visible beside a risky toggle. */
  CONSEQUENCE:
    "text-warning-on-surface flex items-start gap-1.5 text-[0.78125rem] text-pretty",
  SEP: "bg-border h-px w-full",
} as const;

/** The derived reading: dot rows on the card's own ground. */
export const TIMELINE = {
  ROWS: "flex flex-col gap-2.5",
  ROW: "flex items-center gap-3 text-[0.8125rem]",
  DOT: "size-2 flex-none rounded-pill bg-surface-container-high",
  DOT_DONE: "bg-success",
  DOT_NOW: "bg-primary",
  DOT_REST: "bg-warning",
  KEY: "min-w-0 flex-1 text-pretty",
  KEY_QUIET: "text-on-surface-variant",
  VALUE: "flex-none font-medium tabular-nums",
  NOTE: "text-on-surface-variant min-w-0 flex-1 text-[0.78125rem] text-pretty",
} as const;

// -----------------------------------------------------------------------------
// The activity log
// -----------------------------------------------------------------------------

/** One day's block of rows. 6px apart, no hairline rules. */
export const LOG = "flex flex-col gap-1.5";

/** The stack of day blocks. */
export const LOG_STACK = "flex flex-col gap-3";

/** The header link to the full Network Events log. */
export const LOG_LINK =
  "text-primary-on-surface hover:bg-surface-container dark:hover:bg-surface-container h-9 gap-1 pr-2.5 pl-3.5 text-[0.8125rem]";

/** The newest rows shown; the rest live on Network Events. */
export const LOG_LIMIT = 6;

/**
 * PINNED at 52px, which is what lets the skeleton mirror it exactly: 8px of
 * padding over an 18.9px message line, a 2px gap and a 16px meta line.
 */
const ROW_HEIGHT = "h-[3.25rem]";

export const ROW = {
  HEIGHT: ROW_HEIGHT,
  ROOT: `flex ${ROW_HEIGHT} items-center gap-3 rounded-tile px-4 py-2`,
  TRANSITION:
    "transition-colors duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
  DISC: "grid size-8 flex-none place-items-center rounded-pill",
  GLYPH: "size-4",
  BODY: "flex min-w-0 flex-1 flex-col gap-[2px]",
  MESSAGE: "truncate text-sm leading-[1.35] font-medium",
  META: "flex h-4 min-w-0 items-center gap-1.5",
  /** The detail line under a message: the reason, in plain words. */
  DETAIL: "truncate text-[0.75rem] leading-none",
  WHEN: "flex flex-none flex-col items-end pl-2",
  RELATIVE: "text-[0.8125rem] leading-none font-semibold tabular-nums",
  ABSOLUTE: "text-[0.6875rem] leading-none tabular-nums pt-[4px]",
} as const;

/** Ink for the absolute time and detail on a row with no chromatic container. */
export const ABSOLUTE_INK = "text-on-surface-variant";

/**
 * Activity tones. Each event code owns one (tone, glyph) pair, so a row is told
 * apart by shape before it is read. `fill` is the tonal container a recent row
 * wears for its first hour; the disc keeps the role colour for good.
 */
export const ACTIVITY_TONE = {
  success: {
    disc: "bg-success text-success-foreground",
    fill: "bg-success-container text-on-success-container",
  },
  warning: {
    disc: "bg-warning text-warning-foreground",
    fill: "bg-warning-container text-on-warning-container",
  },
  destructive: {
    disc: "bg-destructive text-destructive-foreground",
    fill: "bg-destructive-container text-on-destructive-container",
  },
  info: {
    disc: "bg-primary text-primary-foreground",
    fill: "bg-primary-container text-on-primary-container",
  },
  muted: {
    disc: "bg-surface-container-high text-on-surface-variant",
    fill: "bg-surface-container",
  },
} as const;

export type ActivityTone = keyof typeof ACTIVITY_TONE;

/** The day divider. The one place the canon allows a square edge. */
export const DAY = {
  ROOT: "flex items-center gap-3 px-1",
  LABEL:
    "text-on-surface-variant shrink-0 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase",
  RULE: "h-px flex-1 bg-border",
} as const;

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

/** Keyed onto `BadgeVariant` so a tone with no matching role fails the build. */
export type ConditionTone = Extract<BadgeVariant, "muted" | "destructive">;

export const CONDITION = {
  ROOT: "flex flex-col items-center justify-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION: "mt-1 px-4",
} as const;

/** The block IS the state; the retry pill draws from the container's own ink. */
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
} satisfies Record<
  ConditionTone,
  { ROOT: string; DISC: string; ACTION: string }
>;

// -----------------------------------------------------------------------------
// Card feet: Ladder and Detection each commit their own draft
// -----------------------------------------------------------------------------

export const FOOT = {
  /** One status line: glyph or dot, then a sentence that wraps. */
  LINE: "flex min-w-0 items-center gap-2",
} as const;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/** Every box reads the loaded view's own constant. A restated number is a lie. */
export const SKELETON = {
  LINE: "rounded-inline",
  STATUS_TITLE: `${STATUS_LINE.TITLE} rounded-inline`,
  STATUS_BLURB: `${STATUS_LINE.BLURB} rounded-inline`,
  FIG_EYEBROW: `${STATUS_LINE.EYEBROW} rounded-inline`,
  FIG_VALUE: `${STATUS_LINE.VALUE} rounded-inline`,
  STRIP: `${STRIP_HEIGHT} rounded-field`,
  /** Line boxes (font size × line height) of the text each one stands in for. */
  CARD_TITLE: "h-[1.40625rem] rounded-inline",
  CARD_DESC: "h-5 rounded-inline",
  EYEBROW: "h-[1.03125rem] rounded-inline",
  TIMELINE_ROW: "h-5 rounded-inline",
  DETECT_CAPTION: "h-[1.1875rem] rounded-inline",
  FOOT_STATUS: "h-5 rounded-inline",
  RUNG_NAME: "h-5 w-40 rounded-inline",
  RUNG_COST: "h-[1.1875rem] w-52 rounded-inline",
  ROW: `${ROW_HEIGHT} rounded-tile`,
  FIELD: `${FIELD_HEIGHT} rounded-field`,
  /** A `size="action"` Button or a SegmentedField track. */
  PILL: "h-[2.625rem] rounded-pill",
} as const;
