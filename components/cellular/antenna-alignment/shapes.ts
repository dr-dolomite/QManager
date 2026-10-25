// =============================================================================
// Antenna Alignment — geometry and tone contract
// =============================================================================
// The single source of truth for this route family's geometry, imported by
// every consumer INCLUDING the skeletons. A skeleton that restates a number has
// left the contract (DESIGN.md > The Skeleton-Mirror Rule).
//
// This file exists because the surface shipped without one while every sibling
// /cellular/ family had one, and the drift was measurable: four byte-identical
// card-shell strings duplicated across three files, three different control
// heights (40 / 42 / 44px) in one card, five glyph sizes, two spellings of the
// same duration token, and two arbitrary letter-spacings for one label role.
// None of that was visible in any single file, which is exactly why it survived.
//
// House convention: geometry is RESTATED across sibling routes, never imported
// from one. A surface takes no dependency on another route's module graph.
// Genuinely family-wide primitives get promoted to `components/cellular/`
// instead — which is what `tile-shape.ts` and `signal-quality-display.ts` are.
//
// LOAD-BEARING, do not "simplify":
//   * Never interpolate a Tailwind class. `@${step}/main:flex` and
//     `min-h-[${x}]` compile to no rule at all and fail silently.
//   * Container queries only (`@container/main`), never viewport breakpoints.
//     Viewport widths are for the page gutter and the shell alone.
//   * Every pinned HEIGHT mirrors its ROOT's resolved height AND radius. A
//     `min-h-` is not a mirror — measured drift on this page's twin was 26px.
// =============================================================================

import type { MaterialSymbolName } from "@/components/ui/material-symbol";

/**
 * The one small-caps key role on this surface, declared once.
 *
 * It forked before: the same label wore `tracking-[0.06em]` in one file and
 * `tracking-[0.09em]` in another, which is invisible in review and legible on
 * screen. Declared above its consumers so `as const` still infers literals.
 */
export const KEY_LABEL =
  "shrink-0 text-xs font-semibold uppercase tracking-[0.09em] text-on-surface-variant";

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

export const PAGE_SHELL = "@container/main mx-auto flex flex-col gap-5 p-2";
export const PAGE_TITLE = "text-3xl font-bold tracking-[-0.02em]";
export const PAGE_DESCRIPTION =
  "text-on-surface-variant text-sm leading-relaxed text-pretty";
export const PAGE_HEADER_BLOCK = "flex max-w-[41rem] flex-col gap-1.5";

/**
 * The two-column split.
 *
 * The console column must STRETCH — the grid's default — and this is the whole
 * pinned console, so do not "tidy" an `items-start` onto it.
 *
 * A sticky element travels inside its own containing block, which is its
 * parent. Under `items-start` the console column shrinks to the console's own
 * height and the sticky child never moves at all. `stretch` resolves the
 * column to the taller work column's height and `CONSOLE.SHELL`'s `h-full`
 * then fills that exactly, per the equal-height hard rule — so Live Aim and
 * Positions match, `top-4` still pins the card's top edge, and there is no
 * separate travel distance left for the console to ride.
 */
export const CONSOLE_SPLIT = "grid grid-cols-1 gap-5 @4xl/main:grid-cols-12";
/**
 * `flex flex-col`, not a bare grid cell: the sticky wrapper inside needs a
 * flex parent to stretch into, which is what lets the console CARD match
 * `Positions`' height exactly (the hard equal-height rule) rather than
 * riding loose inside a taller column.
 */
export const CONSOLE_COLUMN = "flex flex-col @4xl/main:col-span-5";

/**
 * Positions, then Receive Chains, stacked beside the console.
 *
 * Chains lived in a full-width row beneath the split while the console was
 * 403px tall. The live lead took the console to ~620px, and Positions — locked
 * to that height and holding ~400px of rows — stranded ~200px of empty card
 * under its Record button, with Chains pushed below the fold at 1080p. In this
 * column, with compact tiles, the two cards land within ~70px of the console,
 * so the whole page reads in one desktop viewport. Mobile order is unchanged:
 * console, positions, chains.
 *
 * Whichever side is shorter absorbs the difference in ONE region: the live
 * trace on the console (`LIVE.SPARK_SLOT`), the Chains card here (`CARD_FILL`).
 */
export const WORK_COLUMN = "flex flex-col gap-5 @4xl/main:col-span-7";

// -----------------------------------------------------------------------------
// The console — the pinned aim instrument
// -----------------------------------------------------------------------------

/**
 * The two work-column cards. `rounded-card` (16px), because this surface's one
 * `rounded-hero` (20px) belongs to the console — a grid of peers takes `card`
 * and the card that anchors the surface takes `hero`.
 *
 * Declared here rather than in either card, and imported by the skeleton too:
 * this exact string existed as four byte-identical copies across three files
 * before, which is the drift this module was created to end.
 */
export const CARD_SHELL =
  "gap-5 rounded-card border-0 bg-surface px-6 py-6 shadow-[var(--shadow-whisper)]";
/**
 * The work column's slack absorber: the LAST card grows to meet the console's
 * height. Never on Positions — `h-full` there claimed the whole column.
 */
export const CARD_FILL = "flex-1";
export const CARD_TITLE = "min-w-0 truncate text-lg font-semibold";
export const CARD_DESCRIPTION = "min-w-0 text-sm leading-relaxed text-pretty";
export const CARD_HEADER = "gap-1 px-0";
export const CARD_CONTENT = "flex flex-col gap-4 px-0";

export const CONSOLE = {
  /**
   * `flex-1`, so the wrapper fills `CONSOLE_COLUMN`'s stretched height rather
   * than sizing to the console's own content. Paired with `SHELL`'s `h-full`
   * this is what makes Live Aim match Positions exactly — the equal-height
   * hard rule takes priority over the sticky card riding loose in extra
   * column slack, so `top-4` still pins the card's top edge, but there is no
   * longer any travel distance left to ride.
   */
  STICKY: "flex-1 @4xl/main:sticky @4xl/main:top-4",
  SHELL:
    "h-full gap-5 rounded-hero border-0 bg-surface px-7 py-6 shadow-[var(--shadow-whisper)]",
  TITLE: "min-w-0 truncate text-lg font-semibold",
  DESCRIPTION: "min-w-0 text-sm leading-relaxed text-pretty",

  /**
   * The lead numeral. 40px, down from 52: the card used to carry two ramp-red
   * headline figures (52px RSRP over a 32px score), and at the cell edge both
   * shouted the same red. One figure leads now, and it leads by size alone.
   */
  SCORE: "text-[40px] font-semibold leading-none tabular-nums",
  SCORE_BOX: "h-10",

  /**
   * An 8px meter lane, the one thickness every bar in the product uses. The
   * relative box is what the session-peak tick is registered against.
   */
  METER_LANE: "relative flex h-2 items-center",
  /**
   * The session peak. Positioned with `left`, deliberately never animated: a
   * peak is a discrete event, and DESIGN.md's Transform-Only Rule keeps layout
   * properties out of transitions. Snapping is the honest gesture.
   */
  PEAK_TICK: "absolute top-[-2px] h-3 w-0.5 rounded-pill bg-on-surface-variant",

  /** One weighted leg. A 40px metric-row pill, per DESIGN.md > Metric rows. */
  LEG_ROW:
    "flex items-center gap-3 rounded-pill bg-surface-container px-4 py-2.5",
  LEG_KEY: KEY_LABEL,
  /** The 56px inline bar lane. An 8px bar centres in the same 20px line box a
   *  4px one did, so the 40px leg row is unchanged — measured, not assumed. */
  LEG_LANE: "w-14 shrink-0",
  LEG_VALUE: "w-[4.75rem] shrink-0 text-right text-[13px]/5 font-semibold tabular-nums",
  /**
   * The scoring weights. Kept, because the score never appears alone, and
   * printing what it is made of is the difference between an instrument and an
   * oracle. Demoted to a label, because at value weight they read as a second
   * reading.
   */
  LEG_WEIGHT: "ml-1.5 text-xs font-medium tabular-nums text-on-surface-variant",

  /** The small-caps key above the lead numeral and over each section. */
  EYEBROW: KEY_LABEL,
  CAPTION: "text-xs text-on-surface-variant",

  /**
   * A labelled group: the score's "Now" row, then the legs. Section labels
   * replace the divider that used to split lead from score; alignment and a
   * label already say "new group", so the rule was a second separator.
   */
  SECTION: "flex flex-col gap-2.5",
  SECTION_HEAD: "flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1.5",
  LEGS: "flex flex-col gap-2",

  /**
   * The composite score, as ONE Position-shaped row: label, 28px score,
   * flex-1 bar with the session-best tick, delta. It was a 32px ramp-red
   * numeral over its own full-width meter, a second headline under the lead.
   * Sharing the recorder row's anatomy (`SLOT.*`) says what it is: the reading
   * you would record here, on the same scale as the rows beside it.
   */
  NOW_ROW:
    "flex h-16 items-center gap-3 rounded-pill bg-surface-container px-4 text-on-surface",
  /**
   * Sized to its word, not to the recorder's 5.5rem label slot: this row sits
   * in another card, so there is no column to align with, and on a phone the
   * fixed slot plus a 44px delta slot left the bar ~43px.
   */
  NOW_LABEL: "shrink-0 text-[13px] font-semibold text-on-surface-variant",
  NOW_LANE: "min-w-0 flex-1",
  /** Fixed, so the bar does not jump when the delta appears or clears. */
  NOW_DELTA:
    "flex w-8 shrink-0 items-center justify-end gap-0.5 text-xs font-semibold tabular-nums text-on-surface-variant",
} as const;

/**
 * The live lead: serving-cell RSRP from the live file, above the 2 s score.
 *
 * It takes the console's numeral because it is the figure that moves as the
 * antenna does (1 Hz). The steering cue, distance back to the session peak,
 * holds the numeral row's right edge: it is the figure a sweep is steered by,
 * and as a 12px grey caption it was the quietest text on the card.
 */
export const LIVE = {
  BLOCK: "flex flex-col gap-2.5",
  /** Wraps, so a long locale drops the chip to its own line instead of
   *  pushing it out of the card (Italian runs ~370px at phone width). */
  KEY_ROW: "flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1.5",
  NUMERAL_ROW: "flex items-end justify-between gap-3",
  NUMERAL: "flex min-w-0 items-baseline gap-1.5",
  UNIT: "text-base font-semibold text-on-surface-variant",
  /** Distance to peak (16px/600) over the peak itself (12px caption). */
  TO_PEAK: "flex shrink-0 flex-col items-end gap-0.5 text-right",
  TO_PEAK_VALUE: "text-base/5 font-semibold tabular-nums text-on-surface",
  TO_PEAK_CAPTION: "text-xs tabular-nums text-on-surface-variant",
  /** Muting rides opacity on the trace and the meter, never their hue. */
  MUTABLE:
    "transition-opacity duration-(--duration-standard) ease-standard",
  MUTED: "opacity-45",
  /**
   * The console's slack absorber. When the work column is the taller side the
   * trace grows into the difference instead of leaving a gap under the legs —
   * more vertical resolution on the one graph a sweep is read from. 48px floor,
   * 208px ceiling. The console's HEIGHT is set by the work column, never by
   * this cap: a lower ceiling (112px was tried) only turned the slack into an
   * empty band above the score. The 1440 console was fixed by shortening the
   * work column (`PORT.GRID`'s 4-up step). Past the ceiling the block itself
   * takes the rest, which leaves the score group on the card's bottom edge.
   */
  BLOCK_FILL: "flex-1",
  SPARK_SLOT: "flex max-h-52 min-h-12 flex-1 flex-col",
  SPARK: "block min-h-12 w-full flex-1 overflow-visible",
  /** Neutral: the trace is shape, not verdict. The numeral and meter carry it. */
  SPARK_INK: "text-on-surface-variant",
} as const;

// `CONSOLE.LEG_KEY` deliberately carries NO fixed width, even though a column
// rule would align "RSRP" under "SINR". The weight annotation renders inside
// the key element, so "RSRP 60%" would overflow any width narrow enough to be
// worth setting. The lane and value align on the right instead.

/**
 * The condensed readout that pins once the full console scrolls away.
 *
 * Mobile only: on `@4xl/main` and wider the console itself is sticky and this
 * never mounts. It is a SEPARATE element rather than a collapsing console on
 * purpose — a collapse animates height, which is off DESIGN.md's transform-and-
 * opacity scale, while a second element crossfades on pure opacity + translate.
 *
 * The fill is a solid container step, never an alpha wash or a backdrop blur:
 * an alpha over a scrolling page collapses in dark mode, and the Tonal-
 * Elevation Rule already owns "this floats above that".
 *
 * The wrapper is `h-0`, which is the whole trick: a zero-height sticky element
 * placed first inside the page column pins at the top for the page's entire
 * scroll range and contributes NO layout, so the resting page is not 64px
 * taller for a bar nobody has summoned yet. The bar overflows downward out of
 * it and crossfades on a sentinel.
 *
 * It stays inset and pill-shaped rather than spanning full-bleed: DESIGN.md
 * gives pill radius to "chips, buttons, nav items, metric rows, meters", and a
 * pinned readout is a meter. A full-bleed bar would be the one square-cornered
 * element on the surface.
 */
export const CONDENSED = {
  ROOT: "sticky top-0 z-20 h-0 @4xl/main:hidden",
  /**
   * An opaque shade behind the pill, spanning the page gutter and the gap above
   * it. Without it the bar floats with a transparent 8px band over its head and
   * the page scrolls through that band — measured, a primary button slid across
   * the top of the viewport above the pinned readout, which reads as a z-index
   * bug rather than as a pinned element. The shade carries the crossfade too,
   * so ground and bar arrive as one object.
   */
  SHADE: "-mx-2 bg-background px-2 pt-2 pb-2 transition-opacity duration-(--duration-standard) ease-standard",
  /**
   * `surface-container-high`, one step ABOVE the slot rows, and it keeps the
   * console's key label.
   *
   * Both are here for one reason: at `bg-surface-container` this pill was
   * geometrically identical to a position row — same `h-16`, same
   * `rounded-pill`, same fill, same numeral-plus-meter anatomy — and it pins
   * directly above three of them. The behaviour was right and the read was
   * wrong: a floating instrument looked like a slot that had come loose. The
   * tonal step says "above", and the label says which instrument.
   */
  BAR: "flex h-16 items-center gap-3 rounded-pill bg-surface-container-high px-5 shadow-[var(--shadow-whisper)]",
  KEY: KEY_LABEL,
  HIDDEN: "pointer-events-none opacity-0",
  SHOWN: "opacity-100",
  SCORE: "shrink-0 text-[28px] font-semibold leading-none tabular-nums",
  LANE: "min-w-0 flex-1",
  /** The live pill's figure: numeral plus unit on one baseline. */
  FIGURE: "flex shrink-0 items-baseline gap-1",
  UNIT: "text-xs font-semibold text-on-surface-variant",
  /** Distance to peak on the pill's right edge, the lead's steering cue. */
  TO_PEAK: "shrink-0 text-right text-base font-semibold tabular-nums text-on-surface",
} as const;

// -----------------------------------------------------------------------------
// Positions — the recorder
// -----------------------------------------------------------------------------

/**
 * Three comparison ROWS, at every width — not a grid of tiles.
 *
 * The outgoing card stacked three 290px tiles down the phone, 923px for a card
 * that displays nothing until used: 39% of the page, and 1.1 phone screens of
 * empty affordance. Rows also make the comparison readable by BAR LENGTH on one
 * shared 0-100 scale, so "which position won" is answered by shape rather than
 * by reading three numerals against each other.
 */
export const SLOT = {
  STACK: "flex flex-col gap-3",
  ROOT: "flex h-16 items-center gap-3 rounded-pill px-4 transition-colors duration-(--duration-standard) ease-standard",
  HEIGHT: "h-16",
  NEUTRAL: "bg-surface-container text-on-surface",
  /** The winning position. Highlight-by-Container, never a ring around a block. */
  BEST: "bg-primary-container text-on-primary-container",
  /**
   * For a raw `<input>`, not `Input`: the primitive's `md:text-sm` is a viewport step on a container-query surface.
   */
  /**
   * A SHELL around the input, not the input itself — the page's only text field
   * has to look like one.
   *
   * At `border-0` on a single tonal step it read as a static chip in a row full
   * of static chips, so the one editable thing on the surface advertised
   * nothing. DESIGN.md keeps inputs borderless at rest, so the affordance is a
   * glyph rather than a stroke: the fill and radius stay canon and an `edit`
   * mark says the value is yours to change. The shell owns fill, radius, height
   * and focus ring; the `<input>` inside is transparent and unstyled.
   */
  LABEL_SHELL:
    "flex h-11 w-[5.5rem] shrink-0 items-center gap-1.5 rounded-field bg-surface-container-high px-3 focus-within:ring-[3px] focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
  LABEL_FIELD:
    "min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] font-semibold focus-visible:outline-none",
  LABEL_STATIC: "w-[5.5rem] shrink-0 truncate text-[13px] font-semibold",
  /**
   * Ramp ink applies on a NEUTRAL row only. On the winning row the score
   * inherits `on-primary-container` instead: `--quality-N` is computed for
   * 4.5:1 against a card ground, not against `primary-container`, and in dark
   * mode a bright ramp ink on a deep-blue container is the weakest pair on the
   * surface. Quality is still carried there by bar length and the `sr-only`
   * verdict, which is the non-chromatic channel the rule actually requires.
   */
  SCORE: "w-[3.25rem] shrink-0 text-right text-[28px] font-semibold leading-none tabular-nums",
  LANE: "min-w-0 flex-1",
  CAPTION: "text-xs",
  /** 44px, the coarse-pointer floor. Every slot-level action uses this. */
  ICON_TARGET: "size-11 shrink-0",
  /** Sample progress is dots, never a fill — a bar would make a count look measured. */
  DOT: "size-2 rounded-pill transition-colors duration-(--duration-standard) ease-standard",
} as const;

// -----------------------------------------------------------------------------
// Receive chains — the diagnostic footnote
// -----------------------------------------------------------------------------

/**
 * One column on a phone card, 2-up from `@md/card`, 4-up on a wide card. The
 * phone runs one column by user call (2026-10-25): a 2x2 of ~140px squares
 * cramped every tile, while full-width tiles keep the bar long enough to read.
 * The 743px one-column strip this once replaced had tall, unpinned tiles; these
 * keep their `HEIGHT_*` pin.
 */
export const PORT = {
  /** Declared on the Chains card's content, so the grid steps on its own width. */
  CONTAINER: "@container/card",
  /**
   * 4-up from `@xl/card` — a CARD step, because the card lives in the 7-of-12
   * work column and the page width says nothing about its cells.
   *
   * The history is the rule: a `@4xl/main` step in this column once gave a
   * ~123px block, `px-4` left ~91px inside, and the INLINE bar lane collapsed
   * to nothing — DESIGN.md's named bug of ramp ink with no bar beside it. **Cost
   * a grid step against the narrowest cell it produces in the column it
   * actually lives in.** The metric now stacks its bar full-width under the
   * key and value, so 576px of card content (~137px blocks, ~109px inside)
   * still carries a full bar. The step was `@3xl/card` (768px) until
   * 2026-10-25: at 1440 the 579px card ran 2x2, ~130px taller than one row,
   * and the console, matched to this column's height, carried it as a hole.
   */
  GRID: "grid grid-cols-1 gap-2.5 @md/card:grid-cols-2 @xl/card:grid-cols-4 @2xl/card:gap-3.5",
  ROOT: "flex flex-col gap-2 rounded-tile bg-surface-container px-3.5 py-3.5 @2xl/card:px-4",
  /**
   * Pinned per radio mode: one metric (LTE-only or SA) or two (EN-DC). A single
   * pin sized for two left every LTE tile ~40px of empty floor.
   */
  HEIGHT_SINGLE: "h-[5.75rem] @md/card:h-[7.375rem]",
  HEIGHT_DUAL: "h-[8.125rem] @md/card:h-40",
  /**
   * Name and RX line. One row on a one-column phone card, where the tile is
   * ~295px wide and both fit; stacked from `@md/card`, where a 2-up block is
   * too narrow for "Diversity" beside its RX pill. The pins above move with it
   * (26px per tile).
   */
  HEAD: "flex min-w-0 items-center justify-between gap-2 @md/card:flex-col @md/card:items-stretch @md/card:justify-start",
  NAME: "min-w-0 truncate text-sm font-semibold",
  RX: "inline-flex shrink-0 items-center rounded-pill bg-surface-container-high px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.09em] text-on-surface-variant",

  /**
   * A metric is a baseline row of key + value with the bar on its own full
   * width beneath — the same anatomy `radio/active-bands-card.tsx` ships, which
   * is the reference implementation for this exact problem.
   *
   * The inline key-bar-value row it replaces is width-fragile by construction:
   * the lane is the only flexible track, so it is always the thing that
   * collapses first. Stacked, the bar is `w-full` at every width and all four
   * ports' bars start and end at the same x, which is what makes their LENGTHS
   * comparable — and length is the channel carrying the adjacent-ramp-stop
   * distinction that colour deliberately does not.
   */
  METRIC: "flex flex-col gap-1",
  METRIC_HEAD: "flex items-baseline justify-between gap-2",
  KEY: KEY_LABEL,
  /**
   * Pinned so a bar, a caption and a "not reported" line share one band.
   *
   * This tracks the bar's own height and must move with it: the band was 4px
   * while `MetricBar` was, and an 8px bar inside a 4px `items-center` box
   * overflows the band this constant exists to hold.
   */
  LANE: "flex h-2 items-center",
  VALUE: "shrink-0 text-right text-[13px]/5 font-semibold tabular-nums",
} as const;

// -----------------------------------------------------------------------------
// Controls — one height each, named once
// -----------------------------------------------------------------------------

/** 44px icon-only target. The coarse-pointer floor wins over the 42px pill. */
export const ICON_TARGET = "size-11 shrink-0";
export const SEGMENTED_ITEM =
  "h-[2.125rem] gap-1.5 rounded-pill px-4 text-[0.84375rem] font-medium";

// -----------------------------------------------------------------------------
// Glyph sizes — three, not five
// -----------------------------------------------------------------------------

export const GLYPH = {
  /** Inside a Badge or Tag. */
  CHIP: 12,
  /** Inline beside a label, and inside an icon-only control. */
  INLINE: 16,
  /** On a pill action or a segmented item. */
  ACTION: 18,
} as const;

// -----------------------------------------------------------------------------
// Voices
// -----------------------------------------------------------------------------

/** A figure: a measurement or short numeric label. Never `font-mono`. */
export const FIGURE = "tabular-nums";

// -----------------------------------------------------------------------------
// Tone maps — keyed onto exported types, never onto class strings
// -----------------------------------------------------------------------------

/**
 * Keying onto `MaterialSymbolName` rather than `string` is what makes a glyph
 * that is missing from the font subset a BUILD failure instead of an empty box
 * on a device nobody is looking at.
 */
export const SLOT_GLYPH = {
  directional: "explore",
  omni: "location_on",
} as const satisfies Record<"directional" | "omni", MaterialSymbolName>;

/**
 * `radar` rather than a record dot: it is already in the font subset, and a
 * sweep glyph is native to this surface in a way a transport control is not.
 * Adding a glyph means editing the shared subset manifest and re-running
 * `bun run icons:subset`, so a name outside this list is a build failure, which
 * is exactly what `satisfies Record<_, MaterialSymbolName>` is here to cause.
 */
export const RECORD_GLYPH = {
  idle: "radar",
  recording: "progress_activity",
  recorded: "check_circle",
  best: "trophy",
  clear: "delete",
  cancel: "close",
} as const satisfies Record<string, MaterialSymbolName>;

// -----------------------------------------------------------------------------
// Skeleton — mirrors sized to the loaded element's LINE BOX, not its font size
// -----------------------------------------------------------------------------

export const SKELETON_SHAPE = {
  /** A section's small-caps key line (`CONSOLE.SECTION_HEAD`, 24px). */
  KEY: "h-6 w-24 rounded-inline",
  CHIP: "h-[1.625rem] w-24 rounded-pill",
  LEG_ROW: "h-10 w-full rounded-pill",
  SLOT_ROW: "h-16 w-full rounded-pill",
  /** The single-metric pin: the mode is unknown until the first snapshot. */
  PORT_BLOCK: "h-[5.75rem] w-full rounded-tile @md/card:h-[7.375rem]",
  CONTROL_ROW: "h-[2.125rem] w-56 rounded-pill",
  /** `Button size="action"`, 42px. */
  ACTION: "h-[2.625rem] w-36 rounded-pill",
  TITLE: "h-7 w-40 rounded-inline",
  /** A description that holds one line at every width. */
  LINE: "h-5 w-56 rounded-inline",
  /**
   * The second line of a description that wraps on a phone. Mirroring a
   * two-line description with one `LINE` under-draws the header by ~20px, and
   * a skeleton that is shorter than its content is a layout shift at handoff.
   */
  LINE_WRAP: "h-5 w-40 rounded-inline",
} as const;
