---
name: QManager
description: Web GUI for Quectel cellular modems running OpenWRT (RM551E, RM520N and RM500Q class). An instrument console — colour on the data, not on the furniture — running on the modem it manages.
colors:
  # Keys mirror the names that resolve in app/globals.css, which is NORMATIVE
  # (ported in ledger row U1.2). Retune a value there and here in the same change.
  # Where the Material vocabulary and shadcn's collide, the shipped name wins:
  # Carrier Violet is `lte-*` (not `secondary-*`); shadcn's own --secondary is a
  # NEUTRAL in this codebase.
  #
  # EVERY value below is inside the sRGB gamut by construction (chroma floored
  # to 98.5% of the in-gamut maximum for its lightness and hue). That is a
  # correctness property, not a nicety: Lightning CSS gamut-maps out-of-range
  # oklch() at build time, so an out-of-gamut token ships a colour nobody
  # authored. Here declared == shipped. See The In-Gamut Rule.
  #
  # --- The mark: the source pair every other hue derives from ---
  mark-ring: "oklch(0.623 0.214 259.815)"

  # --- Neutrals: the ground everything else sits on ---
  background-light: "oklch(0.985 0.003 258)"
  background-dark: "oklch(0.120 0.008 258)"
  foreground-light: "oklch(0.205 0.011 258)"
  foreground-dark: "oklch(0.965 0.004 258)"
  surface-light: "oklch(1.000 0.000 258)"
  surface-dark: "oklch(0.170 0.009 258)"
  card-light: "oklch(1.000 0.000 258)"
  card-dark: "oklch(0.170 0.009 258)"
  surface-container-light: "oklch(0.967 0.005 258)"
  surface-container-dark: "oklch(0.200 0.010 258)"
  surface-container-high-light: "oklch(0.938 0.007 258)"
  surface-container-high-dark: "oklch(0.235 0.012 258)"
  on-surface-light: "oklch(0.205 0.011 258)"
  on-surface-dark: "oklch(0.965 0.004 258)"
  on-surface-variant-light: "oklch(0.505 0.012 258)"
  on-surface-variant-dark: "oklch(0.762 0.011 258)"
  border-light: "oklch(0.905 0.006 258)"
  border-dark: "oklch(0.288 0.012 258)"
  input-light: "oklch(0.868 0.008 258)"
  input-dark: "oklch(0.330 0.013 258)"

  # --- Primary / NR / info / action: the mark's blue. The only hue that acts. ---
  primary-light: "oklch(0.565 0.235 262)"
  primary-dark: "oklch(0.605 0.200 262)"
  primary-foreground-light: "oklch(0.985 0.006 262)"
  primary-foreground-dark: "oklch(0.195 0.055 262)"
  primary-on-surface-light: "oklch(0.535 0.220 262)"
  primary-on-surface-dark: "oklch(0.650 0.183 262)"
  primary-container-light: "oklch(0.890 0.052 262)"
  primary-container-dark: "oklch(0.375 0.145 262)"
  on-primary-container-light: "oklch(0.360 0.160 262)"
  on-primary-container-dark: "oklch(0.900 0.047 262)"

  # --- Carrier Violet (`--lte-*`): the 4G LTE identity. Never acts. ---
  lte-light: "oklch(0.510 0.240 296)"
  lte-dark: "oklch(0.700 0.175 296)"
  lte-foreground-light: "oklch(0.985 0.007 296)"
  lte-foreground-dark: "oklch(0.195 0.055 296)"
  lte-on-surface-light: "oklch(0.465 0.220 296)"
  lte-on-surface-dark: "oklch(0.740 0.149 296)"
  lte-container-light: "oklch(0.850 0.082 296)"
  lte-container-dark: "oklch(0.270 0.145 296)"
  on-lte-container-light: "oklch(0.360 0.160 296)"
  on-lte-container-dark: "oklch(0.900 0.053 296)"

  # --- Downlink Rose (`--downlink-*`): the download direction. Only that. ---
  downlink-light: "oklch(0.480 0.204 341)"
  downlink-dark: "oklch(0.660 0.200 341)"
  downlink-foreground-light: "oklch(0.985 0.009 341)"
  downlink-foreground-dark: "oklch(0.195 0.055 341)"
  downlink-on-surface-light: "oklch(0.450 0.191 341)"
  downlink-on-surface-dark: "oklch(0.700 0.200 341)"
  downlink-container-light: "oklch(0.875 0.087 341)"
  downlink-container-dark: "oklch(0.285 0.121 341)"
  on-downlink-container-light: "oklch(0.360 0.153 341)"
  on-downlink-container-dark: "oklch(0.900 0.068 341)"

  # --- Uplink Cyan (`--uplink-*`): the upload direction. Only that. ---
  uplink-light: "oklch(0.545 0.091 200)"
  uplink-dark: "oklch(0.820 0.137 200)"
  uplink-foreground-light: "oklch(0.985 0.012 200)"
  uplink-foreground-dark: "oklch(0.195 0.032 200)"
  uplink-on-surface-light: "oklch(0.515 0.086 200)"
  uplink-on-surface-dark: "oklch(0.870 0.145 200)"
  uplink-container-light: "oklch(0.915 0.105 200)"
  uplink-container-dark: "oklch(0.345 0.057 200)"
  on-uplink-container-light: "oklch(0.360 0.060 200)"
  on-uplink-container-dark: "oklch(0.900 0.110 200)"

  # --- Spatial Azure (`--spatial-*`): antenna and spatial-stream readouts. ---
  spatial-light: "oklch(0.550 0.110 232)"
  spatial-dark: "oklch(0.790 0.127 232)"
  spatial-foreground-light: "oklch(0.985 0.008 232)"
  spatial-foreground-dark: "oklch(0.195 0.039 232)"
  spatial-on-surface-light: "oklch(0.515 0.103 232)"
  spatial-on-surface-dark: "oklch(0.820 0.108 232)"
  spatial-container-light: "oklch(0.855 0.085 232)"
  spatial-container-dark: "oklch(0.265 0.053 232)"
  on-spatial-container-light: "oklch(0.360 0.072 232)"
  on-spatial-container-dark: "oklch(0.900 0.058 232)"

  # --- The functional three ---
  destructive-light: "oklch(0.480 0.192 27)"
  destructive-dark: "oklch(0.640 0.200 27)"
  destructive-foreground-light: "oklch(0.985 0.007 27)"
  destructive-foreground-dark: "oklch(0.195 0.055 27)"
  destructive-on-surface-light: "oklch(0.440 0.176 27)"
  destructive-on-surface-dark: "oklch(0.680 0.200 27)"
  destructive-container-light: "oklch(0.835 0.089 27)"
  destructive-container-dark: "oklch(0.245 0.098 27)"
  on-destructive-container-light: "oklch(0.360 0.144 27)"
  on-destructive-container-dark: "oklch(0.900 0.051 27)"
  warning-light: "oklch(0.560 0.118 72)"
  warning-dark: "oklch(0.790 0.166 72)"
  warning-foreground-light: "oklch(0.985 0.011 72)"
  warning-foreground-dark: "oklch(0.195 0.041 72)"
  warning-on-surface-light: "oklch(0.525 0.110 72)"
  warning-on-surface-dark: "oklch(0.815 0.151 72)"
  warning-container-light: "oklch(0.855 0.115 72)"
  warning-container-dark: "oklch(0.410 0.086 72)"
  on-warning-container-light: "oklch(0.360 0.075 72)"
  on-warning-container-dark: "oklch(0.900 0.077 72)"
  success-light: "oklch(0.540 0.150 149)"
  success-dark: "oklch(0.740 0.200 149)"
  success-foreground-light: "oklch(0.985 0.012 149)"
  success-foreground-dark: "oklch(0.195 0.054 149)"
  success-on-surface-light: "oklch(0.505 0.140 149)"
  success-on-surface-dark: "oklch(0.780 0.200 149)"
  success-container-light: "oklch(0.895 0.145 149)"
  success-container-dark: "oklch(0.310 0.086 149)"
  on-success-container-light: "oklch(0.360 0.100 149)"
  on-success-container-dark: "oklch(0.900 0.110 149)"

  # --- Signal quality ramp: three plain hues (green / yellow / red) ---
  quality-1-light: "oklch(0.500 0.190 27)"
  quality-1-dark: "oklch(0.680 0.200 27)"
  quality-2-light: "oklch(0.500 0.190 27)"
  quality-2-dark: "oklch(0.680 0.200 27)"
  quality-3-light: "oklch(0.580 0.125 80)"
  quality-3-dark: "oklch(0.860 0.160 90)"
  quality-4-light: "oklch(0.505 0.140 149)"
  quality-4-dark: "oklch(0.800 0.200 149)"
  quality-5-light: "oklch(0.505 0.140 149)"
  quality-5-dark: "oklch(0.800 0.200 149)"
  quality-1-bar-light: "oklch(0.580 0.210 27)"
  quality-1-bar-dark: "oklch(0.640 0.220 27)"
  quality-2-bar-light: "oklch(0.580 0.210 27)"
  quality-2-bar-dark: "oklch(0.640 0.220 27)"
  quality-3-bar-light: "oklch(0.820 0.165 88)"
  quality-3-bar-dark: "oklch(0.840 0.170 90)"
  quality-4-bar-light: "oklch(0.620 0.170 149)"
  quality-4-bar-dark: "oklch(0.760 0.210 149)"
  quality-5-bar-light: "oklch(0.620 0.170 149)"
  quality-5-bar-dark: "oklch(0.760 0.210 149)"

  # --- Outline tags: identity and metadata, border + text, no fill ---
  tag-nr-text-light: "oklch(0.535 0.220 262)"
  tag-nr-text-dark: "oklch(0.650 0.183 262)"
  tag-nr-border-light: "oklch(0.600 0.190 262)"
  tag-nr-border-dark: "oklch(0.600 0.190 262)"
  tag-lte-text-light: "oklch(0.465 0.220 296)"
  tag-lte-text-dark: "oklch(0.740 0.149 296)"
  tag-lte-border-light: "oklch(0.545 0.190 296)"
  tag-lte-border-dark: "oklch(0.540 0.190 296)"
  tag-spatial-text-light: "oklch(0.515 0.103 232)"
  tag-spatial-text-dark: "oklch(0.820 0.108 232)"
  tag-spatial-border-light: "oklch(0.615 0.123 232)"
  tag-spatial-border-dark: "oklch(0.640 0.128 232)"
  tag-neutral-text-light: "oklch(0.505 0.012 258)"
  tag-neutral-text-dark: "oklch(0.762 0.011 258)"
  tag-neutral-border-light: "oklch(0.620 0.012 258)"
  tag-neutral-border-dark: "oklch(0.520 0.012 258)"

typography:
  sans: "Rethink Sans (--font-sans, WOFF2 variable, next/font/local)"
  mono: "JetBrains Mono (--font-jetbrains-mono → font-mono, vendored, next/font/local)"
  icons: "Material Symbols Rounded (shell, /dashboard, pre-auth, all of /cellular/) · lucide-react (everywhere else)"
  weights: "400 body · 500 labels · 600 titles and numerics · 700 page titles only"
  display: "700 / 1.875rem / -0.02em"
  headline: "600 / 1.25rem / -0.01em"
  title: "600 / 1.125rem"
  body: "400 / 0.875rem"
  row: "600 / 0.8125rem on a 20px line box"
  label: "500 / 0.75rem"
  numeric: "600 tabular-nums in --font-sans, sized by its slot"

rounded:
  inline: "0.5rem"
  field: "0.625rem"
  tile: "0.75rem"
  card: "1rem"
  hero: "1.25rem"
  pill: "9999px"

spacing:
  page-gutter: "16px → 24px"
  card-grid-gap: "16-24px"
  tile-grid-gap: "14px"
  in-card-row-gap: "6px"
  inline-gap: "8-10px"
  card-padding: "24px standard · 28px hero"

components:
  button: "full-round pill at every size · default 36px (44px on a coarse pointer) · page action: 42px tall, 20px horizontal, 600, via size=\"action\""
  status-chip: "filled role container + on- ink, no border, pill, mandatory 12px glyph"
  outline-tag: "1px role border + role text, transparent fill, pill, no glyph required"
  card: "16px radius in a grid, 20px for an anchor; border-0; surface fill; card-sheen in dark"
  card-foot: "borderless row on the card's bottom edge, min 64px; status left, Discard then SaveButton right"
  tile: "12px radius, 104px pinned height, 52px glyph disc + text column"
  metric-row: "40px pill on surface-container, 16px horizontal"
  input: "10px radius, 42px tall, no rest border, fill one step above the host via the host prop (surface-container default, surface-container-high on a container)"
  quality-bar: "full-round track, 8px tall everywhere, ramp-coloured fill, length carries the value"
---

# Design System: QManager

## Overview

QManager is an **instrument console**. It reports what a cellular modem is doing, on the modem itself, to someone who understands modems. The design language follows from three facts about that job.

**Colour belongs to the data, not to the furniture.** A card is a neutral surface. What is coloured is the reading: the numeral, the chart stroke, the quality bar, the glyph in its disc. This is the single largest change from the previous system, which spent its colour on large tonal container fills and left the live diagnostic values grey. That inversion was measured and it was backwards — on the surface built to showcase the colour system, four tinted tiles carried restated facts while RSRP and SINR sat in neutral text below them.

It is also the accessible answer, which is not a coincidence. Across this palette, **ink colours separate in 0 of 28 pairs under deuteranopia and protanopia simulation. So do fills. Pale identity containers separate in 2 of 10.** Colour on ink works; colour on large pale surfaces does not. The design direction and the measurement agree, so the system commits to the layer that survives.

**Density is the product, and hierarchy is how it stays readable.** A modem console shows a lot at once. The answer is never to show less; it is to rank what is shown. Neutral surfaces, one coloured thing per row, and a consistent card grid are what let forty routes feel like one product. Inside a card, edges, grouping and quiet defaults do the ranking (Layout > The Scanning Rules).

**Every hue owns exactly one meaning.** A colour a user learns on the dashboard means the same thing on the cell scanner. Where a figure has no honest hue, it stays neutral rather than being given a decorative one.

**Reference language:** WiFiman (Ubiquiti) and Firewalla — near-black canvas, saturated data strokes, coloured numerals, thin quality bars, outline metadata tags. **Structural reference:** the grouped-card, consistent-shape page from macOS System Settings and the Apple pro-app inspectors. **Not** a consumer router app, not a generic SaaS dashboard, not a terminal utility.

Both themes are first-class and each is authored. Dark is a near-black instrument panel; light is a white-card console. Neither is a desaturated copy of the other, and every value in both was measured rather than derived by inversion.

**How to read this document.** This is the RM520N design canon, adopted wholesale by QManager on 2026-10-15 (port ledger U0.1 to U0.3). The rules, the tokens and their rationale are binding for all new target work. Three conventions keep it honest about a codebase that has not caught up yet. (1) Phrases such as "the previous system" and "the fork" refer to the RM520N build the canon was written on, where the measurements were taken; "the target" is QManager on OpenWRT. (2) A file path that does not exist in the target tree names either a primitive that a ledger row creates (`components/ui/card-foot.tsx`, `tag.tsx`, `segmented-field.tsx`, `metric-bar.tsx`, `material-symbol.tsx`, `lib/motion-preference.ts` and the like: see Migration Deltas for the row) or the fork's reference implementation of a page, which arrives when that page is ported. (3) Counts and measurements that say "on the fork" were not re-taken on the target. Target-only surfaces the fork never had are covered under Components > Target-only surfaces.

## Migration Deltas (tracked)

**This document is ahead of the code, and it is binding for new work now.** On 2026-10-15 (port ledger decisions U0.1 to U0.3, `docs/rm520n-port-ledger.md`) QManager adopted the RM520N design canon wholesale, with no target-specific exceptions. The target code below is the earlier design (Manrope, Signal Indigo, outline status badges, a 238-line `app/globals.css`); this section lists where it differs from the canon and which ledger row closes each gap. A row is removed only when the code matches the canon.

**What binds in the meantime.** Anything you build or rework before its row closes is authored in the canon: tokens by their canon names, the filled-chip / `Tag` split, `CardFoot` for apply, the canon's motion tokens, no `max-w-*` page cap. If a primitive the canon names does not exist yet (the table says which), create it as that row specifies rather than faking it with the old pattern. Do not copy an old pattern from an unmigrated neighbour, and do not sweep a neighbour you were not asked to touch.

### Canon versus code

| Layer | Canon says | Target code today | Closes with |
| --- | --- | --- | --- |
| Tokens | Role triads (`-container`, `on-*`, `-on-surface`), `surface-container-*`, role radii, `--shadow-whisper`, `--card-sheen`, `--quality-N`, `--tag-X`, direction and spatial roles, `--duration-*` / `--ease-*`, `--chart-nr` / `--chart-lte` | Closed by **U1.2** (2026-10-15): every canon token family is in `app/globals.css`, and the legacy `--radius` chain stays live. The U3 / U4 re-authors consume them; there is no scrim token, so the account menu's avatar overlay keeps `bg-black/50` | **U1.2** done |
| Primitives | `card-foot.tsx`, `segmented-field.tsx`, `tag.tsx`, `material-symbol.tsx` + names module, `banner.tsx` (8 roles), `tonal-banner.tsx`, `metric-bar.tsx`, `tick-group.tsx`, `ticking-value.tsx`, `swap-label.tsx`; pill `Button` (36px, 44px coarse, `size="action"`); `Card` at `rounded-card` with `border-0` and `card-sheen`; field primitives on `fieldVariants` (10px, 42px, `host` prop); `HintIcon` on the final Popover contract | Closed by **U2.1a** and **U2.1b** (2026-10-15), consumed by the U3 / U4 re-authors (U4.23 recount 2026-10-19: `Banner` in 14 files, `TickingValue` 10, `TickGroup` 9, `SwapLabel` 12, `SaveButton blockedReason` 11, `components/ui/metric-bar` 10 including the dashboard). Four files still render a bare `<Switch`: `transcript-card`, `scheduled-operations-card` and `update-preferences-card` match the fork, `ipa-offload-card` is target-only; convert one only when its card is reworked | **U2.1a** and **U2.1b** done |
| Motion | `lib/motion.ts` on `quick` 360 / `standard` 600 / `emphasized` 800 ms, two stagger steps, `EASE_*` curves; the Animations preference (`data-motion`, `useMotionReduced()`, `MotionProvider`); no spring, no raw duration | Closed by **U2.2** (2026-10-15): `lib/motion.ts` is on the 360 / 600 / 800 ms scale, `lib/motion-presets.ts` is deleted, the Animations preference (`data-motion`, `useMotionReduced()`, `MotionProvider`, boot script) and the reduced-motion ESLint rule exist. The sidebar Animations row uses lucide glyphs until U3.1 | **U2.2** done; see [`docs/reference/motion-preference.md`](docs/reference/motion-preference.md) |
| Status chips | Filled tonal `Badge` variants (`success` / `warning` / `destructive` / `info` / `muted`) with a mandatory `size-3` glyph; identity and metadata are `Tag`s | Closed by **U2.4** (2026-10-16): every status `Badge` is a filled tonal variant with a distinct `size-3` lucide glyph, no Badge uses `variant="outline"`, and identity and metadata moved onto `Tag`; `ServiceStatusBadge` is `success` / `muted`. The remaining `/10`-`/15` role tints are alert boxes, hero rings and discs, owned by the U4 page re-authors, not by status chips | **U2.4** done |
| Signal quality | One five-stop ramp (`bad` below `poor`), `SignalThresholds.floor`, one quality-to-colour map in `components/cellular/signal-quality-display.ts`, `MetricBar value={null}` for a missing reading | The module is closed by **U3.4** and **U2.3** (2026-10-19): `components/cellular/signal-quality-display.ts` is the one map, and the signal surfaces re-authored in U4 import it (12 files). Still open: `getSignalQuality()` in `types/modem-status.ts` returns four levels plus `none` and `SignalThresholds` still names its bottom field `poor`, so the map has no `bad` arm and `poor` sits on ramp stop 2 | **U2.3** done; the five-stop widening has no row yet (ledger Findings, U3.4) |
| App shell | One `nav-menu.tsx` + `nav-section.tsx`; the fork's grouping (Dashboard / Cellular / Local Network / Monitoring / System) with the target-only routes slotted in; pre-auth scale in `components/pre-auth-type.ts` | Closed by **U3.1** (sidebar; `SidebarContent` hides the scrollbar because a 15px Windows scrollbar truncated labels; the LuCI app-switcher header and a Connection Scenarios sub-row are target-only and kept; restructured 2026-10-20 to shadcn sidebar-07: icon rail, expander parents with a first sub-row, switcher dropdown, nav-tree breadcrumbs, see Components > Navigation), **U3.2** (routes: Connection Quality at `/monitoring/connection-quality`, Network Events at `/monitoring/events`, Ethernet at `/local-network/ethernet`; the old routes are redirect stubs), **U3.3** (`/login/` card) and **U3.4** (the `/` splash) | **U3.1** to **U3.4** done |
| Apply placement | Every non-exempt editable card commits from `CardFoot` (Card-Foot Apply Rule); Save-adjacent secondary actions carry no stroke | Closed by **U4.1** (DONE 2026-10-16) and the per-page U4 rows: `CardFoot` is in 34 files, no sticky or page-level save bar is left (Watchdog **U4.6**, Alerts **U4.9**), no `CardFooter` apply. The four bare `<Switch` files are listed under Primitives | **U4.1** done |
| Confirmations | One toast per finished action; no fading Saved chip | 116 `toast.success` / 144 `toast.error` sites, 0 hard-coded English toasts (the account menu's moved onto `t()` with U4.23), no raw `navigator.clipboard` outside `lib/clipboard.ts` (`copyText` in 12 files; the unused `copyable-command.tsx` was deleted with U4.23). Known gaps are ledger rows, not precedent: see [`docs/reference/toast-confirmation.md`](docs/reference/toast-confirmation.md) and the U4.23 B5 rows (Software Update actions, SMS send, Traffic Engine install) | **U4.1**, **U2.3** (`lib/clipboard.ts`) and **U4.23** done; the remaining gaps are B5 rows |
| Icons | Material Symbols on the shell, `/dashboard`, the pre-auth routes and all of `/cellular/**`; lucide elsewhere; never both on one route | Closed by the U3 / U4 route conversions: the sidebar (**U3.1**), `/login/` (**U3.3**), `/` (**U3.4**), `/dashboard` (**U4.10**) and every `/cellular/**` route (U4.3, U4.11.x, U4.13 to U4.18b) are Material; `/setup`, `/local-network/**`, `/monitoring/**`, `/system-settings/**`, `/about-device`, `/support` and the header bar are lucide (92 component files use `MaterialSymbol`, 151 import `lucide-react`). The U4.23 route sweep (2026-10-19) found no route mixing the sets outside the pinned primitives (`SaveButton`, `Banner`, `sonner`, the `Select` chevron, `HintIcon`) and the documented exceptions: Network Status's lucide SIM / plane and `react-icons/md` RAT glyphs, the account menu's lucide action items, and `react-icons` brand marks in `overview-card` and `brand-mark` | Done; extend the boundary only by decision |
| Page anatomy | Full-width page column, `@container/main`, recomposing cards, Symmetric-Pair rows; the Scanning Rules | Every route is re-authored by its U3 / U4 row. The U4.23 sweep (2026-10-19) found no `max-w-*` page cap (the `max-w-[41rem]` on page-header title columns caps the description's measure, not the page) and no horizontal scroll at 375px on any route with the preview fixtures | Done; the Scanning Rules stay goal rules, so do not sweep untouched pages |
| Copy | One sentence per description, `HintIcon` toggletips, No Debug-Build Copy | Audited by **U4.23** (2026-10-19) across the five catalogs and hard-coded literals: no config path, UCI, AT, script or daemon name in user-facing copy outside the exempt surfaces (AT Terminal, Logs, About Device diagnostics, System Health Check, the Prometheus scrape snippet) and the copy-this-command boxes that exist to be pasted into a shell (the login reset command, the language-pack manual install). Open, as ledger rows: package names in install prompts, multi-sentence descriptions carried over from the fork, and hint text in `Tooltip`s on fork-ported surfaces | **U4.23** done; the open items are B5 rows |
| Per-family `shapes.ts` | One module per route family owning geometry and tone maps, imported by views and skeletons | Closed by **U2.3** (2026-10-19) and **U4.20** (TTL & MTU, `local-network/ttl-mtu-settings/shapes.ts`): 30 modules under `components/`. Custom SIM Profiles and SMS keep their own family modules by decision | **U2.3** and **U4.20** done |

### Superseded target conventions

These earlier target rules and preferences are retired, not carried over as exceptions (ledger U0.2: "just follow RM520N design"). If you meet one in code, it is debt for its U-row, not precedent.

| Retired | Replaced by |
| --- | --- |
| Signal Indigo as "the single brand accent" with `--secondary` as a lighter-indigo control surface | `--primary` (hue 262) is the one hue that acts; shadcn `--secondary` is a neutral. Identity, direction and spatial roles exist beside it with fixed meanings (Colors) |
| Manrope as the only UI face; JetBrains Mono for the AT terminal only | Rethink Sans for the interface and every figure; JetBrains Mono for opaque strings you compare (The Machine-Voice Rule) |
| The Outline-Badge Rule (`variant="outline"` plus `/15` and `/30` alphas for status) | The Two-Form Rule: filled tonal chips for state, outline `Tag`s for identity and metadata |
| Hybrid elevation (ambient `shadow-sm` / `shadow-md` on cards and tiles) | Tonal elevation, optional `--shadow-whisper` in light, `--card-sheen` in dark |
| The uniform two-column settings grid as "the correct default", and `max-w-*` page caps | The Full-Width Page Rule and The Symmetric-Pair Rule: the page spans the shell, cards recompose on their own container steps |
| Connection Scenarios' vivid gradients (kept as a deliberate loud surface) | No gradients. Colour belongs to the reading (The Data-Ink Rule); a scenario is a neutral card with a glyph disc and `Tag`s |
| Quiet identity as plain muted text (for example a hostname with no pill) | Identity and metadata are `Tag`s; a filled chip is reserved for state. A neutral `Tag` is the quiet form |
| The Status-First page: Live Status hero, tabbed settings card with a sticky save bar, `max-w-[1100px]` column | Per-card `CardFoot` apply and the bento grouping of the fork's Watchdog and Alerts; a hero is a rare exception (Consistent-Layout Rule) |
| The Sticky-Save-Bar Rule | The Card-Foot Apply Rule |
| Live Data Tile and Live-Tile Rule (200 to 400 ms `cubic-bezier(0.16, 1, 0.3, 1)` transitions, hover lift) | Tiles (Components > Tiles) and The live value tick, on the canon duration and curve tokens; no hover lift |
| Pill-Dense Table Rule (UniFi heritage, outline pills in tables) | Genuine data tables keep hairline rows; status in a row is a filled chip, metadata a `Tag` (Metric rows) |
| The Topology Map, Circular Signal Meter and Signal Dashboard Numeric Card "signature components" | Not built in the target. The canon's Signature surfaces replace them; an aspiration that ships gets specified when it ships |
| Raw-colour dialogs (`bg-black/50` scrim with `backdrop-blur-sm`, `Fault Red` titles) | `card-sheen` dialogs on the Modal-Exit Rule's clocks; destructive intent lives in the button variant and the consequence sentence |

### Target-only surfaces (ledger U4.11)

Netbird, Config Backup / Restore, Adaptive Polling, the Traffic Engine (Video Optimizer and Masquerade), Connection Scenarios, Custom SIM Profiles, the deferred-reboot banner, and the surfaces the fork also has but built differently (Band Locking, APN, SMS, LAN Config, Custom DNS) are re-authored one per row in the new canon. They keep their function and their safety contracts (the feature docs under `docs/features/` are authoritative for behaviour); only their look and layout change. Until a surface's row runs, new work on it follows the canon. See Components > Target-only surfaces for the parts of the canon written specifically for them.

## Colors

### The three layers

Every role in this system exists in up to three layers, and **each layer has one job**. Choosing the wrong layer is the standard failure, so the layers are named and their jobs are exclusive.

| Layer | Tokens | Job | Measured |
| --- | --- | --- | --- |
| **Ink** | `--X-on-surface` | Coloured text, numerals, chart strokes, bare glyphs, table values — on a **neutral** ground. **This is the primary mechanism.** | 0 of 28 pairs collapse, both themes |
| **Fill** | `--X` + `--X-foreground` | Compact emphasis: glyph discs, quality-bar fills, primary buttons, the active nav pill, meter fills. Small and saturated. | 0 of 28 pairs collapse, both themes |
| **Container** | `--X-container` + `--on-X-container` | Large tinted blocks. **Restricted to status chips, banners, condition screens, and resolved-state cells** — the functional roles only. | Status subset: 0 of 10. Identity: 8 of 10 collapse in light |

The restriction on containers is not taste. In light mode the usable pale-tint band (L 0.83–0.96 at low chroma) is too narrow to hold five identity hues plus `surface-container-high` above the 0.05 separation floor; an optimiser proved it infeasible rather than merely difficult. The functional roles fit because there are fewer of them and they are permitted to differ in lightness as well as hue. **So identity gets ink and outline, and never a large tinted block.**

### The ground

Neutrals carry a slight cool cast (hue 258, chroma ≤ 0.012) so they sit in the mark's family without reading as blue.

| Step | Light | Dark | Owns |
| --- | --- | --- | --- |
| `--background` | 0.985 | **0.120** | The page canvas |
| `--surface` / `--card` | 1.000 | 0.170 | Cards, the primary content plane |
| `--surface-container` | 0.967 | 0.200 | Metric-row pills, inputs, recessed blocks |
| `--surface-container-high` | 0.938 | 0.235 | One step further in: hover, stripes, muted chips |

Dark mode is genuinely near-black (`#040608`) with cards barely lifted off it (`#0d1013`), per the reference language. Light mode inverts the relationship rather than the values: the canvas is a soft grey and cards are pure white, so a card still reads as the thing in front.

### Identity — which radio

- **Primary / NR Blue** (`--primary-*`), hue **262**. The mark's blue, and the only hue in the system that *acts*. It is simultaneously the brand, the action accent, the `info` role, and the identity of the 5G NR leg. Those are one meaning wearing four hats, not four meanings — see The Info-Is-Brand Rule.
- **Carrier Violet** (`--lte-*`), hue **296**. The 4G LTE leg. It never acts and never means healthy.

Identity renders as **ink** (a coloured value, a chart stroke) or as an **outline tag**. It does not render as a large tinted block. On a glyph disc it uses the **fill**, never the pale container — light-mode identity containers collapse under simulation and the fills do not.

### Direction — which way the bytes go

- **Downlink Rose** (`--downlink-*`), hue **341**. The download direction.
- **Uplink Cyan** (`--uplink-*`), hue **200**. The upload direction.

**These mean direction and nothing else.** The previous system gave rose a second meaning ("and capacity") and cyan a second meaning ("and counts"), which made the axis untrue: a carrier-count tile wore upload cyan while reporting nothing about upload, two clicks from a latency card where the same cyan meant upload beside an up-arrow. A count is not a direction. A count is neutral.

Direction is primarily a **chart-stroke and numeral** pair now, so both carry vivid `-on-surface` inks. They always pair with an arrow glyph; hue alone never says which way.

### Spatial — how many antennas

**Spatial Azure** (`--spatial-*`), hue **232**. Antenna and spatial-stream readouts: MIMO layer counts, per-antenna chains, alignment surfaces. A MIMO figure routinely names both radios in one string (`LTE 1x2 | NR 2x4`), so no identity hue is honest, and layers are neither a direction nor a state.

### State — the functional three

`success` (149), `warning` (72), `destructive` (27). `info` resolves to the brand ramp rather than owning a fourth hue.

**Only these report health.** An identity hue never means "fine"; a direction hue never means "degraded". This is the rule the previous system broke in its own canon, where the quality scale mapped "Good" to the brand blue — so an LTE-only user saw good signal rendered in the 5G identity colour, on every surface that read the scale.

`muted` (`surface-container-high` + `on-surface-variant`) is the fourth chip role and means **deliberately inactive** — Stopped, Disabled, Offline peer. It never carries live data. A live figure on a muted ground reads as switched off.

### The signal quality ramp

A **five-stop continuous scale** for measured signal quality — RSRP, RSRQ, SINR, aim score. It is a separate axis from the functional three, and it is the only place in the system where colour is read as a position on a scale rather than as a category.

| Stop | Hue | Level | Replaces |
| --- | --- | --- | --- |
| `--quality-1` | 27 (red) | **bad** | *new — see below* |
| `--quality-2` | 27 (red) | poor | `destructive` |
| `--quality-3` | 80–90 (yellow) | fair | `warning` |
| `--quality-4` | 149 (green) | good | **`primary`** — the defect this fixes |
| `--quality-5` | 149 (green) | excellent | `success` |

Two things changed and both are substantive.

**A fifth level exists.** `getSignalQuality()` used to return four, so everything below −110 dBm RSRP landed in one `poor` bucket: −111 and −140 rendered identically, when the first means nudge the antenna and the second means it is pointing at a wall. On an alignment meter that is the difference between a task and a dead end. The cut sits at RSRP −120, RSRQ −18, SINR −10 — a product call, not a measurement: −110 to −120 is cell edge, a link that aiming or a band lock can plausibly recover, and below that the honest message is "not this cell".

`SignalThresholds` names every member except `floor` as a **cut** (the lowest value that still earns that level). `floor` is the bottom of `signalToProgress()`'s 0–100 scale and classifies nothing. Keep the two distinct: the field now called `floor` was called `poor` while `getSignalQuality()` never read it, and adding a real `poor` cut beside it would have left a cut and a floor sharing one name.

**The ramp contains no identity hue.** Removing brand blue from the middle of a health scale is the whole reason the ramp is worth minting.

**The ramp is three plain hues: green, yellow, red.** Stops 4–5 are green, stop 3 is yellow, stops 1–2 are red. An earlier five-hue lightness staircase (27 / 45 / 72 / 115 / 149) was retired after v0.1.32, when users reported that good and fair read as "dark green and muddy brown" and could not be told apart; three hues everyone already knows beat a finely-graded scale nobody can read. Stops that share a hue are separated by `QUALITY_GLYPH`'s wedge ladder and by bar length, never by colour, so the glyph and bar remain mandatory channels (under deuteranopia red and green still converge, which is the same reason).

`--quality-N` is the **numeral** ink; `--quality-N-bar` is the **bar fill**. The light-mode yellow ink is a darker gold (L 0.58) so a numeral stays legible on a near-white ground, while its bar stays a true yellow; red and green ink sit at their functional-role weights.

### Outline tags

Identity and metadata render as **outline-and-tint**: a 1px role border, role text, transparent fill, pill radius.

| Tag | Border | Text |
| --- | --- | --- |
| NR / 5G | `--tag-nr-border` | `--tag-nr-text` |
| LTE / 4G | `--tag-lte-border` | `--tag-lte-text` |
| Spatial | `--tag-spatial-border` | `--tag-spatial-text` |
| Neutral metadata | `--tag-neutral-border` | `--tag-neutral-text` |

Text clears 4.5:1 against every card ground; borders clear 3:1. Borders separate from each other in 0 of 6 pairs collapsed, both themes.

An outline tag is **never a status indicator**. It labels *what a thing is* — a band number, a radio family, a channel width, a capability. Status is always a filled chip with a glyph. The two forms exist precisely so that "which radio" and "is it healthy" cannot be confused at a glance, which is the failure the previous single-form system kept producing.

### Data visualization

Series colour comes from the **ink** tokens directly — `--primary-on-surface` for NR, `--lte-on-surface` for LTE, `--downlink-on-surface` / `--uplink-on-surface` for a directional pair. One hue per family, so a colour learned on one card holds on the next.

- **Strokes are saturated and 2px.** A chart line is the boldest thing on its card; the card is neutral so it can be.
- **Area fills** are a gradient of the series ink, 0.32 alpha falling to 0 (The Area-Fill Rule, below). Monotone curves, horizontal gridlines only.
- **Threshold guides** are dashed, `--border`, low opacity.
- **Legends** use a filled dot in the series ink beside the label, never a colour-only key.
- Any added series is measured against every existing one under both simulations before merge.

**The Area-Fill Rule.** An area chart may wash the region under its stroke with that stroke's own ink, as a `linearGradient` fading to zero at the far edge. This is **ink, not a container** — the Don't list's "give identity or direction a large container block" governs tinted *surfaces* a reader looks at, and a fill bounded by a data path is a reader looking at the data. Two conditions make it so, and both are load-bearing:

- **Capped at 0.35 opacity at the stroke.** Past that the wash stops reading as the stroke's own shadow and starts reading as a filled block in a direction hue, which is the thing the Don't forbids. On the RM520N fork every fill gradient in `signal-history.tsx`, `live-latency.tsx` and `round-trip-card.tsx` starts at 0.32, under the cap; the target's dashboard charts have not been audited against either condition, so check them when they are re-authored (U4.7, U4.10).
- **A fixed or floored scale.** The wash encodes one thing — how close a point sits to the plot's ceiling — so a ceiling that re-derives itself every poll makes it encode nothing: the same reading draws a different intensity depending on what else happened to be in the window. A fixed axis qualifies by construction; a self-normalising series qualifies only once its divisor is floored at a meaningful value. **A fill over a freely renormalising axis is not permitted** — floor the scale or drop the fill. *(On the fork, two charts were still over a data-relative axis when this was written.)*

A fill is never the only channel: the stroke carries the series and the glyph-paired legend carries which direction it is (The Glyph-Carries-The-State Rule).

**Never use the numbered `--chart-1..6`.** They are shadcn-starter inheritance with two disqualifying properties: their values are byte-identical in the light and dark blocks, so a chart built on them does not theme at all; and `--chart-1..5` sit in one hue family, so LTE and NR would be separated by lightness alone.

### Named Rules

**The Data-Ink Rule.** Colour belongs to the reading, not to the container holding it. A card is neutral; the numeral, stroke, bar, and glyph disc on it are coloured. Before tinting a surface, ask what fact the tint encodes — if the answer is "it looked plain", the surface stays neutral. Large tinted blocks are reserved for the functional roles, where the tint *is* the state.

**The Three-Layer Rule.** Ink for values and strokes on neutral ground; fill for compact emphasis; container for functional-role blocks only. Identity and direction have no container job. Never cross a pair: a fill takes its own `-foreground`, a container takes its own `on-` ink, and a neutral-ramp ink (`on-surface-variant`) on a tinted surface is always a bug.

**The In-Gamut Rule.** Every token is inside sRGB by construction. This is correctness, not polish: Lightning CSS gamut-maps out-of-range `oklch()` at build time and its mapping is not naive clipping, so an out-of-gamut token ships a colour nobody authored and measured separation computed from the source value is fiction. The previous palette had 87 such tokens; this one has zero, which is what makes "declared equals shipped" true. Any new value is checked for gamut before it is checked for anything else.

**The Measured-Separation Rule.** Colour decisions are measured, never reasoned from hue arithmetic. This replaces the old 40-Degree Rule, which was a proxy for a measurement and behaved like one: it permitted pairs that collapsed and forbade pairs that were fine, and it needed an exception every time it met real data. Simulate deuteranopia and protanopia, compute OKLab ΔE, and hold the **0.05 floor** — on the layer the colour will actually ship on. Degrees of hue separation are not evidence.

**The Identity-Never-Acts Rule.** `nr` and `lte` say which radio. They never mean healthy, never tint a control, and never appear in a quality scale. Where a surface carries identity *and* reports quality, the quality is encoded non-chromatically — the signal cards use the Material glyph's bar count.

**The Info-Is-Brand Rule.** An informational state resolves to the brand ramp. It does not get its own hue. An info chip and a primary button differ by shape and glyph, not by owning two different blues.

**The Fact-Is-Info Rule.** A fact worth knowing that is neither a fault nor health uses the `info` role: the brand blue, as a filled `Badge variant="info"` with a glyph. A grey outline reads as disabled or unavailable, amber as a problem, green as healthy, so none of them can honestly say "this is how it is, and it matters". The worked case on the RM520N fork is Frequency Locking's **"No automatic recovery"** chip on the locked verdict (`components/cellular/frequency-locking/freq-lock-hero.tsx`, `verdict.no_recovery`; the target's Frequency Locking page at `/cellular/cell-locking/frequency-locking` meets the same rule when it is ported): frequency locking has no failover watcher, so unlike band and tower locking nothing restores service on its own — a fact the user needs while a lock is in force, neither a fault in the device nor a sign of health. It is drawn `info` on the amber locked panel, measured 2026-10-06 (OKLab dE against the panel: info 17.0 light / 23.3 dark vs muted 14.8 / 20.1; ink on chip 8.1:1 / 7.8:1; separation holds under deuteranopia). The rule follows The Info-Is-Brand Rule (info is the brand ramp, not a hue of its own) and The Quiet-Default Rule (the chip is shown only while the fact applies; the exception wears the fill).

**The Direction-Is-Not-A-Radio Rule.** Rose and cyan say which way the bytes are going, on either radio. A download figure on the LTE leg is rose-on-violet and neither hue is guessing about the other. Neither carries a second meaning: counts and capacities are neutral.

**The Glyph-Carries-The-State Rule.** Colour is never the sole carrier. Every status chip has a glyph, no two states in one slot share a glyph, every directional readout pairs its hue with an arrow, and the quality ramp always pairs its colour with bar length. This is load-bearing rather than decorative: adjacent ramp stops are intentionally below the separation floor, so colour is never the only channel there. The bar carries magnitude within the scale, and `QUALITY_GLYPH` carries the stop itself.

**The Neutral-Default Rule.** A figure with no honest hue stays neutral. Adding a colour because a block looked plain is the failure mode this whole system exists to prevent, and it is the one that recurs.

## Typography

**Interface font:** Rethink Sans (`--font-sans`, WOFF2 variable font via `next/font/local`), with `system-ui, sans-serif` fallback.
**Machine font:** JetBrains Mono (`--font-jetbrains-mono` → `font-mono`), vendored under `app/fonts/` and loaded through `next/font/local`.
**Icon typefaces:** Material Symbols Rounded on the shell and converted routes; lucide elsewhere. An icon font is not a voice and does not count against the Two-Voice Rule.

**Character:** Rethink Sans's rounder terminals and open counters read as warmer than geometric humanist forms, while keeping enough weight contrast to stay legible in dense label stacks at 12px. JetBrains Mono is the machine's voice: opaque identifiers and raw strings the device emits verbatim. The pairing is the product's thesis in two fonts — a human interface reporting machine truth.

**Loaded weights:** 400 body, inputs, descriptions · 500 labels, chips, buttons, table headers · 600 card titles, section headings, numeric readouts · 700 page titles only. Rethink Sans is a true variable font (wght 400–800), so it self-hosts as two files — normal and italic — rather than a static cut per weight.

> ⚠️ WARNING: Do not move any face back to `next/font/google`. That loader self-hosts its *output* but still fetches from fonts.googleapis.com on every cold build, so a slow or absent link fails the production build outright (`Failed to fetch 'JetBrains Mono' from Google Fonts`). This app is built to be served **by the modem**, often from a field machine, so every face — Rethink Sans (normal and italic), JetBrains Mono and the Material Symbols subset — resolves to a local file under `app/fonts/` and the build has no third-party network dependency. The vendored JetBrains Mono file is Google's own `/* latin */` cut of the variable font, byte-for-byte, with its `weight` range and `unicode-range` copied from the same stylesheet so the declaration the browser sees is unchanged. Re-vendoring means re-fetching that family's `css2?family=…:wght@…` stylesheet and taking its `/* latin */` block. **Target status:** every face is vendored as of ledger row U1.3 (2026-10-15).

### Hierarchy

- **Display** (700, 1.875rem / 30px, -0.02em): the `h1` at the top of every feature page, followed by an `on-surface-variant` description. One per route.
- **Headline** (600, 1.25rem / 20px, -0.01em): large tile values, state-screen labels, section headings inside a hero card.
- **Title** (600, 1.125rem / 18px): the card title. `CardTitle` itself ships only `leading-none font-semibold` and takes its size from the call site.
- **Body** (400, 0.875rem / 14px): descriptions, prose, card copy, table cells. `leading-relaxed` and `text-pretty` on any paragraph over one line.
- **Row** (600, 0.8125rem / 13px on a **20px** line box): metric-row keys and values on a glance card. **The explicit leading is not optional** — 13px is an arbitrary Tailwind size, so it would otherwise inherit whatever leading the card sits in; pinning the line box is what holds the row at exactly 40px and keeps its skeleton's `h-10` mirroring it. Do not reach for 13px outside a dense metric row.
- **Label** (500, 0.75rem / 12px): chips, tags, table headers, button text, form labels, tile eyebrows. Tiny uppercase section labels run 11px with `tracking-wider` in the sidebar.
- **Numeric** (600, `tabular-nums`): any figure the interface reports — a live measurement or a short numeric label such as an EARFCN or PCI (The Machine-Voice Rule). **This is the one step deliberately not on a fixed ramp** — a numeral is read at the distance its container implies, so its size derives from the slot holding it, and a literal `text-[Npx]` on a `tabular-nums` numeral is correct by construction. It renders in `--font-sans`, not `font-mono`. A numeral *not* sized to a slot still takes the ramp, and prose never qualifies.

### The banner-scoped step

A page-level `Banner` title is **15px / 600** with `tracking-[-0.005em]`; its description is 13px. 15px is deliberately **the only sanctioned literal outside the pre-auth scale**: a banner title has to out-weigh the copy beneath it without competing with the card heading above it, on a surface that mounts at any width on any route, and both 14px and 18px fail one of those two jobs.

### The pre-auth card exception (`/` and `/login/`)

The two pre-auth surfaces run a **denser five-step scale of their own**. It applies only to the Overview splash and the login page.

| Step | Size | Role |
|------|------|------|
| Card title | 600, 19px, -0.01em | the card's own `h1` |
| Section title | 600, 17px | the empty-state headline |
| Emphasis | 600, 15px | the 48px pill CTA label, status-tile values |
| Body | 400/500/600, 13px | subcopy, field labels, inline errors, banner body |
| Eyebrow | 600, 11px, `tracking-[0.11em] uppercase` | the label above every tile and section |

**Why.** Every other screen sits inside the app shell, where the sidebar, page title, and card grid establish scale before a card says anything. These two are the only screens that are a single card on an empty canvas, so the card must build five levels of hierarchy from nothing inside roughly 400px. 11px is the floor. **Both surfaces must agree:** when one of these steps changes, it changes on both in the same commit.

The scale itself lives in `components/pre-auth-type.ts` and is **type-only by design**. The two cards genuinely differ in width (544 vs 404), inner spacing and gutter, so a shared *geometry* module would be mostly non-shared and would invite the second card to inherit a measurement that was only ever right for the first. What they share is the voice, not the box.

**The pre-auth control height is 48px, not the canon's 42px.** This was undocumented drift until 2026-08-30; it is written down here rather than "fixed" because it is right. The Field-ergonomics rule below already sets a 44px floor for coarse pointers, and these are the two most phone-first surfaces in the product — the login card in particular is often the first thing touched on a handset, outdoors, one-handed. Both the password field and the pill CTA are 48px. Do not "correct" them to 42px to match the app scale: a surface-scoped exception that clears a documented accessibility floor is not drift once it is stated, and the app scale's 42px applies behind the login, where a pointer is usually a mouse.

### Named Rules

**The Two-Voice Rule.** Rethink Sans is the interface, JetBrains Mono is the machine. There is no third typeface. Pairing Rethink Sans with another UI sans (Inter, Geist Sans, IBM Plex, Roboto, Manrope) is forbidden.

**The Machine-Voice Rule.** `font-mono` is scoped to strings whose *character grid carries meaning*: content the user compares character by character or would paste into a terminal. That is raw AT responses and the AT terminal itself, log lines, copyable commands, file paths, IPv4/IPv6/MAC addresses, interface names, hostnames, APN strings, MCC-MNC codes, hex values and bitmasks (the `0x` TAC pill, a band bitmask), and long opaque identifiers — ICCID, IMEI, IMSI — which stay mono *even though they are all digits*, because they are compared, not read as a quantity. A human-authored label never wears it.

Everything the interface reports as a **figure** takes `font-sans` + `tabular-nums`: measurements (RSRP, RSRQ, SINR, throughput, latency, temperature, percentages, counts, durations, data volumes, bandwidth and frequency in MHz) **and short numeric device labels** — EARFCN, NR-ARFCN, PCI, band number (`B3`, `n78`), TAC, decimal cell ID and the eNodeB / sector IDs derived from it, channel and slot numbers.

The tell: **is this a quantity you read, or an opaque string you compare?** A quantity, however static, is `font-sans tabular-nums`. An opaque string, however numeric, is `font-mono`. Rethink Sans's tabular numerals give the column alignment mono used to be borrowed for, so a short numeric label loses nothing by moving.

> ⚠️ The tell changed on 2026-09-26. It used to be *"does the value change while the user watches?"*, which put band, EARFCN and PCI in mono. The target has not been swept to the new tell, and the fork's own `shapes.ts` comments still cite the old one in places. Move a site when you next touch its surface, and correct any comment that cites the old tell in the same change.

**The Weight-Discipline Rule.** 400 body, 500 labels and medium emphasis, 600 headings and numerics, 700 page titles only.

**The Tabular-Number Rule.** Any figure that can change while on screen is `tabular-nums`, in whichever voice it is already in. The class controls digit-width jitter; it does not decide which voice owns the value. A latency readout whose digits shift width reads as the layout twitching, not as the value moving.

**The Truncation-Pair Rule.** Where two cards sit side by side as a pair, every text node in their headers carries `min-w-0` and `truncate`. One card wrapping to two lines while its sibling stays at one breaks the paired baseline. Italian is the locale that trips it.

## Layout

**Every feature page is the same shape:** a page header (display title plus a muted one-line description, with optional pill actions right-aligned) followed by a uniform grid of self-contained cards. There is no bespoke per-screen composition. A user who learns one page has learned them all.

**Responsive behavior is container-driven.** The content column declares `@container/main` and cards respond with `@3xl/main:`, `@4xl/main:`, `@5xl/main:`. A card that declares its own `@container/card` uses `@sm/card:` and `@md/card:` inside itself. Mixing viewport `sm:` with container `@sm/card:` in one card breaks on tablets and expanded sidebars. Viewport breakpoints stay for page-level concerns only: the gutter (`px-4 lg:px-6`) and the sidebar's own collapse.

**The grids that ship (RM520N reference).** The dashboard is a 5-column container grid (`@4xl/main:grid-cols-5`) with a 3-column left stack and a 2-column right rail, then full-width rows beneath. Radio Information is a **single-column stack of full-width cards ordered by cadence** — what moves every poll above what moves on handover — under a 4-up tile strip. Both collapse to a single column with no special-casing.

> Radio Information was once a symmetric 2-up with both cards `h-full`-locked to each other. That is a split by **symmetry**, and symmetry is not a property either card has: the lock forced a static reference card and a live telemetry card to one height, stranding ~200px of dead space in whichever had less to say — and which one that was flipped with the carrier count. **Split a page by cadence, not by symmetry.** The fix there was to stop pairing those two cards at all, not to let a desktop row run ragged: a card that cannot fill its share of a row belongs in a full-width band of its own.

**Spacing rhythm.** Page gutter 16px rising to 24px. Card grid gap 16-24px; tile grid gap 14px; in-card row gap 6px; inline element gap 8-10px. Card padding is 24px (`px-6`) standard and 28px (`px-7`) on hero cards, with 24-26px vertical.

**Equal heights are not optional.** Cards that sit side by side on a desktop-width row share one height, and a bento group resolves to one symmetrical height across the group. A grid row uses `items-stretch` with `h-full *:data-[slot=card]:h-full` on each cell; `items-start` in a multi-card row is a bug. The lock is only honest when every card in the row has a state built to *fill* the slack, with exactly one region nominated to absorb it (`flex-1` over a `min-h-0`), and that holds for the loading, empty and error states too, not just the loaded one. A card with nothing to fill with does not belong in a symmetric row: promote it to a full-width band rather than leave the row ragged.

**Field ergonomics.** Touch targets are a minimum 44px on coarse pointers; icon-only tab lists bump `TabsList` height rather than shrinking triggers. Toolbars `flex-wrap`. Tables wrap prose columns and treat horizontal scroll as a fallback.

### The pinned console

A surface whose primary reading must never leave the screen splits into a **sticky anchor column and a work column**. Antenna Alignment is the first instance: at `@4xl/main` a 12-column grid gives the console 5 and the work column 7, and the work column stacks Positions over a compact Receive Chains card.

Four facts about it are load-bearing, and all four live in `components/cellular/antenna-alignment/shapes.ts`:

- **The console column must stretch.** A sticky child travels inside its own containing block, so its slack is the parent's height minus its own. An `items-start` tidy-up shrinks the column to the console's own height, the slack goes to zero, and the pane never pins — while looking perfectly correct in a static screenshot. The grid's default `stretch` is the feature, not an oversight.
- **Place a card by the column heights it produces, measured, not by rule.** Receive Chains has sat in both places. In the work column with tall tiles it ran 929px against a 403px console, so it moved to a full-width row. The live RSRP lead later took the console to ~620px, which stranded ~200px of empty Positions card under its Record button and pushed Chains below the fold at 1080p, so it came back into the work column as compact tiles (2026-10-25): at 1920 the columns match to the pixel and the page reads in one viewport. Re-measure whenever either column gains or loses a block.
- **Each column nominates one slack absorber.** The console's is the live trace (48px floor, 192px ceiling, past which the score group holds the card's bottom edge); the work column's is the Chains card, whose cross-link holds its bottom edge. Positions never stretches.
- **Mobile order is question order** — console, positions, chains — and moving a card between a column and a full-width row must not disturb it.

**A per-family `shapes.ts`.** Each route family owns one module holding its geometry, control heights, glyph sizes and tone maps, imported by the loaded views *and* by their skeletons. Geometry is restated across sibling families, never imported from one; anything genuinely family-wide is promoted to a shared module under `components/<area>/` instead (the fork's `components/cellular/tile-shape.ts` and `signal-quality-display.ts`). Without one, a surface accumulates byte-identical card-shell strings across files, several control heights inside one card, a handful of glyph sizes and two letter-spacings for a single label role, none of it visible in any one file, which is why it survives. The fork has eight such modules under `components/cellular/**` (`settings/`, `cell-scanner/`, `antenna-alignment/` and `sms/` among them), and SMS was the last family to get one and had exactly this failure set: four copies of one pill action, an alias to nothing, a component exporting the page grid that lays it out, and skeletons that had drifted into guessing. The target's first is `components/cellular/cell-scanner/shapes.ts` (U4.3). Create a family's `shapes.ts` when you first port a page in that family (ledger U2.3).

### Named Rules

**The Consistent-Layout Rule.** Page header plus a uniform card grid, on every feature page. A bespoke hero-driven layout invented for a single screen is a consistency failure even when it looks good in isolation. A genuine glance surface may earn a hero card; it is a rare exception, never the default.

**The Card-Wrapped Surface Rule.** The unit of composition is the **card that wraps a settings group**, not the page. The card owns its whole content; the page only arranges cards. A feature that scatters loose fragments across the viewport has skipped the card.

**The Full-Width Page Rule (hard rule).** A feature page's content column spans the full width of the shell's content area — `@container/main mx-auto flex flex-col gap-5 p-2`, the shape every feature page shares (the fork's `PAGE_ROOT` in `components/about-device/shapes.ts` and `PAGE_SHELL` in `components/cellular/antenna-alignment/shapes.ts`; the target defines one shared page-shell constant when the first page is ported). **Never cap the page column with a `max-w-*` container**, however few cards the page has: a narrow centred column reads as a different app beside its full-width siblings and breaks the Consistent-Layout Rule. Full width is not a licence to stretch. A card whose layout was drawn for a phone column must **recompose itself on a wide card** through a step on its own `@container/card` (`@3xl/card:`, `@5xl/card:`): put side by side what was stacked, and show at once what was hidden. `segmentedBreakpoint()` in `components/ui/segmented-field.tsx` is the pattern — a select on a narrow card, every option visible as a segmented group on a wide one. A column count is a proposal, not a reflex; a single column recomposed inside its cards often reads better than a two-up grid. Readability limits belong *inside* a card or header (the fork's `max-w-[41rem]` description column in `components/cellular/page-header.tsx`, a capped paragraph), never on the page. The pre-auth pair and the onboarding flow run their own single-card shells and are not feature pages.

**The Card-Foot Apply Rule (adopted on the RM520N fork 2026-10-06 and by the target 2026-10-15; supersedes the page-level and sticky save bars, including the target's earlier Sticky-Save-Bar Rule).** A card that edits a draft commits it from a **footer row on the card's own bottom edge, with no border line** — `CardFoot` (`components/ui/card-foot.tsx`; constants `CARD_FOOT` / `CARD_FOOT_STATUS` / `CARD_FOOT_ACTIONS`). The row carries no `border-t`, only `pt-4` of air, pinned with `mt-auto`, one fixed `min-h-16` slot so the card never jumps between idle, dirty, applying and failed. **Status holds the left edge** (the consequence of applying, a running stepper, what failed, a blocked reason; never the dirty state itself: no "Unsaved changes" or change-count text, the enabled Save button already says it); **actions hold the right edge** — `Discard` (ghost) and any secondary action first (ghost or `tonal-neutral`, never a stroked `outline` button), the `SaveButton` **last**. The row is persistent: an idle card shows Apply disabled with its reason, it does not mount a bar when something changes. Never an Apply floating mid-card, a save bar under the card grid, or a `SaveButton` beside a field. Use a plain element, not shadcn `CardFooter` (its `[.border-t]:pt-6` fights `pt-4`), never wrap the `SaveButton` in `AnimatePresence`, and pass copy and glyphs in as props so the primitive stays route- and icon-neutral. A footer with no status may use the constants directly (`CARD_FOOT` + `CARD_FOOT_ACTIONS`) so an empty `min-w-[13rem]` status slot doesn't force the actions onto a second row on a phone; a footer with custom status structure uses the constants around its own markup. Field errors stay with their field, not in the footer. **Exempt:** dialogs and wizards (their own `DialogFooter`), per-row and inline actions, and operational actions that are not a draft commit (start a scan, send a message, download a profile). A page whose one apply spans several cards puts its footer on the card the apply belongs to most. The fork's editable cards used to commit from five different places — a stock footer, a local footer, an inline row, an in-card tonal bar and a page-level bar — and the user asked for one grammar; this is a **sweep rule** for apply placement, unlike the Scanning Rules. On the fork the sweep landed 2026-10-06 and Watchdog later split its apply into one footer per card. In the target the sweep is ledger U4.1 (Settings, Cellular Settings), with Watchdog (U4.6) and Alerts (U4.9) retiring their sticky bars. Until a card's row runs, any new or reworked editable card commits from `CardFoot`, full stop, and a multi-card apply sits on the card it belongs to most.

**The Container-Query Rule.** New responsive behavior is a container query against `@container/main` or a card-local `@container/card`. Reach for a viewport breakpoint only for the page gutter or the shell itself.

**The Sticky-Slack Rule.** A sticky pane's travel is its parent's height minus its own, so the column holding it stretches. When a "pinned" element never moves, check the column's alignment before the offsets.

**The Symmetric-Pair Rule.** Two or more cards on one desktop-width row, and every card in a bento group, resolve to a single height. Reach for `items-stretch`, never `items-start`. The obligation that creates is on the content: each card nominates exactly one region to absorb the slack, in every one of its three states. Where a card has nothing to fill with, the row is the wrong container, and the answer is to promote it to a full-width band rather than accept ragged heights.

**The Grid-Step-Costing Rule.** Cost a responsive grid step against the narrowest cell it produces **in the column it actually lives in**, never against the page width. A 4-up step that is safe full-width at `@3xl` collapses the bar lane to nothing inside a 7-of-12 column at the same breakpoint — which is the named bug of ramp ink on a numeral with no bar beside it.

### The Scanning Rules

PRODUCT.md Principle 8 says a surface is scanned, not read: the user arrives with one question and hunts for its answer. These rules are how a card makes that hunt short. A receipt is the model. Item names run hard against the left edge and prices hard against the right, with no dividers and almost no whitespace, and two edges hold the whole thing together. Nearly every "why does this card feel off" has one of four causes: a missing edge, an undifferentiated run, a glyph that has to be decoded, or a default value dressed as loudly as a changed one. Awkward whitespace is a symptom of one of them, so before proposing padding, find what sets the empty region's size — a sibling's `min-h`, an `mt-auto` note, an `h-full` stretch, an equal-height row with one sparse card, a phone-width control on a wide card — and fix that.

> ℹ️ NOTE: **Goal rules, adopted from the RM520N canon (2026-09-26)** together with the Full-Width Page Rule, Copy & Help and the amended Machine-Voice tell. Most shipped surfaces predate them. Apply them when you build or rework a surface; don't sweep untouched pages to enforce them.

**The Two-Edge Rule.** Every element aligns to at least two edges. An edge is a card edge, a column edge, or the edge of the row above it. Content that gets read aligns to an edge: a row's key sits on the left edge and its value on the right, like a receipt. Centre only what stands alone and isn't scanned as part of a set: a meter's readout inside its dial, an empty state, a dialog's lead glyph. Once two edges are holding, separators mostly become unnecessary; reach for a `Separator` only between groups that alignment and a section label can't split on their own.

**The Manufactured-Edge Rule.** When a region has nothing to align to — actions floating somewhere between the title and the body — don't scatter them. Create an edge: put the actions in `CardAction` on the header's right edge, sharing the title's line, or in a footer row on the card's bottom edge (for an editable card, The Card-Foot Apply Rule fixes what that footer holds). Moving secondary actions into a `⋯` menu doesn't fix a loose card, because hiding an element isn't aligning it. Collapse into an overflow menu only after the one or two primary actions already hold an edge, and only when what's left is genuinely occasional.

**The Stack-Height Rule.** A leading element (a glyph disc, logo plate or avatar) is only as tall as the text stack beside it. A 32px disc next to a single line of text leaves its bottom edge hanging. Either give it a two-line stack (a label plus a meta line) so disc and text share a top and bottom edge, or drop to an inline glyph at text size. The 52px tile disc beside its eyebrow → value → caption stack is the shape done right; don't vertically centre a tall disc against one short line and call that aligned.

**The Row-Span Rule.** The distance between a row's left and right edges has a ceiling. Stretch a key/value row across a 1400px card and every edge is still technically there, but the key and its value no longer read as a pair, because the eye can't carry across the gap. This is the in-card half of the Full-Width Page Rule. Once a row gets wide enough that its pair starts to separate (about 600px of row is the working limit), **recompose the card**: split the rows into two or three columns on a card step (the fork's `GRID` in `components/local-network/traffic-engine/shapes.ts` steps `@xl/card:grid-cols-2 @3xl/card:grid-cols-3`; the target's Traffic Engine is a different engine, so write your own). Don't let the gap keep growing, and never answer it by capping the page.

**The Group-Before-You-Pad Rule.** When a dense list or settings group is hard to read, the problem is undifferentiated content, not too much content. Fix it in this order:
1. **Group it** with a section label (Label style, `on-surface-variant`) over each run. Five related rows under a label are one glance; fifteen unlabelled rows are fifteen reads.
2. **Vary it** with a glyph, a tag or a coloured numeral that carries a real fact, so rows are told apart by shape before they're read.
3. Only then consider spacing.

Adding whitespace first makes the surface longer without making the answer easier to find. Density is still the product (Overview); this rule is how density stays scannable.

**The Recognition Rule.** A visual replaces text only when it's recognised without help. A universal glyph (trash, pencil, copy, a direction arrow), a bar whose length is the value, a status chip whose glyph is the state and a band `Tag` all qualify. An icon-only control whose meaning you learn from its tooltip hasn't replaced text; it has hidden it behind a hover a touchscreen can't do. Give that control a visible label. The Convention-First Rule governs words; this rule governs glyphs. `aria-label` stays mandatory either way.

**The Quiet-Default Rule.** Emphasis isn't something an element has; it's the difference between the element and its neighbours. So a value in its default or expected state renders **quiet** (`on-surface-variant` ink, no fill, no role colour), and a value that differs from it stands out without any extra treatment. A checkbox is the model: off is a thin outline and nothing else, and the fill is the signal that something changed. Nobody ships a checkbox that's blue when it's off.

- **Settings summaries and read-only rows.** A setting still at its factory default is muted. One the user changed takes normal ink, and a role colour where the value genuinely carries one.
- **Lists where the expected state dominates.** Say eight services are Running and one is Stopped. The exception keeps its filled chip; the expected rows may drop to glyph plus plain ink without the container. The glyph stays (The Every-Chip-Has-A-Glyph Rule), but the fill is saved for the row that needs finding. A status-first hero's single state chip is the page's first answer and stays filled.
- **To make one thing stand out, quiet its neighbours.** Don't turn it up with bolder weight, a bigger size or more saturation. If everything is emphasised, nothing is. That is why each card gets one primary-filled action at most, and why `--primary` is the only hue that acts.

**The One-Nest Rule.** Inside a card there is at most one level of inner container: a `surface-container` tile at `rounded-tile`. A group inside a card is set apart by a section label and spacing along the card's own column edge, not by another box. A card holding a tile holding a bordered box stacks three tones and three radii, and none of them help. When the one inner level is warranted, its radius steps down with it (The Radius-Follows-Size Rule) so the corners read as concentric rather than competing.

## Elevation & Depth

**Depth is tonal, not cast.** A surface separates from its parent by sitting one step along the neutral ramp — canvas, then surface, then surface-container, then surface-container-high. `--card-sheen` does not qualify that: it is a treatment printed on a card’s own fill, not light cast onto the page behind it.

The reason is now structural rather than environmental. The previous justification was sunlight legibility, and that requirement has been retired. What remains is stronger: **this system has no colour to spare for chrome.** Colour is spent on data, so a shadow would be the only other separation mechanism — and in near-black dark mode a shadow is invisible against the ground, which means a shadow-separated layout has no dark theme at all. The tonal step works identically in both themes. A shadow does not.

### Shadow Vocabulary

- **Whisper** (`0 1px 2px oklch(0.205 0.011 258 / 6%)` in light, resolving to `0 0 #0000` in dark): an optional card lift. Light mode's canvas-to-card step is 0.985 → 1.000, a deliberately narrow gap, and the whisper is what keeps that edge legible without a hairline. Never load-bearing.
- **Popover Float** (`shadow-lg` and up, via shadcn defaults): dialogs, dropdowns, popovers, the skip-to-content pill. The "not part of the page flow" signal, and the one place a shadow carries real meaning.
- **Sheen** (`--card-sheen`, reaching the DOM through the `card-sheen` `@utility` in `app/globals.css`): `none` in light; in dark a `180deg` gradient running `oklch(1 0 0 / 0.045)` at 0% → `oklch(1 0 0 / 0)` at 42% → `oklch(0 0 0 / 0.03)` at 100%. Five consumers: the `Card` root (`components/ui/card.tsx`) and the four floating surfaces — `DialogContent` (`components/ui/dialog.tsx`), `AlertDialogContent` (`alert-dialog.tsx`), `SheetContent` (`sheet.tsx`) and `DrawerContent` (`drawer.tsx`). It casts nothing, so it is not a shadow — it is listed here because it does the job a shadow would.

### Named Rules

**The Tonal-Elevation Rule.** Two surfaces at different conceptual elevations differ by at least one container step. If two surfaces are only distinguishable by their shadow, one of them is on the wrong step of the ramp.

**The No-Hairline-On-Fill Rule.** A tonal container never also carries a border. Cards ship `border-0` explicitly, because a hairline over a fill reads as chrome around the colour rather than as the edge of a block. **The outline tag is the one deliberate exception in the system** — there the border *is* the component, because there is no fill for it to sit on top of. `--border` is otherwise for input strokes and genuine table rules only.

**The Highlight-by-Container Rule.** Emphasis promotes a surface one container step and changes its ink, rather than adding a translucent wash over a neutral card. A recommended alignment slot becomes a `primary-container` block; a running pipeline step becomes a `primary-container` row.

**The Card-Sheen Rule.** In dark mode `--shadow-whisper` resolves to `0 0 #0000` and cards ship `border-0`, so a card’s entire separation from the canvas is one 0.05-lightness tonal step (0.120 → 0.170). `--card-sheen` is the material cue standing in for the shadow dark mode never gets: brightest at the top edge, transparent by 42%, settling into a hair of shade at the foot. **Light stays flat on purpose** — `--shadow-whisper` already carries that theme’s separation, and a gradient over a white card reads as a smudge. It rides on `background-image`, a deliberately different property from `background-color`, so a call-site `bg-surface` or `bg-card` cannot defeat it. It is scoped to the `Card` root and to every floating surface that opens over a scrim — `DialogContent`, `AlertDialogContent`, `SheetContent`, `DrawerContent` — and goes no further: an inner tile that also took it would stack a second sheen inside the first. The same property choice that makes it undefeatable makes it a hazard where a nested `Card` is *meant* to be neutralised — `bg-transparent` clears only `background-color`, so such a call site needs `bg-none` beside it. On the fork, `components/cellular/custom-profiles/profile-form-dialog.tsx` is the one site that neutralises a `Card` inside a `DialogContent`, and it carries both; the target's profile dialogs do the same when they nest a `Card`.

## Shapes

Radius carries size hierarchy: the bigger and more important the surface, the softer its corners.

| Step | Value | Owns |
|------|-------|------|
| `rounded-inline` | 0.5rem (8px) | Small inline affordances, code blocks, skeleton slivers |
| `rounded-field` | 0.625rem (10px) | Inputs, selects, small popovers, banners |
| `rounded-tile` | 0.75rem (12px) | Inner tiles, carrier tiles, alignment slots |
| `rounded-card` | 1rem (16px) | Standard cards in a grid, dialogs |
| `rounded-hero` | 1.25rem (20px) | The anchor card on a surface, the aggregation strip, state screens |
| `rounded-pill` | 9999px | Chips, tags, buttons, nav items, metric rows, meters, glyph discs, quality bars |

The distinction between `card` and `hero` is real and used: a grid of peer cards takes `card`; the one card that anchors a surface takes `hero`.

The silhouette this produces is deliberate: **restrained, near-rectangular containers set against full-round elements**. The contrast is the point — a container that barely softens its corners is what makes the pill beside it read as unmistakably round. Fills over strokes, round caps on every meter and progress track, no side-stripe accent borders. Nothing has a square corner except a table rule and a chart gridline. The mark is built the same way — two shapes, two tones, one hue, no gradient, no shadow **in its own construction** — and UI shapes read as members of that family in geometry and fill. The family parts in exactly one place: a card in dark mode carries `--card-sheen`, a vertical gradient the mark never has, because a card has to separate from the ground it sits on and a mark does not. That is a surface treatment, not a second visual language — see Elevation & Depth.

**Why the scale was retuned down.** The first scale ran 12/20/28/36/40px. At 36px on a card roughly 180px tall the corner consumed about 40% of each vertical edge, so the shape read as a lozenge rather than a panel; the reference proportions are Apple’s Fitness and System Settings, not a general softening. The retune also closes a two-systems seam: `components/ui/card.tsx` ships `rounded-xl` (14.4px) and `components/ui/dialog.tsx` ships `rounded-lg` (10.4px) off the legacy chain, so a migrated 36px card sitting beside an unmigrated one read as two products. At 16px the card gap closes to 1.6px.

### Named Rules

**The Radius-Follows-Size Rule.** A surface's radius is a function of its size and role, not of taste. A 12px tile never sits inside a 10px field, and a banner never out-rounds the card it sits on.

**The Fill-Over-Stroke Rule.** When a shape needs to be distinguished from its neighbour, change its fill, not its border. The outline tag is the sanctioned exception, and it is a *component*, not a technique to generalise.

**The Role-Radius Rule.** New work uses the role scale above. The legacy `rounded-{sm,md,lg,xl}` chain off `--radius: 0.65rem` still resolves for unconverted call sites and keeps its old values, but it is never the correct choice in a new component.

## Motion

**Character: expressive in duration and curve, and still settled.** The expressiveness is in the easing, never in overshoot — which is what keeps it compatible with a tool whose job is holding a connection alive. `lib/motion.ts` is the JS source of truth and mirrors the CSS custom properties in `globals.css`; retune one layer and you retune the other in the same change.

**Durations.** `quick` 360ms (label swaps, value ticks, hover tints, focus rings) · `standard` 600ms (the default for a state change — card entrance, nav indicator, chip morph, meter retarget) · `emphasized` 800ms (container size and shape, aggregation re-proportioning, banner arrival, meter first-fill) · `ambient` 2s (the sanctioned loops only).

**Why these are double the Motion Guide's printed figures.** The guide's token table reads 400/300/180ms, and those are the numbers it *renders at 1x* — but every demo in it is authored as `calc(<loop> * var(--sp))`, driven by a Playback control that sets `--sp` to `1 / speed`. Playback exists because, in the guide's own words, half or quarter speed "is the only way to actually inspect a 180ms token". Reviewed at that 0.5 setting — exactly this scale — the system reads as deliberate rather than snappy. **The guide's figures are the inspection baseline; the figures above are the shipped scale, and this document wins.** The *ratios* are untouched (3 : 5 : 6.67), which is what keeps every composed gesture in shape.

`ambient` is deliberately **not** doubled. A loop is not a transition, and it is the one animation that means "this is alive" — at 4s a breathing ring reads as a stalled UI rather than a calm one.

**Curves.** `emphasized` `cubic-bezier(0.05, 0.7, 0.1, 1)` — a deliberate departure and a long settle. `standard` `cubic-bezier(0.2, 0, 0, 1)` — the everyday state change. `quick` is a plain `ease-out`, deliberately: at the short end of the scale a bespoke cubic is indistinguishable from the built-in. **These two curves and `ease-out` are the whole vocabulary** — an arbitrary `cubic-bezier()` in an `ease-` utility is a violation, not a variant, and so is a bare `ease-linear` outside a data-driven progress bar. In a className, prefer the theme utilities `ease-standard` / `ease-emphasized` (from `@theme inline` in `globals.css`); `ease-[var(--ease-standard)]` compiles to the same declaration and is legal. In a `motion/react` transition, `EASE_STANDARD` / `EASE_EMPHASIZED` / `EASE_QUICK`.

**Entrances.** Two stagger steps, and only two. Cards cascade at **120ms** with a 10px rise (`staggerContainer` / `staggerItem`); rows inside one card cascade at **80ms** with a 5px rise (`staggerRows` / `staggerRowItem`). A list cascade bounded by row count uses `rowCascadeDelay(index)`, which derives both the step and its ten-row cap from `STAGGER_STEP_ROWS`. Rows sit ~6px apart, so a 10px lift would move each row past its neighbour's resting position and read as the card reflowing rather than as content arriving. Nested containers inherit `visible` from their parent and must **not** declare their own `initial`/`animate`, or they detach from the parent's clock — **unless they mount later than the parent.** A child that arrives in an `AnimatePresence` swap, a keyed remount, or after data loads behind a skeleton has missed the one cascade it would inherit, so it declares `initial="hidden" animate="visible"` itself; a variants-only child there stays at opacity 0 at full height, with no error. Cascade children must be block boxes — a bare `span` silently drops the rise.

**The live value tick.** A poll-driven figure dips to 0.35 opacity and returns, asymmetrically — 600ms down, 800ms up — so the dip is the event and the return is the settle. Figures within one `TickGroup` stagger 200ms apart by live DOM position, not by map index. **This is the tightest thing in the system against the poll:** a full seven-figure cascade runs 1.4s of lead plus a 1.4s dip, and the cadence measured on the RM520N fork is ~3.7-4.0s (not the ~2s the Motion Guide assumes — the fork's poller sleeps *after* the cycle body), which leaves ~900ms of headroom. The target's poller is adaptive (active, idle and deep tiers, `docs/features/adaptive-polling.md`), so re-measure the active-tier cadence before porting the tick, and re-check the arithmetic before raising the scale again or making the poller faster. Only *measurements* tick; identifiers take the container morph instead, because dipping a value that holds steady for minutes invents an event. A value that moves again mid-dip retargets rather than queueing.

**Reduced motion has one resolver.** "Should motion be reduced right now?" is answered only by `useMotionReduced()` (`components/motion-preference.tsx`, live — re-renders on a preference change or an OS toggle) or `isMotionReduced()` (`lib/motion-preference.ts`, a plain read for callbacks and non-React code). The in-app preference outranks the OS query in both directions; System defers to the OS query. motion/react's `useReducedMotion` and a raw `matchMedia("(prefers-reduced-motion…")` read the OS query only, and both are ESLint errors outside the resolver (`eslint.config.mjs`). Two paths need no call: a motion component under `MotionConfig` (`components/motion-provider.tsx`), and the redefined `motion-reduce:` / `motion-safe:` variants — raw CSS keyframes put their reduced rules in an `@variant motion-reduce` block beside them. Contract and traps: `docs/reference/motion-preference.md`. These files landed with ledger U2.2.

**Movement goes, opacity stays.** A crossfade is still legible information where a slide is not, which is why every shared variant is pure transform and opacity, and why opacity-only keyframes (`.ca-skeleton-out`, `.ca-content-in`) run unchanged under Reduced. Radix surfaces animated by tw-animate get this globally: one unlayered rule in `globals.css` zeroes the `--tw-enter-*` / `--tw-exit-*` translate, rotate and blur and holds scale at 1 under `motion-reduce`, so a dialog or popover keeps only its fade.

**Loading loops stop under Reduced, in one spelling:** `motion-safe:animate-spin` and `motion-safe:animate-pulse`. The static glyph beside its label still reads as loading. Never `animate-spin motion-reduce:animate-none` — the same result in a second spelling that every audit then has to match.

### The animations preference

Landed with ledger U2.2 (the resolver, provider and account-menu row). The row uses Material glyphs (`settings`, `auto_awesome`, `do_not_disturb_on`) since U3.1 converted the sidebar.

The sidebar account dropdown carries an **Animations** row cycling System / Full / Reduced, beside the theme row. The whole contract is one attribute on `<html>`:

| Choice | Attribute | `MotionConfig reducedMotion` |
| ------ | --------- | ---------------------------- |
| System (default) | **absent** | `"user"` |
| Full | `data-motion="full"` | `"never"` |
| Reduced | `data-motion="reduced"` | `"always"` |

**The absence of the attribute is load-bearing.** "System" *removes* it rather than writing `data-motion="system"`, and that absence is what lets the bare media query decide. The key, the type and the pre-paint boot script live together in `lib/motion-preference.ts`; `app/layout.tsx` injects the boot script render-blocking, because an attribute landing in a mount effect arrives *after* first paint — a user on Reduced would see one frame of every entrance animation, precisely the frame they asked not to see.

**A motion element reads `reducedMotion` once, when it mounts.** So `MotionProvider` derives it from the pre-paint attribute, not the context, and the first render is already right. A mid-session switch reaches CSS, charts and `useMotionReduced()` at once, and motion components as they next mount; remounting the app to force it would discard unsaved drafts.

**The load-bearing part is the CSS half.** Tailwind's stock `motion-reduce:` compiles to a bare media query with no selector hook, so an attribute on `<html>` *physically cannot* override it. Both variants are therefore redefined as `@custom-variant`s at the top of `globals.css`, each emitting `@slot` twice — once media-gated with the opposing attribute excluded, once attribute-gated.

> ⚠️ **`motion-safe` needs the same treatment, and this is the half that is easy to skip.** Without it, a user on OS-reduce who explicitly picks **Full** gets every `motion-safe:` spinner frozen — the exact inverse of what they asked for. Redefine both or neither.

Both guards are wrapped in `:where()` so they contribute **zero** specificity. The two variants can match simultaneously; duplicate identical declarations are harmless.

**Charts follow the same switch.** recharts animates through react-smooth, which `MotionConfig` cannot reach, so `useChartSeriesMotion()` (`hooks/use-chart-motion.ts`, for `<Area>` / `<Line>`) reads `useMotionReduced()`. A new chart spreads it rather than setting `isAnimationActive` by hand. `<Bar>` charts spread its sibling `useChartBarMotion()` (first consumer: the Network Events Activity chart, U4.5).

### Named Rules

**The Motion-Ceiling Rule.** Nothing exceeds `emphasized` (800ms), and `emphasized` is the ceiling, not a starting point. State the rule as *the token*, never as the number.

**The One-Scale Rule.** A duration in a component is a bug. Every transition reads `duration-[var(--duration-standard)]` (or `-quick` / `-emphasized`) in a className, or `DUR.standard` in a `motion/react` transition; a bare `duration-200`, an inline `{ duration: 0.25 }`, or a `transition-all` with no duration (silently inheriting Tailwind's 150ms) is off the scale and will not retune with it. The exceptions are narrow and each carries a comment: continuous loops with their own tempo, and linear data-driven progress bars. `{ duration: 0 }` as a reduced-motion escape is always fine. **The `var()` wrapper inside the brackets is not optional** — the custom property written naked there compiles to a declaration carrying the property *name*, which the browser discards, so it ships as no transition at all while `tsc`, `eslint` and the build all stay green. Tailwind v4's parenthesis shorthand for a custom property is the same declaration and equally valid. See `docs/reference/tailwind-prose-hazard.md`.

**The Non-Load-Bearing Rule.** If a transition never runs — reduced motion, a backgrounded tab, a paint that beat the animation — the UI must already be correct. Every entrance keyframe is written open-ended (`from` with no `to`): the resting value is the truth and the keyframe only describes the journey. A `requestAnimationFrame`-armed state flip breaks this rule, because rAF does not fire in a background tab.

**The Transform-Only Rule.** Animate `transform` and `opacity`. Meters animate `scaleX`, never `width`, on first paint; a value retarget on an existing bar uses `width` deliberately (see `components/ui/metric-bar.tsx`'s own comment) because a transform would squash the pill cap at low percentages, and it changes only when a poll retargets the fill, never per frame. The two other sanctioned `width` animations are the carrier-aggregation segment, where the width *is* the data and a `scaleX` would distort the band labels riding inside it, and the onboarding step dots (0.5rem → 1.5rem), where a `scaleX` would distort the pill caps. Any other progress fill is `scaleX` on `origin-left` (the speedtest track, the language-pack meter). On a CPU also carrying the user's traffic a per-frame layout pass per meter is not free, so nothing else animates `width`.

**The One-Loop Rule.** At most one ambient loop per surface, and only where something is genuinely live. Two exist product-wide: the service-ring pulse and the live-ping dot. A decorative loop is never one of them, with one sanctioned exception: the 404 page's pixel campfire (user-requested 2026-10-20), a stepped sprite loop in `globals.css` (`campfire-*`) that rests on a complete still frame under Reduced. A third live loop is sanctioned (user-requested 2026-10-20): the path flow on the Hardware page's path diagrams (`animate-path-flow` in `globals.css`), beads that travel only the in-play lane, only while the drawing is the real running state (never a draft or a pending reboot), and that rest as a still solid line under Reduced. A loading indicator is not an ambient loop — it stops under Reduced, above.

**The No-Overshoot Rule.** Never springy, never elastic, never rubber-banding — and no springs at all: `type: "spring"`, `stiffness`, `damping` and `bounce` appear nowhere, and every `motion/react` transition is a `DUR` / `EASE_*` tween. The one sanctioned overshoot is the save-confirmation check at 1.03 scale — and it is a **number**, not a sentence: `SAVE_CHECK_OVERSHOOT` / `SAVE_CHECK_KEYFRAMES` / `transitionSaveCheck` in `lib/motion.ts`. Anything that wants the pop imports the constant. A ceiling enforced only by prose is not a ceiling — this rule once cited the save check as the sanctioned exception while the button underneath ran an underdamped spring whose peak was bounded by nothing.

**The Enter-Only Rule.** Conditions and navigation have no exit animation. A banner leaving means the condition cleared and that should feel immediate; an outgoing route is already gone, and animating it out only delays the incoming one.

**The Modal-Exit Rule.** A modal's exit duration is an **input-latency budget**, not a taste call, and every modal surface writes its two directions separately: `data-[state=open]:` on `emphasized`, `data-[state=closed]:` on `quick`. Never one unqualified `duration-*` for both.

The reason is mechanical. Radix sets `pointer-events: none` on `<body>` for as long as a modal layer is mounted, and `<Presence>` holds that layer mounted until `animationend` fires on the content node. So **the entire page is click-dead for exactly the length of the exit animation.** An unqualified `emphasized` buys 800ms of dead clicks every time a dialog closes; a scrim with no duration leaves the backdrop on tw-animate's off-scale 150ms default, so the page *looks* live for the final 650ms of the lockout. On a dialog-dense surface that reads as the app dropping input.

- **The scrim shares the content's clock in both directions.** They are one object arriving and leaving; an overlay with no duration is a One-Scale violation *and* the thing that turns a slow exit into an apparently broken one.
- **`quick` is the ceiling for a modal exit, not a suggestion.** Distance does not buy budget: a sheet travels a full viewport edge and still exits on `quick`.
- **The drawer is a modal.** vaul injects unlayered CSS (`animation-duration: .5s`) that outranks any layered utility, so `drawer.tsx`'s timing classes carry Tailwind's `!` written inside the class literal itself.
- **Floating surfaces that are not dialogs** — popover, dropdown, select, tooltip, hover-card, context-menu — do not split their clocks: they run `quick` with `ease-standard` in both directions.

## Components

### Buttons

- **Shape:** full-round pill (`rounded-pill`) at every size — the pill is the `Button` primitive's own shape, never re-added per call site and never overridden with a smaller radius (`components/ui/button.tsx` sets it in the base class). Height comes from the size scale below. The **page action** — 42px (`h-[2.625rem]`), 20px padding, 600 weight — is `size="action"`, never a per-family constant or a hand-written height.
- **Primary:** brand fill with its own `-foreground` ink. The default for main actions — Record, Save, Apply — never `outline`.
- **Tonal:** `primary-container` with `on-primary-container`. Secondary actions of equal standing.
- **Destructive:** destructive fill with `destructive-foreground`. Never `text-white` hardcoded — dark-mode destructive is a *light* fill.
- **Ghost / outline:** transparent or hairline, `on-surface-variant` ink, `surface-container` hover. **Secondary actions beside a Save/Apply** (Discard, Restore all, Cancel, Restore defaults) carry no stroke (user, 2026-10-05): ghost, or `tonal-neutral` (`surface-container` fill, `on-surface` ink) when they need a visible shape; never `variant="outline"`.
- **Focus:** a 3px `--ring` ring at **full strength** over a 2px page-coloured gap, on the `quick` clock. Both halves are measured, not taste. **The alpha is a floor:** at half strength the ring composites to **1.968:1** against its worst ground and at 85% to **3.270:1**, where SC 1.4.11 asks 3:1 — full strength measures **4.004:1** at its worst and **5.083:1** at its best, so it is the only value with a point of headroom. **The gap is load-bearing:** `--ring` is byte-identical to `--primary`, so on a brand-filled control an unoffset ring is the same colour as the fill and the button reads as having grown 3px rather than as having gained an indicator. Do not soften either half. **The gap takes the colour of the ground the control sits on, which is not always the page.** `FOCUS_RING` spells it `ring-offset-background` because the family it serves sits on one; a control inside a card takes `ring-offset-card` and one inside a menu takes `ring-offset-popover`. Pasting the page spelling onto a card- or popover-hosted control draws a gap 1.06:1 / 1.12:1 off its own ground in dark — a visible halo, and a defect introduced by the fix. Read the host, then pick the token; the ring itself clears 3:1 on all three grounds in both themes.
- Use `SaveButton` for save actions. It owns all three states (idle label → spinner + "Saving…" → check + "Saved!"), the 1.03 check, and the **width lock**: the three layers share one grid cell and stay mounted, so the pill sizes to the widest of them per locale and a toolbar never reflows mid-save. Never `AnimatePresence` around them. Pass a **translated** `label`. On a card it sits last on the right edge of the card footer (The Card-Foot Apply Rule, `components/ui/card-foot.tsx`).
- **Sizes:** `default` (36px), `action` (42px, the page action), `xs` (24px) / `sm` (32px) / `lg` (40px), and `icon` (36px) / `icon-xs` / `icon-sm` / `icon-lg`. On a coarse pointer `default` grows to 44px (`pointer-coarse:h-11`) and `icon` keeps its painted size behind a centred 44px `after:` hit area, so an explicitly small icon button never swells inside a dense row; `action` carries no floor because 42px plus its 2px ring gap already clears it.

### Chips and tags

**Two forms with two jobs, and the split is the point.** The previous system had one form doing both, which is how "which radio" and "is it healthy" kept getting confused.

**Status chips — filled.** The five status roles in `components/ui/badge.tsx`: `success`, `warning`, `destructive`, `info`, `muted`. A role container fill, that container's `on-` ink, no border, pill radius, and a **mandatory** 12px glyph. The variant is the whole API: never hand-write the classes. Fill and ink transition on `standard`, the focus ring on `quick`. Hover is `[a&]:`-scoped, so a static chip never advertises a click target that does not exist.

```tsx
<Badge variant="success">
  <CheckCircle2Icon className="size-3" />
  Active
</Badge>
```

**Outline tags — identity and metadata.** `nr`, `lte`, `spatial`, `neutral`. A 1px role border, role text, transparent fill, pill radius. A glyph is optional here, because an outline tag reports *what a thing is* rather than whether it is well — there is no second state for a glyph to disambiguate.

```tsx
<Tag variant="nr">5G NR</Tag>
<Tag variant="neutral">n78</Tag>
```

The forms are not interchangeable. **An outline tag is never a status indicator, and a filled chip never carries identity.** `muted` covers deliberately-inactive states (Stopped, Disabled, Offline peer); failure is `destructive`.

Tone maps key onto the exported `BadgeVariant` / `TagVariant` types, never onto a class string, so a new tone without a matching role fails the build.

A filled `info` chip is also how a **fact** is shown when it is neither a fault nor health (The Fact-Is-Info Rule), rendered only while the fact applies: the RM520N fork's `components/system-settings/sim-registry-card.tsx` draws its "Alerts on" chip as `<Badge variant="info">` with a glyph (the target's Tracked SIMs card, `components/system-settings/tracked-sims-group.tsx`, is where the equivalent lands).

### Cards / Containers

- **Corner:** 16px in a grid of peers, 20px for the anchor card on a surface.
- **Background:** `surface`, with `border-0` explicit and `--shadow-whisper` optional in light.
- **Padding:** 24px standard, 28px on hero cards.
- **Header:** plain `CardTitle` plus `CardDescription`. **Never an icon in the card header** — icons belong in glyph discs, tags, or a separate action area.
- **Footer:** an editable card ends in `CardFoot` — a borderless row, status left, actions right (The Card-Foot Apply Rule). Not shadcn `CardFooter`.

### Tiles

The inner unit of a glance surface: a 12px-radius block at a **pinned** 104px height, holding a 52px full-round glyph disc beside a text column of eyebrow → value → caption.

**A tile body is neutral. The disc carries the colour.** This is The Data-Ink Rule at tile scale, and it is what the previous four-tinted-tile composition got wrong: four pale bodies at near-identical container lightness encode category without encoding importance, so the strip flattens to equal weight and the eye has nowhere to land. A neutral body with a saturated disc gives the tile a focal point at 1/8th the tinted area.

**The height is pinned, not floored.** A `min-h-` made the skeleton a lie: measured live, tiles resolved to 118 / 98 / 95px against a 92px skeleton, a 26px jump at the handoff. A floor cannot be a mirror; only a pin can. Geometry lives in one shared shape module (the fork's `components/cellular/tile-shape.ts`; it lands in the target with the first ported tile strip, U2.3) so a strip and its skeleton cannot drift.

### Metric rows

Two answers, and this is the one place the system deliberately has two.

- **Glance surfaces** use full-round pills on `surface-container`: 40px tall, 16px horizontal padding, a 13px/600 `on-surface-variant` key against a 13px value — `font-mono` when that value is an opaque string (ICCID, IMEI, an address), `font-sans tabular-nums` when it is a figure, whether a live measurement or a numeric label like an EARFCN or PCI. No dividers. **A value that carries quality takes its ramp ink here**, which is the row-level equivalent of WiFiman's coloured dBm figure.
- **Genuine data tables** (cell scanner results, SMS inbox, log views) keep hairline rows on `--border`, because density survives there where pills would not.

### Quality bars

The row-level data graphic, and the non-chromatic half of the quality ramp.

- A full-round track on `surface-container`, **8px tall — one thickness, everywhere**. What varies is **width**, never height: the bar spans the row where the row is the bar's own line, and narrows to a **56px lane** where it has to sit inline beside the figure it belongs to (the dashboard signal rows, the tower-locking carrier tiles). A lane is the right answer when a full-width bar under the last line would read as a coloured bottom border rather than as a gauge.

  > **The single thickness is load-bearing, not tidiness.** This section rests the whole ramp on length: adjacent stops sit *deliberately* below the 0.05 CVD separation floor, on the explicit understanding that **bar length carries the fine distinctions**. A 4px hairline is the thinnest mark on its card, and asking it to carry the channel the ramp is not allowed to lose was the contradiction. Thickening it strengthens the encoding the accessibility argument depends on.
  >
  > The height was `MetricBar`'s `size` prop, which **defaulted to `sm`** — so the split was never a considered pair of forms, it was 11 call sites inheriting a default against 9 that had opted out of it. `sm` is deleted rather than deprecated: a size nobody should pick is a trap. Two forms of *width* remain and they are chosen by slot, which is what the paragraph above describes.
  >
  > ⚠️ A taller bar changes nothing about row height where the bar sits in an `items-center` flex row — an 8px track centres in the same line box a 4px one did. **Verify that per call site by measuring the rendered node**, never by reading the class string.
- The fill is `--quality-N-bar`, its **length** proportional to the value within the metric's **quality window** — `signalToProgress()` maps `[floor, excellent]` → `[0, 100]`, which is *not* the physical range: RSRP's window is `[-140, -80]` while `METRIC_RANGES.rsrp` is `[-156, -31]`. **The window saturates at the top on purpose.** Every reading in the `excellent` stop draws a full bar, because the question a bar answers is "where in the usable range is this", and past the top cut the honest answer is "as good as this scale measures". Fine-grained discrimination above that cut is the *score* scale's job, not the bar's — see `components/cellular/antenna-alignment/utils.ts`, which keeps a separate full-range map for exactly that reason.
- Length is the primary encoding and colour is the reinforcement. **Ramp ink on a numeral without a bar beside it is a bug**, and so is a ramp tone on a fill whose length does not encode the value. What length actually carries is *magnitude within the scale*; what separates one **stop** from the next is the **glyph** — `QUALITY_GLYPH`'s monotonic wedge ladder, which survives greyscale and every CVD type. Do not claim length separates adjacent stops: at any cut a continuous map draws both sides nearly the same (-80 dBm is 100%, -81 dBm is 98.3%), and that is correct, because two readings 1 dB apart *are* nearly the same signal. Widening the map does not change this; it reproduces it at every cut while shortening every bar.
- A missing reading renders an empty track, never a zero-length red fill: an unused antenna drawn as an empty red bar labelled "−140 dBm" reads as a signal problem the user should go and fix. In code that is `MetricBar value={null}`, which omits the fill element entirely — and `qualityMeterTone()` returning `null` rather than a colour, so no caller can `??` a fallback in.
- **A track is invisible chrome only while it is darker than its ground.** The default `surface-container-high` track is right on `surface` and on `surface-container`; on a lighter ground it renders *lighter* than what it sits on and reads as a second, paler segment continuing past the end of the fill. `MetricBar` takes `track="muted"` there — needed on Antenna Alignment's winning `primary-container` row, where the false extra length landed on the one row that answers "which position won", and inside its `surface-container-high` pinned readout.
- The **entrance** is `scaleX` (compositor-only, once, on mount). The **value retarget** is layout `width`, not `scaleX`: a transform scales the whole box including its `border-radius`, so at low percentages a `scaleX`-only fill squashed its own pill cap into a near-flat ellipse. Width changes only on a poll retarget, not per frame, so the usual objection to animating width does not apply here. See the comment in `components/ui/metric-bar.tsx` before changing this back.

### Inputs / Fields

- **Shape:** 10px radius (`rounded-field`), 42px tall, no visible border at rest. `Input`, `SelectTrigger`, `Textarea` and `InputGroup` all build on `fieldVariants` in `components/ui/input.tsx`, so a call site never restates the geometry. `SelectTrigger size="sm"` is 32px.
- **Fill:** one tonal step above the field's **host**, set by the primitive's `host` prop — `"surface"` (default, `bg-surface-container`) or `"container"` (`bg-surface-container-high`). See The Field-Step Rule below.
- **Focus:** the one ring from Buttons above — 3px `--ring` at full strength over a 2px gap in the host's own ground colour, measured floor and all; the fill does not change.
- **Invalid:** destructive ring plus destructive border, driven by `aria-invalid`.
- **Target:** the 44px coarse-pointer floor applies to a `Switch` too. The primitive paints 18x32px; reach the floor with a pseudo-element overlay (the fork's `SWITCH_TARGET` in `components/cellular/tower-locking/shapes.ts`) rather than a layout box, so the row's label keeps its baseline.

**The Field-Step Rule.** A field's resting fill is one tonal step **above its host**, never a fixed token.

| Host | Field |
| ---- | ----- |
| `surface` / `card` | `surface-container` |
| `surface-container` | `surface-container-high` |

A field has no border at rest, so **the fill is the entire affordance** — there is nothing else on screen saying where the box is. A fixed fill token is therefore only *accidentally* correct: it works on the one host that happens to sit a step below it, and renders at **1.00:1** — a field with no edge at all — on every other. This is the Tonal-Elevation Rule that already governs surfaces, extended to the controls sitting on them. It is not a hypothetical: on the RM520N fork six controls on Tower Locking painted their host's exact colour, because the shared constant they imported described a host none of them had.

**Corollary: `-high` is the top rung, so the host steps down.** A field can never be hosted by a `surface-container-high` block. When that would happen, the **host** drops to `surface-container` and the field takes `-high`. Never solve it with a border — an outlined field beside three unbordered ones reads as a different *kind* of control, not as the same control on a different background.

**Two legal resolutions, one per card.** **STEP** is the table above: the control takes host + 1, written as `host="container"` when the host is `surface-container`. **SHELL** is the alternative: the control is transparent and the *host* carries both the fill and the focus ring (`focus-within:ring`), which is what the NR leg card's `FIELD_TILE` does. Pick one per card and never mix them within a card. The bug is only ever the third state — a control painting its host's own colour.

**The primitive owns the fill.** A call site picks `host` and never writes a fill class or a `dark:…!` marker; there is no `dark:bg-input/30` left to out-specify. A SHELL composite still sets `bg-transparent` on its inner control (as `InputGroupInput` and the NR leg card's tiles do).

### Segmented pills

**On/off and short mutually-exclusive choices use the shared `SegmentedField` pill (primary thumb + check glyph in a rounded track), never a bare `Switch`.** User decision (2026-09-26, taken on a sibling build; adopted by the RM520N canon 2026-10-06 and by the target 2026-10-15). Applies to new and redesigned surfaces going forward — this is **not** a sweep instruction; an existing page still on `Switch` for this kind of choice is not thereby wrong, per the Scanning Rules' "goal rules only" spirit (Layout > The Scanning Rules). Don't convert an untouched page's switches opportunistically; Migration Deltas counts the current `Switch` sites.

`SegmentedField` lives at `components/ui/segmented-field.tsx` (landed with U2.1b; the fork promoted it from `components/cellular/settings/segmented-field.tsx`) so a lucide-owned route (`/local-network/**`, `/monitoring/**`, `/system-settings/**`) and a Material Symbols route (`/cellular/**`) can share one control without either crossing the icon boundary. The shared file imports **neither** icon set: the caller supplies the check glyph via a required `glyph` prop, rendered from its own route's icon set (lucide's `CheckIcon`, or `MaterialSymbol name="check"` on the Material side). The control itself falls back to a `Select` below a caller-chosen container breakpoint (`segmentedBreakpoint()`); `breakpoint="never"` keeps the pill group at every width, for a row of 2-3 short options that always fit (On/Off, Low/Normal/High).

### Navigation

The sidebar rail sits one step off the canvas so it reads as chrome, not content. Nav rows are full-round, 16px horizontal padding, `text-sm`.

The active row is the system's signature motion: **one** `primary-container` pill per group, absolutely positioned, whose transform is driven from React so it *slides* between rows rather than appearing. The row goes transparent and takes `on-primary-container` ink at 600 weight, and its Material glyph animates its `FILL` axis from 0 to 1. That FILL change is an accessibility affordance, not polish: it is what makes the active state survive grayscale. The pill's first paint is non-animated (`data-settling`), so it starts under the active row rather than sliding up from zero.

**The sidebar-07 structure** (adopted 2026-10-20) organises the rows; the pill, the fill axis and the motion above are unchanged:

- **Parents are expanders.** A row with sub-items links nowhere. Its whole surface is the `Collapsible` trigger, and a `chevron_right` rides inside it, rotating 90° on `standard`. The page the parent used to open is its **first sub-row**: same URL, its own label (`FIRST_SUB_T_KEY` in `lib/nav-tree.ts`, e.g. Cellular Information › Overview, System Settings › General). The first sub-row is current only on an exact URL match, so the parent's URL never claims its siblings' routes. The group holding the current route opens itself, and the parent carries the group's pill. Leaf rows stay links.
- **Sub-rows hang off a rail.** A 1px `sidebar-border` line drops from the centre of the parent's glyph, and the sub-row pills sit beside it with labels within 2px of the parent's label column. It is structure on the sidebar ground, not a hairline on a fill. The current sub-row takes the neutral `surface-container-high` pill: only one row per group wears `primary-container`.
- **It collapses to an icon rail.** It uses `collapsible="icon"`, toggled from the header trigger, the `SidebarRail` edge strip or Ctrl/Cmd+B. Rows become 40px circles (44px on a coarse pointer) in a 56px (60px) rail, and the pill follows them as a circle. Group labels fade out, and each label stays in the accessibility tree as `sr-only`, so an icon-only row keeps its name. A leaf shows a tooltip; a parent opens its sub-rows as a right-hand flyout. The rail scrolls with its scrollbar hidden. The state persists in the `sidebar_state` cookie, read client-side, and the width transition is armed only after the restored state has painted, so a reload never animates the collapse. Only the fixed rail animates its width: the page's layout snaps once and the content slides into place on a transform, because a width transition on the in-flow gap re-lays-out the whole page every frame. On a phone the sidebar is always the full sheet, and it closes when a row takes the user somewhere or opens a dialog (an expander toggling does not close it).
- **Header.** The Q mark, **QManager** and the app version open a dropdown (the sidebar-07 team-switcher slot) listing QManager (current) and LuCI (new tab).
- **Breadcrumb.** The inset header's crumbs come from the nav tree, not URL segments (`resolveNavCrumbs`): group › parent › page, in the sidebar's own translated labels. A single-row group and the footer add no crumb, and group and parent crumbs are text, since neither has a page. Below `desktop` only the page shows.

### Banners

Two primitives, split by where they mount. **`Banner`** is page-level: named system roles, a CTA slot, a dismiss slot, a 36px disc, lucide glyphs (it mounts on every route, so the Icon-Boundary Rule pins it to lucide). **`TonalBanner`** is card-scoped: three tones, no CTA, no dismiss, a 32px disc, Material glyphs.

Both share the rules. A banner is `bg-{role}-container` with `text-on-{role}-container` — never a wash, because a 10% alpha over a tinted surface collapses in dark mode. Its icon always sits in a filled disc on the role's **strong** fill. Radius is 10px, so it never out-rounds its host. Informational banners use `primary-container`. A figure that ticks inside banner copy is `tabular-nums` in the interface font. Entrance is `.animate-banner-in` (`emphasized`, 6px rise plus fade); there is no exit.

Banners are one of the four sanctioned container uses, and the reason is that a banner *is* its state — the tint is the message, not decoration on top of one. The deferred-reboot banner is a `Banner` (Components > Target-only surfaces).

### Signature surfaces

The first six are the RM520N fork's reference surfaces; the target ports each with its page (Carrier Aggregation and the signal status cards with the dashboard and Cellular rows, the summary strip, aim readout and comparison rows with `/cellular`). Surfaces that exist only in the target follow under Target-only surfaces.

- **Carrier Aggregation strip** — a full-width 20px-radius hero whose segments are proportional to each carrier's bandwidth. Segment width animates on `emphasized`; a newly-added carrier grows from zero so the chain reads as "something arrived" rather than "everything shuffled". A released carrier stays visible and **explicitly marked** rather than silently disappearing, and the list **freezes** while data is stale rather than announcing releases that never happened.

  > A released carrier must not be distinguished from an active LTE carrier by tone alone. Measured, `lte-container` and `surface-container-high` were **identical** under deuteranopia — 0.0000 separation — so "dropped" and "live LTE" were one swatch. The distinction is now carried by a glyph or a strikethrough, with tone as reinforcement.

- **Signal status cards** — the paired NR / LTE cards. An identity-tagged card whose **glyph bar count** carries quality (five wedge glyphs, monotonically decreasing — the `signal_cellular_{1..4}_bar` family, never the `alt` family, whose 1-bar mark is a 2×4px speck and which has no 0-bar at all), then a stack of metric row pills with **ramp-inked values and quality bars**. Every tinted value carries an `sr-only` quality word.

- **The radio summary strip** — the four-tile grid above Radio Information's cards. Four 104px tiles at `rounded-tile`, one per track at `@xl` and four across at `@5xl`. Neutral bodies; each disc carries its axis colour — identity fill for Network, downlink for Bandwidth, neutral for Carriers (a count is not a direction), spatial for Active MIMO. The same `TILE_SHAPE` backs the Antenna Statistics context tiles and the SMS Center strip, so all three are dimensionally identical and each skeleton is a real mirror.

- **The pinned aim readout** — the phone-width counterpart to a sticky anchor card, and the pattern for any surface whose live reading has to survive scrolling. A **zero-height** sticky wrapper placed first in the page column: it pins for the page's entire scroll range and contributes no layout, so the resting page is not 64px taller for a readout nobody has summoned, and the 64px pill overflows downward out of it. It is a *separate element*, never the anchor card collapsing — a collapse animates height, and this system's motion is transform and opacity — so the two crossfade on **opacity alone**, driven by an `IntersectionObserver` sentinel that defaults to hidden if the observer never fires. Behind the pill sits an **opaque shade spanning the page gutter and the gap above it**, carrying the same crossfade: without it the page scrolls through the transparent band over the bar's head, and a button sliding across the top of the viewport reads as a z-index bug rather than as a pinned element. The pill sits one tonal step above the rows it pins over (`surface-container-high` against their `surface-container`) and keeps a key label, because at equal tone and identical geometry — same height, same pill radius, same numeral-plus-meter anatomy — a floating instrument reads as a slot that has come loose.

- **Comparison rows on a shared scale** — where a surface exists to answer *which of these won*, the candidates are 64px pill rows at every width rather than a grid of tiles, and their `MetricBar` lengths share **one** 0–100 composite, so the answer is read by length instead of by comparing three numerals against each other. The winner is a `primary-container` row per Highlight-by-Container, and its numeral drops the ramp ink for `on-primary-container`: the ramp is computed for 4.5:1 against a card ground, and quality is still carried by bar length plus an `sr-only` verdict, which is the non-chromatic channel the rule actually asks for. **Two absences are distinguished, deliberately.** A row that was never recorded draws **no track at all** — nothing was measured, so there is no scale to show, and three empty rules across a desktop card would be pure chrome. A row that was recorded but cannot be ranked keeps `MetricBar value={null}` and its **empty track**, because there the track is the honest report of a measurement that came back with nothing.

- **Condition state screens** — non-registered modes *replace* the body rather than render it empty. A 20px-radius container in the condition's tone, a 56px filled disc, a headline, a description, and an optional retry pill drawn from the container's **own** ink at 10-15% — never a white wash, which is invisible on a light container. Tone is chosen per condition: no-SIM is `warning` (a real fault the user can fix in situ), no-service is `destructive` (the link is down), searching is `info` (transient), unknown is neutral. Only `searching` spins — a spinner on a standing condition advertises work that is not happening. No two states in one slot may share a glyph.

  This is the third sanctioned container use, for the same reason as banners: the whole block *is* the state.

- **Resolved-state cells** — the fourth, and the narrowest. A cell in a decision matrix may take a role container when the tint reports a **resolved outcome** rather than an input, and then only for the single affirmative state: every other state in the matrix stays on `surface-container`, so the tinted area is proportional to the number of things actually true. The fork's Coverage matrix on `/monitoring/alerts` was the first instance and the reason the use exists (it has since been replaced by receipt rows under a verdict chip, so the use has no live example on the fork today), because that page's whole thesis is that the resolved answer, not the three inputs behind it, is the page. This does **not** license tinting a block because it belongs to a category: that is the "large empty purple slab" the Radio Information and Cellular Settings rows below already deleted twice. The tint must be a fact the device would act on, the glyph and the word must carry the same state without it, and no two states in the slot may share a glyph.

### Target-only surfaces

The RM520N fork never built these, so the canon above does not show them. They are not exceptions: each is an ordinary feature page under every rule in this document, and each is re-authored in the canon by its own ledger row (U4.11, `docs/rm520n-port-ledger.md`). What follows is the canon applied to the parts that have no fork precedent. Behaviour and safety contracts live in the feature docs under `docs/features/`.

**Sequenced Pipeline Dialog.** The shape of every async, multi-step apply the user watches while the modem is reconfigured: Custom SIM Profile activation (`components/cellular/custom-profiles/apply-progress-dialog.tsx`), Config Restore (`components/system-settings/config-backup/restore-progress-list.tsx`) and language install. It is one of the rare sanctioned modals because the progress *is* the content. The anatomy survives the canon; its styling is rewritten in role tokens:

- **A status hero is the single focal point**, with the per-step breakdown demoted to a supporting ledger. The header carries the operation title and the subject in the description, and **no** status chip: the hero is the state locus.
- **Hero glyph** sits in a filled disc on the role's strong fill (The Glyph-Disc Rule): applying is `info` with a spinner (`motion-safe:animate-spin`), complete is `success`, partial is `warning`, failed is `destructive`, each with its own glyph. The headline names the step in flight, then the terminal verdict ("Profile active", "Activated with skips", "Activation failed"). A subtext carries "Step 2 of 4" or the verdict's one-line consequence.
- **Step ledger** is one level of `surface-container` rows (The One-Nest Rule), each with a status glyph, a label and a truncated detail. A running step is promoted one container step to `primary-container` (The Highlight-by-Container Rule). A skipped step reads "Unchanged" with a muted glyph; no two states share a glyph.
- **Progress fill** is a determinate bar of completed over total, animated as `scaleX` on `origin-left` (The Transform-Only Rule) on `DUR.standard`. The Loader-and-Dots Rule reserves bars for data visualization, and this is the one deliberate step-progress bar: U4.11.6 (Config Restore) and U4.11.4 (profile activation) both kept it, because it counts steps traversed, a real fraction, never elapsed time. A pipeline with no countable steps uses the spinner and dots instead.
- **Deferred-reboot row.** When a step needs a reboot, a calm `info` notice appears below the ledger. The dialog **never** reboots inline; it defers through the persistent banner below.
- **Terminal resolution.** `partial` and `failed` resolve the backend error inline with `resolveErrorMessage` (`docs/features/error-codes.md`) and reveal a single Close button. The dialog is not dismissible (no scrim or Escape close) until the pipeline is terminal, so a half-finished apply is never abandoned by an accidental click. It exits on `quick` like every modal (The Modal-Exit Rule).

**The deferred-reboot banner.** QManager runs on the modem it manages, so a change that needs a reboot never reboots in the request that made it. The pattern is two-step and is part of the visual contract: an explicit dialog states the consequence, and after the user defers, a **persistent page-level `Banner`** (mounted on every route, lucide glyphs) stays until the reboot happens. The target's pending-reboot banner keeps a user Dismiss (decided in U4.11.2, 2026-10-17), an accepted exception to The Dismiss-Only-Notices Rule: the flag lives in browser storage, and a reboot that happens some other way (power cycle, watchdog, the dashboard) cannot clear it, so a banner without Dismiss could outlive its condition. It is mounted once in the app shell (`components/reboot/pending-reboot-banner.tsx`, under the reconnecting banner; ledger B5.19), so it shows on every route whichever page raised it; the pages that defer a reboot only set the flag, with a per-source consequence line and Dismiss behind a confirm. The ledger maps it onto `Banner` role 08 (the component exists since U2.1a; conversion is a U3 / U4 row). State lives in `lib/reboot/pending.ts` and `lib/config-backup/pending-reboot.ts`; see `docs/features/config-backup-restore.md`. A reboot is never fired from a CGI response path.

**Surfaces with no fork precedent.** Each is a grid of self-contained cards under a page header, committing from `CardFoot`:

- **Traffic Engine** (Video Optimizer and Masquerade, `/local-network/traffic-engine`): grouped-card tabs with the shared engine-enable row and result alert keeping the twin engines in sync.
- **Connection Scenarios and Custom SIM Profiles** (`/cellular/custom-profiles/**`): scenario identity is a glyph disc on a strong fill plus neutral `Tag`s, never a gradient; the profile registry and editor follow the single-card-per-view rule (The Card-Wrapped Surface Rule). Both sit on the Material Symbols side of the icon boundary.
- **Config Backup / Restore, Adaptive Polling, Netbird, Tailscale**: lucide routes. Restore is a Sequenced Pipeline Dialog with the deferred-reboot banner after it; a daemon-backed page reports saved state and live state separately and never the half-edited draft (The State-Honesty Rule).

### Icons

Two libraries, and the boundary is **per route**, never per directory.

| Library | Owns |
|---------|------|
| **Material Symbols Rounded** | The sidebar, `/dashboard`, the two pre-auth routes, and the **entire `/cellular/` family** — the index plus every sub-route (including Custom SIM Profiles and Connection Scenarios) |
| **lucide-react** | Every other route: `/local-network/`, `/monitoring/`, `/system-settings/`, `/about-device`, `/support`, onboarding — plus every route-agnostic primitive wherever it mounts, `HintIcon` excepted (below) |

Mixing two icon sets inside one screen is precisely what the rule prevents, so a lucide glyph on an unconverted route is *correct code*, not a defect — and a route-agnostic component stays on lucide even when it mounts inside a Material route, because it cannot know where it will appear. Convert a whole route or none of it. The sidebar is Material since U3.1 (its account dropdown's action items stay lucide, as in the fork); the rest of the Material half lands route by route with the U3 and U4 rows (the font and subset shipped with U1.3; the component landed with U2.1a). Target-only routes follow their family: `/monitoring/netbird`, `/system-settings/config-backup`, `/system-settings/adaptive-polling` and `/local-network/traffic-engine` are lucide routes.

`MaterialSymbol` sets `fontSize` as an inline style, which outranks any utility — so a parent's auto-sizing rule for lucide children (`[&>svg]:size-3`) cannot reach it. **Pass `size` explicitly at every Material call site.** The typeface is ligature-driven, which is why these spans are always `aria-hidden` beside a real text label, and why the glyph list is a single source of truth shared with the font-subsetting script. A glyph name the type permits but the shipped subset lacks does **not** fail the build — it renders the literal ligature text (`"cell_tower"`) on a device that may have no internet to fall back on; `bun run icons:check` is what catches it (`docs/reference/icon-system.md`). A Material glyph that must animate `transform` goes inside a wrapper span that carries the transition: the unlayered `.material-symbol` rule in `app/globals.css` sets its own `transition` and beats `transition-*` utilities on the glyph itself.

Three deliberate exceptions survive on the dashboard's Network Status card: the SIM orb keeps lucide `CardSimIcon`/`Plane`, and the RAT marks keep `react-icons/md`, because "5G", "4G+" and "3G" are typographic marks Material Symbols has no equivalent for.

**One exception runs the other way: `HintIcon` is Material on every route, lucide routes included.** `HintIcon` (`components/ui/hint-icon.tsx`) is a route-agnostic primitive, yet its info/warning glyph is a `MaterialSymbol` wherever it mounts — so on `/local-network/`, `/monitoring/` and `/system-settings/` it is the one Material glyph on a lucide screen. That is deliberate: a single glyph for "there is more to know here" everywhere beats one that changes shape between routes. It does not widen the boundary above, and it is not a precedent for any other primitive. Don't make `HintIcon` route-aware, and don't convert it to lucide.

### The three-state pattern

Every data surface ships **loading**, **empty**, and **error** — never a blank panel.

Skeletons mirror the loaded geometry *exactly*, and by shared constant rather than by estimate. Sizes are the loaded element's **line box**, not its font size — a skeleton sized to the glyph reflows the moment real text lands. The handoff is a pure crossfade on `quick` with the outgoing skeleton overlaid *on top of* real content, so the card is sized by its content from the first frame and the crossfade contributes zero layout shift.

### Copy & Help

Convention carries the interface; copy explains only what a convention cannot (PRODUCT.md, Principle 7). A clear label and a sensible default beat a sentence of helper text, and a paragraph on the surface is a design failure, not thoroughness.

**Length budgets** (English; ceilings, not targets — translations run longer, which is one more reason to start short):

| Surface | Budget |
|---------|--------|
| Page description (`h1` subtitle) | One sentence, ~100 chars |
| `CardDescription` | One sentence, ~80 chars. Optional — omit it when the title says it all |
| Field / row hint | One line, ~60 chars. Omit it if it restates the label |
| Dialog description | At most two short sentences: what happens, and whether it can be undone |
| Empty state | Title + one line + one action |
| Toast | One sentence |
| Info tip body | At most two sentences |

Say a message once. The same error shown in a banner, a field hint and a toast is three reads of one fact; pick the slot nearest the cause.

**No Debug-Build Copy** (user decision on the RM520N fork, 2026-10-11, adopted here). User-facing text never exposes implementation detail: no config file paths (`/etc/qmanager/...`, `/tmp/qmanager_*`), no "Read back from…" or "Saved to the modem" provenance lines, and no script, CGI, daemon, UCI or AT-command names, unless the surface exists to show them (the AT Terminal, Logs, About Device diagnostics, System Health Check, and the Prometheus card's scrape-config snippet, which shows the endpoint path and the scrape config because it exists to wire up an external tool; that text stays inside the snippet block and never appears in prose). Leaking them makes QManager read as a debug build. Provenance belongs in a code comment or the feature docs, and a real fault still gets a plain-language message. It applies to `t()` strings, hard-coded literals, tooltips and placeholders. Before shipping UI copy, grep the diff for `/etc/`, `/tmp/`, `uci `, `AT+`, `read back` and `saved to`.

**Info tips** — the `HintIcon` primitive (`components/ui/hint-icon.tsx`), a small ⓘ beside a label or value — hold the explanation the surface doesn't need to carry.

**The default is no tip.** Most settings need none; a clear label is enough. A tip is an exception justified for one specific control, never a slot every row fills for consistency, and a settings group where most rows carry no tip is the expected shape.

- **Use one for** a domain term the user may not know (TTL/HL, EN-DC, DPI, IP Passthrough, PCI), or a caveat that is non-obvious but not dangerous ("resets on reboot").
- **Never use one for** restating the label, explaining a standard pattern (what a switch or Save does), or hiding a risk. Anything that can drop the connection stays visible on the surface (PRODUCT.md, Principle 6).
- **Sparingly.** Roughly one per settings group at most. If every row wants a tip, the labels are wrong.
- **Never the only home of required information.** If the user cannot act correctly without reading it, it is not a tip.
- **Must open on tap.** A hover-only tooltip is unreachable on a touchscreen.

**`HintIcon` is a popover that hover can preview** (final contract, adopted from the RM520N canon; the target's `components/ui/hint-icon.tsx` was brought to this contract by U2.1a). It stays a toggletip built on `Popover`, because tap must work. Don't build it on `Tooltip`: a Radix Tooltip never opens on tap.

| Input | Result |
|-------|--------|
| Mouse rests on the ⓘ | Opens after 300ms (`HOVER_OPEN_MS`) |
| Mouse leaves the ⓘ and the tip | An unpinned tip closes after 120ms (`HOVER_CLOSE_MS`). The tip itself is hoverable |
| Click or tap | Pins it open. A hover-opened tip becomes pinned and stays when the mouse leaves |
| Click again, tap outside, or Esc | Closes |
| Enter or Space | Toggles it. Focus stays on the trigger |
| Focus alone | Opens nothing. A screen reader reads the tip as the trigger's description |
| Another tip opens | This one closes. One tip is open at a time, app-wide |

**Trigger.** A 16px outline `info` glyph in a 20px round button. It is `on-surface-variant` at rest and turns `primary-on-surface` on hover, focus and open, filling while open (colour and fill both ease on `quick`). On coarse pointers its hit area grows to 44px without moving layout. It always trails its label with a 6px gap (`gap-1.5`). The API is `label` (the accessible name) and `children` (the tip body), plus an optional `tone`; there are no sizes and no other variants, because a caution belongs on the surface (the Tip-Is-Optional Rule).

**Warning tone (`tone="warning"`).** The same popover, wearing the Material `warning` glyph in `warning-on-surface` ink at rest (no hover recolour). It is for a fact whose consequence is a reading you cannot fully trust. It never replaces stating the consequence in words on the surface, and it is not a status chip or a way to flag danger: anything that can drop the connection still stays visible on the surface. The default remains `info`; do not reach for the warning tone to make a tip look more important.

**Tip.** The app's own floating surface, never an inverted plate: `bg-popover` with a hairline border, `rounded-field`, 14 × 10px padding, Rethink Sans at 13/20, at most `18rem` wide (or the space available, whichever is smaller), 8px above the trigger with no arrow, and the Popover Float shadow. It enters with a fade, a 0.96 scale and a 4px rise toward the trigger on `quick` with `ease-standard`, and closes instantly (Enter-Only Rule). Reduced motion keeps only the fade. It renders straight on the Radix primitives rather than the shared `PopoverContent`, so it carries no exit animation and never restyles other popovers. The glyph is Material on every route (see Icons, above).

> ℹ️ NOTE: most shipped copy predates these budgets (the RM520N fork measured 136 of 4,088 `en` strings over 120 characters on 2026-09-26; the target has not been measured). Trim a surface when you next touch it rather than copying its length.

**Before / after** — the shape of a trim:

| Before | After |
|--------|-------|
| A page description listing every sub-feature and its edge cases | One sentence naming what the page is for |
| A row hint explaining when a setting applies, why, and what resets it | A short hint for the one fact that changes behaviour; the rest behind a tip |
| A confirm dialog narrating the backend (rebinding, leases, where to browse next) | "Your connection will drop briefly." plus the one thing the user must do |

### Confirmation Toasts

**Every user-initiated mutation that finishes is confirmed by a toast** (user rule, taken on a sibling build on 2026-10-05; adopted by the RM520N canon 2026-10-06 and by the target 2026-10-15). Save, Apply, a switch that persists, add, delete, reset, restart, install, copy: success is `toast.success`, failure is `toast.error`, both plain `sonner` (`import { toast } from "sonner"`), no wrapper. The RM520N fork's `components/cellular/band-locking/band-grid-card.tsx` is the reference; the first ported card becomes the target's. This replaces any earlier per-surface choice where a card confirmed itself with an "Applied" chip and never a toast.

| Do | Don't |
|----|-------|
| One toast per outcome, fired in the component handler that owns the action, at the terminal moment (request resolved, read-back matched, stepper settled) | Fire from a presentational footer, or from a hook two cards share with different copy |
| Past tense naming the thing: "MTU applied.", "Band lock applied." One sentence (Copy & Help budget) | A generic "Success", or a second sentence that restates the control |
| Take the failure reason from the call's own returned result (its `error` / `detail`, or the mutator's return value), with a `t()` fallback; a backend error code goes through `resolveErrorMessage` (`docs/features/error-codes.md`) | Read `error` state after an `await`: it still holds the previous attempt's error |
| Give an effect-based toast a deterministic sonner `id` (`${runId}:${state}`) and fire it only for a transition seen in this session | Toast a result that was merely loaded on mount or by a poll |
| Copy through `copyText` (`lib/clipboard.ts`), and toast success only when it returns true | Raw `navigator.clipboard`: it is undefined outside a secure context, which the modem's own address may not be |
| Put every toast string through `t()` and into all five locale catalogs *(en, zh-CN, zh-TW, it, id; `bun run i18n:check` gates it)* | Hard-code English in a `toast.*` call |

- **The toast is the only confirmation message.** A fading "Applied" chip, a `*_saved_flash` text or any other transient success label is retired: the toast already said it. `SaveButton`'s own Saving…/Saved! flash is the control's state, not a message, and stays (it is driven by `useSaveFlash`), as do persistent states (Locked, Active, a drift or warning line, a failure line that stays with its context).
- **A failure may also leave a persistent line** beside the field it concerns; the toast announces the event, the line keeps the context. Avoid double screen-reader announcements by keeping the same text out of an `aria-live` region.
- **Partial failure is one error toast.** TTL saved and MTU failed is a single error naming MTU, never a success then an error.
- **Never toast** polling and background work, draft-only edits (a pill, an input, a select), Discard, tab or filter state, and diagnostics whose result is a persistent inline panel.
- **The one exception: a mutation that ends in navigation.** Applying IP Passthrough (and every other path that ends in the `/reboot/` handoff) leaves the page, which destroys any toast. The handoff is its success signal; its failures and no-ops still toast. A new surface that ends in a navigation or reload documents itself here rather than inventing a chip.
- **Wizard steps are the same exception.** A step of the setup or onboarding wizard advances to the next step on success, and the advance is its confirmation; a failed write still toasts. This is the dialog/wizard exemption the Card-Foot Apply Rule already makes for save controls.
- **Hook mutators return their result** (`{ ok, error, detail }` or a boolean plus the message) so the caller toasts from it. A mutator that only calls `setError` and returns `void` invites a success toast after a failure; Migration Deltas tracks the target's conformance.

### Named Rules

**The Toast-Confirms Rule.** A finished user action is confirmed by one toast, success or failure, and by nothing that fades. If a surface seems to need its own "Saved" chip, the toast is missing or wrong.

**The Two-Form Rule.** Status is a filled chip with a glyph. Identity and metadata are an outline tag. Neither form ever does the other's job, and a component that needs both renders both.

**The Every-Chip-Has-A-Glyph Rule.** Status containers are close by construction — the functional roles share a narrow tint band, and `success-container` against `warning-container` has measured as low as **1.03:1**. The glyph is what separates healthy from degraded. Two states in the same slot must never share a glyph either.

**The Identity-Chip Rule.** Where a surface carries identity *and* reports quality, the quality is encoded non-chromatically. On the signal cards that channel is the Material glyph's bar count; on a metric row it is the quality bar's length.

**The Glyph-Disc Rule.** A state or category icon sits in a filled circle on the role's **strong** fill, never on the pale container. In light mode the identity containers collapse under simulation and the fills do not, so the disc is the only place identity colour is reliably legible.

**The Field-Step Rule.** A field's resting fill is one tonal step above **its host**, never a fixed token — the fill is the whole affordance, so a fixed token renders at 1.00:1 on the wrong host. `-high` is the top rung, so a `-high` host steps down rather than the field growing a border. The primitive's `host` prop sets the fill; a call site never writes one. See Components > Inputs / Fields.

**The Skeleton-Mirror Rule.** A skeleton mirrors the loaded geometry by importing the same shape constant, never by restating numbers. A `min-h-` is not a mirror.

**The Loader-and-Dots Rule.** Step or sample progress is a `Loader2Icon` spinner plus dot indicators. Fill and progress bars are reserved for data visualization — signal strength, quality meters, bandwidth share.

**The Age-Gated Tone Rule.** On a surface listing *history*, two independent axes decide how a row is drawn. **Tone** is what kind of thing happened; it is a fact about the event, never expires, and is carried by a filled icon disc in the solid role colour for as long as the row exists. **Weight** is how much the row still deserves attention, and it does expire: a row keeps its tonal container while it is fresh (one hour) **or** unresolved, then settles onto `surface-container` with its disc at full strength. The disc never consults the age gate. Note that `severity: "info"` here means *routine*, not *good*.

**The Dismiss-Only-Notices Rule.** A banner gets an X only when it is a *notification*. A standing condition has no dismiss, because dismissing it would hide a fact that is still true.

**The State-Honesty Rule.** A status surface reports what is actually running — saved settings, live service state — never the half-edited form. A control that cannot currently work explains why instead of sitting there dead. A test only runs against saved config. An ambient animation only loops where something is genuinely live.

**The No-Dot-Separator Rule.** A meta line joining two or more short facts (`PCI 135`, `EARFCN 9485`) uses plain spacing, never a `·` glue character. Give the facts room instead of punctuating between them.

**The One-Sentence Rule.** Every piece of surface copy fits its budget in Copy & Help. A second paragraph is a signal to move content into an info tip or the docs, never to shrink the type.

**The Convention-First Rule.** Don't explain a pattern the user already knows. When a control seems to need explaining, fix the control — label, default, grouping — before adding words.

**The Consequence-Not-Mechanism Rule.** Dialogs and warnings say what will happen to the user, not how the backend does it.

**The Tip-Is-Optional Rule.** An info tip can be skipped without harm. Anything the user must read to act correctly lives on the surface.

**The No-Default-Tip Rule.** Not every option earns a `HintIcon`. A setting gets no tip unless its term or side effect genuinely needs one; adding tips to every row "so it looks consistent" is the failure this rule names.

**The No-Debug-Build-Copy Rule.** Copy names what happens to the user, never the file, script or command that does it (Components > Copy & Help).

## Do's and Don'ts

### Do:

- **Do** put the colour on the reading — the numeral, the stroke, the bar, the disc — and leave the card neutral.
- **Do** pick a **layer** before a colour: ink for values on neutral ground, fill for compact emphasis, container for a functional-role block.
- **Do** pick a **pair** — a fill with its own `-foreground`, or a container with its own `on-` ink.
- **Do** give every status chip a glyph, and give two states in the same slot two different glyphs.
- **Do** use an outline tag for identity and metadata, and a filled chip for state.
- **Do** show a fact worth knowing that is neither a fault nor health as a filled `info` chip with a glyph, only while it applies (The Fact-Is-Info Rule).
- **Do** pair the quality ramp with bar length, always.
- **Do** measure a new colour — gamut first, then contrast, then deuteranopia and protanopia against the layer it will ship on.
- **Do** reach for the role radii (`rounded-tile` / `card` / `hero` / `pill`) in new work.
- **Do** ship `border-0` on a card and let the tone step carry the separation.
- **Do** write responsive behavior as a container query against `@container/main`.
- **Do** wrap a settings group in a card and let the page arrange cards.
- **Do** let every feature page's content column span the full width; never wrap the page in a `max-w-*` container (Full-Width Page Rule).
- **Do** put `min-w-0 truncate` on every text node in a paired card's header.
- **Do** set every figure — measurements and numeric labels such as EARFCN, PCI, band and TAC — `tabular-nums` in `font-sans`, and reserve `font-mono` for opaque strings you compare (ICCID, IMEI, MAC, IP, paths, raw AT output).
- **Do** mirror a skeleton's geometry from the same exported shape constant the loaded view uses.
- **Do** build the loading, empty, and error state in the same change as the loaded one.
- **Do** commit an editable card from its own footer row: status on the left, `Discard` then `SaveButton` on the right (The Card-Foot Apply Rule).
- **Do** confirm every finished user action with one success or error toast, and retire any fading "Applied"/"Saved" chip (Confirmation Toasts, The Toast-Confirms Rule).
- **Do** use the shared `SegmentedField` for an on/off or short exclusive choice in new and redesigned surfaces, rather than a bare `Switch`.
- **Do** pass `size` explicitly at every `MaterialSymbol` call site.
- **Do** keep interactive targets at 44px on coarse pointers, and let toolbars wrap.
- **Do** make a status surface report *saved* state, and make an incapable control explain itself.
- **Do** defer anything that reboots the modem behind a dialog plus a persistent banner.
- **Do** key every new user-visible string across all five locales; `bun run i18n:check` gates it.
- **Do** trust conventions — label controls so they need no hint.
- **Do** keep file paths, script, daemon, UCI and AT-command names out of user-facing copy unless the surface exists to show them (No Debug-Build Copy).
- **Do** put jargon definitions and non-dangerous caveats in an info tip, about one per settings group at most.
- **Do** hang every element on at least two edges: keys on the left edge, values on the right, actions on the header's right edge or the card's bottom edge (The Scanning Rules).
- **Do** fix a hard-to-scan list by grouping it under section labels and varying it with a glyph or tag before you add spacing.
- **Do** render a default or expected value quiet, so the one that differs finds the eye on its own.
- **Do** recompose a card into columns when its rows get too wide for a key and its value to read as a pair.

### Don't:

- **Don't** tint a large surface because it looked plain — that is the failure this system exists to prevent.
- **Don't** give identity or direction a large container block; they are ink, outline, and disc only. (A chart's area fill under its own stroke is ink, not a block — see The Area-Fill Rule for the two conditions that keep it so.)
- **Don't** put ink from one role on another role's surface, or a neutral-ramp ink on a tinted one.
- **Don't** hardcode `text-white` on a destructive fill — in dark mode that fill is *light*.
- **Don't** compensate for a mismatched pair with an alpha (`bg-destructive/60`); fix the pair.
- **Don't** use an outline tag as a status indicator, or a filled chip as an identity label.
- **Don't** show a fact worth knowing as a grey outline (reads as disabled) or in amber (reads as a problem).
- **Don't** use `nr` or `lte` to mean "healthy", or put an identity hue anywhere in a quality scale.
- **Don't** ship an out-of-gamut `oklch()` — the build will map it and you will not have authored what ships.
- **Don't** argue a colour decision from degrees of hue separation; measure it.
- **Don't** use the numbered `--chart-1..6`; they do not theme.
- **Don't** put a border on a tonal container, or use `--border` as a card edge.
- **Don't** distinguish two states by tone alone when one of them is a released, disabled, or absent thing.
- **Don't** animate `width` on first paint (the `MetricBar` value retarget and the carrier-aggregation segment are the two exceptions) or exceed `emphasized`.
- **Don't** write a raw duration (`duration-200`, `{ duration: 0.25 }`) or a `transition-all` with no duration.
- **Don't** add a third stagger step, a fifth duration, or a spring.
- **Don't** add an exit animation to a banner or a route transition.
- **Don't** give a modal one unqualified `duration-*` for both directions, or leave its scrim without one.
- **Don't** loop an animation where nothing is genuinely live.
- **Don't** put an icon in a `CardHeader`.
- **Don't** expose a file path, script, daemon, UCI or AT-command name in user-facing copy unless the surface exists to show it (No Debug-Build Copy).
- **Don't** write a hint that restates its label, a `CardDescription` longer than one line, or an empty state that lectures.
- **Don't** confirm a finished action with a fading chip or label alone ("Applied", "Saved"), toast a result that was only loaded on mount, or read `error` state after an `await` to build a failure toast.
- **Don't** float an Apply mid-card or under the card grid, or stroke a secondary action beside a Save with `variant="outline"` (The Card-Foot Apply Rule).
- **Don't** hide a connection-affecting consequence inside an info tip.
- **Don't** invent a bespoke hero-driven layout for one screen.
- **Don't** mix Material Symbols and lucide inside a single route (`HintIcon` is the one sanctioned exception).
- **Don't** cap a feature page with a `max-w-*` wrapper; recompose the cards instead.
- **Don't** fix a hard-to-scan card with padding or more words; find the missing edge or the ungrouped run.
- **Don't** give every setting a `HintIcon`, or build an info tip on `Tooltip`.
- **Don't** centre text that gets scanned as part of a set, or float actions mid-card with no edge under them.
- **Don't** tidy a crowded card by hiding its actions in a `⋯` menu; give the primary ones an edge first.
- **Don't** ship an icon-only control whose meaning is only learnable from its tooltip.
- **Don't** make one thing stand out by turning it up; quiet its neighbours. Don't dress a default value as loudly as a changed one.
- **Don't** nest more than one inner container inside a card, or stack borders and radii to mark a sub-group a section label could mark.
- **Don't** introduce a third typeface, or set a human-authored label in mono.
- **Don't** load a face through `next/font/google`; vendor it under `app/fonts/` and load it with `next/font/local`.
- **Don't** reach for 13px outside a dense metric row, or for the pre-auth scale outside `/` and `/login/`.
