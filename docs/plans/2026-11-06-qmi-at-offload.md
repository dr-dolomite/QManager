# QMI offload of AT reads (carrier list, NR identity, device IDs, LTE bands)

Status: **PLAN, awaiting approval** (2026-11-06). Large change (broker + poller + AT path).

## Goal

Move the reads that QMI has proven it can serve off the AT lane, inside the existing architecture: the broker (`qmanager_atd`) reads QMI and publishes `qmi.env`; the poller consumes the sidecar; the frontend keeps reading `status.json`. No new CGI, no client-reachable writes.

## What the recon found (2026-11-06, broker 0.6.2, live NSA B1 + N41)

- **QCAINFO is the only offload with real weight.** It runs on every AT-due cycle (2 s active, ~14 s idle, skipped in deep) as `AT+QCAINFO=1;+QCAINFO;+QCAINFO=0`, a per-cycle write toggle on the path that dropped the connection on R01A04. Its output lives only as the JSON string `t2_carrier_components` (built in awk, `parse_at.sh:799-1102`), which `events.sh` also consumes (`ca_change`, SCC signature, PCI state).
- **Identity and band list are already one-shot.** Model, firmware, IMEI come from one boot AT read (`collect_boot_data`, poller:780); About Device reads `status.json`. Supported LTE bands are read at boot and on a refresh flag (`policy_band`). Offloading them saves no steady-state AT time; the value is only boot robustness when AT is busy.
- **QENG stays.** It supplies LTE serving, NR signal, SCS, TA and the NSA/SA detection every cycle including deep. QMI NR PCI cannot remove it; it can only fill the carrier list and gaps.
- **Broker gaps:** `0x0043` TLV `0x14` (per-SCC signal) is not decoded; `0x004D` is allow-listed but has no codec; DMS `0x0045` is not on the allow-list at all. No fixtures exist for any of the three.
- **QMI cannot supply:** NR bandwidth, per-SCC LTE SINR (only PCC SINR via `0x004F`), NR band (derivable from ARFCN with a table), NR-CA carriers (`0x00AC` has no NR).
- **Live caveats:** QMI vs AT signal differed by ~6 dB across non-simultaneous samples (needs a paired run); `qmi_ca_count` counts configured SCCs (state 1 and 2), the same as AT's count, so it is comparable but not an "active" count.

## Design

### Broker 0.7.0 (Rust, `native/qmanager_atd/`)

1. **Per-carrier LTE signal.** Decode `0x0043` TLV `0x14` (and `0x28` for u32 EARFCNs) into frequency → cell rows (10-byte rows, 0.1 dB, same layout as TLV `0x13`). `Ca::from_codec` joins each carrier on EARFCN + PCI: PCC from the TLV `0x13` serving rows, SCCs from `0x14`; unmatched rows (neighbours) are dropped. `Carrier` gains `rsrp/rsrq/rssi` (tenths, `null` when no match or not registered). PCC SINR comes from `0x004F` as today; SCC SINR stays `null`.
2. **NR identity from Sys Info.** New codec for `0x004D` TLVs `0x54` (u16 NR PCI), `0x60` (u32 NR ARFCN), `0x4E` (u8 EN-DC available). Added as an optional 6th request in `bundle` (fails soft like `0x004F`) and as a named read `sysinfo`. **Candidate status preserved:** published, but the poller only uses it when AT is absent or agrees (see below).
3. **LTE band capability.** Add DMS `0x0045` to `CLIENT_ALLOWED` (18 → 19 pairs; **needs your explicit approval**, the allow-list is a pinned invariant). Codec for TLV `0x12` (u16 count + u16 list), new named read `bands`. Not in the bundle (static data). Open item checked on-device first: whether the values are band numbers or NAS enums.
4. **Sidecar.** Append after the WDS keys, before `qm_sidecar_end` (existing readers parse by name, so append-only is safe): `qmi_pcc_{rsrp,rsrq,rssi,sinr}`, `qmi_scc{1..4}_{rsrp,rsrq,rssi}`, `qmi_nr_{pci,arfcn,endc}`. Integer-or-empty, whole dB. Env test updated from 42 names to the new count. JSON snapshot carries the new fields inside `data`.
5. **Fixtures first.** Capture raw TLV hex on the device (Phase 0 spike, `docs/research/qmi-spike/`) for `0x0043` with ≥1 SCC, `0x004D`, `0x0045`; commit as fixtures; extend `fake.rs` reply arms; add codec, join, truncation-fuzz and env-contract tests. Fix the stale "four requests" comment in `qmi_snapshot.rs`.

### Poller (`qmanager_poller`, `parse_at.sh`, `qmi_merge.sh`)

6. **QMI-primary carrier list at the same cadence.** At the existing QCAINFO point (AT-due, non-deep), when `qmi.env` is fresh (`qmi_state=up`, registered, age ≤ 5 s, no scan/SIM-switch flag): build `t2_*` from the sidecar (new `build_ca_from_qmi` in `qmi_merge.sh`, printf-built JSON with the exact `carrier_components` key set and the same `B<n>` / bandwidth conventions), and skip `AT+QCAINFO`. Same cadence means `events.sh` sees samples at the same rate, so `ca_change` debounce is not retuned.
7. **NR entries stay AT-sourced, refreshed on change.** QMI has no NR bandwidth. When QMI shows an NR leg (`qmi_nr_arfcn` set), keep the NR rows from the last `QCAINFO` and merge them into the QMI list; re-run `QCAINFO` only when the NR ARFCN or NR PCI (QMI, else QENG) changed, the cache is older than 60 s, or there is no cached NR row. In LTE-only operation QCAINFO stops entirely. SA (NR PCC) and NR-CA always fall back to full QCAINFO.
8. **Fallback.** Sidecar stale/down/missing or broker < 0.7.0 (no `qmi_pcc_rsrp` key) → today's QCAINFO path, byte-identical. New `device.ca_source` (`qmi|at|mixed`); `ca_read_mono` keeps meaning "age of the carrier data".
9. **Identity and bands (boot robustness only).** In `collect_boot_data`, if the AT identity read leaves model/firmware/IMEI empty, fill them from `qmi rev ids`. In `refresh_policy_band`, if the AT read fails, fill `lte_band` from `qmi bands` (NR lists stay AT). No change when AT succeeds.

### Out of scope (stay AT)

NR bandwidth, per-antenna 5G signal, separate NSA/SA/NR-DC band lists, MIMO/TA, QENG serving read, `band_failover`'s own QCAINFO, per-SCC LTE SINR. **Off-cycle freshness** (overlaying the QMI list on non-AT cycles so the idle carrier card updates every 2 s) is a possible follow-up; it needs the overlay/restore pattern so `events.sh` never sees it.

### Frontend

Types only: `ca_source` on `DeviceStatus`, fix the stale manufacturer comment (`types/modem-status.ts:285`). One behaviour change: SCC rows lose SINR when QMI-sourced (AT gives it per LTE carrier). The carrier card already renders `null` metrics; confirm it renders an empty track, not "0".

## Build order and team

| Step | Who | Model |
|---|---|---|
| 0. Paired run (30+ simultaneous AT/QMI samples) + raw TLV capture of `0x0043`/`0x004D`/`0x0045`, read-only | modem-investigator | Haiku |
| 1. Broker codecs, join, sidecar, tests (items 1-5) | backend-writer | Sonnet High (Opus medium reviews allow-list + sidecar contract) |
| 2. Poller items 6-9 + parity fixtures (`tools/poller-parity/`) | backend-writer | Sonnet High, after 1 lands (needs the key names) |
| 3. Types + null-SINR check | main session | — |
| 4. Validation | validator + main session | — |
| 5. Docs | docs-writer | Haiku |

Steps 1 and 2 are sequential (2 consumes 1's contract); 3 is parallel. Work happens in a worktree reset onto `development-home`.

## Validation

- `cargo test --release` (new codec/join/env tests, allow-list test pinned at 19), cross-build for aarch64.
- Shell: CRLF check, BusyBox/POSIX audit, poller parity harness (AT fallback path byte-identical; QMI path carrier JSON key set identical).
- On-device (deploy to `/tmp` then `mv` + `sync`): broker restart, `qmi bands sysinfo bundle`, 30-min run beside the poller comparing `carrier_components` from both sources each cycle; check `qcmd` log shows QCAINFO gone in LTE-only and NR-change-only in NSA; check a CA add/drop produces the same `ca_change` events; SSR replay not regressed (`qmi_ssr_count`).
- `bunx tsc --noEmit` + lint on touched TS.

## Risks

- **Per-SCC signal join with multiple SCCs is unproven** (research saw one SCC). Mitigation: a carrier with no matched row publishes `null` signal, never a neighbour's value; on-device check with the 3-carrier CA seen at 09:55.
- **NR PCI tracking unproven.** Used only to trigger a QCAINFO refresh and gated by QENG agreement, so a wrong value costs one extra AT read, not wrong data.
- **`events.sh` drift** if the QMI list differs in ordering or key formatting from AT. Mitigation: same cadence, same JSON shape, SCC order = modem order on both paths; parity check of the event stream on device.
- **Allow-list growth** (DMS `0x0045`): read-only Get, but it is a pinned contract; skip item 3 if you'd rather not.

## Rollback

Broker: reinstall the 0.6.2 binary; the poller sees no `qmi_pcc_rsrp` and falls back to QCAINFO automatically. Poller: revert the commit; no UCI, init.d, installer or `/tmp` schema change (the sidecar dir and files already exist and are cleaned by the current lifecycle).

## Decisions needed

1. Approve adding DMS `0x0045` to the client allow-list (or drop item 3/9-bands).
2. Accept SCC SINR going `null` when QMI-sourced (or keep QCAINFO for LTE CA too and use QMI only for deep/idle gaps).
3. Include off-cycle freshness now, or leave it as a follow-up.

## Side findings (not in this change)

- `status.json` `lte.bandwidth` is the raw QENG enum (`5` for 20 MHz), `parse_at.sh:378,455`.
- `t2_*` CA globals are set in the Tier 1 path; poller header says QCAINFO runs "every cycle" (it runs every AT-due cycle).
