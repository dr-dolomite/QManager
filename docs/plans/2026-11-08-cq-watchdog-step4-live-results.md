# CQ x Watchdog Step 4 live results (RM551E)

Start 2026-11-08 16:01 device time; boot_id 3d65720a-34ed-49a9-844f-ad7806aba478, uptime 7:16, v0.1.36-draft.
Device test dir: /root/cqwdtest (cgi.sh helper, tarballs, captures).

## Pre-captures (old install)
- Config Backup (old): /root/cqwdtest/old_backup.json + old_payload.json (sections quality_thresholds, watchdog, metrics, sites) via collect.sh 200.
- Prometheus old scrape: /root/cqwdtest/prom_old.txt (142 lines, 43 TYPE families); metrics.enabled toggled 1 -> scrape -> back to 0.
- Tarballs on device: qm_feature.tar.gz sha256 0968878c...501de OK; qm_v0135.tar.gz sha256 4eb567af... matches GitHub digest.

## 1. Install over old (migration) — PASS
- 16:04 `sh install.sh --no-reboot` from extracted feature tarball (log /root/cqwdtest/install1.log), no warn/err lines.
- Migrated: profile=quiet -> sensitivity=quiet; targets 8.8.8.8/2606:: -> [8.8.8.8,1.1.1.1,2606:4700:4700::1111,cloudflare.com]; fail_threshold=5 x10s -> act_after_sec=50; quality_consecutive=5 x10 -> quality_after_sec=50; cooldown->step_wait_sec=60; ssr_grace_sec=45; failback_every_min=30, failback_enabled=0; carrier 0/15 seeded. Thresholds 800/20 untouched. Old keys all still present.
- Rerun cqm_migrate_uci: CHANGED=0, uci export md5 22551ba3... identical before/after.
- interval_override=3 planted -> rerun removed it ("Removed dropped ping_profile.interval_override=3 (sensitivity quiet kept)"), act_after unchanged 50, md5 back to 22551ba3.
- Reboot 3d65720a -> 7be1e4c7 (16:07). ping, poller, atd, sites running; watchcat init disabled + not running (enabled=0 respected). No errors in qmanager.log/logread. ping.json 16 keys, sensitivity quiet interval 10 fail 40 recover 20.
## 2. CGIs under uhttpd — PASS
- Auth: throwaway session file /tmp/qmanager_sessions/<tok> + Cookie qm_session (helper /root/cqwdtest/cgi.sh, removes session; sessions dir empty after).
- GET CQ: settings quiet/4 targets/custom 800/20, cadence 10/40/20/600, tables, live slots (ok/standby/skipped(no IPv6 route)/standby), last_outage null. GET WD: migrated values, effective act 50/step 60/limits 800/20, sim_dual_capable true.
- 13 invalid CQ bodies + 16 invalid WD bodies -> invalid_field with right field (sensitivity, targets[1..2], targets, latency.custom_ms, loss.custom_pct, latency.preset, act_after_sec 14/601/"30", enabled "true"/1, tier3 w/o slot, tier3+slot null -> tier3_enabled, fail_threshold/check_interval unknown, slot 3, ...), missing_action, unknown_action, invalid_json; PUT -> method_not_allowed; 8335-byte body -> payload_too_large on both. uci export md5 unchanged (22551ba3) after all.
- Valid: save_probe relaxed -> /tmp/qmanager_ping_reload consumed <12 s, ping PID 13814 unchanged, log "Reloaded config: sensitivity=relaxed interval=5s fail=20s", ping.json interval 5. save_thresholds -> quality+watchcat reload flags; carrier_enabled:true -> stored '1' + /tmp/qmanager_poller_reload, consumed by poller (PID 13815 unchanged); set back false -> '0'.
- revert_sim/retry_failback/dismiss_sim_swap -> success; flags root:root 0644 regular files (uhttpd runs as root). Flags removed afterwards.
- jq paths: CQ GET live (all(.slots[];...)) and save_probe/WD (@tsv) ran without error; device `jq --version` prints "jq-" (build string), no logread jq errors.
## 3. status.json republish — PASS (SA cadence NOT TESTABLE)
- .watchcat has all 9 new keys (recovery_reason, step_wait_until, holdoff_until, holdoff_reason, reboot_budget_exhausted, ssr_hold_until, failback_next_at, ping_stale, mono) + 11 old. watchcat.json at 16:12:30 start: last_recovery_reason null, last_recovery_time null.
- connectivity: sensitivity quiet, last_leg 1, fail_secs 40, recover_secs 20, profile=quiet, history_size<=60.
- carrier_enabled=1 (temp): ca.env written (ca_mono 284 vs uptime 298 -> 14 s), ca_source qmi, ca_rat lte, ca_lte_cc 1.
- SA QCAINFO ~1/min: NOT live-testable — device camps LTE only (mode_pref AUTO, B28 1CC, QENG LTE FDD); no SA coverage. QCAINFO count in log = 0 (expected on LTE/QMI path).

## 4. Down-after per sensitivity, both modes (watchdog enabled, act_after 600 for timing) — PASS
fail_elapsed_sec at the reachable=false flip (spec floor 8/12/20/40):
| sens | blackhole 192.0.2.1 | EPERM nft (table inet cqwdtest, icmp echo-request drop, 600 s failsafe) |
| sensitive | fe 8 (cyc 4.5 s) | fe 11 (cyc 4.5 s) |
| regular | fe 13 | fe 12 (cyc 2.0 s) |
| relaxed | fe 24 | fe 20 |
| quiet | fe 44 | fe 40 |
Up after recover_secs: 3-8 s / 7-11 s / 11-15 s / 25-30 s. Logs /root/cqwdtest/da_bh.txt, da_ep.txt. nft table gone after (nft list tables: only fw4/legacy).
Ladder (quiet, act_after 15 -> effective 40, step_wait 10 -> effective 40), blackhole at 16:22:45:
- 16:23:31 reachable=false (fe 44); 16:23:36 SUSPECT->RECOVERY "outage age 44s >= 40s", Tier 1 COPS=2/0; cooldown 40 s; 16:24:24 escalate Tier 2 CFUN 0/1 ("Modem responsive after 0s"); cooldown 40 s; 16:25:18 exhausted -> holdoff outage, holdoff_until 2017 = mono 1117+900.
- Events with codes: wd_tier_start x4, wd_escalate, wd_holdoff ("pausing 15 minutes").
- Targets restored 16:26:3x -> reachable true 16:26:47 -> holdoff cleared, state monitor 16:26:50 (clears early on reachable).
## 5. Airplane / LOCKED exit after long outage, band locks — PASS
- Airplane: blackhole 16:27:30, AT+CFUN=0 16:27:36 -> state radio_off 16:28:20 (event wd_radio_paused), CFUN=1 16:29:37 ("Radio is back on" 16:29:41, outage fe=120). Tier 1 only at 16:30:22 "outage age 40s >= 40s" = 41 s after resume (no immediate Tier 1). Ladder then T2 -> holdoff, cleared on restore.
- LOCKED: touch /tmp/qmanager_watchcat.lock + blackhole 16:32:20 -> state locked throughout; unlock 16:34:20 (fe ~140) -> Tier 1 at 16:35:02 = 42 s after unlock.
- Band locks (AT+QNWPREFCFG lte_band/nsa_nr5g_band(13:41:78)/nr5g_band(41:78)/nrdc_nr5g_band) identical before and after both Tier 2 CFUN 0/1 (cmp bands_before.txt bands_after_t2*.txt).
- Observation (not a fail, spec-conformant): with quiet (recover 20 s) and step_wait effective 40 s, the Tier 1 cooldown in the LOCKED run ended 16:35:45 with 2 successful cycles (sf=0, from 16:35:30) but reachable still false -> escalated to Tier 2 though the link was recovering. Then Tier 2 verdict success 16:36:30 (last_success_tier 2, took_s 88). A cooldown that ends during_recovery/streak_success>0 might deserve one extension.
## 13. Prometheus scrape diff — PASS
- Old (v0.1.36-draft pre-feature, 16:02) vs new (16:40): 43 `# TYPE` lines byte-identical (cmp), 43 metric names identical; watchdog HELP/TYPE lines md5 f7013815... both. New values: qmanager_watchdog_enabled 1, _failure_count 0, _recoveries 8. metrics.enabled toggled 1->scrape->0 each time, metrics_scrape removed.
## 14. System Health Check — PASS
- run.sh job 20261108-084004-7f2e: pass 46, fail 0, warn 0, skip 4 (tailscale bin/svc, tower_failover, sms_forward). svc.ping, svc.watchcat, svc.poller, net.reachable, cfg.ping_fresh pass; svc.thermal present + pass.
## 6. Quality ladder exhausted while reachable — PASS
- Setup 16:37:10: sensitivity sensitive, latency custom 1 ms (floor 50), loss 20, quality_enabled true, quality_after_sec 30. Link reachable throughout (RTT 60-380 ms, real loss 21-57 % at 1 s cadence).
- 16:37:21 breach started; 16:37:51 QUALITY -> RECOVERY (breach 31 s), Tier 1; cooldown 23 s; Tier 2 16:38:25; 16:39:00 exhausted -> holdoff quality, holdoff_until 2838 (= mono 1938 + 900), event "pausing 15 minutes" (wd_holdoff). Tiers 3/4 never attempted.
- Hold-off persisted while the breach continued (breach logged again 16:39:10, no ladder) until mono 2838; 16:54:01 ladder again T1 -> T2 -> 16:55:10 holdoff quality hu 4708 (= 2908 + 1800), holdoff_quality_level 1, event "pausing 30 minutes". Grows 15 -> 30 confirmed.
- Threshold save 16:56 cleared the quality hold-off and reset level to 0 (spec: settings save clears). Restored quiet + quality_enabled false for the next tests.
## 7. Reboot budget — PASS for budget; FAIL (finding) for long-run guard input
- Settings tier4 on, max_reboots_per_hour 1, blackhole targets in UCI 16:57:21 (boot_id 7be1e4c7). T1 16:58:2x, T2 16:59:06, Tier 4 -> crash.log `1794128393|reboot|tier4_escalation`; new boot_id 9dba0994 at 17:00 (uptime 0).
- After boot: "Reboots in last hour: 1", "Tier 4 resting at start (hourly)"; boot settle 30 s; "Ping attach warm-up over: outage age restarts now" 17:03:03; T1 17:03:43 (age 41 s), T2 17:04:26, 17:05:11 "TIER 4: Reboot limit reached (1/1 per hour), Tier 4 rests" + event wd_budget_spent "reboot limit reached (1 per hour), reboots paused" -> holdoff outage. State: reboot_budget_exhausted true, reboot_rest_reason hourly, reboot_rest_until 3580. No second reboot (boot_id stayed 9dba0994 through the end of the item).
- Alerts: poller "Alert engine: reboot detected (cause=watchdog boot_id=9dba0994...)"; monitoring/alerts.sh reboots[0] {epoch 1794128393, cause watchdog}; watchdog GET recent_reboots [1794128393].
- FINDING (long-run guard defeated): at 17:01:32 wd_ledger logged "Link up after a watchdog reboot, link-up stamp written" and /etc/qmanager/wd_link_up = 1794128492 (17:01:32), while all targets were 192.0.2.1 (same second: "MONITOR -> SUSPECT: streak_fail=4"). Cause: qmanager_watchcat:407 calls wd_link_up_seen on any fresh ping_reachable=true, and qmanager_ping starts with reachable=true (spec 4.3 initial) until fail_secs of failures. Every boot therefore stamps a fake link-up, ends the budget episode (_wd_budget_ev=0) and releases an engaged guard (wd_ledger.sh:286-291), so the §5.6 "two consecutive hours with no reachable=true" guard can never engage on a dead-coverage night. Suggest requiring a real answer (streak_success>0 / last_leg>0) or a verdict edge seen by this daemon.
- The 2 h guard itself not observed (time-based).
- Restored: tier4 off, max 3, act_after 50, step_wait 60, good targets; holdoff cleared on reachable.
## 9. Config Backup — PASS
- Old->new: new keys pre-set to act 200/step 100/quality_after 300/ssr_grace_sec 60/failback 90; POST apply.sh old_payload.json (old v0.1.36-draft backup: quality_thresholds, watchdog with fail_threshold/cooldown/quality_consecutive/ssr_grace/primary_recheck_*, metrics, sites) -> job done 4/4 success; quality_thresholds normalized to connection_quality; translated act_after_sec 50 (5 x quiet 10 s), step_wait_sec 60, quality_after_sec 50, ssr_grace_sec 45, failback 0/30, enabled 0 -> watchcat stopped + init disabled; old keys still present; sensitivity/targets/800-20 kept.
- New backup (connection_quality, watchdog, metrics, sites) restored on new: 4/4 success, uci md5 unchanged 22551ba3.
- New backup on v0.1.35 (after rollback install, before reboot): `{"error":"unknown_section","key":"connection_quality"}`, uci md5 unchanged.
## 10. Rollback to v0.1.35 and back — PASS
- 17:07:57 v0.1.35 `install.sh --no-reboot` over feature: "already set — preserving user choice" for profile/target_ipv4/target_ipv6/fail_threshold/... ; uci md5 unchanged 22551ba3; reboot 9dba0994 -> 20c6ea2e (17:10).
- v0.1.35 ping daemon: "Profile: quiet", "Targets: v4=8.8.8.8 v6=2606:4700:4700::1111" (old keys), fail_secs 30/recover 20 (its own table); ping, poller, sites, atd running; watchcat disabled (enabled=0); link reachable after attach.
- Reinstall feature via OTA (item 12): migration no-op, uci md5 22551ba3 unchanged; ping.json sensitivity quiet, 4 targets.
## 12. Tarball OTA (staged path) — PASS
- On v0.1.35: staged /var/run/qmanager/update/staged.tar.gz (sha 0968878c...) + staged_version v0.1.36-draft; status idle; POST system/update.sh install_staged -> {"success":true,"status":"starting"} 17:13:13; device rebooted 20c6ea2e -> ce424bdb (17:14:45).
- After: VERSION v0.1.36-draft, no VERSION.pending, updates/previous_version v0.1.35; atd/ping/poller/sites running; watchcat disabled per enabled=0; reachable true. (Download-from-GitHub leg not exercised: feature not released.)
## 11. ipk — PASS (tarball->package switch + postinst migration); package->package upgrade NOT TESTABLE
- Built `bun run ipk` from the feature tarball: sdxpinn-qmanager_0.1.36-draft_sdxpinn.ipk sha256 349e6079..., check_ipk "all structural checks passed"; manifest lists the new cqwd libs.
- Feed has no sdxpinn-qmanager (only sdxpinn-quecmanager 2.3.4/-beta 2.3.9) -> no older package to upgrade from; package->package `opkg upgrade` not testable.
- To exercise the postinst migration, deleted the new keys (watchcat act_after/quality_after/step_wait/ssr_grace_sec/failback_*/carrier_*, ping_profile sensitivity/targets) leaving the old ones; `opkg install ./ipk` over the tarball install rc=0; postinst logged the same Migrated/Seeded lines as item 1; resulting `uci show | sort` byte-identical to before the deletion (export md5 22551ba3).
- Managed: .control present, /tmp/qmanager_pending_reboot_package raised, watchcat lock released, update.sh GET managed_by opkg, `sh /usr/share/qmanager/install.sh` refused rc=1 with the opkg hint. Reboot ce424bdb -> d0032f27: atd/ping/poller/sites running, index.html QManager + index.html.old.
- Switch back (documented): `opkg remove sdxpinn-qmanager` rc=0, no /usr/bin/qmanager_*, UCI md5 kept 22551ba3; feature tarball `install.sh --no-reboot` 17:21:54 (no migration lines: idempotent), reboot -> d5286aaf (17:25).
- Note: `reboot` right after an install takes >5-60 s to act (looked like a no-op twice); not a QManager issue.
## 8. SSR — NOT OBSERVED (no remoteproc-mss fatal in dmesg, no ssr_hold state in any monitor log)
## Tier 3 / failback — NOT LIVE-TESTABLE (AT+QUIMSLOT: 1; slot 2 can't be probed read-only; per spec §10 harness-only)
## End state (17:26, boot_id d5286aaf-c0d3-4886-acb8-20cf59ad3996)
- Feature tarball v0.1.36-draft installed (no opkg package); atd/ping/poller/sites running; watchcat disabled+stopped (enabled=0); ping quiet, reachable, leg 1.
- UCI vs /root/cqwd-pre/quecmanager.uci: only additions = the migrated new keys (carrier 0/15, act 50, quality_after 50, step_wait 60, ssr_grace_sec 45, failback 30/0, sensitivity quiet, 4 targets). All original values intact (thresholds 800/20, tier3/4 off, max 3, quality_enabled 1, metrics 0).
- Removed: /root/cqwdtest, nft table, sessions, reload/revert/retry flags, maintenance lock, /tmp test files.
- Left (device state): /etc/qmanager/wd_link_up (17:01, fake stamp from the finding), crash.log rows (tier4_escalation 1794128393 + unplanned rows from my reboots), /etc/qmanager/updates/previous_version = v0.1.35 (from the OTA), events of the session.
