# QMI Lane (`qmi`, QMI sidecars)

The broker `qmanager_atd` (0.3.0) serves **read-only QMI over QRTR** next to its AT path. A QMI read never touches `/dev/smd11`, never takes the modem lock and never waits behind an AT job, so LTE identity, signal and carrier aggregation stay readable (in about a millisecond) while a scan, a SIM switch or a held lock keeps AT busy. A sampler thread inside the lane also publishes the bundle as sidecar files for the poller and CGIs. **Phase 1 only builds the lane: nothing consumes the sidecars or calls `qmi` yet** (the poller, CGIs and UI are still AT-only; adoption is Phase 2).

Process model, wire format and AT invariants: [`at-broker.md`](at-broker.md). Field verdicts behind the table below: [`../research/qmi-phase0-results.md`](../research/qmi-phase0-results.md). Design: [`../plans/2026-10-22-qmi-phase1-broker-architecture.md`](../plans/2026-10-22-qmi-phase1-broker-architecture.md).

## Quick Reference

| Item | Value |
|---|---|
| Client | `/usr/bin/qmi` → `qmanager_atd` (`at_qmi_link`; always a client) |
| Verb / reply | `QMI <nbytes> <sent_ms>\n<NUL-joined reads>` → `RES <0\|1> <n>\n<json>`; cap 1 KB; answered on the reader thread |
| Capability | `/var/run/qmanager_atd.proto` has `proto=3` and `qmi=1`; callers gate on both |
| Reads | `serving signal cell ca rf ids rev opmode time card slots profiles dsd`, plus `bundle` (alone) |
| Env sidecar | `/var/run/qmanager/qmi.env` (dir `0700`; for the poller, Phase 2) |
| JSON snapshot | `/tmp/qmanager_qmi.json` (for CGIs) |
| Live lease | `/tmp/qmanager_qmi_live` (touch to raise the rate) |
| Code | `native/qmanager_atd/src/{qmi/,daemon/qmi_lane.rs,daemon/qmi_snapshot.rs,client/qmi.rs}` |

## Architecture

- **Registry** (`qmi/registry.rs`). One long-lived `AF_QIPCRTR` client socket per service (NAS 3, DMS 2, UIM 11, WDS 1, DSD 42), a demux thread per socket (matches responses to the waiting request by transaction id; indications go to subscribers) and a name-server watcher thread. All threads have 128 KiB stacks. Per-request timeout 1 s; the startup lookup is bounded at 500 ms.
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

The sampler thread (`qmi-sampler`, `daemon/qmi_snapshot.rs`) reads the bundle every **2 s** and publishes two files (each as `<path>.new`, `O_EXCL` + `O_NOFOLLOW`, then rename). The JSON is written first and the env right after it, so the env is never older than the JSON.

| File | For | Contents |
|---|---|---|
| `/var/run/qmanager/qmi.env` | the poller (Phase 2) | 38 `name='value'` lines, then `qm_sidecar_end='1'` |
| `/tmp/qmanager_qmi.json` | CGIs | `{"v":1,"qmi_mono","qmi_state","qmi_ssr_count","registered","data":<bundle>}` |

**Env contract** (same as `ping.env` / `ondemand.env`, validated and sourced by `cq_env_source`):
- Every line is a single-quoted assignment; the last line is exactly `qm_sidecar_end='1'`.
- Names come from a compiled list, all `qmi_`-prefixed (never the poller's `lte_*`, `t2_*`, `nr_*`).
- Every value is an integer or empty, except `qmi_state` (`up|down|unavailable`). Never a float, `N/A` or `null`.
- Names (in file order): `qmi_mono`, `qmi_state`, `qmi_ssr_count`, `qmi_registered` (`1`/`0`, empty = unknown), `qmi_lte_{pci,earfcn,tac,cell_id,band,bw_mhz,rsrp,rsrq,rssi}`, `qmi_ca_count`, `qmi_pcc_{pci,earfcn,band,bw_mhz}`, `qmi_scc{1..4}_{pci,earfcn,band,bw_mhz,active}`. Bands are the LTE number (`41`, not `B41`); signals are whole dBm/dB, empty unless registered. Only the PCC and up to four SCCs are published; a fifth SCC is dropped.

**Semantics:**
- **`qmi_mono` is a `CLOCK_BOOTTIME` second** (the clock of `/proc/uptime`, which the poller compares against) of the last **successful** read: it shows the data's age, not the sampler's heartbeat (that is the file's mtime). Empty until the first success. This is a different clock from the envelope's `mono_ms`.
- **`qmi_state`:** `up` when this cycle's read succeeded; `down` when it failed (SSR window, not ready); `unavailable` when QRTR or the NAS service does not exist. On `down`/`unavailable` the previous values are republished.
- **Why `/var/run/qmanager`:** the poller will `source` the env, and `/tmp` is world-writable. The daemon makes the dir `0700`, owned by its euid, and verifies it before **every** env write (`safefs::ensure_own_dir`: a planted symlink, file or foreign dir is removed first). If that fails, the env is not written. The JSON is not sourced, so it stays in `/tmp`.
- **Why a sidecar and not `qmi bundle` from the poller:** sourcing adds zero forks (builtin `read`, gated by `-nt`); a per-cycle `qmi` call is about 5 ms and one fork. The sampler's cadence is independent of poller tiers, so deep tier and AT suppression still get fresh LTE data.
- A write failure is logged once (`cannot publish the qmi snapshot`) and again on recovery, never per cycle.

**Live lease.** A caller touches `/tmp/qmanager_qmi_live`; while its mtime is within **10 s**, the sampler runs every **500 ms** (2 Hz; the floor is 200 ms / 5 Hz). Without it, 2 s. The lease is judged by mtime against the wall clock, which steps on this modem after an SSR or NTP sync, so an mtime **in the future or older than 10 s counts as expired**: a clock step can only drop the rate to 2 s until the next renewal, never hold it up. Phase 0 measured about 0.5 % CPU at 10 Hz.

**Lifecycle.** `init.d` `stop_service` and `uninstall.sh` remove the env (+ `.new`), JSON (+ `.new`) and lease. Files persist across a daemon crash with stale content; judge freshness by `qmi_mono` and `qmi_state`, never by existence.

## Client and fallback

`qmi` uses the broker only if the capability file says `proto>=3` and `qmi=1`; otherwise, or if the broker hangs up, answers `ERR` or is silent for 3 s, the same reads run in the client process on its own registry (a one-shot; it opens QRTR itself). This is safe because QMI is read-only and lock-free, and both paths call the same `query::answer`, so there is one behaviour. Callers detect support with `[ -x /usr/bin/qmi ]` **plus** the capability file; a rolled-back 0.2.0 broker leaves the link inert.

## Invariants a future editor must not break

- **Keep the allow-list read-only and exact (18 pairs).** The test `exactly_the_read_only_gets` pins it. Adding a write, `0x006C`, or a client path to `0x0003` needs explicit approval.
- **QMI never goes through the AT lane or the modem lock.** That independence is the feature.
- **Signal values stay gated by registration**, and cached (`signal_info`) values stay tagged.
- **Sidecar contract:** `qmi_` prefix, integer-or-empty values, `qm_sidecar_end` last, single-quoted. A float or `N/A` breaks the poller's `jq --argjson` fallback composer; a bad line makes `cq_env_source` reject the whole file.
- **The env lives in the verified root-only dir.** Do not move it back to `/tmp`.
- **Never delete the sidecars during an SSR**, and keep `qmi_mono` as the last successful read's time.
- **Keep the sampler's lease check tolerant of clock steps** (future mtime = expired).
- **Do not put QMI values into `events.sh` input.** Its settle/churn counters count samples; a faster QMI cadence would silently retune `ca_change`. (Phase 2 rule.)

## Validation

Pending on-device results (to be filled in): `qmi bundle` in 10 ms or less during a held modem lock and during a real `AT+QSCAN`; in-process fallback with the daemon stopped; fd count and RSS flat across a forced or real SSR; 30-minute soak with `qmi bundle` every 2 s beside the poller; install, OTA re-install and uninstall leave no strays. Host: `cargo test --release` 211 tests (225 with `--features poll`), including fake-QRTR tests for demux, timeout, SSR and allow-list refusal.

## Phase 2 (not built)

The poller gap-fills from `qmi.env` (`qmi_merge.sh`; AT from the same cycle always wins), new `status.json` keys (`lte.source`, `network.ca_source`, `device.qmi_*`), a live-lease CGI for the dashboard and antenna aiming, then `radio_details.sh` and the cell-scanner serving cell. See the design plan section 2b.
