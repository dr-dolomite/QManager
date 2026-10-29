# QMI NR sweep: the full NAS catalogue (RM551E, 2026-10-29)

Question: is NR data that the earlier work called "not available over QMI" reachable through parts of QMI nobody had tried? Earlier work: [`qmi-vs-at.md`](qmi-vs-at.md) (2026-10-16 spike), [`qmi-phase0-results.md`](qmi-phase0-results.md) (Phase 0). Feature contract: [`../features/qmi-lane.md`](../features/qmi-lane.md).

**Setup**
- **Device:** RM551E-GL, fw `RM551EGL00AAR02A01M8G`, TNT 515-03, 5G-NSA: LTE B1 PCC (PCI 295, EARFCN 150) plus n41 SCC (PCI 262, ARFCN 528030), uptime 55 min, broker 0.6.2 with the signal config held.
- **Catalogue:** the NAS IDL service object in `/usr/lib/libqmiservices.so` (md5 `7f312448f0061992fbbcdcb577f6d7a5`, same file as `~/re/bins/` in WSL). Its section headers are stripped, so the message tables were read through the program headers and `R_AARCH64_RELATIVE` relocations, not Ghidra.
- **Probe:** a throwaway static aarch64 build of `native/qmi_probe/src/qrtr.rs` with a compiled allow-list. It sent **no request TLVs**, except a single RAT selector (TLV `0x01`) to three Gets with a mandatory RAT argument. It ran from `/tmp` only and was removed afterwards. No config writes.

## Findings

1. **NR PCI is exposed in NSA, in NAS `0x004D` (Get Sys Info) TLV `0x54`.** It is a `u16` in the IDL, live value `0x0106` = **262**. It matched `AT+QENG="servingcell"` NR PCI on **30 of 30** paired reads (3 s apart). The spike's "none found in 0x004D" was wrong: `0x54` was one of the "about 20 others" it left undecoded. **Caveat:** the NR cell never changed during the run, so it is proven to agree, not yet proven to track a change. See [Open items](#open-items).
2. **NR ARFCN is also in `0x004D` TLV `0x60`** (`u32`, 528030). This confirms the spike. `0x0043` TLV `0x2E` carries it too.
3. **`0x004D` is already on the broker's client allow-list** (it is one of the four allow-listed messages that no named read uses). Consuming TLV `0x54` needs a decoder and a named-read change in the broker, not an allow-list change.
4. **NR band is still not a QMI field.** No `0x004D` TLV holds 41 (or an NR band enum). Derive the band from the ARFCN with a band table, as before, or keep AT.
5. **NR SCC list: one new candidate.** NAS `0x00D2` (name unknown) TLV `0x1C` is a counted `u32` list (max 8 in the IDL), live `01 9e0e0800` = one entry, ARFCN 528030. Its TLV `0x18` holds the LTE anchor (`01`, DL EARFCN 150, UL EARFCN 18150, bandwidth enum 5 = 20 MHz). With one NR carrier on air it cannot be told apart from "the NR serving ARFCN"; it needs NR-CA (two NR carriers) to tell whether it lists SCCs.
6. **Nothing else in NAS carries NR identity or per-antenna data.** No other response contains 262 or 528030. Per-antenna (`0x005A`) is still `NOT_SUPPORTED`.
7. **The NAS IDL is far larger than what was tried.** 229 request, 229 response and 81 indication messages, IDL minor version 409. Before this sweep only 9 had been sent.

## The NAS catalogue and what was sent

Response sizes come from the IDL. A "parameterless Get" here means the request has zero TLVs in the IDL and the response is larger than the result TLV alone.

| Group | Messages | Result |
|---|---|---|
| Parameterless Gets (74, including the 6 already in use) | every NAS message with an empty request and a response over 11 bytes | 44 `ok`; 19 `0x005E` (not supported), 6 `0x0019`, 3 `0x0003`, 1 `0x004A`; `0x00BD` timed out. |
| Optional-parameter Gets, sent empty | `0x0081`, `0x00B5`, `0x0107`, `0x0133`, `0x006F`, `0x00C1`, `0x003E`, `0x001F`, `0x0020` | `0x0081` and `0x006F` answer an empty list (`10:ffff 11:00`). `0x0020` (legacy Signal Strength) answers LTE only. The rest are errors or a timeout (`0x0107`). |
| Mandatory-RAT Gets, RAT 8 (LTE) and 12 (NR5G) | `0x00F5`, `0x0137`, `0x0168` | `0x005E` / `0x0030` for both RATs |
| Not sent | Every message whose request carries configuration (Set/Perform/Register pairs, network scan `0x0021`, `0x006C`, `0x0050`, `0x0003`) | read-only rule |

Fingerprint search: every `ok` response was searched for NR PCI 262 (`0601` little-endian) and NR ARFCN 528030 (`9e0e0800`). Hits: `0x004D` TLVs `0x54` and `0x60`, `0x0043` TLV `0x2E`, `0x00D2` TLV `0x1C`. The `0601` hit inside `0x00EE` is part of a list of 16-bit codes, not a PCI.

### `0x004D` NR TLVs (live, NSA)

Types come from the IDL encoding. The device's libqmi 1.32.4 knows the NR5G Sys Info TLVs "NR5G Service Status Info", "NR5G System Info", "EUTRA with NR5G availability" and "NR5G Tracking Area Code", but its strings do not give their TLV numbers, so the readings below marked *inferred* match a name to a TLV by type and position only. Nothing in libqmi covers `0x54` and up.

| TLV | IDL type | Live value | Reading |
|---|---|---|---|
| `0x4A` | struct (same type as the other service-status TLVs) | `000000` | *inferred* NR5G service status: no SA service |
| `0x4E` | u8 | `01` | *inferred* "EUTRA with NR5G availability": the LTE cell offers EN-DC |
| `0x4F` | u8 | `00` | unnamed |
| `0x50` | struct | absent | *inferred* NR5G TAC; absent in NSA, expected in SA |
| `0x54` | u16 | `0601` = 262 | **NR PCI** (30/30 vs AT) |
| `0x55` | u8 | `01` | unnamed flag |
| `0x5D` | u32 | `1` | unnamed |
| `0x5E` | u64 | absent | unnamed; a 64-bit field fits an NR cell identity (36 bits). Watch for it in SA |
| `0x5F` | struct | `08 "51503" ff` | PLMN record |
| `0x60` | u32 | 528030 | **NR ARFCN** |
| `0x61`–`0x6C` | mixed | absent | unnamed |

## Other routes looked at

| Route | Status | Note |
|---|---|---|
| Other QRTR services | **not probed** | `qrtr-lookup` lists about 40 services on node 3, including 88 (ML Context Event Exchange), 89, 92, 5025 (unnamed), Smart Transmit 87, RF radiated performance 41 and the vendor service 227 (0xE3). `libqmiservices.so` has no IDL for 88, 89, 92 or 5025, so any probe would be blind (unknown message semantics); not done. |
| Vendor 0xE3 `0x4C`/`0x4D`/`0x4E` | still declined | Unchanged from the spike: empty requests with unknown semantics and no caller. |
| DIAG DCI | **tried 2026-10-29: works** | A native client on the device's `libdiag` captured `0xB193` (LTE per-RX RSRP/RSRQ/RSSI, all 4 chains, matches AT), `0xB97F` (NR PCI, ARFCN and per-SSB-beam RSRP/RSRQ for RX0/RX1 only) and `0xB8A7` (NR CSF, not decoded). Not worth productising today. Details: [`diag-dci-nr.md`](diag-dci-nr.md). |

## Corrections to earlier docs

- [`qmi-vs-at.md`](qmi-vs-at.md) row "NR5G PCI (NSA): none found in 0x0043, 0x004D or 0x0024": wrong for `0x004D`.
- [`qmi-phase0-results.md`](qmi-phase0-results.md) "`0x004D`: no PCI, band or ARFCN anywhere": wrong for PCI (`0x54`) and ARFCN (`0x60`); right for band.
- [`../features/qmi-lane.md`](../features/qmi-lane.md) "NR PCI / band (NSA): not available": PCI is available as a candidate; band is still not.
- [`../plans/2026-10-22-qmi-offload-revisit.md`](../plans/2026-10-22-qmi-offload-revisit.md) "NR-NSA … impossible on this firmware": not true for NR PCI.

## Open items

| Item | Condition | Recipe |
|---|---|---|
| `0x54` tracks a PCI change | An NR handover or re-add on another PCI (moving the device, or another site) | Pair `0x004D` with `qcmd 'AT+QENG="servingcell"'` every 2 s for 30 min while moving. GO if every NR PCI change shows in `0x54` within one sample and `0x54` is absent while AT shows no NR leg. |
| `0x54` / `0x5E` / `0x50` in SA | Modem camped in SA (needs the user's OK: the mode change drops the data connection) | Same pairing against the QENG SA row; check `0x5E` against the NR cell ID and `0x50` against the NR TAC. |
| `0x54` with no NR leg | LTE-only (EN-DC released) | Confirm `0x54` is absent or zero rather than stale. |
| `0x00D2` TLV `0x1C` as an NR carrier list | NR-CA (two NR carriers) | Compare the list with the `QCAINFO` NR rows. |
| Per-antenna NR RX2/RX3 | DCI `0xB97F` leaves them zero | Try another NR code (for example `0xB975` in SA, or a newer firmware) with the same client; see [`diag-dci-nr.md`](diag-dci-nr.md). |
| NR CQI / rank from DCI | `0xB8A7` captured, layout unknown | Capture while the NR rank or CQI changes (compare with the MIMO layers the poller already reads) and map the bits. |
