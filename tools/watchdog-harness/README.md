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
level. A quality-threshold save also raises the watchdog reload flag, so it resets the quality
pause and level like a watchdog save. A clean quality window ends the quality pause early;
reachability never does. The
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
running), 83 (`83_quality_ladder_after_outage_pause_clear`: the reachable read of the lossy
link ends the outage pause and the quality ladder runs at once; an outage pause and a quality
evaluation cannot overlap by construction: a reachable read ends the outage pause).

R2 validator follow-up: `_wd_start_holdoff` runs `wd_holdoff_tick` before it picks the quality
level, so a quality pause that expired after this pass's tick and a new quality ladder exhausted
in the same pass still grows the level instead of resetting it; `wd_holdoff_left` names its
local `hold_end` (not the reserved word `until`); scenario 83 was renamed (was
`83_outage_pause_allows_quality_ladder`).

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

## R4: quality cap and time-based persistence (step 1b)

The quality ladder stops after Tier 2 (spec D5): `find_next_tier` caps at 2 while
`recovery_reason=quality`, so Tier 3 and Tier 4 are never run for a degraded but reachable link,
and `wd_start_gate quality` counts only Tiers 1-2 (`none` when both are off: no ladder, no event).
The trigger runs only in `monitor` with a fresh `reachable=true` and `streak_fail=0`; any other
pass that reaches `evaluate_quality` ends the breach in progress. The window is the last
`clamp(120 / period, 10, 60)` samples since the mark and needs at least 10 (answers and losses);
the limits are the CQ thresholds raised to the floors `max(latency, 50)` ms / `max(loss, 10)` %
(`resolve_quality_thresholds`; a ceiling of 0 no longer means "ignore"). Persistence is on the mono
clock: `quality_breach_since` is the mono second of the first breaching pass, a clean window resets
it, a no-signal window keeps it, and the ladder starts once the breach is `quality_after_sec` old
(config key `quality_after_sec`, default 120, clamp 30-1800; `quality_consecutive` is no longer
read). The timer also keeps running while the gate says `none` or `holdoff`, so a breach that
outlasts a quality pause starts the next ladder when the pause ends. The state file reports
`quality_breach_secs` = mono - since (0 when no breach). The quality cooldown succeeds only when
the read is reachable and the window clean. The R2 clean-window pause clear uses the same
10-sample window. Harness: `inner.sh` seeds `quality_after_sec=30` (was `quality_consecutive=3`);
model key `streak_fail=N` forces the ping `streak_fail` on a reachable link (empty = derived).
Every difference to the R3 baseline in an existing scenario is one of these:

- every scenario: the config log line reads `after=30s (shared thresholds, floors applied)`
  instead of `consecutive=3 (shared thresholds)` (32: `after=1800s`, was `consecutive=10`);
- 08, 20, 31, 56, 82: the first breach is seen at pass 6 (10 samples) and the ladder starts 30 s
  later (T+110 instead of T+70); each quality cooldown extends twice (the 30 s cooldown starts at a
  window mark, so the first read has fewer than 10 samples) before its verdict; 82 moves the link
  drop from pass 9 to 16 and runs 26 passes so the quality pause is in place first;
- 78-81: at a 60 s check interval the ladder starts one pass earlier (60 s after the first
  breach instead of 3 breaching passes); in 81 the post-reload ladder starts on the reload pass,
  because the breach timer ran through the pause;
- 83: the quality ladder after the outage pause clears starts 40 s later; 30 passes;
- 30, 31, 32: the `-- extra` lines name `quality_breach_since` (was `quality_breach_counter`);
  32 now has no signal for passes 1-5 and starts the timer at pass 6; `quality_breach_secs`
  fills where a breach runs;
- 33: `wd_cooldown_verdict quality` with a clean window but `reach=false|null` is `fail`
  (was `success`).

New scenarios: 94 (Tier 3 armed with a slot and Tier 4 enabled: the quality ladder runs Tier 1,
Tier 2, then the 15 minute quality pause; no QUIMSLOT, no reboot), 95 (Tiers 1-2 off: gate `none`,
no AT, no event, the timer keeps counting), 96 (a 90 s breach with `quality_after_sec=120` ends in a
clean window: no ladder), 97 (a clean window resets the timer; the ladder starts 120 s after the
second breach began), 98 (a window mark mid-breach gives five no-signal passes that keep the timer;
Tier 1 starts on the first full window), 99 (CQ custom 30 ms / 5 % reads as limits 50 ms / 10 %;
`streak_fail=1` on a reachable link moves to suspect and blocks the trigger, then the 30 s breach
starts Tier 1).

## R3 follow-ups: a resting Tier 4 is not eligible (step 1b)

Validator findings on R3. Spec 5.3 says gate `none` = no eligible tier for the reason. A resting
Tier 4 (spent budget or long-run guard) no longer counts: `find_next_tier` passes over it (it
logs the rest and fires the hourly `wd_budget_spent` once per episode, `_wd_tier4_rest_note`) and
`wd_start_gate outage` does not count it. Both refresh the rest first (`wd_reboot_rest_eval`)
while it is set, so a rest that just ended is seen on the deciding pass; `execute_tier4` keeps its
own evaluation as a backstop. With Tiers 1-3 off the outage gate is `none` (no event, no pause,
no AT) instead of a "starting recovery (Tier 4)" + 15 minute pause every pause length, and a
failed Tier 3 ends straight in the hold-off instead of announcing "escalating to Tier 4". A guard
file that cannot be written (`_wd_persist` fails) logs one warning, keeps the engage epoch in
memory (`_wd_guard_mem`, this run only) and announces the guard once, instead of re-engaging and
re-announcing on every per-minute recount. `max_reboots_per_hour` strips leading zeros before its
length check (`0000001` is 1, was 10). Every difference to the R4 baseline is one of these:

- 16, 85-91: Tier 4 only (85 now enables Tier 1, see below): while Tier 4 rests no ladder starts
  (no `AT+CFUN?`, no "starting recovery (Tier 4)", "Tier 4 skipped" or pause rows); the hourly
  event and its log lines go with it (16, 86, 88, 91); 86 and 90 run Tier 4 on the same pass
  once the rest ends (90: t+100 instead of t+110); 91 engages the guard on the t+100 refresh;
- 84: the "escalating to Tier 4" and "starting recovery (Tier 4)" rows after a failed Tier 2 are
  gone; the ladder ends in the pause ("All recovery tiers exhausted");
- 85: enables Tier 1 so each outage reaches the resting Tier 4 through the ladder and the
  per-episode `wd_budget_spent` event is still exercised (Tier 1 AT commands and events added).

New scenarios: 100 (engaged guard file plus a newer link-up stamp under a 1970 clock: Tier 4 keeps
resting, no release, no deadline; once the clock is sane the next recount releases the guard and
Tier 4 reboots), 101 (`max_reboots_per_hour` clamp table: 0 -> 1, 99 and 1000 -> 10, garbage or
empty -> 3, `0000001` -> 1, `007` -> 7, `0010` -> 10), 102 (read-only state dir: the guard engages
at start with one "could not be saved" warning and one event, rests for the whole run from memory,
no re-announce), 103 (hourly budget spent, Tier 3 fails and reverts, then straight to the outage
pause with one "reboot limit reached" event and no "escalating to Tier 4").

## R5: effective step wait and inconclusive cooldowns (step 1b)

The cooldown after a tier is now a step wait on the mono clock. Config key `step_wait_sec`
(default 60, clamp 10-300; `cooldown` is no longer read). Effective wait =
`max(step_wait_sec, recover_secs + 20)` with `recover_secs` from the last fresh ping read (10
when unknown); Tier 3 and the SIM settles (revert, failback, primary recheck, LOCKED re-arm)
wait at least 90 s, and a quality cooldown at least `10 x interval_sec + 10` (contract
Amendment 2, interval from the last fresh read, 5 when unknown), so its window holds the 10
samples a verdict needs. The cooldown runs to the deadline `step_wait_until` (state file; null
outside `cooldown`) and `cooldown_remaining = max(0, step_wait_until - mono)`. A verdict without
data extends the deadline by one check interval, at most 3 times; then the verdict is
**inconclusive**: an unconfirmed Tier 3 swap is reverted (the failure path's revert), the daemon
returns to `monitor` and keeps `current_tier`, so the next trigger of the same reason resumes at
the next eligible tier (`wd_ladder_pick`; nothing left, including above Tier 2 for quality, ends
the episode in the hold-off). `current_tier` returns to 0 on success, on natural recovery (a
fresh `reachable=true` with `streak_fail=0` in monitor, suspect or ssr_hold for an outage tier, a
clean quality window for a quality tier), at the hold-off start and whenever an episode is
abandoned (LOCKED, radio_off, user revert, failback, disable). The state file gains
`tiers_tried` (tiers run in the current episode, in order; `[]` when idle). The primary-recheck
verdict read also refreshes `failure_secs` / `offline_secs`. Harness: `inner.sh` seeds
`step_wait_sec=30` (was `cooldown=30`), so outage cooldowns keep their 30 s; model key
`ping_interval` now also sets the history sample rate. Every difference to the R3-follow-up
baseline in an existing scenario is one of these:

- every scenario: the state JSON gains `tiers_tried` after `current_tier`; `step_wait_until`
  carries the deadline during a cooldown; the config line reads `step_wait=30s`;
- 08, 20, 31, 56, 78-83, 94, 97, 99: the quality cooldown waits 60 s (10 samples at 5 s) and
  reaches its verdict without the two extensions R4 needed; the steps after it move 10 s later
  (08 runs 16 passes to show the success);
- 12, 42, 50, 54, 58, 59, 67, 68 and the settle after the unlock in 11 and 15: a settle started
  before the pass's cooldown arm now lasts the full 90 s (the pass count ended it one pass
  early); 15's recheck verdict and its `AT+QCCID` move one pass later;
- 11, 15: LOCKED entry clears the abandoned cooldown (`cooldown_remaining` 0, was the stale
  value);
- 09, 39: the SSR-hold natural recovery resets `current_tier` (was left at the picked tier);
- 14, 48, 65: `offline_secs` carries the primary-recheck read during the backup settle;
- 21: the stale cooldown is inconclusive (monitor, Tier 1 kept) instead of escalating to Tier 2;
- 29: malformed `step_wait_until` / `tiers_tried` globals still give valid JSON;
- 33: `wd_cooldown_verdict` prints `inconclusive` (was `fail`) for no data after 3 retries;
- 76: with the 30 s minimum step wait a Tier 1 cooldown cannot end before the second drop, so
  the first outage now ends by itself during the hold; the second escalation still goes
  straight to Tier 1 without a second hold.

New scenarios: 104 (`step_wait_sec 10` below the floor: 30 s wait, deadline and remaining per
pass), 105 (`step_wait_sec 60`: Tier 1 waits 60 s, Tier 3 holds 90 s), 106 (stale cooldown x3 ->
inconclusive keeps Tier 1, next trigger runs Tier 2, success clears `tiers_tried` [1 2]), 107
(quality no-data inconclusive keeps Tier 1, next quality trigger runs Tier 2, then the quality
pause), 108 (inconclusive Tier 3 reverts the unconfirmed swap and the next trigger reboots at
Tier 4), 109 (quiet ping, interval 10: the quality cooldown waits 110 s and succeeds without an
extension), 110 (inconclusive then a reachable read clears the kept tier; the next outage starts
at Tier 1), 111 (Tier 1 off: an inconclusive quality Tier 2 leaves no tier under the cap, so the
next trigger goes straight to the quality pause).

## R4/R3 validator follow-ups after R5 (step 1b)

Quality timer: `evaluate_quality` clears `quality_breach_since` when quality is disabled, so a
disable then re-enable starts a fresh breach and `quality_breach_secs` does not grow while it is
off. The breach logs one WARN when the timer starts (`QUALITY: breach started ...`) and one when
it fires (`QUALITY → RECOVERY`); `quality_breached` and the per-pass `breach for Ns/Ms` line are
debug now. An all-lost window prints `avg n/a` (log and event) instead of `nullms`.
`quality_after_sec` and `step_wait_sec` strip leading zeros before the length and clamp checks.
Link-up stamp: when `$PF_STATE_DIR/wd_link_up` cannot be written the stamp is kept in memory
(`_wd_link_up_mem`, this run only) with one warning, so the per-minute recount no longer makes
every reachable read retry and re-log the write. Every difference to the R5 baseline is one of
these:

- quality scenarios (08, 20, 31, 32, 56, 78-83, 94-99, 107, 109, 111): the per-pass
  `QUALITY breach:` WARN and `QUALITY: breach for` INFO lines are gone (debug), and one
  `QUALITY: breach started` WARN marks each new breach.

New scenarios: 112 (read-only state dir: one link-up stamp attempt and warning, kept in memory
across recounts and a later outage), 113 (quality disabled mid-breach clears the timer; re-enabled,
a fresh breach starts; `quality_after_sec 0060` reads as 60; all-lost window logs `avg n/a`).

## R6: dead prober (step 1b)

A stale episode starts at the first stale or missing ping read (`read_ping`, any caller) and ends
at the first fresh one (`wd_stale_clear`: `ping_stale` back to false, one INFO line if it was
raised). Only the main loop's stale branch acts on it (`wd_ping_stale_tick`, `wd_detect.sh`): once
the episode is older than 300 s on the mono clock the state file's `ping_stale` turns true, one
`wd_ping_stale` warning event is logged per episode ("Watchcat: connection probe not reporting,
restarting it") and the ping service named by the adapter (`PF_PING_SVC`; RM551E `qmanager`,
whose procd `start` only starts the instances that are not running) gets one `svc_start`, at most
once per 900 s. The spacing is measured from the last start and spans episodes. No recovery
decision is made on stale data. Harness: `run.sh` stages an `/etc/init.d/qmanager` stub that logs
`qmanager_init <args>` to `calls.log`. No existing scenario changed (no baseline scenario stays
stale for 300 s).

New scenarios: 114 (stale about 190 s, then fresh: no event, no start), 115 (stale from pass 3:
`ping_stale` true, one event and one start at pass 34), 116 (stale 30 min: starts at pass 34 and
124, one event), 117 (fresh read clears; the second episode logs a second event at pass 77 and
its start waits for the 900 s spacing, pass 124), 118 (link down, then stale: the dead prober
fires but no tier runs, state stays suspect), 119 (ping cache file missing counts as stale).

## R5 validator follow-ups after R6 (step 1b)

Numbers read from the ping cache and config (`recover_secs`, `interval_sec`, `step_wait_sec`) go
through `_wd_dec` (`wd_detect.sh`), which strips leading zeros so ash arithmetic never reads `08`
as a bad octal; a ping interval outside 1-60 s reads as the 5 s default. An unreadable mono clock
(`mono_now` prints 0) no longer sets a deadline: `wd_step_wait_start` stores `step_wait_until 0`
and `wd_step_wait_due` counts passes whenever the clock or the deadline is 0, so a cooldown still
ends. Turning quality off clears a quality tier kept by an inconclusive cooldown (`current_tier`
and `tiers_tried`) instead of leaving it to resume later. Harness: model key `uptime_bad 1` makes
`/proc/uptime` unreadable. No existing scenario changed.

New scenarios: 120 (clock turns unreadable after the Tier 1 action: Tier 1 and Tier 2 cooldowns
end by pass count and the link comes back), 121 (quality cooldown without data ends inconclusive
and keeps Tier 1; disabling quality clears it at once).

## R9a: LOCKED union (step 1b)

`check_locked` (`wd_state.sh`) now also locks on a live config-restore PID (`PF_RESTORE_PID`, the
same `kill -0` test as the profile-apply PID, shared in `_wd_pid_live`, which ignores an empty or
non-numeric file) and on a manual SIM switch (`_wd_manual_switch`): the adapter's
`plat_manual_sim_switch` (trusted `PF_SIM_SWITCH_FLAG`) is up and this daemon is not the holder.
Tier 3's own swap raises the same flag with `WD_SWAP_FLAG_OWNED=1` and is never counted. A flag left
behind by a holder that was killed outright locks for at most `WD_SIM_SWITCH_MAX_LOCK` (120 s) from
first sight on the mono clock, then one warning ("treating it as stale") and the daemon carries on
while the file is still there; the timer resets once the flag is gone. An unreadable clock does not
count the flag. LOCKED entry and exit are unchanged (resume mark, `wd_sim_on_unlock`). Harness: no
new model keys; scenarios write `var/run/qmanager_config_restore.pid` and use
`h_touch qmanager_sim_switch_active`. No existing scenario changed.

New scenarios: 122 (live restore PID locks passes 2-7; the exit restarts the outage age, Tier 1
two passes later), 123 (dead restore PID, then garbage content: not locked, Tier 1 runs), 124
(manual switch flag locks passes 2-5, then Tier 1), 125 (stale flag: locked for 120 s, one
warning, Tier 1 with the file still present; a later fresh flag locks again), 126 (own Tier 3
swap: `check_locked` asked mid-swap with the flag up answers rc 1, no LOCKED entry).

## R9c: Tier 3 skip reasons, failback give-up, retry flag (step 1b)

Tier 3 skips log one `TIER 3 SKIPPED: <reason>` line each and the ladder moves on at once:
no backup slot configured, a failover already active (new explicit check, before the slot read),
the current slot unreadable, the modem already on the backup slot, and a quality ladder
(`find_next_tier` logs it when the ladder ends at Tier 2 with Tier 3 enabled; the check itself
was there since R4). The only Tier 3 skip event stays `sim_swap` ("swap did not take effect").

Failback: the daemon reads `failback_enabled` and `failback_every_min` (5-1440 min, default 30;
`WD_FAILBACK_EVERY_MIN_LO/HI` hold the bounds) instead of `primary_recheck_enabled` /
`primary_recheck_interval`. A try that ends on the backup slot (primary still unhealthy, swap
not verified, return not proven) is a failed try: `failback_failures` + 1, one INFO line. The
third in a row stops the tries: one `sim_failback_giveup` event (warning), state
`failback_failures 3`, `failback_next_at null`, no more `initiate_primary_recheck`. A failback,
a user revert or a new Tier 3 failover resets the count to 0. A settings reload clears the
give-up and re-arms the clock one full interval later; a daemon start begins at 0 (in memory
only). The retry flag (`PF_FAILBACK_RETRY_FLAG`, adapter, `qm_trusted_file` like the revert
flag) is consumed on the next pass: with a failover active and failback enabled it sets
`failback_failures 0` and makes a try due at once (`failback_next_at` shows the request time),
otherwise it is only removed. `failback_next_at` is the mono of the next try (last arm + every
minutes), null when disabled, no failover or given up.

Harness: `inner.sh` lowers `WD_FAILBACK_EVERY_MIN_LO` to 1 so the existing scenarios keep their
one-minute cadence; 137 and 138 restore 5 in `sc_post_source` to test the clamp. The retry flag
is `h_touch qmanager_watchcat_retry_failback`. Every difference to the R9a baseline is one of
these:

- all scenarios: the config log line `Primary-recheck (auto-failback): enabled=E interval=Nmin`
  is now `Failback: enabled=E every=Nmin`.
- 14 (primary stays down): two INFO lines `failed try 1 of 3` / `2 of 3` and
  `failback_failures` 1 then 2 in the state file.
- 47 (swap swallowed): its 20 passes now hold three failed tries, so the third logs the give-up
  line and event and the state shows `failback_failures 3`, `failback_next_at null`.
- 94 (quality ladder stops at Tier 2, Tier 3 armed): one new WARN `TIER 3 SKIPPED: recovery
  reason is quality`.

New scenarios: 127 (no backup slot), 128 (slot unreadable), 129 (already on the backup slot),
130 (failover active, backup differs from the live slot), 131 (quality ladder skips an enabled
Tier 3), 132 (three failed tries, one give-up event, no fourth swap-back), 133 (reload clears the
give-up; the next try is a full interval later), 134 (retry flag: count 0, try at once), 135
(retry flag with no failover or failback off: only removed), 136 (two failures, then success:
count back to 0), 137 (a configured 2 min reads as 5), 138 (99999 -> 1440, 0045 -> 45, abc -> 30,
7, 0 -> 5), 139 (the retired `primary_recheck_*` keys are not read).
