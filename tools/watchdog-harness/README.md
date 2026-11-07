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
`quimslot_swallow`, `attaching`), `uci_set`, `h_touch`/`h_rm` (files under the fake `/tmp`), `dmesg_crash`,
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
- `state_before_term.json` (28 only): the same state-key change as `passes.txt`;
- `at.log`, `calls.log`, `console.log`, `exit.code` are byte-identical in all scenarios.

## R0b: ping model follows the contract (step 1b)

`h_refresh` now writes the contract `ping.json` key set: `sensitivity`, four `targets`,
`fail_elapsed_sec` (= the modelled outage age `down_secs`, 0 while reachable), `last_family`
`ipv4` (`none` while down) and `last_leg` (1 / 0). The scenario still sets the debounced verdict
(`reachable`) directly. New model key `attaching`: `mset attaching 1` creates
`/tmp/qmanager_ping_attaching` (the ping daemon's attach warm-up flag), `0` removes it; it is
applied on every refresh, also while `ping_stale` is set. No daemon code reads either yet, and
`ping.json` is excluded from the outputs, so the baseline is unchanged.

## R1: time trigger + outage age (step 1b)

The outage trigger is now in seconds: fresh read, `reachable=false` and outage age
`min(fail_elapsed_sec, now - resume_mono) >= max(act_after_sec, fail_secs)`. `resume_mono` is
stamped at the end of the boot settle, when the ping attach flag disappears, on the `radio_off`
and `locked` exits and at the end of every SIM settle; `_radio_streak_base` and `fail_threshold`
are gone. The SSR window is `ssr_grace_sec + act_after_eff + 8 + 2 x 10`, and one SSR identity
holds only once. `inner.sh` seeds `act_after_sec=15` (with the model's `fail_secs` 15 and one
`streak_fail` per 5 s this triggers on the same pass as the old `fail_threshold=3`) and
`ssr_grace_sec=45` instead of `ssr_grace`. Scenarios that set `fail_threshold` use the equivalent
seconds: 19 and 39 `act_after_sec 30` (was 5), 30 `120` (was 20, still never reached), 69 and 70
`40` (was 8 failures after the resume); 69 and 70 print the outage age, resume stamp and
`offline_secs` instead of `streak_base`. Every difference to the R0b baseline is one of these:

- every scenario: the state JSON gains `offline_secs` (raw `fail_elapsed_sec`, 0 while
  reachable) and `failure_secs` carries the outage age; the `Config loaded` line shows
  `act_after=` and the suspect/recovery log lines print seconds instead of the streak;
- 23: the LOCKED exit is a resume point, so Tier 1 runs one pass later (outage age 20 s after
  the exit) instead of on the first pass after it with the streak that grew under the lock;
- 69, 70: the `-- extra` line, and `failure_count` after the radio comes back is the raw
  ping streak (20/22/24/26) instead of the streak discounted at the resume (2/4/6/8), per
  spec; the AT and call sequences are the same as before.

New scenarios: 73 (radio off for 10 minutes, back on with the link down: Tier 1 30 s after the
resume), 74 (LOCKED exit after a 6-minute outage: Tier 1 30 s after the exit), 75 (attach flag
present: outage age 0, trigger only after it disappears), 76 (the same SSR identity holds once:
the second escalation inside the SSR window goes straight to Tier 1).

## R2: per-reason hold-off (step 1b)

An exhausted ladder now pauses only new ladders of its own reason. The outage pause
(`wd_hold_out_until`, 15 minutes) ends on any fresh `reachable=true` read. The quality pause
(`wd_hold_q_until`) lasts 15, 30, then 60 minutes on consecutive quality pauses
(`wd_hold_q_level` 0/1/2, capped at 2); the level drops back to 0 an hour after the last
quality pause ended (`wd_hold_q_end`), and a settings reload ends the pause and resets the
level. A clean quality window ends the quality pause early; reachability never does. The
start gate takes the reason (`wd_start_gate outage|quality`, `wd_holdoff_left <reason>`), so a
quality pause never blocks an outage ladder and vice versa. The state file reports
`state: holdoff` while idle in monitor under any pause, or in suspect under the outage pause;
`holdoff_until` / `holdoff_reason` show the pause that ends last (outage wins a tie); new key
`holdoff_quality_level`; `recovery_reason` is null outside `recovery`, `cooldown` and
`ssr_hold`. The `wd_holdoff` event names the minutes. Every difference to the R1 baseline in
an existing scenario is one of these (`at.log`, `calls.log`, `console.log` and `exit.code`
are byte-identical everywhere):

- every scenario: the state JSON gains `"holdoff_quality_level":0` after `holdoff_reason`
  (also `state_before_term.json` in 28);
- passes in `suspect` (and `monitor` with a tier left over) carry `recovery_reason: null`
  instead of the last reason, since no episode is in progress;
- 06, 34, 37, 38, 40, 50, 52, 53, 56, 57, 63, 71: passes under an active pause show
  `state: holdoff` instead of `monitor` / `suspect`. In 56 the lost-probe pass (suspect under
  a quality pause only) stays `suspect`, because the outage ladder is not paused.

New scenarios: 77 (outage pause, state holdoff, ended by the first reachable read), 78
(consecutive quality pauses 15 -> 30 -> 60 -> 60 minutes while the link stays reachable), 79
(the quality level drops from 2 to 0 an hour after the last quality pause), 80 (a clean
window ends the quality pause early; the next pause within the hour is 30 minutes), 81 (a
settings reload ends a 30 minute quality pause and the next pause is 15 minutes), 82 (a link
drop under a quality pause runs the outage ladder, which succeeds; the quality pause keeps
running), 83 (an outage pause ends when the lossy link returns and the quality ladder runs at
once).

## R1 follow-ups (step 1b)

Validator findings on R1: `finish_cooldown` refreshes the outage fields after its fresh ping
read (`wd_outage_update`); `wd_outage_update` treats an attach flag seen on the last tick as
still present, so the next pass's tick stamps the resume; `wd_outage_clear` (radio_off and
LOCKED entry) also zeroes `offline_secs`; `ssr_grace_sec` is clamped to 10-120. Every
difference to the R2 baseline is in `passes.txt` (and the `-- extra` lines of 69 and 70) and is
one of these:

- 04, 06, 07, 10, 19, 21, 34, 36-38, 41, 50-52, 61, 62, 71, 74, 76, 77, 82, 83: the pass that
  finishes a cooldown shows the fresh `failure_secs` / `offline_secs` (0 after a success, the
  current outage age after a failure) instead of the values from before the cooldown; in 05
  the escalated cooldowns carry the current outage age (52, 85) instead of 20;
- 11, 23, 35, 53, 55, 57, 64, 66, 67, 69, 70, 73: `offline_secs` is 0 while in `radio_off` or
  `locked`, and in a cooldown entered from either, until the next fresh read, instead of the
  last value before entry.

No AT, call, event or log difference; the attach-edge change and the clamp change no output.

## R3: reboot budget and long-run guard (step 1b)

A spent reboot budget no longer disables the watchdog. Budget = `tier4_escalation` rows in the
rolling hour (`max_reboots_per_hour`, clamped 1-10, default 3). When it is spent, Tier 4 rests:
`execute_tier4` returns "skipped", so the ladder ends like a disabled last tier (outage pause per
R2), Tiers 1-3 keep running, and the `wd_budget_spent` event (`reboot limit reached (N per
hour)`) fires once per episode (until the next fresh `reachable=true`). The daemon never writes
`enabled=0`, never creates `/tmp/qmanager_watchcat_disabled` and never retires the service for
this; `wd_retire_service` is left for the config-disabled start and reload paths. Long-run guard
(`wd_ledger.sh`): `$PF_STATE_DIR/wd_reboot_guard` (`<engage epoch>`) is written when the budget
is spent now and in the previous hour (`(now-7200, now-3600)`) with no link-up stamp newer than
the oldest previous-hour row; Tier 4 then rests with `long_outage` until a link-up stamp newer
than the engage epoch, or 24 h. `$PF_STATE_DIR/wd_link_up` is written (durably) on the first
reachable read after a watchdog reboot newer than the stamp, and only then. An insane clock
neither engages nor releases the guard (an engaged file still holds Tier 4) and writes no stamp.
Garbage in either file reads as absent; a garbage guard file is removed. The state file gains
`reboot_limit` and `reboot_rest_until` (mono; `hourly`: when enough rows leave the hour,
`long_outage`: engage + 24 h; epoch to mono via `now_epoch - now_mono`; null when not resting or
the clock is insane) and fills `reboot_budget_exhausted` / `reboot_rest_reason`. `run.sh` also
rewrites the literal `"/etc/qmanager"` (the adapter's `PF_STATE_DIR`) into the fake root, so the
two files appear in the pass file lists and `tree.txt`. Every difference to the R2-follow-up
baseline in an existing scenario is one of these:

- every scenario: the state JSON gains `reboot_limit` after `reboots_this_hour` and
  `reboot_rest_until` after `reboot_rest_reason` (also `state_before_term.json` in 28);
  where the budget is spent (16, 26) `reboot_budget_exhausted` is true and
  `reboot_rest_reason` `hourly`;
- 16: the full budget no longer disables: no `uci set enabled=0` / commit / `watchcat_init
  disable|stop`, no disabled flag, no exit; the `reboot limit reached (3 per hour)` warning
  event replaces `Watchcat disabled: reboot limit exceeded`, Tier 4 is skipped, the 15 minute
  outage pause starts and the daemon runs all 12 passes;
- 16, 17, 24, 25: crash.log holds watchdog rows newer than any link-up stamp, so the first
  reachable read writes `etc/qmanager/wd_link_up` (file list from that pass, `tree.txt`, one
  `Link up after a watchdog reboot` log line); in 25 that happens on the first pass with a
  sane clock;
- 16, 26: one `Tier 4 resting at start (hourly)` log line.

New scenarios: 84 (budget spent: Tiers 1 and 2 run, Tier 4 rests, one event over two ladders of
one episode, never disabled), 85 (the event fires again after a reachable read ends the episode),
86 (rows age out: `reboot_rest_until` = mono 5101, the next ladder reboots), 87 (guard engages at
start, Tier 4 keeps resting with `long_outage` after the hourly window frees up), 88 (seeded guard
released by the first link-up, the spent budget then rests as `hourly`), 89 (a seeded guard file
holds Tier 4 at start with an empty budget), 90 (guard released 24 h after it engaged, then
reboot), 91 (1970 clock: hourly rest with no deadline, no guard, no stamp; once the clock is sane
the guard engages), 92 (the link-up stamp is written once), 93 (garbage guard and link-up files).
Outage pauses in 84-91 are cut to 60 s in `sc_post_source` (`HOLDOFF_OUTAGE_SECS`).
