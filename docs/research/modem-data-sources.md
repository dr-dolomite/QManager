# Modem data sources beyond AT (RM551E, 2026-10-29)

A catalogue of data the modem exposes outside the AT commands QManager polls, found during the 2026-10-29 investigation. Research only: nothing here is wired into the product. Each row says how sure we are and what it could feed later.

Related: [`qmi-ca-per-carrier.md`](qmi-ca-per-carrier.md) (per-carrier LTE signal), [`qmi-nr-sweep.md`](qmi-nr-sweep.md) (NAS sweep, NR PCI), [`diag-dci-nr.md`](diag-dci-nr.md) (DIAG log packets), [`../features/qmi-lane.md`](../features/qmi-lane.md) (what the broker already reads).

## How it was probed

A throwaway QRTR client sent only Get requests from a compiled allow-list; nothing was set or configured. Messages were picked only when the device's IDL (`libqmiservices.so`, 47 service objects) showed a parameterless request **and** the message is known by name to be a read. Each service was first asked `0x001E` Get Supported Messages where it answers. A parameterless request is not always a read (resets and aborts take none either), so unnamed ones were not sent.

The modem serves about 60 QMI services on QRTR node 3. Without IDL (blind, not probed): 23 Thermal sensors has none in the library, 87 Smart Transmit, 88, 89, 92, 5025. IDL exists for the Quectel vendor service 227 (`quec_common_qmi`, 76 messages), but its semantics are unknown.

## Found and verified

| Data | Source | Check | Could feed |
|---|---|---|---|
| LTE per-carrier RSRP/RSRQ/RSSI (PCC + SCCs) | NAS `0x0043` TLVs `0x13` / `0x14` | 30/30 equal to QCAINFO | CA card, overview carriers, Prometheus per-carrier, QCAINFO gap-fill. See [`qmi-ca-per-carrier.md`](qmi-ca-per-carrier.md). |
| Thermal throttling state, per device | TMD (24) `0x0020` Get Mitigation Device List; `0x0022` Get Mitigation Level (TLV `0x01` = name) → `0x10` current, `0x11` requested | 31 devices listed, all at level 0 (cool modem). A non-zero level was not seen. | A "Thermal throttling" fact chip, Health Check, Prometheus. |
| Same throttling state, no QMI | sysfs `/sys/class/thermal/cooling_device*/{type,cur_state,max_state}` | Same device names (`modem_lte_dsc`, `pa_nr_sdr0_dsc`, `modem_tj`, `modem_pa`, …), all 0 | The cheaper route for the above: plain file reads in the poller. |
| Temperatures | sysfs thermal zones (`sdr0`, `mdmss-*`, `cpuss-*`, `sys-therm-*`, `xo-therm`, `ethphy-0`, `mmw_ific0`) | Already used (`parse_at.sh`; `AT+QTEMP` returns `ERROR` on this firmware) | (in use) |
| Supported LTE bands | DMS (2) `0x0045` Get Band Capabilities, TLV `0x12` (u16 count + u16 band list) | 32/32 equal to `policy_band` `lte_band` | A QMI fallback for the LTE list only. |
| Supported NR bands | DMS `0x0045` TLV `0x13` | One combined list of 36: includes n53 (in no AT list), lacks n259 (NR-DC list) | **Not** a replacement: AT keeps separate NSA / SA / NR-DC lists. |
| Model, manufacturer, revision, IMEI | DMS `0x0022` / `0x0021` / `0x0023` / `0x0025` | `RM551E-GL`, `Quectel`, `RM551EGL00AAR02A01M8G`, IMEI matches | About Device without AT. |
| Power state, operating mode | DMS `0x0026` / `0x002D` | `01 00` / `00` (online) | Watchdog / health checks. |
| Per-APN system status (which RAT serves each APN) | DSD (42) `0x0024` Get System Status | Lists `ims`, `internet`, `sos` with RAT/SO masks; not decoded field by field | APN page "carried on LTE / NR" hint. |
| SAR back-off state | SAR (17) `0x0002` Get RF SAR State | `0` (no back-off) | Health Check note if a SAR state is ever forced. |
| LTE per-antenna RSRP/RSRQ/RSSI | DIAG log `0xB193` | Matches `AT+QRSRP` | Already cheap on AT; see [`diag-dci-nr.md`](diag-dci-nr.md). |
| NR per-SSB-beam RSRP/RSRQ (RX0/RX1) | DIAG log `0xB97F` | Best beam = QENG NR RSRP | Beam view in Antenna Alignment (needs a native DCI client). |
| Modem subsystem state | sysfs `/sys/class/remoteproc/remoteproc0/state` (`4080000.remoteproc-mss`) | `running`; `recovery` = `enabled` | SSR detection for the watchdog, beside the QRTR reset signal. |
| IPA data-path counters | debugfs `/sys/kernel/debug/ipa/stats` (and `hw_stats`, `odlstats`, …) | Readable as `key=value` | Diagnostics page; offload health. |

## Leads, not proven

| Lead | What was seen | Next step |
|---|---|---|
| LTE MIMO layers vs timing advance in NAS `0x0043` | TLV `0x1E` = 2 and `0x2D` = 4 matched `lte_mimo_layers` 2 and `lte_time_advance` 4 on 20/20 reads. `0x1E` dropped to 1 twice during the CA run while stationary, which fits a rank change better than a TA change (libqmi names `0x1E` "timing advance"). | Pair both with `QNWCFG` while the rank or the TA changes. |
| `remoteproc0/quec_state` | A plain `cat` **blocks** (the read waits), so it looks like a Quectel event file that returns on a modem state change. | Read it only from a background reader with a timeout, across a real SSR. Never read it in the poller's foreground. |
| WDS (1) `0x0023` Get Channel Rates | TLV `0x10` holds non-zero u64 values on an unbound client; TLV `0x01` is zero. Units unknown. | Compare with the WDS packet-stat rates on the broker's bound client. |
| Thermal sensors service (23) | Supported messages are `0x0030`-`0x0033`, not the classic `0x0020`; there is no IDL on the device. | Skip: sysfs already gives the temperatures. |
| Quectel vendor service (227) | IDL present (76 messages); several parameterless requests. Semantics unknown, and some may be actions. | Map messages to AT handlers by decompiling `libql_atcop.so` before sending anything. |
| NR bandwidth | No QMI field found (`0x0031` TLV `0x12` lists the LTE anchor only). | Look again in SA. |
| NR neighbours / NR serving struct | `0x0043` TLVs `0x2F` / `0x30` absent in NSA. | Check in SA (needs the user's OK: the mode change drops data). |
| GNSS | QMI LOC (16) is present. Reading a fix means starting a session (a state change). | Out of scope unless a location feature is wanted. |
