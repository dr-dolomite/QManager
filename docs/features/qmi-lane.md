# QMI Lane (`qmi`, QMI sidecars)

The broker `qmanager_atd` (0.4.1; the lane arrived in 0.3.0) serves **read-only QMI over QRTR** next to its AT path. A QMI read never touches `/dev/smd11`, never takes the modem lock and never waits behind an AT job, so LTE identity, signal and carrier aggregation stay readable (in about a millisecond) while a scan, a SIM switch or a held lock keeps AT busy. A sampler thread inside the lane also publishes the bundle as sidecar files for the poller and CGIs. **Phase 2 consumers:** the poller gap-fills LTE serving signal from `qmi.env` (`qmi_merge.sh`, see [`adaptive-polling.md`](adaptive-polling.md#13-the-qmi-overlay-wraps-the-final-write_cache-only)), and the Antenna Alignment console and the dashboard read the broker's live file ([`live-signal.md`](live-signal.md)). Nothing else calls `qmi` or reads the sidecars yet.

Process model, wire format and AT invariants: [`at-broker.md`](at-broker.md). Field verdicts behind the table below: [`../research/qmi-phase0-results.md`](../research/qmi-phase0-results.md). Design: [`../plans/2026-10-22-qmi-phase1-broker-architecture.md`](../plans/2026-10-22-qmi-phase1-broker-architecture.md).

## Quick Reference

| Item | Value |
|---|---|
| Client | `/usr/bin/qmi` → `qmanager_atd` (`at_qmi_link`; always a client) |
| Verb / reply | `QMI <nbytes> <sent_ms>\n<NUL-joined reads>` → `RES <0\|1> <n>\n<json>`; cap 1 KB; answered on the reader thread |
| Capability | `/var/run/qmanager_atd.proto` has `proto=3` and `qmi=1` (0.4.0 adds `live=1`); callers gate on both |
| Reads | `serving signal cell ca rf ids rev opmode time card slots profiles dsd`, plus `bundle` (alone) |
| Env sidecar | `/var/run/qmanager/qmi.env` (dir `0700`; sourced by the poller's `qmi_merge.sh`) |
| JSON snapshot | `/tmp/qmanager_qmi.json` (for CGIs) |
| Live lease | stamps `/var/run/qmanager/qmi_live_{aim,watch}` written by the lease CGI; see [`live-signal.md`](live-signal.md). The Phase 1 `/tmp/qmanager_qmi_live` lease is retired. |
| Code | `native/qmanager_atd/src/{qmi/,daemon/qmi_lane.rs,daemon/qmi_snapshot.rs,client/qmi.rs}` |

## Architecture

- **Registry** (`qmi/registry.rs`). One long-lived `AF_QIPCRTR` client socket per service (NAS 3, DMS 2, UIM 11, WDS 1, DSD 42), a demux thread per socket (matches responses to the waiting request by transaction id; indications go to subscribers) and a name-server watcher thread. All threads have 128 KiB stacks. Per-request timeout 1 s; the startup lookup is bounded at 500 ms. A per-service fast-fail circuit sits on top of that timeout (see [Daemon limits](#daemon-limits-cap-deadline-circuit)).
- **Requests run on the caller's thread** (a reader, the sampler, or the client process). No lock is held while waiting for a reply.
- **Codecs and model** (`qmi/codec/*`, `qmi/model.rs`) turn TLVs into QManager's vocabulary: bands `B41` / `N41`, bandwidth in whole MHz (1.4 rounds to 1), signal as whole dBm/dB plus a tenths field, absent = `null` (never `NaN`, `N/A` or an empty string).
- **Startup is off the serving path.** `qmi-start` builds the registry after the AT lane is up. Until it exists a valid request answers `modem_not_ready`; AT never waits on it.
- **Logging is state changes only** (`qmi lane up: ...`, `qmi nas up -> down`, SSR counter moves), never per request.

## Allow-list

Enforced inside the daemon (`qmi/allow.rs`) because the broker socket is the trust boundary; `Registry::request` refuses anything else before it reaches a socket (`not_supported`). Exactly 18 read-only Get pairs:

| Service | Messages |
|---|---|
| NAS | `0x0020` Signal Strength, `0x0024` Serving System, `0x0031` RF Band Info, `0x0034` System Selection Preference, `0x0043` Cell Location Info, `0x004D` Sys Info, `0x004F` Signal Info, `0x005A` Tx Rx Info, `0x00AC` LTE CPHY CA Info |
| DMS | `0x0022` Model, `0x0023` Revision, `0x0025` IDs, `0x002D` Operating Mode, `0x002F` Time |
| UIM | `0x002F` Card Status, `0x0047` Slots Status |
| WDS | `0x002A` Profile List |
| DSD | `0x0024` System Status |

- **NAS `0x0003` Indication Register is internal only** (`INTERNAL_ONLY`, reachable through the registry's own API, never from a request). It is per-client state on the daemon's socket, replayed after a rebuilt socket. Nothing calls it in Phase 1.
- **Config Signal Info v2 (NAS `0x006C`) is never allowed.** It is a config write; it needs separate approval.
- WDS `0x0024` (packet stats) and `0x002D` (current settings) are excluded: they fail without data-session ownership (Phase 0), and Data Used is parked.
- Four allow-listed messages (NAS `0x0020`, `0x0034`, `0x004D`, `0x005A`) are not used by any named read. A client can only run the named reads, never an arbitrary `(service, message)`.

## Reads and envelope

`qmi <read> [<read>...]` prints one JSON line; rc 0 ok, rc 1 failure. Up to 16 arguments; repeats are dropped; `bundle` must be alone (its keys `serving`, `signal`, `cell`, `ca`, `rf` become `data`'s own keys).

```json
{"v":1,"ok":true,"mono_ms":123456,"ssr_count":0,"data":{"serving":{...},"ca":{...}}}
{"v":1,"ok":false,"error":"modem_not_ready"}
```

| Error word | Meaning |
|---|---|
| `qmi_unavailable` | No QRTR, or the service was never found |
| `modem_not_ready` | Service down (SSR window), modem says not ready (`0x0034`, `0x004A`), transport failed, or the 1 s timeout expired |
| `not_supported` | Modem answered not supported, or the pair is not on the allow-list |
| `bad_args` | Unknown or empty read, too many reads, `bundle` combined, malformed request |
| `command_failed` | Any other QMI failure |

- **Partial failure:** `data` has one key per requested read. A failed read is `{"error":"<word>"}` in its slot and the envelope stays `ok:true` while at least one read succeeded; `ok:false` (first read's error) only when every read failed. Consumers needing all reads check each slot.
- **`mono_ms` is `CLOCK_MONOTONIC` milliseconds**, the clock of `sent_ms`. It is **not** the clock of the sidecar's `qmi_mono` (below).
- `bundle` = serving + cell + CA + RF in one round trip (4 requests). Its `signal` block comes from the cell row only: no SINR, no NR. The `signal` read also asks Signal Info (`0x004F`) and is the only read with SINR/NR values (cached).
- `ssr_count` in a client's in-process fallback is its own fresh registry's (always 0). Only the daemon's counter says anything about SSRs.

## Field coverage (RM551E, Phase 0)

| Field | Via QMI | Notes |
|---|---|---|
| LTE PCI, EARFCN, TAC, cell ID, band, bandwidth | GO | Cell Location `0x0043` + RF Band `0x0031`. Band/bandwidth are the RF entry on the serving EARFCN, else the first LTE entry, else the CA PCC. `cell` also gives eNodeB id, sector, MCC/MNC (exact digit strings). |
| Registration, RAT, PS/CS attach | GO | Serving System `0x0024`; also gates the signal fields. |
| LTE CA (PCC + SCCs: EARFCN, PCI, band, bandwidth, active) | GO | `0x00AC`. Count is at least 1 when LTE is up. SCC state 1 = configured, 2 = activated (`active`). **NR SCC is not in this message.** |
| LTE RSRP | GO, live | Serving row of `0x0043` (0.1 dB), source `cell_location`. |
| LTE RSRQ, RSSI | partial, live | Different rounding/averaging than AT. |
| LTE SINR | cached | Signal Info only, source `signal_info`. Not for live use. |
| NR ARFCN (NSA) | GO | `0x0043` TLV `0x2E`. |
| NR RSRP/RSRQ/SINR (NSA) | cached | Signal Info; 60-83 % agreement with AT. |
| NR PCI / band (NSA) | not available | TLV `0x2F` absent in NSA. Expected in SA, **untested**; `cell.nr.pci` is `null` until seen. |
| Per-antenna RSRP/RSRQ/SINR | not available | `0x005A` answers `QMI_ERR_NOT_SUPPORTED` on this firmware. Stays AT. |
| LTE timing advance | not available | No TLV tracked AT consistently. Stays AT (on-demand radio details). |
| WDS packet stats / current settings | not available | Need data-session ownership. |
| IDs, revision, op mode, time, card, slots, profiles, DSD | GO candidates | Answer in 0.1-0.6 ms; not compared field by field. |

In NSA, QMI cannot replace `QENG servingcell` or `QCAINFO`: it fills the gaps where AT is absent (idle/deep tiers, scan and SIM-switch suppression, busy streaks).

## Freshness rules

- **Registration gate.** Every signal value is `null` unless Serving System says `registered` (or serving could not be read, which is *unknown*, also gated). A searching modem still answers Cell Location with a stale serving row; the gate avoids reporting RSRP while searching. **Identity (PCI, EARFCN, ...) is not gated.**
- **Per-metric source tag.** Each reading carries `source`: `cell_location` (computed at request time) or `signal_info` (cached by the modem: LTE RSRP changed 4 times in 30 min; indications every 60 s). Live is preferred per metric; SINR and all NR values exist only as `signal_info`.
- **Range filter.** Values outside plausible ranges (RSRP -150..0 dBm, RSRQ -40..0, RSSI -130..0, SINR -30..50 dB) are invalid-value sentinels and become `null`.
- **Do not mix cached and live in a decision.** A consumer comparing QMI against AT must look at `source`.

## SSR semantics

The baseband restart (SSR) shows up as `ECONNRESET`/`ENETRESET` on a service socket or a `DEL_SERVER` from the name server, instantly.

- **Down state.** The service is marked down, its socket closed and every pending waiter answered `modem_not_ready` at once. New requests fail fast without touching a socket (no 8 s hang). A link is replaced, never repaired.
- **Recovery.** The watcher re-looks-up with backoff 250 ms doubling to 2 s; a `NEW_SERVER` brings the service back. After an SSR the first replies may be `0x004A` (mapped to `modem_not_ready`) and then `searching` before `registered`.
- **`ssr_count`.** Counts episodes: a loss counts only if no service is currently down **and** the previous loss was at least 2 s ago, so one SSR that drops five services counts once. It is the daemon's exact SSR signal (free for the watchdog later); `last_ssr_mono_ms` is kept in the registry.
- **Sidecars during an SSR** keep their last values with `qmi_state=down` and a bumped `qmi_ssr_count`; they are never deleted.

## Snapshot sidecars and the live lease

The sampler thread (`qmi-sampler`, `daemon/qmi_snapshot.rs`) reads the bundle every **2 s** (faster while a live lease is held, see below) and publishes two files (each as `<path>.new`, `O_EXCL` + `O_NOFOLLOW`, then rename). The JSON is written first and the env right after it, so the env is never older than the JSON.

| File | For | Contents |
|---|---|---|
| `/var/run/qmanager/qmi.env` | the poller (`qmi_merge.sh`) | 38 `name='value'` lines, then `qm_sidecar_end='1'` |
| `/tmp/qmanager_qmi.json` | CGIs | `{"v":1,"qmi_mono","qmi_state","qmi_ssr_count","registered","data":<bundle>}` |

**Env contract** (same as `ping.env` / `ondemand.env`, validated and sourced by `cq_env_source`):
- Every line is a single-quoted assignment; the last line is exactly `qm_sidecar_end='1'`.
- Names come from a compiled list, all `qmi_`-prefixed (never the poller's `lte_*`, `t2_*`, `nr_*`).
- Every value is an integer or empty, except `qmi_state` (`up|down|unavailable`). Never a float, `N/A` or `null`. The poller's `_qmi_env_source` is stricter than `cq_env_source`: it accepts only `qmi_*` assignments whose line is made of `[A-Za-z0-9_='-]`, so keep every value inside that set.
- Names (in file order): `qmi_mono`, `qmi_state`, `qmi_ssr_count`, `qmi_registered` (`1`/`0`, empty = unknown), `qmi_lte_{pci,earfcn,tac,cell_id,band,bw_mhz,rsrp,rsrq,rssi}`, `qmi_ca_count`, `qmi_pcc_{pci,earfcn,band,bw_mhz}`, `qmi_scc{1..4}_{pci,earfcn,band,bw_mhz,active}`. Bands are the LTE number (`41`, not `B41`); signals are whole dBm/dB, empty unless registered. Only the PCC and up to four SCCs are published; a fifth SCC is dropped.

**Semantics:**
- **`qmi_mono` is a `CLOCK_BOOTTIME` second** (the clock of `/proc/uptime`, which the poller compares against) of the last **successful** read: it shows the data's age, not the sampler's heartbeat (that is the file's mtime). Empty until the first success. This is a different clock from the envelope's `mono_ms`.
- **`qmi_state`:** `up` when this cycle's read succeeded; `down` when it failed (SSR window, not ready); `unavailable` when QRTR or the NAS service does not exist. On `down`/`unavailable` the previous values are republished.
- **Why `/var/run/qmanager`:** the poller will `source` the env, and `/tmp` is world-writable. The daemon makes the dir `0700`, owned by its euid, and verifies it before **every** env write (`safefs::ensure_own_dir`: a planted symlink, file or foreign dir is removed first). If that fails, the env is not written. The JSON is not sourced, so it stays in `/tmp`.
- **Why a sidecar and not `qmi bundle` from the poller:** sourcing adds zero forks (builtin `read`, gated by `-nt`); a per-cycle `qmi` call is about 5 ms and one fork. The sampler's cadence is independent of poller tiers, so deep tier and AT suppression still get fresh LTE data.
- A write failure is logged once (`cannot publish the qmi snapshot`) and again on recovery, never per cycle.
- **The JSON and the env are written independently.** A directory or other object planted at `/tmp/qmanager_qmi.json` (or its `.new`) fails only the JSON: the env still publishes to `/var/run/qmanager/` and the failure is reported. The planted object is left alone; the temp name is cleared when it is in the way.

**Live lease and cadence.** Phase 1's `/tmp/qmanager_qmi_live` mtime lease is **retired** (world-writable `/tmp`, wall-clock based, never used); the broker ignores it. The sampler now runs every **2 s** with no lease, **1 s** for a fresh `watch` or `aim` stamp (aim's 200 ms / 5 Hz is parked since 0.4.1, see [`live-signal.md`](live-signal.md#cadence-decision-2026-10-23)), judged on the boot clock from root-only stamps in `/var/run/qmanager`. The two sidecars are written **every 2 s** whatever the tier (and immediately on a `qmi_state` / SSR-count change and on the first sample); only the live file follows the lease rate. Samples run on a fixed deadline grid, so a lease delivers its rate rather than drifting. The live file keeps a 32-sample ring (about 32 s at 1 Hz, roughly 4-5 KB). Lease contract, token, public file and expiry: [`live-signal.md`](live-signal.md).

**Device cost (0.4.0 re-measure, 2026-10-22, RM551E):** the sampler thread adds +0.80 % of one core under an `aim` lease, and uhttpd + CGI + broker together come to 2.55 % of one core, with 5.00 Hz delivered and no samples lost. The `qmi.env` cadence under a lease is covered by unit and thread tests only and is not yet checked on the device; see [`live-signal.md`](live-signal.md#device-gate-2026-10-22-rm551e-broker-040).

**Lifecycle.** `init.d` `service_stopped` (after the broker is gone) and `uninstall.sh` remove the env (+ `.new`), JSON (+ `.new`), the old lease path and the live-signal files ([`live-signal.md`](live-signal.md#lifecycle)). Files persist across a daemon crash with stale content; judge freshness by `qmi_mono` and `qmi_state`, never by existence.

## Daemon limits (cap, deadline, circuit)

These keep a silent QMI service from starving AT of reader threads. Constants: `daemon/qmi_lane.rs` (`MAX_IN_FLIGHT`, `DEADLINE`) and `qmi/registry.rs` (`Config`).

- **In-flight cap.** At most **4** QMI requests (`MAX_IN_FLIGHT`) run in the daemon at once, so AT always keeps at least 12 of the 16 readers. The check is a non-blocking try-acquire on the reader thread. Over the cap the reader answers `ERR command_failed` at once and the `qmi` client runs the reads in-process. A "busy" warning is logged at most once a minute.
- **Lane never started.** If the QMI lane could not start (its thread failed to spawn), valid requests also get `ERR command_failed`, so the client falls back instead of seeing `modem_not_ready` forever. Argument validation runs first, so a malformed request still gets `bad_args`.
- **Overall deadline.** Each daemon request has a **2.0 s** budget (`DEADLINE`), below the client's 3 s reply timeout. Reads still pending when it passes fail `modem_not_ready` without being sent. The in-process client fallback is **not** deadline-bounded.
- **Per-service circuit.** After **2** consecutive full timeouts on a service, its requests fail `modem_not_ready` at once. One probe is let through per **1 s**. The circuit closes on any response (a QMI error counts), on a link rebuild (`NEW_SERVER` or a re-lookup), or on `mark_down`. The snapshot sampler runs on its own thread, is not counted against the cap, and is normally what probes a recovering service.
- **Panics.** The signal-read re-fetch panic sites are gone. Runtime data is never unwrapped, expected or indexed (see the invariants below).

## Client and fallback

`qmi` uses the broker only if the capability file says `proto>=3` and `qmi=1`; otherwise, or if the broker hangs up, answers `ERR` (including the cap and the dead-lane case above) or is silent for 3 s, the same reads run in the client process on its own registry (a one-shot; it opens QRTR itself). This is safe because QMI is read-only and lock-free, and both paths call the same `query::answer`, so there is one behaviour. Callers detect support with `[ -x /usr/bin/qmi ]` **plus** the capability file; a rolled-back 0.2.0 broker leaves the link inert.

## Invariants a future editor must not break

- **Keep the allow-list read-only and exact (18 pairs).** The test `exactly_the_read_only_gets` pins it. Adding a write, `0x006C`, or a client path to `0x0003` needs explicit approval.
- **QMI never goes through the AT lane or the modem lock.** That independence is the feature.
- **Signal values stay gated by registration**, and cached (`signal_info`) values stay tagged.
- **Sidecar contract:** `qmi_` prefix, integer-or-empty values, `qm_sidecar_end` last, single-quoted. A float or `N/A` breaks the poller's `jq --argjson` fallback composer; a bad line makes `cq_env_source` reject the whole file.
- **The env lives in the verified root-only dir.** Do not move it back to `/tmp`.
- **Never delete the sidecars during an SSR**, and keep `qmi_mono` as the last successful read's time.
- **Keep the sampler's lease check on the boot clock** (a stamp in the future or older than 10 s is no lease), so wall-clock steps cannot hold the rate up.
- **Keep the daemon's QMI limits.** The cap (4) must leave AT at least 12 of the 16 readers, the daemon deadline (2.0 s) must stay below the client's 3 s reply timeout, and over-cap or dead-lane requests answer `ERR command_failed` so the client falls back rather than waiting.
- **No `unwrap`, `expect` or indexing on runtime data in non-test code.** Release builds are `panic=abort`, so a panic kills every AT caller, not just the QMI request.
- **Do not put QMI values into `events.sh` input.** Its settle/churn counters count samples; a faster QMI cadence would silently retune `ca_change`. The poller overlay is applied around the final `write_cache` and restored right after it, so AT consumers only see AT samples.

## Validation

Run 2026-10-22 on an RM551E-GL (fw `RM551EGL00AAR02A01M8G`, 5G-NSA: B1 20 MHz PCC plus N41 SCC), `qmanager_atd` 0.3.0 (md5 `dbe079d2964854d91eb23209f78a4c8a`). No reboot, no SSR. AT-path results are in [`at-broker.md`](at-broker.md#qmi-phase-1-on-device-validation).

| Check | Result |
|---|---|
| `qmi bundle` latency, idle (50 back-to-back) | p50 6.5 ms, p95 8.4 ms, max 9.2 ms |
| `qmi bundle` with the modem lock held (15 s, 14 calls) | p50 9.3 ms, p95 12.4 ms. Unlocked 1 Hz control p50 9.9 ms, p95 12.2 ms: no effect |
| `qmi bundle` during real `AT+QSCAN=3,1` (180 s) | 173/173 ok, p50 8.3 ms, p95 12.2 ms, max 43.6 ms (one system hiccup). Control after the scan p50 9.2 ms, p95 13.0 ms: no effect |
| Reads and bad args | `bundle` and all 13 single reads rc 0 `ok:true`. Bad args (`bogus`, none, `bundle serving`, `-x`, `SERVING`, 17 args) rc 1 `bad_args`. Duplicate `serving serving` rc 0 (deduplicated) |
| In-process fallback, daemon stopped | rc 0 in 9 ms, same JSON path set as the daemon |
| Sidecar `qmi.env` | 38 lines plus `qm_sidecar_end='1'`. The real `cq_env_source` (`conn_state.sh`) accepts it. Dir `0700`, root |
| Live lease (Phase 1, retired in Phase 2) | Sidecar rewrites per 10 s: 5 with no lease, 21 while leased (about 2 Hz), 6 after expiry. A future-mtime lease (2030) counts as expired |
| Cross-check vs `AT+QENG` | Exact: PCI 295, EARFCN 150, B1, 20 MHz, TAC 49026, cell 36393062, RSRP −88/−88, RSRQ −10/−10, RSSI −58/−58 |
| 30-minute soak beside the poller (`qmi bundle` every 2 s) | 900/900 ok, `ssr_count` 0. Latency p50 8.9, p95 12.8, p99 14.2, max 25.1 ms. Daemon fd 12→12, threads 10→10. Smaps Rss 724→736 kB over 2000 back-to-back bundles. `netmgrd` and QCMAP unchanged |
| `compare.py`, active tier (292 fresh pairs, 10 min) | Identity 100 %. LTE RSRP within ±2 dB 98.6 % (Phase 0: 99.3 %; the 5 misses had AT 2.2–3.0 s older than QMI). RSRQ 90.1 %. RSSI 95.2 %. CA 100 % (one LTE carrier this run; Phase 0 had three) |

**Latency target.** The ≤ 10 ms target is met at p50 (6.5 ms idle, 8.3–9.3 ms under load). p95 is about 12 ms. That is client process-start cost: `qmi --version` alone is 2.3–3.6 ms p50, and the bundle minus the exec floor is 5.4 ms p50. The held lock and the scan add nothing measurable, so the intent (QMI is not blocked by AT work) holds. Whether the target is client wall time or broker time is still open, and the shell cannot measure daemon-side time.

Lifecycle on device (2026-10-22, init.d + at_engine.sh from development-home): start re-creates `/usr/bin/qmi` (also over a regular file), restarts are idempotent with no `.qmi.*` temps, stop removes qmi.env, qmanager_qmi.json, the lease, socket and capability file while leaving the rest of `/var/run/qmanager` alone, and the env passes `cq_env_source` after restart. Full install, OTA re-install and uninstall were not run (uninstall reviewed statically).

Host: `cargo test --release` 222 tests (236 with `--features poll`), including fake-QRTR tests for demux, timeout, SSR and allow-list refusal.

## Gotchas for Phase 2 consumers

- **`serving.mcc` / `serving.mnc` are integers.** The leading zero is lost (`"mnc":3` for `"03"`), so a 2- and 3-digit MNC cannot be told apart from `serving`. Read MCC and MNC from `cell.lte.mcc` and `cell.lte.mnc`, which are strings.
- **In NSA, `serving.rats` is `["lte"]`.** Do not detect NSA from it. The NR leg shows only as `cell.nr.arfcn` and the cached `signal.nr`.
- **During a network scan the QMI serving EARFCN follows the scanned carriers.** Mid-scan the serving row showed 38927/39125 at RSRP −95 on 47 samples. Do not treat that as a handover; gate on the long/scan flag (`scan_in_progress`).
- **Timing on BusyBox.** `date` has no `%N`. Read `/proc/timer_list` (`now at N nsecs`) with shell builtins for a monotonic microsecond clock, measure the exec floor (`qmi --version`) alongside, and say whether a figure includes process spawn. See `tools/atd-parity/parity.sh` for the helper.

## Phase 2 (built) and what is left

Built: the poller gap-fill and `lte.source` / `device.qmi_*` keys ([`adaptive-polling.md`](adaptive-polling.md#13-the-qmi-overlay-wraps-the-final-write_cache-only)), the live lease and static feed ([`live-signal.md`](live-signal.md)), and the Antenna Alignment / dashboard consumers. Not built (separate approval): CA gap-fill and `network.ca_source` (the poller's `t2_carrier_components` carries per-carrier signal and the NR SCC QMI cannot supply), the `radio_details.sh` network-type gate (keeps its QENG crash guard), the cell-scanner serving-cell strip, live NR/SINR/per-antenna, and NAS `0x0003` push sampling. Design: [`../plans/2026-10-22-qmi-phase2-live-tiers.md`](../plans/2026-10-22-qmi-phase2-live-tiers.md).
