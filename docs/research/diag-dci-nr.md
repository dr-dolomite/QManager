# DIAG DCI on the RM551E: per-antenna and per-beam signal (2026-10-29)

Research only; nothing in the product uses DCI. Companion to [`qmi-nr-sweep.md`](qmi-nr-sweep.md), which closed the QMI side.

## Verdict

- **DCI works on this modem** without `/dev/diag`, root tricks or a mode change. A small native client attaches through the device's own `libdiag`, turns on three radio log codes, and receives them about every 300 ms.
- **LTE per-antenna signal: yes.** Log `0xB193` carries RSRP for all 4 RX chains, per-chain RSRQ and RSSI. It matched `AT+QRSRP` within rounding.
- **NR per-beam signal: yes, NR per-antenna: half.** Log `0xB97F` carries the NR PCI, ARFCN and every SSB beam with RSRP/RSRQ for **RX0 and RX1 only**; the RX2/RX3 slots are zero on this firmware. `AT+QRSRP` stays the only full 4-chain NR source.
- **NR CQI / rank: delivered, not decoded.** Log `0xB8A7` arrives, but its versioned layout was not mapped.
- **Not worth productising today.** It needs a native client, versioned binary decoders per firmware, and it keeps modem log masks on. AT already gives per-antenna signal in about 10 ms through the broker. Revisit only for something AT cannot give (per-beam NR).

## How a client attaches

There is no `/dev/diag`. `libdiag.so` talks to `diag-router` over a unix socket, and the modem serves `DIAG service (MODEM:DCI)` on QRTR. The API sequence (from decompiling `diag_dci_sample`):

1. `Diag_LSM_Init(NULL)`
2. `diag_register_dci_client(&id, &peripherals, 0, &signal)` → `1001` (`DIAG_DCI_NO_ERROR`)
3. `diag_register_dci_stream_proc(id, log_cb, event_cb)`
4. `diag_log_stream_config(id, 1, codes[], n)` (mask on)
5. capture; then `diag_log_stream_config(id, 0, …)`, `diag_release_dci_client(&id)`, `Diag_LSM_DeInit()`

Each callback buffer is a standard diag log record: `u16 len, u16 log_code, u64 timestamp, payload`.

**Linking.** The device's `.so` files have no section headers, so `lld` cannot link against them. The probe linked against generated stub libraries with the same sonames (`libdiag.so.1`, `libc.so`, `libgcc_s.so.1`) and runs against the real ones at load time. Probe source, stub generator and capture are kept outside the repo (handoff artifacts `artifacts-20261029-nr/`).

**Cost and state.** The masks live on the modem, are volatile and are cleared when the client releases (seen: mask off and release both returned `1001`, `diag-router` logged a normal close). Never run `diag_dci_sample`: it is a stress test that floods events and logs.

## Capture (8 s, NSA, 2026-10-29 11:02)

AT at the same moment: LTE anchor EARFCN 1350 (B3), PCI 295, RSRP −99, RSRQ −10, RSSI −70; NR PCI 262, ARFCN 528030 (n41), RSRP −79, RSRQ −10. `+QRSRP: -99,-106,-103,-104,LTE` and `+QRSRP: -79,-87,-82,-80,NR5G`.

| Code | Name | Packets | Decoded |
|---|---|---|---|
| `0xB193` | LTE ML1 serving cell meas | 32 | yes |
| `0xB97F` | NR5G ML1 searcher meas DB update ext | 25 | yes (2 of 4 RX) |
| `0xB8A7` | NR5G MAC CSF report | 25 | no |
| `0xB825`, `0xB821`, `0xB975` | NR RRC config / OTA, NR ML1 serving meas | 0 | RRC codes only fire on reconfiguration; `0xB975` may be unsupported |

### `0xB193` (LTE), payload offsets after the 12-byte header

Header `01 01 …`, one subpacket: id `0x19`, version byte `0x42`, size 156.

| Offset | Field | Encoding | Capture vs AT |
|---|---|---|---|
| `0x08` | EARFCN | u32 | 1350 ✓ |
| `0x18` | PCI | low 9 bits of u16 | 295 ✓ |
| `0x28` bits 10–21 | RSRP RX0 | `raw/16 − 180` | −98.9 (AT −99) |
| `0x2C` bits 12–23 | RSRP RX1 | same | −106.2 (AT −106) |
| `0x30` bits 12–23 | RSRP RX2 | same | −103.8 (AT −103) |
| `0x34` bits 12–23 | RSRP RX3 | same | −103.8 (AT −104) |
| `0x3C` bits 12–23 | RSRP combined | same | −98.9 (AT −99) |
| `0x40`… | RSRQ per RX | 10-bit fields, `raw/16 − 30` | −10.8 / −11.0 / −10.6 (AT −10) |
| `0x54` bits 0–10 | RSSI | `raw/16 − 110` | −69.3 (AT −70) |

All 32 packets stayed within ±2.5 dB of the AT snapshot. SINR was not located.

### `0xB97F` (NR), payload offsets after the 12-byte header

Version `00 00 03 00`. One serving-cell block:

| Offset | Field | Encoding | Capture vs AT |
|---|---|---|---|
| `0x14` | ARFCN | u32 | 528030 ✓ |
| `0x1A`, `0x3C` | PCI | u16 | 262 ✓ |
| `0x40` | beam count | u32 | 4 |
| `0x44` / `0x48` | cell RSRP / RSRQ | i32 Q7 (`/128`) | −81.4 / −10.3 |
| `0x4C` + 0x54·k | beam record k | 84 bytes | |
| +`0x00` | SSB index | u16 | 0, 6, 1, 5 (order follows strength) |
| +`0x14` / `0x18` | RSRP RX0 / RX1 | i32 Q7 | best beam −79.4 / −87.6 (AT ant 0/1: −79 / −87) |
| +`0x1C` / `0x20` | RSRQ RX0 / RX1 | i32 Q7 | −10.4 / −10.4 (AT −10) |
| +`0x24`…`0x43` | RX2/RX3 slots | zero | AT ant 2/3: −82 / −80 (not present) |

QENG's NR RSRP (−79) is the best beam on RX0. The per-beam list (4 SSBs, about 9 dB spread) is something no AT command shows.

### `0xB8A7` (NR CSF)

96-byte records, version `05 00 03 00`. A frame/slot counter at `0x0A` steps by `0x20` each packet; the rest is almost constant (`0x20` alternates `e8 21` / `c8 19`). CQI, rank and PMI are bit-packed and the layout was not mapped.

## What productising would take

- A native client (C or the Rust broker) linked as above, with a hard capture cap and guaranteed mask-off on exit and on SSR.
- Decoders keyed on each log's version byte; a firmware update can change layouts silently. Gate on the version and drop unknown ones.
- A CPU and stability soak: DCI pushes several packets a second per code through `diag-router`.
- A product reason AT cannot cover. Per-antenna LTE is already cheap on AT, and DCI NR gives only 2 of 4 chains. Per-beam NR (SSB index and strength) is the only new data.
