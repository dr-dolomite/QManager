# QMI offload Phase 0: results (RM551E, 2026-10-22)

Plan: [`docs/plans/2026-10-22-qmi-offload-revisit.md`](../plans/2026-10-22-qmi-offload-revisit.md). Earlier spike: [`qmi-vs-at.md`](qmi-vs-at.md).

**Setup**
- **Device:** RM551E-GL, firmware RM551EGL00AAR02A01M8G, carrier TNT 515-03.
- **Probe:** `native/qmi_probe` (Rust, static aarch64-musl, 430 KB). It speaks raw `AF_QIPCRTR` and sends only Get messages from a fixed allow-list. It ran from `/tmp` only.
- **Comparison:** `tools/qmi-parity/compare.py`.
- **Network states:** the soak ran in 5G-NSA with 3 LTE carriers plus N41. LTE-only and B41+B40 were also sampled.

## Verdict per field

The gate is ≥95 % agreement with AT on fresh, active-tier samples.

| Field | Source | Result | Verdict |
|---|---|---|---|
| LTE PCI, EARFCN, TAC, cell ID, band, bandwidth | `0x0043` TLV 0x13 + `0x0031` | 100 % (n=889) | **GO** |
| Registration / RAT / PS attach | `0x0024` | 100 % | **GO**. Reports `searching`/`none` correctly during SSR recovery, so it can gate the signal fields. |
| LTE CA set (PCC + SCCs, EARFCN/PCI/BW/band/state) | `0x00AC` TLV 0x13 + 0x15/0x19 | 99.3 % (6 misses, all at CA transitions) | **GO** for LTE CCs. NR SCC isn't in this message. |
| LTE serving RSRP | `0x0043` serving row (0.1 dB) | 99.3 % within ±2 dB, bias +0.4 | **GO**. Fresher than AT: 775 value changes vs AT's 368, and it changed on 100 of 100 samples at 10 Hz. |
| LTE serving RSSI | `0x0043` serving row | 89.7 % within ±3 dB | partial (different averaging) |
| LTE serving RSRQ | `0x0043` serving row / `0x004F` | 83 % / 93 % within ±2 dB | partial (AT rounds to whole dB) |
| LTE SINR | `0x004F` | 97 % within ±3 dB, **but cached** | NO-GO for live use |
| LTE/NR Signal Info (`0x004F`) generally | | **Cached:** LTE RSRP produced 4 distinct values in 30 min. Indications with default thresholds: 1 per 60 s | NO-GO when polled. Realtime needs `Config Signal Info v2` (`0x006C`), which is a config write and needs approval. |
| NR RSRP / SINR / RSRQ (NSA) | `0x004F` | 60 % / 83 % / 100 %, bias +2.5 dB | NO-GO (cached) |
| NR ARFCN (NSA) | `0x0043` TLV 0x2E | matches AT | GO |
| NR PCI / band (NSA) | `0x0043` TLV 0x2F, per REA, the NR5G serving-cell struct | **TLV absent in NSA.** Expected in SA (untested) | NO-GO in NSA |
| Per-antenna RSRP/RSRQ/SINR | `0x005A` Get Tx Rx Info | `QMI_ERR_NOT_SUPPORTED` (0x5E) for LTE and NR with every request variant | **NO-GO** (firmware). Stays AT. |
| LTE timing advance | `0x0043` TLV 0x1E (IDL lone u32) / 0x2D / 0x26 | AT read 4 then 5; no TLV tracked it consistently | unresolved |
| WDS current settings / packet stats | `WDS 0x002D` / `0x0024` | `0x000F` / `0x0046` (needs the data-session owner) | NO-GO |
| WDS profile list, DSD system status (APN list), UIM card + slot status, DMS IDs / revision / time / op mode | | all answer in 0.1–0.6 ms | GO candidates (not compared field by field) |

## Speed and cost

- **Per request:** 0.2–0.6 ms p50, under 1 ms p95, ~2–4 ms max.
- **One process:** five reads (`serving sig cell rf ca`) take 3.2 ms p50 including exec. A `qcmd` AT read through `qmanager_atd` takes about 10 ms.
- **CPU:** 10 Hz polling of `0x0043` costs about **0.5 % CPU**. At 1000 back-to-back requests, cell info sustains about 1500 requests/s.
- **Coexistence:** zero failures outside the SSR window. netmgrd, QCMAP and the AT broker were unaffected.

## Event during the soak: MPSS SSR (not caused by QMI)

At uptime 2414 s the baseband crashed: `nr_rx_ctl_agc.c:7563:RXCTL_IUSS: RFG 0 rx 0 state is wrong`. This is the known RF IU fault, and it was crash #2 of this boot. **Crash #1 was at 1051 s, before any QMI traffic.** The AT broker logged `Channel reset` on `QENG` at the same moment.

The QMI side behaved well:
- The socket got `ECONNRESET`.
- The NAS service vanished from the name server for about 8 s.
- After that came a few `0x004A` errors, then `searching` on serving system.
- Then `registered` again, as quickly as the poller.

So the QRTR reset is an exact, instant SSR signal, which could be useful for the SSR-aware watchdog. The NR per-antenna read also showed rx2/rx3 at −140 around this time.

## What this means for Phase 1–2

1. **Realtime LTE serving signal is viable now.** `0x0043` serving-row RSRP/RSRQ/RSSI, together with `0x0024` registration and `0x00AC` CA, can run at 1–10 Hz for under 1 % CPU. This is the antenna-aiming / live-dashboard path. It also runs during long AT jobs (cell scan, SIM switch), when the poller suppresses AT.
2. **Lock-free reads can replace AT on the poller's hot path for LTE.**
   - LTE identity, band and bandwidth from `QENG servingcell` move to QMI.
   - LTE CA moves to QMI. This also removes `QCAINFO` exposure in LTE-only CA.
   - AT stays for per-antenna, SINR, every NR field except ARFCN, and the NR SCC.
   - `QENG servingcell` remains needed in NSA/SA for the NR block, so in NSA the AT savings are partial.
3. **The deep tier gets fresh data at zero AT cost.** In the deep tier (120 s), status.json was showing a CA set from minutes earlier, while QMI was current.
4. **Open items:**
   - Validate in SA, where TLV 0x2F should supply NR PCI and RSRP.
   - Decide whether to approve `Config Signal Info v2` for live SINR/NR. Evaluated in [`qmi-signal-info-v2.md`](qmi-signal-info-v2.md): GO pending a soak. Indications are per-client, and the shared cache stays fine-grained until the next SSR.
   - Map LTE TA while the device moves.
   - Port the decoders into `qmanager_atd` (`src/qrtr.rs`) behind a `QMI` verb.

## Artifacts

- **Probe:** `native/qmi_probe/`.
- **On the device:** `/tmp/qmi_probe` (tmpfs, gone on reboot).
- **Parity tool:** `tools/qmi-parity/compare.py`. The sampler shape is in its README.
- **REA IDL decode** of `/usr/lib/libqmiservices.so` (stripped; layouts recovered from the compact IDL byte stream):
  - `0x0043` TLV 0x2F = NR5G serving cell (PLMN, TAC, u64 cell ID, PCI, RSRQ, RSRP, SNR); 0x30 = NR neighbours; 0x1E = lone u32 (libqmi calls it LTE TA).
  - `0x00AC` TLVs 0x10–0x19.
  - `0x004D`: no PCI, band or ARFCN anywhere.
  - `0x005A` has 8 RX-chain structs, but the firmware refuses the message.
