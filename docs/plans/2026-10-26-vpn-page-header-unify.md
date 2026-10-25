# Unify the Tailscale and NetBird page headers (Refresh placement)

## Where they differ today

| | Tailscale | NetBird |
|---|---|---|
| Page header | Title and description only (`tailscale.tsx`, deliberate: its doc says the header "no longer carries a Connected chip or a Refresh pill") | Title and description, plus a status chip (hidden when not installed or blocked) and a 42px "Refresh" pill (`netbird.tsx` ~lines 293-318), always shown |
| Where Refresh lives | `icon-sm` ghost button in the Connection card header; also in the install card header | The header pill only; the install card has none (I left it out last change because the pill covered it) |
| Where the verdict lives | First tile of the status band | First tile of the status band **and** the header chip (the same fact twice) |

Same product family, two answers. Tailscale's is the canon-aligned one (status claimed once, no pill stack in the page header, controls beside the thing they refresh), so **NetBird moves to it**. Tailscale's page does not change.

## Changes (frontend only, one layer, no device state)

| File | Change |
|---|---|
| `components/monitoring/netbird/netbird.tsx` | `MonitoringPageHeader` gets title + description only. Remove the chip, the Refresh `Button`, `PILL_REST` / `PILL_GLYPH` / `RefreshCcwIcon` / `ConnectionChip` imports if now unused. Pass `onRefresh={reload}` and `isRefreshing={isLoading}` to `ConnectionCard` and `InstallCard`. |
| `components/monitoring/netbird/connection-card.tsx` | Header actions: version `Tag` then an `icon-sm` ghost refresh button (`RefreshCcwIcon`, spins while refreshing, `aria-label` and `title` from the existing `netbird.page.refresh`), exactly as Tailscale's Connection card. |
| `components/monitoring/netbird/install-card.tsx` | Restore the same icon button beside the Not installed badge (disabled while a run is live), `isRefreshing` prop. |
| `components/monitoring/netbird/status-band.tsx`, `components/monitoring/tailscale/status-band.tsx` | `ConnectionChip` has no caller on Tailscale and will have none on NetBird: delete both, and any import (`Badge`, `SwapLabel`) only they used. |
| `components/monitoring/netbird/shapes.ts` | Drop `PILL_REST` / `PILL_GLYPH` if nothing else reads them (Tailscale keeps its own copies, restated per family). |
| `docs/reference/netbird.md`, `docs/reference/tailscale.md` | NetBird: header anatomy and where Refresh lives; correct my earlier line that says the card has no refresh. Tailscale: drop any `ConnectionChip` mention. |

No locale change: `netbird.page.refresh` already exists in all five catalogs and becomes the icon button's name; `netbird.status.aria` stays used by the install card badge. No hook, CGI or installer change.

## Behaviour changes to know about

- NetBird loses the always-on header Refresh in the **blocked-by-other-VPN** state (only a banner shows there), same as Tailscale today; the banner links to the other page.
- The unreadable state keeps its Retry in the condition block, unchanged on both.

## Validate

`bunx tsc --noEmit`, `bunx eslint components/monitoring`, `bun run i18n:check`, `bun run icons:check`. Render the NetBird installed Connection card header (version tag + refresh icon, narrow and wide) and the install card in the same temporary harness as before (deleted afterwards), because the live route is login-gated; I cannot render the real installed page without a signed-in session or device data, so the installed header gets a harness render with a stub status, not a live check.

## Commits

1. `refactor(netbird): move Refresh into the card headers and drop the header chip`
2. `docs(vpn): describe Refresh placement on the Tailscale and NetBird pages`

## Rollback

`git revert` the two commits.
