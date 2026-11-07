# Connection Quality × Watchdog: unified architecture (RM551E + RM520N)

Status: **v2, decisions approved 2026-11-07** (D1=B, D2=a, D3=c, D4=a, D5=a). v2 folds in an independent Opus review ("approve with changes": 0 blockers, 8 majors M1-M8, 20 minors; all accepted, see §11). The D4 long-run reboot guard (§5.6) was approved with v2 on 2026-11-07.

Applies to `QManager` (RM551E, OpenWRT/procd/UCI) and `QManager-RM520N` (systemd/JSON). Built from four code-level recons (both features × both repos) plus the review; evidence reports are in the session scratchpad.

## 1. Why

The two products share names and pages but not behaviour:

| Thing the user sees | RM551E today | RM520N today |
|---|---|---|
| Probe targets | 2 editable (IPv4 + IPv6) + 2 **hidden** built-in alternates | 4 editable (2 hostnames + 2 IPv4), **no IPv6** |
| "Relaxed" sensitivity | down after 15 s, up after 10 s | down after 30 s, up after 10 s |
| Watchdog "Down after 5 failed probes" | 5 raw failing cycles (`streak_fail`; a failing cycle costs ~4-6 s) | `5 × interval` s of `fail_elapsed_sec`, never sooner than the probe's own 30 s |
| Probe cadence | Watchdog writes an override; CQ shows "set by Watchdog" | Same, but the **seed ships an override**, so Sensitivity never changes cadence on a fresh install |
| Quality trigger | 3-sample minimum, no floors, can climb to SIM swap | 10-sample minimum, 50 ms / 10 % floors, capped at Tier 2 |
| Ladder exhausted | 15 min hold-off that **also blocks real outages** after a quality ladder | No backoff, loops from Tier 1 forever |
| Tier 3 armed without a slot | skipped, ladder continues to reboot | ladder stops ("misconfigured") |
| Reboot cap hit | writes `enabled=0` (persists); the *explanation* is a `/tmp` flag lost on reboot | same |
| Baseband restart (SSR) source | `dmesg` remoteproc line | sysfs `subsys0` state/crash_count |
| Loss before 10 samples | reported `0` | reported `null` |

Shared bugs fixed on the way: pass-counted cooldowns, `check_interval` with no UI, the hidden-field validation gap, rung 1 shown "Running now" during `ssr_hold`, the poller dropping most watchdog state, 4 copies of the preset table on RM551E, `backup_sim_slot` clobbered by a POST that omits it (RM520N), and fan-out waiting for its slowest leg.

## 2. The one idea: CQ senses, Watchdog acts

| | **Connection Quality** (sensing) | **Watchdog** (acting) |
|---|---|---|
| Owns | how often and what we probe, when the link counts as *down*, what counts as *slow/lossy* | whether to act, after how long, which steps, how hard (reboot budget, SIM failover/back) |
| Writes | probe config, quality thresholds | its own config only |
| Never | changes anything on the modem | probes, or edits CQ settings |

1. **One writer per setting.** The Watchdog's "Probe every" and the `interval_override` / `probe_interval` concept are removed on both repos. Cadence = Sensitivity.
2. **One definition of "down".** The probe daemon's debounced `reachable=false`. The Watchdog adds only *how long to wait before acting*, in seconds, measured from when the watchdog could last act (§5.2).
3. **One definition of "poor quality".** CQ thresholds feed events, the dashboard and the quality trigger; the Watchdog adds only *how long it must last*.

## 3. Logical settings schema (same on both repos)

Storage differs behind the platform adapter (§7). Key names below are the contract the CGIs and frontend see.

### 3.1 `connection_quality`

| Key | Type | Default | Range / rule |
|---|---|---|---|
| `sensitivity` | enum | `relaxed` | `sensitive\|regular\|relaxed\|quiet` (§4.2). Replaces `profile`. |
| `targets` | string[4] | `1.1.1.1`, `8.8.8.8`, `2606:4700:4700::1111`, `cloudflare.com` | each: IPv4 literal, IPv6 literal or hostname; ≤128 chars; shell-safe charset; no leading `-`. Slot 1 alone, slots 2-4 in parallel on failure. |
| `latency_preset` | enum | `tolerant` | `standard\|tolerant\|very-tolerant\|custom` = 150 / 250 / 500 ms, compared `>` |
| `latency_custom_ms` | int | — | 1-10000; read only when custom; kept when switching away |
| `loss_preset` | enum | `tolerant` | same names = 15 / 30 / 50 %, compared `>=` |
| `loss_custom_pct` | int | — | **1-100** (0 always breaches under `>=`) |

`alert_after_min` stays Alerts-owned, 1-1440 on both (RM551E's 1-60 CGI cap aligned up). The D2 chain has no second-provider IPv6 leg; accepted (users can edit).

### 3.2 `watchdog`

| Key | Type | Default | Range | Replaces |
|---|---|---|---|---|
| `enabled` | bool | `false` (daemon default too) | | — |
| `act_after_sec` | int | `30` | 15-600 | `fail_threshold`. Effective = `max(act_after_sec, fail_secs)`; UI shows the effective value. |
| `step_wait_sec` | int | `60` | 10-300 | `cooldown`. Effective = `max(step_wait_sec, recover_secs + 20)` (an outage verdict needs `recover_secs` of success); UI shows effective. Monotonic. |
| `tier1_enabled`, `tier2_enabled`, `tier4_enabled` | bool | `true` | | — |
| `tier3_enabled` | bool | `false` | CGI rejects `true` without a slot, and rejects clearing the slot while true | — |
| `backup_sim_slot` | 1\|2\|null | null | key absent = untouched; `null` clears | — |
| `max_reboots_per_hour` | int | 3 | 1-10 | — |
| `quality_enabled` | bool | `false` | | — |
| `quality_after_sec` | int | `120` | 30-1800, monotonic | `quality_consecutive` |
| `ssr_aware` | bool | `true` | | — |
| `ssr_grace_sec` | int | 45 | 10-120 | `ssr_grace` |
| `failback_enabled` | bool | `false` | only meaningful with Tier 3 | `primary_recheck_enabled` |
| `failback_every_min` | int | 30 | 5-1440 | `primary_recheck_interval` |

Cross-field rules (server-side): turning Tier 3 off during an active failover is allowed; the failover stays, Revert remains available, failback stops. **Removed:** `check_interval` (internal 10 s constant), `fail_threshold`, `probe_interval`, `interval_override`, `probe_profile`, RM520N `watchcat.probe_interval` and the hidden `fail_secs`/`recover_secs`/`history_secs`/`interval_sec` in `ping_profile.json`.

### 3.3 Migration (idempotent, keyed on presence of the *new* keys)

Runs in `install.sh` (tarball + OTA) and the ipk **postinst** (`--configure` → `seed_uci_defaults`) on RM551E; `install_rm520n.sh` on RM520N. A rerun never touches a section whose new keys exist.

| Old | New |
|---|---|
| `profile` | `sensitivity` (same name) |
| RM551E `target_ipv4`, `target_ipv6` | if both equal the old defaults → new defaults; else `[target_ipv4, <old hidden alt v4>, target_ipv6, cloudflare.com]` |
| RM520N 4 slots | if all equal the old defaults → new defaults; else kept as-is |
| RM551E `fail_threshold` (counted cycles) | `act_after_sec = clamp(fail_threshold × max(interval, 5), 15, 600)` |
| RM520N `fail_threshold` (seconds rule) | `act_after_sec = clamp(fail_threshold × interval, 15, 600)` |
| `cooldown` | `step_wait_sec` |
| `quality_consecutive` | `quality_after_sec = clamp(quality_consecutive × check_interval, 30, 1800)` |
| `interval_override` / stored `interval_sec` | **dropped**; the saved sensitivity stays (no remap; avoids silently shortening down-after) |
| `primary_recheck_*`, `ssr_grace` | renamed |

Every conversion logs old → new. Old keys are left in place (except the dropped overrides) so a rollback reads its own keys; the release note says a rollback restores pre-upgrade values.

**Config Backup** (both repos): new section `connection_quality` before `watchdog` in the apply order. Restore translates old key names **permanently** (`.qmbackup` files outlive releases). Converting a restored `fail_threshold` uses the backup's sensitivity if present, else the device's current one, with the matching formula above. RM551E's restored `backup_sim_slot=""` maps to `null`. Restore keeps today's start/stop of the watchdog service (restore is not a "save").

## 4. Probe daemon `qmanager_ping` (neutral file, identical on both)

### 4.1 Cycle
1. Slot 1 alone: `ping -c1 -W2 -w3`; hostname slots via `plat_timeout 4`. A slot whose family has no route (IPv6 without a non-`lo` `::/0`) is skipped, not failed, and the next slot is promoted to "alone".
2. Slot 1 fails → the other usable slots in parallel. **Early exit:** poll result files every 0.2 s; the winner is the lowest-numbered slot that answered, decided as soon as every lower slot has finished. The fan-out no longer waits for its slowest leg (a hostname leg can take 4 s).
3. Hostname family = whatever the system resolver returns (A or AAAA); `last_family` is parsed from the ping banner.
4. Fixed-rate loop on `/proc/uptime`; DNS sampler detached every 60 s (+ forced on a down edge, 10 s gap). Unchanged.
5. Attach warm-up (RM551E today, now both): until the first answer, max 120 s, failures count for the verdict but are not written to the ring; `/tmp/qmanager_ping_attaching` marks it.

### 4.2 Sensitivity table (one copy, `conn_state.sh`; served to the UI by GET)

| Sensitivity | interval | down after | up after | stats window | quality-event debounce |
|---|---|---|---|---|---|
| sensitive | 1 s | about 8 s | 3 s | 300 s | 12 s (very-tolerant 8 s) |
| regular | 2 s | about 12 s | 6 s | 300 s | 12 s / 8 s |
| relaxed | 5 s | about 20 s | 10 s | 300 s | 15 s / 10 s |
| quiet | 10 s | about 40 s | 20 s | 600 s | 30 s / 20 s |

"Down after" is a floor: the verdict flips at the first cycle end at or after it (a failing cycle costs ~3-5 s with early exit, so sensitive reads 8-11 s in practice). The UI says "about". Quality-event debounce is in seconds of *new* samples (at least 2 samples), replacing poller-cycle counts.

Ring length = `ceil(window / interval)` (time-constant window). `status.json.connectivity.latency_history` is **downsampled to ≤ 60 points** (bucket = max RTT, `null` only if the whole bucket was lost), with `history_interval_sec` = bucket seconds and `history_size` = points. Status JSON size and the dashboard/latency-monitor strips are unchanged.

### 4.3 Verdict
Binary and timed: `reachable` flips false after `fail_secs` of continuous failure measured from the first failing cycle's start, true after `recover_secs` of success. No degraded state in the daemon. Initial `reachable=true`.

### 4.4 Outputs (contract)
`/tmp/qmanager_ping.json`, printf-built, 16 keys:
`timestamp, mono, sensitivity, targets[4], interval_sec, fail_secs, recover_secs, last_rtt_ms, reachable, streak_success, streak_fail, fail_elapsed_sec, during_recovery, last_family, last_leg, cycle_ms`
- `profile` → `sensitivity`, `last_target` → `last_leg` (1-4, 0 = none). Lockstep: `conn_state.sh` reader, the `ping.env` sidecar (written on both, since the file is neutral), `tools/poller-parity/sidecar_parity.sh`, `qmanager_health_check`.
- `connectivity.ping_target` stays `targets[0]`; `connectivity` gains `last_leg`, `sensitivity`, `fail_secs`, `recover_secs`.

History ring `/tmp/qmanager_ping_history`: `<rtt|null> <slot 1-4|->`; trimmed only when count > size + 10.

Staleness (one copy): fresh iff `uptime − mono ≤ max(3×interval, 15)`; stale → fail-closed `null`.

### 4.5 Poller derivations (one awk program, moved into neutral `conn_state.sh`)
Loss/jitter `null` below 10 samples; jitter only between consecutive answers of the same slot; `status` = `recovery` > `degraded` (loss ≥ threshold) > `connected` > `disconnected` > `unknown`; latency alone never degrades.

## 5. Watchdog daemon `qmanager_watchcat` (neutral main loop + libs, identical on both)

### 5.1 States
`monitor, suspect, ssr_hold, recovery, cooldown, holdoff, radio_off, locked, disabled`. RM520N gains `radio_off`; both gain an explicit `holdoff` state.

### 5.2 Triggers
- **Outage age** = `min(fail_elapsed_sec, now_mono − resume_mono)`. `resume_mono` is set at the end of the boot settle, the ping attach warm-up, `radio_off`, `locked` and every SIM settle. This replaces RM551E's `_radio_streak_base`: an outage that "aged" while the watchdog could not act never fires Tier 1 the moment it can.
- **Outage trigger:** fresh read, `reachable=false`, outage age ≥ effective `act_after_sec`. `streak_fail>0` only moves monitor→suspect. Stale = no decision.
- **Quality trigger** (opt-in): only in `monitor` with `reachable=true, streak_fail=0`. Window = last `clamp(120/interval, 10, 60)` ring lines since the last mark, ≥10 samples, limits = CQ thresholds raised to floors 50 ms / 10 %. Breach must persist `quality_after_sec` on the monotonic clock.
- **Dead prober:** cache stale for > 5 min → event `wd_ping_stale`, one `svc_start` of the ping service per 15 min, `ping_stale=true` in state. Still no recovery action on stale data.

### 5.3 Start gate (both triggers, in order)
`none` (no eligible tier for this reason) → `holdoff` (same reason only) → `radio_off` (`AT+CFUN?` 0/4) → `ssr` → go.

SSR hold: engaged when an SSR was seen within `ssr_grace_sec + act_after_eff + 8 + 2×10` s (grace + trigger + one worst cycle + two passes). One hold per SSR identity (crash mono on RM551E, `crash_count` on RM520N), so the Tier-4 re-check cannot hold twice for the same restart.

### 5.4 Ladder
| Tier | Action | Skip when |
|---|---|---|
| 1 Re-register | `AT+COPS=2`, 2 s, `AT+COPS=0` | — |
| 2 Radio restart | radio-down marker, `CFUN=0`, 3 s, `CFUN=1`, wait for modem, confirmed read-back | tower lock (LTE, NR-SA, NSA, band), long-running AT |
| 3 Backup SIM | verified `QUIMSLOT` swap (≤2 attempts, slot + CFUN read-back, `CPIN READY` ×3), tower failover paused | no slot / unreadable / already on backup / **quality reason** |
| 4 Reboot | crash.log `tier4_escalation`, sync, `plat_reboot` | **quality reason**; budget resting (§5.6); SSR gate re-checked first |

- Skip → next eligible tier immediately. Failure after effective `step_wait_sec` (Tier 3 ≥ 90 s) → next tier directly.
- Cooldown verdict: stale → extend one pass, max 3, then *inconclusive*: revert an unconfirmed Tier 3, go to `monitor` **keeping `current_tier`**, so the next trigger resumes from the next tier instead of looping Tier 1. Outage → success iff `reachable=true`. Quality → reachable and window clean; no data → extend, max 3.
- Never `AT+CFUN=1,1`. Settings save never restarts the daemon (reload flag).

### 5.5 Hold-off (after an exhausted ladder)
| Reason | Length | Clears early when |
|---|---|---|
| outage | 15 min | `reachable=true` |
| quality | 15 → 30 → 60 min on consecutive quality hold-offs; resets after one clean hour | a clean quality window, or a settings save. Never on reachability (the link is reachable during quality trouble) |

A quality hold-off never delays an outage ladder and vice versa.

### 5.6 Reboot budget (D4 + guard)
- Budget = `tier4_escalation` rows in the rolling hour (clock-aware 1970 rule, both).
- Budget spent → Tier 4 **rests**; Tiers 1-3 keep working; `reboot_budget_exhausted=true`, event `wd_budget_spent` once per episode. The watchdog stays enabled.
- **Long-run guard (review M4, approved):** if the budget was spent in two consecutive hours with no `reachable=true` in between, Tier 4 keeps resting until the link has been up once or 24 h have passed. Caps a dead-coverage night at ~6 reboots instead of up to 72/day. State carries `reboot_rest_reason` (`hourly` | `long_outage`).

### 5.7 SIM failover and failback
- Record (persistent, root-only dir via adapter): `{active, original_slot, current_slot, switched_at, reason, original_iccid, current_iccid, confirmed, revert_pending}`. RM551E keeps its `/tmp` mirror for the poller.
- Unconfirmed swap written first, reverted on lock exit / unconfirmed boot; profile auto-apply on swap, revert and failback.
- Failback every `failback_every_min`: swap back, settle 90 s, keep primary iff reachable; else return to backup. Give up after 3 failed tries until the next settings save or boot, with an event.
- User revert deferred while a tier, lock, radio-off or SSR hold is active.

### 5.8 LOCKED
Union of both repos: maintenance lock file, trusted long-running AT flag, live profile-apply PID, live config-restore PID, active manual SIM switch.

### 5.9 State file and republish
`/tmp/qmanager_watchcat.json` (full, read by the CGI): `state, enabled, current_tier, recovery_reason, last_recovery_{time,tier,reason}, total_recoveries, failure_count, failure_secs, cooldown_remaining, step_wait_until, holdoff_until, holdoff_reason, reboots_this_hour, reboot_budget_exhausted, reboot_rest_reason, ssr_hold, ssr_hold_until, last_ssr_mono, quality_breach_secs, failback_{active,failures,next_at}, sim_failover_active, original_sim_slot, current_sim_slot, ping_stale, mono, stale_after`. Deadlines are mono stamps; the UI interpolates against `mono`, so countdowns don't go ~20 s stale.

`status.json.watchcat` republishes the hero set only: today's 11 keys (incl. `failure_count`, `cooldown_remaining`; Prometheus scrapes `failure_count`) **plus** `recovery_reason, step_wait_until, holdoff_until, holdoff_reason, reboot_budget_exhausted, ssr_hold_until, failback_next_at, ping_stale, mono`. Both poller composers and `tools/poller-parity/status_parity.sh` change together.

### 5.10 Events
`append_event` gains an **optional** 4th arg `code` (default empty; existing callers unchanged). Codes: `wd_tier_start`, `wd_tier4_reboot`, `wd_succeeded`, `wd_escalate`, `wd_holdoff`, `wd_ssr_hold`, `wd_radio_paused`, `wd_budget_spent`, `wd_ping_stale`, `sim_swap`, `sim_revert`, `sim_failback`, `sim_failback_giveup`. The UI matches on `code` (falls back to today's text match for events written before the upgrade). Same English messages on both repos.

## 6. CGI contracts (same paths and shapes; bodies are per-repo)

| Endpoint | GET | POST actions |
|---|---|---|
| `monitoring/connection_quality.sh` | `{success, settings:{sensitivity, targets, latency:{preset,custom_ms}, loss:{preset,custom_pct}}, cadence:{interval_sec, fail_secs, recover_secs, window_sec}, tables:{sensitivity:{…}, presets:{…}}, is_default}` | `save_probe {sensitivity, targets}`; `save_thresholds {latency, loss}` |
| `monitoring/watchdog.sh` | `{success, settings:{§3.2}, effective:{act_after_sec, step_wait_sec, quality_limits:{latency_ms,loss_pct}}, status, sim_failover, recent_reboots, sim_dual_capable, auto_disabled}` | `save_settings` (any subset; two-pass validate; cross-field rules), `revert_sim`; RM551E keeps `dismiss_sim_swap` (its sim-swap banner uses it; RM520N's banner uses the SIM registry, out of scope) |

- Error envelope: `{success:false, error, field?, detail?}` (watchdog's `reason` → `detail`). Frontend: `resolveErrorMessage(t, error, detail)`.
- GET never writes config. Thresholds save raises the poller + watchdog reload flags; probe save raises the ping flag (paths from the adapter).
- Tables come from GET only; the frontend keeps no mirror.
- Old endpoints are removed, not shimmed (the static export is hashed; a reload picks up the new UI). If the ipk manifest lists them, the manifest is updated in the same change.
- A shared **contract test** (fixture requests/responses, run against each repo's CGI under its harness) replaces byte-identical CGI bodies.

## 7. Platform adapter `qm_platform_cqwd.sh` (the only intended difference)

**Neutral set** (byte-identical; each repo commits a hash manifest `tools/cq-wd-parity/manifest.sha256` and CI checks its own files against it): `qmanager_ping`, `conn_state.sh` (incl. the stats awk), `qmanager_watchcat`, `wd_config.sh`, `wd_state.sh`, `wd_detect.sh`, `wd_quality.sh`, `wd_tiers.sh`, `wd_sim.sh`, `wd_ledger.sh`. Written for the oldest shell in the fleet (BusyBox 1.29.3): no `timeout` flags outside `plat_timeout`, no jq regex, `[ -f ] && .` guarded sources.

| Function | Contract | Runs as | RM551E | RM520N |
|---|---|---|---|---|
| `cfg_get <sec> <key>` | prints value; rc 0 = value, 1 = absent, **2 = store unavailable** (daemons never retire or decide on rc 2) | root, www-data | `uci -q get quecmanager.*` | `connection_quality` → `ping_profile.json` + `quality_thresholds.json` (nested), `watchdog` → `qmanager.conf .watchcat`; rc 2 while jq is not mounted |
| `cfg_get_list <sec> <key>` | one item per line | both | UCI `list` | JSON array |
| `cfg_set / cfg_set_list / cfg_del` | stage | both | `uci set/add_list/delete` | jq merge into a staged temp (type-guarded) |
| `cfg_commit / cfg_revert` | atomic publish / drop | both | `uci commit` / `uci revert` | `mv` staged temp / remove it |
| `svc_{enable,disable,start,stop,running} <svc>` | | root or www-data | `/etc/init.d` | root: `systemctl`; www-data: `sudo -n qmanager_svc` |
| `plat_flag_raise <path>` | create a flag another uid consumes | both | `touch` | PID-write + `touch` (protected_regular) |
| `plat_paths` | sets `PF_*`: reload flags (ping / quality / watchdog), maintenance lock, profile-apply PID, config-restore PID, manual SIM-switch flag, long-running flag, state dir (root-only), failover record, crash log | — | `/tmp/qmanager_quality_reload`, `/etc/qmanager/…`, `/tmp/qmanager_long_running` | `/tmp/qmanager_events_reload`, `/usrdata/qmanager/…`, `/run/qmanager_at/long_running` |
| `plat_long_running` | rc 0 if a trusted long-running AT op is active | root | `-f` + trust check | `qm_long_flag_up` |
| `plat_tower_locked` | rc 0 if any LTE/NR-SA/NSA/band lock is active | root | reads `tower_lock.json` + band-lock state | same files, RM520N paths |
| `plat_tower_failover {pause,resume}` | | root | `/etc/init.d/qmanager_tower_failover` | `svc_*` |
| `plat_profile_apply <iccid> <reason>` | SIM profile auto-apply | root | `profile_mgr.sh` | same |
| `plat_ssr_poll` | called every pass; returns `last_ssr_mono` + identity | root | `dmesg` `4080000.remoteproc-mss: fatal error` | sysfs `subsys0/state` + `crash_count`, change stamped with mono |
| `plat_dual_sim` | rc 0 if two SIM slots | root, www-data | `AT+QUIMSLOT?` answer cached in a sidecar at boot | same |
| `plat_reboot` | | root | `sync; reboot` | `run_reboot` |
| `plat_crash_log_prepare` | | root | no-op | `qm_crash_log_prepare` |
| `plat_timeout <s> <cmd…>` | | both | `timeout` | `qm_timeout` |
| `append_event`, `mono_now`, `qlog_*` | | both | existing libs | existing libs |

## 8. Frontend (same IA on both; the artifact session designs it)

- **Connection Quality** `/monitoring/connection-quality`: Sensitivity card (4 pills; interval, "about N s" down-after, up-after; live verdict naming the answering slot), Probe Targets (4 slots, slot 1 primary + 3 fallbacks; a slot without its IP family reads "skipped, no IPv6"), Quality Thresholds (presets + Custom, tables from GET). No "set by Watchdog" state.
- **Watchdog** `/monitoring/watchdog`: hero status with the full phase set (`holdoff` + reason, `radio_off`, budget resting + reason, SSR countdown, ping stale); Ladder card (Tier 3 gated on `sim_dual_capable`; failback row shows give-up; Tier 4 "resting"); Detection card = "Start recovery after [N] offline" + quality trigger "after [N] of poor quality" + SSR hold, with read-only "Down is detected after about X s (Sensitivity: Relaxed)" linking to CQ; effective values shown where clamped. Timeline uses effective values from GET.
- Copy keys aligned (`connection_quality.*`, `watchdog.*`); namespace file stays per repo; five catalogs + RM520N `ru`.

## 9. Decisions (resolved 2026-11-07)

D1 = **B** (seconds, one owner), D2 = **a** (literal first), D3 = **c** (8/12/20/40 s), D4 = **a** (Tier 4 rests, plus the §5.6 guard), D5 = **a** (quality ladder max Tier 2).

## 10. Build order, validation, rollback

**Step 0: freeze contracts.** `ping.json`, ring, `status.json` keys, CGI shapes + error codes, event codes, adapter API. Write the contract-test fixtures.

**Step 1a (RM551E): behaviour-neutral refactor.** Extract the adapter, move the neutral files into shape; today's 71 harness baselines must stay **byte-identical**.

**Step 1b (RM551E): behaviour changes one rule at a time**, each with a new baseline and a commit: harness mono model that emits `fail_elapsed_sec` → time trigger + outage age (M1) → hold-off rules → reboot budget + guard → quality cap + monotonic persistence → cooldown floor + inconclusive tier keep → dead-prober → ping early-exit fan-out + slot promotion → sensitivity table + ring + downsample. Harness runs under BusyBox 1.29.3, 1.31.1 and 1.36.1.

**Step 2: migration** in `install.sh`, update, uninstall, ipk postinst (lifecycle lockstep); Config Backup sections + permanent translation.

**Step 3: CGIs, poller republish, Prometheus**; then the frontend after the artifact is approved.

**Step 4: live-validate on the RM551E:**
- Down-after per sensitivity in both failure modes (blackhole `192.0.2.1`, fast EPERM via an own nft table + sleep failsafe).
- Airplane-mode off and LOCKED exit after a long outage: no immediate Tier 1.
- Quality ladder exhausted while reachable: hold-off persists and grows.
- Budget spent → Tiers 1-3 continue → long-run guard.
- Migration from real old configs (Sensitive + threshold 5; a stored override).
- Config Backup old→new and new→old; ipk upgrade, tarball OTA, rollback.
- Prometheus scrape diff, health check, reload without restart.

**Step 5: RM520N port = its own plan**, with read-only live recon first. Its 1213-line watchcat is replaced, not patched; RM520N gets the harness for the first time.

**Step 6: docs** on both repos (`connection-quality.md`, `connection-watchdog.md`, feature READMEs, RELEASE_NOTE incl. the rollback note and the Prometheus key list).

Rollback: old keys stay in place except the dropped cadence overrides; reinstalling the previous release reads them. Tier 3 and failback stay un-live-tested on RM551E (no working second SIM); the harness is the gate there.

## 11. Review disposition (Opus, 2026-11-07)

| Finding | Resolution |
|---|---|
| M1 radio-off/lock discount lost | §5.2 outage age with `resume_mono` |
| M2 quality hold-off loop | §5.5 per-reason clearing + growth |
| M3 migration 3× faster | §3.3 `× max(interval, 5)`; `× check_interval` |
| M4 D4 no long-run brake | §5.6 guard (approved) |
| M5 adapter gaps | §7 full interface, tri-state reads, storage map; watchcat + conn_state neutral; CGIs out |
| M6 contract breaks | §5.9 keep `failure_count`/`cooldown_remaining`; §6 `dismiss_sim_swap`; §4.2 downsample; §4.4 lockstep list |
| M7 Config Backup | §3.3 permanent translation, interval source, apply order |
| M8 build order | §10 step 0, 1a neutral refactor, 1b one rule at a time, 3 BusyBox versions, separate RM520N plan |
| Minors 1-20, nits | early-exit fan-out; "about" figures; `act_after` ≥ 15; effective `step_wait`; monotonic quality; SSR window in seconds + identity; dead prober; inconclusive keeps tier; warm-up in `resume_mono`; family + slot promotion; default migration; override dropped not remapped; idempotency; ipk postinst; neutral awk; debounce in seconds; cross-field rules; mono deadlines; hash manifest; optional `code`; tables GET-only; dead quality-failback clause removed; Tier 4 skipped for quality; ping.env on both; shims cut; slim republish |
