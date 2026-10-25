# Tailscale VPN (page anatomy)

Frontend reference for `/monitoring/tailscale`. The backend (Official / Tiny install sources and in-app update, `tailscale up` double-fork, the `--accept-routes` ban, the marker file, uninstall) lives in [`docs/features/tailscale-vpn.md`](../features/tailscale-vpn.md); read that before touching the CGI.

Tailscale is an optional, user-installed mesh VPN. Nothing in a stock install ships it, so the page's first job is to notice it is absent and offer to fetch it: the official build from Tailscale, or, where the firmware already trusts its feed, iamromulan's smaller Tiny build. Once installed it gives the modem a stable `100.x.y.z` address, which is the way back in when a change severs the LAN route (IP Passthrough, a gateway-IP edit).

> NEVER pass `--accept-routes` to `tailscale up`. It disconnects the device from the network and only a physical reboot recovers it.

---

## Quick Reference

| Item | Value |
| --- | --- |
| Route | `/monitoring/tailscale` (`app/monitoring/tailscale/page.tsx` renders `components/monitoring/tailscale/tailscale.tsx`) |
| Hook | `hooks/use-tailscale.ts` (poll 10 s, 3 s while an auth URL is pending; one `check_update` per visit) |
| CGI | `GET`/`POST` `/cgi-bin/quecmanager/vpn/tailscale.sh` |
| i18n | `common.json` `tailscale.*`, all five locales |
| Geometry | `components/monitoring/tailscale/shapes.ts`, the family's only shape module |
| Icons | lucide only (this route is on the lucide side of the icon boundary) |

---

## The GET is tiered, and the tiers are the contract

| Tier | Condition | Payload |
| --- | --- | --- |
| 1 | not installed | `installed: false`, `tiny_available`, `other_vpn_installed` |
| 2 | installed, daemon down | `daemon_running: false`, `enabled_on_boot`, `version`, `install_variant`, `latest_version`, `update_available`, `legacy_build`, `net_fixes_enabled` (omitted on Tiny), `tiny_available` |
| 3 | daemon up, status unparseable | tier 2 plus `backend_state: "Unknown"`, `error_detail` |
| 4 | daemon up, status parsed | plus `backend_state`, `auth_url`, `self`, `tailnet`, `peers[]`, `health[]`, `exit_node_advertised` |

A fifth, bare answer exists while an install or update holds the backend lock: `{installed: true, busy: "install" | "update"}` with no daemon reading. The hook layers `busy` over the last good payload instead of replacing it (a replacement would read as "service stopped"), and `deriveView()` returns `unknown` when it has nothing else to go on.

A shallow tier is the honest answer, not a failure. Every field after `installed` is optional, so `deriveView()` in `tailscale.tsx` tests them explicitly (`status.daemon_running ?? false`) instead of defaulting a tone in. A `??` that supplies a cheerful default invents a verdict the device never gave.

---

## `TailscaleView`: the six things the page may claim

`deriveView()` collapses the payload into one view that every child reads. No component re-derives state from a payload's shape.

| View | Reached when | Chip | Glyph |
| --- | --- | --- | --- |
| `notInstalled` | `installed` false | none | none |
| `serviceStopped` | daemon down | `muted` | `PowerOffIcon` |
| `needsLogin` | `NeedsLogin` / `NeedsMachineAuth` | `warning` | `LogInIcon` |
| `running` | `Running` | `success` | `CheckCircle2Icon` |
| `disconnected` | any other backend state | `muted` | `MinusCircleIcon` |
| `unknown` | no status at all | `muted` | `CircleHelpIcon` |

Three views land on `muted`, which is why each carries its own glyph. `STATUS_VARIANT` is `satisfies Record<TailscaleView, BadgeVariant>`, so a view with no matching role fails the build.

## Four page shapes

- **Other VPN installed** (`other_vpn_installed`): the header and one `Banner` (`degraded`) naming the other VPN with a link to its page. No band, no cards; only one VPN can exist at a time.
- **Legacy build** (`legacy_build`, variant `opkg` only): the normal installed page, with one persistent informational `Banner` (`in-progress` role, `InfoIcon`, no action) above the content saying QManager cannot update this build and that Uninstall then Install offers a supported one. There is no switch action; the Update controls never appear on a legacy build. A Tiny install is not legacy.
- **`notInstalled`**: the install hero alone. No band, no peers card, no danger row.
- **No status at all** (`!status && !isLoading`): a destructive `ConditionBlock` with Retry. The peers card is a separate read and mounts with its own condition.
- **Everything else**: header, four-tile status band, the Connection / This device pair, the full-width peers table.

A failed poll on top of good data is a non-blocking notice above the content, never a replacement for it.

---

## Components

| File | Role |
| --- | --- |
| `tailscale.tsx` | Page shell (title and description only, no header actions), `deriveView`, the four band tiles, the reboot dialog owner |
| `status-band.tsx` | Four pinned-height tiles, the verdict chip (`SwapLabel` morph) |
| `connection-card.tsx` | Header tags (Community build only) and the Refresh icon button, rail of actions per view (see below), Start on boot, Advertise as exit node, Tailscale SSH and Network fixes rows (On / Off `SegmentedField`), health notice, auth `ConditionBlock` with the one ambient loop |
| `device-card.tsx` | Tailnet identity as pill rows (identifiers mono) ending in the Version row (Rethink) with the update offer, and the update transcript while one runs |
| `peers-card.tsx` | The peer table; the only hairline surface |
| `install-card.tsx` | The not-installed hero: a one-sentence description, the **Build** picker (only when `tiny_available`), Install and Check again, transcript |
| `update-control.tsx` | The Version-row update offer: `xs` tonal button, confirm `AlertDialog`, handler-level toasts |
| `install-log-viewer.tsx` | Install and update transcript: the last 50 lines `install_status` sends as `log` (B5.7); takes an optional `title` |
| `danger-card.tsx` | `UninstallButton` (confirm dialog, trailing end of the Connection rail), plus `RebootDialog` |
| `condition-block.tsx` | The family's state block; the block IS the state |

### Target-only behaviour

- **Header and Refresh.** The page header is the title and description only: it no longer carries a Connected chip (the status band's verdict chip is the one place the state is claimed) or a Refresh pill. Refresh is a ghost icon button at the top-right of the Connection card header (`RefreshCcwIcon`, spins while `isLoading`, `aria-label` and `title` from `tailscale.page.refresh`); it calls the hook's `refresh` through `reload()` so a click event never reaches the fetch argument. The not-installed hero keeps its own Check again button and the unreadable state its Retry.
- **Install source.** When `tiny_available`, the install card shows a **Build** `SegmentedField` (Official / Tiny, lucide check glyph, `breakpoint="never"`) under a label with a `HintIcon` (size and the uninstall-to-switch rule), plus one sentence describing the selected build; the card description switches to `descriptionChoice`. Default Official. Without `tiny_available` the card is the single official path and `runInstall()` posts `{action:"install", source:"official"}`. `runInstall(source)` posts the picked source. No feed URLs, package-manager names or paths in the copy. In the Connection header a `Tiny build` `Tag` marks a Tiny install and `Community build` an unknown opkg one (identity, not status); the Network fixes row disappears on Tiny because the GET omits `net_fixes_enabled`.
- **In-app update.** The hook calls `check_update` once per visit, only when Tailscale is installed and not a legacy build (Official and Tiny both qualify), and merges `latest_version` / `update_available` into `status` (no refetch, no flicker). The update is offered quietly in **This device**: the identity rows end with a **Version** row (Rethink, a quantity, not mono), and when `update_available` that row carries a small tonal `xs` button "Update available (1.104.1)" (`update-control.tsx`) that opens an `AlertDialog` (the tunnel reconnects for a few seconds). No header badge, no rail button, no separate version Tag: the offer is never louder than the version it replaces. `runUpdate()` POSTs `update`, then follows `install_status` every 2 s, **tolerating up to 20 s of failed reads** (the page may itself be served over the tunnel that restarts), with a 10 min ceiling; it resolves `{ok, reason}` and the loop outlives the component so the toast still lands after navigation. While it runs This device shows the transcript (`InstallLogViewer`, update title), the Connection card disables every action, and the page suppresses the stale-poll notice. `status.busy` locks the same controls when an install or update was started elsewhere.
- **Network fixes** (`set_net_fixes`). An On / Off row beside Start on boot, bound to `net_fixes_enabled`, default on. It replaces the removed Force Tailscale Fixes toggle in System Settings. Unlike the opt-in rows it does **not** take the promoted `SWITCH_ROW.ON` fill when on (`promoteOn={false}`): a default-on safety setting stays quiet. The row is left out when the CGI does not report the field.
- **Exit-node advertising** (`set_exit_node`). Locked, with a visible note, until the node is `Running`: `tailscale set` cannot reach a stopped or logged-out daemon.
- **Tailscale SSH** (`set_ssh`, B5.7). Same lock rule as exit node. Turning it on confirms first (`sshDialogTitle` / `sshDialogDescription`); off applies at once. The state is tailscaled's `RunSSH` pref read back as `ssh_enabled`; while connected, `null` hides the row instead of guessing. The source's `sshPending` ("applies on next connect") is not ported: this CGI refuses while disconnected instead of storing a flag.

### Mutations and toasts

Every hook mutation returns `TailscaleActionResult { ok, reason }`. `reason` is already resolved through `resolveErrorMessage` (empty when the backend gave none). Handlers fire one toast at the terminal moment: `toast.success(t(...))`, or `toast.error(result.reason || t(fallbackKey))`. They never read hook `error` state after an `await`.

Install is asynchronous: the POST starts a background job and `install_status` (which also reports `op`: `install` or `update`, and an `error` code resolved through `resolveErrorMessage`) is polled every 2 s. The install card fires one toast with the deterministic id `tailscale-install` when a run it watched goes `running` to `complete` or `error`; a result that was already terminal on mount never toasts. A refused start (`other_vpn_installed`, `already_running`) lands as an error notice with no job to poll.

Update is a handler-level toast in `update-control.tsx`: `toast.success(updated, {version})` or `toast.error(result.reason || updateFailed)`, where `reason` carries `update_rolled_back`, `insufficient_space`, `checksum_mismatch` and the rest of the update codes from the `errors` catalog. The Network fixes row toasts `netFixesOn` / `netFixesOff` / `netFixesFailed` the same way.

### The action rail

At most one destructive button shows per state, and each is a step further from the live link than the last:

| View | Rail |
| --- | --- |
| `serviceStopped` | Start service |
| `needsLogin` | Connect (hidden while an auth URL is pending), Stop service, **Uninstall** (trailing edge) |
| `running` | Disconnect only |
| `disconnected` | Connect, **Log out** |

Log out appears only after Disconnect, and Uninstall only once the node is logged out (`NeedsLogin`), so neither sits one click from a working tunnel.

The rail carries no Update action: it lives on the Version row of This device (see In-app update), which shows only while the node is running.

### Uninstall and the reboot hand-off

A successful uninstall flips the view to `notInstalled`, which would unmount the Connection card and its dialog. `RebootDialog` is therefore owned by the page shell. "Reboot now" calls `rebootNow("tailscale")` from `@/lib/reboot` (fire-and-forget POST, then the `/reboot/` countdown); "Reboot later" just closes it.

---

## Geometry that is measured, not asserted

- `TABLE.ROW_HEIGHT` is 52px: the device cell is a 20px name over a 16px DNS name inside 16px of padding. Both line boxes are explicit so the pin is arithmetic.
- The band's tile floor is 248px: a tile's text column is its width minus 106px of disc, gap and padding, so a smaller floor leaves too little for a 15-character address.
- `TILE_VALUE` is 18px: the band carries word verdicts ("Richiede accesso" is 167px at 22px).
- The peers skeleton has zero row gap plus each row's hairline, because a gapped stack is taller than the table it stands in for.

### Motion

One page cascade (`staggerContainer` / `staggerItem`), row cascades in the identity card and the peer table, a `SwapLabel` chip morph, and tonal tile fills crossing on `standard`. Exactly one ambient loop exists: the live dot during the auth wait. Nothing loops once connected.

---

## Gotchas

- The `--accept-routes` health advisory is filtered out of the health notice. It is normal on this device and not a fault.
- "Last seen" needs a 1970 guard. The device has no battery RTC, so `formatLastSeen` returns the unknown sentinel when `Date.now()` is before 2020 or the delta exceeds a year. Any new relative-time rendering on this platform needs the same guard.
- `peers[]` ordering is whatever the CGI's jq produces; the table does not sort and has no search.
- A Force Tailscale Fixes toggle no longer exists in System Settings; its job is the Network fixes row here. Nothing on the frontend still reads or sends `force_tailscale_fixes`.
- The legacy banner uses the `in-progress` role with an explicit `InfoIcon` (the Banner's calm standing-notice container, Info-Is-Brand), not `degraded`: a community build still works, it just cannot be updated here.
- The `Banner` for the other-VPN case uses the `degraded` role (a warning-container notice), not `override`: the page genuinely cannot work until the other VPN is removed.
