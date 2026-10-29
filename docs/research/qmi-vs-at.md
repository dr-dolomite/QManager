# QMI NAS vs AT telemetry: spike results (RM551E)

**Date:** 2026-10-16. **Device:** RM551E-GL (SDXPINN, aarch64, OpenWrt 23.05.4, musl), 5G-NSA on PLMN 515-03, LTE B1 + n41.
**Scope:** read-only. No modem config writes, no CFUN, no reboot. No production code changed.

## TL;DR

1. **Most of the AT latency is a `qcmd` bug, not the AT lane or the lock design.** Every `qcmd` call takes about **1,000 ms**, while the same AT command over the same lane under the same lock takes **5–8 ms**. The extra second comes from BusyBox `timeout`: its watcher process inherits the lock FD 9 and keeps `/var/lock/qmanager.lock` held for about 1 s after `atcli_smd11` exits. Measured below. The poller makes several `qcmd` calls per 2 s cycle, so the lock is busy most of the time, which explains the 52 lock timeouts in 47 minutes.
2. **QMI NAS over QRTR works and is very fast.** Requests take 0.2–1 ms, there is no lock, and it runs alongside netmgrd, QCMAP and ql_nw_service without disturbing them. But it **does not cover the hot-path fields QManager relies on most**: per-antenna RSRP/RSRQ/SINR (`Get Tx Rx Info` returns NOT_SUPPORTED), NR PCI in NSA (corrected 2026-10-29: it is in `0x004D` TLV `0x54`, see [`qmi-nr-sweep.md`](qmi-nr-sweep.md)), NR band, CA SCC list (in EN-DC), MIMO layers, NR timing advance, TX power and CQI.
3. **Recommendation: path (a), preceded by a one-line `qcmd` fix.** Details in [Recommendation](#recommendation).

## How the spike was run

- **No downloads (per user decision).** The device ships libqmi **1.32.4**, QRTR-enabled. Its `libqmi-glib.so.5.9.0` is built with the **basic message collection**: it exports no `get_cell_location_info`, `get_tx_rx_info` or `get_lte_cphy_ca_info` symbols. So a `qmicli` built against the device's own libqmi (for example the OpenWrt `qmi-utils` package) **would not have had** `--nas-get-cell-location-info`, `--nas-get-tx-rx-info` or `--nas-get-lte-cphy-ca-info`. Only a fully self-built libqmi would.
- Instead, I wrote a small **stdlib-only Go QRTR/QMI client** and cross-compiled it on the dev PC with the Go toolchain already installed there (`GOOS=linux GOARCH=arm64 CGO_ENABLED=0`, static, 1.8 MB). It went to `/tmp/qmiprobe` only, SHA-256 verified. Source: [`qmi-spike/main.go`](qmi-spike/main.go).
  - It opens `AF_QIPCRTR` (42) `SOCK_DGRAM`, finds NAS (service 3) through the QRTR name-service lookup (node 3, port 137), and sends raw QMI requests (no QMUX framing over QRTR). It decodes TLVs by hand.
  - It sends only *Get* messages, checked against a hard-coded whitelist (`0x0020 0x0024 0x0031 0x0034 0x0043 0x004D 0x004F 0x005A 0x00AC`).
  - `qmiprobe time CMD…` is a millisecond wall-clock wrapper. BusyBox `date` has no `%N`.
- The AT side was timed two ways:
  - `qcmd` (the production path);
  - `flock /var/lock/qmanager.lock atcli_smd11 …` (the raw lane, holding the **real** lock).

## QRTR service list (node 3 = modem)

NAS 3 (port 137), WDS 1, DMS 2, QOS 4, WMS 5, AUTH 7, AT 8, Voice 9, CAT 10, UIM 11, PBM 12, LOC 16, IMSS 18, PDC 36, Thermal 23/24, DSD 42, IMSA 33, DFS 48, plus about 30 vendor and data services (full list: run `qrtr-lookup` on the device). The AP-side name server is `qrtr-ns`.

## Coverage matrix

Latency columns:
- **qcmd:** per production call. Each value is the median of 8 calls.
- **raw:** `flock` + `atcli_smd11`, median of 8 calls.
- **QMI:** per request, p50 / p95 over n=200 back-to-back requests on one socket.

| Field | AT source (sample) | QMI message → TLV (sample) | Match | Latency AT: qcmd / raw | Latency QMI: p50 / p95 |
|---|---|---|---|---|---|
| LTE RSRP | `QENG servingcell` (−85) | `0x004F` Get Signal Info → 0x14 `rsrp` i16 dBm (−86) | **yes** (±1 dB) | 1015 / 6.4 ms | 0.17 / 0.57 ms |
| LTE RSRQ | QENG (−7…−10) | 0x004F → 0x14 `rsrq` i8 dB (−7). Also `0x0043` 0x13 per cell in 0.1 dB (−6.5) | **yes** | ″ | ″ |
| LTE RSSI | QENG (−55…−58) | 0x004F → 0x14 `rssi` i8 (−58) | **yes** | ″ | ″ |
| LTE SINR | QENG (23); QSINR 4-ch (22–25) | 0x004F → 0x14 `snr` i16 in 0.1 dB (24–26.4) | **partial**: about 1–3 dB higher than QENG; different definition or averaging | ″ | ″ |
| NR5G RSRP | QENG NR5G-NSA (−76…−82); QRSRP NR 4-ch | 0x004F → 0x17 `rsrp` i16 (−78…−85) | **partial**: within 1–9 dB, refreshes slowly (looks cached) | ″ | ″ |
| NR5G SINR | QENG (28–32) | 0x004F → 0x17 `snr` 0.1 dB (26–29.5). **0x8000 "invalid" sentinel seen in 2 of 6 samples** | **partial** | ″ | ″ |
| NR5G RSRQ | QENG (−10) | 0x004F → 0x18 `rsrq` i16 (−11) | **yes** | ″ | ″ |
| MCC / MNC | QENG (515 / 03) | `0x0043` Get Cell Location Info → 0x13 PLMN (515-03). Also `0x004D` and `0x0024` | **yes** | ″ | 0.28 / 1.13 ms |
| TAC | QENG (BF82) | 0x0043 → 0x13 `tac` (0xBF82). Also 0x0024 TLV 0x24 | **yes** | ″ | ″ |
| LTE cell ID | QENG (22B5066) | 0x0043 → 0x13 `global_cell_id` (0x22B5066). Also 0x0024 TLV 0x1D | **yes** | ″ | ″ |
| LTE PCI | QENG / QCAINFO (295) | 0x0043 → 0x13 `serving_cell_id` (295) | **yes** | ″ | ″ |
| LTE EARFCN | QENG (150) | 0x0043 → 0x13 u16 (150) and 0x27 u32 (150). `0x0031` RF Band Info → 0x01 / 0x11 | **yes** | ″ | 0.18 / 0.56 ms |
| LTE band | QENG (1) / QCAINFO "LTE BAND 1" | 0x0031 → 0x01 `active_band_class` 120 (= E-UTRA band 1, i.e. class − 119) | **yes** (needs a map) | ″ | ″ |
| LTE bandwidth | QENG UL/DL enum (5, 5); QCAINFO 100 RB | 0x0031 → 0x12 bandwidth enum 5 (= 20 MHz). Also 0x0043 TLV 0x26 = 5 | **yes** (DL; UL not separate) | ″ | ″ |
| LTE intra neighbours | `QENG neighbourcell` (PCI 295, 254) | 0x0043 → 0x13 cell list (PCI, RSRQ, RSRP, RSSI, srxlev) | **partial**: QMI listed only the serving PCI 295; AT also listed 254 | 1016 / ~6 ms | 0.28 / 1.13 ms |
| LTE inter neighbours | QENG neighbourcell (none) | 0x0043 → 0x14 (0 freqs) | n/a (none on either side). **Corrected 2026-10-29:** with CA, TLV `0x14` carries each LTE SCC frequency with its RSRP/RSRQ/RSSI, equal to QCAINFO ([`qmi-ca-per-carrier.md`](qmi-ca-per-carrier.md)) | ″ | ″ |
| NR5G ARFCN | QENG / QCAINFO SCC (528030) | 0x0043 → TLV **0x2E** u32 (528030). Also `0x004D` Sys Info → TLV 0x60 | **yes** (TLV IDs found empirically) | ″ | ″ |
| NR5G PCI (NSA) | QENG / QCAINFO (262) | none found in 0x0043, 0x004D or 0x0024. **Corrected 2026-10-29:** `0x004D` TLV `0x54` u16 = 262, one of the undecoded TLVs below ([`qmi-nr-sweep.md`](qmi-nr-sweep.md)) | **no** at the time; candidate now | — | — |
| NR5G band | QCAINFO "NR5G BAND 41" | not in 0x0031 (only the LTE anchor is listed). Can be derived from the ARFCN with a band table | **no** (derivable only) | — | — |
| CA component list (PCC/SCC) | `QCAINFO` (PCC B1 + SCC n41) | `0x00AC` Get LTE CPHY CA Info → **QMI_ERR_INFO_UNAVAILABLE (0x4A)** in EN-DC (no LTE SCell). This message covers LTE SCells only and never NR SCCs | **no** for NR SCC; LTE-CA untested | 1014 / 6.3 ms | 0.19 ms (error) |
| Per-antenna RSRP / RSRQ / SINR, LTE (4 ch) | `QRSRP;+QRSRQ;+QSINR` | `0x005A` Get Tx Rx Info (radio = LTE) → **QMI_ERR_NOT_SUPPORTED (0x5E)** | **no** | 1015 / 6.4 ms | 0.20 ms (error) |
| Per-antenna, NR5G (4 ch) | same | 0x005A (radio = NR5G) → **NOT_SUPPORTED (0x5E)** | **no** | ″ | ″ |
| TX power | QENG (170–190) | 0x005A TLV 0x12 → NOT_SUPPORTED | **no** | — | — |
| CQI | QENG (15) | none | **no** | — | — |
| LTE timing advance | `QNWCFG "lte_time_advance"` (1,4) | no confirmed TLV. Candidates in 0x0043: **0x2D** u32 = 4 and 0x1E u32 = 2. TA stayed constant during the test, so neither could be told apart | **unconfirmed** | 1015 ms (poller group) | — |
| NR5G timing advance | `QNWCFG "nr5g_time_advance"` (1,4096,0) | none | **no** | — | — |
| LTE MIMO layers | `QNWCFG "lte_mimo_layers"` (1,2) | none confirmed (0x0043 TLV 0x1E = 2 is a coincidental candidate) | **no** | — | — |
| NR5G MIMO layers | `QNWCFG "nr5g_mimo_layers"` (SA only) | none | **no** | — | — |
| Serving system / RAT | `COPS?`, QENG | `0x0024` Get Serving System (registered, LTE, roaming, SPN "SMART") and `0x004D` Sys Info | **yes** (not compared field by field) | — | 0.22 ms |

Unknown TLVs seen and left undecoded:
- in 0x0043: 0x1E (2), 0x2A (3), 0x2C (1), 0x2D (4), 0x32 (ASCII "51503" + 0xFF);
- in 0x004D: 0x44 (3), 0x46 (4) and about 20 others.

The device's libqmi carries no definitions for these, so their names can't be confirmed from on-device data.

**Cached values:** QMI `Get Signal Info` looked cached. LTE RSRP/RSSI stayed exactly −92 / −66 across 6 samples over 24 s, while AT values moved. A production QMI poller should register `Config Signal Info v2` and consume indications instead of polling, and that registration is a config write the spike deliberately avoided.

## Latency detail

| Path | Measurement |
|---|---|
| `qcmd 'AT+QRSRP;+QRSRQ;+QSINR'` | 39.75, then 1011.95…1025.33 ms (8 calls) |
| `qcmd 'AT+QENG="servingcell"'` / `AT+QCAINFO` / `AT+QENG="neighbourcell"` | 1011–1018 ms, every call |
| raw `flock <real lock> atcli_smd11 …` (same 4 commands) | 5.5–8.5 ms |
| QMI per request (n=200 each) | sig p50 0.17 / p95 0.57 / max 1.03 ms · cell 0.28 / 1.13 / 2.68 · rf 0.18 / 0.56 / 1.70 · sysinfo 0.19 / 0.72 / 0.96 |
| QMI whole process (exec + NS lookup + sig + cell + rf) | 5.4–16.8 ms |
| QMI burst: 800 requests | 301 ms total, 0 failures |

### The 1-second `qcmd` floor (root cause)

`qcmd` runs `( flock_wait 9 …; timeout 300 atcli_smd11 "$CMD" ) 9>"$LOCK_FILE"` inside `$(…)`. BusyBox `timeout` forks a watcher that polls once per second. The watcher **inherits FD 9**, so the flock stays held until it notices the child has exited. Measured with the real lock:

| Variant (inside `$( ( flock -x 9; … ) 9>/var/lock/qmanager.lock )`) | Elapsed |
|---|---|
| `timeout 300 atcli_smd11 'AT+CSQ'` (current `qcmd` shape) | 986–1000 ms (the occasional 94 ms or 4 s is lock wait behind the poller) |
| `timeout 300 atcli_smd11 'AT+CSQ' 9>&-` | **27–38 ms** |
| `atcli_smd11 'AT+CSQ'` (no `timeout`) | 16–46 ms |

Lock-hold probe for one `flock … timeout 300 atcli_smd11 AT+CSQ`, where the AT exchange itself takes about 6 ms:

| Time after start | Lock |
|---|---|
| t + 0.2 s | HELD |
| t + 0.7 s | HELD |
| t + 1.2 s | FREE |

So every AT call keeps the modem lock for about 1 s. The poller's Tier-1 QENG + QRSRP calls alone keep it held for roughly half of each 2 s cycle (estimated from the call count, not measured). Any CGI `qcmd` then queues behind them, which produces the "2–3 s average" and the `Lock acquisition failed` cascades.

## Concurrency check (QMI clients alongside system daemons)

Before and after the 800-request burst:
- netmgrd (10171/10174), QCMAP_ConnectionManager (2802/2805) and ql_nw_service (13102) had **the same PIDs**.
- **No new QMI, NAS, netmgr or qcmap error lines** appeared in `logread`.
- `rmnet_data0` stayed up with its IPv4 address.
- The poller kept reporting `modem_reachable: true`, 5G-NSA.

QRTR is multi-client by design. Each socket is its own QMI client, and no CTL client-ID allocation is involved.

**Incident during the spike:** one AT timing test briefly used a scratch lock file instead of `/var/lock/qmanager.lock`. A few `AT+CSQ` reads collided with the poller on smd11: two `Connection reset by peer` errors and one 16.7 s stall. The poller recovered on its own (`modem_reachable: true` afterwards), and all later tests used the real lock. Lesson: **never open smd11 outside `/var/lock/qmanager.lock`.** The lane is not safe to share.

## Recommendation

**Path (a): persistent AT broker, but only after the `qcmd` fix, which may make it unnecessary. Defer (b).**

0. **First, fix `qcmd`'s `timeout` FD leak** (Tier 1, single shell file, plus validator). Add `9>&-` to the three `timeout … atcli_smd11` lines (short path, stale-retry path, long path), or replace BusyBox `timeout` with a watchdog that doesn't inherit the lock. Measured effect: about 1,000 ms → about 30 ms per call, and lock hold time drops from about 1 s to a few ms. This alone should remove nearly all of the measured contention.
1. **Re-measure** lock timeouts and CGI latency under poller load after step 0.
2. **If contention is still visible, take path (a):** a persistent broker daemon that owns smd11 and serialises requests in-process. It removes per-call `sh`, `flock`, `atcli` and `jq` spawning (the remaining 20–30 ms) and the lock queue entirely, and it keeps **100% field coverage**, including per-antenna signal, CA, MIMO and TA, which QMI can't provide.
3. **Why not (b) or (c) now:** QMI covers the LTE serving-cell identity and the summary signal well. But the single busiest poller call, the 2 s `AT+QRSRP;+QRSRQ;+QSINR` per-antenna read, has **no QMI equivalent** on this firmware (`Get Tx Rx Info` returns NOT_SUPPORTED), and neither do QCAINFO's NR SCC, MIMO or TA. A QMI poller would therefore still need AT on the hot path, and it would add a compiled binary dependency, a decoder that must be maintained, and cached-value semantics, all for a small reduction in AT traffic. It's worth revisiting only if a field becomes crash-prone over AT and is confirmed on QMI, or if indication-driven telemetry is wanted.

## Follow-ups (not done here)

- Apply and validate the `qcmd` `9>&-` fix on-device. This is the highest-value item.
- Optionally confirm LTE TA mapping to 0x0043 TLV 0x2D, by sampling while TA changes (a moving device).
- Test `0x00AC` under LTE-only intra-band or inter-band CA.
- `/tmp/qmiprobe` was left on the device for re-runs. It lives on tmpfs and is cleared on reboot.
- Unrelated observation: `Ping data stale (age_mono=11–12s)` warnings were logging every ~12 s from 09:36 onward.

## Daemon decompilation findings

**Date:** 2026-10-16, after the spike above.
**Method:**
- **Tooling:** REA 6.5.0 running inside WSL Ubuntu (the `rea-linux` MCP server), with Ghidra 12.1.4 headless. The binaries were auto-detected as AARCH64:LE:64:v8A.
- **Source of the binaries:** pulled from the device with Posh-SSH `Get-SCPItem`.
- **Live check:** read-only probes only (`ps`, `netstat`, `ubus list`, `ls`). Nothing was written to the device and nothing was restarted.
- **Addresses:** all addresses below are Ghidra image addresses.

**Question:** do the Quectel daemons hold a faster, lock-free copy of the radio telemetry that QManager reads over AT today, or does the vendor QMI service fill the gaps the spike found? **No to both.**

### `quectel_daemon`: housekeeping and an AT relay, no telemetry

| SHA-256 | Size | Functions |
|---|---|---|
| `71d14426…0636` | 65,546 B | 19 own functions, all decompiled |

It opens one QCCI client to the vendor service `quec_common_qmi` with `quec_common_qmi_get_service_object_internal_v01(1,1,6)` (`FUN_0010185c`). Every message it uses:

| Msg | Dir | Function | What it does |
|---|---|---|---|
| 0x30 | req | `FUN_00101ab8` | Sends the AP version (read from `/etc/quectel-project-version`) to the modem's CEFS. |
| 0x54 | req | `FUN_00101d20` | Reads the project version (40-byte string). |
| 0x1D | req | `FUN_001021c4` | Forwards `/proc/sys/kernel/qescape_sig` (escape signal). |
| 0x39 | req | `FUN_001017e4` | Sends a 0xA8-byte reply received on UDP `127.0.0.1:22222` (`FUN_0010271c`) back to the modem. |
| 0x1C | ind | `FUN_001015c0` | Modem mode: writes `/proc/sys/kernel/qmodem_mode`. |
| 0x36 | ind | `FUN_001015c0` | Firmware-upload status, relayed to the unix socket `/var/run/qfupl_status_sock`. |
| 0x3A | ind | `FUN_001015c0` → `FUN_001024a0` | 0xB8-byte "qmi msg to at" payload, sent to UDP `127.0.0.1:11111` or `:11112` (port = 0x2B67 + channel). |

**What this means:**
- UDP 11111 and 11112 are owned by `port-bridge` (live `netstat`). The 0x39/0x3A pair is therefore a **modem↔AP AT relay carried over vendor QMI**. It carries AT text, not structured measurements.
- **On the live device `quectel_daemon` is not running at all.** No process exists, and nothing listens on UDP 22222. QManager's data cannot depend on it.

### `ql_nw_service`: data-call control, no telemetry

| SHA-256 | Size | Functions |
|---|---|---|
| `a638e7f5…ec92` | 65,709 B | 49 own functions |

This is "QL_WWAN", a QCMAP client: backhaul, autoconnect, IP passthrough and DMZ (C++ `QCMAP_Client::*` imports). It also opens a NAS client and a WDS client. Only three functions send QMI requests:

| Msg | Service | Function | What it does |
|---|---|---|---|
| 0x002B | WDS | `FUN_00105c9c` | Get Profile Settings. Reads the APN-disabled flag and the PDP type. |
| 0x0023 | NAS | `FUN_0010618c` | Attach/Detach, PS action = 2 ("deattach lte"). |
| 0x0023 | NAS | `FUN_001062a4` | Attach/Detach, PS action = 1 ("attach lte"). |

**Indications:** `FUN_00105304` handles only the QCMAP bring-up (0x22), tear-down (0x23) and WWAN-status (0x24) indications.

**Not present anywhere in the binary:**
- No NAS Get Signal Info, Serving System, Cell Location Info or CA request.
- No cache file and no ubus object for radio data.

The TCP send loop (`FUN_00103aac`) drains internal `ctl`, `mdc`, `atc` and `qmi` queues to a connected peer. It holds no measurement data.

### The vendor service itself (`libqmiservices.so`, service ID 0xE3)

`quec_common_qmi_get_service_object_internal_v01` (0x123e5c) returns the IDL object at 0x1709b0:

| Field | Value |
|---|---|
| Service ID | 0xE3 |
| IDL version | 1 |
| Max message size | 4231 B |
| Messages | 76 requests, 76 responses, 32 indications |

The message tables sit at 0x132c1a (requests), 0x132a52 (responses) and 0x132992 (indications).

**Known IDs.** These are every vendor ID that `libql_atcop.so` or `quectel_daemon` calls:

| Area | IDs | Callers |
|---|---|---|
| Sleep / clock | 0x07, 0x29 | `ql_qsclk_init`, `ql_sleep_init` |
| GNSS | 0x2A, 0x2B, 0x2F, 0x38, 0x52, 0x53 | `getGpsConfig`, `setGpsConfig`, `ql_exec_qgpscfg_cmd_proc`, `ql_get_gnss_wdis2_status`, `ql_gps_init`, `setGnssEngineLock` |
| Flash wear test (`+QFTEST`) | 0x37 | `FUN_001238b0` |
| Secure-debug / auth sync | 0x4F, 0x50 | `ql_qmi_sync_secdbg_state`, `FUN_0014bedc` |
| Version sync, escape, AT relay | 0x30, 0x54, 0x1D, 0x39 / 0x3A | `quectel_daemon` (table above) |
| Unidentified | 0x2E | `FUN_00127f68` |

**Size profile:**
- Most responses carry 4–14 TLV bytes (result code plus a small field).
- **Large responses to empty requests:** 0x4C (490 B), 0x4D (889 B), 0x4E (273 B), 0x37 (1027 B, the flash-test dump) and 0x18 (4112 B, which pairs with 0x19's 4231-B request, so it looks like a file or NV transfer).
- **0x4C, 0x4D and 0x4E have no caller** in any binary we decompiled. Their purpose is unknown, and so is whether they have side effects.

**Live surfaces:**
- `ubus list` shows 48 objects. None of them is a modem or radio object.
- The named unix sockets belong to tlpd, QCMAP (`pd_manager`), netmgrd, qms, qwesd and ubus.
- `/var/run` and `/tmp` hold no radio cache. `qmanager_signal_history.json` is QManager's own file.

### Verdict

1. **No lock-free radio telemetry exists to borrow.**
   - Neither daemon reads per-antenna signal, the CA/SCC list, MIMO, TA or NR identity in NSA.
   - Nothing publishes such data over a socket, ubus or a file.
   - The baseband's ATCoP (AT command processor) answers `QENG`, `QCAINFO`, `QRSRP` and `QNWCFG` itself, as established earlier. That leaves only two routes to those fields: AT on smd11, or standard NAS QMI for the subset the spike already covered.
2. **The vendor service (0xE3) is a control channel, not a telemetry API.** Its known messages are GNSS, sleep, flash test, debug auth, version sync and an AT-text relay. The relay (0x39/0x3A) is the same AT engine reached another way, with no structured fields, so it doesn't help.
3. **A Rust tool that speaks the vendor service would not replace the expensive AT polls.** The gaps the spike found (per-antenna RSRP, NR SCC, MIMO, TA, NR band in NSA) stay AT-only on this firmware. (NR PCI in NSA was later found in NAS `0x004D` TLV `0x54`; see [`qmi-nr-sweep.md`](qmi-nr-sweep.md).) The single open lead is 0x4C/0x4D/0x4E (below).
4. **The cost case is also weaker now.** The `qcmd` FD-9 fix shipped (`c2ae24a8`, about 1 s → about 50 ms per call, validated on the device), which removed most of the lock contention that motivated this work.

### Recommended Rust scope (if pursued; nothing built)

Rust over Go, as the user prefers. Build a static `aarch64-unknown-linux-musl` binary with no libqmi dependency, using raw `AF_QIPCRTR` (42) datagram sockets as in `qmi-spike/main.go`. In priority order:

1. **Persistent AT broker** (`qmanager_atd`). Spike path (a): it owns `/dev/smd11` behind `/var/lock/qmanager.lock` semantics, serialises requests in-process, and serves `qcmd` callers over a unix socket.
   - **Gain:** removes the remaining per-call `sh`, `flock`, `atcli` and `jq` spawning while keeping 100% field coverage.
   - **When:** only if post-fix latency measurements still show contention.
2. **Optional NAS indication listener.** Subscribe to Serving System and Signal Info indications (no polling) and write a small JSON cache for the fields NAS does cover: LTE serving-cell identity, summary RSRP/RSRQ/SINR, registration and RAT.
   - **Gain:** a change-driven fast path, and a fallback while the AT lane is busy.
   - **Caveat:** it doesn't remove any AT call the poller needs.
3. **One guarded probe of vendor 0x4C/0x4D/0x4E** before investing further. Run it only with explicit approval, because an empty request with unknown semantics could trigger an action rather than a read. Dump the raw TLVs and compare them against `QENG`/`QRSRP`/`QCAINFO` output. If one of them turns out to hold per-antenna or CA data, it would be the only finding that changes this verdict.
