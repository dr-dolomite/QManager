# Custom DNS

Custom DNS lets users override the carrier-assigned resolver addresses on both IPv4 and IPv6 simultaneously. IPv4 addresses are delivered to LAN clients via dnsmasq `dhcp_option 6`; IPv6 addresses are announced to LAN clients via odhcpd's RA RDNSS (RFC 6106) and DHCPv6 option 23. A provider-preset dropdown (Cloudflare, Google, Quad9, AdGuard, ControlD) fills all four address fields at once; "Custom" exposes them for direct editing.

## Quick Reference

| Surface | Path |
|---|---|
| CGI endpoint | `network/dns.sh` |
| Hook | `hooks/use-dns-settings.ts` |
| Provider presets | `components/local-network/custom-dns/dns-providers.ts` |
| Component | `components/local-network/custom-dns/custom-dns-card.tsx` |
| Mode state file | `/etc/qmanager/dns_mode` |
| IPv6 UCI path | `dhcp.lan.dns` (list) |
| IPv4 UCI path | `dhcp.<nic>.dhcp_option` (value `"6,addr1,addr2"`) |
| Reboot required | No |

## Dual Delivery Paths

Two completely separate delivery mechanisms handle the two address families. They share a single CGI endpoint and a single enable/disable toggle, but the kernel paths are different.

### IPv4 — dnsmasq `dhcp_option`

IPv4 DNS is delivered as DHCP option 6 via dnsmasq.

On enable, the script writes:
```sh
uci set dhcp."$nic".dhcp_option="6,$dns1,$dns2,$dns3"
/etc/init.d/dnsmasq restart
```

On disable, it restores the carrier addresses read from `/tmp/resolv.conf.d/resolv.conf.auto` (IPv4-only file) and restarts dnsmasq.

The `$nic` value is either `lan` or `lan_bind4`, determined at each request by querying `AT+QMAP="MPDN_RULE"`. If any rule has `enabled=1`, the NIC is `lan_bind4`; otherwise it is `lan`. This matters because IP Passthrough creates a separate `dhcp.lan_bind4` UCI section that dnsmasq serves.

### IPv6 — odhcpd RA RDNSS + DHCPv6

IPv6 DNS is delivered via Router Advertisements (RFC 6106 RDNSS option) and DHCPv6 option 23, both served by odhcpd.

On enable, the script rebuilds the `dhcp.lan.dns` UCI list:
```sh
uci -q delete dhcp.lan.dns
uci add_list dhcp.lan.dns="$dns1v6"
uci add_list dhcp.lan.dns="$dns2v6"
uci commit dhcp
/etc/init.d/odhcpd reload
```

On disable, `uci -q delete dhcp.lan.dns` clears the list and `odhcpd reload` picks it up.

> ℹ️ NOTE: `odhcpd reload` sends SIGHUP. Using `restart` instead would briefly drop RA announcements, causing a gap in router advertisements to IPv6 clients. `reload` avoids this.

## Why IPv6 Always Targets `dhcp.lan`

The IPv6 list is hardcoded to `dhcp.lan`, never `dhcp.$nic`. odhcpd serves RA and DHCPv6 only from the `lan` section — it does not serve from `dhcp.lan_bind4` even when MPDN is active. Writing to `dhcp.lan_bind4.dns` would have no effect on RA/DHCPv6 delivery. IPv4 uses `dhcp.$nic` because dnsmasq reads it from whichever section is live.

## Why Disable Clears IPv6 But Does Not Restore Carrier IPv6

`/tmp/resolv.conf.d/resolv.conf.auto` is IPv4-only. The modem's firmware does not write carrier IPv6 nameservers there. Capturing carrier IPv6 would require parsing NDP router advertisements, which is not feasible in BusyBox shell at CGI runtime.

When the IPv6 list is cleared, clients fall back to using the router itself as the RDNSS (the default behavior before any DNS was configured), which typically resolves to the carrier-assigned IPv6 resolver via the modem's own upstream path. This is the same state as a factory-fresh device.

## IPv6 Address Validator (BusyBox Two-Stage Gate)

The frontend validates IPv6 structurally using a regex. The backend adds a BusyBox-compatible sanitization fence using two sequential `case` checks — BusyBox `sh` does not support regex in `[[ ]]`:

```sh
# Stage 1: must contain at least one colon (IPv6 mandatory)
case "$_dns6" in
    *:*) ;;
    *) cgi_error "invalid_dns" ...; exit 0 ;;
esac

# Stage 2: only hex digits and colons allowed
case "$_dns6" in
    *[!0-9a-fA-F:]*) cgi_error "invalid_dns" ...; exit 0 ;;
esac
```

Both IPv4 and IPv6 validation failures reuse the same `invalid_dns` error code. The `detail` field on the error response includes the offending address.

## The "At Least One Address" Guard

When enabling, the backend requires that at least one address across all five fields (`dns1`, `dns2`, `dns3`, `dns1v6`, `dns2v6`) is non-empty. You can configure IPv4-only (no IPv6 fields), IPv6-only (no IPv4 fields), or dual-stack. Submitting a mode-enabled request with all five fields blank returns `missing_field`.

## Provider Preset Model

`components/local-network/custom-dns/dns-providers.ts` defines the `DNS_PROVIDERS` array, the `DnsProvider` interface, and the `matchProvider` function.

Each `DnsProvider` carries exactly two IPv4 and two IPv6 addresses. The providers are:

| ID | Name | IPv4 Primary | IPv4 Secondary |
|---|---|---|---|
| `cloudflare` | Cloudflare | `1.1.1.1` | `1.0.0.1` |
| `google` | Google | `8.8.8.8` | `8.8.4.4` |
| `quad9` | Quad9 | `9.9.9.9` | `149.112.112.112` |
| `adguard` | AdGuard | `94.140.14.14` | `94.140.15.15` |
| `controld` | ControlD | `76.76.2.0` | `76.76.10.0` |

The sentinel `CUSTOM_PROVIDER_ID = "custom"` is used when no preset matches.

### `matchProvider` Round-Trip Detection

When the card loads, it calls `matchProvider(dns1, dns2, dns3, dns1v6, dns2v6)` to detect whether the currently-saved addresses correspond to a known preset. Detection rules:

- If `dns3` is non-empty, returns `"custom"` immediately — presets only define two IPv4 addresses.
- Iterates `DNS_PROVIDERS`, comparing `dns1`/`dns2` exactly to the preset's IPv4 pair and `dns1v6`/`dns2v6` case-insensitively (via `normV6`) to the IPv6 pair.
- Returns the matching provider's `id`, or `"custom"` if none match.

This is order-sensitive: `dns1` maps to the primary, `dns2` to the secondary. If the user has swapped them, `matchProvider` returns `"custom"`.

Selecting a provider in the card fills all four fields and shows a read-only address summary. Switching to "Custom" reveals editable inputs.

## Mode State File

`/etc/qmanager/dns_mode` contains the literal string `enabled` or `disabled`. It is read by the GET handler to populate the `mode` field in the response. It is written atomically (`echo "enabled" > /etc/qmanager/dns_mode`) after UCI commit succeeds.

The file is created by the first POST; a fresh install with no prior POST will have no file. The GET handler defaults to `"disabled"` if the file is absent (`cat ... || echo "disabled"`).

## Known Issue: IPv4 Is Fragile When MPDN Is Active

When an MPDN rule is active, `get_nic()` returns `lan_bind4`. The IPv4 DNS is then written to `dhcp.lan_bind4.dhcp_option`. However, the `lan_dns` dnsmasq instance binds to `interface='lan'` — it does not automatically serve the `lan_bind4` section. If `dhcp.lan_bind4` does not exist in UCI, the `uci show` guard in the enable path creates it as a bare section, but dnsmasq may not pick up the option correctly depending on how the bind4 interface is bridged.

This is a pre-existing limitation, not introduced by the IPv6 work. The IPv6 path sidesteps it entirely by hardcoding `dhcp.lan`. The IPv4 MPDN path is a latent bug — noticeable only when MPDN is active and custom IPv4 DNS is enabled simultaneously. Noted here for the next person who touches this script.

## Hook Contract

`hooks/use-dns-settings.ts` exports `useDnsSettings()` returning:

| Field | Type | Description |
|---|---|---|
| `data` | `DnsSettingsData \| null` | Fetched state; `null` before first load |
| `isLoading` | `boolean` | True during initial fetch |
| `isSaving` | `boolean` | True during save |
| `error` | `string \| null` | Resolved error message |
| `saveDns` | `(SaveDnsParams) => Promise<boolean>` | Apply new settings; silent re-fetch on success |
| `refresh` | `() => void` | Re-fetch without showing the loading state |

`DnsSettingsData` parses `currentDNS` and `currentDNS6` (both comma-separated strings from the backend) into individual `dns1`/`dns2`/`dns3` and `dns1v6`/`dns2v6` fields. `SaveDnsParams` mirrors the POST body exactly (all six address fields + `mode` + `nic`).
