# QMI per-carrier signal for CA (2026-10-29)

Research only; nothing in the product reads this yet. It overturns the earlier verdict that `AT+QCAINFO` is the only source of per-carrier signal ([`qmi-vs-at.md`](qmi-vs-at.md), [`../plans/2026-10-25-qmi-ca-gap-fill.md`](../plans/2026-10-25-qmi-ca-gap-fill.md)).

## Verdict

- **The LTE secondary carrier's RSRP, RSRQ and RSSI are in QMI.** NAS `0x0043` Get Cell Location Info, TLV `0x14` (the "inter-frequency" list) holds an entry for each SCC frequency with that cell's PCI and signal. In 30 of 30 paired reads, QCAINFO's SCC values were **exactly** the QMI values (0.1 dB units) cut to whole dB: 90 of 90 numbers.
- **The LTE PCC's RSRP, RSRQ and RSSI match QCAINFO the same way.** They come from TLV `0x13`, the serving-cell row the broker already reads.
- **QCAINFO's own SCC SINR is always `0`**, so nothing is lost there. PCC SINR comes from `0x004F` Signal Info (live while the signal config is held).
- **So every LTE field of QCAINFO has a QMI source:** identity from `0x00AC`, signal from `0x0043`, PCC SINR from `0x004F`.
- **The NR row still has one gap.** ARFCN: `0x0043` TLV `0x2E` / `0x004D` TLV `0x60`. PCI: `0x004D` TLV `0x54` (candidate). Band: derive it from the ARFCN. **NR bandwidth: no QMI field found** (`0x0031` TLV `0x12` lists only the LTE anchor's bandwidth). QCAINFO's NR row has no signal values at all.

Why the earlier docs missed it: the 2026-10-21 spike read `0x0043` TLV `0x14` while the modem had no CA, saw "0 freqs", and filed the TLV as the idle neighbour list. In connected mode with CA, the SCC frequency is a configured measurement object, so the modem reports it there.

## Test (RM551E, NSA, 2026-10-29)

CA at the time: PCC B3 EARFCN 1350 (15 MHz, PCI 295), SCC B1 EARFCN 150 (20 MHz, PCI 295, `0x00AC` state 1), NR SCC n41 ARFCN 528030 (PCI 262).

For 30 pairs at 2 s, `qcmd 'AT+QCAINFO'` was read, then raw NAS `0x0043` and `0x00AC` through a throwaway QRTR probe (Get messages only, compiled allow-list). AT then QMI took about 80 ms per pair.

| Value | Agreement | Rule |
|---|---|---|
| SCC RSRP | 30/30 | `AT = trunc(qmi / 10)` |
| SCC RSRQ | 30/30 | same |
| SCC RSSI | 30/30 | same |
| PCC RSRP / RSRQ / RSSI | matched on every sample checked | same, from TLV `0x13` |

The QMI values changed on every read and moved with AT (SCC RSRP from −96.3 to −100.0 dB), so they are live, not cached. For comparison, QENG's RSSI differs from `0x0043` (Phase 0: 89.7 % within ±3 dB), but QCAINFO's RSSI is the same number.

## Layout: `0x0043` TLV `0x14`

All values little-endian; signal values are i16 in 0.1 dB.

```
u8  ue_in_idle            00
u8  freq_count            01
per frequency:
  u16 earfcn              9600  -> 150
  u8  threshold_x_low     00
  u8  threshold_x_high    00
  u8  cell_resel_priority 00
  u8  cell_count          01
  per cell:
    u16 pci               2701  -> 295
    i16 rsrq              aaff  -> -8.6
    i16 rsrp              3cfc  -> -96.4
    i16 rssi              edfc  -> -78.7
    i16 srxlev            0000
```

TLV `0x28` repeats the frequency list with u32 EARFCNs (`01 96000000`), for EARFCNs above 65535.

**Joining.** Take each SCC from `0x00AC` (EARFCN, PCI, band, bandwidth, state), find the `0x14` frequency with the same EARFCN, then the cell with the same PCI. The PCC comes from TLV `0x13` the same way.

## Not proven yet

| Item | Why it matters | How to check |
|---|---|---|
| Two or more LTE SCCs | Only one SCC was present. Each should be its own frequency in `0x14`. | Repeat the paired read when the modem has 3CA or more. |
| SCC in state 2 (activated) and after an SCC change | The test SCC was state 1 (configured). | Pair reads across an SCC add, drop or swap. |
| Inter-frequency neighbours mixed in | An idle-mode or measured neighbour could share the list. | Join on (EARFCN, PCI) from `0x00AC` and drop the rest. |
| NR bandwidth | No QMI field found. | Look again in SA, or keep it from AT. |
