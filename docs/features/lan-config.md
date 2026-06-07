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
# Always: rebind br-lan L3 address
( ( sleep 1 && /etc/init.d/network reload ) </dev/null >/dev/null 2>&1 & )

# Only when IP or netmask changed (LAN_CHANGED=1):
( (
    sleep 2 && /etc/init.d/dnsmasq reload
    sleep 13 &&
    for m in $LAN_MEMBERS; do
        ip link set "$m" down
        sleep 4
        ip link set "$m" up
    done
) </dev/null >/dev/null 2>&1 & )
```

The 1-second sleep before `network reload` ensures HTTP bytes have flushed before `br-lan` rebinds. The `dnsmasq reload` at +2 s applies the new DHCP pool to `dnsmasq` before the bounce brings clients back up. The carrier bounce fires at +15 s (after the independent `sleep 13` following `dnsmasq reload`) via a separate detached double-fork watchdog.

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

**dnsmasq reload:** Immediately before the bounce watchdog arms, the CGI reloads dnsmasq (instance `lan_dns`, leasefile `/tmp/data/dhcp.leases.lan`). This ensures the daemon is already serving the new DHCP pool and scope when bounced clients send their DISCOVER. Without this step, clients could receive an address from the old pool during the window between `network reload` and the first dnsmasq restart.

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
Fire-and-forget (double-fork, independent of LAN_CHANGED):
  ( sleep 1 && /etc/init.d/network reload )   ← always; 1s ensures TCP buffer drains
  ↓
  br-lan rebinds L3; old HTTP origin is dead

  [only if LAN_CHANGED=1 — separate detached double-fork]:
  sleep 2 → /etc/init.d/dnsmasq reload        ← new DHCP pool active before clients return
  sleep 13 → for each bridge member in /sys/class/net/$LAN_DEV/brif:
               ip link set <m> down
               sleep 4
               ip link set <m> up             ← carrier bounce → upstream DHCP re-discovery
```

No reboot is issued. `network reload` re-reads UCI and rebinds `br-lan` without touching the cellular interface or other network sections. The carrier bounce is a separate background watchdog that fires ~15 s after the response — independent from the `network reload` subprocess, so the timing is not affected by how long the reload takes.

---

## Frontend Files

| File | Purpose |
|---|---|
| `components/local-network/lan-config-card.tsx` | Card with gateway IP `Input` + CIDR prefix `Select` (/16–/30), `AlertDialog` confirm warning, post-apply persistent `Alert` banner. Shows `lan_config.applied_body_auto` copy when `carrierBounce` is true (auto-reconnect messaging); falls back to `lan_config.applied_body` (manual cable re-plug copy) when false. |
| `hooks/use-lan-config.ts` | Fetch/save hook; flips to `applied` state on success — no retry after apply. `LanApplied` shape carries `carrierBounce: boolean` (from `json.carrier_bounce ?? false`). |
| `types/lan-config.ts` | `LanConfigStatus`, `LanConfigSaveRequest`, `LanConfigSaveResponse` (includes `carrier_bounce?: boolean`) |

The card slots into `components/local-network/ethernet-status.tsx`, replacing the removed Wake-on-LAN card.

### i18n keys affected (all 5 locales: en, zh-CN, zh-TW, it, id)

| Key | Change |
|---|---|
| `lan_config.applied_body_auto` | **New.** Auto-reconnect body copy — shown when `carrier_bounce` is true. Tells the user that DHCP devices reconnect automatically; static-IP devices need a manual subnet move. |
| `lan_config.confirm_reconnect` | **Rewritten.** Previously implied a manual cable re-plug was always required. Now distinguishes: DHCP devices reconnect automatically; static-IP devices need manual reconfiguration. |
| `lan_config.applied_body` | Unchanged. Manual fallback body — shown when `carrier_bounce` is false (no-op apply). |

---

## Removed Feature: Wake-on-LAN

WoL was removed in the same change that introduced this feature. The `qmanager.network.disable_wol` UCI key is retired by the installer's cleanup function (`uci -q delete quecmanager.network.disable_wol`). The `qmanager_wol_fix` init.d service is pruned by the existing init.d prune loop on upgrade.

> ⚠️ WARNING: On already-installed devices upgraded without a clean install, the old `wol.sh` CGI file may persist at `/www/cgi-bin/quecmanager/network/wol.sh`. There is no CGI prune loop in the installer. The file is auth-gated and harmless, but it is a known artifact of the upgrade path.

The `wol_changed` event type has been **repurposed** to `lan_address_changed` across `events.json` (all 4 locales), `constants/network-events.ts`, and the `NetworkEventType` union in `types/modem-status.ts`.
