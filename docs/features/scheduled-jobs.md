# Scheduled Jobs and the Clock-Step Guard (issue #9)

QManager's scheduled actions are BusyBox `crond` jobs in the single root crontab (`/etc/crontabs/root`). Each one is a marked line written by its CGI:

| Job | Worker | Written by | Schedule source the guard reads |
|---|---|---|---|
| Scheduled reboot | `qmanager_scheduled_reboot` | `system/settings.sh` | UCI `quecmanager.settings.sched_reboot_time` / `sched_reboot_days` |
| Tower lock apply / clear | `qmanager_tower_schedule apply\|clear` | `tower/schedule.sh` | `/etc/qmanager/tower_lock.json` `.schedule.start_time` / `.end_time` / `.days` |
| Scenario transitions | `qmanager_scenario_schedule <id>` | `scenario_mgr.sh` | none (a multi-block timeline; clock + uptime only) |
| Auto-update | `qmanager_auto_update` | `system/update.sh` | UCI `quecmanager.update.auto_update_time` |

**Idempotent writes.** Every writer reads `crontab -l`, drops its own lines, then appends its block, so a re-save never duplicates. The `# QManager … — DO NOT EDIT MANUALLY` header carries no marker, so a writer that has one must strip it by its `^# QManager <Job>` prefix as well as the marker. Before 2026-10-19 `settings.sh` (reboot) and `tower/schedule.sh` stripped only the marker and stacked a header per save; `scenario_mgr.sh` already stripped its header, and `update.sh` writes no header. Nothing else writes job lines: `install.sh` only strips retired Low Power lines (`retire_low_power`, `install.sh:877–910`), the update path (`system/update.sh`) writes just the auto-update line, and `uninstall.sh` removes every `qmanager` line. As a backstop, `qmanager_scheduled_reboot` claims the minute with an atomic `mkdir $(qm_run_dir)/sched_reboot.<YYYYmmddHHMM>`; a second copy started in the same minute exits.

## Why a guard is needed

The RM551E has no RTC that keeps real time. The PMIC RTC (`rtc-pm8xxx`) counts from its own reset, so the kernel boots at 1970. Then `sysfixtime` sets the clock to the newest file mtime under `/etc`, which is often minutes or days stale. `time_daemon` (NITZ, after SIM registration) or `sysntpd` step it to real time later, at an unbounded moment. crond starts at ~35 s uptime.

On each wake, BusyBox crond compares the clock with its last wake. On a forward jump of up to 60 minutes, it runs **every job whose minute was crossed**. A jump over 60 minutes is logged as "time disparity" and runs nothing. So a boot whose stale clock reads just before a scheduled minute, and whose step lands just after it, fires that job. For the scheduled reboot this can loop, because each reboot lands the clock back before the minute. This is the RM551E form of the RM520N's issue #9 (there, systemd `OnCalendar` timers misfired on the step; source commits `96cc4e1e`, `25599f24`, `14b07359`).

## The guard (`scripts/usr/lib/qmanager/schedule_guard.sh`)

`_qm_timer_fire_allowed <HH:MM-or-empty> [days_csv]` allows a fire only if all of these hold:

1. **Clock sane:** the year is 2025 or later.
2. **Boot settled:** uptime is at least `QM_TIMER_SETTLE_SECS` (300 s). A clock step cannot move `/proc/uptime`, so this leg is required, never an escape.
3. **Day mask:** when one is given, today (`date +%w`) is in it.
4. **Minute match:** when a schedule minute is given, now is within `QM_SCHED_TOLERANCE_MIN` (2 min) of it, wrapping midnight. crond fires on the exact minute; the RM520N source uses 10 min for systemd timer accuracy.

On deny it sets `QM_GUARD_REASON`. The worker logs a warning and exits 0: a clean skip, never a failure. Every helper fails closed on an unparsable operand. HH:MM is converted with `awk`, never `$(( ))`, because zero-padded fields are octal in ash.

Rules for each worker:

- A worker that has a schedule time but cannot read it denies itself with `_qm_validate_hhmm` before calling the guard. An empty schedule passes the minute leg on purpose; that is for the scenario worker only.
- If the library is missing, every worker fails closed (skips), except `qmanager_scheduled_reboot`. It falls back to an inline uptime check: it reboots only past 300 s of uptime, and an unreadable uptime counts as 0.
- The scenario worker's deny is a plain skip. It must not fall through to the self-heal teardown, which is for a deactivated profile.
- Skips are not written to `/etc/qmanager/crash.log`. The watchdog's token bucket already counts only `tier4_escalation` rows.

Test hooks (for replay on the device, never in production): `QM_TIMER_GUARD_BYPASS=1`, `QM_TEST_YEAR`, `QM_TEST_UPTIME`, `QM_TEST_NOW_HHMM`, `QM_TEST_DOW`.

Replay verified on the RM551E (2026-10-16), live library sourced: a 04:00 job re-entering at uptime 26 s, a late step to 04:05 or 15:20, a 1970 clock, an off-mask day, and garbage uptime/year all DENY. A settled fire at 04:00, 04:01, 04:02, 23:59 against 00:00, and 08:09 all ALLOW.

## Related: the watchdog's auto-failback clock

`qmanager_watchcat` times the auto-failback primary recheck (`last_recheck_time`) with `mono_now` (seconds since boot), not epoch. A boot-time clock step can no longer make a recheck, which is a real outage, due at once after a resume from `/tmp/qmanager_sim_failover`.

## Retired: Low Power Mode

The scheduled CFUN=0 radio-off window (`qmanager_low_power` enter/exit cron jobs, the boot-time `qmanager_low_power_check` + its init.d script, `/tmp/qmanager_low_power_active`, UCI `quecmanager.settings.low_power_{enabled,start,end,days}`, the `system/settings.sh` `low_power` object and `save_low_power` action) was **removed on 2026-10-20**. **Why:** the modem already idles itself under low traffic, so a forced radio-off window added a CFUN risk for no saving. The event and alert suppression gates that depended on the flag (`events.sh`, `alert_engine.sh`) went with it.

Upgrade-cleanup contract: `scripts/install.sh` defines `retire_low_power()`, called unconditionally on fresh install and on Software Update (like `retire_bandwidth_monitor()`, see [`bandwidth-monitor.md`](bandwidth-monitor.md)). In order:

1. If `/tmp/qmanager_low_power_active` exists, the device is mid-window with the radio off: restore it with `AT+CFUN=1`, then clear the flag and the watchcat lock.
2. Disable and remove the `qmanager_low_power_check` init.d script and its rc.d links, and delete `/usr/bin/qmanager_low_power` and `/usr/bin/qmanager_low_power_check`.
3. Strip the `qmanager_low_power` lines (and their header) from the root crontab.
4. Delete the four `quecmanager.settings.low_power_*` UCI keys and commit.

It is idempotent and silent when nothing is left. `uninstall.sh` still removes the old `/tmp` flag.

## Scenario catch-up fires (ledger B5.2)

The scenario worker has no single HH:MM, so the guard cannot match its minute. A forward clock step after the 300 s uptime floor made crond run every crossed transition, oldest first, and the last one to finish won. The worker now resolves the timeline for now (`scenario_block_for_now`) and applies only when that equals its target. Of the crossed fires, only the current block's own transition matches, and an on-time fire always does. A skipped fire logs a warning naming both scenarios. A block that names a deleted scenario cannot be compared, so the worker's `balanced` fallback decides.
