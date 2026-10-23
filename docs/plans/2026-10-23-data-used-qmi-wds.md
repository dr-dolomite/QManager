# Data Used: source the counter from QMI WDS packet statistics

Status: proposal, awaiting OK. Large change (AT/QMI broker path).

## Evidence (RM551E, 2026-10-23, read-only)

| Check | Result |
|---|---|
| 39 min after boot, LAN client active | WDS (QCMAP IPv4) 432.1 MB down / 57.4 MB up; `AT+QGDCNT?` 433.6 / 57.7 (same counter, 1 s apart); `rmnet_ipa0` 2.3 / 4.8 MB |
| 100 MB download on the modem itself | WDS +104.1 MB (about 3 MB of it LAN noise), `rmnet_data0` +100.8 MB, `rmnet_ipa0` +40.6 MB |
| LAN client traffic | `br-lan` tx +5.7 KB in the same window: fully hardware-offloaded, invisible to every Linux netdev |
| IPv6 / ETH-PDU families | error 0x3: no IPv6 call (`rmnet_data0` is IPv4-only) |

Conclusion: the netdev source cannot be fixed. The modem-side per-call counter (WDS `0x0024`) counts LAN-offloaded and modem-local traffic. `AT+QGDCNT` reads the same counter on this firmware.

## How the platform reads it (headless Ghidra on the device binaries)

`QCMAP_CLI` → QCMAP msgr `0x2E` {mobile_ap_handle, ip_family} → `QCMAP_BackhaulWWANImpl::GetWWANStatistics` → `dsi_get_pkt_stats` → WDS `0x0024`, TLV `0x01` mask `0x3C3`, on the per-family WDS client that `dsi_netctrl` bound to the call with WDS `0x00A2` Bind Mux Data Port (endpoint type + id, mux id) and `0x00AF` Bind Subscription. QCMAP sums IPv4 and IPv6 for family 10. Phase 0's `0x0046` was an unbound client.

## Plan

1. **Broker (`qmanager_atd` 0.6.0).** A dedicated WDS client per IP family, bound broker-internally like `0x006C` (`BROKER_CONFIG`, never client-allowed): `0x00A2` with the embedded endpoint and the data call's mux id (`rmnet_data0` = 1 here; discovered, not hard-coded), `0x00AF` subscription 0, then `0x0024` mask `0x00C0` (bytes only, u64 TLVs `0x19`/`0x1A`). Re-bind on SSR and on a mux change. Publish `qmi_wds_{rx,tx}_bytes` + `qmi_wds_state` in `qmi.env` (2 s sampler, no extra request cost worth measuring). Never send `0x0086` Reset: the user reset stays a QManager-side baseline.
2. **Sampler (`data_used.sh`).** Source = WDS from `qmi.env` when `qmi_wds_state=up`; the existing delta / `cur < prev` rebase / boot_id / flush machinery is unchanged (the counter restarts with the call and on SSR). Fallback when the broker lacks it: `AT+QGDCNT?` is NOT used by default (field order varies by firmware); keep `rmnet_ipa0` with `source:"netdev"` so the UI can say the figure may undercount.
3. **CGI / UI.** Add `source` to `network/data_used.sh`; card unchanged except a quiet hint when `source` is `netdev`. Five catalogs.
4. **Lifecycle.** Broker binary + init.d already ship together; no new files. Schema stays 1 (add `source`, readers ignore unknown keys).

## Risks / to resolve first in build

- **Endpoint id discovery.** `dsi` gets the embedded endpoint at runtime (likely the rmnet_ipa `GET_EP_PAIR` ioctl or netmgr config). Decompile that path before writing the bind; wrong values must fail closed (no stats), never affect the call.
- **Bind is a client-local write.** It changes nothing for netmgrd/QCMAP, but it is a new non-Get message; tests pin it to `BROKER_CONFIG`.
- **Multi-PDN.** Only the default data call is counted (same as today). Additional PDNs would need one client per mux.
- **Cross-firmware.** WDS `0x0024` is Qualcomm-standard; verify on an RM520N before claiming it.

## Validation

Host: fake-QRTR tests for bind, stats decode, SSR re-bind, refusal of client access. Device: 100 MB modem-local download (WDS delta ≈ `rmnet_data0` delta), LAN-client download, WDS vs QCMAP_CLI parity over 10 min, broker CPU unchanged, one forced call drop only with your OK.

## Rollback

Broker 0.5.0 binary + previous `data_used.sh`; the state file format is compatible both ways.
