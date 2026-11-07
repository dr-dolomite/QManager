# watchdog-harness

Dev-only parity harness for `qmanager_watchcat` and its `wd_*.sh` libraries. Not installed
(`install.sh` never copies `tools/`). It sources the daemon with `WATCHCAT_NO_MAIN=1`, runs
`main` under BusyBox ash in WSL against a fake clock and a scripted scenario tape, and records
everything observable. Two runs of behaviourally identical code give byte-identical output.

## Usage (WSL Ubuntu, BusyBox v1.36.1, jq in `~/bin` or on PATH)

```sh
H="/mnt/d/.../tools/watchdog-harness"
busybox sh "$H/run.sh" list
busybox sh "$H/run.sh" run -o /tmp/wd-split                  # this checkout's daemon + libs
busybox sh "$H/run.sh" run -o /tmp/wd-base -d MONOLITH_FILE  # baseline from the commit-0 monolith
busybox sh "$H/run.sh" run -o /tmp/wd-x 12_user_revert       # one scenario
busybox sh "$H/run.sh" compare /tmp/wd-base /tmp/wd-split    # IDENTICAL / DIFFERS per scenario
```

Monolith for the baseline: `git show 125b3ce6:scripts/usr/bin/qmanager_watchcat > .cache/qmanager_watchcat.mono`
(`125b3ce6` is "allow sourcing the daemon without running main", the last single-file commit).
`baseline/` holds the recorded output of the latest reviewed daemon (Phase 1 commit-0 parity
output until wave 1, see "Phase 2 additions"); `compare baseline <your-out>` is the regression gate.
`WDH_KEEP=1` keeps the per-scenario work dirs (`/dev/shm/wdh.*`) for debugging.

## How isolation works

- The daemon and the libs it sources (`qlog`, `safe_tmp`, `events`, `sim_db`, `conn_state`,
  `wd_*`) are copied into a stage dir with a `sed` rewrite of the absolute device paths
  (`/usr/lib/qmanager/`, `/etc/init.d/`, `/etc/qmanager/`, `/tmp/`, `/var/run/`,
  `/proc/uptime`). The same rewrite is applied to the monolith and to the split files, and the
  repo files are never modified. `/etc/init.d/qmanager_tower_failover`, `/etc/init.d/qmanager_watchcat` and `profile_mgr.sh`
  become stubs that only log to `calls.log`.
- PATH holds only BusyBox applets and jq (like the device). `qcmd`, `uci`, `date`, `sleep`,
  `dmesg`, `reboot`, `sync`, `logger` are shell functions (`lib.sh`); `qm_trusted_file` is
  stubbed open after the daemon is sourced.
- `sleep` is the clock: the boot settle arms pass 1, each end-of-pass sleep snapshots the state
  and arms the next pass, and the run stops with `exit` after `SC_PASSES` passes so the EXIT
  trap runs. Ping and status caches are regenerated from a small model after every advance.

## Scenario files (`scenarios/NN_name.sh`)

Optional: `SC_PASSES`, `sc_setup` (before `main`), `sc_pass_N` (at the start of pass N),
`sc_qcmd CMD` (print a reply; return 100 to fall back to the default reply table; any other
code becomes qcmd's exit code). Helpers: `mset`/`mget` (model: `reachable`, `link_slot_<n>`,
`slot`, `ping_stale`, `status_stale`, `q_loss`, `q_latency`, `cpin_slot<n>`,
`quimslot_swallow`), `uci_set`, `h_touch`/`h_rm` (files under the fake `/tmp`), `dmesg_crash`,
`failover_write`, `crash_log_add`.

## Output per scenario

`at.log` (every AT command with fake time, pass markers), `calls.log` (uci set/commit, tower
failover init, profile apply, reboot), `passes.txt` (state file, file list and failover record
after every pass), `tree.txt` (every file left in the fake root: events, crash.log, qlog lines,
failover and known-SIM files), `console.log` (stdout/stderr), `exit.code`. PIDs are masked.

## Phase 2 additions (wave 1: daemon core)

New scenario hooks: `sc_post_source` (runs right after the daemon is sourced, before `main`),
`sc_snap_extra PASS` (its output is appended to `passes.txt` under `-- extra` after each pass),
`SC_REAL_SLEEP=1` (keep the daemon's real `wd_sleep`; the scenario drops the fake `sleep` itself,
see `27_*` and `28_*`). Without it `inner.sh` maps `wd_sleep` to the fake clock's `sleep`. New
helper `crash_log_epoch EPOCH REASON` appends a literal-epoch ledger row. `schedule_guard.sh` is
staged with the other libs (the ledger's clock check). Scenarios 24-26 cover the reboot ledger
(count, recent JSON), 27-28 the TERM cleanup (real time, exit code 143, no orphan sleep, state
file gone) and 29 the heartbeat fields with malformed counters.

`baseline/` was re-recorded from the wave-1 daemon. Every difference to the Phase 1 baseline
(still in git history at `760e7d7d`) is one of these:

- the state JSON gains `"mono":N,"stale_after":S` at the end (item 5);
- the final state file is no longer left in `tree.txt`: the EXIT trap removes it (item 3);
- scenarios that start with a failover record (02, 03, 12, 13, 14, 15): the resume `AT+QUIMSLOT?`
  and its log line move from T+0 to T+30, after the boot settle (item 9). 13, 14 and 15 run 3
  passes longer, and 15 moves its lock/unlock hooks by 3 passes, so the whole recheck timeline
  shifts by 30 s and the AT and call sequences stay identical to the old ones;
- scenarios 24-29 exist only in the new baseline.

The per-minute ledger recount (item 1) and the `CFG_ENABLED` default (item 12) change no existing
scenario output; the recount is visible only in 24 and 25.

## Wave-2 review fixes (scenarios 50-55)

`baseline/` was re-recorded after the wave-2 review fixes (H1-H2, M3-M6, L8). New scenarios:
50 (failed SIM fallback adopts the real failover state), 51 (swap done, radio unconfirmed),
52 (hold-off cleared from monitor), 53 (stale radio-down marker cleared before the gate),
54 (unresumed failover record retried), 55 (Tier 3 failure while the radio is off defers the
swap back). Every difference to the previous baseline in an existing scenario is one of these:

- 30, 35: `quality_since` moves one pass later (L8: the pass that ends an outage re-marks the
  quality window too); in 30 the window has `no signal` for one more pass at 9, then the same
  figures;
- 40, 47, 48: one extra `AT+QUIMSLOT?` right after a swap that could not be verified (H2: the
  slot is re-read before the swap is reported as failed; the answer is still "not on target", so
  nothing else changes);
- scenarios 50-55 exist only in the new baseline.

The M4 reconcile (`AT+CFUN?` while the radio-down marker is set) is skipped during the hold-off,
so 37 is unchanged.

## Wave-2 review fixes, round 2 (scenarios 56-64)

`baseline/` was re-recorded after the round-2 fixes (hold-off reason, radio marker cleared by a
reachable link, unconfirmed Tier 3 record, persisted revert-pending, unreadable slot read-back).
New scenarios: 56 (a quality hold-off survives one lost probe), 57 (stale radio-down marker
cleared by a reachable link), 58 (startup with an unconfirmed record), 59 and 60 (startup with a
persisted revert-pending, radio on / off), 61-63 (Tier 3 swap whose slot read-back fails: assumed
swapped / adopted on the backup / still on the original), 64 (scenario 55 with the slot
unreadable at the deferral). Every difference to the previous baseline in an existing scenario
is one of these:

- 05, 11, 41, 50, 51, 55: during the Tier 3 cooldown `passes.txt` shows the unconfirmed record
  (`confirmed:false`) and the file lists gain the failover record, where the old baseline showed
  `(none)`. Nothing else changes in 05, 11, 41 and 50;
- 51: the reachable link after the finalize clears the radio-down marker (`radio_down=0` from
  pass 13, a `Link is reachable` log line) and the exit cleanup no longer sends `AT+CFUN=1`;
- 55: the record carries `revert_pending:true` while the daemon waits in radio_off;
- 48: the failed return to the backup leaves the modem on the primary, so it is treated as a
  failback: no failover record, no `AT+QCCID`/known-SIM write, `tower_failover start`, and the
  benign settle (`Entering post-recheck settle`) replaces the old backup settle.

Round 3 (scenarios 65-68) re-recorded the baseline again. New scenarios: 65 (48 with an unreadable
ICCID), 66 and 67 (a maintenance lock over a deferred swap-back, radio still off / back on at the
unlock), 68 (startup with a pending swap-back under a lock). Differences to the round-2 baseline:

- 05, 11, 41, 50, 51, 55, 61, 64: the Tier 3 backup SIM's ICCID is learned right after the CPIN
  check (zero AT), so `known_iccids` exists during the cooldown (new file-list entry in
  `passes.txt`, and its contents in `tree.txt` for 11 and 64, where the lock / radio-off path
  never reaches finalize). Nothing else changes in these;
- 48: the failback now runs the shared failback body: `AT+QCCID`, the primary ICCID in
  `known_iccids`, `auto_apply_profile … watchdog_failback`, and the info event
  `primary SIM kept — the modem stayed on slot 1` replaces the `could not return to backup SIM —
  manual check needed` error event and the earlier error line.

## Config store stub (step 1b)

The adapter reports "store unavailable" (rc 2) for a missing key when `/etc/config/quecmanager`
does not exist, so the harness creates an empty `$root/etc/config/quecmanager` (the `run.sh` sed
rewrite maps `/etc/config/` into the fake root; the file is left out of `tree.txt`). The `uci`
stub keeps `uci.db` as `key=value` lines for options and `key+=item` lines for list items, and
supports `get`, `show <key>` (`key='v'`, or `key='a' 'b'` for a list, embedded quotes as `'\''`),
`set`, `add_list`, `delete` and `revert` (each logged to `calls.log` like `set` and `commit`).
Existing baselines are unchanged.

## R0a: frozen state-file and event contracts (step 1b)

`baseline/` was re-recorded after the state file and the event rows were aligned with
`docs/plans/2026-11-07-cq-watchdog-contracts.md` (sections 3 and 6). No decision changed; every
difference to the previous baseline, in every scenario, is one of these:

- `passes.txt`: the state JSON carries the contract key set (`recovery_reason`, `failure_secs`,
  `step_wait_until`, `holdoff_until`, `holdoff_reason`, `reboot_budget_exhausted`,
  `reboot_rest_reason`, `ssr_hold_until`, `last_ssr_mono`, `quality_breach_secs`,
  `failback_active`, `failback_failures`, `failback_next_at`, `ping_stale`); the retired keys
  `quality_breach_count`, `quality_enabled` and `last_ssr_detected` are gone, and the reason
  vocabulary is `outage|quality` instead of `unreachable|quality`. Every other key keeps its value;
- `tree.txt`: watchdog event rows gain `"code":"..."` after `severity`, and the log line
  `RECOVERY: Executing Tier N (reason=...)` / `Entering primary-recheck settle ... (reason=...)`
  prints `outage` instead of `unreachable`;
- `at.log`, `calls.log`, `console.log`, `exit.code` are byte-identical in all scenarios.
