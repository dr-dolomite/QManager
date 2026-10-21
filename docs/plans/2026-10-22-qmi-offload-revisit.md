# QMI offload: revisit (2026-10-22)

Status: **PLAN, awaiting approval.** Nothing is built yet, and nothing has been written to the device.

## What the recon found

| Question | Finding |
|---|---|
| Did the fork (RafayGhafoor/QManager-RM520N@b7ee6f2e) move AT reads to QMI? | **No.** The commit adds things; it doesn't remove anything (poller +161/−0). It adds a *new* live neighbour tick for antenna aiming. The tick calls the **vendor-shipped** `qmicli` at `/data/gp/qmi` on a GreenPacket RG520N-EB, but only while a browser tab holds a lease. Its own lib header says: "does not replace any AT read". |
| Can we run the same thing on the RM551E? | Not as-is. There is no `qmicli`, no `/data/gp`, and the device's libqmi is basic-collection only. QRTR does work on node 3: NAS 3, WDS 1, DMS 2, UIM 11, LOC 16, Thermal 23/24, DSD 42. A raw `AF_QIPCRTR` client works too; the 2026-10-16 spike measured 0.2–1 ms per request. |
| Is the AT port actually congested now? | **Not measurably.** `qcmd` through `qmanager_atd` takes <10 ms, with 0 `modem_busy` and 0 lock-fails since boot. The caveat is a short window: the device rebooted unplanned at 07:17. Live UCI cadence is idle 30 s / deep 120 s. |
| What can QMI replace on this firmware? | LTE serving-cell identity (PCI, EARFCN, TAC, cell ID, band, bandwidth), the summary LTE signal, the NR RSRQ, registration and RAT, PLMN. |
| What can it **not** replace? | Per-antenna `QRSRP/QRSRQ/QSINR` (Get Tx Rx Info = NOT_SUPPORTED), NR PCI and band in NSA, the CA SCC list in EN-DC, MIMO, NR TA, TX power, CQI. LTE TA is unconfirmed. QMI Signal Info also looks *cached* when polled. Indications fix that, but they need a Config Signal Info registration, which is a config write. |

**Honest verdict.** Offloading AT for speed has little left to gain: the broker already made AT cheap. QMI pays off where AT is *unavailable* or *risky*, not where it is slow:

1. **Long-running AT** (`QSCAN` cell scan, SIM switch, `/tmp/qmanager_long_running`). The poller suppresses AT, so the dashboard goes stale for the whole scan. QMI can keep serving cell, signal and registration live.
2. **SSR-correlated or firmware-fragile AT.** The R01A04 QCAINFO disconnects (v0.1.34) and the TA/MIMO `QNWCFG` reads that moved on-demand. QMI `0x00AC` (LTE CPHY CA) and `0x0043` TLV 0x2D (LTE TA candidate) are possible fragile-free sources. Both need validation.
3. **Live neighbour aiming** (the fork's feature) via `0x0043`. Caveat: the spike saw QMI list only the serving PCI while AT also listed a neighbour.
4. **Lock-free registration/RAT** for the RAT gate in `radio_details.sh` (the 7 s page poll) and for watchdog/alerts.

## Plan

Model tiering: Opus orchestrates and owns the Rust QRTR core. Sonnet builds the shell and UI. Haiku runs the simple sweeps (i18n parity, CRLF, grep audits).

### Phase 0: device spike, read-only (needs your OK to push one binary to `/tmp`)
- Rebuild the spike client as Rust inside `qmanager_atd` (feature-gated subcommand `qcmd --qmi <msg>`, whitelist of NAS/DMS/UIM *Get* IDs only). Push it to `/tmp` only.
- Measure in **NSA, LTE-only and SA** where the current network allows. Switching mode is a live write and needs a separate OK; NSA alone is fine to start with.
- Compare QMI and AT side by side for 30 min (`tools/qmi-parity/`, modelled on `tools/poller-parity/`). Cover: serving fields, `0x00AC` CA under LTE CA, the `0x0043` neighbour list, the TLV 0x2D vs `QNWCFG lte_time_advance` mapping, UIM card status.
- **Go/no-go gate:** a field is offload-eligible only if it matches AT within tolerance in ≥95 % of samples and never reports while unregistered (the fork's RSRP-while-searching trap).

### Phase 1: QRTR client in `qmanager_atd` (Rust, no new crates)
- `src/qrtr.rs`: `AF_QIPCRTR` socket, NS lookup, TLV codec, read-only message whitelist.
- New `QMI` verb in `serve` / `proto.rs`, bypassing the smd11 lock. `qcmd --qmi nas.serving|nas.signal|nas.cell|nas.ca|uim.card` returns JSON.
- Fallback: if QRTR is unavailable (other modems), the verb returns `ERR qmi_unavailable` and callers use AT as today.

### Phase 2: offloads, each opt-in behind the parity gate
1. Poller: keep a live QMI serving/signal tick **while AT is suppressed**, and mark it `source:"qmi"` in status.json.
2. `radio_details.sh`: replace the `QENG servingcell` RAT gate with `nas.serving`. This removes 1 of 4 AT calls per 7 s poll.
3. LTE-only CA via `0x00AC`, if Phase 0 validates it. This cuts `QCAINFO` exposure on R01A04. Keep QCAINFO for EN-DC/NR SCC.
4. Optional: port the live neighbour aim strip from the fork onto `nas.cell` (UI via Impeccable, canon per DESIGN.md).

### Out of scope
Replacing per-antenna, NR-NSA, MIMO or EN-DC CA reads (impossible on this firmware), the vendor 0x4C–0x4E probe (declined before), and bundling `qmicli`.

## Risks
- QRTR clients coexist with netmgrd/QCMAP. The spike verified this, but a long-lived socket in atd is new. Mitigation: open and close per request in Phase 1.
- Cached Signal Info means polled values can lag AT. Phase 2 uses them only as a fallback during AT suppression unless parity proves otherwise.
- Lifecycle: no new files beyond the atd binary (already installed by install/update/uninstall), so lockstep impact is nil. Any new `/tmp` sidecar gets added to the cleanup lists.

## Validation and rollback
- Rust: `cargo test` with TLV fixtures captured in Phase 0. Shell: CRLF + BusyBox audit through the validator. On-device: parity soak.
- Each offload keeps its AT path, so rollback = revert the commit or set the flag `quecmanager.qmi.enabled=0`.
