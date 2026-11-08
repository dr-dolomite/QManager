# Connection Watchdog (`qmanager_watchcat`)

`qmanager_watchcat` is QManager's connection health daemon and the acting half of the unified Connection Quality x Watchdog design: [Connection Quality](connection-quality.md) senses, the Watchdog acts. It watches the ping daemon's output (and, opt-in, link quality and the component-carrier count) and, when the connection fails or degrades, runs a tiered recovery ladder: network re-registration, radio toggle, SIM failover, system reboot. It is opt-in (`enabled=0` on a fresh install). The daemon is a thin main script plus eight sourced `wd_*.sh` libraries and a platform adapter (`qm_platform_cqwd.sh`); it publishes a heartbeat so the UI can tell when it has stopped, keeps its reboot ledger and SIM-failover record honest across restarts and reboots, and **never disables itself**: a spent reboot budget only rests Tier 4.

The Watchdog cannot change how the connection is probed. It reads Sensitivity, targets and the latency/loss limits from Connection Quality, and decides only when to act and what to do. Its triggers are times in seconds, not probe counts, so a setting means the same thing at every Sensitivity. Design and contracts: [`docs/plans/2026-11-07-cq-watchdog-unified-architecture.md`](../plans/2026-11-07-cq-watchdog-unified-architecture.md), [`docs/plans/2026-11-07-cq-watchdog-contracts.md`](../plans/2026-11-07-cq-watchdog-contracts.md) (§1-§15), [Amendment 3](../plans/2026-11-08-cq-watchdog-amendment-3.md) (last outage, last success, the carrier trigger); progress: [`docs/plans/2026-11-07-cq-watchdog-1b-plan.md`](../plans/2026-11-07-cq-watchdog-1b-plan.md).

---

## Quick Reference

| Item | Value |
|---|---|
| Daemon | `scripts/usr/bin/qmanager_watchcat` -> `/usr/bin/qmanager_watchcat` (main loop, loader, exit cleanup) |
| Libraries | `scripts/usr/lib/qmanager/wd_{config,state,detect,quality,carrier,ledger,tiers,sim}.sh` -> `/usr/lib/qmanager/` (see [Neutral files](#neutral-files-and-the-platform-adapter)) |
| Platform adapter | `scripts/usr/lib/qmanager/qm_platform_cqwd.sh` (the only per-repo file) |
| Migration | `scripts/usr/lib/qmanager/cqwd_migrate.sh` (RM551E only; see [Migration](#migration-from-the-old-keys)) |
| Init script | `scripts/etc/init.d/qmanager_watchcat` (procd, `respawn 3600 5 5`, `term_timeout 15`) |
| CGI endpoint | `GET/POST /cgi-bin/quecmanager/monitoring/watchdog.sh` |
| UCI section | `quecmanager.watchcat`, read through the adapter's `cfg_get watchdog <key>`; the shared Connection Quality limits come from `cfg_get connection_quality ...` |
| State file (heartbeat) | `/tmp/qmanager_watchcat.json`, rewritten every pass; removed on exit |
| PID file | `/tmp/qmanager_watchcat.pid` |
| Reachability input | `/tmp/qmanager_ping.json` (`reachable`, `fail_elapsed_sec`, `fail_secs`, `recover_secs`, `interval_sec`, `cycle_ms`) read through `conn_state_read`; `/tmp/qmanager_ping_attaching` (attach warm-up flag) |
| Quality input | `/tmp/qmanager_ping_history` (`<rtt ms or null> <slot>` per line, newest last, read as `$1`), through `wd_quality.sh` |
| Carrier input | the adapter's `plat_cc_count`: `/var/run/qmanager/qmi.env` (broker, LTE and NSA anchor) and `/var/run/qmanager/ca.env` (poller, 5G SA) |
| Recovery active flag | `/tmp/qmanager_recovery_active` |
| Maintenance lock | `/tmp/qmanager_watchcat.lock`; also `/tmp/qmanager_long_running`, a live `/tmp/qmanager_profile_apply.pid`, a live config-restore PID and a manual SIM-switch flag (see [LOCKED](#locked)) |
| Reload flags | `/tmp/qmanager_watchcat_reload` (this daemon), `/tmp/qmanager_poller_reload` (raised when `carrier_enabled` is saved) |
| SIM flags | `/tmp/qmanager_watchcat_revert_sim` (CGI `revert_sim`), `/tmp/qmanager_watchcat_retry_failback` (CGI `retry_failback`), `/tmp/qmanager_sim_switch_active` (held by `wd_swap_slot`; the poller pauses AT traffic while it exists). The daemon honours only root-owned flags. |
| Auto-disabled flag | `/tmp/qmanager_watchcat_disabled`: **never created by the daemon** (it never auto-disables); only the CGI's `auto_disabled` read, the config-restore clear and the uninstaller still touch it |
| SIM failover record | two copies: `/tmp/qmanager_sim_failover` and `/etc/qmanager/sim_failover.json` |
| Reboot ledger | `/etc/qmanager/crash.log`, rows `<epoch>\|reboot\|<reason>`; the watchdog writes `tier4_escalation`, shared with [Alerts](alerts.md#reboot-alerts) |
| Long-run guard files | `/etc/qmanager/wd_reboot_guard` (`<engage epoch>`) and `/etc/qmanager/wd_link_up` (`<epoch>`), flash, written **only on their edges** (see [Reboot budget](#reboot-budget-and-the-long-run-guard)) |
| Constants (none is a UCI key) | `BOOT_SETTLE=30`, `MODEM_WAIT_TIMEOUT=60`, `SIM_SETTLE_SECS=90`, `HOLDOFF_OUTAGE_SECS=900`, `HOLDOFF_QUALITY_SECS_0/1/2=900/1800/3600`, `HOLDOFF_CARRIER_SECS_0/1/2=900/1800/3600`, `HOLDOFF_*_RESET_SECS=3600`, `QUALITY_LATENCY_FLOOR_MS=50`, `QUALITY_LOSS_FLOOR_PCT=10`, `CFG_CHECK_INTERVAL=10` (all in `wd_config.sh`); `WD_STALE_AFTER=300`, `WD_STALE_RESTART_GAP=900` (`wd_detect.sh`); `WD_GUARD_SECS=86400` (`wd_ledger.sh`); `WD_FAILBACK_MAX_FAILS=3` (`wd_sim.sh`) |
| Reboot? | Tier 4 only: state written, then `( sleep 1; plat_reboot ) &` and `exit 0` (`plat_reboot` is `sync; reboot` on the RM551E) |
| Frontend hook | `hooks/use-watchdog-settings.ts` |
| Frontend cards | `components/monitoring/watchdog/` (see [Frontend files](#frontend-files)) |
| Test tools | `tools/watchdog-harness/` (165 scenarios), `tools/cq-wd-contract/`, `tools/cq-wd-migrate/`, `tools/cq-wd-parity/` (see [Test tools](#test-tools)) |

---

## Neutral files and the platform adapter

The Connection Quality and Watchdog code is shared with the RM520N repo. Eleven files are **neutral**: byte-identical in both repos, proved by `tools/cq-wd-parity/check.sh` against `manifest.sha256`: `qmanager_ping`, `qmanager_watchcat`, `conn_state.sh` and `wd_{config,state,detect,quality,carrier,tiers,sim,ledger}.sh`. They reach the config store, the init system, the reboot call and every platform path only through **`qm_platform_cqwd.sh`**, the one file that differs per repo.

**Why:** the two modems run the same detection and recovery logic but store config and reach hardware differently; keeping one body of logic means a fix lands in both repos instead of drifting. Never edit a neutral file for one repo only: change it, run `check.sh --update`, and mirror the change in the other repo so the manifests stay equal.

The RM551E adapter provides:

| Binding | RM551E implementation |
|---|---|
| Config store | `cfg_get`, `cfg_get_list`, `cfg_set`, `cfg_set_list`, `cfg_del`, `cfg_commit`, `cfg_revert` over UCI package `quecmanager`. Logical section `watchdog` -> `watchcat`; `connection_quality` -> `ping_profile` (`sensitivity`, `targets`, and the retired `profile`, `target_ipv4`, `target_ipv6`, `interval_override`) or `quality_thresholds` (`latency_*`, `loss_*`, `alert_after_min`). An unknown (section, key) returns 1. Old and new key names both route, so the migration can leave old keys in place. |
| Services | `svc_enable/disable/start/stop/running` over `/etc/init.d/<svc>`; `PF_PING_SVC=qmanager` is the procd service whose `ping` instance the dead-prober restart starts |
| Paths | `plat_paths` defines every `PF_*` path (reload flags, lock files, failover record, crash log, run dir, `qmi.env`, `ca.env`) |
| Actions and probes | `plat_flag_raise`, `plat_long_running`, `plat_manual_sim_switch`, `plat_tower_locked`, `plat_tower_failover`, `plat_profile_apply`, `plat_ssr_poll`, `plat_dual_sim`, `plat_reboot`, `plat_crash_log_prepare`, `plat_timeout` |
| Carrier count | `plat_cc_count` -> `PLAT_CC` (empty = unknown) and `PLAT_CC_RAT` (see [Carrier trigger](#carrier-trigger-opt-in)) |
| Alert wait | `cq_alert_after_min` -> `CQ_ALERT_AFTER_MIN` (see [connection-quality.md](connection-quality.md#alert-wait-alert_after_min)) |

RM551E specifics:

- **`plat_tower_locked`** is true for an enabled LTE or NR-SA lock in `/etc/qmanager/tower_lock.json` (`lte.enabled`, `nr_sa.enabled`). The RM551E has no NSA tower lock and no file-based band-lock state (band locks live in modem NV via `AT+QNWPREFCFG`), so Tier 2 is **not** skipped for a band lock; a read-only check that a radio restart keeps the band lock is part of the on-device validation (Amendment 3, R9b).
- **`plat_ssr_poll`** reads the newest `4080000.remoteproc-mss: fatal error received` line from `dmesg` and returns its uptime second (the identity of that restart).
- **`qmi_dms.sh` is sourced by the adapter** (guarded). It defines `qm_qmi_online`, which the neutral `wd_cfun_now` uses when present: while the QMI device service reports `online` it answers 1 without touching the AT lane and skips `AT+CFUN?`; any other mode or a QMI miss falls through to `AT+CFUN?`, which still gives the exact 0 or 4 ([qmi-lane.md](qmi-lane.md#device-service-consumers-2026-11-08)). An unreadable `AT+CFUN?` counts as on, so recovery is never blocked by a failed read.
- **`plat_cc_count`** parses `ca.env` and `qmi.env` line by line and never sources them, as `data_used.sh` does.

### Module layout

| File | Responsibility | Public functions |
|---|---|---|
| `qmanager_watchcat` (main) | Dependency sourcing, path constants, library loader, `_wd_exit_cleanup`, `main()` (PID guard, traps, startup, the loop and its state edges) | `main`, `_wd_exit_cleanup` |
| `wd_config.sh` | Config read, `CFG_*` defaults, fixed constants, the shared quality limits | `read_config`, `resolve_quality_thresholds` |
| `wd_state.sh` | State file writer, maintenance-lock check, interruptible sleep, radio markers, `AT+CFUN?` helper | `write_state`, `write_state_busy`, `check_locked`, `wd_sleep`, `wd_mark_radio_down/up`, `wd_cfun_now` |
| `wd_detect.sh` | Ping read, outage age, dead prober, start gate, SSR gate | `read_ping`, `wd_outage_update`, `wd_outage_due`, `wd_step_wait_secs`, `wd_decide_start`, `wd_holdoff_left`, `wd_radio_reconcile`, `wd_start_gate`, `wd_ping_stale_tick`, `ssr_in_progress`, `ssr_hold_gate`, `ssr_hold_clear` |
| `wd_quality.sh` | Quality window and the quality trigger | `read_quality`, `wd_quality_mark`, `quality_breached`, `evaluate_quality` |
| `wd_carrier.sh` | The stuck-on-one-carrier trigger and its cooldown arm | `evaluate_carrier`, `wd_carrier_finish`, `wd_carrier_reset`, `wd_carrier_reload` |
| `wd_tiers.sh` | Tiers 1, 2, 4, escalation, per-reason hold-off, step wait, cooldown verdicts, last success | `execute_tier1/2/4`, `find_next_tier`, `wd_ladder_pick`, `do_recovery`, `wd_cooldown_verdict`, `finish_cooldown`, `wd_enter_radio_off`, `wd_holdoff_*`, `wd_step_wait_*`, `_wd_record_success` |
| `wd_sim.sh` | Tier 3, every slot swap, fallback, revert, auto-failback, failover record | `wd_read_slot`, `wd_swap_slot`, `execute_tier3`, `sim_failover_fallback`, `finalize_sim_failover`, `initiate_primary_recheck`, `check_revert_request`, `wd_sim_*`, `wd_failback_*` |
| `wd_ledger.sh` | Reboot count and budget, long-run guard, reboot history for the CGI | `count_recent_reboots`, `wd_reboot_rest_eval`, `wd_link_up_seen`, `wd_ledger_tick`, `wd_ledger_recent_json` |

### Ownership

Each global is declared and initialised by one library (top level, function definitions and initialisers only). Any library may read any global. New code writes a global only through its owner's function; the cross-library reset writes that predate the split (LOCKED entry and exit, natural recovery, the exhausted paths, the quality and carrier triggers) are listed in the comment block at the top of `main()`.

| Owner | Globals |
|---|---|
| main | path constants (`STATE_FILE`, `PID_FILE`, `RELOAD_FLAG`, `REVERT_FLAG`, `CRASH_LOG`, ...), loop temporaries |
| `wd_config.sh` | every `CFG_*`, `BOOT_SETTLE`, `MODEM_WAIT_TIMEOUT`, `SIM_SETTLE_SECS`, `HOLDOFF_*`, the quality floors |
| `wd_state.sh` | `state`, `prev_state`, `failure_counter`, `wd_radio_down`, `_wd_sleep_pid` |
| `wd_detect.sh` | `ping_streak_fail`, `ping_reachable`, `ping_during_recovery`, `wd_outage_age`, `wd_offline_secs`, `wd_act_after_eff`, `wd_resume_mono`, `wd_ping_stale`, `ssr_hold`, `last_ssr_detected`, `ssr_hold_started` |
| `wd_quality.sh` | `quality_breach_since`, `quality_since`, `q_avg_latency`, `q_packet_loss` |
| `wd_carrier.sh` | `carrier_single_since`, `carrier_cc`, `carrier_armed`, `carrier_trigger_min` |
| `wd_tiers.sh` | `current_tier`, `tiers_tried`, `last_recovery_*`, `total_recoveries`, `last_success_*`, `step_wait_until`, `cooldown_remaining`, `recovery_reason`, `wd_hold_out_until`, `wd_hold_q_*`, `wd_hold_c_*`, `holdoff_until`, `holdoff_reason` |
| `wd_sim.sh` | `sim_failover_active`, `original_sim_slot`, `current_sim_slot`, `revert_settle_active`, `primary_recheck_active`, `failback_failures`, `wd_sim_revert_pending`, `WD_SWAP_NOOP`, `WD_SWAP_FLAG_OWNED`, ... |
| `wd_ledger.sh` | `reboots_this_hour`, `reboot_budget_exhausted`, `reboot_rest_reason`, `reboot_rest_until`, the guard and link-up stamps |

### Loader guard

`main` sources its dependencies (`qlog.sh`, `safe_tmp.sh`, `events.sh`, `sim_db.sh`, `schedule_guard.sh`, `conn_state.sh`, which loads the adapter), defines the path constants, then loads the libraries in the fixed order `wd_config wd_state wd_detect wd_quality wd_carrier wd_ledger wd_tiers wd_sim`:

- Every `.` is guarded with `[ -f ... ]`. **Why:** BusyBox ash aborts the whole shell when `.` cannot find its file, even inside an `if`.
- Each file ends with a `..._LOADED=1` flag. The loader concatenates the adapter's flag and the eight library flags and requires `111111111`, so a truncated library (a partial deploy, a zero-byte file) is caught as well as a missing one.
- On any failure the daemon logs `refusing to start` and `exit 1` **before** the PID file, the traps or any AT command. It never runs half-loaded. procd retries (`respawn 3600 5 5`), every attempt is logged, and the heartbeat makes the Watchdog page show "Not reporting".
- Libraries stay definitions and initialisers only: no top-level commands, no sourcing of each other (the one exception is `wd_ledger.sh`, which sources the adapter, guarded and idempotent, so a CGI that sources it for `wd_ledger_recent_json` gets `PF_CRASH_LOG`).
- `WATCHCAT_NO_MAIN=1` makes the last line of the script skip `main`, so the harness can source the daemon. `WD_LIB_DIR` overrides the library directory (harness only).

> ⚠️ WARNING: Deploy order on a device is libraries first, then `qmanager_watchcat`, then `sync`, then compare md5 against the repo. A main script without its libraries refuses to start, which is safe but leaves the watchdog off. An unsynced copy followed by a power-off has zeroed core files before.

---

## How It Works

The Watchdog has **three triggers feeding one engine**, and the settings UI shows them together. Master off: the daemon exits at the enable gate and nothing below runs.

```
 OUTAGE (always on)              QUALITY (opt-in)                  CARRIER (opt-in)
 reachable=false for             avg latency / loss breach         one component carrier for
 >= act_after_sec                for >= quality_after_sec          >= carrier_after_min
 reason "outage"                 reason "quality"                  reason "carrier"
        \                              |                              /
         v                             v                             v
   start gate wd_start_gate <reason>:  none | holdoff | radio_off | go
                 v go
   ssr_hold_gate -> hold, or wd_ladder_pick -> do_recovery
                 v
   LADDER  Tier 1 COPS, Tier 2 CFUN, Tier 3 SIM failover, Tier 4 reboot
           (quality and carrier stop after Tier 2)
                 v
   STEP WAIT (cooldown) -> reason-aware verdict -> restored? MONITOR : escalate
                 v ladder exhausted
   per-reason hold-off (15 min; quality and carrier 15 -> 30 -> 60 min), back to MONITOR
```

**Priority.** When more than one trigger is due on the same pass, outage wins, then quality, then carrier: the main loop runs the outage path, then `evaluate_quality` (only in `monitor` or `suspect`), then `evaluate_carrier`, and each stops the later ones by moving `state` away from `monitor`. **Why:** a dead link is the larger problem, and a quality or carrier fix would act on a link that is not even reachable.

How the reasons differ:

| Aspect | Outage | Quality | Carrier |
|---|---|---|---|
| Starts when | `reachable=false` and outage age >= `max(act_after_sec, fail_secs)` | breach persists `quality_after_sec` | single-carrier run lasts `carrier_after_min` |
| Ladder | Tier 1 to 4 | Tier 1 to 2 | Tier 1 to 2 |
| Verdict (success) | fresh `reachable = true` | `reachable = true` **and** a clean quality window | fresh read of 2+ carriers **and** `reachable = true` |
| Hold-off after an exhausted ladder | 15 min, ended by a fresh `reachable=true` | 15 / 30 / 60 min, ended by a clean window | 15 / 30 / 60 min, ended by 2+ carriers |
| Step-wait floor | `max(step_wait_sec, recover_secs + 20)` | the same, raised to `10 x interval_sec + 10` | the same as outage |

### Outage trigger

An outage is the ping daemon's debounced `reachable=false`. The **outage age** is `min(fail_elapsed_sec, now - wd_resume_mono)`: an outage that aged while the watchdog could not act (boot settle, attach warm-up, radio off, LOCKED, a SIM settle) counts only from the moment it can act again. Recovery starts when the age reaches the **effective act-after** `max(act_after_sec, fail_secs)`, where `act_after_sec` is the setting (15-600 s, default 30) and `fail_secs` is the probe's own time-to-fail from Sensitivity (so the Watchdog never acts before the probe has declared the link down).

**Why a time and not a probe count:** the old `fail_threshold` counted failed probes, so "5 probes" was 5 s on `sensitive` and 50 s on `quiet`. `act_after_sec` is the delay the user actually wants. `failure_count` in the state file is only a display mirror of the raw `streak_fail`. The `MONITOR -> SUSPECT` edge is still `streak_fail > 0`, but nothing decides on the count.

**Staleness and unknown state.** `read_ping` is a thin wrapper over `conn_state_read`. A missing, stale or unreadable cache returns non-zero and the pass is skipped (previous values kept, state file still written); unknown is never treated as up or as down. A missing or corrupt `reachable` reads as `"null"`.

### Dead prober (`ping_stale`)

If the ping cache stays stale or missing for `WD_STALE_AFTER` (300 s on the mono clock; the episode starts at the first stale read, from any caller of `read_ping`, and ends at the first fresh one), the main loop (`wd_ping_stale_tick`) raises `ping_stale=true` in the state file, appends one `wd_ping_stale` event per episode, and starts the ping service (`svc_start "$PF_PING_SVC"`) at most once per `WD_STALE_RESTART_GAP` (900 s, spanning episodes). **Why:** a dead prober froze every trigger silently; before this the System Health Check was the only thing that noticed.

### Quality trigger

Opt-in (`quality_enabled=0`). On each pass in `monitor` or `suspect` with a fresh `reachable=true` and `streak_fail=0`, `evaluate_quality` reads the quality window and compares it with the shared limits. A breaching window starts the breach timer (`quality_breach_since`, mono); a clean window resets it; a no-signal window keeps it. The ladder starts once the breach has lasted `quality_after_sec` (30-1800 s, default 120). `quality_breach_secs` in the state file is the running time of the current breach. Any pass without fresh reachability ends the breach in progress.

**Why shared limits:** the Watchdog used to keep private `latency_ceiling_ms` / `loss_ceiling_pct` keys that could diverge from the Network Events limits. One save in Connection Quality now moves both.

**The limits.** `resolve_quality_thresholds()` (`wd_config.sh`) resolves the Connection Quality presets (absent = `tolerant`/`tolerant`, 250 ms / 30 %; `custom` is range-checked, latency 1-10000 and loss 1-100, otherwise the tolerant default), then raises them to the **watchdog floors** `max(latency, 50)` ms and `max(loss, 10)` %. A quality ladder never acts on a limit below 50 ms or 10 %, whatever the Connection Quality page shows. The CGI mirrors the rule in `wd_quality_limits` and reports the result as `effective.quality_limits`.

**The quality window.** Quality is judged from the ping daemon's raw sample history (`/tmp/qmanager_ping_history`), not from the poller's `status.json`. **Why:** `status.json` `.connectivity` is a rolling average (about 10 minutes at `quiet`), so a long-gone outage kept breaching the limits and a recovered link was escalated.

- `quality_since` is the monotonic second the window starts at; `wd_quality_mark` sets it to now. The window size is `n = min(W, (now - quality_since) / WD_PERIOD)` with `W = clamp(120 / WD_PERIOD, 10, 60)` samples, so it covers about two minutes at any Sensitivity. `WD_PERIOD` is the larger of the ping `interval_sec` and the rounded `cycle_ms` (`wd_probe_period`), because an outage cycle runs the parallel fan-out and outlasts a 1-2 s interval.
- **Fewer than 10 samples since the mark means no signal** (`read_quality` returns 1): the breach timer is neither advanced nor reset, and a cooldown that needs the verdict extends.
- Otherwise one `tail -n n | awk` computes the average of numeric lines (`%.1f`, or `null` when every sample is `null`) and the loss as `int(nulls * 100 / lines)`.
- `quality_breached` is OR logic: average latency over the limit, or loss at or over it. The average is a decimal string: **compare it with awk, never `[ -gt ]`** (BusyBox `[ "1241.4" -gt 800 ]` exits 2). An all-lost window has no average and is judged on loss alone.
- `wd_quality_mark` is called at startup after `BOOT_SETTLE`, on every pass with `ping_streak_fail > 0` and on the pass that ends the outage, after a recovery action (`do_recovery`), at the end of every `wd_swap_slot` that left the modem on a slot, and on LOCKED and `radio_off` exit.

### Carrier trigger (opt-in)

For a modem that sits on one component carrier (1CC) while reachable (a stuck aggregation, usually cleared by a re-registration). `carrier_enabled=0` by default; `carrier_after_min` is 5-240 minutes, default 15.

- **Signal.** `plat_cc_count` (the adapter) sets `PLAT_CC`, empty meaning unknown. A complete `ca.env` (poller, 5G SA) with `ca_rat=sa`, `ca_mono` at most 90 s old and a valid `ca_nr_cc` wins, and a zero or invalid count is unknown, never QMI's LTE count. Otherwise a complete `qmi.env` (broker) with `qmi_state=up`, `qmi_registered=1`, `qmi_ca_count >= 1` and `qmi_mono` at most 10 s old gives LTE/NSA (PCC included). A file with a bad line or no `qm_sidecar_end='1'` marker is unknown. **Why two sources:** the broker's sidecar is rewritten every 2 s whatever the poller tier, but QMI exposes LTE carriers only, so SA/NR-DC needs the poller's AT-derived count.
- **The poller side.** While `carrier_enabled=1` the poller publishes `ca.env` (`ca_mono`, `ca_source`, `ca_rat`, `ca_lte_cc`, `ca_nr_cc`, end marker) after every carrier read, and in the **deep** tier makes one gated read, `AT+QCAINFO=1;+QCAINFO;+QCAINFO=0` (never leaving `=1` set: the R01A04 rule), only when the serving cell is 5G SA, at most once per 60 s, and never during a scan, a SIM switch or a long-running AT operation. With the toggle off the deep tier stays QENG-only (Adaptive Polling Invariant 7). The CGI raises the poller reload flag when `carrier_enabled` is saved. See [adaptive-polling.md](adaptive-polling.md).
- **Arming.** The trigger counts only after this start (or settings reload) has seen 2+ carriers at least once: a modem that never aggregates is never "stuck". It never counts while `state` is not `monitor`, the link is not reachable, an SSR hold or outage is in progress, or `plat_tower_locked`.
- **Run.** `carrier_single_since` is the mono of the first fresh single-carrier read. An unknown read keeps the run, a read of 2+ resets it (and ends a carrier pause and a kept carrier tier). `carrier_single_secs` in the state file is the running time.
- **Ladder and verdict.** Tier 1 and Tier 2 only; Tier 3 and 4 are never run. Success is a fresh read of 2+ carriers on a reachable link; one carrier fails (escalate, or the pause after Tier 2); an unknown count extends up to 3 times, then the cooldown is inconclusive (tier kept); `reachable=false` at the verdict **hands over** to the outage trigger on its own rules. The reboot budget is untouched.
- Tier 1 drops a working link briefly (the WAN IP may change); the UI says so next to the toggle.

---

## State machine

```
MONITOR --- streak_fail > 0 ---> SUSPECT --- outage age >= act-after ---> start gate
   ^                                |                                          |
   |  reachable and streak 0        |  none/holdoff: stay in SUSPECT           | go
   +--------- (natural recovery) ---+  radio_off: -> RADIO_OFF                 v
   |                                                                  SSR_HOLD? -> RECOVERY
   |  cooldown verdict success                                                |
   +<------------------------------------------------------------------- COOLDOWN (step wait)
                  fail: escalate directly (do_recovery), or exhausted -> hold-off, MONITOR

LOCKED     any maintenance condition (lock file, long-running AT, profile apply, restore, manual SIM switch)
RADIO_OFF  the user turned the radio off (AT+CFUN 0 or 4); shown in the UI as "Paused"
DISABLED   written on a reload-disable exit
```

**Every "off" exit retires the service.** procd respawns any exit, whatever the code, and `start_service`'s UCI gate runs only on start or restart, never on respawn. So the reload-disable exit and the startup `Watchcat disabled in config` exit both call `wd_retire_service` (`wd_tiers.sh`) before `exit 0`: it runs `/etc/init.d/qmanager_watchcat disable` and then `stop`, the same steps as the UI's off switch. Without procd (a manual run or the harness), `stop` does nothing and the `exit 0` follows.

States written to the state file: `monitor`, `suspect`, `recovery`, `cooldown`, `locked`, `disabled`, `ssr_hold`, `radio_off`, and **`holdoff`**, which the writer derives (not a loop state): `monitor` while any reason's pause is active, or `suspect` while the outage pause blocks an outage. `recovery` is visible: `do_recovery` publishes the long heartbeat (`write_state_busy`) after the caller set `state="recovery"` and before the tier runs, so a long Tier 3 shows as `recovery`, not as a dead daemon.

Escalation goes **directly** from `_cooldown_handle_failure` into `do_recovery` at the next enabled tier; it does not bounce through `suspect`. **Why:** on the quality and carrier paths the link is reachable throughout, so a `suspect` bounce would fall through to natural recovery and abandon the ladder. `evaluate_quality` and `evaluate_carrier` run only in `monitor` and `suspect`/`monitor` respectively, never in `cooldown`, `locked`, `radio_off`, `recovery` or `ssr_hold`: evaluating during an SSR self-heal would re-trigger the path and defeat the hold.

### Start gate

Every start site (the outage threshold in `main`, `evaluate_quality`, `evaluate_carrier`) and the escalation inside `_cooldown_handle_failure` call `wd_radio_reconcile <reason>` and then `wd_start_gate <reason>`, which gathers three inputs and feeds the pure function `wd_decide_start <tiers_any 0|1> <cfun> <holdoff_left>`:

| Order | Verdict | Condition | Effect |
|---|---|---|---|
| 1 | `none` | no tier is eligible for this reason | nothing runs; state, counters and events are left alone |
| 2 | `holdoff` | that reason's pause has not ended | same as `none`, until the pause ends |
| 3 | `radio_off` | `AT+CFUN?` reads 0 or 4 | `wd_enter_radio_off` |
| 4 | `go` | otherwise | `ssr_hold_gate`, then `do_recovery` |

"Eligible" depends on the reason: quality and carrier count Tiers 1-2 only; outage also counts Tier 3 and a Tier 4 that is not resting. `wd_start_gate` reads `AT+CFUN?` (through `wd_cfun_now`, QMI first) only when it matters: some tier eligible, no pause running, and `wd_radio_down != 1`. While our own Tier 2 marker is set, a radio that is off is ours, not the user's, so it is reported as on and the ladder keeps escalating. `wd_radio_reconcile` runs first: with the marker set it reads `AT+CFUN?` and clears the marker when the radio reads 1.

### radio_off (shown as "Paused")

**Why:** airplane mode or a deliberate `AT+CFUN=0/4` kills the link by design. Treating that as an outage made the watchdog fight the user (and Tier 2 could leave the radio off).

`wd_enter_radio_off` sets `state="radio_off"`, resets the tier, counters, step wait, the carrier run and SSR hold, removes the recovery flag and appends the event "Watchcat: radio is off, recovery paused until it is turned back on" (`wd_radio_paused`). Each pass in `radio_off` the main loop reads `AT+CFUN?`: a positive `1` returns to `monitor` (counters reset, `wd_quality_mark`, then `wd_sim_on_radio_back` to finish a deferred SIM swap-back); an unreadable reply keeps waiting. The asymmetry is deliberate: the start gate never blocks recovery on an unreadable read, but the exit needs positive evidence.

**The outage clock restarts when the radio comes back.** The outage age counts only from `wd_resume_mono`, which the radio-back exit, the attach warm-up end, the LOCKED exit and every SIM settle re-stamp. **Why:** `qmanager_ping` keeps counting failed probes while the radio is off, so `fail_elapsed_sec` is huge at the resume; without the restart, Tier 1 (`COPS=2/0`) fired about 20 s after airplane mode ended, before the data link re-attached, and the deregistration slowed the re-attach (live 2026-10-21). A link that stays down after the resume still recovers after a full act-after (harness scenarios 70, 73, 74).

The UI maps `radio_off` onto the existing Paused phase.

### LOCKED

`check_locked` is true for the maintenance lock, the long-running AT flag, a live profile-apply PID, a live config-restore PID, or a manual SIM-switch flag held by another process (not this daemon's own Tier 3 swap; a flag older than 120 s on the mono clock counts as stale). Entering LOCKED abandons any recovery in progress (the lock holder owns the modem): flags, counters, the carrier run, `revert_settle_active` and SSR hold are reset, and `primary_recheck_active` is remembered as `recheck_interrupted`. Exiting resets again, calls `wd_quality_mark`, re-stamps the resume point and calls `wd_sim_on_unlock` (see [SIM failover](#sim-failover)). `install.sh` touches the lock for the whole install window.

---

## Step wait and verdicts

After a tier runs, the daemon waits for the link to settle before judging it. The wait is the **step wait**: a mono deadline `step_wait_until` (`cooldown_remaining` is kept for compatibility). The effective wait is

```
max(step_wait_sec, recover_secs + 20, floor)
```

with `step_wait_sec` the setting (10-300 s, default 60). **Why `recover_secs + 20`:** an outage verdict needs `recover_secs` of answered probes (the probe's time-to-recover at the current Sensitivity), so a shorter wait could only ever fail. The `floor` is `SIM_SETTLE_SECS` (90 s) for Tier 3 and every SIM settle (a physical swap is still attaching well past a generic wait), and `10 x interval_sec + 10` for a quality cooldown, so its window can hold the 10 samples a verdict needs (Amendment 2). An unreadable mono clock falls back to counting passes.

`wd_cooldown_verdict <reason> <ping_ok> <reachable> <q_state> <stale_retries>` is pure (no I/O, no globals) and prints `success`, `extend`, `fail`, `inconclusive` or, for carrier, `handover`:

| Condition | Verdict |
|---|---|
| ping not fresh | `extend` while `stale_retries < 3`, then `inconclusive` |
| outage, `reachable = true` | `success` |
| outage, anything else | `fail` |
| quality, window clean and `reachable = true` | `success` |
| quality, window breached (or clean but not reachable) | `fail` |
| quality, no data | `extend` while `stale_retries < 3`, then `inconclusive` |
| carrier, `reachable = false` | `handover` |
| carrier, `reachable = true` and 2+ carriers | `success` |
| carrier, `reachable = true` and 1 carrier | `fail` |
| carrier, count unknown or `reachable = null` | `extend` while `stale_retries < 3`, then `inconclusive` |

**Why a different test for quality and carrier:** a degraded or single-carrier link reports `reachable = true` the whole time, so judging by reachability would always declare success and burn through the tiers. An extension moves the deadline by one check interval and keeps the recovery flag touched so events stay suppressed. `finish_cooldown` arm order: primary-recheck settle, post-revert settle, the carrier verdict, then quality, then outage.

**Inconclusive** (no data after 3 extensions) is neither success nor failure: an unconfirmed Tier 3 is swapped back, the daemon returns to `monitor`, and `current_tier` **and** `tiers_tried` are kept, so the next trigger of the same reason resumes at the next tier (`wd_ladder_pick`) instead of looping Tier 1. A kept tier is cleared by natural recovery (outage), a clean window (quality), 2+ carriers (carrier) or the trigger being turned off.

**Success** records the last-success figures (`_wd_record_success`): `last_success_time` (epoch, `null` while the clock is insane per the 1970 rule), `last_success_tier`, `last_success_reason` and `last_success_took_s` (trigger to verdict, mono). A natural recovery does not count, and a Tier 4 reboot cannot reach a verdict, so neither is recorded. All of it lives in memory only; the UI labels the figures "since last restart".

---

## Recovery ladder

| Tier | Action | AT commands | Skipped when |
|---|---|---|---|
| 1 | Network re-registration | `AT+COPS=2` -> 2 s -> `AT+COPS=0` | never (when enabled) |
| 2 | Radio toggle | `AT+CFUN=0` -> 3 s -> `AT+CFUN=1`, then confirm | tower lock active (LTE or NR-SA); long-running AT flag |
| 3 | SIM failover | `wd_swap_slot` (`CFUN=0`, `QUIMSLOT=N`, `CFUN=1`, verified) | no backup slot; failover already active; slot unreadable; backup equals the current slot; swap not verified; **not run for quality or carrier** |
| 4 | System reboot | `( sleep 1; plat_reboot ) &` | reboot budget spent or long-run guard engaged (Tier 4 rests); **not run for quality or carrier** |

A skipped tier (return 1) moves to the next enabled tier; a skipped Tier 3 logs `TIER 3 SKIPPED: <reason>`. When none is left, the ladder is exhausted (hold-off below). `find_next_tier` caps a quality or carrier ladder at Tier 2 (`top=2`): a SIM swap or a reboot is never run for a reachable link. **Why:** a degraded link is often a stuck RF or attach condition that a re-registration or radio cycle clears, but a SIM swap or reboot for a link that still passes traffic costs more than it saves.

**Why Tier 1 is `AT+COPS`, not `ifdown/ifup`:** bouncing the host interface does nothing for a stalled modem attach; forcing deregistration and re-registration does.

**Why Tier 2 is skipped under a tower lock:** `AT+CFUN=0/1` power-cycles the radio and clears the lock state. The skip uses the LTE and NR-SA locks only (see the adapter notes above).

**Tier 2 never leaves the radio off.** After `CFUN=1` and `wait_for_modem`, `_wd_confirm_radio_on` reads `AT+CFUN?`. Anything but `1` gets one more `AT+CFUN=1` and a second read. The marker is cleared only when the radio is confirmed on; if it still is not, the marker stays, the exit cleanup restores the radio, and the start gate keeps escalating instead of mistaking it for the user's airplane mode. A reachable link in `monitor` also clears a stale marker.

**Why Tier 3 is off by default (`tier3_enabled=0`):** it needs a backup SIM. The CGI rejects `tier3_enabled=true` without a backup slot (`invalid_field`) and rejects clearing the slot while Tier 3 is on; the daemon also skips the tier silently if the slot is unusable.

**Tier 3 settle floor.** A physical swap on the RM551E takes about 90 s to be stable. After a Tier 3 action the step wait is raised to `SIM_SETTLE_SECS`, and the same floor applies to revert and recheck swaps.

### Hold-off after an exhausted ladder

**Why:** an exhausted ladder used to return to `monitor` and the next pass restarted it from Tier 1, so a dead link ran the whole ladder (including Tier 2 radio cycles) back to back forever.

- Both exhausted sites (`do_recovery` when no tier is left, `_cooldown_handle_failure` when `find_next_tier` fails) call `_wd_ladder_exhausted` -> `_wd_start_holdoff` for the **reason being run** and append "Watchcat: all recovery steps tried, pausing N minutes" (`wd_holdoff`, error). The pause blocks a new ladder **of that reason only**: an outage can start during a quality pause and the reverse.
- **Outage:** 15 minutes, fixed. Ended early by a fresh `reachable=true` read (any state that gets there).
- **Quality and carrier:** 15, then 30, then 60 minutes on consecutive pauses (`holdoff_quality_level`, `holdoff_carrier_level`, 0-2). The level steps up when the previous pause ended less than an hour ago and drops back to 0 after an hour with no pause (`wd_holdoff_tick`). A quality pause is ended early by a clean quality window or a quality cooldown success (**never** by reachability: the link is reachable throughout, and one good probe would end the pause and restart the ladder every few minutes); a carrier pause by 2+ carriers or a carrier success. Early end keeps the level.
- A settings save (reload flag) ends the quality and carrier pauses, resets their levels and re-arms the carrier trigger (`wd_holdoff_reload`, `wd_carrier_reload`); it also clears a failback give-up (`wd_failback_reload`).
- `state` reports `holdoff` while a pause is active, and `holdoff_until` / `holdoff_reason` report the pause that **ends last** (a tie goes to outage, then quality). The pauses live in shell variables: a daemon restart or reboot starts fresh.

---

## Reboot budget and the long-run guard

Tier 4 rests; it never disables the Watchdog. **Why:** the old token bucket auto-disabled the daemon at the cap, which silently ended all recovery (a "watchdog off" the user never asked for) and needed a manual re-enable.

- **Hourly budget.** `max_reboots_per_hour` (1-10, default 3) caps `tier4_escalation` rows in the rolling hour. At the cap, `reboot_budget_exhausted=true` and Tier 4 is not eligible (`reboot_rest_reason="hourly"`, `reboot_rest_until` the mono second the count drops below the cap); Tiers 1-3 keep working, `find_next_tier` passes over a resting Tier 4, and one `wd_budget_spent` event fires per episode.
- **Long-run guard.** If the budget was also spent in the **previous** hour with no link-up since, Tier 4 rests until the link has been up once **or 24 hours** have passed (`reboot_rest_reason="long_outage"`, event "reboots paused until the connection comes back (long outage)"). **Why:** a modem with a truly dead path (no SIM, no coverage) would otherwise reboot three times an hour forever and wear the flash. Two persistent files in `/etc/qmanager`, written **only on their edges** (flash): `wd_reboot_guard` (`<engage epoch>`) and `wd_link_up` (`<epoch>` of the first reachable read after a watchdog reboot).
- **Clock.** The rolling hour is wall-clock, so an insane clock (the RM551E boots at 1970 until NITZ/ntp steps it) cannot evaluate it: the count then includes every row older than 2025-01-01, which over-counts in the safe direction, and the guard is neither engaged nor released (an engaged guard file keeps Tier 4 resting) and no deadline can be given (`reboot_rest_until` null). Deadlines are converted to mono with the current epoch-to-mono offset.
- `wd_ledger_tick` is the first statement of every main-loop pass and recounts at most once a minute, so the figure decays within about a minute of a row aging out. A Tier 4 recount runs again right before the reboot.
- `reboots_this_hour` counts only `tier4_escalation` rows. `/etc/qmanager/crash.log` is a shared ledger: the Watchdog writes `tier4_escalation`, `record_planned_reboot` (`qlog.sh`) writes `user`/`unplanned` rows for the reboot alert. **Why:** the budget and the "Reboots" figure mean "watchdog-caused reboots this hour"; Alerts counts every row. Do not merge the two counters (see [Alerts](alerts.md#reboot-alerts)).
- `wd_ledger_recent_json <limit>` (default 5) prints the Tier-4 epochs as a JSON array, newest first, `[]` on any problem. It uses no daemon globals, so the CGI sources it behind an `-f` guard with a stub that returns `[]`. The device `jq` has no regex, so numeric epochs are matched in awk.

`execute_tier4` appends `Watchcat: rebooting system (Tier 4)` (code `wd_tier4_reboot`), writes `<epoch>|reboot|tier4_escalation` to `crash.log` (trimmed to the last 20 lines), writes the state file, removes the recovery flag and reboots in a detached subshell.

> ⚠️ WARNING: The event text `Watchcat: rebooting system (Tier 4)` is an invariant. The Recovery Activity card dedupes its ledger-backed restart row against the RAM event by looking for `Tier 4` plus `reboot` in a `watchcat_recovery` message within 120 s of the ledger epoch (`isRebootEvent`, `recovery-activity-card.tsx`). Change the wording and a restart shows twice.

UI wording is "Reboots" with the value `reboots_this_hour of reboot_limit`; the Recovery Activity card merges `recent_reboots` with the RAM events, drops epochs at or below `CLOCK_PLAUSIBLE_AFTER` (1_600_000_000, the 1970-era rows), dedupes as described above and caps at five rows.

---

## SSR-aware hold

### What an MPSS SSR is

The RM551E radio firmware runs on the MPSS subsystem, which can hit a fatal error and restart itself. The kernel logs `4080000.remoteproc-mss: fatal error received`; remoteproc brings it back in about 3-4 s and the data path returns in roughly 10-25 s. It is a recoverable, firmware-level event QManager neither causes nor prevents.

### The amplification problem

During those seconds the link looks dead, and a watchdog that fires Tier 1/Tier 2 on top of a modem that is already healing turns a 30-60 s self-correcting outage into a multi-minute thrash.

### The hold

With `ssr_aware=1` (default) every start site calls `ssr_hold_gate()` after the start gate returns `go` and before `do_recovery`. `ssr_in_progress()` polls the adapter once (`plat_ssr_poll`: the newest fatal-error line from `dmesg`, parsed with `sed 's/^\[[ ]*\([0-9]*\)\..*/\1/'`) and compares its uptime second with `/proc/uptime`. The look-back window is

```
ssr_grace_sec + effective act-after + 8 + 2 * 10      (seconds)
```

**Why not the grace alone:** the crash only becomes visible to the ladder after the outage age has reached the effective act-after, plus one worst probe cycle (8 s) and two check passes (2 x 10 s). On a slow Sensitivity a bare 45 s window always expired first, so the hold never engaged and every SSR was amplified. The hold length itself is `ssr_grace_sec` (10-120 s, default 45).

**One hold per SSR.** Each restart's identity (`PLAT_SSR_ID`, the crash second) holds at most once (`_wd_ssr_held_id`): a later escalation for the same restart (the Tier 4 re-check, a second trigger) goes to the ladder.

Graceful degradation: no `dmesg` output, an evicted line or an unparsable timestamp returns false and the daemon behaves as if the feature did not exist. The hold is a de-amplifier, never a correctness dependency (the reboot budget is the backstop).

When holding: `state="ssr_hold"`, `ssr_hold_started` and `last_ssr_detected` record the monotonic uptime, `do_recovery` is skipped, `current_tier` is not advanced, no AT command runs. `ssr_hold_until` in the state file is `ssr_hold_started + ssr_grace_sec`. Each pass re-evaluates through the merged `suspect|ssr_hold` arm:

- **Connectivity returns:** reachable and streak 0 -> `ssr_hold_clear`, back to `monitor`; no recovery ran.
- **Grace expires:** `ssr_hold_gate` clears the hold and returns 1; the ladder runs from the tier found before the hold (no tier skip).

`ssr_hold` is also cleared on LOCKED entry/exit and when entering `radio_off`. A quality- or carrier-triggered hold resolves through the reachability arm (the link is reachable again); a `suspect -> monitor` log line instead of `ssr_hold -> monitor` is expected. It defaults ON so affected users benefit on upgrade; the `dmesg` grep only runs at an escalation decision.

---

## Heartbeat contract

The Watchdog page must never show a frozen last state when the daemon has died, so the daemon proves it is alive.

| Piece | Contract |
|---|---|
| State file | `write_state` adds `mono` (integer `/proc/uptime` seconds via `mono_now`) and `stale_after` (`3 * CFG_CHECK_INTERVAL + 60` = 90 s). `write_state_busy` writes the same file with `stale_after = 600`; it is called at the top of `do_recovery` and around each swap attempt in `wd_swap_slot`, so a minutes-long Tier 3 is not reported dead. |
| Poller | `read_watchcat_state` (Tier 1.5, every 10 s, behind an mtime re-read gate) reads the state file. When the file is **absent** it resets **all** `wc_*` variables to defaults (enabled false, state `disabled`). The composers emit `watchcat.age_sec` = poller `mono` minus `watchcat.mono` (clamped at 0, `null` when either is missing or zero) and `watchcat.stale_after`. |
| UI | `isWatchcatLive(w)` (`derive.ts`): enabled and not (`age_sec > stale_after`). `derivePhase` returns `not_running` ("Not reporting") when enabled but not live, `deriveBand` shows figures only for reporting phases, and `use-watchdog-indicator.ts` hides the sidebar pill when not live. |

**Why mono, not timestamps:** the NITZ `time_daemon` and `ntpd` step the wall clock about 90 s forward after an SSR, which made wall-clock ages look stale. The age is a monotonic delta on both sides.

**Exit cleanup removes the state file.** A stopped daemon therefore reads as "daemon gone" at once (absent file, poller defaults), not as a frozen last state; the UI shows "Starting" inside the 60 s `useGraceGate` after a save and "Not reporting" after it. `stale_after` also covers a hung daemon (`kill -STOP`): the file stays but ages out.

`write_state` coerces every numeric and boolean input first (`_wd_num` accepts plain non-negative integers without a leading zero, else the default), builds the JSON into a variable and writes it atomically (`qm_atomic_write`) only when non-empty. One corrupted global cannot leave the state file empty or stale.

---

## State file and `status.json.watchcat`

`/tmp/qmanager_watchcat.json` is rewritten once per main-loop pass (and at the start of each long action). The CGI returns it verbatim as `status`; the poller re-publishes a subset as `status.json.watchcat`.

| Key | Type | Notes |
|---|---|---|
| `timestamp`, `mono`, `stale_after` | int | Wall clock, `/proc/uptime` seconds, and the heartbeat limit (90 s, or 600 s for `write_state_busy`) |
| `enabled` | bool | |
| `state` | string | `monitor`, `suspect`, `recovery`, `cooldown`, `locked`, `disabled`, `ssr_hold`, `radio_off`, `holdoff` |
| `current_tier`, `tiers_tried` | int, int[] | The running tier and the tiers already tried in this ladder |
| `recovery_reason` | string or null | `outage`, `quality` or `carrier`; **non-null only** in `recovery`, `cooldown` and `ssr_hold` |
| `last_recovery_time`, `last_recovery_tier`, `last_recovery_reason` | int/null | `last_recovery_reason` is `null` whenever `last_recovery_time` is `null` |
| `total_recoveries` | int | Since daemon start |
| `last_success_time`, `last_success_tier`, `last_success_reason`, `last_success_took_s` | null or value | See [Step wait and verdicts](#step-wait-and-verdicts); in memory only |
| `failure_count`, `failure_secs`, `offline_secs` | int | Display figures: the raw probe streak, the outage age used for the trigger (`failure_secs`), and the ping daemon's raw `fail_elapsed_sec` (`offline_secs`, not clipped by the resume point) |
| `cooldown_remaining` | int | Kept for compatibility |
| `step_wait_until` | int or null | Mono deadline; non-null only while `state` is `cooldown` |
| `holdoff_until`, `holdoff_reason` | int/null, string/null | The pause that ends last, only while it is in the future |
| `holdoff_quality_level`, `holdoff_carrier_level` | int 0-2 | Which step of the 15/30/60 minute ladder the next pause uses |
| `reboots_this_hour`, `reboot_limit` | int | |
| `reboot_budget_exhausted` | bool | |
| `reboot_rest_reason`, `reboot_rest_until` | string/null, int/null | `hourly` or `long_outage`, and the mono deadline when the daemon can compute one |
| `ssr_hold`, `ssr_hold_until`, `last_ssr_mono` | bool, int/null, int/null | `ssr_hold_until` is the mono deadline of the current hold |
| `quality_breach_secs`, `carrier_single_secs`, `carrier_cc` | int, int, int/null | Running times of the current breach and single-carrier run; the last carrier count read |
| `failback_active`, `failback_failures`, `failback_next_at` | bool, int 0-3, int/null | See [SIM failover](#sim-failover) |
| `sim_failover_active`, `original_sim_slot`, `current_sim_slot` | bool, int/null | |
| `ping_stale` | bool | See [Dead prober](#dead-prober-ping_stale) |

The poller's `status.json.watchcat` carries `enabled`, `state`, `current_tier`, `failure_count`, `last_recovery_time`, `last_recovery_tier`, `total_recoveries`, `cooldown_remaining`, `reboots_this_hour`, `age_sec`, `stale_after` and nine keys added by this design: `recovery_reason`, `step_wait_until`, `holdoff_until`, `holdoff_reason`, `reboot_budget_exhausted`, `ssr_hold_until`, `failback_next_at`, `ping_stale` and `mono`. `last_recovery_reason` is not republished; read it from the CGI `status`.

**Interpolate deadlines against `watchcat.mono`.** `step_wait_until`, `holdoff_until`, `ssr_hold_until`, `reboot_rest_until` and `failback_next_at` are seconds on the **daemon's** monotonic clock. Never compare them with the browser's clock or the wall-clock `timestamp`; the remaining time is `deadline - watchcat.mono`, then counted down locally from the moment the response arrived (`receivedAt`). **Why:** the wall clock steps by ~90 s after an SSR and starts at 1970 on boot; the monotonic clock does neither. The poller's republish rules (mtime gate, defaults when the file is missing, the gated Invariant 7) are in [adaptive-polling.md](adaptive-polling.md).

---

## Stop, TERM and exit cleanup

A foreground `sleep N` delays the shell's TERM trap until it returns, so `procd` stop used to wait out the whole interval and then SIGKILL. Now:

- `wd_sleep N` runs `sleep` in the background and `wait`s on it, so TERM interrupts the wait at once. It replaces `sleep` for the boot settle and every main-loop pass.
- `main` installs `trap '_wd_exit_cleanup' EXIT`, `trap 'exit 143' TERM`, `trap 'exit 130' INT`. TERM and INT only `exit`; cleanup runs exactly once from the EXIT trap (ash runs the EXIT trap after `exit` inside a signal trap).
- `_wd_exit_cleanup` kills the orphaned background sleep, restores the radio if `wd_radio_down=1` (`AT+CFUN=1`, **never** `1,1`), removes `/tmp/qmanager_sim_switch_active` when this daemon owns it (`WD_SWAP_FLAG_OWNED`), then removes the PID file, `STATE_TMP`, the recovery flag and the state file.
- The init script sets `term_timeout 15` and its `stop_service` also removes the state file.

**Why the radio marker:** `wd_mark_radio_down` is set before every `AT+CFUN=0` (Tier 2, `wd_swap_slot`) and cleared only once `AT+CFUN?` reads 1. A TERM landing between the two commands must not leave the modem's radio off.

> ℹ️ NOTE: `install.sh` still does `killall -9 qmanager_watchcat` after the init stop, and SIGKILL bypasses the EXIT trap. A kill that lands between `CFUN=0` and `CFUN=1` is therefore not covered by the cleanup (see Known deferred, F-03).


---

## SIM failover

Tier 3 and every other slot change (fallback, user revert, recheck, failback) go through one verified primitive.

### Known-SIM tracking

Every SIM the watchdog lands on is recorded with `sim_db_add` (`sim_db.sh`) so the poller's boot-time swap detector does not raise "New SIM card detected". The backup SIM is learned right after the CPIN check during Tier 3, not only at finalize, so a reboot mid-cooldown is safe. ICCID reads retry 3 times, 1 s apart (`_wd_sim_iccid`); an unreadable ICCID never blocks a swap or a revert. `sim_db_add` replaced the retired `last_iccid` write.

### Verified swap (`wd_swap_slot <target>`)

**Why:** `AT+QUIMSLOT=N` can return `OK` and change nothing (a silent no-op, most often when the poller is also talking to the modem). The old code trusted the radio cycle and recorded a failover that never happened.

`wd_read_slot` prints the slot digit from `AT+QUIMSLOT?` (3 tries, 1 s apart) or nothing. `wd_swap_slot`:

1. Reads the live slot. If it already equals the target, returns 0 with `WD_SWAP_NOOP=true` and no radio cycle.
2. Up to two attempts of: touch `/tmp/qmanager_sim_switch_active` (pauses the poller's AT traffic) and `write_state_busy`; `wd_mark_radio_down`; `AT+CFUN=0`; 2 s; `AT+QUIMSLOT=<target>`; 2 s; `AT+CFUN=1`; `wait_for_modem`; re-read the slot and `AT+CFUN?` (a CFUN other than 1 gets one more `AT+CFUN=1`); `wd_mark_radio_up` when CFUN reads 1. Success needs both the slot and CFUN=1.
3. If no attempt verified, one last slot read decides between rc 2 and rc 3 (below).
4. Removes the flag; for every rc except 1 it touches `/tmp/qmanager_force_tier2` and `/tmp/qmanager_refresh_policy_band` (the dashboard shows the new SIM, same as `cellular/settings.sh`) and calls `wd_quality_mark`.

| rc | Meaning | Callers treat it as |
|---|---|---|
| 0 | Slot reads back as the target and the radio is on, or the modem was already there | success |
| 1 | The final re-read shows the modem is not on the target | nothing happened; nothing to record |
| 2 | Modem is on the target but the radio is not confirmed on (a last `AT+CFUN=1` was sent; the radio marker stays set if CFUN still does not read 1) | the swap happened; record it like rc 0 |
| 3 | The final slot read failed too; outcome unknown | "not proven": callers that must know call `wd_sim_adopt_live_slot`, the rest treat it like 1 |

Call sites:

| Site | On rc 1 (and 3 where noted) |
|---|---|
| `execute_tier3` | restart tower failover, `original_sim_slot` stays `null`, return 1 (tier skipped). rc 3: read the slot again; unreadable -> assume swapped and record; still original -> skip; other -> adopt. |
| `sim_failover_fallback` | return 1 with every failover variable intact and an error event; rc 0/2 count as a completed revert |
| `initiate_primary_recheck` | stay on the backup, restart the recheck clock, no settle (rc 1 and 3) |
| return leg in `wd_sim_finish_recheck` | read the slot: modem stayed on the primary -> treated as a failback with the benign settle; otherwise error event and `current_sim_slot` from the read |

### Tier 3 sequence

1. Skip the tier (return 1, one `TIER 3 SKIPPED: <reason>` log line) when: the recovery reason is not an outage (`recovery reason is quality` or `carrier`), no backup slot is configured, a failover is already active (`already on the backup SIM`), the current slot is unreadable, or the backup equals the current slot.
2. Capture the original SIM's ICCID, stop `qmanager_tower_failover` (its locks mean nothing on another SIM).
3. `wd_swap_slot` (above). `original_sim_slot`, `original_sim_iccid`, `current_sim_slot` are set **after** a verified swap, so a swap that never happened leaves no record.
4. Save the **unconfirmed** failover record (`confirmed:false`) immediately, so a reboot during the settle still knows the modem is on the backup.
5. `AT+CPIN?` guard: up to 3 reads, 1 s apart; only `rc=0` with `+CPIN: READY` passes (right after `CFUN=1` the modem can answer `+CME ERROR: 14`, SIM busy). Otherwise `sim_failover_fallback`, then `wd_sim_adopt_live_slot` if that failed. Daemon AT checks judge `"$rc:$result"`: on this target `qcmd` prints a modem `ERROR` on stdout with rc 0, and a transport failure exits non-zero with empty stdout. The "could not confirm" log line carries the first reply line (e.g. `+CME ERROR: 10` for an empty slot), or `no reply` on a transport failure.
6. Enter the step wait with the 90 s settle floor: `wd_step_wait_secs "$SIM_SETTLE_SECS"` = `max(step_wait_sec, recover_secs + 20, 90)`.
7. On a successful cooldown, `finalize_sim_failover` (shared by both success arms, self-guarded: Tier 3, slot moved, original known) sets `sim_failover_active`, rewrites the record without `confirmed`, runs `sim_db_add`, auto-applies a matching custom profile (`auto_apply_profile ... "watchdog"`) and arms the failback clock (`_wd_failback_arm`: `last_recheck_time` = now, mono).

### Failover record (two copies)

| Copy | Path | Role |
|---|---|---|
| RAM | `/tmp/qmanager_sim_failover` | what the poller (`status.json` `sim_failover`: `active`, `original_slot`, `current_slot`, `switched_at` only) and the CGI GET read |
| Flash | `/etc/qmanager/sim_failover.json` | survives a reboot; the modem keeps its slot across a reboot, so the failover must too |

Only `wd_failover_save <json>` and `wd_failover_clear` touch them. `wd_failover_save` refuses an empty record (a failed `jq` must never blank a good file), writes `/tmp` with `qm_atomic_write` and flash with `qm_durable_write`. Flash writes happen only at save and clear (rare). `wd_failover_clear` removes both.

```json
{
  "active": true,
  "original_slot": 1,
  "current_slot": 2,
  "switched_at": 1718900000,
  "reason": "connectivity_failure",
  "original_iccid": "89014103211118510720",
  "current_iccid": "89012303211118510720",
  "confirmed": false,
  "revert_pending": true
}
```

| Key | Notes |
|---|---|
| `reason` | `connectivity_failure` or `quality_degradation` (mirrors `recovery_reason`) |
| `original_iccid` | `""` only if the 3-try read failed entirely |
| `confirmed` | present **only** as `false`: saved right after a Tier 3 swap, before the cooldown judges it. `finalize_sim_failover` and a resume drop it. |
| `revert_pending` | present **only** as `true`: a swap-back deferred because the user turned the radio off, kept across a daemon restart (see below) |

> ℹ️ NOTE: The poller publishes `active` from the /tmp record, so the dashboard failover banner can appear during the Tier 3 cooldown, before the swap is confirmed. If the cooldown fails, the fallback clears the record.

### Adopt-live-slot rule

`wd_sim_adopt_live_slot` runs after any revert that was not proven (`sim_failover_fallback` returned 1). The modem is then most likely still on the backup with `sim_failover_active=false` and no record, so a user revert, auto-failback and a reboot would all be blind to it. It requires `original_sim_slot` to be known, reads the live slot, and: unreadable -> leave state alone; equal to the original -> clear a stale record; otherwise mark the failover active, save the record (with ICCID and reason), `sim_db_add` and start the recheck clock. It sets `WD_ADOPT_SLOT` for callers that must branch on the result. Callers: `_cooldown_handle_failure`, the Tier 3 CPIN failures, `_wd_sim_revert_run`, `wd_sim_on_unlock`, `wd_sim_defer_revert`, and Tier 3 rc 3.

### Resume at start, and the 60 s retry

`wd_sim_resume_at_start` runs in `main` after `BOOT_SETTLE` and `wd_quality_mark` (the modem answers by then), and again from `wd_sim_resume_retry`.

- Candidates in order: the /tmp copy, then the flash copy. Each must be root-owned (`qm_trusted_file`); an untrusted copy is removed. The first copy that parses wins; `active` must be `true`.
- The live slot comes from `wd_read_slot`. **Unreadable: keep both copies and activate nothing** (a blank read must never delete a valid record). **Match with `current_slot`: resume** (restore slots and `original_iccid`, copy the flash record into /tmp or vice versa so both exist, restart the recheck clock, drop `confirmed:false`). **Mismatch: `wd_failover_clear`.**
- `wd_sim_resume_retry` retries a record that startup could not resume every `WD_RESUME_RETRY_SECS` (60 s) while idle in `monitor`, no failover is active and a copy exists. The first call only arms the timer.

### Revert semantics (`check_revert_request`)

A user revert (`POST action=revert_sim`) writes the flag; the daemon calls `check_revert_request` every pass before the lock check. A flag that is not root-owned is dropped.

| Condition | Action |
|---|---|
| Failover active, state `recovery` or `cooldown` | keep the flag, defer |
| Failover active, `check_locked`, or state `locked`, `radio_off`, `ssr_hold` | keep the flag, defer (a swap now would cycle the radio under the lock, airplane mode or hold) |
| Failover active and idle | consume the flag, event, `_wd_sim_revert_run` |
| No failover, but a Tier 3 swap is mid-flight (slot moved, not finalized) | keep the flag pending until finalization |
| Nothing to revert | delete the flag |

`_wd_sim_revert_run` calls `sim_failover_fallback`. On failure (swap back not verified) it returns 1 with the failover still active and the record kept (plus the adopt rule); the request is consumed and the user can ask again. On success it clears the record; when `WD_SWAP_NOOP=true` (already on the original slot) there is no settle, otherwise the post-revert settle runs (`revert_settle_active=true`, a step wait with the 90 s floor, state `cooldown`). The settle is a benign hold: `finish_cooldown` returns to `monitor` without running the verdict or escalating.

**Why defer instead of drop:** a revert that arrived during the post-swap cooldown used to be deleted silently.

### Revert pending (airplane mode during a failed Tier 3)

If a Tier 3 cooldown fails while the radio is off, the swap-back would cycle a radio the user turned off. `_cooldown_handle_failure` instead calls `wd_sim_defer_revert`: the modem stays on the backup as a recorded failover, `wd_sim_revert_pending="true"`, and the record gets `revert_pending:true`; the daemon parks in `radio_off`. The swap-back is completed through the same `_wd_sim_revert_run` path:

- when the radio comes back (`wd_sim_on_radio_back`, from the `radio_off` arm);
- at the next daemon start (`wd_sim_resume_at_start`): radio on -> run now; radio off -> `radio_off` and wait; under a maintenance lock it only stays pending;
- after a lock ends (`wd_sim_on_unlock`), ahead of the unconfirmed-swap revert (radio on -> run; off -> `radio_off`).

### Unconfirmed swap and interrupted recheck on LOCKED exit

Entering LOCKED during a Tier 3 cooldown abandons it before `finalize_sim_failover`. On LOCKED **exit** (not entry: the lock holder owns the modem until then) an unconfirmed swap (`sim_failover_active != true`, slot moved from the original) is reverted with `sim_failover_fallback` and held as a revert settle. Entering LOCKED during a primary-recheck settle records `recheck_interrupted`; on exit, if the modem is still on the original slot with the failover active, the settle is re-armed so `finish_cooldown`'s recheck arm decides from a fresh read.

### Auto-failback: blind primary recheck

With `failback_enabled=1`, `sim_failover_active`, state `monitor`, no recheck settle running and no pending revert flag, `wd_failback_due` compares `mono_now` with `last_recheck_time + failback_every_min * 60` (monotonic so a boot-time clock step cannot make a recheck due at once; see [scheduled-jobs.md](scheduled-jobs.md)). When due, `initiate_primary_recheck`: records `recheck_return_slot`, `wd_swap_slot` to the primary (rc 1/3 -> stay on backup, restart the clock, count a failed try, no settle), then a step wait with the 90 s floor and `primary_recheck_active=true`. `recovery_reason` is left alone so the test uses the quality criterion iff the failover was quality-driven. `primary_recheck_active` is the in-memory name; the setting and the UI call it failback (`failback_enabled`, `failback_every_min`, `failback_active`).

**Give-up after 3 failed tries.** Every try that ends on the backup slot (the primary was still unhealthy, or a swap was not verified) calls `_wd_failback_fail`: `failback_failures` goes up, and the third consecutive failure (`WD_FAILBACK_MAX_FAILS=3`) logs one `sim_failback_giveup` event ("primary SIM rechecks stopped after 3 failed tries") and stops the tries. A try that fails back (`_wd_sim_failback`) resets the count to 0. The count is in memory only: a restart starts at 0, and nothing is written to flash. **Why:** every try is a real outage on a slot that cannot be probed passively; a primary that stays dead would otherwise cost an outage every interval forever.

Ways out of the give-up:

| Trigger | Effect |
|---|---|
| Settings reload (any save) | `wd_failback_reload` clears the give-up and re-arms the clock: the next try is one full `failback_every_min` later |
| `POST action=retry_failback` | The CGI raises `/tmp/qmanager_watchcat_retry_failback`; `wd_failback_retry_tick` (every pass) accepts a root-owned flag only, sets `failback_failures` to 0 and `failback_retry_at` to now, so a try is due at the next idle pass. Ignored (flag removed) when no failover is active or failback is off |
| Daemon restart | Starts at 0 |

`status.json.watchcat.failback_next_at` and the state file's `failback_next_at` are the **mono** second of the next try (`wd_failback_next_at`): `last_recheck_time + failback_every_min * 60`, or the accept time of a pending retry. It is `null` when failback is off, no failover is active, or the daemon has given up. The UI interpolates it against `watchcat.mono`.

`wd_sim_finish_recheck` (called first by `finish_cooldown`) decides from a fresh read: ping reachable (and, for a quality failover, `read_quality` not breaching; stale data = unhealthy). **Healthy** -> `_wd_sim_failback`, the shared failback body: clear the record, learn the ICCID, `auto_apply_profile "$iccid" "watchdog_failback"`, restart tower failover, append the event, reset the original slot, counters and recheck clock, return to `monitor`. **Unhealthy** -> `wd_swap_slot` back to the backup (rc 0/2 recorded; otherwise the live slot is read and, if still on the primary, it is a failback with the benign settle), rewrite the record, stop tower failover, restart the interval clock and run a benign settle.

`primary_recheck_active` and `revert_settle_active` are shell variables only; the state file reports the first as `failback_active`, and the UI otherwise sees a plain `cooldown` countdown.

**Why opt-in and minutes-only:** every recheck is a real outage on a slot that cannot be probed passively; a seconds cadence would loop the modem in and out of outages.


---

## UCI configuration schema

### `quecmanager.watchcat` (logical section `watchdog`)

Section name `watchcat`, type `watchcat`. Every key is optional; an absent or out-of-range value reads as the default. The daemon (`read_config`), the CGI GET (`wd_stored_int`, `wd_stored_bool`) and the Config Backup restore apply the same ranges.

| Key | Type | Range / values | Default | Notes |
|---|---|---|---|---|
| `enabled` | bool | `1`/`0` | `0` | Master switch; drives the init-script enable and the daemon's enable gate |
| `act_after_sec` | int, s | 15-600 | 30 | Outage age before recovery starts (effective: `max(act_after_sec, fail_secs)`) |
| `step_wait_sec` | int, s | 10-300 | 60 | Wait after each tier (effective: raised by `recover_secs + 20` and the settle floors) |
| `tier1_enabled` | bool | `1`/`0` | `1` | Network re-registration |
| `tier2_enabled` | bool | `1`/`0` | `1` | Radio toggle |
| `tier3_enabled` | bool | `1`/`0` | `0` | SIM failover; needs `backup_sim_slot` |
| `tier4_enabled` | bool | `1`/`0` | `1` | Reboot |
| `backup_sim_slot` | int | `1`, `2`; absent = none | absent | The CGI deletes the key to clear it |
| `max_reboots_per_hour` | int | 1-10 | 3 | Tier 4 budget |
| `quality_enabled` | bool | `1`/`0` | `0` | Quality trigger |
| `quality_after_sec` | int, s | 30-1800 | 120 | How long a breach must last |
| `carrier_enabled` | bool | `1`/`0` | `0` | Carrier trigger (Amendment 3) |
| `carrier_after_min` | int, **minutes** | 5-240 | 15 | How long a single-carrier run must last |
| `ssr_aware` | bool | `1`/`0` | `1` | SSR hold |
| `ssr_grace_sec` | int, s | 10-120 | 45 | SSR hold length |
| `failback_enabled` | bool | `1`/`0` | `0` | Auto-failback to the primary SIM |
| `failback_every_min` | int, **minutes** | 5-1440 | 30 | Failback try cadence |

Stored booleans accept **exactly** `1` and `0`. The CGI reads any other stored text (`true`, `yes`, `2`) as the default, and the daemon treats only `1` as on (`carrier_enabled` is normalised to `0`/`1`). The CGI writes `1`/`0`.

**Removed from the schema:** `fail_threshold` / `max_failures` (probe counts), `check_interval`, `quality_consecutive`, `cooldown`, `latency_ceiling_ms`, `loss_ceiling_pct`, `primary_recheck_enabled`, `primary_recheck_interval`, `ssr_grace`. The daemon and CGI no longer read them; the CGI rejects them as `unknown setting`. They may still sit in a migrated config (see below), where the platform adapter keeps routing them.

> ℹ️ NOTE: The loop pass (`CFG_CHECK_INTERVAL`, 10 s) is an internal constant with no config key.

### Shared keys (Connection Quality)

The Watchdog reads the Connection Quality settings and writes none of them: `ping_profile.sensitivity` and `ping_profile.targets` (probe cadence and targets), and `quality_thresholds.latency_preset`, `latency_custom_ms`, `loss_preset`, `loss_custom_pct` (limits). Details: [connection-quality.md](connection-quality.md#quality-thresholds). A section that is **absent** means "default" (tolerant/tolerant, 250 ms / 30 %); `quality_thresholds` is deliberately never seeded.

---

## Migration from the old keys

`scripts/usr/lib/qmanager/cqwd_migrate.sh` (RM551E only; the RM520N has its own installer migration) is sourced, guarded, by `install.sh` `seed_uci_defaults` and by the Config Backup restore (`config_backup_sections.sh`), so the install and restore formulas cannot drift. `seed_uci_defaults` runs for the tarball install, OTA and the ipk `--configure` path, all after the library directory is copied; if `cqwd_migrate.sh` is missing the installer warns and migrates nothing. `tools/cq-wd-migrate/run.sh` tests it.

**Rules.** Every new key is written only while it is absent (idempotent; a rerun changes nothing, and a stored value always wins). Old keys stay for a rollback, with three exceptions: `ping_profile.interval_override` is dropped, `watchcat.max_failures` is renamed by an earlier step to `fail_threshold`, and the two watchcat ceilings move into the shared custom limits. A fresh install has no old keys, so it seeds the new keys only (`enabled=0`, `tier1_enabled=1`, `tier2_enabled=1`, `tier3_enabled=0`, `tier4_enabled=1`, `max_reboots_per_hour=3`, `quality_enabled=0`, `ssr_aware=1`, `carrier_enabled=0`, `carrier_after_min=15`, then the derived keys at their defaults).

| Old | New | Rule |
|---|---|---|
| `fail_threshold` (or older `max_failures`) | `act_after_sec` | `clamp(fail_threshold x max(interval, 5), 15, 600)`. `interval` is the probe interval the old daemon ran: the profile's own (`sensitive` 1, `regular` 2, `relaxed` 5, `quiet` 10 s, an unknown profile = `relaxed`) or a valid `interval_override` (1-60). The interval is floored at 5 s because a 1-2 s probe is a probe-rate figure, not a delay anyone chose. Example: `fail_threshold=5` on `quiet` -> `5 x 10 = 50`. Not a number or absent -> 30. |
| `quality_consecutive` x `check_interval` | `quality_after_sec` | `clamp(quality_consecutive x check_interval, 30, 1800)`; `check_interval` missing, zero or non-numeric = 10. Not a number or absent -> 120. |
| `cooldown` | `step_wait_sec` | Clamped to 10-300; not a number or absent -> 60 |
| `ssr_grace` | `ssr_grace_sec` | Clamped to 10-120; absent -> 45 |
| `primary_recheck_interval` | `failback_every_min` | Clamped to 5-1440; absent -> 30 |
| `primary_recheck_enabled` | `failback_enabled` | `0`/`1`/`false`/`true`; otherwise 0 |
| `ping_profile.profile` | `ping_profile.sensitivity` | Same four names; see [connection-quality.md](connection-quality.md#migration-from-the-old-keys) |
| `ping_profile.target_ipv4`, `target_ipv6` | `ping_profile.targets` | Four-slot list; see the same page |
| `ping_profile.interval_override` | dropped | Deleted **after** `act_after_sec` has used it. The saved sensitivity stays. |
| `latency_ceiling_ms`, `loss_ceiling_pct` | `quality_thresholds` `custom` preset | The Watchdog-side values win (device defaults 800 ms / 20 %); runs only while a ceiling key exists, then deletes both |

**Why the interval decision:** the old `fail_threshold` multiplied the probe interval, so the delay the user actually lived with was `fail_threshold x interval`, including an `interval_override`. The conversion carries that wall-clock delay over. Once cadence belongs to Sensitivity alone, dropping the override changes the probe rate but not the time before recovery starts.

When anything changed, `seed_uci_defaults` touches the ping, quality and watchcat reload flags so running daemons re-read without a restart. A rollback to the previous release re-reads the old keys, which are still there, so reinstalling the previous release restores the pre-upgrade values (except the dropped override, and the ceilings, which are then the shared custom limits).

> ⚠️ WARNING: A Config Backup that contains Connection Quality is refused by older releases with `unknown_section`. See [config-backup-restore.md](config-backup-restore.md).

---

## CGI envelope

`GET/POST /cgi-bin/quecmanager/monitoring/watchdog.sh` (`scripts/www/cgi-bin/quecmanager/monitoring/watchdog.sh`). Contract: `docs/plans/2026-11-07-cq-watchdog-contracts.md` §5.3-5.4. Reboots never happen here; the daemon owns every action.

### GET

Never writes config. Response:

```json
{
  "success": true,
  "settings": {
    "enabled": true, "act_after_sec": 30, "step_wait_sec": 60,
    "tier1_enabled": true, "tier2_enabled": true, "tier3_enabled": false, "tier4_enabled": true,
    "backup_sim_slot": null, "max_reboots_per_hour": 3,
    "quality_enabled": false, "quality_after_sec": 120,
    "carrier_enabled": false, "carrier_after_min": 15,
    "ssr_aware": true, "ssr_grace_sec": 45,
    "failback_enabled": false, "failback_every_min": 30
  },
  "effective": {
    "act_after_sec": 40, "step_wait_sec": 60,
    "quality_limits": {"latency_ms": 250, "loss_pct": 30},
    "carrier_enabled": false, "carrier_after_min": 15
  },
  "status": { "...": "the state file, or {} when absent or unparsable" },
  "sim_failover": {"active": false},
  "recent_reboots": [1718900000],
  "sim_dual_capable": true,
  "auto_disabled": false
}
```

- `settings` holds the stored values with the daemon's own clamping and defaults applied; a corrupt stored value cannot make the page crash.
- `effective` is what the daemon will actually use: `act_after_sec = max(stored, fail_secs of the stored Sensitivity)`, `step_wait_sec = max(stored, recover_secs + 20)`, and the shared limits with the watchdog floors (`max(latency, 50)`, `max(loss, 10)`). The Sensitivity cadence comes from `conn_state_cadence`.
- `recent_reboots` is `wd_ledger_recent_json 5` (Tier-4 epochs, newest first; `[]` when the ledger library is unavailable).
- `auto_disabled` is `true` only while `/tmp/qmanager_watchcat_disabled` exists. The daemon never creates it; the flag can only survive from a pre-upgrade auto-disable, and enabling the watchdog removes it.
- A missing platform library answers `{"success":false,"error":"internal_error","detail":"platform library unavailable"}`.

### POST

`Content-Type: application/json`, body at most **8192 bytes**. Larger or non-numeric `CONTENT_LENGTH` answers `payload_too_large` before the body is read. The body must be a JSON object with a string `action`.

| Action | Fields | Effect |
|---|---|---|
| `save_settings` | any subset of the 17 settings keys, **top level** next to `action` | Validate every key, then stage and commit once. Raises the watchcat reload flag; raises the poller reload flag when `carrier_enabled` is in the request. `enabled: true` removes the auto-disable flag, enables the service and starts it if it is not running; `enabled: false` stops and disables it |
| `revert_sim` | none | Writes the root-owned flag the daemon consumes (deferred while busy) |
| `retry_failback` | none | Writes `/tmp/qmanager_watchcat_retry_failback`; ok even when nothing can be retried (the daemon removes the flag) |
| `dismiss_sim_swap` | none | Marks the SIM-swap banner dismissed (`/tmp/qmanager_sim_swap_detected`, RM551E only) |

`save_settings` validation (the first failing key in request order is reported; **nothing is staged on a failure**):

- Booleans must be JSON `true`/`false` (strings and numbers are `invalid_field`).
- Integers must be JSON integers inside the range above (strings such as `"30"` and fractional numbers are `invalid_field`); the stored text has leading zeros stripped.
- `backup_sim_slot`: `1`, `2` or `null` (clears the key).
- Cross-field: `tier3_enabled: true` needs a backup slot (stored or in the same request), and clearing the slot while Tier 3 is on is rejected.
- Any other key, including the removed ones, is `invalid_field` with detail `unknown setting`.
- `jq` flattens the body into `@tsv` rows first, so a hostile key containing a tab or newline cannot add a row.

| `error` | When |
|---|---|
| `invalid_field` | with `field` and `detail` |
| `payload_too_large` | body over 8192 bytes |
| `invalid_json` | the body is not a JSON object |
| `missing_action` / `unknown_action` | |
| `method_not_allowed` | not GET or POST |
| `no_body` | POST without a body |
| `save_failed` | a `cfg_set`/`cfg_commit` failed; the staged changes are reverted |
| `internal_error` | platform library missing |

---

## Apply / reload (no restart on save)

```
POST save_settings
  validate all -> stage -> commit once
  touch /tmp/qmanager_watchcat_reload
  carrier_enabled in the request? -> touch /tmp/qmanager_poller_reload
  enabled=true:
      rm -f /tmp/qmanager_watchcat_disabled
      service enable
      daemon running?  yes -> nothing (it reloads from the flag)
                       no  -> start it (backgrounded)
  enabled=false:
      service stop ; disable
```

The running daemon checks the reload flag at the top of each pass (after `wd_ledger_tick`), removes it, logs "Config reload requested", calls `read_config`, then `wd_holdoff_reload`, `wd_carrier_reload` and `wd_failback_reload`. If the reload shows `enabled != 1` it writes `state="disabled"`, retires the service and exits. Changes take effect within one pass (10 s).

**Why no restart:** a restart drops the in-flight cooldown, the Tier 3 SIM state, the hold-offs and the recovery counters mid-recovery. The same rule applies to the config-restore watchdog section (start only when down).

> ⚠️ WARNING: `save_thresholds` in the Connection Quality CGI touches **two** reload flags: `/tmp/qmanager_quality_reload` (the poller owns its deletion) and `/tmp/qmanager_watchcat_reload`. The Watchdog reads the shared limits at reload, so omitting the second flag leaves it on stale limits. See [connection-quality.md](connection-quality.md#apply--reload-pipeline).

---

## Recovery-lifecycle network events

The Watchdog appends to the RAM event ring (`/tmp/qmanager_events.json`, max 50, lost on reboot) with the types `watchcat_recovery` and `sim_failover`, and a stable machine `code` per row. The UI keys its Recovery Activity rows on `code` (rows without a code, from before the upgrade, fall back to English-text matching).

| Code | Type | Severity | When |
|---|---|---|---|
| `wd_tier_start` | `watchcat_recovery` | warning | A tier starts (Tier 1 "re-registering on network", Tier 2 "toggling radio"); the recovery marker "starting recovery (Tier N) - internet unreachable / connection quality degraded / stuck on one carrier for N min"; the quality breach message with latency and loss |
| `wd_escalate` | `watchcat_recovery` | warning | "recovery escalating to Tier N - previous tier did not restore the connection" |
| `wd_succeeded` | `watchcat_recovery` | info | "recovery succeeded (Tier N)" with "internet connectivity restored", "connection quality restored" or "carrier aggregation restored" |
| `wd_tier4_reboot` | `watchcat_recovery` | error | "rebooting system (Tier 4)" (wording is an invariant, see above) |
| `wd_holdoff` | `watchcat_recovery` | error | "all recovery steps tried, pausing N minutes" |
| `wd_budget_spent` | `watchcat_recovery` | warning | "reboot limit reached (N per hour), reboots paused" or "reboots paused until the connection comes back (long outage)" |
| `wd_ssr_hold` | `watchcat_recovery` | info | "recoverable baseband restart detected - holding recovery to let the modem self-heal" |
| `wd_radio_paused` | `watchcat_recovery` | info | "radio is off, recovery paused until it is turned back on" |
| `wd_ping_stale` | `watchcat_recovery` | warning | "connection probe not reporting, restarting it" |
| `sim_swap` | `sim_failover` | warning/info/error | Tier 3 swap started, confirmed, or not verified |
| `sim_revert` | `sim_failover` | warning/info/error | Backup SIM failed and reverted, user revert, revert not verified |
| `sim_failback` | `sim_failover` | info/error | Primary recheck started, primary healthy again, still unhealthy, swap or return not verified |
| `sim_failback_giveup` | `sim_failover` | warning | "primary SIM rechecks stopped after 3 failed tries" |

Events carry `{timestamp, type, message, severity, code}`. The reason that triggered a ladder is part of the message text.

---

## Frontend files

Rebuilt 2026-11-08 on the unified `monitoring/watchdog.sh` (contracts §3, §5.3-5.4, §6, §9 B/C, §13; Amendment 3 A3.2/A3.3). Order: page header with a Refresh pill, the SIM-failover banner (only while on the backup SIM), the status card, Recovery Ladder beside Detection, Recovery Activity. Every editable card commits its own keys from its own `CardFoot`.

| File | Purpose |
|---|---|
| `hooks/use-watchdog-settings.ts` | `useWatchdogSettings(): UseWatchdogReturn` (`types/cq-watchdog.ts`). GET every 5 s while visible (the hero needs `offline_secs`, `tiers_tried`, `last_success_*`, `carrier_*`, which are not in `status.json`); `status: {}` reads as null; `settings` keeps identity across polls; `receivedAt` lets mono deadlines count down between polls. `saveSettings(patch)` POSTs the keys at the TOP level (`{"action":"save_settings","act_after_sec":45,…}`, fixture `save_settings_subset_ok`), plus `revertSim`, `retryFailback`; all return `CqWdMutationResult`. |
| `hooks/use-connection-quality.ts` | Read by Detection for "Down after about N s (Sensitivity)" and the raw latency/loss limits behind the floor clamp. |
| `hooks/use-modem-status.ts` | Poller snapshot for the probe strip (`connectivity.latency_history`) and the SIM-swap banner. |
| `hooks/use-watchdog-indicator.ts` | Sidebar pill for `recovery`; `cooldown` and `holdoff` both report as cooldown. |
| `components/monitoring/watchdog/derive.ts` | Phase model (17 phases, one glyph each, incl. hold-off by reason outage / quality / carrier, ping stale, radio off, SSR hold), hero figures, tier row states (tried / running / resting / not used), timeline from effective values. |
| `components/monitoring/watchdog/status-band.tsx` | Hero: phase disc, title, blurb, four figures (Offline / Poor quality / On one carrier for, Recoveries "Since last restart", Last fix from `last_success_*`, Reboots N of `reboot_limit`), probe strip. |
| `components/monitoring/watchdog/ladder-card.tsx` | "Recover automatically" first row, four tier rows, Tier 3 gated on `sim_dual_capable` with the backup-slot field, failback row with give-up and "Try again now" (`retry_failback`), Tier 4 cap; Tiers 3-4 read "Not used for poor quality / one carrier" while that reason runs. |
| `components/monitoring/watchdog/detection-card.tsx` | Start recovery after (presets + Custom, effective clamp), quality trigger (presets in minutes, Custom in seconds 30-1800, floor clamp caption), carrier trigger (`carrier_enabled`, `carrier_after_min` 5/15/30/60 + Custom, Tier 1 link-drop note, "Right now" carrier count), Advanced (step wait, baseband restart hold), "If the link drops" timeline. No "not available in 5G SA" fact: the gated SA read covers SA. |
| `components/monitoring/watchdog/activity-model.ts`, `recovery-activity-card.tsx` | Rows keyed by event `code` (§6); rows without `code` (pre-upgrade) fall back to English-text matching; reboots de-duplicated against `recent_reboots`. |
| `components/monitoring/watchdog/{use-watchdog-form.ts,watchdog-foot.tsx,fields.tsx,disclosure.tsx,use-clock.ts,shapes.ts}` | Scoped drafts per card, the card foot, shared field/disclosure primitives, a shared 1 s clock, geometry (skeletons import the same constants). |
| `components/monitoring/watchdog/banners.tsx`, `sim-swap-banner.tsx` | Failover banner with the Revert dialog; SIM swap toast. |

`monitoring:watchdog.*` lives in all five locale packs.


---

## Test tools

All dev-only, never installed (`install.sh` does not copy `tools/`). The BusyBox gates run under WSL (Ubuntu, BusyBox v1.36.1) with `jq` on `PATH` or `JQ=/path/to/jq`. **Why WSL and not the modem:** the daemon calls absolute paths (`/etc/init.d/qmanager_tower_failover`, `profile_mgr.sh`, `reboot`) that must never fire on a live unit; in the sandbox they are rewritten or stubbed and logged.

| Tool | What it proves | Run |
|---|---|---|
| `tools/watchdog-harness/` (165 scenarios) | The daemon and its libraries against a fake clock and a scripted scenario tape: startup, tiers, the three triggers, hold-offs, SSR, LOCKED, the reboot budget and guard, TERM cleanup, SIM swap, resume, failback. Two runs of identical behaviour are byte-identical, so `compare` against `baseline/` is the regression gate. | `busybox sh "$H/run.sh" run -o /tmp/wd-new`, then `busybox sh "$H/run.sh" compare "$H/baseline" /tmp/wd-new` (`list` shows names; pass a scenario name to run one; `WDH_KEEP=1` keeps the work dirs) |
| `tools/cq-wd-contract/` (51 CQ + 69 Watchdog fixtures) | Both CGIs against the frozen contract: shapes, `equals`, and behaviour checks the fixtures cannot express (what a save wrote, which flags it raised, that a GET writes nothing). | `sh tools/cq-wd-contract/run.sh [-b BUSYBOX] [-j JQ] [-k] [FILTER]` |
| `tools/cq-wd-migrate/run.sh` | `cqwd_migrate.sh` and the Config Backup translate/apply, with a file-backed `uci` stub. | `busybox sh tools/cq-wd-migrate/run.sh` |
| `tools/cq-wd-parity/` | `check.sh` keeps the 11 neutral files byte-identical to `manifest.sha256` (`--update` after an intentional change, then mirror it in the other repo); `adapter_cc_check.sh` unit-checks `plat_cc_count`; `poller_thresholds.sh` pins the poller's custom-limit ranges. | `sh tools/cq-wd-parity/check.sh` |
| `tools/poller-parity/` | The poller's composers, including the `watchcat` block in both. Required for any poller composer or `parse_at.sh` edit. | See its README |

The harness runs the daemon from a staged copy with a `sed` rewrite of the absolute device paths; the repo files are never modified. `sleep` is the clock: the boot settle arms pass 1 and each end-of-pass sleep snapshots the state and arms the next. Per scenario it records `at.log` (every AT command with fake time), `calls.log`, `passes.txt` (state file, file list and failover record after every pass), `tree.txt`, `console.log` and `exit.code`; PIDs are masked. Scenarios live in `scenarios/NN_name.sh` and may define `SC_PASSES`, `sc_setup`, `sc_pass_N` and `sc_qcmd`. After an **intentional** behaviour change, review every DIFFERS, re-record the baseline (`run.sh run -o tools/watchdog-harness/baseline`) and explain the differences in the harness README.

Static gates that go with it: `sh -n` on every file, `.claude/check-crlf.sh`, a bashism grep (`[[`, `==`, `local a b`, arrays, `echo -e`), a jq-regex grep (`test(`, `match(`, `sub(`, `gsub(`), numeric guards before arithmetic, and no `AT+CFUN=1,1`.

---

## Known gotchas

- **`jq --argjson` parses `"true"`/`"false"` into JSON booleans; do not compare them with `== "true"`.** `sim_failover_active` is written with `--arg` and compared `($sf_active == "true")`. Use `--arg` to string-compare, `--argjson` to emit a parsed value.
- **Float comparison needs awk.** The quality average is decimal; BusyBox `[ "1241.4" -gt 800 ]` exits 2. See `quality_breached`.
- **Leading-zero octal.** `[ "08" -gt 5 ]` fails on BusyBox. Every config read strips leading zeros before arithmetic; new reads must too.
- **The trigger is seconds, not probes.** `act_after_sec` is a delay: at every Sensitivity, 50 means about 50 s from the outage start, floored by the probe's own `fail_secs`.
- **Wall-clock staleness is corrupted by NITZ/NTP steps.** After an SSR the clock steps about 90 s forward. Every age check uses `mono_now()` (`/proc/uptime`) and the additive `mono` fields in `qmanager_ping.json`, `status.json` and the watchdog state file; wall-clock fallbacks run only when `.mono` is absent or zero, and a `.mono` ahead of uptime counts as stale.
- **A stale ping cache is no-signal, not healthy.** The pass is skipped and the previous values are kept. After 300 s the dead prober is flagged and restarted ([Dead prober](#dead-prober-ping_stale)).
- **The 1970 clock.** With no RTC the modem boots at 1970 until NITZ/ntp steps the clock. The ledger count uses the 2025 rule; the UI ignores epochs at or below 1_600_000_000; the events ring and `crash.log` can hold 1970-era rows that sort before real ones.
- **SSR hold is best-effort.** The kernel ring buffer can evict the crash line (a busy QCMAP bring-up fills it); then the hold never engages and the ladder runs.
- **BusyBox awk rejects bracket-class `-F` separators** (`awk -F'[][. ]+'` errors with `Unknown collating element`, to stderr, so the feature silently goes inert). `plat_ssr_poll` uses `sed`. dmesg lines on this kernel are double-bracketed (`[ secs.usec][ Tthread]`); anchor on the first bracket only.
- **Device `jq` has no regex.** `test()`, `match()`, `sub()`, `gsub()` fail at runtime, silently under `2>/dev/null`. Use `case`, `awk` or `sed`.
- **`jq // empty` drops `false`.** Use `if . == null then ... else tostring end`.
- **CRLF in a daemon, library or CGI breaks it silently** (a CGI produces zero output). Run `.claude/check-crlf.sh`.
- **`qcmd` modem `ERROR` is rc 0.** Judge `"$rc:$result"`; a transport failure is non-zero with empty stdout.
- **A dot-source of a missing file kills the script.** Every `.` is behind `[ -f ... ] &&`, in the daemon, the CGIs and `cqwd_migrate.sh`.
- **Libraries are not executable scripts.** Do not add top-level commands or `.` lines to a `wd_*.sh`; the loader's `..._LOADED` check and the CGI's guarded `wd_ledger.sh` source depend on it.
- **Neutral files change in both repos.** Edit, run `tools/cq-wd-parity/check.sh --update`, mirror the change; never fix one repo only.
- **A quality- or carrier-triggered SSR hold clears through the reachability arm** (the link is reachable again); a `suspect -> monitor` log line instead of `ssr_hold -> monitor` is expected.
- **Prometheus is unchanged.** `qmanager_watchdog_enabled`, `qmanager_watchdog_failure_count` and `qmanager_watchdog_recoveries` keep their names and meaning (`failure_count` is the raw probe streak mirror).

---

## Known deferred

Real findings from the 2026-10-21 audits (`docs/plans/watchdog-audit/01-core.md`, `02-sim.md`, `03-surface.md`) that were not fixed. Nothing here is a regression. Findings the unified design closed (UCI range clamping in the daemon, CGI boolean validation, auto-disable, the dead-prober blind spot) are not listed.

| Item | Why deferred |
|---|---|
| WD-07: `crash.log` append is unchecked (and the 20-row trim) | Needs a read-only or full `/etc`; rare. Next candidate: a 3-line follow-up in `wd_ledger.sh`/`execute_tier4`. |
| WD-10 / F-06: the SIM-switch flag is ignored by `check_locked`; no manual slot reconcile | Needs a user SIM switch during an outage. `wd_swap_slot`'s already-on-target return covers the revert case. Next candidate. |
| F-03: in-flight breadcrumb | The TERM cleanup restores `CFUN=1` and saves no longer restart the daemon; the remaining window is a SIGKILL during Tier 3 (`install.sh` does `killall -9`). |
| F-07: settle-floor gaps; F-08: single 90 s verdict | Design work; partly eased by the quality window. |
| F-10: `recovery_reason` overwritten | Only affects auto-failback after a quality failover. |
| F-14: tower-failover restart paths; tower lock vs Tier 3 | Partly unproven. |
| F-17: negative cache; two-way Tier 3; backup-slot edit during a failover | Design. |
| WD-14: frozen cooldown countdown; WD-15: stale tier after SSR | Cosmetic. |
| WD-18: Tier 1 overrides a manual operator | Unproven. |
| WD-21: PID guard trusts `kill -0` | Less relevant now that TERM exits cleanly. |
| WD-22: events ring unlocked | Rare; poller hot path. |
| F12: revert toast and no-op success; F15: Prometheus liveness; F16: GET writes; F18: timeline | Low. |
| Follow-ups: shared verify lib with `cellular/settings.sh`; dedupe the `alerts.sh` awk against `wd_ledger_recent_json`; "Test backup SIM" dry run; `unplanned` rows in the watchdog card | Not started. |

---

## Untested live

Hardware limits, not code gaps: the RM551E test unit has no working second SIM. Everything below is covered by harness scenarios (`05`, `11`, `13`-`15`, `44`-`46`, `58`-`68`) but has **not** been exercised on hardware:

- **A successful Tier 3 failover and the reboot resume.** A verified swap to a working backup SIM, `finalize_sim_failover`, the two-copy record, and the record resuming after a real reboot (flash copy -> /tmp) with a matching live slot. A failed swap (empty backup slot) is the only live path available.
- **Quality-triggered Tier 3 finalization** is no longer reachable by design (a quality ladder stops at Tier 2); a failover record with `reason: "quality_degradation"` can exist only from an older release.
- **The auto-failback full loop** (`failback_enabled=1`, `failback_every_min=5`): the blind swap-back, a healthy primary failing back, an unhealthy primary returning to the backup with the record rewritten, and the give-up after 3 failed tries.
- A real MPSS SSR with `ssr_aware` on a slow Sensitivity (the harness feeds a dmesg fixture; the hold engaging on the real kernel line is verified only to the extent of earlier on-device checks).

Results of the live runs that were possible are in [`docs/plans/watchdog-audit/04-live-validation.md`](../plans/watchdog-audit/04-live-validation.md) (heartbeat, stop timing, no-restart save, radio-off, real Tier 4 and ledger decay). Plans and rationale: [`docs/plans/2026-11-07-cq-watchdog-unified-architecture.md`](../plans/2026-11-07-cq-watchdog-unified-architecture.md) and the earlier [`docs/plans/2026-10-21-watchdog-modular-lean-plan.md`](../plans/2026-10-21-watchdog-modular-lean-plan.md). The superseded May plan [`docs/2026-05-12-watchdog-sim-failover-audit-fixes.md`](../2026-05-12-watchdog-sim-failover-audit-fixes.md) is historical.
