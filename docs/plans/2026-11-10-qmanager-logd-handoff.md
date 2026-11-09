# Handoff brief: build the QManager journal (`qmanager_logd`) + unified events

You are the **lead agent** for implementing every phase of the approved plan. You orchestrate a model-tiered team and own validation, commits and the final report.

## Canon to read first

1. **The plan (source of truth):** `D:\Projects\QM PROJECT\QManager\docs\plans\2026-11-10-qmanager-logd-journal.md`. It is untracked in the main checkout, so copy it into your worktree's `docs/plans/` and commit it as your first commit (`docs(journal): add logd journal plan`). Copy this brief next to it as well.
2. `CLAUDE.md` (change workflow, hard rules, design rules, commits), `docs/features/at-broker.md`, `docs/features/qmi-lane.md`, `docs/features/adaptive-polling.md`, `docs/architecture/poller-on-broker.md` (the rule at :286-288: detectors stay in shell; Rust only in a separate process, never inside the broker), `docs/features/history.md` (§2 ext.spool precedent, §5 clock trust, §6 pairing), `docs/features/system-health-history.md`, `docs/reference/logs.md`, `docs/features/ipk-packaging.md`.
3. `PRODUCT.md` + `DESIGN.md` before any UI work (Logs page, events cards).

## Decisions (the user asked to implement all proposed changes, so take the plan's recommendations)

- **Q1:** a separate `qmanager_logd` process, as a new argv0 role of the `qmanager_atd` binary (`native/qmanager_atd/`), plus a `qlog` client role. Never a lane inside the broker daemon.
- **Q2:** persist INFO+ logs on flash for 7 days; all events for 31 days.
- **Q3:** yes. In Phase 3, History events move to logd and the validated `awk` pairing in `history/events.sh` stays unchanged (it is fed `k:"e"` lines from `qlog EVQ`).
- **Q4:** the whole §2.8 catalogue, in this order. First the plan's priority pick: Cellular `apn_changed`, `band_lock_changed`, `tower_lock_changed`, band/tower failover fired and reverted, `sim_switched`; Connection `data_call_dropped/restored`, `wan_address_changed`, `site_down/up`, `eth_link_*`; System `broker_restarted`, `software_updated`, `login_locked`, `oom_kill`, `clock_stepped`. Then the rest.
- **Q5:** Phase 0 ships first, as its own commits.
- Q6 and Q7 in the plan's §7 are also resolved by its recommendations.

## Facts already established (do not re-derive)

- Live 2026-11-10: about 61 log lines/h (INFO 223, WARN 7, DEBUG 0 in 3.8 h). `date` fork 5.4 ms. Poller 3.3 %, atd 0.6 %, ping 0.5 % of one core. Syslog ring 64 KiB holds about 9 s (Qualcomm `qms` floods it), so QManager's `logger` copies are wasted. `system/logs.sh` costs 0.15 s CPU at 20 KB and 1.95 s at 1.47 MB, and the Logs page polls it every 10 s with `include_rotated=1`. That read path is the biggest CPU cost; the write path is not.
- `append_event` (`scripts/usr/lib/qmanager/events.sh:35`) forks `date`, `jq`, `wc`, `tail`, `mv` plus qlog. It is **unlocked**, with writers in the poller, watchcat, `qmanager_profile_apply`, `qmanager_config_restore`, `profiles/deactivate.sh`, `network/lan_config.sh` and `config-backup/collect.sh`. `/tmp/qmanager_events.json` is capped at 50 rows. Reader: `at_cmd/fetch_events.sh` (`serve_ndjson_as_array` in `cgi_base.sh:201`). Hooks: `hooks/use-recent-activities.ts` (10 s) and `hooks/use-system-logs.ts` (10 s).
- The broker already writes `/tmp/qmanager.log` itself (`native/qmanager_atd/src/common/log.rs`, 229 lines, same format and rotation, its own mutex). Crate is libc-only, musl static, `opt-level "s"`, about 669 kB at 0.6.2. Proto 3 is current. A new capability is a new `name=value` line in `/var/run/qmanager_atd.proto`.
- Hot WARN sites to make edge-only: `qmanager_poller:1865`, `wd_detect.sh:107`, `qmanager_sms_forward:415` and `:140`, `qmanager_tower_failover:135`, `parse_at.sh:347` and `:1355`.
- INFO→DEBUG demotions: `bands/current.sh:47`, `monitoring/connection_quality.sh:112`, `monitoring/watchdog.sh:180`, `monitoring/alerts.sh:114`, `system/settings.sh` ("Fetching system settings"), `cellular/live_signal.sh:108`. Sites logs its sweep summary only when the answered count changes.
- Direct `logger` bypasses to fold into `qlog_*`: init.d `qmanager_imei_check:44`, `qmanager_eth_link:48,91,118`, `qmanager_mtu:37`, `qmanager_ttl:36`, `qmanager_netbird_zone:35-44`, `qmanager_tailscale_net:28-45`, `qmanager_sms_storage:31`, `qmanager_tower_failover:82,120,126,128`; bin `qmanager_mtu_apply:35,45`, `qmanager_sms_storage:50-71`; lib `tower_lock_mgr.sh:572-634`.
- `/etc/qmanager/log_level` is read by 6 init scripts and written by nothing. Replace it with UCI `quecmanager.logging` plus the debug lease (migrate once).
- `/etc/qmanager/crash.log` reasons `user`/`update` (`record_planned_reboot`) and `unplanned` (`alert_engine.sh`) are expected. That is not drift. Leave the ledger alone.

## How to work

- **Workflow:** this is large work and the plan is already approved, so go straight to build. Use a worktree (`EnterWorktree` if you are not already in one) and reset it onto `development-home` (it branches from `origin/main` by default). Copy `.env` from the main checkout (confirm `git check-ignore .env`, never commit it), and run `bun install` only for frontend `tsc`/lint. Never switch branches in the shared main checkout.
- **Team tiers:** you (Opus) plan, judge reports with your own reads, and validate. Sonnet with `effort: high` builds routine Rust and shell. Opus at medium for the delicate parts: the clock anchor, the flush/fdatasync policy, the spool rename/grace ingest, and History Phase 3. Haiku for recon sweeps. UI goes through `/impeccable craft` in your own session, following the canon (CardFoot, toasts in all five catalogs, Material vs lucide per route, three states, motion from `lib/motion.ts`). Use `isolation: "worktree"` for parallel builders only when their files overlap.
- **Build order:** Phase 0 → 1 → 2 → 3, with 4 after 1. Bottom-up inside each phase: Rust/backend → init.d/lifecycle → CGI → hook → component.
- **Lifecycle lockstep in Phase 1:** `install.sh` (symlinks `qmanager_logd` + `qlog`, init.d `qmanager_logd` START=97 before atd, UCI seed, `mkdir /usrdata/qmanager/journal`), update path, `uninstall.sh` (stop/disable, `/var/run/qmanager/journal` cleanup, `--purge` removes the journal), ipk manifest (`scripts-dev/ipk/`), build.sh (rebuilt binary). Follow `dependencies/README.md` for the WSL musl build.
- **Validation** per the plan's §4 gates and §6. Static checks: `.claude/check-crlf.sh`, `sh -n`, BusyBox/POSIX audit (no bashisms, one var per `local`, no jq regex, guarded dot-sources), Rust unit tests. On the device use the `mcp__modem__*` bridge: deploy flat to `/tmp`, `mv` + `sync` (key scp fails; Posh-SSH or the bridge), md5-check, never `pgrep -f` inside `modem_exec`. Measure logd idle/storm CPU and RSS, poller `tools/poller-parity/measure.sh` before and after (no regression), `logs.sh` latency before and after, `kill -9` logd fallback and respawn drain, and `tools/history-test` 71/71 plus `system-test` 51/51 with the logd reader. Frontend: `bunx tsc --noEmit` + lint on touched files, `bun run icons:check`. After 2 failed validation rounds on the same issue, stop and ask the user.
- **Needs the user's explicit OK:** any reboot (needed for the "Previous boot" survival test), `AT+CFUN` changes, and any live-state write beyond deploying your own files.
- **Commits:** small, atomic Conventional Commits (`type(scope): summary`, ≤ 72 chars, subject only unless the why is not obvious), one per landed step. No attribution lines.
- **Docs when done:** a new feature doc `docs/features/journal.md` (spool format, record schema, clock rules, flush budget, query verbs, fallback, lifecycle), a routing line in `CLAUDE.md` and `docs/features/README.md`, updates to `at-broker.md` (new role, binary ceiling 800 kB), `history.md` (Phase 3 event source, `ext.spool` retired), `docs/reference/logs.md` (LOGQ contract, boot selector, debug lease), `docs/API-REFERENCE.md`, and `RELEASE_NOTE.md` (user-visible: persistent logs, previous-boot view, debug lease, new events).

## Done means

All five phases built, every §4 gate measured on the device with the numbers recorded in `docs/features/journal.md`, lifecycle lockstep verified (fresh install, update, uninstall), docs updated. **Never merge.** End by reporting the branch name, `git status`, the gate results and anything left open, then ask the user: merge, keep for PR, or discard.
