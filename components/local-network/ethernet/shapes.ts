// =============================================================================
// Ethernet Status — shared geometry and tone contract
// =============================================================================
// Ported from the RM520N fork (`components/local-network/ethernet/shapes.ts`).
// Every consumer imports from here, skeletons included, so a skeleton never
// restates a number. The values are the system's:
//
//   104px pinned tile   12px radius   52px disc   42px control
//
// Restated rather than imported from `components/cellular/`: `/local-network/`
// is its own route family.
//
// Tone rule: every tile body is `TILE.BODY` (there is no `tone` prop), and the
// only colour on the strip is the link tile's disc, the one thing here with a
// functional state. The negotiated rate is neutral: a rate is not a direction,
// a radio or a signal quality, so no hue is honest for it.
// =============================================================================

// -----------------------------------------------------------------------------
// The link strip
// -----------------------------------------------------------------------------

/** Band header: label left, the unresponsive chip right. `min-h` reserves the chip's box. */
export const BAND = {
  HEAD: "flex min-h-[1.375rem] items-center gap-3 px-1 pb-0.5",
  LABEL: "text-muted-foreground mr-auto text-xs font-semibold",
  GLYPH: "size-3",
} as const;

/**
 * The tile box. `ROOT` is PINNED at 104px (not floored) so the skeleton, which
 * mirrors `HEIGHT`, hands off without a jump; eyebrow, value and caption all
 * truncate, so nothing clips at the pin.
 */
export const TILE = {
  /** Container queries on `@container/main`, never viewport breakpoints. */
  GRID: "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-2 @5xl/main:grid-cols-4",
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile px-5 py-4",
  HEIGHT: "h-[6.5rem]",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  BODY: "bg-surface-container text-on-surface",
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
  /** The lucide glyph inside DISC: 26px, half the disc. */
  GLYPH: "size-[1.625rem]",
} as const;

/** Disc fills (fill pairs, never container pairs). Only the link tile picks at runtime. */
export const DISC_UP = "bg-success text-success-foreground";
export const DISC_DOWN = "bg-destructive text-destructive-foreground";
export const DISC_NEUTRAL = "bg-surface-container-high text-on-surface-variant";

/** Tone change on the link disc. Two properties, motion tokens through `var()`. */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

/** The label above a tile's figure. */
export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em]";

/** The figure: Rethink Sans `tabular-nums`, never mono (these are quantities and categories). */
export const VALUE =
  "flex min-w-0 items-center gap-2 text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em] tabular-nums";
export const VALUE_TEXT = "truncate";

export const CAPTION = "text-on-surface-variant truncate text-xs";

/** A figure with no reading (rate and duplex while the link is down). */
export const VALUE_NONE = "—";

/** A failed first read, or no controller: ONE tile spanning the grid. */
export const NOTICE_SPAN = "@xl/main:col-span-2 @5xl/main:col-span-4";
export const NOTICE_TITLE = "truncate text-lg font-semibold";

// -----------------------------------------------------------------------------
// The Ethernet Port card
// -----------------------------------------------------------------------------

/** The card's one inner container: a tonal group holding the setting rows. */
export const ROW_GROUP = "flex flex-col gap-0.5 rounded-tile bg-surface-container p-1.5";

/**
 * One setting row. A `min-h` floor, not a pin: the consequence sentence wraps on
 * a narrow card. Stacks below `@2xl/card`, side by side above it.
 */
export const ROW = {
  ROOT: "flex min-h-[5rem] flex-col gap-3 rounded-field px-4 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4 @2xl/card:pl-[1.125rem]",
  /** `flex-1` keeps the text column from collapsing against the control. */
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  LABEL: "text-[0.9375rem] font-semibold",
  /** The consequence sentence. Required: it names the risk (the link drops, and you are on it). */
  CONSEQUENCE: "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  CONTROL: "flex flex-none items-center @2xl/card:ml-auto",
} as const;

/** The Select trigger. It sits on `ROW_GROUP`, so the call site passes `host="container"`. */
export const FIELD =
  "w-full text-[0.84375rem] font-medium @2xl/card:w-auto @2xl/card:min-w-[13.5rem]";

export const FIELD_GLYPH = "size-3.5";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** Full-width route wrapper (no `max-w-*`); container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main mx-auto flex flex-col gap-5 p-2";

/** The two cards under the strip: speed limit and LAN config, side by side on a wide page. */
export const CARD_GRID = "grid grid-cols-1 items-stretch gap-4 @5xl/main:grid-cols-2";
