# CQ × Watchdog step 1b: behaviour rules, one per commit (RM551E)

Implements spec v2 (`2026-11-07-cq-watchdog-unified-architecture.md`) against the frozen contracts
(`2026-11-07-cq-watchdog-contracts.md`). Step 1a (adapter + neutral files) is done first and keeps
the 71 harness baselines byte-identical. Every rule below is ONE commit (code + scenarios + the
re-recorded `tools/watchdog-harness/baseline/`), and the harness must give identical output on
BusyBox 1.29.3, 1.31.1 and 1.36.1 before the commit. Each commit's body lists which existing
scenarios changed and why (one line per group), like the README's "wave" sections, and the README
gains a short section per rule.

Harness commands (Git Bash): `MSYS_NO_PATHCONV=1 wsl -e sh <scratchpad>/hrun1.sh <ver> /tmp/<dir>`
compares to `baseline/`; re-record with `run.sh run -o tools/watchdog-harness/baseline` under 1.36.1,
then confirm 1.29.3 and 1.31.1 reproduce it (`CMP=` env of hrun1.sh points at the new baseline).

## R0a. Output contracts (no decision changes)
- State file writes the contract §3 key set (new keys with their idle values until the rule that
  fills them lands; `recovery_reason`/`last_recovery_reason` vocabulary `outage|quality`).
- `append_event` gains the optional 4th arg `code` (events.sh: row gains `"code":"…"` only when
  non-empty); every watchdog call site passes its code (contract §6).
- `conn_state_read` / `conn_state_read_env` / ping.env parse `fail_elapsed_sec` into `CQ_FAIL_ELAPSED`
  (contract §2.2/§2.3; sidecar line `_cq_fe`). ping.env writer gains `_cq_fe`.

## R0b. Harness mono model
`lib.sh h_refresh` writes `fail_elapsed_sec` = seconds since the modelled outage started (0 while
reachable) and the contract ping.json key set; `last_family` becomes `ipv4`. The scenario still
sets the debounced verdict (`reachable`) directly. Scenario helper `mset attaching 1` creates
`/tmp/qmanager_ping_attaching`. No daemon change, so baselines only change where ping.json bytes
leak into output (they should not: it is excluded from tree.txt).

## R1. Time trigger + outage age (M1)
- Config: `act_after_sec` (default 30, clamp 15-600). `act_after_eff = max(act_after_sec, CQ_FAIL_SECS)`
  (fail_secs from the fresh ping read; 20 when unknown).
- `resume_mono` (wd_detect): set to `mono_now` at the end of the boot settle, when the attach flag
  disappears (first pass without it after one with it), on `radio_off` exit, `locked` exit and at the
  end of every SIM settle (Tier 3 cooldown start, revert settle, failback settle).
- `outage_age = min(CQ_FAIL_ELAPSED, now − resume_mono)`; while the attach flag exists outage_age = 0.
  `failure_secs` in the state file = outage_age (0 when reachable).
- Trigger: fresh read AND `reachable=false` AND `outage_age ≥ act_after_eff`. `streak_fail>0` only
  moves monitor→suspect. Remove `_radio_streak_base` and `fail_threshold` from the decision.
- SSR window = `ssr_grace_sec + act_after_eff + 8 + 2×10`; config key `ssr_grace_sec` (default 45).
  One hold per SSR identity (`PLAT_SSR_ID`): an identity that already held never holds again.
- Harness `inner.sh` seeds `act_after_sec`/`ssr_grace_sec`; scenarios that used `fail_threshold`
  are updated to the equivalent seconds. New scenarios: radio off for 10 min then on with the link
  still down → no Tier 1 until act_after_eff after the resume; LOCKED exit after a long outage, same;
  attach flag present → no trigger; SSR identity holds once.

## R2. Per-reason hold-off (M2)
- Two independent pauses: outage (`HOLDOFF_OUTAGE_SECS=900`, clears when `reachable=true`) and quality
  (level 0/1/2 → 900/1800/3600 s; the level grows on each consecutive quality hold-off, resets after
  3600 s with no quality hold-off; clears early on a clean quality window or a settings reload; never
  on reachability).
- Start gate per reason: `none → holdoff(same reason) → radio_off → ssr → go`. A quality pause never
  blocks an outage ladder and vice versa.
- State `holdoff` while a pause is active and nothing else runs; `holdoff_until`/`holdoff_reason`
  report the pause that ends last (outage wins a tie). Event `wd_holdoff` names the minutes.

## R3. Reboot budget + Tier 4 resting + long-run guard (D4, M4)
- Budget = `tier4_escalation` rows in the rolling hour (existing clock-aware ledger). Spent → Tier 4
  is skipped (treated like a disabled tier for this attempt), Tiers 1-3 keep working,
  `reboot_budget_exhausted=true`, `reboot_rest_reason=hourly`, event `wd_budget_spent` once per
  episode (episode = until a reachable=true). Never writes `enabled=0`, never retires the service,
  never creates the disabled flag.
- Long-run guard: persistent file `$PF_STATE_DIR/wd_reboot_guard` = `<engaged_epoch>`. Engage when
  the budget is spent now AND it was also spent in the previous hour (≥ max rows in
  `(now−7200, now−3600]`) AND no link-up stamp newer than the oldest of those rows. Link-up stamp:
  `$PF_STATE_DIR/wd_link_up` = epoch, written once on the first `reachable=true` seen after a
  `tier4_escalation` row newer than the stamp (flash writes only on that edge). While engaged Tier 4
  rests with `reboot_rest_reason=long_outage` until a link-up stamp newer than the engage epoch, or
  24 h after engaging (then the file is removed). Insane clock (1970 rule) → guard not engaged.

## R4. Quality cap at Tier 2 + monotonic persistence (D5)
- Quality ladder: Tier 3 and Tier 4 are always skipped for `reason=quality`; gate `none` when neither
  Tier 1 nor Tier 2 is enabled.
- Trigger only in `monitor` with fresh `reachable=true` and `streak_fail=0`. Window = last
  `clamp(120/interval, 10, 60)` ring lines since the last mark, at least 10 samples; limits = CQ
  thresholds with floors 50 ms / 10 %. `quality_breach_since` = mono of the first breaching pass; the
  breach must persist `quality_after_sec` (default 120, 30-1800) on the mono clock; a clean window
  resets it; no-signal keeps it. `quality_breach_secs` in the state file.

## R5. Effective step wait + inconclusive cooldown keeps the tier
- `step_wait_eff = max(step_wait_sec (default 60, 10-300), CQ_RECOVER_SECS + 20)`; Tier 3 and SIM
  settles ≥ 90 s. Cooldown runs to the mono deadline `step_wait_until` (not pass-counted);
  `cooldown_remaining = max(0, step_wait_until − mono)`.
- Verdict: stale → extend one pass, max 3, then inconclusive: revert an unconfirmed Tier 3, state
  `monitor`, keep `current_tier`, so the next trigger resumes at the next tier. `current_tier` resets
  only on success or natural recovery (`reachable=true` seen in monitor/suspect). Quality: no data →
  extend, max 3, then inconclusive the same way.

## R6. Dead prober
Ping cache stale for > 300 s (continuously, mono) → `ping_stale=true`, event `wd_ping_stale` once per
stale episode, `svc_start <ping service>` at most once per 900 s (RM551E: the `qmanager` init service
owns the ping instance). Still no recovery decision on stale data. Clears on the first fresh read.

## R7. Ping: early-exit fan-out + slot promotion (qmanager_ping)
- Config: `targets` list (4 slots; defaults `1.1.1.1 8.8.8.8 2606:4700:4700::1111 cloudflare.com`),
  validated per contract §5.2; a bad slot falls back to its default with a warn. Until step 2 migrates,
  a missing `targets` list reads as the defaults.
- Slot 1 alone; IPv4/hostname legs `ping -c1 -W2 -w3`, hostname via `plat_timeout 4`; an IPv6 literal
  slot without a non-`lo` `::/0` route is skipped (not failed) and the next usable slot is promoted to
  "alone". On failure the remaining usable slots run in parallel; poll result files every 0.2 s; the
  winner is the lowest-numbered slot that answered, decided as soon as every lower slot has finished;
  kill the rest. `last_leg` = slot (0 none), `last_family` from the answer.
- ping.json gains `targets[4]`/`last_leg`, drops `last_target` (contract §2). Needs a dev harness
  `tools/ping-harness/` (fake `ping` with per-target delay/result, source-mode guard
  `QMANAGER_PING_NO_MAIN=1`), run under the three BusyBox versions.

## R8. Sensitivity table + time-based ring + downsampled history
- `conn_state_resolve <sensitivity>` = contract §1 table; config key `sensitivity` (fallback: the old
  `profile` key until migration, then default relaxed). `interval_override` is no longer read.
- Ring size per contract §1, trim at size + 10. ping.json `sensitivity` replaces `profile`.
- The poller's stats awk moves into neutral `conn_state.sh` (`cq_ring_stats`), unchanged maths, plus
  the downsample to ≤ 60 points (bucket max, null only if all lost) and `history_interval_sec` /
  `history_size` from it. Quality-event debounce in seconds (contract §1). status.json connectivity
  additions per contract §4.1 in both composers + `tools/poller-parity/status_parity.sh`.

## R9. Remaining spec items (one commit each)
- LOCKED union §5.8: + live config-restore PID, + manual SIM switch flag.
- Tier 2 skip on NSA and band locks too (`plat_tower_locked`). **Dropped on RM551E** (owner 2026-11-08): no NSA lock and no file-based band-lock state; see Amendment 3, R9b disposition.
- Tier 3 skip reasons (no slot / unreadable / already on backup / quality) and failback give-up
  after 3 failed tries until a reload or boot (`failback_failures`, event `sim_failback_giveup`);
  config keys `failback_enabled` / `failback_every_min`.
- Remaining config renames read by the daemon (`step_wait_sec`, `quality_after_sec`,
  `ssr_grace_sec`, `failback_*`); `check_interval` becomes the internal constant 10.

## R10-R11. Amendment 3 (`2026-11-08-cq-watchdog-amendment-3.md`)
- R10: last successful recovery (`last_success_*`), in memory.
- R11: stuck-on-one-carrier trigger (`carrier_enabled`, `carrier_after_min`, reason `carrier`,
  Tiers 1-2), `plat_cc_count` (QMI sidecar; gated poller `QCAINFO` + `ca.env` for SA / NR-DC).

## Checkpoint 2026-11-08 (branch `feat/cq-watchdog-unify`, code tip `ee3dd200`; end-of-day state)

Spec §10 progress. Fresh agents start here, then read the docs this section names.

| Step | State | Evidence / commits |
|---|---|---|
| 0, 1a, 1b (R0-R11) | done | harness 164/164 on BusyBox 1.29.3/1.31.1/1.36.1; R11b `8eb663d8`, scenarios 164/165 `1c288529` |
| 2 migration + Config Backup | done, validated | `7ea74031` `91fdf387` `5096f5b7`; `tools/cq-wd-migrate/run.sh` 229/0 ×3; lib `scripts/usr/lib/qmanager/cqwd_migrate.sh` |
| 3a CGIs + contract runner | done, validated | `ee7ec0ca`..`3081939e`, `b172458f`; `tools/cq-wd-contract/run.sh` 162/0 ×3; adapter additions = contracts §15 `c053be1e` |
| 3b poller republish, health check, plat_cc_count | done, validated | `2e211f18` `50f7edff` `7ced5282`; status_parity 378/0, sidecar 114/1 (known), ca_env 116/0, adapter_cc_check 18/18 |
| 3 follow-ups (validator W1, W2, nits) | done, validated (builder full run; orchestrator re-ran `check.sh` only) | W1 range-check stored custom limits `12904381` (neutral `wd_config.sh` + manifest; harness scenario 166; `tools/cq-wd-parity/poller_thresholds.sh` 14/0); W2 8192-byte body cap `071fd1e0` (`payload_too_large`, 4 new fixtures); nits `ce5f4fec`..`ee3dd200`; Step 3b independently validated (no blockers). Final-tree counts ×3 BusyBox: harness 165/165, contract runner 188/0, migrate 231/0, status_parity 378/0+19/0+6/0, sidecar 114/1 (known), ca_env 116/0, check.sh OK |
| Decision: null reason before any recovery | done (owner approved 2026-11-08) | `wd_state.sh` now emits `last_recovery_reason` as null while `last_recovery_time` is null (it showed the default `outage` before any recovery and after an SSR hold intercepted a picked ladder, scenario 164). Neutral file, manifest refreshed, harness baselines re-recorded. |
| Frontend (UI session) | done, merged into this branch | merge `1670ec14` (from `claude/cq-watchdog-ui-c815f0`; brief `2026-11-08-cq-watchdog-ui-brief.md`, plan `2026-11-08-cq-watchdog-ui-plan.md`); tsc + i18n pass; previewed against fixtures only |
| Merge `development-home` into this branch | approved by the owner, NOT done | 17 commits behind; dry-run conflicts in `qmanager_watchcat` and `tools/poller-parity/status_parity.sh`; `b9d809d0` (skip `AT+CFUN?` when QMI reports online) must move into neutral `wd_state.sh` → `sh tools/cq-wd-parity/check.sh --update` in the same commit |
| 4 live validation | NOT started; every deploy/live write needs the owner's OK | checklist: spec §10 step 4 + Amendment 3 items + CGIs under real uhttpd (root-owned revert/retry flags, device jq 1.6 `all(gen;cond)`/`@tsv`, carrier save raises `/tmp/qmanager_poller_reload`), band lock survives CFUN 0/1, SA `QCAINFO` ≈1/min with `=0` sent, `ca.env` age < 90 s, migration from real old configs, Config Backup old↔new, ipk upgrade / tarball OTA / rollback, Prometheus diff, now also the rebuilt UI end to end. `sync` after every deploy. |
| 6 docs | partly | frontend docs `90972817`; also note the 8192-byte body cap (`payload_too_large`) and the exact-1/0 stored-flag rule; still to do: connection-quality.md, connection-watchdog.md, README routing, CLAUDE.md routing, adaptive-polling.md, config-backup-restore.md, system-health-check.md, BACKEND.md/API refs to removed CGIs, RELEASE_NOTE.md (rollback note, dropped override, new backup refused by older release, Prometheus families unchanged) |
| RM520N port plan | NOT started (draft only, do not start the port) | include `plat_cc_count`, `plat_manual_sim_switch`, `PF_FAILBACK_RETRY_FLAG`, `PF_POLLER_RELOAD`, section-creating `cfg_set`, W1 neutral change, fixture README `setup.files` keys `ping`/`slots`/`last_outage` + `__MONO__`/`__NOW__` |
| Final report | pending | branch + git status, live results item by item; ask merge / keep for PR / discard; never merge into `development-home` without the owner |

Test commands (WSL, from an ext4 copy of `tools/` + `scripts/`, `export PATH=$HOME/bin:$PATH`):
watchdog harness `tools/watchdog-harness/run.sh run|compare` (27/28 are load-flaky; rerun alone);
`tools/cq-wd-contract/run.sh -b <busybox>`; `<busybox> sh tools/cq-wd-migrate/run.sh`;
`tools/poller-parity/{sidecar_parity,ca_env_parity,status_parity}.sh`; `sh tools/cq-wd-parity/check.sh`.
