# Data Used counter

The dashboard's Device & Speed card shows how much data the modem has moved (download and upload since install). The poller samples the modem's own packet counter every 30 s and stores a running total that survives data-call restarts and reboots. Originally restored by ledger U4.22 (B5.21); the counter source was replaced in broker 0.6.0 (plan: `docs/plans/2026-10-23-data-used-qmi-wds.md`, original recon: `docs/plans/u4-22-device-metrics.md`). The Storage meter (B5.22) left the dashboard in the same change.

## Files

| Layer | Path |
|---|---|
| Sampler lib (sourced by the poller) | `scripts/usr/lib/qmanager/data_used.sh` (`du_init`, `du_tick`, `du_flush`) |
| Poller call sites | `qmanager_poller`: guarded source after `alert_engine.sh`, `du_init` in `main()`, `du_tick` before `write_cache` (ALWAYS block and the scan / SIM-switch early return), `trap 'du_flush; exit 0' TERM INT` |
| Primary counter | broker sidecar `/var/run/qmanager/qmi.env` keys `qmi_wds_*` (see [`qmi-lane.md`](qmi-lane.md#wds-packet-statistics-broker-060)) |
| Persistent state | `/usrdata/qmanager/data_used.json` (UBIFS, `qm_durable_write`) |
| RAM mirror | `/var/run/qmanager/data_used.json` (rewritten every sample) |
| CGI | `network/data_used.sh` (GET). `network/data_used_reset.sh` no longer exists. |
| Frontend | `hooks/use-data-used.ts` (10 s), `types/data-used.ts`, `components/dashboard/device-metrics.tsx` |
| Unused by the UI | `hooks/use-storage.ts` and `system/storage.sh` remain in the tree but no component reads them since the Storage row left the card |
| Dev test | `tools/data-used-test/data-used-test.sh` (run on the device: `sh data-used-test.sh /path/to/data_used.sh`; 66 cases, fake sysfs and fake `qmi.env` in a scratch dir; passes under the device BusyBox) |

## Quick Reference

- Endpoint: `GET /cgi-bin/quecmanager/network/data_used.sh`
- Sources: `wds` (modem packet counter via the broker) preferred, `netdev` (`/sys/class/net/rmnet_ipa0/statistics/`) fallback.
- Sample cadence 30 s; flash flush every 5 min while counts moved, and on TERM.
- There is no reset. The total counts from install and `since` is the first sample.

## Source and direction

**Primary: `wds`.** The broker (`qmanager_atd` 0.6.0) runs two broker-internal WDS clients (IPv4 and IPv6), binds them to the data call's mux, and reads WDS `0x0024` Get Packet Statistics every 2 s (mask `0x00C0`, TLV `0x19` tx_ok_bytes, `0x1A` rx_ok_bytes). It publishes the v4+v6 sum as `qmi_wds_*` in `qmi.env`. This is the modem-side counter QCMAP uses, so it includes traffic the IPA hardware offloads for LAN clients. Bind and read details: [`qmi-lane.md`](qmi-lane.md#wds-packet-statistics-broker-060).

**Fallback: `netdev`.** `rmnet_ipa0` is the aggregate WAN netdev. The earlier assumption that it counts everything (including IPA fast-path LAN traffic) is **wrong** on the RM551E: it saw about 40 % of a modem-local download and none of the offloaded LAN traffic (`br-lan` +5.7 KB while the modem counted about 100 MB). It stays as the fallback because it needs nothing from the broker, and the UI says "may be low" for it. The two `read` builtins are unchanged from the original sampler. The AT counters (`QGDCNT`, `QGDNRCNT`) are not used: their semantics differ per firmware.

**Direction.** CGI `rx_bytes` = download, `tx_bytes` = upload, from both sources. Verified on the RM551E with directed transfers (below): no rx/tx swap anywhere.

**Source choice per sample.** `wds` is used only when all hold: `qmi.env` is complete (`qm_sidecar_end` present) and charset-clean, `qmi_state=up`, `qmi_wds_ok=1`, `qmi_wds_rx_bytes` / `qmi_wds_tx_bytes` are plain integers, and `qmi_mono` (`CLOCK_BOOTTIME` seconds, the clock of `/proc/uptime`) is within `DU_WDS_MAX_AGE` (30 s) of `/proc/uptime`. Otherwise `netdev`. **Why parsed, never sourced:** sourcing would overwrite the `qmi_*` globals that `qmi_merge.sh` owns in the same poller process.

## Cadence (B5.29 hot-path rules)

| When | Work | Forks |
|---|---|---|
| every cycle (2 s) | a counter test only | 0 |
| every 15 cycles (30 s) | read `qmi.env` (builtin `read` loop) or netdev, sample, RAM mirror | 1 (`mv`) |
| every 10 samples (5 min) while counts moved, at start, on TERM | `qm_durable_write` to `/usrdata` (two global `sync`s) | about 6 |

`status.json` is not touched, so the printf composer and the parity harness (`tools/poller-parity/`, parsers and composers only) are unaffected.

## Counter rules

Applied to whichever source was chosen for the sample.

| Event | Detection | Action |
|---|---|---|
| normal | `cur >= prev` on both | add the delta |
| counter restart (data call restart, SSR, PDN drop, mode switch, wrap) | `cur < prev` on either | the counter restarted at 0: add `cur`, `iface_resets += 1` |
| source switch (`wds` <-> `netdev`) | chosen source differs from the stored `source` | `prev` = the new source's `cur`, add nothing, **not** counted as a reset (never a cross-source delta); logged |
| reboot | stored `boot_id` != `/proc/sys/kernel/random/boot_id` | first sample of the boot adds `cur` |
| first start (no file) | load fails, no file | baseline only; bytes from before the install are not counted |
| file from before the `source` field | no `.source` key | `prev` is treated as `netdev` |
| corrupt or other-schema file | a field fails its numeric guard | start from zero, log once |
| no source readable | wds unusable and netdev `read` fails the `case` guard | skip, keep state, `iface_present:false` |

The WDS counter restarts from 0 with each data call, including after an SSR. On the device an SSR at 15:36 restarted the call, the counter restarted from 0 (QCMAP agreed), and the `cur < prev` path absorbed it.

Loss bounds: an unplanned reboot loses at most one flush window (5 min); a planned stop flushes through the TERM trap (ash runs it after the current `sleep`, at most 2 s). Two counter restarts inside one 30 s window lose the bytes before the second. Shell arithmetic on the device is 64-bit.

`since` and `updated` are wall clock and stored as 0 while the clock is below `DU_SANE_EPOCH` (1700000000, the 1970 boot window); the card then shows no date.

> ℹ️ NOTE: An IPv6-only call (no IPv4 default route) has no mux for the broker to bind, so it counts as no call and the sampler falls back to `netdev`.

## File schema

`{"schema":1,"rx_bytes":N,"tx_bytes":N,"since":EPOCH|0,"updated":EPOCH|0,"iface":"rmnet_ipa0","source":"wds"|"netdev","iface_present":BOOL,"iface_resets":N,"boot_id":"...","prev_rx":N,"prev_tx":N}`. Written with `printf`, read once at start with one `jq` call. Schema stays 1: older files lack `source` and load as `netdev`; an older lib reading a newer file ignores the extra key. The poller is the only writer of both files.

## CGI contract

`GET network/data_used.sh` returns `{success:true, available:true, rx_bytes, tx_bytes, since, updated, iface_present, source, stale}`, or `{success:true, available:false}` before the first sample or when the mirror is unreadable.

- `source` is `"wds"` or `"netdev"`, defaulting to `netdev` for mirrors written before the field existed.
- `stale` = the mirror's mtime is older than 90 s (the poller stopped). The card shows absence for `available:false` and `stale:true`.
- The reset endpoint (`network/data_used_reset.sh`), its flag (`/var/run/qmanager/data_used_reset`, `_du_do_reset`) and the error codes `poller_not_running` / `reset_failed` (removed from `errors.json` in all five catalogs) were deleted on 2026-10-23 by user decision. **Why:** the reset added a cross-process handshake for a feature nobody needed once the total became trustworthy. `install_tree` swaps the CGI tree, so upgrades drop the old CGI.

## Frontend

- Data Used is a `PillRow` in the **old Storage slot** of the Device & Speed card (the Storage row is gone from the card). Download with the down arrow and upload with the up arrow (direction ink on the glyph only), three significant figures through the card-local `formatTotal` so the label fits at 375 px. Card height is unchanged (trio row measured at 478 px).
- A `HintIcon` appears only while `source` is `netdev`, saying the figure may be low. It disappears on `wds`.
- No reset button, dialog or reset toast.
- The row is not gated by `modem_reachable`: it is read on the box, not over AT.

## Lifecycle

Install and update copy the lib and the CGI with their trees and restart the poller; the state file survives updates. Uninstall removes `/var/run/qmanager` (the run copy) always, and `/usrdata/qmanager/data_used.json` only with `--purge` (`remove_config`); `--keep-config` keeps the counter, and a fresh install after it continues from the saved total (checked on the RM551E 2026-10-25: counter kept across OTA, uninstall and reinstall, file 248 B throughout and rewritten only by normal flushes, `source: "wds"` after). Not in config backup (a usage counter is not a setting).

## Validation (RM551E, 2026-10-23)

| Check | Result |
|---|---|
| Spike: freshly bound client vs `QCMAP_CLI` | WDS rx 730,328,803 vs QCMAP 730,344,017 (QCMAP read a moment later) |
| Directed download, 100 MB on the modem | WDS rx +104.17 MB / tx +0.30; QCMAP +104.17 / +0.30; `rmnet_data0` +100.88 / +0.29; sampler +104.06 / +0.26 |
| Directed upload, 30 MB POST of zeros | WDS rx +0.24 / tx +31.23; QCMAP identical; `rmnet_data0` +0.23 / +31.19; sampler +0.24 / +31.23 |
| Direction in the browser | CGI `rx_bytes` shown as download, `tx_bytes` as upload |
| SSR at 15:36 | call restarted, WDS counter restarted from 0 (QCMAP agreed), rebase path absorbed it |
| `rmnet_ipa0` vs reality | about 40 % of a modem-local download, none of the IPA-offloaded LAN traffic |
| Parity / CPU (9 x 60 s) | WDS vs QCMAP_CLI within 0.4-1.7 KB on every sample in both directions (read skew only), `qmi_wds_ok=1` throughout. Broker 0.67 % of one core over 525 s (0.5.0 measured 0.40-0.55 %) |
| Sampler tests | 66 cases pass under the device BusyBox |
| Broker host tests | 267 (281 with `--features poll`) |

## Rollback

Install the 0.5.0 broker binary and the previous `data_used.sh` lib. State is compatible both ways: the older lib ignores `source` and keeps counting `rmnet_ipa0` (its `prev_*` then belong to the other source, so it may add one bogus delta or restart-add at the switch), and a newer lib reading an older file treats it as `netdev`. Without the 0.6.0 broker, `qmi_wds_*` keys are absent, so the sampler stays on `netdev` by itself. A rolled-back UI would show the reset button against a deleted CGI, so roll the frontend back together with the CGI tree.
