---
target: System Logs design
total_score: 24
p0_count: 0
p1_count: 2
timestamp: 2026-06-14T10-02-29Z
slug: components-system-settings-logs-system-logs-card-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Silent 10s auto-refresh has no indicator; manual refresh tears the whole card down to a skeleton |
| 2 | Match System / Real World | 3 | Levels/components/timestamps speak the audience's language |
| 3 | User Control and Freedom | 3 | Clear is confirmed; but no "reset filters" and a load can't be cancelled |
| 4 | Consistency and Standards | 2 | Solid badge variants violate the project's own outline-badge contract; mono usage inconsistent |
| 5 | Error Prevention | 3 | Destructive clear gated behind AlertDialog |
| 6 | Recognition Rather Than Recall | 3 | Filters are visible and labelled |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts, no copy/export, no sort, no click-to-filter |
| 8 | Aesthetic and Minimalist Design | 2 | Saturated solid badges down a column fight the calm-by-default resting state |
| 9 | Error Recovery | 2 | A failed fetch falls through to the "No logs" empty state — error masquerades as empty; no retry |
| 10 | Help and Documentation | 2 | Card description only; no inline help |
| **Total** | | **24/40** | **Acceptable — significant improvements needed** |

## Anti-Patterns Verdict

**Deterministic scan:** `detect.mjs` over both files returned `[]` — zero generic AI-slop tells. No gradient text, no eyebrow kickers, no side-stripe borders, no hero-metric template. As a generic shadcn surface it is clean.

**LLM assessment:** It does not scream "AI made this" in the cross-register sense — it reads as a competent shadcn data table. The failure is narrower and more important: it drifts from *this project's own* design system. The product slop test here ("would a category-fluent user trust it") mostly passes on familiarity, but two things betray the house style — solid saturated level badges and a filter interaction that destroys its own toolbar.

## Overall Impression

A solid, functional log viewer that works against itself in two places: it abandons the project's signature calm outline-badge language for loud solid badges, and it replaces the entire card (toolbar included) with a skeleton every time a filter changes. The biggest opportunity is making filtering feel *live and stable* instead of a full teardown-and-rebuild.

## What's Working

- **Toolbar chunking.** Filters on row 1, options + actions on row 2, with a responsive 2-col→flex collapse via `@container`. Five controls stay legible.
- **Destructive safety.** Clear is gated behind an AlertDialog with an in-flight "Clearing…" state — exactly the safety posture the product demands.
- **Honest footer telemetry.** "Showing X of Y", size/rotated stats, and a last-updated clock give the power user real situational data.

## Priority Issues

### [P1] Filter changes nuke the whole card to a skeleton
The top-level `if (isLoading) return <Skeleton>` replaces the *entire* card — toolbar, filters, and all — on every non-silent fetch. Because `fetchLogs` is in the effect dependency array, changing any Select/search/lines/switch triggers a non-silent fetch → `isLoading=true` → the controls the user is actively touching unmount and remount. Typing in search (after the 400ms debounce) wipes and remounts the search input, dropping focus mid-word.
**Why it matters:** The interface feels like it breaks every time you use it. Alex (power user) rapidly changing filters gets a strobing teardown; Riley loses search focus.
**Fix:** Keep the toolbar always mounted. Show loading only *inside* the table region (skeleton rows or a subtle overlay), not at the card root. Use `silent`-style fetches for filter changes so the chrome persists.

### [P1] Solid badge variants break the project's status-badge contract
`getLevelBadgeVariant` returns `destructive`/`warning`/`info`/`secondary`, which render as solid filled badges. DESIGN.md / CLAUDE.md are explicit: status badges are *always* `variant="outline"` + `bg-{role}/15 text-{role} border-{role}/30` + a `size-3` lucide icon. Solid variants are forbidden in feature surfaces; `ServiceStatusBadge` is the reference pattern.
**Why it matters:** A column of saturated solid blocks fights "Restraint as the resting state" and makes the surface look like a different product than the rest of QManager.
**Fix:** Switch to outline + tinted-role classes, optionally with a per-level `size-3` icon (e.g. circle/triangle/info). Mirror `ServiceStatusBadge`.

### [P2] Staggered row entrance replays on refresh and every filter change
Each row is a `MotionTableRow` with `x:-8`→`0` and an index-based delay up to 0.4s. On any filter change all keys change → full cascade re-plays; new lines arriving on the 10s silent refresh remount rows and re-animate. With up to 500 motion rows this is both a distraction and a perf cost on a phone-served, modem-hosted page.
**Why it matters:** Decorative motion that replays while reading violates the product motion rule (motion conveys state, not decoration). The cascade also adds perceived latency to every filter.
**Fix:** Animate the table's *first* mount only, or drop per-row stagger in favour of a single quick fade on the table body. Don't re-trigger on silent refresh.

### [P2] A failed fetch looks identical to "no logs"
On error the catch only toasts; `entries` stays `[]`, so the table renders the "No logs found" empty state. A transient backend failure now reads as "your logs are empty."
**Why it matters:** Riley hits a backend blip and is told there's nothing to see — misleading, and there's no retry affordance.
**Fix:** Track an error state distinct from empty; render an error row with a Retry button when a fetch fails.

### [P2] No "reset filters" and no power-user accelerators
A filtered-to-empty result offers no one-click way back. There's no copy/export, no column sort, no click-a-component-to-filter. For a logs surface aimed at technicians, these are the natural expert moves.
**Fix:** Add a "Clear filters" affordance when any filter is active; consider copy-to-clipboard / export and click-to-filter on the component pill.

## Persona Red Flags

**Alex (Power User):** Rapid filter changes strobe the whole card to skeleton. No keyboard shortcuts, no export, no sort, no click-to-filter on a component. Manual refresh is a full teardown rather than an inline spinner.

**Sam (Accessibility):** Levels are encoded with text labels (not colour alone) — good. But the per-row entrance motion relies on the global MotionConfig for `prefers-reduced-motion`; verify it actually suppresses the stagger. Solid badge contrast should be checked against AA for `info`/`warning` foregrounds.

**Riley (Stress Tester):** Backend failure renders as "No logs found" with no retry. Searching loses input focus after the debounce because the input unmounts into the skeleton. 500 rows × motion components is the heaviest path and isn't virtualized.

## Minor Observations

- Mono usage is inconsistent: timestamp is `font-mono`, component sits in a `<code>` pill, but the message (the most machine-voice field) is plain `text-sm`. Decide what counts as machine-voice and apply it consistently.
- Manual refresh and initial load share the full-skeleton path; a manual refresh would feel better as an inline spinner on the refresh button.
- The component column is dropped below `@md` — acceptable for density, but the component filter then references a dimension the user can't see on mobile.
- Empty state teaches nothing beyond "no logs"; when filters are active it could say "no logs match these filters."

## Questions to Consider

- What if filtering never tore down the chrome — could the table cross-fade its body while the toolbar stays rock-steady?
- Does a log table need entrance motion at all, or does the calm-by-default principle argue for none?
- What would the *confident* version of an error state look like here — not a toast that vanishes, but an inline, recoverable row?
