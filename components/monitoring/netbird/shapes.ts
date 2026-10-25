import type { BadgeVariant } from "@/components/ui/badge";

// NetBird — the /monitoring/netbird family's geometry and tone contract.
// Restated from the Tailscale sibling, never imported across families.
// Skeletons read the same constants the loaded views do (Skeleton-Mirror).

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** Connection beside This device. Below the step each card takes the full width. */
export const COLS =
  "grid grid-cols-1 items-stretch gap-5 *:data-[slot=card]:h-full @3xl/main:grid-cols-2";

/** The `size="action"` Button height, so the rail's skeleton mirrors it. */
const ACTION_HEIGHT = "h-[2.625rem]";

/** The control rail. Wraps rather than scrolling. */
export const RAIL = "flex flex-wrap items-center gap-2.5";

// -----------------------------------------------------------------------------
// The status band
// -----------------------------------------------------------------------------

/** Four tiles that reflow by their own minimum rather than by a breakpoint ladder. */
export const TILE = {
  GRID: "grid gap-3.5 grid-cols-1 @xl/main:grid-cols-2 @6xl/main:grid-cols-4",
  /** 104px PINNED, never floored: a floor cannot mirror a skeleton. */
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile bg-card px-5 py-4 shadow-[var(--shadow-whisper)]!",
  HEIGHT: "h-[6.5rem]",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  GLYPH: "size-[1.625rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
} as const;

/** The band's disc fills. Colour lands here and on the figure, never on the tile. */
export const DISC_TONE = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  good: "bg-success text-success-foreground",
  alert: "bg-warning text-warning-foreground",
  bad: "bg-destructive text-destructive-foreground",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/** Scoped to two properties, and every custom property takes `var()`. */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none";

export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em] uppercase";

/** A live figure: a count, a verdict. `tabular-nums` in the UI face, never mono. */
export const TILE_VALUE =
  "truncate text-[1.125rem] leading-[1.2] font-bold tracking-[-0.015em] tabular-nums";

/** An identifier the device emitted: an address. Machine voice, one step down. */
export const TILE_VALUE_MONO =
  "truncate font-mono text-sm leading-[1.35] font-semibold tracking-[-0.01em]";

/** Ink for a figure reporting something standing. */
export const TILE_VALUE_TONE = {
  neutral: "",
  alert: "text-warning-on-surface",
  bad: "text-destructive-on-surface",
} as const;

export type TileValueTone = keyof typeof TILE_VALUE_TONE;

export const TILE_CAPTION = "text-on-surface-variant truncate text-xs";

/** Machine voice inside a caption: a hostname, a name the device gave verbatim. */
export const TILE_CAPTION_MONO =
  "text-on-surface-variant truncate font-mono text-[0.6875rem]";

// -----------------------------------------------------------------------------
// The verdict chip
// -----------------------------------------------------------------------------

/** The states this surface can report. `notInstalled` renders no chip at all. */
export type NetbirdView =
  | "connected"
  | "disconnected"
  | "serviceStopped"
  | "notInstalled"
  | "unknown";

/** Keyed onto the exported variant type, so a tone with no role fails the build.
 *  Four states land on `muted`, which is exactly why each carries its own glyph. */
export const STATUS_VARIANT = {
  connected: "success",
  disconnected: "muted",
  serviceStopped: "muted",
  notInstalled: "muted",
  unknown: "muted",
} satisfies Record<NetbirdView, BadgeVariant>;

/** Label keys under the `monitoring` namespace's `netbird` block. */
export const STATUS_LABEL_KEY = {
  connected: "netbird.status.connected",
  disconnected: "netbird.status.disconnected",
  serviceStopped: "netbird.status.serviceStopped",
  notInstalled: "netbird.status.notInstalled",
  unknown: "netbird.status.unknown",
} satisfies Record<NetbirdView, string>;

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";

export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** Title block on the left, tags or actions pinned right, both able to shrink. */
export const CARD_HEAD =
  "flex flex-col items-start gap-3 @md/card:flex-row @md/card:gap-4";
export const CARD_HEAD_TEXT = "flex min-w-0 flex-col gap-1.5";
export const CARD_HEAD_ACTIONS =
  "flex flex-none flex-wrap gap-2 @md/card:ml-auto @md/card:justify-end";

/** One foot status: the glyph and its sentence stay one item, so they never
 *  split across lines when the foot wraps on a narrow card. */
export const STATUS_LINE = "flex items-start gap-2 [&>svg]:mt-0.5";

/** The one region inside a stretched card that absorbs the slack. */
export const CARD_BODY = "flex flex-1 flex-col gap-4";

/** Size overrides only; the role stays the `Tag` variant's job. */
export const HEAD_TAG = "h-[1.375rem] px-2.5";

// -----------------------------------------------------------------------------
// Identity rows
// -----------------------------------------------------------------------------

/** 44px PINNED so the skeleton mirrors a row exactly. */
const METRIC_HEIGHT = "h-11";

/** Pill rows, 6px apart, on their own ground. No hairlines in the identity card. */
export const METRIC = {
  HEIGHT: METRIC_HEIGHT,
  STACK: "flex flex-col gap-1.5",
  ROW: `flex ${METRIC_HEIGHT} items-center gap-3 rounded-pill bg-surface-container px-4`,
  LABEL:
    "text-on-surface-variant flex-none text-[0.78125rem] leading-5 font-semibold",
  /** Machine voice: an address, a hostname. */
  VALUE_MONO:
    "text-on-surface ml-auto min-w-0 truncate text-right font-mono text-[0.8125rem] leading-5",
  /** A chip or plain word the device reported. */
  VALUE:
    "text-on-surface ml-auto flex min-w-0 items-center justify-end text-right text-[0.8125rem] leading-5 font-medium",
} as const;

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

/** 66px: the row's resting height, kept as a FLOOR so a longer translated
 *  description can still wrap. The skeleton reads the same constant. */
const SWITCH_MIN_HEIGHT = "min-h-[4.125rem]";

/** A setting's tonal tile. On, it becomes a primary container. */
export const SWITCH_ROW = {
  MIN_HEIGHT: SWITCH_MIN_HEIGHT,
  ROOT: `flex ${SWITCH_MIN_HEIGHT} flex-col items-stretch gap-3 rounded-tile px-[1.125rem] py-3.5 @md/card:flex-row @md/card:items-center @md/card:gap-3.5`,
  REST: "bg-surface-container text-on-surface",
  ON: "bg-primary-container text-on-primary-container",
  TRANSITION:
    "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
  TEXT: "min-w-0 flex-1",
  TITLE: "text-sm font-semibold",
  DESC: "mt-0.5 text-xs opacity-85",
} as const;

/** The setup-key field: a label, the input, and one line of help. */
export const FIELD = {
  ROOT: "flex flex-col gap-1.5",
  LABEL: "text-sm font-semibold",
  HELP: "text-on-surface-variant text-xs leading-[1.5]",
} as const;

// -----------------------------------------------------------------------------
// The peer table
// -----------------------------------------------------------------------------

/** One measurement, one literal: the head row and its skeleton read this. */
const HEAD_HEIGHT = "h-9";

/** A genuine data table, so it keeps hairline rules where a pill list would not. */
export const TABLE = {
  /** PINNED at 52px so the skeleton mirrors the loaded row exactly. */
  ROW_HEIGHT: "h-13",
  HEAD_HEIGHT: HEAD_HEIGHT,
  HEAD: `text-on-surface-variant ${HEAD_HEIGHT} px-3 text-[0.6875rem] font-semibold tracking-[0.02em] uppercase`,
  ROW: "border-border border-b last:border-b-0",
  CELL: "px-3 text-sm",
  /** Machine voice: an address the device emitted. */
  CELL_MONO: "px-3 font-mono text-xs",
  CELL_MUTED: "text-on-surface-variant px-3 text-xs",
  /** A hostname the device reported: machine voice, one line. */
  NAME: "block truncate font-mono text-[0.8125rem] leading-5 font-medium",
  /** The address under the name, shown only while the address column is hidden. */
  SUB_MONO:
    "text-on-surface-variant block truncate font-mono text-xs leading-4 @sm/card:hidden",
} as const;

// -----------------------------------------------------------------------------
// The install panel
// -----------------------------------------------------------------------------

/**
 * The manual install route, the install card's one inner tile. The label sits
 * on the left edge and the command (machine voice) beside it with its copy
 * button; on a narrow card they stack.
 */
export const COMMAND = {
  ROOT: `${SWITCH_ROW.ROOT} ${SWITCH_ROW.REST}`,
  LABEL: `${SWITCH_ROW.TITLE} flex-none`,
  BOX: "flex min-w-0 flex-1 items-center gap-2",
  TEXT: "text-on-surface min-w-0 flex-1 overflow-x-auto font-mono text-xs select-all",
  COPY: "text-on-surface-variant hover:bg-surface-container-high flex-none",
} as const;

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

/** The condition tones this surface can reach, keyed onto `BadgeVariant`. */
export type ConditionTone = Extract<
  BadgeVariant,
  "muted" | "warning" | "destructive"
>;

export const CONDITION = {
  ROOT: "flex flex-1 flex-col items-center justify-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION: "mt-1 px-4",
  /** A line beneath the action. */
  FOOT: "flex items-center gap-2 text-xs font-medium",
} as const;

/**
 * A condition block is one of the sanctioned container uses: the block IS the
 * state. The action pill is drawn from the container's own ink, never a wash.
 */
export const CONDITION_TONE = {
  muted: {
    ROOT: "bg-surface-container text-on-surface",
    DISC: "bg-surface-container-high text-on-surface-variant",
    ACTION: "bg-on-surface/10 text-on-surface hover:bg-on-surface/15",
  },
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
// Notices
// -----------------------------------------------------------------------------

/** A stale-read or health notice: non-blocking, above the thing, never replacing it. */
export const NOTICE =
  "rounded-field flex items-start gap-2 px-3.5 py-2 text-xs leading-[1.45] font-medium";
export const NOTICE_GLYPH = "mt-px size-3.5 flex-none";
export const NOTICE_BODY = "min-w-0 flex-1";

export const NOTICE_TONE = {
  success: "bg-success-container text-on-success-container",
  warning: "bg-warning-container text-on-warning-container",
  destructive: "bg-destructive-container text-on-destructive-container",
} satisfies Partial<Record<BadgeVariant, string>>;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/** Skeleton and content share ONE grid cell, so the swap costs zero layout shift. */
export const CROSSFADE_STACK =
  "grid grid-cols-1 grid-rows-1 *:col-start-1 *:row-start-1";

/** Every placeholder box reads its geometry from the loaded view's own constant. */
export const SKELETON = {
  TILE: `${TILE.HEIGHT} rounded-tile`,
  METRIC: `${METRIC_HEIGHT} rounded-pill`,
  SWITCH: `${SWITCH_MIN_HEIGHT} rounded-tile`,
  ACTION: `${ACTION_HEIGHT} rounded-pill`,
  HEAD: `${HEAD_HEIGHT} rounded-inline`,
  /** Table rows are hairline-separated with NO gap, so the stack takes none. */
  TABLE_STACK: "flex flex-col",
  ROW_SLOT: `flex ${TABLE.ROW_HEIGHT} items-center ${TABLE.ROW}`,
  ROW: "h-5 w-full rounded-inline",
} as const;
