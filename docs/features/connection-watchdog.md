# Connection Watchdog (`qmanager_watchcat`)

> ℹ️ NOTE: **Branch `feat/cq-watchdog-unify` (not released): the R9 items, the settings migration and the CGIs are pending.** This document describes the daemon as built on that branch for rules R1-R6 (seconds trigger, per-reason hold-offs, reboot budget, quality cap, step wait, dead prober). The released v0.1.x behaviour (probe-count `fail_threshold`, one shared hold-off, auto-disable on the reboot cap, quality ladder up to Tier 4) is replaced, not kept as an option. The daemon reads only the new UCI keys (`act_after_sec`, `ssr_grace_sec`, `step_wait_sec`, `quality_after_sec`, `max_reboots_per_hour`); the CGI and UI still write the old keys (`fail_threshold`, `cooldown`, `quality_consecutive`, `ssr_grace`), so **saved settings are ignored on this branch until Step 2 (migration) and Step 3 (CGIs, poller) land**. Nothing from this branch is deployed. Design and contracts: [`docs/plans/2026-11-07-cq-watchdog-unified-architecture.md`](../plans/2026-11-07-cq-watchdog-unified-architecture.md), [`docs/plans/2026-11-07-cq-watchdog-contracts.md`](../plans/2026-11-07-cq-watchdog-contracts.md) (including Amendments 1 and 2); progress: [`docs/plans/2026-11-07-cq-watchdog-1b-plan.md`](../plans/2026-11-07-cq-watchdog-1b-plan.md). The CGI sections below still describe the released CGI.

`qmanager_watchcat` is QManager's connection health daemon. It watches internet reachability (and, opt-in, link quality) through the ping daemon's output and, when the connection fails or degrades, runs a tiered recovery ladder: network re-registration, radio toggle, SIM failover, system reboot. It is opt-in (`enabled=0` on a fresh install). The daemon is a thin main script plus seven sourced `wd_*.sh` libraries and a platform adapter (`qm_platform_cqwd.sh`), it publishes a heartbeat so the UI can tell when it has stopped, and it keeps its reboot count and SIM-failover record honest across restarts and reboots. It never disables itself: a spent reboot budget only rests Tier 4.

---

## Quick Reference

| Item | Value |
|---|---|
| Daemon | `scripts/usr/bin/qmanager_watchcat` -> `/usr/bin/qmanager_watchcat` (main loop, loader, exit cleanup) |
| Libraries | `scripts/usr/lib/qmanager/wd_{config,state,detect,quality,ledger,tiers,sim}.sh` and the adapter `qm_platform_cqwd.sh` -> `/usr/lib/qmanager/` (see [Module layout](#module-layout)) |
| Init script | `scripts/etc/init.d/qmanager_watchcat` (procd, `respawn 3600 5 5`, `term_timeout 15`) |
| CGI endpoint | `GET/POST /cgi-bin/quecmanager/monitoring/watchdog.sh` |
| UCI section | `quecmanager.watchcat` (plus the shared `quecmanager.quality_thresholds`, `quecmanager.ping_profile`); read through the adapter's `cfg_get watchdog <key>` |
| State file (heartbeat) | `/tmp/qmanager_watchcat.json`, rewritten every pass; removed on exit |
| PID file | `/tmp/qmanager_watchcat.pid` |
| Reachability input | `/tmp/qmanager_ping.json` `.reachable` (debounced verdict), `.fail_elapsed_sec`, `.fail_secs`, `.recover_secs`, `.streak_fail`, read through `conn_state_read` ([connection-quality.md](connection-quality.md#shared-ping-cache-reader-conn_statesh)); `/tmp/qmanager_ping_attaching` (ping attach warm-up flag) |
| Quality input | `/tmp/qmanager_ping_history` (`<rtt ms or null> <leg>` per line, newest last, read as `$1`; written by `qmanager_ping`). Sample spacing is `wd_probe_period`: the larger of `interval_sec` and the cache's rounded `cycle_ms` |
| Quality thresholds | `quecmanager.quality_thresholds.*` (shared with Connection Quality Network Events), raised to the watchdog floors 50 ms / 10 % |
| Recovery active flag | `/tmp/qmanager_recovery_active` |
| Maintenance lock | `/tmp/qmanager_watchcat.lock` (also `/tmp/qmanager_long_running` and a live `/tmp/qmanager_profile_apply.pid`) |
| Config reload flag | `/tmp/qmanager_watchcat_reload` |
| Ping reload flag | `/tmp/qmanager_ping_reload` (touched by a save that changes the probe interval) |
| SIM revert flag | `/tmp/qmanager_watchcat_revert_sim` (written by CGI `revert_sim`; consumed by `check_revert_request`) |
| SIM-switch flag | `/tmp/qmanager_sim_switch_active` (held by `wd_swap_slot`; the poller pauses AT traffic while it exists) |
| Auto-disabled flag | `/tmp/qmanager_watchcat_disabled`: **no longer created by the daemon** (it never auto-disables); only the CGI's `auto_disabled` read, the config-restore clear and the uninstaller still touch it |
| SIM failover record | two copies: `/tmp/qmanager_sim_failover` and `/etc/qmanager/sim_failover.json` |
| Reboot ledger | `/etc/qmanager/crash.log`, rows `<epoch>\|reboot\|<reason>`; watchdog writes `tier4_escalation`, shared with [Alerts](alerts.md#reboot-alerts) |
| Long-run guard files | `/etc/qmanager/wd_reboot_guard` (`<engage epoch>`) and `/etc/qmanager/wd_link_up` (`<epoch>`), flash, written **only on their edges** (see [Reboot budget](#reboot-budget-and-the-long-run-guard)); `$PF_STATE_DIR` in the adapter |
| Constants | `BOOT_SETTLE=30`, `MODEM_WAIT_TIMEOUT=60`, `SIM_SETTLE_SECS=90`, `HOLDOFF_OUTAGE_SECS=900`, `HOLDOFF_QUALITY_SECS_0/1/2=900/1800/3600`, `HOLDOFF_QUALITY_RESET_SECS=3600`, `QUALITY_LATENCY_FLOOR_MS=50`, `QUALITY_LOSS_FLOOR_PCT=10` (all in `wd_config.sh`, none is a UCI key); `WD_GUARD_SECS=86400` in `wd_ledger.sh` |
| Reboot? | Tier 4 only: state written, then `( sleep 1; sync; reboot ) &` and `exit 0` |
| Frontend hook | `hooks/use-watchdog-settings.ts` |
| Frontend cards | `components/monitoring/watchdog/` (see [Frontend files](#frontend-files)) |
| Dev harness | `tools/watchdog-harness/` (see [Test harness](#test-harness)) |

---

## Module layout

The daemon was one 1715-line script. It is now a main file plus six libraries, split by responsibility without a behaviour change (proved by the harness, see below) and then fixed library by library.

| File | Responsibility | Public functions |
|---|---|---|
| `qmanager_watchcat` (main) | Dependency sourcing, path constants, library loader, `_wd_exit_cleanup`, `main()` (PID guard, traps, startup, the loop and its state edges) | `main`, `_wd_exit_cleanup` |
| `wd_config.sh` | UCI read, `CFG_*` defaults, fixed constants | `read_config`, `resolve_quality_thresholds` |
| `wd_state.sh` | State file writer, maintenance-lock check, interruptible sleep, radio markers | `write_state`, `write_state_busy`, `check_locked`, `wd_sleep`, `wd_mark_radio_down`, `wd_mark_radio_up`, `wd_cfun_now` |
| `wd_detect.sh` | Inputs that start or hold recovery: ping read, quality window, start gate, SSR gate | `read_ping`, `read_quality`, `wd_quality_mark`, `quality_breached`, `evaluate_quality`, `wd_decide_start`, `wd_holdoff_left`, `wd_radio_reconcile`, `wd_start_gate`, `ssr_in_progress`, `ssr_hold_gate`, `ssr_hold_clear` |
| `wd_tiers.sh` | Tiers 1, 2, 4, escalation, hold-off, cooldown verdict | `tower_lock_active`, `wait_for_modem`, `execute_tier1`, `execute_tier2`, `execute_tier4`, `find_next_tier`, `do_recovery`, `_cooldown_handle_failure`, `wd_cooldown_verdict`, `finish_cooldown`, `wd_enter_radio_off`, `wd_holdoff_clear` |
| `wd_sim.sh` | Tier 3, every slot swap, fallback, revert, auto-failback, failover record | `wd_read_slot`, `wd_swap_slot`, `wd_failover_save`, `wd_failover_clear`, `execute_tier3`, `sim_failover_fallback`, `finalize_sim_failover`, `initiate_primary_recheck`, `check_revert_request`, `wd_sim_finish_recheck`, `wd_sim_adopt_live_slot`, `wd_sim_defer_revert`, `wd_sim_on_radio_back`, `wd_sim_resume_at_start`, `wd_sim_resume_retry`, `wd_sim_on_unlock` |
| `wd_ledger.sh` | Reboot count from `crash.log`, reboot history for the CGI | `count_recent_reboots`, `wd_ledger_tick`, `wd_ledger_recent_json` |

### Ownership

Each global is declared and initialised by one library (top level, function definitions and initialisers only). Any library may read any global. Phase-2 code writes a new global only through its owner's function; the cross-library reset writes that predate the split (LOCKED entry and exit, natural recovery, the exhausted paths) are listed in the comment block at the top of `main()`.

| Owner | Globals |
|---|---|
| main | path constants (`STATE_FILE`, `PID_FILE`, `RELOAD_FLAG`, `REVERT_FLAG`, `SIM_FAILOVER_FILE`, `CRASH_LOG`, ...), loop temporaries `_pr_now`, `_pr_due` |
| `wd_config.sh` | every `CFG_*`, `BOOT_SETTLE`, `MODEM_WAIT_TIMEOUT`, `SIM_SETTLE_SECS`, `HOLDOFF_SECS` |
| `wd_state.sh` | `state`, `prev_state`, `failure_counter`, `wd_radio_down`, `_wd_sleep_pid` |
| `wd_detect.sh` | `ping_streak_fail`, `ping_reachable`, `ping_during_recovery`, `q_avg_latency`, `q_packet_loss`, `quality_breach_counter`, `quality_since`, `ssr_hold`, `last_ssr_detected`, `ssr_hold_started` |
| `wd_tiers.sh` | `current_tier`, `last_recovery_time`, `last_recovery_tier`, `total_recoveries`, `cooldown_remaining`, `cooldown_stale_retries`, `recovery_reason`, `_recovery_marker_emitted`, `holdoff_until`, `holdoff_reason` |
| `wd_sim.sh` | `sim_failover_active`, `original_sim_slot`, `original_sim_iccid`, `current_sim_slot`, `revert_settle_active`, `primary_recheck_active`, `recheck_return_slot`, `recheck_interrupted`, `last_recheck_time`, `wd_sim_revert_pending`, `WD_SWAP_NOOP`, `WD_SWAP_FLAG_OWNED`, `WD_ADOPT_SLOT`, `_wd_resume_next` |
| `wd_ledger.sh` | `reboots_this_hour`, `_rb_next` |

### Loader guard

`main` sources its dependencies (`qlog.sh`, `safe_tmp.sh`, `events.sh`, `sim_db.sh`, `schedule_guard.sh`, `conn_state.sh`), defines the path constants, then loads the libraries in the fixed order `wd_config wd_state wd_detect wd_ledger wd_tiers wd_sim`:

- Every `.` is guarded with `[ -f ... ]`. **Why:** BusyBox ash aborts the whole shell when `.` cannot find its file, even inside an `if`.
- Each library ends with `WD_<NAME>_LOADED=1`. The loader checks all six flags equal `111111`, so a truncated library (a partial deploy, a zero-byte file) is caught as well as a missing one.
- On any failure the daemon logs `refusing to start` and `exit 1` **before** the PID file, the traps or any AT command. It never runs half-loaded. procd retries (`respawn 3600 5 5`), every attempt is logged, and from the heartbeat on the Watchdog page shows "Not reporting".
- Libraries must stay definitions and initialisers only: no top-level commands, no sourcing of each other. Load order matters only for initialisers and none reads another library's globals.
- `WATCHCAT_NO_MAIN=1` makes the last line of the script skip `main`, so the harness can source the daemon. `WD_LIB_DIR` overrides the library directory (harness only).

> ⚠️ WARNING: Deploy order on a device is libraries first, then `qmanager_watchcat`, then `sync`, then compare md5 against the repo. A main script without its libraries refuses to start, which is safe but leaves the watchdog off. An unsynced copy followed by a power-off has zeroed core files before.

---

## How It Works

The watchdog has **two ways to decide "the connection is bad", and both pull the same recovery lever.** They are two *triggers* feeding one engine, which is why the settings UI shows them together.

```
   master OFF -> daemon exits at the enable gate; nothing below runs.
   master ON  ->

   TRIGGER A: Reachability (always on)     TRIGGER B: Quality (opt-in)
   ping_streak_fail >= fail_threshold       window of recent RTT/loss breaches
   recovery_reason = "unreachable"          x quality_consecutive passes
                                            recovery_reason = "quality"
                  \                         /
                   v                       v
                 start gate (wd_start_gate):  none | holdoff | radio_off | go
                   v go
                 ssr_hold_gate -> hold, or find_next_tier 1 -> do_recovery
                   v
   THE SHARED LADDER: Tier 1 COPS, Tier 2 CFUN, Tier 3 SIM failover, Tier 4 reboot
                   v
   COOLDOWN (reason-aware verdict) -> restored? back to MONITOR : escalate
                   v ladder exhausted
   15 min hold-off, back to MONITOR
```

**Both triggers share the ladder all the way to the top.** `recovery_reason` never caps the ladder height: a sustained quality breach that Tier 1 and Tier 2 fail to fix escalates to Tier 4 exactly like an outage, provided Tier 4 is enabled (the default). **Why:** a degraded link is often a stuck RF or attach condition that only a radio cycle or reboot clears. The only things that stop a quality breach from rebooting are the Tier 4 enable flag and the `max_reboots_per_hour` token bucket (which auto-disables the daemon when exhausted).

The trigger source changes only the cooldown success test and the hold-off clearing rule:

| Aspect | Reachability (`"unreachable"`) | Quality (`"quality"`) |
|---|---|---|
| Ladder range | Tier 1 to 4 | Tier 1 to 4 (identical) |
| Cooldown success test | fresh ping `reachable = true` | fresh `read_quality` window not breaching the ceilings |
| Tier 3 failover finalization | `finalize_sim_failover` | identical (shared call) |
| Tier 4 token bucket | applies | applies identically |
| Hold-off after an exhausted ladder | cleared as soon as the link is healthy | **not** cleared by a healthy link (see [Hold-off](#hold-off-after-an-exhausted-ladder)) |

### Reachability trigger

The daemon reads the RAW `ping_streak_fail` integer from `qmanager_ping.json`, not the debounced `.reachable` boolean. Recovery starts when the streak reaches `fail_threshold` (`>=`) consecutive failed probes.

**Why raw streak:** the ping daemon already debounces `.reachable`. Counting it again in a watchdog accumulator double-counted one failed probe under slow profiles (the `quiet` profile at 10 s). Reading the streak gives `fail_threshold` one meaning: N consecutive failed probes, independent of the profile interval. `failure_counter` in the state file is only a display mirror of the streak.

**Staleness and unknown state.** `read_ping` is a thin wrapper over `conn_state_read`. The cache is stale when its age exceeds `max(3 * interval_sec, 15)` s on the monotonic clock. A missing, stale or unreadable cache makes `read_ping` return non-zero and the pass is skipped (previous values kept, state file still written). A missing or corrupt `reachable` reads as `"null"` and is never treated as up. If `conn_state.sh` is missing the daemon stubs `conn_state_read` to stale, so it never decides on unknown data. The down rule is still the probe count; an elapsed-time rule (the RM520N fork's `fail_elapsed_sec`) was deliberately not ported (user decision 2026-10-16).

### Quality trigger

Opt-in (`quality_enabled=0`). On every pass in `monitor` or `suspect`, after `read_ping` succeeded, `evaluate_quality` calls `read_quality` and compares the window figures against the shared thresholds. A breach increments `quality_breach_counter`; `quality_consecutive` consecutive breaches start recovery with `recovery_reason="quality"`. A good window resets the counter; "no signal" leaves it unchanged. The counter is separate from the reachability streak.

**Why shared thresholds:** the watchdog used to keep private `latency_ceiling_ms` / `loss_ceiling_pct` keys that could diverge from the Network Events thresholds. One save in Connection Quality now moves both. Each side keeps its own debounce counter.

---

## State machine

```
MONITOR --- streak_fail > 0 ---> SUSPECT --- streak >= fail_threshold ---> start gate
   ^                                |                                          |
   |  reachable and streak 0        |  none/holdoff: stay in SUSPECT           | go
   +--------- (natural recovery) ---+  radio_off: -> RADIO_OFF                 v
   |                                                                  SSR_HOLD? -> RECOVERY
   |                                                                          |
   |  cooldown verdict success                                                v
   +<------------------------------------------------------------------- COOLDOWN
                  fail: escalate directly (do_recovery), or exhausted -> hold-off, MONITOR

LOCKED     any maintenance condition (lock file, long-running AT, live profile apply)
RADIO_OFF  the user turned the radio off (AT+CFUN 0 or 4); shown in the UI as "Paused"
DISABLED   written on a reload-disable exit and on Tier 4 auto-disable
```

**Every "off" exit retires the service.** procd respawns any exit, whatever the code, and `start_service`'s UCI gate runs only on start or restart, never on respawn. So the Tier 4 auto-disable, the reload-disable exit and the startup `Watchcat disabled in config` exit all call `wd_retire_service` (`wd_tiers.sh`) before `exit 0`. It runs `/etc/init.d/qmanager_watchcat disable` and then `stop`, the same steps as the UI's off switch. `stop` deletes the procd instance and TERMs the daemon, and the TERM trap runs once the init script returns. Without procd (a manual run or the harness), `stop` does nothing and the `exit 0` follows. Live-validated 2026-10-21: one auto-disable, no respawn, no procd instance and no `rc.d` link left. Before this, procd re-ran the daemon 5 times in 25 s.

After an auto-disable the exit cleanup removes the state file, so `status.json` `.watchcat.reboots_this_hour` reads 0. That is harmless: the only consumer, the Watchdog band (`deriveBand`), hides figures outside `REPORTING_PHASES`, and the CGI's `recent_reboots` still lists the ledger rows.

States written to the state file: `monitor`, `suspect`, `recovery`, `cooldown`, `locked`, `disabled`, `ssr_hold`, `radio_off`. `recovery` is visible: `do_recovery` publishes the long heartbeat (`write_state_busy`) after the caller set `state="recovery"` and before the tier runs, so a long Tier 3 shows as `recovery`, not as a dead daemon.

Escalation goes **directly** from `_cooldown_handle_failure` into `do_recovery` at the next enabled tier; it does not bounce through `suspect`. **Why:** on the quality path the link is reachable throughout, so a `suspect` bounce would fall through to natural recovery and abandon the ladder.

`evaluate_quality` runs only in `monitor` and `suspect`; never in `cooldown`, `locked`, `radio_off`, `recovery` or `ssr_hold`. **Why:** quality evaluation during an SSR self-heal would re-trigger the quality path and defeat the hold.

### Start gate

Both start sites (the reachability threshold in `main` and the `evaluate_quality` trigger) and the escalation inside `_cooldown_handle_failure` call `wd_radio_reconcile` and then `wd_start_gate`, which gathers three inputs and feeds the pure function `wd_decide_start <tiers_any 0|1> <cfun> <holdoff_left>`:

| Order | Verdict | Condition | Effect |
|---|---|---|---|
| 1 | `none` | no tier enabled | nothing runs; state, counters and events are left alone (reachability stays in `suspect`; quality resets only its breach counter) |
| 2 | `holdoff` | `holdoff_until` not yet reached | same as `none`, until the pause ends |
| 3 | `radio_off` | `AT+CFUN?` reads 0 or 4 | `wd_enter_radio_off` |
| 4 | `go` | otherwise | `ssr_hold_gate`, then `do_recovery` |

`wd_cfun_now` asks QMI first (`qm_qmi_online` from `qmi_dms.sh`, sourced optionally by `qmanager_watchcat`): `online` prints 1 without touching the AT lane; any other mode or a QMI miss falls through to `AT+CFUN?` for the exact 0 or 4 ([`qmi-lane.md`](qmi-lane.md#device-service-consumers-2026-11-08)). An unreadable `AT+CFUN?` counts as on, so recovery is never blocked by a failed read. `wd_start_gate` reads `AT+CFUN?` only when it matters: some tier enabled, no hold-off running, and `wd_radio_down != 1`. While our own Tier 2 marker is set, a radio that is off is ours, not the user's, so it is reported as on and the ladder keeps escalating. `wd_radio_reconcile` runs first: with the marker set it reads `AT+CFUN?` and clears the marker when the radio reads 1.

### radio_off (shown as "Paused")

**Why:** airplane mode or a deliberate `AT+CFUN=0/4` kills the link by design. Treating that as an outage made the watchdog fight the user (and Tier 2 could leave the radio off).

`wd_enter_radio_off` sets `state="radio_off"`, resets the tier, counters, cooldown and SSR hold, removes the recovery flag and appends the event "Watchcat: radio is off, recovery paused until it is turned back on". Each pass in `radio_off` the main loop sends `AT+CFUN?`: a positive `1` returns to `monitor` (counters reset, `wd_quality_mark`, then `wd_sim_on_radio_back` to finish a deferred SIM swap-back); an unreadable reply keeps waiting. Quality evaluation and auto-failback are skipped (the arm ends in `continue`). The asymmetry is deliberate: the start gate never blocks recovery on an unreadable read, but the exit needs positive evidence.

**The outage clock restarts when the radio comes back.** `qmanager_ping` keeps counting failed probes while the radio is off, so its `streak_fail` is far past `fail_threshold` at the resume. On the `1` read the arm stores that streak in `_radio_streak_base` (main-owned), and every later pass subtracts it from `ping_streak_fail` before the state machine sees it. The discount ends when the raw streak drops below the base (the ping daemon reset it on a success). **Why:** without it Tier 1 (`COPS=2/0`) fired about 20 s after airplane mode ended, before the data link re-attached, and the deregistration slowed the re-attach (live 2026-10-21). A link that stays down after the resume still recovers after a full `fail_threshold` (harness 69, 70). Live re-test: radio off 100 s (raw streak 12), link back about 40 s after `CFUN=1`; the daemon saw a streak of 1, went `suspect -> monitor` and sent no recovery AT command.

The UI maps `radio_off` onto the existing Paused phase (locked disc, glyph and label) with its own blurb `watchdog.phase.radio_off.blurb` ("The radio is off, so the watchdog is holding off.").

### SSR hold

`ssr_hold` is a state in the table above: the gate holds the ladder while a recoverable baseband restart self-heals. See [SSR-aware hold](#ssr-aware-hold).

### LOCKED

`check_locked` is true for the maintenance lock, the long-running AT flag, or a live profile-apply PID. Entering LOCKED abandons any recovery in progress (the lock holder owns the modem): flags, counters, `revert_settle_active`, SSR hold are reset and `primary_recheck_active` is remembered as `recheck_interrupted`. Exiting resets again, calls `wd_quality_mark` and `wd_sim_on_unlock` (see [SIM failover](#sim-failover)). `install.sh` touches the lock for the whole install window.

---

## Heartbeat contract

The Watchdog page used to show a frozen last state when the daemon had died. The daemon now proves it is alive.

| Piece | Contract |
|---|---|
| State file | `write_state` adds `mono` (integer `/proc/uptime` seconds via `mono_now`) and `stale_after` (`3 * CFG_CHECK_INTERVAL + 60` s). `write_state_busy` writes the same file with `stale_after = 600`; it is called at the top of `do_recovery` and around each swap attempt in `wd_swap_slot`, so a minutes-long Tier 3 is not reported dead. |
| Poller | `read_watchcat_state` (Tier 1.5, every 10 s) reads `.mono` and `.stale_after` as fields 10-11. When the state file is **absent** it resets **all** `wc_*` variables to defaults (enabled false, state `disabled`). The composers emit `watchcat.age_sec` = poller `mono` minus `wc_mono` (clamped at 0, `null` when either is missing or zero) and `watchcat.stale_after` (`null` when missing). |
| UI | `isWatchcatLive(w)` (`derive.ts`): enabled and not (`age_sec > stale_after`). A block with no age fields (older backend) counts as live. `derivePhase` returns `not_running` ("Not reporting") when enabled but not live, `deriveBand` shows figures only for reporting phases, and `use-watchdog-indicator.ts` hides the sidebar pill when not live. |

**Why mono, not timestamps:** the NITZ `time_daemon` and `ntpd` step the wall clock about 90 s forward after an SSR, which made wall-clock ages look stale. The age is a monotonic delta on both sides.

**Exit cleanup removes the state file.** A stopped daemon therefore reads as "daemon gone" at once (absent file, poller defaults), not as a frozen last state; the UI shows "Starting" inside the 60 s `useGraceGate` after a save and "Not reporting" after it. `stale_after` also covers a hung daemon (`kill -STOP`): the file stays but ages out.

`write_state` coerces every numeric and boolean input first (`_wd_num` accepts plain non-negative integers without a leading zero, else the default), builds the JSON into a variable and writes it atomically (`qm_atomic_write`) only when non-empty. One corrupted global can no longer leave the state file empty or stale.

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

## Quality window

Quality is judged from the ping daemon's raw sample history, not from the poller's `status.json`. **Why:** `status.json` `.connectivity` is a ~60-sample average (about 10 minutes at the `quiet` profile), so a long-gone outage kept breaching the thresholds and a recovered link was escalated to a reboot.

- `read_quality` (keeps its contract: sets `q_avg_latency` and `q_packet_loss`, returns 1 for "no signal") reads `/tmp/qmanager_ping_history`.
- `quality_since` is the monotonic second the window starts at; `wd_quality_mark` sets it to now. The window size is `N = min(W, (now - quality_since) / CQ_INTERVAL_SEC)` with `W = clamp(120 / CQ_INTERVAL_SEC, 6, 60)` samples, so it covers roughly two minutes at any profile. `CQ_INTERVAL_SEC` comes from `conn_state_read` (fallback 5).
- **N < 3 means no signal**: the counter is neither advanced nor reset, and a cooldown that needs the verdict extends.
- Otherwise one `tail -n N | awk` computes the average of numeric lines (`%.1f`, or `null` when every sample is `null`) and the loss as `int(nulls * 100 / lines)`.
- Freshness comes from `read_ping`, which already ran that pass; a stale ping cache stops the pass before `read_quality`. The cooldown quality arm calls `read_ping` first and takes the stale-retry path on failure.
- Thresholds: `quality_breached` is OR logic (latency over the ceiling or loss at/over the ceiling; a ceiling of 0 ignores that metric). Latency is a decimal string: **compare it with awk, never `[ -gt ]`** (BusyBox `[ "1241.4" -gt 800 ]` exits 2).

`wd_quality_mark` is called at: startup after `BOOT_SETTLE`; every pass with `ping_streak_fail > 0` and the pass that ends the outage (so the next decision only sees post-outage samples, the false-escalation fix); in `do_recovery` after an action; at the end of every `wd_swap_slot` that left the modem on a slot; on LOCKED exit; on `radio_off` exit.

Detection latency: a breach must persist for `quality_consecutive` consecutive passes, and the window needs at least three samples since the last mark. A brief spike is absorbed by the window; expect roughly `quality_consecutive * check_interval` seconds of sustained degradation, not an instant reaction.

### Reason-aware cooldown verdict

`wd_cooldown_verdict <reason> <ping_ok 0|1> <reachable> <q_state 0|1|2> <stale_retries>` is pure (no I/O, no globals) and prints `success`, `extend` or `fail`. `finish_cooldown` calls it and then runs the same effects as before.

| Condition | Verdict |
|---|---|
| ping not fresh | `extend` while `stale_retries < 3`, then `fail` |
| `quality`, q_state 0 (good) | `success` |
| `quality`, q_state 1 (breached) | `fail` |
| `quality`, q_state 2 (no data / too few samples) | `extend` while `stale_retries < 3`, then `fail` |
| other reason, `reachable = true` | `success` |
| other reason, anything else | `fail` |

**Why a different test for quality:** a degraded link reports `reachable = true` the whole time, so judging a quality recovery by reachability would always declare success and burn through the tiers. `finish_cooldown` arm order: primary-recheck arm, then revert-settle arm, then the reason-aware verdict. An extension keeps the recovery flag touched so events stay suppressed.

---

## Recovery ladder

| Tier | Action | AT commands | Skipped when |
|---|---|---|---|
| 1 | Network re-registration | `AT+COPS=2` -> 2 s -> `AT+COPS=0` | never (when enabled) |
| 2 | Radio toggle | `AT+CFUN=0` -> 3 s -> `AT+CFUN=1`, then confirm | tower lock active; long-running AT flag |
| 3 | SIM failover | `wd_swap_slot` (`CFUN=0`, `QUIMSLOT=N`, `CFUN=1`, verified) | no backup slot; slot unreadable; backup equals the current slot; swap not verified |
| 4 | System reboot | `( sleep 1; sync; reboot ) &` | token bucket: `max_reboots_per_hour`; auto-disables on breach |

A skipped tier (return 1) moves to the next enabled tier. When none is left, the ladder is exhausted (hold-off below).

**Why Tier 1 is `AT+COPS`, not `ifdown/ifup`:** bouncing the host interface does nothing for a stalled modem attach; forcing deregistration and re-registration does.

**Why Tier 2 is skipped under a tower lock:** `AT+CFUN=0/1` power-cycles the radio and clears the lock state.

**Tier 2 never leaves the radio off.** After `CFUN=1` and `wait_for_modem`, `_wd_confirm_radio_on` reads `AT+CFUN?`. Anything but `1` gets one more `AT+CFUN=1` and a second read. The marker is cleared only when the radio is confirmed on; if it still is not, the marker stays, the exit cleanup restores the radio, and the start gate keeps escalating instead of mistaking it for the user's airplane mode. A reachable link in `monitor` also clears a stale marker.

**Why Tier 3 is off by default (`tier3_enabled=0`):** it needs a backup SIM; the UI requires a backup slot before it can be saved enabled (the CGI does not enforce it, the daemon skips the tier silently).

**Tier 3 settle floor.** A physical swap on the RM551E takes about 90 s to be stable. After a Tier 3 action the cooldown is `max(CFG_COOLDOWN, 90)` and `cooldown_remaining` carries the longer value so the UI countdown is honest. The same floor applies to revert and recheck swaps. It is the constant `SIM_SETTLE_SECS`, not a UCI key.

**Tier 4 and the token bucket.** `execute_tier4` recounts the ledger, then: at the cap it appends the event "Watchcat disabled: reboot limit exceeded", writes `quecmanager.watchcat.enabled=0` and the auto-disabled flag, sets state `disabled`, writes the state file and `exit 0`. Otherwise it appends the event "Watchcat: rebooting system (Tier 4)", appends `<epoch>|reboot|tier4_escalation` to `crash.log` (trimmed to the last 20 lines), writes the state file, removes the recovery flag and reboots in a detached subshell. Auto-disable persists across reboots (UCI) and the init script requires `enabled=1`, so procd does not respawn it.

> ⚠️ WARNING: The event text `Watchcat: rebooting system (Tier 4)` is an invariant. The Recovery Activity card dedupes its ledger-backed restart row against the RAM event by looking for `Tier 4` plus `reboot` in a `watchcat_recovery` message within 120 s of the ledger epoch (`isRebootEvent`, `recovery-activity-card.tsx`). Change the wording and a restart shows twice.

### Hold-off after an exhausted ladder

**Why:** before this, an exhausted ladder returned to `monitor` and the next pass restarted it from Tier 1, so a dead link ran the whole ladder (including Tier 2 radio cycles) back to back forever.

- Both exhausted sites (`do_recovery` when no tier is left, `_cooldown_handle_failure` when `find_next_tier` fails) call `_wd_start_holdoff`: `holdoff_until = mono_now + HOLDOFF_SECS` (900 s, fixed), `holdoff_reason = recovery_reason`, and the event "Watchcat: all recovery steps tried, pausing 15 minutes" (error severity). State returns to `monitor`.
- During the pause `wd_start_gate` returns `holdoff` (gate order above): no AT commands, no counters, no events; reachability stays in `suspect`.
- `wd_holdoff_clear` (the only other writer) clears `holdoff_until`/`holdoff_reason`. Without an argument it does nothing when `holdoff_reason` is `quality`; with `force` it always clears. Callers: natural recovery (`suspect -> monitor`) and the main-loop check "monitor, streak 0, reachable" (no argument); both cooldown success arms (`force`).
- **Trade-off:** a hold-off that followed a **quality** ladder is not cleared by a healthy link, because the link was reachable the whole time and one lost probe would otherwise end the pause and restart the ladder every few minutes. It therefore runs its full 15 minutes, and **a real outage inside that window waits for it to lapse** (the gate still returns `holdoff`). A hold-off that followed a reachability ladder ends as soon as the link is healthy.
- The pause lives in a shell variable: a daemon restart or reboot starts fresh. There is no UI for it.

---

## Reboot ledger

`/etc/qmanager/crash.log` is shared: the watchdog writes `tier4_escalation` rows, `record_planned_reboot` (`qlog.sh`) writes `user`/`unplanned` rows for the reboot alert. The watchdog counts and lists **only** `tier4_escalation` rows. **Why:** the token bucket and the "Reboots" figure mean "watchdog-caused reboots this hour"; the Alerts feature counts every row. Do not merge the two counters (see [Alerts](alerts.md#reboot-alerts)).

**The reported bug (figure stuck at 1 for days).** The count used to be taken once at start and again inside Tier 4, so a single watchdog restart left `reboots_this_hour` at 1 until the next restart or save, and the old Recent Activity feed (RAM events) lost the restart with the reboot. The fix:

- `wd_ledger_tick` is the **first statement of every main-loop pass** (before the reload check, so it also runs while locked, in cooldown or on any early `continue`). It recounts when `mono_now >= _rb_next`, then sets `_rb_next = now + 60`. The figure decays within about a minute of a row aging out.
- `count_recent_reboots` is clock-aware:
  - **sane clock** (`_qm_clock_sane`, sourced from `schedule_guard.sh`, year >= 2025; fallback test `date +%Y` >= 2025): count `tier4_escalation` rows with epoch `>= now - 3600`;
  - **insane clock** (the RM551E boots at 1970 until NITZ/ntp steps it): the rolling hour cannot be evaluated, so count every row with epoch `< 1735689600` (2025-01-01), the clock-less boot rows. This over-counts, which is the safe direction for the Tier 4 cap; the first recount on a sane clock drops them again.
  - non-numeric epochs are ignored (`$1 ~ /^[0-9]+$/`).
- `execute_tier4` also calls `count_recent_reboots` right before checking the cap.
- `wd_ledger_recent_json <limit>` (default 5) prints the Tier-4 epochs as a JSON array, newest first, `[]` on any problem. It uses no daemon globals (`CRASH_LOG` falls back to `/etc/qmanager/crash.log`), so the CGI sources it behind an `-f` guard with a stub that returns `[]`. The device `jq` has no regex, so numeric epochs are matched in awk.

UI wording is "Reboots" (eyebrow, value `count / cap`) with the caption "In the last hour"; the tone is `bad` only when `reboots >= cap`. The Recovery Activity card merges `recent_reboots` with the RAM events, drops epochs at or below `CLOCK_PLAUSIBLE_AFTER` (1_600_000_000, i.e. the 1970-era rows), dedupes as described above, sorts newest first and caps at five rows; the ledger row reads "The watchdog restarted the modem" (`watchdog.activity.tier4Reboot`).

---

## UCI configuration schema

### Full watchcat section

`install.sh` seeds every missing main key without overwriting (`enabled`, `check_interval`, `cooldown`, `tier1..4_enabled`, `max_reboots_per_hour`, then the quality, SSR and `primary_recheck_*` keys and `fail_threshold`); `ensure_watchcat_config()` in the CGI creates the whole section only if it is missing entirely. `backup_sim_slot` is left absent until set. `wd_config.sh` supplies the same defaults when a key is absent, including `CFG_ENABLED=0`.

| UCI Key | Range | Default | Meaning |
|---|---|---|---|
| `enabled` | 0/1 | 0 | Master on/off for the daemon |
| `fail_threshold` | int 1-20 | 5 | Consecutive failed **probes** before reachability recovery fires (raw `ping_streak_fail`, `>=`). Renamed from `max_failures` (migration in `install.sh`, CGI and backup restore). |
| `check_interval` | int 5-60 | 10 | Seconds between watchdog passes |
| `cooldown` | int 10-300 | 60 | Seconds to wait after a recovery action before judging it |
| `tier1_enabled` | 0/1 | 1 | Tier 1 (re-registration) |
| `tier2_enabled` | 0/1 | 1 | Tier 2 (radio toggle) |
| `tier3_enabled` | 0/1 | 0 | Tier 3 (SIM failover) |
| `tier4_enabled` | 0/1 | 1 | Tier 4 (reboot) |
| `backup_sim_slot` | 1/2 | (empty) | SIM slot for Tier 3 |
| `max_reboots_per_hour` | int 1-10 | 3 | Tier 4 token bucket; auto-disables at the limit |
| `quality_enabled` | 0/1 | 0 | Master opt-in for the quality trigger |
| `quality_consecutive` | int 1-60 | 5 | Consecutive breach passes before recovery fires |
| `ssr_aware` | 0/1 | 1 | Hold the ladder while a recoverable baseband restart self-heals |
| `ssr_grace` | int 10-120 | 45 | Seconds to hold before falling through to the ladder |
| `primary_recheck_enabled` | 0/1 | 0 | Auto-failback: blind recheck of the primary SIM while on the backup. Opt-in because each recheck is a real, brief outage. |
| `primary_recheck_interval` | int 5-1440 | 30 | **Minutes** between rechecks. |

> ⚠️ WARNING: The RM551E has a hard single-slot SIM mux (`AT+QUIMSLOT=?` -> `(1,2)`). The inactive slot gets no radio signal and cannot be tested passively, so auto-failback is a blind swap-back-and-retest. That is why it is opt-in with a minutes-granularity interval.

The daemon does not clamp UCI ranges (only the CGI validates); `fail_threshold` and `primary_recheck_interval` fall back to their defaults when non-numeric, the rest are used as read (see Known deferred).

### Probe-interval ownership keys

The watchdog is the **sole writer** of `ping_profile.interval_override`. While an override is active the Connection Sensitivity card shows an informational Alert; its profile tabs stay enabled (the selection becomes the fallback once the override is cleared).

| UCI Key | Section | Range | Default | Meaning |
|---|---|---|---|---|
| `probe_profile` | `watchcat` | `sensitive`/`regular`/`relaxed`/`quiet` | (unset) | Legacy profile selector; the Watchdog page no longer writes it |
| `interval_override` | `ping_profile` | int 1-60 or unset | unset | Overrides the profile-derived interval for `qmanager_ping`. Cleared by JSON `null` in the POST (the CGI tests `has("interval_override")` to tell clear from absent). |

Effective interval (`conn_state_resolve`): `interval_override` if set, else `sensitive=1`, `regular=2`, `relaxed=5`, `quiet=10`. GET exposes `interval_override` (raw), `effective_interval`, `interval_sec` (same value), `fail_secs`, `recover_secs` from `conn_state_cadence` (UCI, correct while the daemon is down).

**`probe_interval` POST (ledger U4.6).** The Detection card sends the effective cadence as `probe_interval` (int 1-60). The CGI compares it with `CQ_CFG_INTERVAL_SEC`: unchanged writes nothing (a save never touches cadence by accident); changed sets `ping_profile.interval_override`, or deletes it when the value equals the profile's own interval (`CQ_CFG_PROFILE_INTERVAL_SEC`), and touches `/tmp/qmanager_ping_reload`. Ignored when the same POST carries `interval_override`.

> ⚠️ WARNING: Only the watchdog writes `interval_override`. `ping_profile.sh` POST never touches it.

### Shared quality threshold keys (owned by `quality_thresholds.sh`)

| UCI Key | Values | Default (absent) | Meaning |
|---|---|---|---|
| `latency_preset` | `standard`/`tolerant`/`very-tolerant`/`custom` | `tolerant` | 150 / 250 / 500 ms or the custom value |
| `latency_custom_ms` | int 1-10000 | - | Only read when `latency_preset=custom` |
| `loss_preset` | same set | `tolerant` | 15 / 30 / 50 % or the custom value |
| `loss_custom_pct` | int 0-100 | - | Only read when `loss_preset=custom` |

`resolve_quality_thresholds()` (in `wd_config.sh`) mirrors the poller's resolver: an absent section means `tolerant`/`tolerant` (250 ms / 30 %), a non-numeric custom value falls back to the tolerant default. The section is never seeded; its absence means "factory default". The retired `latency_ceiling_ms` / `loss_ceiling_pct` watchcat keys are migrated by the installer into a `custom` preset and not read by the daemon. A `custom` value takes effect only with `latency_preset=custom` written together; always save via `quality_thresholds.sh`.

---

## SSR-aware hold

### What an MPSS SSR is

The RM551E (and RM520N-class) radio firmware runs on the MPSS subsystem, which can hit a fatal error and restart itself. The kernel logs `4080000.remoteproc-mss: fatal error received`; remoteproc brings it back in about 3-4 s and the data path returns in roughly 10-25 s. It is a recoverable, firmware-level event QManager neither causes nor prevents.

### The amplification problem

During the 10-25 s the link looks dead, the streak climbs, and the watchdog fires Tier 1/Tier 2 on top of a modem that is already healing. The forced detach turns a 30-60 s self-correcting outage into a multi-minute thrash.

### The hold

With `ssr_aware=1` (default) both start sites call `ssr_hold_gate()` after the start gate returns `go` and before `do_recovery`. `ssr_in_progress()` runs `dmesg` once, takes the last `4080000.remoteproc-mss: fatal error received` line, parses the integer seconds with `sed 's/^\[[ ]*\([0-9]*\)\..*/\1/'` and compares to `/proc/uptime`. The look-back window is

```
CFG_SSR_GRACE + CFG_FAIL_THRESHOLD * CQ_INTERVAL_SEC + 2 * CFG_CHECK_INTERVAL
```

**Why not the grace alone:** the crash only becomes visible to the ladder after the ping daemon has counted `fail_threshold` failed probes and a pass has seen them. On a slow profile (`quiet`, about 60-70 s to detection) a bare 45 s window always expired first and the hold never engaged, so every SSR was amplified. The hold length itself is still `ssr_grace`.

Graceful degradation: no dmesg output, an evicted line or an unparsable timestamp returns false and the daemon behaves as if the feature did not exist. The hold is a de-amplifier, never a correctness dependency (the token bucket is the backstop).

When holding: `state="ssr_hold"`, `ssr_hold_started` and `last_ssr_detected` record the monotonic uptime, `do_recovery` is skipped, `current_tier` is not advanced, no AT command runs. Each pass re-evaluates through the merged `suspect|ssr_hold` arm:

- **Connectivity returns:** reachable and streak 0 -> `ssr_hold_clear`, back to `monitor`; no recovery ran.
- **Grace expires:** `ssr_hold_gate` clears the hold and returns 1; the ladder runs from the tier found before the hold (no tier skip).

`ssr_hold` is also cleared on LOCKED entry/exit and when entering `radio_off`. A quality-triggered hold resolves through the reachability arm (the link is reachable again and the breach counter was already reset); a `suspect -> monitor` log line instead of `ssr_hold -> monitor` is expected. It defaults ON so affected users benefit on upgrade; the dmesg grep only runs at an escalation decision.

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

1. No backup slot configured, unreadable current slot, or backup equals current -> skip the tier.
2. Capture the original SIM's ICCID, stop `qmanager_tower_failover` (its locks mean nothing on another SIM).
3. `wd_swap_slot` (above). `original_sim_slot`, `original_sim_iccid`, `current_sim_slot` are set **after** a verified swap, so a swap that never happened leaves no record.
4. Save the **unconfirmed** failover record (`confirmed:false`) immediately, so a reboot during the settle still knows the modem is on the backup.
5. `AT+CPIN?` guard: up to 3 reads, 1 s apart; only `rc=0` with `+CPIN: READY` passes (right after `CFUN=1` the modem can answer `+CME ERROR: 14`, SIM busy). Otherwise `sim_failover_fallback`, then `wd_sim_adopt_live_slot` if that failed. Daemon AT checks judge `"$rc:$result"`: on this target `qcmd` prints a modem `ERROR` on stdout with rc 0, and a transport failure exits non-zero with empty stdout. The "could not confirm" log line carries the first reply line (e.g. `+CME ERROR: 10` for an empty slot), or `no reply` on a transport failure.
6. Enter cooldown (`max(CFG_COOLDOWN, 90)`).
7. On a successful cooldown, `finalize_sim_failover` (shared by both success arms, self-guarded: Tier 3, slot moved, original known) sets `sim_failover_active`, rewrites the record without `confirmed`, runs `sim_db_add`, auto-applies a matching custom profile (`auto_apply_profile ... "watchdog"`) and starts the auto-failback clock (`last_recheck_time`).

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

`_wd_sim_revert_run` calls `sim_failover_fallback`. On failure (swap back not verified) it returns 1 with the failover still active and the record kept (plus the adopt rule); the request is consumed and the user can ask again. On success it clears the record; when `WD_SWAP_NOOP=true` (already on the original slot) there is no settle, otherwise the post-revert settle runs (`revert_settle_active=true`, `cooldown_remaining=90`, state `cooldown`). The settle is a benign hold: `finish_cooldown` returns to `monitor` without running the verdict or escalating.

**Why defer instead of drop:** a revert that arrived during the post-swap cooldown used to be deleted silently.

### Revert pending (airplane mode during a failed Tier 3)

If a Tier 3 cooldown fails while the radio is off, the swap-back would cycle a radio the user turned off. `_cooldown_handle_failure` instead calls `wd_sim_defer_revert`: the modem stays on the backup as a recorded failover, `wd_sim_revert_pending="true"`, and the record gets `revert_pending:true`; the daemon parks in `radio_off`. The swap-back is completed through the same `_wd_sim_revert_run` path:

- when the radio comes back (`wd_sim_on_radio_back`, from the `radio_off` arm);
- at the next daemon start (`wd_sim_resume_at_start`): radio on -> run now; radio off -> `radio_off` and wait; under a maintenance lock it only stays pending;
- after a lock ends (`wd_sim_on_unlock`), ahead of the unconfirmed-swap revert (radio on -> run; off -> `radio_off`).

### Unconfirmed swap and interrupted recheck on LOCKED exit

Entering LOCKED during a Tier 3 cooldown abandons it before `finalize_sim_failover`. On LOCKED **exit** (not entry: the lock holder owns the modem until then) an unconfirmed swap (`sim_failover_active != true`, slot moved from the original) is reverted with `sim_failover_fallback` and held as a revert settle. Entering LOCKED during a primary-recheck settle records `recheck_interrupted`; on exit, if the modem is still on the original slot with the failover active, the settle is re-armed so `finish_cooldown`'s recheck arm decides from a fresh read.

### Auto-failback: blind primary recheck

With `primary_recheck_enabled=1`, `sim_failover_active`, state `monitor`, no recheck settle running and no pending revert flag, the loop compares `mono_now` with `last_recheck_time + interval * 60` (monotonic so a boot-time clock step cannot make a recheck due at once; see [scheduled-jobs.md](scheduled-jobs.md)). When due, `initiate_primary_recheck`: records `recheck_return_slot`, `wd_swap_slot` to the primary (rc 1/3 -> stay on backup, restart the clock, no settle), then a `SIM_SETTLE_SECS` cooldown with `primary_recheck_active=true`. `recovery_reason` is left alone so the test uses the quality criterion iff the failover was quality-driven.

`wd_sim_finish_recheck` (called first by `finish_cooldown`) decides from a fresh read: ping reachable (and, for a quality failover, `read_quality` not breaching; stale data = unhealthy). **Healthy** -> `_wd_sim_failback`, the shared failback body: clear the record, learn the ICCID, `auto_apply_profile "$iccid" "watchdog_failback"`, restart tower failover, append the event, reset the original slot, counters and recheck clock, return to `monitor`. **Unhealthy** -> `wd_swap_slot` back to the backup (rc 0/2 recorded; otherwise the live slot is read and, if still on the primary, it is a failback with the benign settle), rewrite the record, stop tower failover, restart the interval clock and run a benign settle.

`primary_recheck_active` and `revert_settle_active` are shell variables only; the UI sees a plain `cooldown` countdown.

**Why opt-in and minutes-only:** every recheck is a real outage on a slot that cannot be probed passively; a seconds cadence would loop the modem in and out of outages.

---

## Daemon state file (`/tmp/qmanager_watchcat.json`)

Written by `write_state` / `write_state_busy` (atomic). The CGI GET passes it through as `status`.

| Field | Type | Meaning |
|---|---|---|
| `timestamp` | int (epoch) | Wall-clock time of the write |
| `mono` | int | `/proc/uptime` seconds at the write (heartbeat) |
| `stale_after` | int | Seconds after which the poller reports the daemon as not reporting (`3 * check_interval + 60`, or 600 during a long tier) |
| `enabled` | bool | `CFG_ENABLED` |
| `state` | string | `monitor`/`suspect`/`recovery`/`cooldown`/`locked`/`disabled`/`ssr_hold`/`radio_off` |
| `current_tier` | int | Active recovery tier (0 = none) |
| `failure_count` | int | Display mirror of the raw ping `streak_fail`, not an accumulator |
| `last_recovery_time` | int or null | Epoch of the last recovery action |
| `last_recovery_tier` | int or null | Tier of the last recovery action |
| `total_recoveries` | int | Recovery actions since daemon start (a clean restart resets it; a settings save no longer restarts) |
| `cooldown_remaining` | int | Seconds left in cooldown |
| `sim_failover_active` | bool | On the backup SIM (written with `--arg` and compared `== "true"`) |
| `original_sim_slot` / `current_sim_slot` | int or null | Slots around Tier 3 |
| `reboots_this_hour` | int | Watchdog (`tier4_escalation`) reboots in the rolling hour; see [Reboot ledger](#reboot-ledger) |
| `quality_breach_count` | int | Current consecutive quality breach counter |
| `quality_enabled` | bool | `CFG_QUALITY_ENABLED` |
| `last_recovery_reason` | string | `"unreachable"` or `"quality"` |
| `ssr_hold` | bool | Holding for an SSR self-heal |
| `last_ssr_detected` | int or null | Monotonic seconds of the last detected crash; null if none this session |

The poller re-emits only `enabled`, `state`, `current_tier`, `failure_count`, `last_recovery_*`, `total_recoveries`, `cooldown_remaining`, `reboots_this_hour` and the two heartbeat fields into `status.json` `.watchcat`. The state and activity are RAM-only and are lost on reboot (the ledger and the flash failover record are not).

---

## CGI envelope

### GET `/cgi-bin/quecmanager/monitoring/watchdog.sh`

```json
{
  "success": true,
  "settings": {
    "enabled": false, "fail_threshold": 5, "check_interval": 10, "cooldown": 60,
    "tier1_enabled": true, "tier2_enabled": true, "tier3_enabled": false, "tier4_enabled": true,
    "backup_sim_slot": null, "max_reboots_per_hour": 3,
    "quality_enabled": false, "quality_consecutive": 5,
    "ssr_aware": true, "ssr_grace": 45,
    "primary_recheck_enabled": false, "primary_recheck_interval": 30
  },
  "probe_profile": "relaxed",
  "interval_override": null,
  "effective_interval": 5, "interval_sec": 5, "fail_secs": 15, "recover_secs": 10,
  "quality_thresholds": { "latency_ms": 250, "loss_pct": 30, "latency_preset": "tolerant", "loss_preset": "tolerant" },
  "status": { "...": "raw /tmp/qmanager_watchcat.json, or {}" },
  "sim_failover": { "active": false },
  "sim_swap": { "detected": false },
  "auto_disabled": false,
  "recent_reboots": [1737158400, 1737150000]
}
```

- `recent_reboots`: Tier-4 ledger epochs, newest first, at most 5, `[]` on any problem or an absent ledger.
- `sim_failover` is the raw /tmp record, so it can carry `confirmed:false` and `revert_pending:true` in addition to the keys above.
- Robustness: `status`, `sim_failover`, `sim_swap` and `recent_reboots` each go through `json_or_default` (exactly one value of the expected type, else the default), and every UCI numeric/boolean used with `--argjson` is coerced with `case` (`coerce_int`, `coerce_bool`). A 0-byte or half-written state file, a garbage failover file or `cooldown=abc` still returns `success:true`.
- `settings.backup_sim_slot` is `null` when empty. The probe-cadence keys and `quality_thresholds` are top-level siblings of `settings`; `quality_thresholds` is a read-only passthrough (change it via `quality_thresholds.sh`).

### POST

**`save_settings`** validates and writes only the keys **present in the body** (an absent key leaves its UCI value untouched, `backup_sim_slot` included), commits, touches the reload flag and enables/starts or stops/disables the daemon. Each bento card sends only its own keys. Ladder card:

```json
{ "action": "save_settings", "enabled": true, "tier1_enabled": true, "tier2_enabled": true,
  "tier3_enabled": false, "tier4_enabled": true, "backup_sim_slot": null,
  "primary_recheck_enabled": false, "primary_recheck_interval": 30, "max_reboots_per_hour": 3 }
```

Detection card:

```json
{ "action": "save_settings", "probe_interval": 10, "fail_threshold": 5, "cooldown": 60,
  "quality_enabled": true, "quality_consecutive": 5, "ssr_aware": true, "ssr_grace": 45 }
```

The older full-body form (every key plus `check_interval`, `probe_profile`, `interval_override`) is still accepted.

**`dismiss_sim_swap`** sets `.dismissed = true` in `/tmp/qmanager_sim_swap_detected`. **`revert_sim`** writes `/tmp/qmanager_watchcat_revert_sim` (root-owned); the daemon picks it up within one pass. Both return `{ "success": true }` (`revert_sim` adds a `message`).

**Validation errors** (HTTP 200, `success:false`):

```json
{ "success": false, "error": "invalid_field", "field": "fail_threshold", "reason": "must be integer 1-20" }
```

| Field | Validation |
|---|---|
| `fail_threshold` | int 1-20 |
| `check_interval` | int 5-60 |
| `cooldown` | int 10-300 |
| `max_reboots_per_hour` | int 1-10 |
| `backup_sim_slot` | 1 or 2 to set; JSON `null` to clear; absent leaves it |
| `probe_interval` | int 1-60; written only when it differs from the current cadence |
| `quality_consecutive` | int 1-60 |
| `ssr_grace` | int 10-120 |
| `primary_recheck_interval` | int 5-1440 (minutes) |
| `probe_profile` | `sensitive`, `regular`, `relaxed`, `quiet` |
| `interval_override` | int 1-60 to set; `null` to clear; the key must be present to change it |

`ssr_aware`, `quality_enabled`, the tier flags, `enabled` and `primary_recheck_enabled` take booleans; any other value is silently ignored (deferred). `reject_field` runs `uci -q revert quecmanager` before printing, so a rejected save leaves nothing staged for a later `uci commit` to apply. **Why:** one rejected field could otherwise arm Tier 4 on someone else's commit.

> ℹ️ NOTE: The error envelope uses `reason`, not `detail`. `useWatchdogSettings` passes `json.reason` to `resolveErrorMessage` as the detail.

---

## Apply / reload (no restart on save)

```
POST save_settings
  validate -> uci set -> uci commit quecmanager
  touch /tmp/qmanager_watchcat_reload
  probe interval changed? -> touch /tmp/qmanager_ping_reload
  enabled=1:
      rm -f /tmp/qmanager_watchcat_disabled
      /etc/init.d/qmanager_watchcat enable
      daemon running?  yes -> nothing (it reloads from the flag)
                       no  -> start it (backgrounded)
  enabled=0:
      /etc/init.d/qmanager_watchcat stop ; disable
```

The running daemon checks `RELOAD_FLAG` at the top of each pass (after `wd_ledger_tick`), removes it, logs "Config reload requested" and calls `read_config`; if the reload shows `enabled != 1` it writes `state="disabled"` and exits. Changes take effect within one `check_interval` (5-60 s).

**Why no restart:** the old save restarted the daemon every time, which dropped the in-flight cooldown, the Tier 3 SIM state, hold-offs and the recovery counters mid-recovery. The same rule applies to the config-restore watchdog section (start only when down). The idiom is the same as `vpn/netbird.sh` (`running` check).

> ⚠️ WARNING: **`quality_thresholds.sh` POST touches TWO reload flags.** Because the shared thresholds feed both the poller (Network Events) and the watchdog, it must touch BOTH `/tmp/qmanager_quality_reload` AND `/tmp/qmanager_watchcat_reload`. The watchdog deliberately does not consume the quality flag (the poller owns its deletion). Verify both on any edit to `quality_thresholds.sh`.

---

## Recovery-lifecycle network events

The watchdog appends to the RAM event ring (`/tmp/qmanager_events.json`, max 50, lost on reboot) using the existing types `watchcat_recovery` and `sim_failover` (no new strings, so the Network Events UI and alerting render them). Events carry only `{timestamp, type, message, severity}`; the trigger reason is part of the message text.

| Lifecycle point | Type | Message |
|---|---|---|
| Quality breach starts recovery | `watchcat_recovery` | "Watchcat: connection quality degraded (latency ... / loss ...) - starting recovery" |
| Recovery marker (once per tier and reason) | `watchcat_recovery` | "Watchcat: starting recovery (Tier N) - internet unreachable" or "... - connection quality degraded" |
| Tier actions | `watchcat_recovery` / `sim_failover` | "re-registering on network (Tier 1)", "toggling radio (Tier 2)", "switching to SIM slot N (Tier 3)", "rebooting system (Tier 4)" |
| Escalation | `watchcat_recovery` | "recovery escalating to Tier N - previous tier did not restore the connection" |
| Success | `watchcat_recovery` | "recovery succeeded (Tier N) - ..." |
| SSR hold | `watchcat_recovery` | "recoverable baseband restart detected - holding recovery to let the modem self-heal" |
| Radio off | `watchcat_recovery` | "radio is off, recovery paused until it is turned back on" |
| Ladder exhausted | `watchcat_recovery` | "all recovery steps tried, pausing 15 minutes" |
| Auto-disable | `watchcat_recovery` | "Watchcat disabled: reboot limit exceeded (N reboots/hour)" |
| Failover, revert, recheck | `sim_failover` | confirmed, reverting, unverified swap, rechecking primary, failed back, and so on |

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

## Test harness

`tools/watchdog-harness/` is a dev-only harness (never installed: `install.sh` does not copy `tools/`). It sources the daemon with `WATCHCAT_NO_MAIN=1 WD_LIB_DIR=<repo libs>` under **BusyBox ash in WSL**, against a fake clock and a scripted scenario tape, and records everything observable. **Why WSL and not the modem:** the daemon calls absolute paths (`/etc/init.d/qmanager_tower_failover`, `profile_mgr.sh`, `reboot`) that must never fire on a live unit; in the sandbox they are rewritten or stubbed and log to `calls.log`. Requirements: WSL Ubuntu with BusyBox v1.36.1 and `jq` on `PATH` (or `JQ=/path/to/jq`).

```sh
H="/mnt/d/Projects/QM PROJECT/QManager/tools/watchdog-harness"     # adjust to the checkout
busybox sh "$H/run.sh" list                                         # scenario names
busybox sh "$H/run.sh" run -o /tmp/wd-new                           # all scenarios against this checkout
busybox sh "$H/run.sh" run -o /tmp/wd-x 12_user_revert              # one scenario
busybox sh "$H/run.sh" compare "$H/baseline" /tmp/wd-new            # IDENTICAL / DIFFERS per scenario
```

- Output per scenario: `at.log` (every AT command with fake time), `calls.log`, `passes.txt` (state file, file list and failover record after every pass), `tree.txt` (every file left in the fake root), `console.log`, `exit.code`. PIDs are masked, so two runs of behaviourally identical code are byte-identical. `WDH_KEEP=1` keeps the work dirs under `/dev/shm`.
- `baseline/` is the recorded output of the latest reviewed daemon; `compare baseline <your-out>` is the regression gate. After an **intentional** behaviour change, review every DIFFERS, then re-record: `run.sh run -o tools/watchdog-harness/baseline`, and record the explained differences in the harness README (as the wave-2 and round-2/3 sections do).
- Scenario numbering: **01-29 core** (startup, tiers, quality, SSR, lock, Tier 4, reload, reboot ledger 24-26, TERM cleanup 27-28, malformed state 29), **30-39 recovery** (quality window, pure tables 33, hold-off 34/38/52, radio-off 35, Tier 2 radio 36-37, SSR on slow profiles 39), **40-49 SIM** (verified swap 40-43, resume 44-46, recheck failures 47-48), **50+ review fixes** (waves and rounds 2 and 3: adopt-live-slot, unconfirmed record, persisted `revert_pending`, unreadable slot, deferred swap-back under a lock). Scenarios live in `scenarios/NN_name.sh`; each may define `SC_PASSES`, `sc_setup`, `sc_pass_N`, `sc_qcmd`. The set is 67 scenarios; `49` is unused.
- The first baseline was recorded against the last single-file daemon (`git show 125b3ce6:scripts/usr/bin/qmanager_watchcat`, pass it with `-d`) and the split was proved byte-identical to it before any fix; later baselines were re-recorded per wave, with each difference explained in the README.
- Static gates that go with it: `sh -n` on every file, `.claude/check-crlf.sh`, bashism grep (`[[`, `==`, `local a b`, arrays, `echo -e`), jq-regex grep (`test(`, `match(`, `sub(`, `gsub(`), numeric guards before arithmetic, and no `AT+CFUN=1,1`. Poller changes also run `tools/poller-parity/`.

---

## Known gotchas

- **`jq --argjson` parses `"true"`/`"false"` into JSON booleans; do not compare them with `== "true"`.** `sim_failover_active` is written with `--arg` and compared `($sf_active == "true")`. Use `--arg` to string-compare, `--argjson` to emit a parsed value. `ssr_hold` uses `--argjson` correctly (coerced to `true`/`false` first).
- **Float comparison needs awk.** `avg_latency_ms` is decimal; BusyBox `[ "1241.4" -gt 800 ]` exits 2. See `quality_breached`.
- **`fail_threshold` counts probes, not passes.** At `quiet` (10 s) `fail_threshold=5` is about 50 s of failed probes.
- **Wall-clock staleness is corrupted by NITZ/NTP steps.** After an SSR the clock steps about 90 s forward. Every age check uses `mono_now()` (`/proc/uptime`) and the additive `mono` fields in `qmanager_ping.json`, `status.json` and the watchdog state file; wall-clock fallbacks run only when `.mono` is absent or zero, and a `.mono` ahead of uptime counts as stale.
- **A stale ping cache is no-signal, not healthy.** A dead `qmanager_ping` freezes the breach counter and the pass is skipped; the Health Check covers a dead ping daemon. The poller's Adaptive Polling deep tier does not affect the watchdog (see [adaptive-polling.md](adaptive-polling.md)).
- **The 1970 clock.** With no RTC the modem boots at 1970 until NITZ/ntp steps the clock. The ledger count uses the 2025 rule above; the UI ignores epochs at or below 1_600_000_000; the events ring and `crash.log` can hold 1970-era rows that sort before real ones.
- **SSR hold is best-effort.** The kernel ring buffer can evict the crash line (a busy QCMAP bring-up fills it); then the hold never engages and the ladder runs.
- **BusyBox awk rejects bracket-class `-F` separators** (`awk -F'[][. ]+'` errors with `Unknown collating element`, to stderr, so the feature silently goes inert). `ssr_in_progress` uses `sed`. dmesg lines on this kernel are double-bracketed (`[ secs.usec][ Tthread]`); anchor on the first bracket only.
- **Device `jq` has no regex.** `test()`, `match()`, `sub()`, `gsub()` fail at runtime, silently under `2>/dev/null`. Use `case`, `awk` or `sed`.
- **`jq // empty` drops `false`.** Use `if . == null then ... else tostring end`.
- **CRLF in a daemon or lib breaks it silently.** Run `.claude/check-crlf.sh`.
- **`qcmd` modem `ERROR` is rc 0.** Judge `"$rc:$result"`; a transport failure is non-zero with empty stdout.
- **Libraries are not executable scripts.** Do not add top-level commands or `.` lines to a `wd_*.sh`; the loader's `...LOADED=1` check and the CGI's guarded `wd_ledger.sh` source depend on it.
- **Quality-triggered hold clears via the reachability arm** (see SSR hold).

---

## Known deferred

Real findings from the 2026-10-21 audits (`docs/plans/watchdog-audit/01-core.md`, `02-sim.md`, `03-surface.md`) that were not fixed in this change. Nothing here is a regression.

| Item | Why deferred |
|---|---|
| WD-07: `crash.log` append is unchecked (and the 20-row trim) | Needs a read-only or full `/etc`; rare. Next candidate: a 3-line follow-up in `wd_ledger.sh`/`execute_tier4`. |
| WD-10 / F-06: the SIM-switch flag is ignored by `check_locked`; no manual slot reconcile | Needs a user SIM switch during an outage. `wd_swap_slot`'s already-on-target return covers the revert case. Next candidate. |
| F-03: in-flight breadcrumb | The TERM cleanup restores `CFUN=1` and saves no longer restart the daemon; the remaining window is a SIGKILL during Tier 3 (`install.sh` does `killall -9`). |
| F-07: settle-floor gaps; F-08: single 90 s verdict | Design work; partly eased by the quality window. |
| F-10: `recovery_reason` overwritten | Only affects auto-failback after a quality failover. |
| F-14: tower-failover restart paths; tower lock vs Tier 3 | Partly unproven. |
| F-15 / WD-19: UCI range clamping in the daemon | Needs a hand edit or a bad backup; the CGI validates. |
| F-17: negative cache; two-way Tier 3; backup-slot edit during a failover | Design. |
| WD-14: frozen cooldown countdown; WD-15: stale tier after SSR | Cosmetic. |
| WD-17 / F5 / F19: auto-disable reason lost on reboot | The page still shows Off, and Alerts lists the reboots. (The respawn-budget part is fixed: `wd_retire_service`.) |
| WD-18: Tier 1 overrides a manual operator | Unproven. |
| WD-21: PID guard trusts `kill -0` | Less relevant now that TERM exits cleanly. |
| WD-22: events ring unlocked | Rare; poller hot path. |
| WD-04: blind when the ping daemon is dead | The System Health Check covers it. |
| F11: non-boolean accepted by the CGI; F12: revert toast and no-op success; F15: Prometheus liveness; F16: GET writes (`ensure_watchcat_config`); F18: timeline | Low. |
| F17: three `status.json` pollers; WD-23: float loss | Won't fix (the first is gone with the quality window; the second is replaced by an integer loss figure). |
| Follow-ups: shared verify lib with `cellular/settings.sh`; dedupe the `alerts.sh` awk against `wd_ledger_recent_json`; "Test backup SIM" dry run; `unplanned` rows in the watchdog card | Not started. |

---

## Untested live

Hardware limits, not code gaps: the RM551E test unit has no working second SIM. Everything below is covered by harness scenarios (`05`, `11`, `13`-`15`, `44`-`46`, `58`-`68`) but has **not** been exercised on hardware:

- **A successful Tier 3 failover and the reboot resume.** A verified swap to a working backup SIM, `finalize_sim_failover`, the two-copy record, and the record resuming after a real reboot (flash copy -> /tmp) with a matching live slot. A failed swap (empty backup slot) is the only live path available.
- **Quality-triggered Tier 3 finalization** (`reason: "quality_degradation"`, `active: true`).
- **Auto-failback full loop** (`primary_recheck_enabled=1`, `primary_recheck_interval=5`): the blind swap-back, a healthy primary failing back, and an unhealthy primary returning to the backup with the record rewritten.
- A real MPSS SSR with `ssr_aware` on a slow ping profile (the harness feeds a dmesg fixture; the hold engaging on the real kernel line is verified only to the extent of earlier on-device checks).

Results of the live runs that were possible (heartbeat, stop timing, no-restart save, radio-off, real Tier 4 and ledger decay) are in [`docs/plans/watchdog-audit/04-live-validation.md`](../plans/watchdog-audit/04-live-validation.md). Plan and rationale: [`docs/plans/2026-10-21-watchdog-modular-lean-plan.md`](../plans/2026-10-21-watchdog-modular-lean-plan.md). The superseded May plan [`docs/2026-05-12-watchdog-sim-failover-audit-fixes.md`](../2026-05-12-watchdog-sim-failover-audit-fixes.md) is historical.
