# Adaptive Polling

Adaptive Polling makes the QManager AT poller ease off modem interrogation when no browser session is active, and instantly resumes full-rate reads when the dashboard is opened. The base poll rate is 2 s; during an unattended idle stretch the poller steps down through graduated tiers that reduce the AT-port cadence to ~60 s per read, cutting accumulated background load by ~97% without making the dashboard sluggish for a returning user.

**Origin:** this feature is the productised mitigation for the RM551E MPSS-SSR root cause — sustained 2 s polling of the modem's data-plane/config subsystem (`CGCONTRDP`, `QMAP="WWAN"`, `QNWCFG`) drives a periodic Qualcomm MPSS baseband subsystem restart (~every 100 min) on v4-only carriers, confirmed by captured `dmesg` evidence and the `QCMAP:bringup v6` retry storm. A blanket `POLL_INTERVAL=15` diagnostic patch was retired in favour of Adaptive Polling. v0.1.28 then completed a partial fix by gating the entire Tier-2 block (identity + data-plane) to Active-only — the `[ "$ap_tier" = "active" ] || return 0` guard is the first statement in `poll_tier2()`. A subsequent change (post-v0.1.28) went further: the data-plane/L1 group (`CGCONTRDP`, `QMAP="WWAN"`, `*_time_advance`, `*_mimo_layers`) was **removed from the poller entirely** and relocated to a dedicated on-demand CGI endpoint (`cellular/radio_details.sh`) that only fires while the page displaying those values is open. Tier 2 now contains identity reads only. See Invariant 6 and [`docs/features/ondemand-radio-details.md`](ondemand-radio-details.md).

## Quick Reference

| Item | Value |
|---|---|
| Page route | `/system-settings/adaptive-polling` |
| CGI | `GET/POST /cgi-bin/quecmanager/system/adaptive_polling.sh` |
| UCI section | `quecmanager.poller.{enabled,active_grace,idle_interval,idle_threshold,deep_idle_interval}` |
| Heartbeat file | `/tmp/qmanager_ui_active` (epoch seconds, written by status CGIs) |
| Poller reload flag | `/tmp/qmanager_poller_reload` |
| Force-active flag | `/tmp/qmanager_force_tier2` |
| Prometheus scrape file | `/var/run/qmanager/metrics_scrape` (`"<mode> <uptime_s>"`, written by the scrape CGI; TTL `METRICS_LEASE_TTL=120`; Invariant 11) |
| SIM-switch quiesce flag | `/tmp/qmanager_sim_switch_active` (producer `cellular/settings.sh`; early-return alongside `LONG_FLAG`; mtime-bounded 60 s) |
| Tier field in status.json | `.device.poller_tier` — `"active"` | `"idle"` | `"deep"` |
| Radio read-age fields | `.device.serving_read_mono`, `.device.ca_read_mono` (uptime s of the last `+QENG:` reply / `AT+QCAINFO` parse; `0` = never) |
| AT read cap | `QC_WAIT_MS=2500`, passed per call as `QCMD_WAIT_MS` (Invariant 8); per-cycle busy latch `_AT_LATCH` / `_AT_BUSY`, rc 3 = not run |
| status.json composer | `_wc_compose_pf` (printf, compact one line); `write_cache_jq` is the safety net (Invariant 9) |
| Sidecars | `/var/run/qmanager/{ping,dns,ondemand}.env` (Invariant 10) |
| Parity gate (dev-only) | `tools/poller-parity/` (`parity.sh`, `status_parity.sh`, `sidecar_parity.sh`, `measure.sh`) |
| Reboot required | No |

---

## Tier Architecture

The poller reads `heartbeat_age = now − contents_of(/tmp/qmanager_ui_active)` at the start of each cycle and selects a tier:

| Tier | Condition | AT-port cadence |
|---|---|---|
| Active | `heartbeat_age ≤ active_grace` (default 20 s) | Every base cycle (2 s) |
| Idle | `heartbeat_age ≤ idle_threshold` (default 300 s) | Every `idle_interval` (default 15 s) |
| Deep | `heartbeat_age > idle_threshold` | Every `deep_idle_interval` (default 60 s) |

**AT-due gating:** the AT block runs when `cycle_count % (interval / POLL_INTERVAL) == 0`. Both interval values are clamped `>= POLL_INTERVAL` so the divisor is always ≥ 1, preventing a divide-by-zero and ensuring the interval is a meaningful multiple of the base rate. The division is integer: the default `idle_interval` of 15 s becomes 7 cycles (14 s), while `deep_idle_interval` 60 s is exactly 30 cycles. Treat the configured value as a target, not an exact period. `cycle_count` advances on every cycle, including the scan / SIM-switch early return, so these moduli and the ping-history cadence keep their rhythm through a scan.

**Full-refresh on re-entry:** when an idle or deep AT touch fires, the poller runs Tier 1 + Tier 1.5 + Tier 2 unconditionally (ignoring their individual per-tier modulo counters). This guarantees that the first data a returning user sees is a complete, current snapshot rather than a partial one.

**Fixed-clock base cycle:** the 2 s base cycle is a true 2 s period, not "work + a 2 s sleep". `main()` reads `/proc/uptime` in centiseconds (`_uptime_cs`, builtins only) before and after `poll_cycle` and sleeps `POLL_INTERVAL` minus the cycle's own time. An overrun skips the sleep and never catches up (no burst of back-to-back cycles); if `/proc/uptime` is unreadable the loop falls back to a plain `sleep "$POLL_INTERVAL"`. `cycle_count` still counts cycles, so every tier modulo above is unchanged.

**Why:** before the re-author (ledger B5.29) a cycle took about 1.5 s of work on top of the 2 s sleep, so `status.json` landed every ~3.5 s while the docs and the UI assumed 2 s. The AT broker (`qmanager_atd`) serialises AT traffic, so the old per-call settle delay (`SIP_DELAY`) is gone. Measured on the RM551E after the re-author: `status.json` period 2.00 s (1.92 to 2.22 s) in the active and deep tiers, `.mono` age at most 2 s.

**Measured impact (AT cadence):** at the 2 s baseline, active tier runs ~270 AT commands/min (full rate). Idle tier runs 4 `qcmd` invocations per `idle_interval` — QENG, QCAINFO, CFUN?, and the compound QRSRP;QRSRQ;QSINR (6 AT commands total) — roughly 24 AT commands/min at the 15 s default. Deep tier runs exactly **1 `qcmd` invocation per `deep_idle_interval`** (`AT+QENG="servingcell"` only) — ~1 AT command/min at the 60 s default — a ~99.6% reduction from active rate.

**Measured impact (poller CPU, RM551E, `tools/poller-parity/measure.sh`, 60 s windows; CPU includes the poller's child processes, one core):**

| Tier | Metric | Before B5.29 (2026-10-19) | After Phase 1 only (2026-10-18) | After Phases A, B and C (2026-10-19) |
|---|---|---|---|---|
| Active | CPU (percent of one core) | 39% | 11.5% | **4.92%** |
| Active | System forks/s (system-wide, includes the ping daemon) | 183 | 28 | ~11.5 (about 23 per cycle) |
| Active | `status.json` period | 3.73 s (3.35 to 4.12) | 1.99 s (1.79 to 2.10) | 2.00 s (1.92 to 2.22) |
| Active | `.mono` age, max | 4 s | 2 s | 2 s |
| Idle | CPU | 22 to 25% (74 to 87 forks/s) | 4.6% (8 to 10 forks/s, period 2.00 s) | not re-measured |
| Deep | CPU | not measured | not measured | **2.62%** (7.3 forks/s, period 2.00 s, `.mono` age max 2 s) |

The Phase 1 windows ran while the modem's internet was down, so treat that column as indicative. The last column meets the gates of the row (active at most 10%, period 2.0 s plus or minus 0.2, `.mono` age under 3 s). The 12-hour soak on this build passed (2026-10-19 10:22 to 2026-10-20 01:30 PHT, 144 windows across 8 reboots): active 4.87%, idle 3.31%, deep 2.41% of a core, period 2.00 to 2.02 s with no window outside 1.8 to 2.2 s, no poller crash through a cluster of 25 baseband SSRs. `.mono` age read 3 s in steady windows (integer-second sampling) and peaked at 7 s inside the SSR cluster.

**Fault injections (2026-10-19, same build):**

| Fault | Result |
|---|---|
| Modem lock held 15 s (`flock` on `/var/lock/qmanager.lock`) | `.mono` age max 5 s, longest `status.json` period 4.42 s (gates: under 6 s and at most 4.5 s). Before the per-cycle busy latch (Invariant 8) the same test gave a 12 s cycle. |
| Natural baseband SSR inside that window (`nr_rx_ctl_agc.c` fatal error) | The poller stayed within the same gates. The wall clock stepped back about 80 s and forward again (NITZ), so `qmanager.log` timestamps around an SSR can be out of order; use `.mono`. |
| Broker `kill -9` | procd respawned `qmanager_atd` in 5.2 s, period max 2.21 s, `.mono` age max 2 s. While the socket is dead, `qcmd` runs the exchange in-process. |

The design and the evidence log are in [`docs/architecture/poller-on-broker.md`](../architecture/poller-on-broker.md).

---

## Heartbeat

Two CGIs refresh `/tmp/qmanager_ui_active` on every response:

- `at_cmd/fetch_data.sh` — authenticated; fires only for real browser sessions.
- `public/overview.sh` — unauthenticated; fires on any hit (e.g. third-party integrations).

Each writes `date +%s` to `/tmp/qmanager_ui_active.$$` and then `mv -f` onto the real file (the temp file is removed if either step fails), so the poller never sees a truncated file. Any hit to either endpoint resets the heartbeat clock, extending the Active window.

> ℹ️ NOTE: The heartbeat file contains a plain epoch integer. On an empty or non-numeric read the poller reuses the last good heartbeat epoch instead of treating the age as infinite, and it strips leading zeros before doing arithmetic. A file that is absent from the start (no last good value) still resolves to maximum age; boot seeding (see Invariant 3 below) prevents that on a fresh start.

---

## UCI Configuration

```
quecmanager.poller=poller
quecmanager.poller.enabled=1
quecmanager.poller.active_grace=20
quecmanager.poller.idle_interval=15
quecmanager.poller.idle_threshold=300
quecmanager.poller.deep_idle_interval=60
```

**The section is never seeded by the installer.** Absence means defaults — the same `isDefault` pattern used by `quecmanager.quality_thresholds`. The poller's `resolve_poller_config()` applies the defaults when the section is missing, so the feature works correctly on a fresh install before the user has ever opened the settings page.

> ℹ️ NOTE: If you need to reset to factory defaults, remove the UCI section: `uci delete quecmanager.poller && uci commit quecmanager`. The next poller cycle will revert to the hardcoded defaults.

Live reload: the CGI drops `/tmp/qmanager_poller_reload`; the poller's `resolve_poller_config()` consumes the flag within one base cycle (~2 s). No daemon restart, no procd touch.

---

## Apply / Reload Pipeline

```
UI card  ──POST──▶  CGI  ──uci commit──▶  /etc/config/quecmanager
                     │
                     └──touch /tmp/qmanager_poller_reload
                                │
                  (within ≤1 base cycle, ~2 s)
                                │
         qmanager_poller  ──▶  resolve_poller_config()  ──▶  rm flag
```

---

## Invariants

These are non-obvious constraints verified on-device. Violating any of them produces silent failures.

### 1. `write_cache` and `read_ping_data` run every base cycle regardless of tier

The connection watchdog (`qmanager_watchcat`) keys its freshness check on the root `.timestamp` field in `status.json` and reads `.connectivity.*` for quality-trigger decisions. Both fields are populated by `write_cache` and `read_ping_data` respectively. If the poller were to skip `write_cache` on idle/deep cycles, `status.json` would go stale, and the watchdog's quality trigger would silently stop working.

**Why:** AT backoff applies only to the AT-port read block. The local-only work — `write_cache`, `read_ping_data`, proc metrics — always runs at the 2 s base cadence. The two concerns are deliberately decoupled in the poller loop.

### 2. Force-to-Active flags guarantee exactly one full AT cycle then release

Two conditions pin the poller to Active regardless of heartbeat age:

- `/tmp/qmanager_force_tier2` present — written by `qmanager_profile_apply` (complete/partial finalise block) for scenario-cron and ICCID auto-apply changes, so those reflect in `status.json` within ~2–4 s even while the poller is deep-idle. **Note:** `apn_mgr.sh` no longer drops this flag for APN refresh; it calls `ondemand_dataplane_refresh()` directly instead (because the data-plane reads are no longer in Tier 2 — see Invariant 6).
- `/tmp/qmanager_refresh_policy_band` present — written on SIM-swap to trigger a policy-band re-read.

Both are one-shot: each flag forces exactly one Active cycle, then the poller removes the flag and returns to whatever tier the heartbeat age dictates. Tower-lock state no longer affects tier selection — see Known Gotchas.

**A third flag does the opposite — quiesces rather than forces:** `/tmp/qmanager_sim_switch_active`, produced by `cellular/settings.sh` for the duration of a SIM slot switch's CFUN/QUIMSLOT sequence, is checked in the same early-return block as `LONG_FLAG` (not the force-to-active block above) — when present, the poller skips its AT-bearing work entirely for that cycle and reports `system_state: "scan_in_progress"`, rather than being forced to run one. This prevents poller `qcmd` traffic from contending with the CFUN/QUIMSLOT sequence, which was the root cause of a silent SIM-slot-switch failure (see [custom-sim-profiles.md](custom-sim-profiles.md) — "Verified QUIMSLOT Read-Back"). Like the force flags it is mtime-bounded (60 s) so a CGI that dies mid-switch cannot mute polling forever, but unlike them it is trap-cleared by its producer rather than consumed by the poller in the success path.

### 3. Boot seeds the heartbeat file before entering the poll loop

`main()` in `qmanager_poller` writes the current epoch to `/tmp/qmanager_ui_active` before the loop starts. This guarantees the poller starts in Active for at least one `active_grace` window.

**Why:** without seeding, a freshly-started poller has no heartbeat file. The heartbeat age resolves to "infinite," placing the poller in Deep immediately. A user who opens the dashboard right after a reboot would get stale or absent data for up to 60 s while the poller waited for its first deep AT touch.

### 4. Lifecycle cleanup is the init.d `stop_service()` responsibility

`/etc/init.d/qmanager`'s `stop_service()` removes `/tmp/qmanager_ui_active` (and any leftover `/tmp/qmanager_ui_active.*` temp files from an interrupted heartbeat write), `/tmp/qmanager_poller_reload`, `/var/run/qmanager/ondemand.stamp`, and the dev tap flag and ring (`/var/run/qmanager/poller_tap`, `/var/run/qmanager/tap/`), the `ping.env` / `dns.env` / `ondemand.env` sidecars (and their `.new` temp files), the watchcat / SIM read stamps and the dev status-parity hook (`wc_parity`, `wcp/`). This prevents stale epoch values from causing a misleading Active state the next time the poller starts before `main()` can re-seed. The CGI is auto-deployed via the `install_tree` cgi-bin copy at install/upgrade time — no UCI seed step and no manual file placement needed.

### 5. Non-baseline `POLL_INTERVAL` collapses idle/active distinction

If `POLL_INTERVAL` were raised to match `idle_interval` (e.g. both at 15 s), the `cycle_count % (15 / 15) == 0` gate would fire every cycle, making Idle behaviorally identical to Active. The feature is only meaningful at the 2 s baseline, which is now a real 2 s period (fixed-clock loop, see Tier Architecture), so `interval / POLL_INTERVAL` is a true wall-clock multiple. The retired 15 s diagnostic patch exhibited this collapse; Adaptive Polling was introduced so the 2 s baseline could be safely restored while still shedding idle AT load.

### 6. The data-plane/L1 group is removed from the poller entirely (RM551E-GL SSR fix — final state)

This invariant has two layers, applied across two releases:

**Layer A (v0.1.28 Active-tier gate):** `poll_tier2()` still exists and is guarded by `[ "$ap_tier" = "active" ] || return 0` as its first statement, so the entire function early-returns when the poller is Idle or Deep. When unattended, the only AT commands that run are the Tier-1 signal set.

**Layer B (post-v0.1.28 full removal):** The data-plane/L1 group that previously lived inside `poll_tier2()` has been **removed from the poller entirely** — not merely gated. `poll_tier2()` now contains only the identity reads. The removed commands are fetched on demand by `cellular/radio_details.sh` only while the page displaying them is open. See [`docs/features/ondemand-radio-details.md`](ondemand-radio-details.md) for the full on-demand contract.

**When the poller is Idle, the Tier-1 signal set runs in full:**

- `AT+QENG="servingcell"` — serving-cell signal metrics
- `AT+QCAINFO=1;+QCAINFO;+QCAINFO=0` — carrier-aggregation info. Extended reporting is switched on, read and switched off in one exchange (QuecManager's pattern); never leave `AT+QCAINFO=1` set at boot or between cycles, since a persistent `=1` drops the connection on RM551E R01A04 (confirmed by field test, fixed in v0.1.34).
- `AT+CFUN?` — radio function state
- `AT+QRSRP`; `AT+QRSRQ`; `AT+QSINR` — per-antenna RSRP/RSRQ/SINR

**When the poller is Deep, only `AT+QENG="servingcell"` runs.** QCAINFO, CFUN?, and the per-antenna reads (`QRSRP`/`QRSRQ`/`QSINR`) are wrapped in an `if [ "$ap_tier" != "deep" ]; then ... fi` guard and do not execute. This is the minimum needed to keep `qmanager_tower_failover` operational (see Invariant 7 below); everything else holds last-known values via `write_cache`.

**When the poller is Active, Tier 2 adds only the identity group:**

- `AT+COPS?` (carrier name), `AT+QUIMSLOT?` (SIM slot), `AT+CNUM` (phone number), `AT+CPIN?` (SIM/PIN status)

**The following are no longer in the poller at all (on-demand only):**

- `AT+CGCONTRDP` (WAN IP/APN/DNS), `AT+QMAP="WWAN"` (WAN state), `AT+QNWCFG="*_time_advance"` (timing advance / cell distance), mode-gated `AT+QNWCFG="*_mimo_layers"` (active MIMO)

**Why:** On v4-only carriers the modem firmware runs a perpetual `QCMAP:bringup v6` retry storm — the PDP context is `IPV4V6`, the carrier responds with IPv4 only, and QCMAP retries forever with no backoff. Any recurring AT command that reaches into the registration, data-plane, or L1 measurement subsystem on top of that sustained thrashing correlates with a Qualcomm MPSS baseband subsystem restart (SSR, `qcom_q6v5_pas 4080000.remoteproc-mss: fatal error received ... DALSysLogEvent.c`) on a ~100-minute clock-regular cadence, dropping the data plane for ~15 seconds per event. The predecessor tool (QuecManager) issued none of these commands on a timer — only on UI demand — and did not exhibit the drops. Full removal (not just active-gating) matches that proven-safe steady state for both attended and unattended operation.

**Stale-but-cached fields:** WAN IP, APN, DNS servers, timing advance / cell distance, active MIMO layers. All fields hold their last-known values in `status.json` (populated via `write_cache()` → `load_ondemand_cache()`). Carrier name, SIM slot, phone number, SIM/PIN status remain in Tier 2 (active-only). No feature depends on the on-demand fields being live while the UI is idle.

**Apply paths:** `qmanager_profile_apply` and `apn_mgr.sh` now call `ondemand_dataplane_refresh()` (backgrounded) instead of touching `/tmp/qmanager_force_tier2`, because Tier 2 no longer contains the data-plane reads. This gives APN refresh within seconds of an apply without reintroducing L1 reads.

**Human verification note:** confirmation that the fix holds is a debug report captured after an extended unattended session showing the clock-regular `remoteproc-mss: fatal error` SSR cadence stretching out or stopping entirely.

### 7. Deep tier runs serving-cell only; CA fields are intentionally retained

**Why `AT+QENG="servingcell"` must stay in deep:** `parse_serving_cell()` is the sole source of the `.lte.rsrp` and `.nr.rsrp` scalars in `status.json`. `qmanager_tower_failover` reads those fields (`jq -r '.lte.rsrp // empty'`, fallback `.nr.rsrp`) every 20 s to decide whether to release the tower lock. Removing QENG from deep would leave `qmanager_tower_failover` reading stale RSRP indefinitely and break automatic tower-lock release for users who leave the dashboard closed.

**RSRP staleness in deep:** tower-lock failover may act on RSRP up to one `deep_idle_interval` (default 60 s) old while the UI is idle. This is unchanged from before this guard — the staleness window did not widen.

**Why QCAINFO/CFUN?/per-antenna are dropped in deep:** the per-antenna `QRSRP`/`QRSRQ`/`QSINR` read populates the `sig_*` array fields in `status.json`, which `qmanager_tower_failover` does NOT read — only the scalar `.lte.rsrp`/`.nr.rsrp` from QENG. QCAINFO and CFUN? similarly have no consumer that requires sub-minute freshness when no browser is open.

**CA fields hold last-known, never zero in deep:** the QCAINFO else-branch that zeroes `t2_ca_active`, `t2_ca_count`, `t2_nr_ca_active`, `t2_nr_ca_count`, `t2_total_bandwidth_mhz`, `t2_bandwidth_details`, and `t2_carrier_components` is entirely inside the `if [ "$ap_tier" != "deep" ]; then ... fi` guard. Deep-tier touches leave the CA global vars unchanged; `write_cache` then emits last-known values. Verified on-device: CA fields held `total_bandwidth_mhz:95` across multiple deep-tier cycles.

> ⚠️ WARNING: Do not add any of the removed data-plane/L1 commands (`CGCONTRDP`, `QMAP="WWAN"`, `*_time_advance`, `*_mimo_layers`) back to `poll_tier2()` or the boot block. Doing so reintroduces the exact pattern associated with RM551E baseband restarts. Also do not remove the `[ "$ap_tier" = "active" ] || return 0` guard from `poll_tier2()` — the identity reads it protects are still Active-only. Additionally, do not move the QCAINFO else-branch (CA-field zeroing) outside the `[ "$ap_tier" != "deep" ]` guard — doing so would cause deep-tier cycles to publish zeroed CA data instead of last-known values.

### 8. The poller waits at most the read cap on the broker, and a busy cycle asks once

`QC_WAIT_MS=2500` caps how long the poller waits for each per-cycle **read** query. `_qc_read` runs `QCMD_WAIT_MS="$QC_WAIT_MS" qcmd <cmd>` (set for that one call, never exported), so a stuck exchange ahead in the broker's queue costs a read at most 2.5 s. The capped reads are everything that goes through `_qc_read` or `qcmd_exec_g`: `QENG`, `QCAINFO`, `CFUN?`, the per-antenna `QRSRP;QRSRQ;QSINR`, the Tier 2 identity group, the forced SIM identity read and the `policy_band` read (also at boot, where nothing latches). The boot-time `qcmd` calls made directly (device identity bundle, boot command) and every write (profile apply, APN reconcile) keep qcmd's full wait. The client side is in [`at-broker.md`](at-broker.md#client-wait-cap-qcmd--t-and-qcmd_wait_ms).

**Why an environment variable and not `-t`:** a `qcmd` binary that predates the cap ignores an unknown variable, but it would forward `-t 2500` to the modem as an AT command and hold the lock for the full 20 s deadline.

**Per-cycle busy latch.** The cap bounds one read, not a cycle. With the lock held for 15 s, each of the cycle's four reads waited its own 2.5 s and one cycle took 12 s. Inside the AT block (`_AT_LATCH=1`) the first read that answers `modem_busy` or `scan_in_progress` sets `_AT_BUSY`, and the remaining reads of that cycle return **rc 3** (not run) without contacting the broker. Boot one-shots never latch, and the next AT-due cycle starts clean.

**rc 3 keeps its existing meaning:** the command did not run, which says nothing about the modem. The serving-cell poll keeps the last values and counts `sc_busy_streak` (`SC_BUSY_LIMIT=10`, then `modem_reachable=false`); a busy `QCAINFO` keeps the CA fields; `CFUN?` and the per-antenna reads leave their globals unchanged. Under a 15 s hold the result is one capped wait per cycle, `status.json` still written every cycle, `.mono` age 5 s at worst.

### 9. `status.json` is composed with `printf` as one compact line

`write_cache` calls `_wc_compose_pf`, a `printf` composer with a builtin JSON string escaper and numeric guards (a non-numeric value in a number field is written as `null`). The file is **one line of compact JSON plus a trailing newline**; it used to be pretty-printed by `jq`. Every shipped reader uses `jq` or `cat`, so the layout change is invisible to them. **A line-based reader (`grep`, `sed`, `awk`) must find keys by name, never by line number.** (`tools/poller-parity/measure.sh` was fixed for exactly this: it now finds `mono` and `poller_tier` by key.)

**Safety net.** Every 30 composed cycles (`WC_VALIDATE_EVERY`) `write_cache` runs one `jq empty` on the temporary file before it replaces `status.json`. On failure it logs an error, drops the printf output, composes that cycle with the original jq composer (`write_cache_jq`) and keeps using the jq composer for 300 cycles (`WC_JQ_PENALTY`, 10 minutes at 2 s) before trying printf again. Any composer failure (a full tmpfs, a jq error) leaves the previous `status.json` in place, so the file is never replaced by an empty or partial one; `.mono` then ages and the watchdog sees it as stale. **Why:** the old unguarded `jq ... > tmp; mv` turned any jq failure into a 0-byte `status.json`.

Live parity: 200 of 200 snapshot pairs (both composers fed the same globals) were equal under `jq -S` minus the time fields.

### 10. Sidecar files replace per-cycle `jq` reads

Three producers write an additive `.env` file beside their JSON in `/var/run/qmanager` (tmp then `mv`, right after the JSON): `qmanager_ping` writes `ping.env` and `dns.env` ([connection-quality.md](connection-quality.md#poller-sidecars-pingenv-and-dnsenv)), and `ondemand_radio.sh` writes `ondemand.env` ([ondemand-radio-details.md](ondemand-radio-details.md#sidecar-ondemandenv)). The poller reads them with builtins instead of forking `jq`. A sidecar is used only when it is complete (every line a single-quoted assignment, last line `qm_sidecar_end='1'`) and not older than its JSON; otherwise the reader falls back to the JSON path, so an upgrade window or a failed sidecar write costs a few forks, not correctness. The JSON files and `conn_state_read` (the watchdog's reader) are unchanged. `init.d/qmanager` `stop_service` removes the sidecars.

### 12. The Data Used sampler stays off the hot path

`du_tick` (lib `data_used.sh`, ledger U4.22) runs every cycle but only tests the reset flag (`[ -f ]`, no fork); the netdev sample is every 15 cycles and costs one `mv`, and the flash write is every 5 min, on reset and from the `TERM`/`INT` trap. It writes its own files, never `status.json`. Keep any new Data Used work on that cadence. See [`data-used.md`](data-used.md).

### 11. Prometheus scrape hold rewrites the effective age, never the ladder

The scrape CGI ([prometheus-metrics.md](prometheus-metrics.md)) writes `/var/run/qmanager/metrics_scrape` = `"<mode> <uptime_s>"` on every authenticated scrape. In `poll_cycle`, right after the heartbeat age `_age` is computed and before the tier comparison, the poller reads it as a **third tier input after the force flags and the heartbeat**:

- `realtime` sets `_age=0` (tier `active`). `balanced` caps `_age` at `AP_IDLE_THRESHOLD` (never deeper than `idle`). `adaptive` and any other mode are ignored.
- It can only **raise** the cadence: `balanced` never lowers an `_age` already below the threshold, and nothing here lengthens an interval.
- It holds only while `0 <= _MONO_TOP - uptime_s <= METRICS_LEASE_TTL` (120 s), on the uptime clock, so it is immune to NITZ / ntpd steps. A future value is ignored.
- It is skipped entirely when `/proc/uptime` is unreadable (`_MONO_TOP` is 0); the wall-clock fallback age is used unchanged.
- It costs **zero forks**: one builtin `read`, a `case` that accepts digits only (no leading zero, at most 10 digits) and arithmetic. Reading it never writes or removes the file.
- The ladder, AT-due modulo, full-refresh-on-re-entry and the force flags are untouched; this only changes the age they see.

**Why:** the scrape file doubles as the card's "Last scrape" fact and lives in the root-only run dir, so a parse failure or a planted file can at worst raise the cadence for 120 s. Only an authenticated scrape renews it, so an unauthenticated flood cannot pin the poller. `Real-time` lands in `active` like an open browser; `balanced` lands in `idle`, so data (including QCAINFO and per-antenna) is at most `idle_interval` old.

The poller also exports `.device.serving_read_mono` (set when a `poll_serving_cell` reply contains `+QENG:`) and `.device.ca_read_mono` (set after `parse_ca_info`). They let a consumer age the radio data, because the deep tier freezes CA values. Both are `_kN` integer keys in `_wc_compose_pf` and `--argjson` in `write_cache_jq`, so the two composers stay in parity; they default to `0`.

---

## CGI Envelopes

### `GET /cgi-bin/quecmanager/system/adaptive_polling.sh`

Returns current settings and the live poller tier. Auth-gated.

```json
{
  "success": true,
  "settings": {
    "enabled": true,
    "active_grace": 20,
    "idle_interval": 15,
    "idle_threshold": 300,
    "deep_idle_interval": 60
  },
  "isDefault": true,
  "tier": "active"
}
```

- `isDefault` is `true` when the `quecmanager.poller` UCI section is absent (factory state).
- `tier` is read from `.device.poller_tier` in `status.json`; falls back to `"active"` if the file is absent or the field is missing.
- `enabled` is returned as a boolean (`true`/`false`), not the raw UCI string `"1"`/`"0"`.

### `POST /cgi-bin/quecmanager/system/adaptive_polling.sh`

Save settings. Auth-gated.

**Request (`action: "save"`):**

```json
{
  "action": "save",
  "enabled": true,
  "active_grace": 20,
  "idle_interval": 15,
  "idle_threshold": 300,
  "deep_idle_interval": 60
}
```

**Success response:**

```json
{ "success": true }
```

Commits UCI and drops `/tmp/qmanager_poller_reload`. The running poller picks up the new config within one base cycle (~2 s). No restart, no reboot.

**Error codes:**

| Code | Meaning |
|---|---|
| `missing_action` | `action` field absent |
| `unknown_action` | `action` not `"save"` |
| `invalid_value` | Any numeric field is non-positive, non-integer, or out of the allowed range |
| `method_not_allowed` | Request was not GET or POST |

---

## Frontend

| File | Purpose |
|---|---|
| `app/system-settings/adaptive-polling/page.tsx` | Route entry point |
| `components/system-settings/adaptive-polling/adaptive-polling-card.tsx` | Settings card with tier badge and save flow |
| `hooks/use-adaptive-polling.ts` | Fetch + save adaptive polling settings |

The card (ledger U4.11.7, lucide route) is one `Card` on the page: a "Slow down when idle" `SegmentedField` (Off / On) above four numeric rows, committed from `CardFoot` (status left: Unsaved changes, a save failure, or "Default timings" while `isDefault`; ghost Discard; `SaveButton`). The live-tier chip follows the Fact-Is-Info Rule: a tier is a fact, not health, so `active` is a filled `info` Badge (Zap glyph) and `idle` / `deep` are `muted` (Gauge / Moon glyphs, never shared); labels and the aria-label go through `t()` (`adaptive_polling.tier.*`, `tier_aria`). The chip reads the GET's `tier` field, re-polled while the tab is visible. Saves toast once: success, or the returned CGI code through `resolveErrorMessage` (the hook throws `"code: detail"`), falling back to the generic failure line. States: skeleton, load-failure `ConditionBlock` with Retry, loaded.

Sidebar entry key: `adaptive_polling`. Available in all 5 shipped locales.

---

## status.json Surface

The poller also writes `.device.serving_read_mono` and `.device.ca_read_mono` (integers, uptime seconds of the last serving-cell / carrier-aggregation read, `0` = never; see Invariant 11).

The poller writes `.device.poller_tier` as one of `"active"`, `"idle"`, or `"deep"` on every `write_cache` call. Consumers (the frontend tier badge, the CGI GET fallback) should treat the field as optional — it is absent on older builds and on the first write if the poller starts before the cache is populated.

Ping-cache staleness in the poller is not a poller constant: `read_ping_data` calls `conn_state_read` ([connection-quality.md](connection-quality.md#shared-ping-cache-reader-conn_statesh)), which marks `/tmp/qmanager_ping.json` stale when `age > max(3 * interval_sec, 15)` seconds on the monotonic clock. This replaced a fixed 10 s window that expired every cycle under the `quiet` profile (30 s window now). A stale or missing cache sets `connectivity` to unknown (`internet_available: null`, `status: "unknown"`); this runs at the 2 s base cadence in every tier. Connectivity field names and types are unchanged.

The poller also writes a root-level **`mono`** integer field on every `write_cache` call. Its value is the output of `mono_now()` (from `qlog.sh`) — the integer seconds since boot read from `/proc/uptime`. This is the kernel monotonic counter and is unaffected by NTP or NITZ wall-clock steps. The watchdog's `read_quality` function reads `.mono` from `status.json` to compute staleness via `age_mono = mono_now() − .mono`, falling back to the wall-clock `timestamp` field when `.mono` is absent, zero, or non-numeric. Staleness threshold for `status.json` is `STATUS_STALE_THRESHOLD=30` seconds (monotonic).

`qmanager_ping` writes the same `mono` field into `/tmp/qmanager_ping.json` on every probe cycle. Both cache files therefore carry both a wall-clock `timestamp` (epoch seconds, `date +%s`) and a monotonic `mono` (uptime seconds) as companion fields.

---

## Known Gotchas

- **Busy is not unreachable (2026-10-19).** `qcmd_exec` merges qcmd's stderr into its capture (qcmd writes nothing there on success) and returns **3** for `ERROR: modem_busy`, `scan_in_progress` or `invalid_command`: the command never ran, which says nothing about the modem. rc 1 is kept for no reply (`command_timeout`, `modem_not_ready`, `command_failed`, empty). `poll_serving_cell` keeps the last values on rc 3 and on a single rc 1, and sets `modem_reachable=false` (which makes `events.sh` log `signal_lost`) only after `SC_FAIL_LIMIT` (2) failed polls in a row, or `SC_BUSY_LIMIT` (10) busy polls in a row (ten AT-due cycles, each of which waited out the read cap). Tier 2 `AT+QCAINFO` keeps its CA values on rc 3 instead of zeroing them. Before this, any other caller holding the modem lock past 5 s (a stuck or long command, or a non-AT line the modem never answered) produced a false "Modem became unreachable" event. Since B5.29 Phase B the cycle no longer stalls for the length of the hold: a read waits at most 2.5 s and the first busy read latches the rest of the cycle (Invariant 8), so `status.json` keeps landing every cycle (about 4.4 s at worst under a 15 s hold). `qmanager_watchcat` and `alert_engine.sh` do not read `modem_reachable` or `signal_lost`; `qmanager_tower_failover`, `sms_alerts.sh` and `public/overview.sh` read `modem_reachable`.
- **Tower lock follows the UI heartbeat, not a fixed pin.** A tower lock no longer forces the poller to stay in Active. When the dashboard is idle, the poller graduates to Idle then Deep even with a tower lock active. In deep tier, `AT+QENG="servingcell"` still runs at the deep cadence (default 60 s), so `qmanager_tower_failover` (which loops every 20 s and reads `.lte.rsrp` / `.nr.rsrp` from `status.json`) may act on RSRP up to one `deep_idle_interval` stale while the UI is idle. This is acceptable for slow signal-degradation failover; when the dashboard is open, RSRP is fresh at the 2 s cadence. Band failover (`qmanager_band_failover`) is unaffected — it is a one-shot actor that issues its own live `AT+QCAINFO` query and never relied on the poller's cadence.
- **`write_cache` skipped = watchdog quality trigger dies silently.** Any future modification to the poller loop must preserve the invariant that `write_cache` and `read_ping_data` run every base cycle. The AT-block gating should wrap only the AT reads.
- **Removing or relocating the `ap_tier` gate in `poll_tier2()` re-introduces the RM551E-GL SSR (for the identity group).** The `[ "$ap_tier" = "active" ] || return 0` guard is the first statement in `poll_tier2()`. The data-plane/L1 group is already gone from the poller entirely (see Invariant 6); the guard now protects only the identity reads (`COPS?`, `QUIMSLOT?`, `CNUM`, `CPIN?`). Removing the guard makes those identity reads run at every tier, which is not the RM551E trigger but is wasteful and changes the documented contract.
- **Idle tier at non-2s baseline collapses to Active.** If `POLL_INTERVAL` is ever raised for diagnostic purposes, `idle_interval=15` (default) at a 15 s base becomes `15 / 15 = 1` — every cycle fires. The feature must be re-tuned if the base interval changes.
- **Heartbeat writes are atomic; keep them that way.** Both CGIs write a `.$$` temp file and `mv -f` it into place, and the poller falls back to the last good heartbeat epoch on an empty/garbage read. A new heartbeat producer must follow the same temp-then-`mv` shape, or a racing read can reintroduce a spurious drop toward Deep.
- **Hot-path helpers set globals; never `$( )` a shell function on the hot path.** The re-authored `parse_at.sh` helpers have `_g` variants (`_hex_to_dec_g`, `map_scs_to_khz_g`, `_lte_rb_to_mhz_g`, `_nr_bw_to_mhz_g`, `_sig_val_g`, `_antenna_*_g`, `_pat_split`) that return through globals; the old echo helper names remain as thin wrappers for external callers (`radio_details.sh`, `ondemand_radio.sh`, `apn_mgr.sh`, `qmanager_profile_apply`). On BusyBox ash, `$( )` around a shell function forks (~2 ms each), which defeats the point. Likewise `qcmd_exec_g` returns through `_QR`, and `update_proc_metrics`, `mono_now_set` (`_MONO`) and the qlog level check use builtins only. The poller takes one `date` per cycle (`_NOW`).
- **`parse_at.sh` and poller parser edits must pass the parity harness on the device.** This is a required gate, not a courtesy: the same applies to an edit of the poller's own parsers and of `write_cache` (use `status_parity.sh` and `sidecar_parity.sh` for the composer and the sidecars). `tools/poller-parity/` (dev-only, not shipped by `build.sh`) proves a new `parse_at.sh` sets byte-identical globals to the previous one over a 216-fixture corpus (CRLF preserved) and keeps the helper echo output. Run it under the device's BusyBox shell, not Git Bash: `sh parity.sh <old> <new> fixtures` must be all `PASS` (see `tools/poller-parity/README.md` and `QUIRKS.md`). The one accepted format difference is `t2_carrier_components`, now compact single-line JSON from the single-awk `parse_ca_info` (was jq pretty-printed); it is JSON-equal under `jq -cS`, every consumer goes through jq, and the gate compares with `PARITY_CC_NORMALIZE=1`. The old `parse_ca_info` also used fixed `/tmp/qmanager_c*_*.tmp` scratch files that a concurrent caller could corrupt; they no longer exist.
- **The on-demand cache read is `-nt`-gated, with a forced re-read.** `write_cache` calls `load_ondemand_cache_gated` (poller only), which re-parses `/tmp/qmanager_ondemand.json` only when it is newer than `/var/run/qmanager/ondemand.stamp`, or every 15th call regardless. **Why the forced read:** BusyBox `-nt` compares whole seconds, so a write in the same second as the stamp would be missed; the stamp is also backdated 1 s for the same reason. Every other caller (`ondemand_radio_fetch`, the apply paths) uses `load_ondemand_cache` and always re-reads, so a CGI-side read can never hide a change from the poller. A missing stamp degrades to re-reading every call.
- **Dev AT tap (diagnostic only).** Creating `/var/run/qmanager/poller_tap` makes the poller record each raw AT reply plus the parser globals it produced into a 200-slot ring under `/var/run/qmanager/tap/`; `parity.sh --tap` replays those records through a new parser. Removing the flag stops it; `stop_service()` removes the flag and the directory. Leave it off in production.
- **New ash facts from the B5.29 rewrite.** `$((08))` / `$((09))` aborts the script (leading zero is octal), so `_uptime_cs` and the heartbeat read strip leading zeros; an invalid arithmetic expression aborts ash, so `_hex_to_dec_g` checks the hex charset before `$((0x..))`. A redirect error on the special builtin `:` kills the shell but `true` survives (the stamp touch uses `true`). Here-docs under ~4 KB do not fork; larger bodies fork once. `$( )` around a shell function forks (~2 ms). BusyBox `-nt` compares whole seconds.
- **History files are trimmed lazily.** `signal_history` and the ping history append with `printf` and an in-memory line counter and are trimmed only at `MAX + HISTORY_TRIM_SLACK` (30), so the signal file can hold up to 90 lines and the ping file up to 8670. Readers are unaffected (the CGIs `jq -s` the whole file; the signal chart slices the last 6), but do not assume the files are exactly at their cap.
- **`t2_carrier_components` is compact JSON.** It is a single line now; do not parse it with line-oriented tools.
- **The Rust parser ports are built, not wired.** `native/qmanager_atd/src/poll/` (`parse.rs`, `parse/`, `envout.rs`) hold Rust ports of the AT parsers and the env writer, with host parity tests against the shell parsers. Since broker 0.3.0 they compile only with the off-by-default `poll` cargo feature (`cargo test --release --features poll`), so the shipped binary does not carry them, and nothing in the daemon or the poller calls them: the poller still parses every AT reply in shell, and there is no `POLL` verb. Phase D wiring was not built (decided 2026-10-19): A+B+C already meet the active gate (4.9 %), and D would save about 1-2 % in the active tier only. The parsers and env writer stay in the tree, host-tested but unwired, for a later row. Protocol number 3 is now the QMI lane (see [`qmi-lane.md`](qmi-lane.md)); a `POLL` verb would be 4. See [`docs/architecture/poller-on-broker.md`](../architecture/poller-on-broker.md).
- **Timestamps around a baseband SSR can run backwards.** The NITZ clock step on an SSR moved the wall clock back about 80 s and forward again during a fault test. Poller freshness uses `.mono`, which is unaffected. When reading `qmanager.log` around an SSR, trust the line order, not the printed times.
- **`isDefault: true` is lost on first save, even with default values.** Once the user saves any settings (even unchanged defaults), the `quecmanager.poller` section exists and `isDefault` is always `false`. To restore the "never configured" state, delete the section directly in UCI.
