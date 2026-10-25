# NetBird VPN (page anatomy)

Frontend reference for `/monitoring/netbird`. NetBird is an optional, user-installed mesh VPN, so the page's first job is to notice it is absent and offer to fetch it. The backend is a thin control layer over the `netbird` CLI (`scripts/www/cgi-bin/quecmanager/vpn/netbird.sh`); NetBird keeps its own config and there is no UCI section. The sibling page is [`docs/reference/tailscale.md`](tailscale.md); only one of the two VPNs may be installed at a time.

---

## Quick Reference

| Item | Value |
| --- | --- |
| Route | `/monitoring/netbird` (renders `components/monitoring/netbird/netbird.tsx`) |
| Hook | `hooks/use-netbird.ts` (fixed 10 s poll; install progress polled every 2 s) |
| CGI | `GET`/`POST` `/cgi-bin/quecmanager/vpn/netbird.sh` |
| POST actions | `install`, `install_status`, `connect` (optional setup key), `disconnect`, `start_service`, `stop_service`, `set_boot_enabled`, `uninstall` |
| i18n | `monitoring.json` `netbird.*`, all five locales |
| Geometry | `components/monitoring/netbird/shapes.ts` (the page's shape module; skeletons read it) |
| Icons | lucide only (this route is on the lucide side of the icon boundary) |
| Reboot | Offered after uninstall only, through the deferred-reboot hand-off below |

---

## The GET is tiered, and the tiers are the contract

| Tier | Condition | Payload |
| --- | --- | --- |
| 1 | `netbird` binary absent | `installed: false`, `other_vpn_installed`, `other_vpn_name` |
| 2 | installed, daemon not running | `installed`, `daemon_running: false`, `other_vpn_installed`, `enabled_on_boot`, `version`, `other_vpn_name` |
| 3 | daemon up, `netbird status` unparseable | tier 2 shape with `daemon_running: true` and no parsed status |
| 4 | daemon up, status parsed | adds `backend_state`, `management`, `signal`, `fqdn`, `netbird_ip`, `interface_type`, `peers_connected`, `peers_total`, `peers[]` |

`backend_state` is derived by the CGI: `Connected` when management and signal are both `Connected`, `Connecting` when only management is, otherwise `Disconnected`.

A shallow tier is the honest answer, not a failure. Every field after `installed` is optional, so `deriveView()` in `netbird.tsx` tests them explicitly (`status.daemon_running ?? false`) rather than defaulting a tone in.

## `NetbirdView`: what the page may claim

| View | Reached when |
| --- | --- |
| `notInstalled` | `installed` false |
| `serviceStopped` | daemon not running |
| `connected` | `backend_state === "Connected"` |
| `disconnected` | any other non-empty `backend_state` (including `Connecting`) |
| `unknown` | no status at all, or an empty `backend_state` |

`STATUS_VARIANT`, `STATUS_LABEL_KEY` and the band glyphs are all `satisfies Record<NetbirdView, ...>`, so a new view fails the build until each map covers it. Views that land on `muted` carry distinct glyphs; the glyph is the only separation.

## Page shapes and the three data states

- **Other VPN installed** (`other_vpn_installed`, gated on `!isLoading`): header and one `Banner` naming the other VPN with a link to its page. No band, no cards.
- **`notInstalled`**: the install card alone (`install-card.tsx`, a plain card, not a hero), no band, no peers. Header: action title and a muted Not installed badge (the page header's Refresh pill covers re-checking, so the card has none). Body: one tile holding the manual shell command with a copy button, the fallback when the in-page install cannot work; it stays visible after a failure, with the error notice above it. Foot: the data-cost line on the left edge, Install on the right (Try again after a failure). There is no install transcript, so a live run only changes the foot status and the button. While the first read is in flight the page paints `InstallCardSkeleton` instead of the installed layout when the last answer remembered for this tab (`last-known.ts`, `sessionStorage`) was "not installed".
- **Loading**: `StatusBandSkeleton`, `ConnectionCardSkeleton`, `DeviceCardSkeleton`, and the peers card's own skeleton, all built from `shapes.ts` constants.
- **Empty**: connected with zero peers renders the peers card's empty `ConditionBlock` (`muted`), not a blank table.
- **Error**: no status at all (`!status && !isLoading`) renders a destructive `ConditionBlock` with Retry. The peers card is a separate surface and mounts with its own condition. A failed poll on top of good data is a non-blocking notice, never a replacement for the content.
- **Installed**: status band, the Connection and This device pair, the full-width peers table.

---

## Components

| File | Role |
| --- | --- |
| `netbird.tsx` | Page shell, `deriveView`, band tiles, owner of the reboot dialog |
| `status-band.tsx` | Pinned-height tiles and the verdict chip |
| `connection-card.tsx` | Connect / Disconnect, Start / Stop service, Uninstall (only while not connected), Start on boot row (`SegmentedField`), setup-key field |
| `device-card.tsx` | Identity rows (FQDN, NetBird IP, interface); values mono as opaque strings |
| `peers-card.tsx` | The peer table |
| `install-card.tsx` | The not-installed card and its skeleton: header badge, manual-command tile, `CardFoot` (cost left, Install right) |
| `last-known.ts` | The remembered installed flag that picks the first-paint skeleton |
| `danger-card.tsx` | `UninstallButton` (`AlertDialog` confirm, trailing end of the Connection rail) and `RebootDialog` |
| `condition-block.tsx` | Loading-adjacent empty and error blocks (the block is the state) |
| `shapes.ts` | Class constants, view maps, table geometry |

The pre-canon `netbird-connection-card.tsx` and `netbird-peers-card.tsx` no longer exist.

### Mutations and toasts

Every `use-netbird` action returns `NetBirdActionResult` (`{ success, error }`). Handlers fire one `toast.success` or `toast.error` at the terminal moment and take the reason from the result, never from hook `error` state read after an `await`. Install is asynchronous: the POST starts a background opkg job and `install_status` is polled every 2 s until terminal; a refused start (`other_vpn_installed`, `already_installed`) is an error with no job to poll.

## Reboot hand-off after uninstall

A successful uninstall flips the view to `notInstalled`, which would unmount the Connection card and its dialog, so `RebootDialog` is owned by the page shell. "Reboot now" calls `rebootNow("netbird")` from `@/lib/reboot` (fire-and-forget POST, then the `/reboot/` countdown). Declining in any way (Reboot later, Escape, scrim click) calls `requestRebootLater("netbird")`, which sets the persistent deferred-reboot flag so the banner survives navigation. The dialog ignores close attempts once a reboot has started.

**Why:** the app runs on the modem, so a reboot kills the in-flight request; the reboot is never issued in the CGI response path, and a declined dialog must not lose the pending reboot.

---

## Peers table: narrow-card recomposition

The card is the container (`@container/card`), not the viewport.

| Column | Visible from |
| --- | --- |
| Name (with the NetBird IP folded under it) | always, below `@sm/card` |
| Address (mono) | `@sm/card` (the folded sub-line goes away) |
| Connection type (direct / relayed) | `@sm/card` |
| Last seen | `@md/card` |
| Status | always |

The name cell is `w-full max-w-0` with truncation so a long hostname never widens the table; folding the address under the name is what keeps the status column on screen on a narrow card. `TABLE.ROW_HEIGHT` is `h-13`, shared with the skeleton so the pin is arithmetic.

## Gotchas

- **Last seen needs a clock guard.** The device has no battery RTC and boots at Jan 1970. `formatLastSeen` in `peers-card.tsx` returns the "unknown" copy when `Date.now()` is before 2020-01-01, when the timestamp is unparseable or missing (`-`), or when the delta is negative or over a year. An online peer shows "now" regardless. Any new relative-time rendering on this platform needs the same guard.
- `peers[]` is shown only while `backend_state` is `Connected`; counts in the band are zeroed otherwise.
- `refresh` is wrapped before it reaches a click handler so a click event never lands in the hook's argument.
- Connecting with no daemon running makes the CGI start it first and wait; do not add a second start call in the UI.
