# IP Passthrough (IPPT)

IP Passthrough bridges one LAN device directly to the modem's WAN IP, bypassing NAT so that device gets the modem's public IP address. It can operate over Ethernet or USB and supports optional NAT wrapping and DNS offloading to the carrier.

## Quick Reference

| Item | Value |
|---|---|
| Route | `/local-network/ip-passthrough` |
| Component | `components/local-network/ip-passthrough/ip-passthrough-card.tsx` |
| Hook | `hooks/use-ip-passthrough.ts` |
| Types | `types/ip-passthrough.ts` |
| CGI | `scripts/www/cgi-bin/quecmanager/network/ip_passthrough.sh` |
| Config file | `/etc/qmanager/ippt_config.json` (authoritative, written by POST) |
| Boot cache | `/tmp/qmanager_status.json` `.device.ippt_*` fields (poller-populated at boot) |
| Boot parsers | `parse_ippt_nat`, `parse_ippt_usbnet`, `parse_ippt_dhcpv4dns`, `parse_ippt_mpdn_rule` in `scripts/usr/lib/qmanager/parse_at.sh` |
| Reboot? | Yes — apply triggers an immediate reboot (2-second deferred fork) |

## Data Flow

### Two Read Surfaces

GET reads from two sources in priority order:

1. **`/etc/qmanager/ippt_config.json`** — written atomically (temp + `mv`) by every successful POST. This is the authoritative source after first apply. Fields: `mode`, `mac`, `nat`, `usb_mode`, `dns_proxy`.
2. **`/tmp/qmanager_status.json` `.device.ippt_*`** — fallback when the config file doesn't exist (first boot before any apply). Populated once at boot by the poller calling the `parse_ippt_*` functions.

The two sources must stay in agreement. After a successful POST, the config file is written before the reboot fires, so GET after reboot reads the config file and reflects the applied settings exactly.

### Boot Parsers

The poller reads IPPT state at boot via a single concatenated `qcmd` batch:

```
+QMAP="MPDN_RULE";+QMAP="IPPT_NAT";+QCFG="usbnet";+QMAP="DHCPV4DNS"
```

Four parser functions in `parse_at.sh` split that combined output into individual fields:

| Parser | Output variable | Default |
|---|---|---|
| `parse_ippt_mpdn_rule` | `boot_ippt_mode`, `boot_ippt_mac` | `"disabled"`, `""` |
| `parse_ippt_nat` | `boot_ippt_nat` | `"1"` (WithNAT) |
| `parse_ippt_usbnet` | `boot_ippt_usbnet` | `"1"` (ECM) |
| `parse_ippt_dhcpv4dns` | `boot_ippt_dhcpv4dns` | `"disabled"` |

## CGI Endpoint

**`GET/POST /cgi-bin/quecmanager/network/ip_passthrough.sh`**

### GET

Returns current IPPT configuration.

**Response:**

```json
{
  "success": true,
  "passthrough_mode": "eth",
  "target_mac": "AA:BB:CC:DD:EE:FF",
  "ippt_nat": "1",
  "usb_mode": "1",
  "dns_proxy": "disabled"
}
```

**Field values:**

| Field | Values |
|---|---|
| `passthrough_mode` | `"disabled"` / `"eth"` / `"usb"` |
| `target_mac` | MAC string; `"FF:FF:FF:FF:FF:FF"` = automatic; `""` = none |
| `ippt_nat` | `"0"` = WithoutNAT, `"1"` = WithNAT |
| `usb_mode` | `"0"` = rmnet, `"1"` = ecm, `"2"` = mbim, `"3"` = rndis |
| `dns_proxy` | `"enabled"` / `"disabled"` |

The GET handler applies a `case` guard after reading — corrupted or out-of-range values are silently reset to the default before responding.

### POST `action=apply`

Applies all settings, then reboots the modem. There is no separate reboot action.

**Request:**

```json
{
  "action": "apply",
  "passthrough_mode": "eth",
  "target_mac": "AA:BB:CC:DD:EE:FF",
  "ippt_nat": "0",
  "usb_mode": "1",
  "dns_proxy": "disabled"
}
```

`target_mac` is required (and must be `XX:XX:XX:XX:XX:XX` format) when `passthrough_mode` is `"eth"` or `"usb"`. It is ignored when `passthrough_mode` is `"disabled"`.

**Success response:**

```json
{ "success": true }
```

The response is emitted **before** the reboot fires. The modem runs `( ( sleep 2 && reboot ) </dev/null >/dev/null 2>&1 & )` — a double-fork orphan — so the HTTP response always reaches the client.

> ⚠️ WARNING: Because the app runs on the modem, the reboot kills any in-flight connections. The hook returns `true` on `{ "success": true }` and the UI should transition to a "rebooting" state immediately. Do not retry — a second POST will race the reboot.

**Error codes:**

| Code | Meaning |
|---|---|
| `missing_action` | `action` field missing from POST body |
| `invalid_action` | `action` is not `"apply"` |
| `invalid_passthrough_mode` | `passthrough_mode` not in `{disabled, eth, usb}` |
| `missing_target_mac` | `target_mac` absent when mode is `eth` or `usb` |
| `invalid_target_mac` | MAC doesn't match `XX:XX:XX:XX:XX:XX` |
| `invalid_ippt_nat` | `ippt_nat` not `0` or `1` |
| `invalid_usb_mode` | `usb_mode` not in `{0, 1, 2, 3}` |
| `invalid_dns_proxy` | `dns_proxy` not `enabled` or `disabled` |
| `mpdn_rule_failed` | MPDN_rule AT command returned ERROR |
| `ippt_nat_failed` | IPPT_NAT AT command returned ERROR |
| `usbnet_failed` | QCFG usbnet AT command returned ERROR |
| `dhcpv4dns_failed` | DHCPV4DNS AT command returned ERROR |
| `ip_passthrough_locked_by_verizon_profile` | Active Custom SIM Profile has `.mno == "Verizon"` |

### Apply Pipeline (5 steps)

Steps run sequentially with a 0.2 s gap between AT commands. A failure at any step returns an error and exits — the reboot does not fire:

1. **MPDN_rule** — `AT+QMAP="MPDN_rule",0` (disable) or `AT+QMAP="MPDN_rule",0,1,0,<mode>,1,"<mac>"` (enable ETH mode=1, USB mode=3). When disabling, also sends `AT+QMAPWAC=1` (WAC reset) — QMAPWAC errors are logged as warnings, not failures.
2. **IPPT_NAT** — `AT+QMAP="IPPT_NAT",<0|1>`
3. **usbnet** — `AT+QCFG="usbnet",<0-3>`
4. **DHCPV4DNS** — `AT+QMAP="DHCPV4DNS","enable|disable"` (note: modem accepts `"enable"`/`"disable"`; the cache and GET response normalize to `"enabled"`/`"disabled"`)
5. **Config write** — atomic temp-file + `mv` to `/etc/qmanager/ippt_config.json`; then `cgi_success` + deferred reboot fork

> ⚠️ WARNING: The apply pipeline has no rollback. If step 2 (IPPT_NAT) fails after step 1 (MPDN_rule) already succeeded, the modem is left in a partially-applied state. The error is returned and no reboot fires. A subsequent apply from the UI will re-send all steps and can recover the partial state.

## MPDN_RULE Field Layout

`AT+QMAP="MPDN_RULE"` returns comma-separated fields (response prefix `+QMAP:`):

```
+QMAP: "MPDN_rule",<rule_num>,<profileID>,<VLAN_ID>,<IPPT_mode>,<auto_connect>[,"<IPPT_info>"]
```

| Field position | Name | Relevant values |
|---|---|---|
| `$1` | `"MPDN_rule"` (literal) | — |
| `$2` | `rule_num` | `0` = rule 0 (only one QManager manages) |
| `$3` | `profileID` | profile index |
| `$4` | `VLAN_ID` | VLAN tag |
| `$5` | `IPPT_mode` | `0`=disabled, `1`=ETH, `2`=WiFi (unused), `3`=USB, `4`=Any |
| `$6` | `auto_connect` | |
| `$7` | `IPPT_info` (quoted) | MAC address of the passthrough target |

`parse_ippt_mpdn_rule` anchors on `'"MPDN_rule",0,'` (rule 0 only) and reads `$5` for mode, `$7` (quotes stripped via `gsub`) for the MAC.

## Verizon Profile Lock

If a Custom SIM Profile with `.mno == "Verizon"` is active, POST returns `ip_passthrough_locked_by_verizon_profile` and exits without touching any AT command. The check uses the literal string `"Verizon"` (not the preset id `"vzw"`). Changing the Verizon preset label requires updating every `[ "$_x_mno" = "Verizon" ]` shell guard across the codebase — see [`docs/features/custom-sim-profiles.md`](custom-sim-profiles.md).

## The `qcmd` Trailing-Comma Anchor Invariant

> ⚠️ WARNING: This is the single most important invariant for anyone modifying a boot parser that reads from a concatenated AT batch.

When `qcmd` runs a semicolon-concatenated command string like:

```
+QMAP="MPDN_RULE";+QMAP="IPPT_NAT";+QCFG="usbnet";+QMAP="DHCPV4DNS"
```

it echoes the entire sent command back as a **single comma-less line** that contains every keyword in the batch. That echo line appears **before** the actual response lines. Example:

```
+QMAP="MPDN_RULE";+QMAP="IPPT_NAT";+QCFG="usbnet";+QMAP="DHCPV4DNS"
+QMAP: "MPDN_rule",0,1,0,1,1,"AA:BB:CC:DD:EE:FF"
+QMAP: "IPPT_NAT",1
+QCFG: "usbnet",1
+QMAP: "DHCPV4DNS","disable"
OK
```

The echo line contains `IPPT_NAT`, `usbnet`, and `DHCPV4DNS` as substrings — a bare `grep "IPPT_NAT"` would match the echo, not the response. The pre-fix parsers fell into this trap and always returned the awk default (`0` or empty), which coincidentally matched the modem's factory defaults.

**The rule:** anchor on the value-bearing substring that only exists on response lines. For `+QMAP:` responses, that means the keyword followed by a trailing comma (the response prefix is `"KEYWORD",value`; the echo has no commas between keywords). For example:

```sh
# WRONG — matches the comma-less echo line
nat_line=$(printf '%s\n' "$raw" | grep '"IPPT_NAT"')

# CORRECT — trailing comma only exists on the response line
nat_line=$(printf '%s\n' "$raw" | grep '"IPPT_NAT",')
```

This mirrors the pattern already used in `parse_ippt_mpdn_rule` (`grep '"MPDN_rule",0,'`) and is the same class of hazard documented for band locking under `qcmd` echo-line grep-anchor invariant in [`docs/features/band-locking.md`](band-locking.md).

**DHCPV4DNS note:** the response value is `"enable"` or `"disable"` (no trailing `d`). The parser normalizes to `"enabled"`/`"disabled"` for the cache and GET response. The POST accepts `"enabled"`/`"disabled"` and converts back to `"enable"`/`"disable"` for the AT command.

## Known Limitations

- **No rollback on partial apply.** See the Apply Pipeline section above.
- **Boot cache is stale after a manual AT change** (e.g. from another tool). The config file takes priority on GET, so as long as QManager applied the settings itself the config file is authoritative. If IPPT was configured outside QManager, the config file won't exist and the boot cache will correctly reflect modem state.
