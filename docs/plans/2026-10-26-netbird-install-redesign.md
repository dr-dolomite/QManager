# NetBird install state: same recomposition as Tailscale

Reference: Tailscale's install card (commits `a6f17931`, `de772939`), `docs/plans/2026-10-26-tailscale-install-redesign.md`, and the critique `.impeccable/critique/2026-10-25T16-19-26Z__components-monitoring-tailscale-install-card-tsx.md`. NetBird's `install-card.tsx` has the same defects: a centred `ConditionBlock` (`rounded-hero`) inside a `HERO_SHELL` (`rounded-hero`), the data cost welded to the status block, and a peer "Check again" pill.

Frontend only, one layer: no CGI, hook or installer change, no reboot or connection risk. Worktree not needed (small, one family); it lands on `development-home` as two atomic commits.

## What differs from Tailscale (so it is not a straight copy)

- **No build choice.** There is one package, so there is no Build tile. The card's one inner container is the existing manual-install command (label + mono command + copy button): it is the fallback path, so it stays visible, including after a failure.
- **No transcript.** The CGI and `use-netbird` expose no install log, so a live run keeps the command tile and only the foot changes ("Installing NetBird. Keep this page open." + spinner, button disabled "Installing...").
- **The page header already has a Refresh pill** that stays on in the not-installed state (`netbird.tsx` ~line 284). So the card gets no refresh icon and loses "Check again": adding one would duplicate a control on the same screen. (Tailscale removed its header Refresh earlier; unifying the two headers is a separate decision.)
- Strings live in `public/locales/*/monitoring.json` (`netbird.install.*`), not `common.json`.
- The family restates constants rather than importing across families, so NetBird gets its own copies of the shared pieces.

## Files

| File | Change |
|---|---|
| `components/monitoring/netbird/install-card.tsx` | Rebuild: `CARD_SHELL`; header = action title "Install NetBird", one sentence, muted "Not installed" `Badge` with a `size-3` PackageIcon (reuse `netbird.status.notInstalled`); body = the command tile (key left: label; value: mono command; copy icon) stacked on a narrow card; failed -> destructive notice above the tile; `CardFoot` = cost left, Install right (label "Try again" after a failure, "Installing..." while running, disabled when running or complete); remove the success notice (toast confirms), the `ConditionBlock`, "Check again". Export `InstallCardSkeleton` (real header copy, pinned tile, foot with the action's height). |
| `components/monitoring/netbird/shapes.ts` | Add `STATUS_LINE`, `SKELETON.INSTALL` (the command tile's height, measured in the browser), drop `HERO_SHELL` / `HERO_PAD` if nothing else uses them, restyle `COMMAND` onto the tile geometry (`rounded-tile`, `bg-surface-container`, label left). |
| `components/monitoring/netbird/last-known.ts` | New: the same small `sessionStorage` + `useSyncExternalStore` helper, key `qm-netbird-installed`. |
| `components/monitoring/netbird/netbird.tsx` | `InstallCardSkeleton` on first paint when the last answer was "not installed"; remember the live answer in an effect. |
| `public/locales/{en,zh-CN,zh-TW,it,id}/monitoring.json` | `netbird.install`: retitle, one-sentence description, add `cost`, `installingBuild` (no build name: "Installing NetBird. Keep this page open."), `retry`; remove `conditionTitle`, `conditionDescription`, `checkAgain`; keep `done` (foot status), `failed`, `manualLabel`, `copyCommand`, `manualCommand`. Hand-translated; zh-TW written in Traditional. |
| `docs/reference/netbird.md` | Update line 50 ("install hero"), the file table row (line 67), and note the skeleton hint. |

## Validate

`bunx tsc --noEmit`, `bunx eslint components/monitoring/netbird`, `bun run i18n:check`, `bun run icons:check`, grep the diff for `/etc/`, `/tmp/`, `uci `, `AT+`, `read back`, `saved to` (the shipped `opkg update && opkg install netbird` command is the product's intended manual route and already existed). Render idle / running / failed / skeleton at wide and 375px, dark and light, in a temporary harness page that I delete afterwards (the real route is login-gated; the other chat's dev server on :3111 serves this folder).

## Decisions I am making unless you say otherwise

1. No refresh icon on the card (the page header owns Refresh here).
2. The manual command stays above the Install button rather than hidden behind a disclosure; it is the only inner container.
3. Cost copy matches Tailscale's: "Uses mobile data; the connection slows while it runs."

## Rollback

`git revert` the two commits. No device state is touched.

## Commits

1. `refactor(netbird): recompose the install card around a command tile and card foot`
2. `docs(netbird): describe the recomposed install card`
