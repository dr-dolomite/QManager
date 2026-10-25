# Tailscale install state: implement the redesign

Mock (the target): `docs/plans/mocks/tailscale-install-redesign.html`. Critique snapshot: `.impeccable/critique/2026-10-25T16-19-26Z__components-monitoring-tailscale-install-card-tsx.md` (25/40, two P1).

Scope is frontend only, one layer: no CGI, hook contract, installer or UCI change. No reboot or connection risk. Treated as "large" only because it touches shared tokens and five locale catalogs.

## Files

| File | Change |
|---|---|
| `components/monitoring/tailscale/install-card.tsx` | Rebuild the card (below). |
| `components/monitoring/tailscale/shapes.ts` | `HERO_SHELL` -> `CARD_SHELL` for this card; replace `SOURCE.*` with a Build-tile constant set (reuse `SWITCH_ROW` geometry: `rounded-tile`, `@md/card:flex-row`); add `InstallCardSkeleton` geometry from the same constants. `CONDITION` stays (still used by the unreadable state). |
| `components/monitoring/tailscale/tailscale.tsx` | Pass nothing new; render `InstallCardSkeleton` while loading when the last-known state was "not installed" (step 5). |
| `public/locales/{en,zh-CN,zh-TW,it,id}/common.json` | `tailscale.install.*` keys (below). |
| `docs/reference/tailscale.md` | Update the install-card rows (lines ~58, 75, 84). |

## Card, top to bottom

1. **Header** (`CardTitle` + `CardDescription`, no icon): title "Install Tailscale", one sentence "A mesh VPN for reaching this modem from anywhere, no open port." Right: muted `Badge` with a `size-3` PackageIcon, "Not installed" (reuse `tailscale.status.notInstalled`, `STATUS_VARIANT.notInstalled`), then an `icon-sm` ghost refresh button (`RefreshCcwIcon`, `aria-label`/`title` from the existing `tailscale.page.refresh`, spins while loading), same pattern as the Connection card header. Drop `ConditionBlock` and the "Check again" pill.
2. **Build tile** (the card's one inner container, shown only when `tiny_available`; otherwise a one-line "Official build" tile with no control): "Build" label + `HintIcon` left, `SegmentedField` right (Tiny default), description of the picked build underneath the label, with the "To switch later, uninstall and reinstall" clause kept visible. Stacks on a narrow card.
3. **CardFoot**: status left (warning glyph + "Uses mobile data; the connection slows while it runs."), `Button size="action"` "Install Tailscale" right. Install is operational and so exempt from the CardFoot rule, but the foot pins the commit to the bottom-right edge and wraps full-width on a phone.
4. **Running**: the transcript (`InstallLogViewer`) replaces the Build tile; the foot status becomes "Installing the Tiny build. Keep this page open." with a spinner; button disabled "Installing...". Refresh disabled.
5. **Failed**: the destructive notice sits directly above the transcript (not above the picker); button becomes "Try again". The success notice goes (the toast already confirms and the card unmounts on the next poll).

## i18n (all five catalogs)

- Remove: `conditionTitle`, `conditionDescription`, `checkAgain`, `descriptionChoice`, `sourceHint`, `source.*.description`, `done`.
- Rewrite: `title` "Install Tailscale", `description` (one sentence), `source.tiny.description` / `source.official.description` as consequence lines (flash and who built it), `sourceHint` as the mechanism-only tip (Tiny brings its own service and network setup).
- Add: `cost` (the footer warning), `switchLater`, `installingBuild` ({{build}}), `retry`.
- zh-TW from zh-CN via OpenCC (existing practice); run `bun run i18n:check` for parity.

## Decision for you

The mock shows "~6 MB / ~12 MB" flash sizes. The backend does not report them, and I do not invent figures. **The plan ships the descriptions without numbers** ("About half the flash. Community build." / "Full size. Tailscale's own build.") unless you want a backend follow-up to report download size and free overlay space.

## Step 5 (optional, say if you want it out)

First paint shows the installed-state skeleton (band + two cards + peers) for a not-installed modem. Remember the last-known `installed` flag in `sessionStorage` (try/catch, read through `useSyncExternalStore` so the static export does not mismatch on hydration) and show `InstallCardSkeleton` instead when it was false. Small, but it is the only piece that touches `tailscale.tsx` logic.

## Order and validation

1. `shapes.ts` constants, 2. `install-card.tsx`, 3. locale catalogs, 4. skeleton + `tailscale.tsx`, 5. docs.
Validate: `bunx tsc --noEmit`, eslint on touched files, `bun run i18n:check`, `bun run icons:check` (lucide only on this route, so no Material glyphs added), grep the diff for `/etc/`, `/tmp/`, `uci `, `AT+`, `read back`, `saved to`. Then render all states (idle, Official-only, running, failed) at wide and 375px in the browser pane. The dev server redirects to `/login/`, so I need you to sign in to the preview or point me at a logged-in session; if not, I will drive the states with the mock's own bench against the real component via a temporary harness page that I delete afterwards.

## Out of scope / follow-ups

- Netbird's `install-card.tsx` has the same layout and will diverge until it gets the same treatment. Separate change.
- Backend size/free-flash reporting (see above).

## Rollback

All changes are in tracked frontend files plus the catalogs; `git revert` of the commit set. No device state is touched.

## Commits (atomic)

1. `refactor(tailscale): recompose the install card around a build tile and card foot`
2. `fix(tailscale): show the install skeleton for a not-installed modem` (if step 5)
3. `docs(tailscale): describe the recomposed install card`
