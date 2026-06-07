# LAN Gateway / Subnet Configuration

QManager lets users change the modem's LAN bridge IP address and subnet prefix directly from the Local Network page. Because the device is the router, changing its own LAN IP severs the serving HTTP connection — the apply is designed to flush the response before the network reloads, then leave the user a persistent banner pointing at the new address.

---

## Quick Reference

| Item | Value |
|---|---|
| CGI script | `scripts/www/cgi-bin/quecmanager/network/lan_config.sh` |
| Install path | `/www/cgi-bin/quecmanager/network/lan_config.sh` |
| Endpoint | `GET/POST /cgi-bin/quecmanager/network/lan_config.sh` |
| UCI keys written | `network.lan.ipaddr`, `network.lan.netmask` |
| Event emitted | `lan_address_changed` |
| Reboot? | No — `network reload` only |
| Frontend card | `components/local-network/lan-config-card.tsx` |
| Hook | `hooks/use-lan-config.ts` |
| Types | `types/lan-config.ts` |
| i18n namespace | `lan_config.*` (all 5 `local-network.json` locales: en, zh-CN, zh-TW, it, id) |

---

## Endpoint Contract

### GET `/cgi-bin/quecmanager/network/lan_config.sh`

Returns the current LAN bridge address and derived CIDR prefix.

**Response:**

```json
{
  "success": true,
  "device": "br-lan",
  "ipaddr": "192.168.1.1",
  "netmask": "255.255.255.0",
  "prefix": 24
}
```

- `device` is read from `network.lan.device`; defaults to `"br-lan"` if absent.
- `prefix` is computed by the CGI from the stored `netmask` via a pure-shell popcount — it is never stored independently.
- Error if either `ipaddr` or `netmask` is absent from UCI, or if the stored netmask is malformed: `{ "success": false, "error": "lan_read_failed", "detail": "..." }`.

### POST `/cgi-bin/quecmanager/network/lan_config.sh`

Applies a new gateway IP and subnet prefix.

**Request body:**

```json
{ "ipaddr": "192.168.2.1", "prefix": 24 }
```

- `ipaddr` — string, exactly 4 decimal octets each 0–255, no leading zeros, first octet 1–223 and not 127. Rejects multicast (224+), class-E, loopback, and 0.x.x.x.
- `prefix` — integer, enforced range **16–30**.

**Success response (emitted before the apply):**

```json
{
  "success": true,
  "apply_in_progress": true,
  "disconnect_window_seconds": 30,
  "carrier_bounce": true,
  "new_ipaddr": "192.168.2.1",
  "netmask": "255.255.255.0",
  "prefix": 24
}
```

`disconnect_window_seconds` is **30** when the IP or netmask actually changed (carrier bounce follows), or **5** when the submitted values are identical to what is already in UCI (no-op apply — no bounce occurs). `carrier_bounce` mirrors this: `true` when a bounce was scheduled, `false` on a no-op.

After flushing this response, the CGI fire-and-forgets a sequenced background job:

```sh
# One detached double-fork (lan_config.sh:318-333):
( (
    sleep 1
    /etc/init.d/network reload                 # br-lan rebinds to new IP ≈ +1s
    if [ "$LAN_CHANGED" = "1" ]; then
        /etc/init.d/dnsmasq reload             # new DHCP pool active ≈ +1s
        # Safety-net watchdog: force every member back up after 15s no matter what.
        ( ( sleep 15
            for _m in $LAN_MEMBERS; do ip link set "$_m" up 2>/dev/null; done
          ) </dev/null >/dev/null 2>&1 & )
        sleep 3
        for _m in $LAN_MEMBERS; do ip link set "$_m" down 2>/dev/null; done   # +4s
        sleep 4
        for _m in $LAN_MEMBERS; do ip link set "$_m" up   2>/dev/null; done   # +8s
    fi
) </dev/null >/dev/null 2>&1 & )
```

The 1-second sleep before `network reload` ensures HTTP bytes have flushed before `br-lan` rebinds. `dnsmasq reload` runs immediately after so the daemon is already serving the new pool before the bounce brings clients back. The carrier bounce then takes every member **down at +4 s** and back **up at +8 s** — the deterministic "modem floor" at which `br-lan` is live again at the new IP. The `sleep 15` block is a *parallel* safety watchdog (force-up if the bounce is killed), **not** the bounce trigger. After +8 s the cable-sense upstream router (Flint 2) must still re-run DHCP, so the new gateway is typically reachable from a browser at **≈ +11–18 s** (empirically ~15 s).

**Error codes:**

| Code | Meaning |
|---|---|
| `invalid_ipaddr` | Address is absent, wrong type, non-numeric, out of 0–255 range, has leading zeros, or is non-unicast |
| `invalid_prefix` | Prefix is absent, non-integer, or outside 16–30 |
| `invalid_host_in_subnet` | Supplied IP is the network address or broadcast address of the resulting `/<prefix>` subnet |
| `lan_read_failed` | GET only — could not read UCI or stored netmask is malformed |
| `lan_save_failed` | POST only — `uci commit network` failed |

---

## Key Invariants

### 1. Carrier bounce on change — `network reload` doesn't drop carrier

`network reload` rebinds the `br-lan` L3 address but never toggles the physical port's link state. A cable-sense upstream router (such as a GL.iNet Flint 2 running in WAN/DHCP mode) only re-runs DHCP when it detects a link-state change. Without a physical carrier bounce, the upstream router keeps its stale lease and old gateway entry — it never discovers the new subnet.

The fix: after `network reload`, the CGI bounces every bridge member (`ip link set <member> down; sleep 4; ip link set <member> up`). This forces the upstream router to drop its lease and send a fresh DHCP DISCOVER into the new subnet. Validated end-to-end on a live RM551E + Flint 2: `br-lan 192.168.224.1/22 → 192.168.228.1/22` + bounce → Flint 2 re-leased to `192.168.229.x` with the new gateway. The round-trip also verified that netifd does not fight a manual `ip link down` — the port stays down for the full 4-second window.

**Member derivation (no hardcoded interface names):** The CGI reads `LAN_DEV` from `network.lan.device` (defaulting to `br-lan`), then lists actual bridge members from `/sys/class/net/$LAN_DEV/brif`. If the path is empty or absent (the device is not a Linux bridge), it falls back to `LAN_DEV` itself. This makes the bounce portable across board types with different physical interface names.

**Change gate:** The bounce only fires when the submitted `ipaddr` or `netmask` differs from what is already in UCI (`OLD_IP` / `OLD_MASK` captured before the `uci set`). An identical re-submit is a no-op: no bounce, `disconnect_window_seconds` returns 5, `carrier_bounce` returns false.

**dnsmasq reload:** Immediately after `network reload` (and before the `sleep 3` that precedes the bounce), the CGI reloads dnsmasq (instance `lan_dns`, leasefile `/tmp/data/dhcp.leases.lan`). This ensures the daemon is already serving the new DHCP pool and scope when bounced clients send their DISCOVER. Without this step, clients could receive an address from the old pool during the window between `network reload` and the first dnsmasq restart.

**Device constraints — no `setsid`, no `base64`:** The RM551E BusyBox does not include `setsid` or `base64`. Background detachment therefore uses the double-fork pattern (`( ( ... ) & )`) for both the `network reload` job and the carrier-bounce watchdog. They are independent forks — the bounce is not chained inside the `network reload` subshell — so the reload completing or failing does not affect the bounce timer.

### 2. "Gateway" = `network.lan.ipaddr`

On a LAN bridge there is no `network.lan.gateway` key — the router's own LAN IP is the gateway that DHCP clients are given. The CGI reads and writes only `network.lan.ipaddr` and `network.lan.netmask`. No `gateway` key is ever created.

**Why:** OpenWRT's `network.lan` section models the device as a host *on* its own LAN, not as a router with a separate next-hop. The device IS the gateway.

### 2. Self-severing apply

Changing the LAN IP and running `network reload` rebinds `br-lan` to the new address. This drops the TCP connection the browser used to make the POST request, and if the IP changed, the old origin is gone. The CGI **must** flush the HTTP response before the reload fires.

The pattern mirrors the no-in-flight-reboot rule in CLAUDE.md: the response encodes `new_ipaddr` so the frontend can tell the user exactly where to reconnect. The hook (`use-lan-config.ts`) therefore has **no retry loop** against the old origin — on a successful POST it transitions immediately to an "applied" state, and the card shows a persistent `Alert` banner linking the new address.

**Why:** A retry loop against the now-dead old origin would hang until timeout and then report a spurious error. Acknowledging the deliberate disconnect upfront is the correct pattern for any self-severing apply.

### 3. Validation is hand-rolled shell — `ipcalc.sh` is NOT the validator

`ipcalc.sh` on OpenWRT silently wraps invalid octets modulo 256 and exits 0. Device `jq` (1.6, compiled without Oniguruma) has no regex operators (`test()`, `match()`, `sub()`, `gsub()`). All octet range checks, prefix range enforcement, and network/broadcast-address rejection are therefore implemented in pure POSIX shell arithmetic in `lan_config.sh`.

**Why:** Relying on `ipcalc.sh` or `jq` regex would silently accept malformed input and write it to UCI.

### 4. Null bytes are invalid in shell source; SCP can mask this defect

A `\x00` (NUL) byte embedded in a `jq` filter string is rejected during shell source-parsing and corrupts text tooling on the device. The production deploy path (`cp -r` + `tr -d '\r'`) preserves null bytes verbatim. SCP-based transfers silently convert null bytes to newlines, so a script that contains a null byte may pass SCP-based on-device tests and fail in production.

**Safe pattern:** use a leading space as a sentinel in jq case patterns (e.g., `" not_object"`) — a `case` glob match catches the sentinel value identically and does not require a NUL. This is the pattern used in `lan_config.sh`'s `ipaddr` parser.

See also: [`docs/reference/busybox-shell-quirks.md`](../reference/busybox-shell-quirks.md) for the full BusyBox/deploy quirk catalog.

---

## Apply Flow

```
POST /network/lan_config.sh
  ↓
Validate ipaddr (pure-shell: 4 octets, range, no leading zeros, unicast)
Validate prefix (integer, 16–30)
Reject network/broadcast address of the resulting subnet
  ↓
Capture OLD_IP / OLD_MASK from current UCI
  ↓
uci set network.lan.ipaddr=<new>
uci set network.lan.netmask=<derived-from-prefix>
uci commit network
append_event "lan_address_changed"
  ↓
Compare new vs. old → set LAN_CHANGED=1 if ipaddr or netmask differs
  ↓
Emit HTTP response  ← MUST flush before the reload severs the connection
  (disconnect_window_seconds = 30 if LAN_CHANGED, 5 if no-op)
  (carrier_bounce = true if LAN_CHANGED, false if no-op)
  ↓
Fire-and-forget (one detached double-fork):
  sleep 1 → /etc/init.d/network reload         ← 1s ensures TCP buffer drains; br-lan rebinds L3
  ↓
  br-lan rebinds L3; old HTTP origin is dead

  [only if LAN_CHANGED=1, in the SAME fork]:
  /etc/init.d/dnsmasq reload                   ← immediate; new DHCP pool active before clients return
  ( sleep 15 → force every member up ) &       ← parallel safety watchdog (not the bounce)
  sleep 3 → for each member: ip link set <m> down   ← carrier down  ≈ +4s
  sleep 4 → for each member: ip link set <m> up     ← carrier up    ≈ +8s (modem floor)
               ↓
  upstream router re-runs DHCP → new gateway reachable from a browser ≈ +11–18s (~15s)
```

No reboot is issued. `network reload` re-reads UCI and rebinds `br-lan` without touching the cellular interface or other network sections. The carrier bounce restores link at ~+8 s (the deterministic modem floor); the upstream DHCP re-lease adds a few more seconds, putting real client reachability at ~+11–18 s.

---

## Frontend Files

| File | Purpose |
|---|---|
| `components/local-network/lan-config-card.tsx` | Card with gateway IP `Input` + CIDR prefix `Select` (/16–/30), `AlertDialog` confirm warning. On a successful apply it crossfades the form out and renders `LanReconnecting` in its place. |
| `components/local-network/lan-reconnecting.tsx` | Post-apply reconnect state: a determinate progress ring + spinner that **grace-waits, then reachability-probes the new address once per second**. On a real change (carrier bounce) it graces 8s and rides the backend's 30s window; a no-op graces 2s with a short ceiling. On the first successful probe it auto-navigates to `http://<new-ipaddr>/` (ref-guarded, fires once); if nothing answers by the ceiling it falls back to a manual warning banner (`applied_title` + `applied_body`/`applied_body_auto` + the address link). |
| `hooks/use-lan-config.ts` | Fetch/save hook; flips to `applied` state on success — no retry after apply. `LanApplied` shape carries `carrierBounce: boolean` (from `json.carrier_bounce ?? false`). |
| `types/lan-config.ts` | `LanConfigStatus`, `LanConfigSaveRequest`, `LanConfigSaveResponse` (includes `carrier_bounce?: boolean`) |

The card slots into `components/local-network/ethernet-status.tsx`, replacing the removed Wake-on-LAN card.

### 5. Auto-redirect uses an event-driven no-cors reachability probe

After the IP changes the device is reachable only at a **new origin**. A normal `fetch()` against it can't *read* the response (CORS) and the auth cookie is scoped to the old origin — but `LanReconnecting` doesn't need to read anything, only to know whether the device **answers**. It probes with `fetch(\`http://<new-ip>/?_qm=<ts>\`, { mode: "no-cors", redirect: "manual", signal })`, which **resolves on any HTTP response (opaque)** and **rejects on a connection failure** — a clean cross-origin reachability signal. Each probe is `AbortController`-bounded (1.5 s) so an unreachable host can't hang the poll. PNA doesn't block it because the serving page is itself on a private IP (private→private).

The redirect is **event-driven, not a fixed timer**: it navigates the instant a probe succeeds, so the typical felt experience is the real reconnect time (~15 s), not the ceiling. The ceiling is only the give-up point.

Timing is anchored to the measured apply sequence (invariant #1): the carrier bounce restores link at **+8 s** (modem floor) and the upstream DHCP tail puts client reachability at **~+11–18 s**. So on a real change `LanReconnecting` **graces 8 s** (no point probing while the modem is down) and uses the backend's **`disconnect_window_seconds` (30 s) as the ceiling** — long enough for the auto-redirect to win, with the manual banner only if reconnection genuinely overruns 30 s. A no-op apply (same IP, no bounce — only the `network reload` blip) graces 2 s with a short ceiling. A **10 s ceiling was tried and rejected**: it expires before the ~15 s reconnect and would force the manual fallback every time. The address link stays visible the whole time as a manual fallback (notably for static-IP clients that never auto-reconnect).

### i18n keys affected (all 5 locales: en, zh-CN, zh-TW, it, id)

| Key | Change |
|---|---|
| `lan_config.applied_body_auto` | **New.** Auto-reconnect body copy — shown when `carrier_bounce` is true. Tells the user that DHCP devices reconnect automatically; static-IP devices need a manual subnet move. |
| `lan_config.confirm_reconnect` | **Rewritten.** Previously implied a manual cable re-plug was always required. Now distinguishes: DHCP devices reconnect automatically; static-IP devices need manual reconfiguration. |
| `lan_config.applied_body` | Unchanged. Manual fallback body — shown when `carrier_bounce` is false (no-op apply). |
| `lan_config.reconnecting_title` | **New.** Heading shown during the grace + probe phase ("Reconnecting to the new address…"). |
| `lan_config.reconnecting_auto_note` | **New.** Small note under the address link telling the user the page will open the new address automatically. |
| `lan_config.reconnecting_opening` | **New.** Heading shown the instant a probe succeeds and the navigation fires ("Opening the new address…"). |

---

## Removed Feature: Wake-on-LAN

WoL was removed in the same change that introduced this feature. The `qmanager.network.disable_wol` UCI key is retired by the installer's cleanup function (`uci -q delete quecmanager.network.disable_wol`). The `qmanager_wol_fix` init.d service is pruned by the existing init.d prune loop on upgrade.

> ⚠️ WARNING: On already-installed devices upgraded without a clean install, the old `wol.sh` CGI file may persist at `/www/cgi-bin/quecmanager/network/wol.sh`. There is no CGI prune loop in the installer. The file is auth-gated and harmless, but it is a known artifact of the upgrade path.

The `wol_changed` event type has been **repurposed** to `lan_address_changed` across `events.json` (all 4 locales), `constants/network-events.ts`, and the `NetworkEventType` union in `types/modem-status.ts`.
