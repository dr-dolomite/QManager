# CQ × Watchdog: RM520N port plan (spec §10 step 5). DRAFT, do not start

Status: draft for owner approval, 2026-11-08. This is a plan only: nothing has been built, deployed or run on a modem.

Sources: spec v2 `docs/plans/2026-11-07-cq-watchdog-unified-architecture.md`, contracts `2026-11-07-cq-watchdog-contracts.md` (§7 and §11-§15 adapter additions), Amendment 3 (R9b, A3.3), the 1b checkpoint table, the RM551E adapter `scripts/usr/lib/qmanager/qm_platform_cqwd.sh`, and a read of the RM520N checkout at `D:\Projects\QM PROJECT\QManager-RM520N` (branch `development`, 7 commits ahead of origin, `package.json` modified).

Facts below come from reading the RM520N code. Recon (Phase 1) must still confirm them on the live device.

---

## 1. Goal and scope

**Goal.** The RM520N runs the same 11 neutral files as the RM551E, byte for byte, behind its own `qm_platform_cqwd.sh`. Its CGIs return the same contract shapes. Its UI uses the same layout and flows as the RM551E's. The RM520N watchdog harness, contract runner and migration runner pass under BusyBox 1.29.3, 1.31.1 and 1.36.1.

**In scope (RM520N repo):** the adapter; the 11 neutral files and the manifest; support libs the neutral files expect; migration from RM520N's real old keys; Config Backup; the two CGIs, plus removal of the old ones; poller republish and the `connectivity` block; consumers of `events.sh`, alerts and ping history; install, OTA and uninstall (lifecycle lockstep); harness, contract runner and migrate runner (the RM520N's first harness); frontend port; docs and the release note.

**RM551E-side prerequisites:** only the neutral fixes listed in §4.2, and only if the owner approves them.

**Out of scope:** Prometheus (the RM520N has no exporter); `dismiss_sim_swap` (RM520N's banner uses the SIM registry); QMI-based `AT+CFUN?` shortcut (possible later through the broker's DMS client); RG501Q-EU full validation (community tier): smoke checks only.

**Copy source.** The port copies the neutral files from one frozen RM551E SHA at or after `9199bc78`, which contains W1 `12904381`, the QMI CFUN shortcut (via merge `c6cc2935`) and the null `last_recovery_reason` fix `306eaaf6`. Any later neutral change on the RM551E, including fixes from its Step 4, means a re-sync (§4.3).

---

## 2. What the RM520N has today (from the repo; recon confirms)

| Area | RM520N today | Port impact |
|---|---|---|
| Watchdog | `scripts/usr/bin/qmanager_watchcat`, 1213 lines. Libs: `wd_common.sh` (key table), `wd_ssr.sh` (sysfs SSR), `wd_quality.sh`, `wd_recheck.sh`, `slot_verify.sh` | Replaced, not patched. The four old `wd_*` libs are retired. `slot_verify.sh` is kept only if `cellular/settings.sh` still uses it |
| Ping | `qmanager_ping`, 617 lines. Legs h1/h2/i1/i2, profile table 15/20/30/60 s, history `<rtt> <leg>` | Replaced by the neutral daemon. The history format changes to `<rtt> <slot>` |
| Config store | `/etc/qmanager/qmanager.conf` (JSON, `config.sh`, flock `qmanager.conf.lock`, numbers stored as numbers, `// empty` treats `false` as absent). `/etc/qmanager/ping_profile.json` (`profile`, `interval_sec` (the seed ships 5), `target_host_1/2`, `target_ip_1/2`, hidden `fail_secs/recover_secs/history_secs`). `/etc/qmanager/quality_thresholds.json` (nested `latency.{preset,custom_ms}`, `loss.{preset,custom_pct}`, `alert_after_min`). `/etc/qmanager` is owned by www-data | Adapter storage map (§3) |
| Init | systemd 244. Boot persistence is a wants-symlink in `/lib/systemd/system/multi-user.target.wants`, not `systemctl enable`. `platform.sh` provides `svc_start/stop/enable/disable/is_running` (maps `_` to `-`; www-data goes through `sudo -n /usr/bin/qmanager_svc`). The watchcat unit has `ExecStartPre` gate `watchcat.enabled == 1`. No `KillMode` is set | `svc_*` come from `platform.sh`; add `svc_running` |
| CGI user | lighttpd runs CGIs as **www-data**; daemons run as root | This breaks the neutral root-owned flag trust rule (§3.3) |
| AT | `qcmd` through the `qmanager_atd` broker. Failure shows in exit status and stderr; `ERROR` never reaches stdout | The neutral code already accepts only `READY`/`+CFUN: n`. Recon confirms |
| QMI | The broker writes `/var/run/qmanager/qmi.env` (root, directory 0700), same `qmi_*` key set as RM551E (`qmi_mono, qmi_state, qmi_registered, qmi_ca_count`, … and the `qm_sidecar_end='1'` end marker), plus `qmi_ssr_count`. There is **no** `qmi_dms.sh` | `plat_cc_count` can copy the RM551E code. `wd_cfun_now` falls back to `AT+CFUN?` |
| SSR | sysfs `/sys/devices/platform/4080000.qcom,mss/subsys0/{state,crash_count}` | `plat_ssr_poll` keeps state between calls (§3.2) |
| Long-running AT | `/run/qmanager_at/long_running`, checked by `qm_long_flag_up` (owner root, nlink 1, regular file) | Direct binding |
| Crash log | `/usrdata/qmanager/crash.log` (root, directory 0755), `crash_log.sh` `qm_crash_log_prepare`. Rows `<epoch>\|reboot\|tier4_escalation`, same format as RM551E | Direct binding |
| SIM failover record | `/etc/qmanager/qmanager_sim_failover`, in the www-data-writable directory. Read by the poller (`:2005`) and the CGI | Moves to `/usrdata/qmanager/sim_failover.json` (root) plus a `/tmp/qmanager_sim_failover` mirror. The installer migrates a live record |
| Events | `events.sh`, 3 arguments (no `code`). `MAX_EVENTS=300`. The file is root:root 0666 and trimmed in place (same inode) | `events.sh` gains the optional 4th argument. MAX_EVENTS needs a neutral fix (§4.2 N1) |
| Missing helpers | No `safe_tmp.sh` (`qm_trusted_file`, `qm_atomic_write`, `qm_durable_write`, `qm_root_dir`). No `mono_now`/`mono_now_set`. No `schedule_guard.sh` (`_qm_clock_sane` lives in `schedule_timer.sh`) | Port `safe_tmp.sh`. Add `mono_now*` to `qlog.sh`. `_qm_clock_sane` uses the neutral year ≥ 2025 fallback, the same rule |
| Tower lock | `/etc/qmanager/tower_lock.json` (`lte`, `nr_sa`), same jq test. Band lock is written by AT only (`bands/lock.sh`, `AT+QNWPREFCFG`), **no state file**. A **band-failover watcher** (`qmanager_band_failover`, ~30 s, polls `qcmd`, reverts the lock when no carrier is seen) | R9b (§3.4) |
| Reload flags | ping `/tmp/qmanager_ping_reload`. Quality (poller and events): `/tmp/qmanager_events_reload`. Poller: `/tmp/qmanager_poller_reload`. Tier-2 refresh: `/tmp/qmanager_tier2_refresh` | `plat_paths` |
| Recovery flag | `/tmp/qmanager_recovery_active`. The old watchcat writes **its PID** into it (falling back to `touch`), and `qmanager_profile_apply` judges owner liveness from that PID (`APN_RECOVERY_FLAG_*`) | The neutral code only `touch`es it (§4.2 N2) |
| Alert wait | `cq_alert_after_min` reads thresholds `alert_after_min`, then SMS, then email, then **Discord**, then 5 | The RM520N adapter keeps the Discord fallback |
| i18n | Watchdog copy in `common`, CQ in `system-settings`. No `monitoring.json`. 6 locales (`ru` is a language pack with `_pack.json`). CI `bun run lang check --all` | Per-repo key mapping |
| Dev tools | None for this feature. `CLAUDE.md`: "No test harnesses — the user's own tarball run is authoritative." | Conflict with the spec (Q1) |

---

## 3. Adapter re-implementation (`scripts/usr/lib/qmanager/qm_platform_cqwd.sh`, RM520N)

Same shell rules as the RM551E file: sourced, guarded by `QM_PLATFORM_CQWD_LOADED`, BusyBox ash, no jq regex, idempotent. Sources `config.sh`, `platform.sh`, `qlog.sh`, `crash_log.sh`, each `[ -f ] && .`. Every symbol the neutral files reach must exist after it loads (audit in §10).

### 3.1 Config store

| Logical key | RM520N storage |
|---|---|
| `watchdog <k>` | `qmanager.conf` `.watchcat.<k>`. New names; old names stay in place |
| `connection_quality sensitivity / targets / profile / target_host_1/2 / target_ip_1/2 / interval_sec` | `ping_profile.json`, top level (`targets` is a JSON array) |
| `latency_preset / latency_custom_ms / loss_preset / loss_custom_pct` | `quality_thresholds.json` `.latency.preset / .latency.custom_ms / .loss.preset / .loss.custom_pct` (nested; no data migration) |
| `alert_after_min` | `quality_thresholds.json` `.alert_after_min` |

- **`_pf_route`**: same key charset guard as RM551E; resolves to (file, jq path).
- **`cfg_get`**: rc 2 when jq is missing (`/opt` not mounted yet), `qmanager.conf` missing/unparsable, or a CQ file unparsable; rc 1 when the key is absent or `null`, or a CQ file is missing. Values: string raw, integer `tostring`, **`true`/`false` as `1`/`0`** (the neutral code reads a stored flag as true only for exactly `1`, `3acf6419`). Arrays/objects give rc 1.
- **`cfg_get_list`**: one array item per line; non-array gives rc 1.
- **`cfg_set` / `cfg_set_list` / `cfg_del`**: **stage in memory** as an ordered list of jq operations with `--arg`/`--argjson` arguments; never stage a temp copy (it would overwrite a concurrent `qm_config_set`). Typing follows `qm_config_set` (`^(0|[1-9][0-9]{0,8})$` → number, else string). Booleans stored as `0`/`1` numbers. **Section-creating**: each op first runs `.[s] |= (if type=="object" then . else {} end)`, matching RM551E `_pf_ensure_sec` (contracts §15.1). `cfg_del` creates nothing.
- **`cfg_commit`**: per touched file, shared flock (`QM_CONFIG_LOCK`), read current (garbage = `{}`), apply staged program, `mktemp` sibling, `chmod 0644`, `mv`. Each endpoint touches exactly one file per save (assert in the CGIs). Failure: rc 1, nothing published, temp removed.
- **`cfg_revert`**: drops staged ops; the contract runner asserts no staging residue.

### 3.2 Functions and variables the neutral files call

| Symbol | RM520N binding |
|---|---|
| `svc_start/stop/enable/disable` | `platform.sh` (unit = name with `_` → `-`) |
| `svc_running` | Adapter: `svc_is_running "$1"` |
| `plat_flag_raise <p>` | `[ -e "$p" ] \|\| touch "$p"`; an existing flag (even root-owned) counts as raised. Never for trusted flags (§3.3) |
| `plat_paths` | Table below |
| `plat_long_running` | `qm_long_flag_up "$PF_LONG_RUNNING"`. **Q5:** also rc 0 while the band-failover watcher's PID is live |
| `plat_manual_sim_switch` | Regular, non-symlink, nlink 1, owned by uid 0 **or** www-data. Low risk: a planted flag only pauses the watchdog, capped at 120 s by neutral code |
| `plat_tower_locked` | Same as RM551E (`lte.enabled`, `nr_sa.enabled`); R9b §3.4 |
| `plat_tower_failover pause\|resume` | `svc_stop` / `svc_start qmanager_tower_failover` |
| `plat_profile_apply` | `( . /usr/lib/qmanager/profile_mgr.sh && auto_apply_profile "$1" "$2" )` |
| `plat_ssr_poll` | sysfs `subsys0`; state in globals (called directly, never in `$(...)`). First call records the `crash_count` baseline, reports nothing; each later episode (state leaves `online`, or `crash_count` rises unseen) increments an episode counter. `PLAT_SSR_ID=e<n>`, `PLAT_SSR_MONO` = `mono_now` at first sight. **Recon decides** vs the broker's `qmi_ssr_count`, and finds the RG501Q path |
| `plat_dual_sim` | Same as RM551E: `PF_DUAL_SIM_CACHE`, absent = two slots. No writer in either repo (**Q8**) |
| `plat_cc_count` (+ `_pf_cc_ok`, `_pf_mono_ok`) | Verbatim from RM551E; `qmi.env` same format (`native/qmanager_atd/src/daemon/qmi_snapshot.rs`). `ca.env` only if the gated SA read is ported (**Q4**), else SA reads unknown |
| `plat_reboot` | `sync; run_reboot` (risk R1) |
| `plat_crash_log_prepare` | `qm_crash_log_prepare` |
| `plat_timeout` | `qm_timeout "$@"` (`/opt/bin/timeout`, old `-t`, bounded fallback) |
| `cq_alert_after_min` (+ `CQ_SMS_CONFIG`/`CQ_EMAIL_CONFIG`) | `alert_after_min` → SMS → email → **Discord** (`/etc/qmanager/discord_bot.json`) → 5 |
| `append_event` 4th arg | RM520N `events.sh` change (not neutral); row gains `"code"` only when non-empty |
| `mono_now`, `mono_now_set` | Added to RM520N `qlog.sh`, same body as RM551E |
| `qm_trusted_file`, `qm_atomic_write`, `qm_durable_write`, `qm_root_dir` | New RM520N `safe_tmp.sh`, ported from RM551E |
| `_qm_clock_sane` | Not bound; `wd_ledger.sh` fallback is the same year ≥ 2025 rule |
| `sim_db_add` | Existing RM520N `sim_db.sh` |
| `qm_qmi_online` | Not defined → `wd_cfun_now` uses `AT+CFUN?` |
| `qcmd`, `jq` | Device binaries; recon checks reply format |

`plat_paths`:

| Variable | RM520N value |
|---|---|
| `PF_PING_RELOAD` | `/tmp/qmanager_ping_reload` |
| `PF_QUALITY_RELOAD` | `/tmp/qmanager_events_reload` |
| `PF_WD_RELOAD` | `/tmp/qmanager_watchcat_reload` |
| `PF_POLLER_RELOAD` | `/tmp/qmanager_poller_reload`, or empty if Q4 = no |
| `PF_MAINT_LOCK` | `/tmp/qmanager_watchcat.lock` (same path `qmanager_update` touches) |
| `PF_PROFILE_APPLY_PID` | `/tmp/qmanager_profile_apply.pid` |
| `PF_RESTORE_PID` | `/tmp/qmanager_config_restore.pid` |
| `PF_SIM_SWITCH_FLAG` | `/tmp/qmanager_sim_switch_active` (raised/trap-cleaned by `cellular/settings.sh` around `QUIMSLOT`, Q6) |
| `PF_LONG_RUNNING` | `/run/qmanager_at/long_running` |
| `PF_STATE_DIR` | `/usrdata/qmanager` (root 0755; never `/etc/qmanager`) |
| `PF_FAILOVER_RECORD` | `/usrdata/qmanager/sim_failover.json` |
| `PF_FAILOVER_MIRROR` | `/tmp/qmanager_sim_failover` |
| `PF_CRASH_LOG` | `$QM_CRASH_LOG` |
| `PF_RUN_DIR` | `/var/run/qmanager` (broker's root 0700 dir; recon checks coexistence) |
| `PF_DUAL_SIM_CACHE` | `/var/run/qmanager/dual_sim` |
| `PF_EVENTS_FILE` | `/tmp/qmanager_events.json` |
| `PF_MAX_EVENTS` | `300` (only if N1 approved) |
| `PF_TOWER_LOCK_CONFIG` | `/etc/qmanager/tower_lock.json` |
| `PF_FORCE_TIER2_FLAG` | `/tmp/qmanager_tier2_refresh` |
| `PF_REFRESH_POLICY_FLAG` | empty (recon confirms empty is skipped) |
| `PF_PING_SVC` | `qmanager_ping` |
| `PF_FAILBACK_RETRY_FLAG` | `/tmp/qmanager_watchcat_retry_failback` |
| `PF_QMI_ENV` | `/var/run/qmanager/qmi.env` |
| `PF_CA_ENV` | `/var/run/qmanager/ca.env` |

### 3.3 Trusted flags across the www-data/root split (owner decision Q2)

Neutral `wd_sim.sh` honours the revert flag and `PF_FAILBACK_RETRY_FLAG` only when `qm_trusted_file` passes (root-owned). RM520N CGIs run as www-data, so `touch` gives an untrusted flag the daemon deletes: **Revert and Retry would never work**.

- **Recommended:** root helper `/usr/bin/qmanager_wd_flag <revert_sim|retry_failback>` (fixed allowlist, no path argument, `qm_atomic_write`), called as `$_SUDO -n`; one sudoers line following `qmanager_svc`.
- **Rejected:** loosening `qm_trusted_file` to accept www-data (it also gates the failover record, `wd_sim.sh:993`).

### 3.4 R9b (band lock) on the RM520N

- Expected disposition as RM551E: Tier 2 skipped for LTE and NR-SA tower locks only; band locks live in modem NV and should survive `CFUN=0/1`.
- Recon confirms no file-based band-lock state and records `AT+QNWPREFCFG` lte/nsa/nr5g values (read only); persistence is measured in the live Tier 2 test.
- Extra risk: a Tier 1/2 during `qmanager_band_failover` watching makes it see no carrier and **revert the user's lock**. Q5: `plat_long_running` covers the watcher (LOCKED for ~30 s, no neutral change).

---

## 4. Neutral set and manifest workflow

### 4.1 Copy

- Copy the 11 files in `tools/cq-wd-parity/check.sh` from the frozen RM551E SHA, with `check.sh` and `manifest.sha256`. Gates: `check.sh` passes in both repos; manifests identical; a one-off cross-repo `cmp` loop is clean.
- Also byte-identical: `tools/cq-wd-contract/README.md` and `fixtures/`, including the 4 body-cap fixtures `{connection_quality,watchdog}/post_body_{at_limit_8192,too_large_8193}.json`. Proposal: `tools/cq-wd-parity/fixtures.sha256` (Q9).
- Late RM551E neutral changes ride along (confirmed by hash): W1 (`wd_config.sh`, `12904381`, harness scenario 166); QMI CFUN shortcut (`wd_state.sh`, inert on RM520N); null `last_recovery_reason` (`wd_state.sh`, `306eaaf6`).
- W1's non-neutral half (poller range-check of stored custom limits) must be ported into the RM520N poller (§6), with an RM520N `tools/cq-wd-parity/poller_thresholds.sh`.

### 4.2 Neutral fixes the port needs (each needs owner OK; each lands on RM551E first)

Workflow: RM551E edit → `check.sh --update` → harness ×3 (identical, or re-recorded with a reason) → contract and migrate runners → copy to RM520N.

- **N1 MAX_EVENTS.** Neutral watchcat hard-codes `MAX_EVENTS=50`; on RM520N it would trim the shared events file from 300 to 50. Fix: `MAX_EVENTS="${PF_MAX_EVENTS:-50}"`.
- **N2 recovery flag owner (recommended).** ~20 bare `touch "$RECOVERY_FLAG"` calls would break RM520N `qmanager_profile_apply`'s PID-owner protocol. Fix: one neutral helper calling new adapter function `plat_recovery_flag_raise` (RM551E: `touch`; RM520N: PID write with `touch` fallback). Adapter API addition (contracts amendment). Step 2 first reads `profile_apply` to prove the need.
- **N3 Tier 4 under systemd (only if recon proves the risk).** `( sleep 1; plat_reboot ) & exit 0` under Type=simple with default `KillMode=control-group` may be killed with the unit. Recon looks for crash.log `tier4_escalation` rows followed by a real boot. If needed: (a) adapter-only `plat_reboot` = `systemd-run --no-block /sbin/reboot` (preferred), or (b) neutral foreground reboot.

### 4.3 Re-sync rule

Any later RM551E neutral edit is copied to RM520N in the same session, then `check.sh` in both repos and an RM520N harness run. The port branch records the RM551E SHA it is synced to.

---

## 5. Migration (RM520N real old keys); `cqwd_migrate.sh` (RM520N version, JSON, not neutral)

- Called by `install_rm520n.sh` (tarball and OTA: `qmanager_update` runs the installer with `--force --skip-packages`), **after** `migrate_ping_targets`, `migrate_ping_debounce_shadow`, `migrate_watchcat_fail_threshold` (kept).
- Idempotent, keyed on presence of the **new** keys; root writes through `config.sh`'s lock; logs every change; old keys stay except dropped overrides.

| Old (RM520N) | New |
|---|---|
| `ping_profile.profile` | `sensitivity` (unknown → `relaxed`) |
| `target_host_1, target_host_2, target_ip_1, target_ip_2` | All equal `cloudflare.com, google.com, 1.1.1.1, 8.8.8.8` → new defaults `[1.1.1.1, 8.8.8.8, 2606:4700:4700::1111, cloudflare.com]`; otherwise `targets = [h1, h2, i1, i2]`; an empty/invalid slot gets that slot's default |
| `ping_profile.interval_sec` (seed 5), `fail_secs`, `recover_secs`, `history_secs` | **Deleted** (dropped overrides) |
| `watchcat.fail_threshold` | `act_after_sec = clamp(fail_threshold × I, 15, 600)`; `I` = old *effective* interval (stored `interval_sec` if valid, else profile 1/2/5/10) |
| `watchcat.cooldown` | `step_wait_sec` (clamp 10-300) |
| `watchcat.quality_consecutive` | `quality_after_sec = clamp(q × check_interval (default 10), 30, 1800)` |
| `watchcat.ssr_grace` | `ssr_grace_sec` (10-120); `ssr_aware` kept (default 1) |
| `primary_recheck_enabled / _interval` | `failback_enabled / failback_every_min` |
| `backup_sim_slot: ""` | key absent (null) |
| `watchcat.probe_interval` | deleted; `check_interval` stays for rollback, no reader |
| (new) | seeded: `carrier_enabled=0`, `carrier_after_min=15`, `quality_enabled` kept else 0 |
| `/etc/qmanager/qmanager_sim_failover` | Only valid JSON (`active` boolean, slots 1/2) → root-owned `PF_FAILOVER_RECORD` (`qm_durable_write`) + mirror; else dropped with a log line. Legacy file removed |

**Fresh-install seeds:** `ping_profile.json` = `{"sensitivity":"relaxed","targets":[…4 defaults…]}` (no `interval_sec`); `_qm_config_defaults` `watchcat` gets the new key set; booleans `0`/`1`.

**Config Backup** (`config_backup_monitoring.sh`): new `connection_quality` section before `watchdog`; permanent translation of old RM520N names with the same formulas (interval from backup's profile/interval if present, else device's); `backup_sim_slot ""` → null; new backups refused by older releases (release note).

**Migrate runner** (`tools/cq-wd-migrate/run.sh`, RM520N: jq file store instead of the UCI stub), BusyBox ×3. Cases: fresh install; all-default and custom slots; seeded `interval_sec` 5 with each profile; `fail_threshold` 5 and 10; `max_failures` legacy chain; garbage JSON; re-run no-op; booleans `true` vs `1`; failover record valid / invalid / symlink; Config Backup old→new and new→old; real old configs from recon (sanitised).

---

## 6. CGIs, poller and consumers (per-repo bodies)

### CGIs

- New `www/cgi-bin/quecmanager/monitoring/connection_quality.sh` from the RM551E body with the RM520N preamble (`cgi_base.sh` auth, `cgi_error`).
- Rewrite `monitoring/watchdog.sh`: `reason` → `detail`; `effective`, `sim_dual_capable`, `auto_disabled` (old `/tmp/qmanager_watchcat_disabled`); `retry_failback` and `revert_sim` via `qmanager_wd_flag`; no `dismiss_sim_swap`; `enabled` → `svc_enable/start` or `stop/disable qmanager_watchcat`. Keep `service_enable_failed` / `service_disable_failed` (**Q7**, not in the contract)?
- Body cap: `CONTENT_LENGTH` > 8192 (or not a plain number) **before** `cgi_read_post`'s `dd` → `payload_too_large`; recon checks lighttpd `server.max-request-size`.
- Remove `settings/ping_profile.sh` and `settings/quality_thresholds.sh` (no shims), and the `mv_wd_*` / `mv_ping_profile_*` helpers in `monitoring_validate.sh` unless used elsewhere.

### Contract runner

`tools/cq-wd-contract/run.sh` (RM520N): CGIs as a non-root user; `sudo` stub logging `qmanager_svc` / `qmanager_wd_flag`; JSON store seeded from logical `setup` keys; `setup.files` keys `status`, `failover`, `ping`, `slots`, `last_outage`; placeholders `__MONO__` / `__NOW__`; skips `"repo":"rm551e"` fixtures; asserts rejected POST leaves store/flags/stage untouched and GET writes nothing. Target: every fixture ×3 BusyBox (RM551E reference 188/0).

### Poller (`qmanager_poller`, RM520N)

- Ping via neutral `conn_state_read_env` (`/var/run/qmanager/ping.env`; recon confirms root), fallback `conn_state_read`.
- `connectivity` per contracts §4.1: adds `sensitivity`, `last_leg`, `fail_secs`, `recover_secs`; `profile` = `sensitivity`; `ping_target` = `targets[0]` (visible change from the answering leg); stats and ≤ 60-point downsample from `cq_ring_stats`.
- Quality limits via `cfg_get` + the W1 range check.
- `watchcat` republish: today's 11 keys + the 9 new ones (contracts §4.2); `carrier` accepted as a reason.
- SIM failover from `PF_FAILOVER_MIRROR`; `last_outage` already exists.
- Gated `QCAINFO` + `ca.env` writer only if Q4 = yes.

### Consumer sweep

The old `conn_state.sh` API (`cq_thresholds_load/refresh`, `cq_preset_*`, `cq_quality_merge`, `conn_state_down_for`, `conn_state_cadence <file>`) disappears. Rewrite every caller: `events.sh` (quality debounce becomes seconds, contracts §1 `CQ_CFG_QDEB_*`); `alert_engine.sh`, `sms_alerts.sh`, `email_alerts.sh`, Discord; `monitoring/alerts.sh`; `at_cmd/fetch_ping_history.sh` (history `<rtt> <slot>`); `qmanager_debug_report`; `config_backup_monitoring.sh`; old `wd_quality.sh` callers. Gate: empty grep for retired symbols across `scripts/`.

### Status check

No `poller-parity` on RM520N. Add `tools/cq-wd-status/keys.sh` (jq presence/type checks of `status.json` vs contracts §4.1/§4.2, run read-only on device). Optionally port `status_parity.sh` (Q10).

---

## 7. Harness bring-up (first time on RM520N) and tooling

1. **On RM551E first** (tool change only): make `tools/watchdog-harness` platform-switchable (`-p rm551e|rm520n`, default rm551e); RM551E baselines must stay byte-identical. The switch selects staged adapter, store shim, SSR stub and path rewrites (`uci_set quecmanager.watchcat.K V` → JSON store write so 133 scenarios are untouched; `dmesg_crash` gets a sysfs counterpart; init.d stubs → systemctl stub).
2. Copy the harness into RM520N (shared tool, per-repo `baseline/`).
3. Run RM520N with `-p rm520n` and diff against the RM551E baseline. **Allowed diffs only:** store/path lines (`calls.log`, `tree.txt`: `/usrdata/qmanager`, crash log path); service-call spelling; the 5 SSR scenarios (identity format); the 15 QMI/ca.env scenarios only if Q4 = no. Anything else in `at.log` or `passes.txt` state is a bug.
4. Record RM520N `baseline/` under 1.36.1; 1.29.3 and 1.31.1 must reproduce it.
5. RM520N-only scenarios: store rc 2 (no jq); boolean `true`/`false`; sysfs SSR (down state, count increase, one hold per identity, baseline at start); www-data manual-switch trust; band-failover watcher LOCKED (Q5); recovery-flag PID (N2); helper-raised revert/retry flags; `systemd-run` reboot (N3a).
6. Port `tools/cq-wd-parity/adapter_cc_check.sh` (18 cases) and `poller_thresholds.sh`.
7. RM520N `CLAUDE.md`: one line listing these dev-only tools as the agreed exception to "No test harnesses" (Q1).

---

## 8. Frontend port

**Shared, copied from the RM551E UI merge `1670ec14`:** `components/monitoring/connection-quality/*`, `components/monitoring/watchdog/*`, `hooks/use-connection-quality.ts`, `use-watchdog-settings.ts`, `use-watchdog-indicator.ts`, `types/cq-watchdog.ts`, `types/modem-status.ts` deltas, event-code matching in `lib/event-presentation.ts`.

**Per-repo:** i18n keys into RM520N `common` (watchdog) and `system-settings` (CQ) via a mechanical key-path map, all **6** locales incl. `ru` (check `_pack.json`); keep `sim-swap-banner.tsx`; no `dismiss_sim_swap`; RM520N canon applies (`DESIGN.md`, lucide on `/monitoring/**`, `SegmentedField` `glyph`, `CardFoot`, toasts in every locale, No Debug-Build Copy grep, `HintIcon` Popover). Diff shared primitive props (`badge`, `tag`, `segmented-field`, `card-foot`, `hint-icon`) first. Delete `hooks/use-ping-profile.ts` and `use-quality-thresholds.ts`; fix every consumer of `connectivity.profile`, ping history and `watchcat.*` (dashboard, `/monitoring/latency`, events, alerts).

**Gates:** `bunx tsc --noEmit`, `bun run lint`, `bun run lang check --all`, `bun run icons:check`, `bun run build`, preview against contract fixtures, live check (§10).

---

## 9. Lifecycle lockstep (`install_rm520n.sh`, OTA through the same installer, `uninstall_rm520n.sh`, `build.sh`)

**Install:** copy new libs (`qm_platform_cqwd.sh`, `wd_config/state/detect/quality/carrier/tiers/sim/ledger.sh`, `safe_tmp.sh`, `cqwd_migrate.sh`), the `monitoring/connection_quality.sh` CGI, `qmanager_wd_flag` (0755 root), the sudoers line. `cleanup_legacy_scripts` removes `wd_common.sh`, `wd_ssr.sh`, `wd_recheck.sh`, the two `settings/*.sh` CGIs, and the legacy failover file after migration. Seeds per §5; `migrate_cq_watchdog` runs after the old migrations, `|| true` safe under `set -e`. Units: watchcat `ExecStopPost` also removes `/tmp/qmanager_watchcat_retry_failback` and `/tmp/qmanager_ping_attaching`; ping unit `After=` / bounded wait on `/opt` (R3; recon decides), comment rewritten for `sensitivity` / `targets`; update `build.sh` unit list if units change.

**Uninstall:** remove the new libs, CGI, helper, sudoers line; `/usrdata/qmanager/{sim_failover.json,wd_reboot_guard,wd_link_up}`; `/var/run/qmanager/{ping.env,dns.env,ping_fan,ca.env}`; `/tmp/qmanager_{ping_slots.json,ping_slots.json.tmp,ping_attaching,sim_failover,watchcat_retry_failback,poller_reload}`; existing watchcat/ping flags.

**Gates:** `installer-safety-auditor`; install, uninstall, reinstall dry run on the device (owner OK).

---

## 10. Validation

1. **Static:** `check.sh` in both repos + cross-repo `cmp`; `sh -n` on every changed shell file; `busybox-portability-checker`; grep the RM520N tree for `uci `, `/etc/init.d/`, `/etc/config` and retired `conn_state` symbols; symbol audit (source the stack in a sandbox, `command -v` each name in §3.2).
2. **Harness** ×3 BusyBox: RM520N vs RM551E baseline (allowlist), then RM520N baseline. Load-flaky 27/28: rerun alone.
3. **Contract runner** ×3.
4. **Migrate runner** ×3, `adapter_cc_check.sh`, `poller_thresholds.sh`, status key check.
5. **Blind `qm-verifier`** pass on adapter, CGIs, poller diff and migration.
6. **Live, RM520N-GL `61368cd2`** (prove the device first; every write needs the owner's OK; `sync` after each deploy), mirroring RM551E Step 4:
   - Down-after per sensitivity: blackhole `192.0.2.1` via `save_probe`, and fast-fail iptables OUTPUT reject in its own chain with a sleep failsafe.
   - Airplane mode off and LOCKED exit after a long outage: no immediate Tier 1.
   - Quality ladder exhausted while reachable (custom latency 1 ms): hold-off persists and grows (15/30/60).
   - Budget spent: Tiers 1-3 continue, long-run guard (harness-led; live only the first step).
   - **One controlled Tier 4** that really reboots and is counted (R1/N3).
   - **Tier 2: band lock survives `CFUN 0/1`** (`AT+QNWPREFCFG` before/after; R9b).
   - Band-failover watcher not tripped by a recovery (Q5).
   - Tier 3 failover, confirm, Revert from the UI (helper flag), failback, give-up after 3, Retry (needs two SIMs).
   - SSR: sysfs read only.
   - Carrier trigger: `carrier_cc` from `qmi.env` on LTE CA; SA unknown (Q4).
   - Migration from the real old config captured in recon; Config Backup old↔new.
   - OTA upgrade from the current release, rollback, re-upgrade; uninstall leaves nothing.
   - Reload without restart (PID unchanged).
   - Boot with the watchdog on: rc 2 before `/opt` mounts, so no decision, then normal.
   - UI end to end; all six locales smoke.
7. **RG501Q-EU `b7e3d6f1` smoke:** BusyBox 1.29.3 `timeout -t`, `ping6` fallback, SSR sysfs path, harness parity only.

---

## 11. Docs (RM520N)

- Rewrite `docs/reference/connection-quality.md` and `connection-watchdog.md`.
- Update `docs/reference/README.md`, `platform-matrix.md` (SSR path, KillMode/reboot finding, jq/`/opt` timing), `tmp-file-ownership.md` (new flags/owners, the helper), `qmi-lane.md` (`plat_cc_count` reader), `config-backup.md`, `recent-activities.md` (event codes), `latency-monitor.md` (history format), `adaptive-polling.md` (only if Q4).
- `CLAUDE.md`: tools exception + neutral-file rule ("edit on both repos with `check.sh --update`").
- `RELEASE_NOTES.md`: sensitivity owns cadence; dropped interval override; the watchdog never auto-disables (Tier 4 rests); new targets order; "don't roll back during an active SIM failover"; new backup refused by older releases.
- RM551E: checkpoint row recording the port SHA.

---

## 12. Rollback

- Old keys stay in place (`qmanager.conf` watchcat `fail_threshold/cooldown/check_interval/...`, `ping_profile` `profile/target_host_*/target_ip_*`); only cadence overrides are deleted. The previous tarball reads its own keys; its installer re-seeds `probe_interval=5`.
- Not carried back: an active SIM failover (the migration removed the old record). Release note: revert the SIM before rolling back.
- Left behind: new files under `/usrdata/qmanager` and `/var/run/qmanager` stay inert; the old installer rewrites `sudoers.d/qmanager` wholesale.
- Code: the port lives on its own worktree branch; nothing merged without the owner.

---

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Tier 4 reboot killed with the unit's cgroup (systemd, no `KillMode`) | Recon evidence; N3 (a) `systemd-run` |
| R2 | Revert and Retry never work (www-data flags fail the trust check) | `qmanager_wd_flag` helper (Q2) |
| R3 | `/opt/bin/jq` not mounted when ping/watchcat start → `cfg_get` rc 2 | Unit `After=opt.mount` / bounded wait; harness rc 2 scenario |
| R4 | Recovery-flag PID protocol broken by bare `touch` | N2 |
| R5 | Events file trimmed to 50 rows | N1 |
| R6 | Recovery during band-failover watcher reverts a user band lock | Q5 |
| R7 | `/var/run/qmanager` shared with the broker (0700, re-verified each sample) | Recon; same owner and mode |
| R8 | Wide consumer sweep misses a caller | Retired-symbol grep gate; status key check |
| R9 | RG501Q differences (SSR path, BusyBox 1.29.3) | Per-model path from recon; harness ×3 |
| R10 | RM551E neutral files change after the copy | §4.3 re-sync; Q3 timing |
| R11 | `ping_target` semantics change shows in the dashboard | Frontend sweep; release note |
| R12 | Concurrent `qmanager.conf` writers | Staged ops replayed under the shared flock (§3.1) |

---

## 14. Read-only recon checklist (Phase 1; owner OK to connect; no writes)

Both devices; first prove identity (`cat /etc/quectel-project-version`, serial from `/proc/cmdline`).

1. **BusyBox/applets:** `busybox | head -1`; `timeout` form and `/opt/bin/timeout`; `ping -6`/`ping6` with `-W/-w`; `ip`, `stat -c '%u %h %F'`, `mktemp`, `flock`, `sha256sum`; `/proc/net/ipv6_route` non-`lo` `::/0`; `systemd-run` present?
2. **jq:** `/opt/bin/jq --version`; `all(gen;cond)`, `@tsv`; `/opt` mount time vs `qmanager-ping`/`-watchcat` start.
3. **Config store:** `qmanager.conf` `.watchcat` keys/types, `ping_profile.json`, `quality_thresholds.json`, alert `threshold_minutes` (SMS/email/Discord); owners/modes of `/etc/qmanager`, files, lock; sanitised copies as migrate fixtures.
4. **Init:** units and wants-symlinks; `systemctl show qmanager-watchcat -p KillMode,ExecStartPre`; `sudo -l -U www-data`; **past Tier 4 evidence** (crash.log `tier4_escalation` vs boot times).
5. **SSR:** `subsys0/{state,crash_count}`; `dmesg | grep -i 'remoteproc\|subsys\|mss'`; `qmi.env` `qmi_ssr_count`; RG501Q sysfs path.
6. **AT (queries only):** `qcmd` rc/stdout for OK vs ERROR, CR/LF, echo, timeout; `AT+CFUN?`, `AT+QUIMSLOT?`, `AT+CPIN?`, `AT+QCCID`, `AT+COPS?` formats.
7. **QMI:** `qmi.env` `qmi_state`, `qmi_registered`, `qmi_ca_count` vs `AT+QCAINFO` (PCC included?), `qmi_mono` age, end marker; confirm no `qmi_dms.sh`.
8. **Poller:** user; tiers running `QCAINFO`; reload and tier-2 flag paths; `/var/run/qmanager` owner/mode; `ping.env` writable by the root ping daemon.
9. **Paths/flags:** `/usrdata/qmanager` owner/mode; `/run/qmanager_at/long_running`; config-restore and profile-apply PID files; `fs.protected_regular`; `/tmp/qmanager_events.json` owner/mode.
10. **Locks (R9b):** `tower_lock.json` shape; no band-lock state file; `AT+QNWPREFCFG` `lte_band`/`nsa_nr5g_band`/`nr5g_band` baseline; band-failover watcher PID and flag files; scenario/SIM-profile owner of radio config.
11. **SIM:** `AT+QUIMSLOT?`; second SIM present (decides live Tier 3); how `cellular/settings.sh` switches slots.
12. **lighttpd:** CGI uid, `server.max-request-size`, what an 8193-byte POST does (read config only).
13. **Ping today:** `/tmp/qmanager_ping.json` keys, history format, IPv6 default route on `rmnet`.

Output: one recon report confirming or correcting §2/§3, plus sanitised configs. **STOP for OK.**

---

## 15. Ordered build steps (stop points marked)

0. **Owner approves this plan and answers Q1-Q12. STOP.**
1. Recon (§14) on both devices + repo reads (`profile_apply` flag protocol, band-failover watcher, `cellular/settings.sh` slot switch). **STOP: review recon, confirm bindings.**
2. RM551E prerequisites (if approved): N1, N2, N3 (if needed), harness platform switch; each: commit, `check.sh --update`, harness ×3 identical, contract and migrate runners. **STOP (changes RM551E files).**
3. RM520N worktree from `development` (confirm merge-base). Copy neutral files, manifest, `check.sh`. Add `safe_tmp.sh`, `mono_now*` in `qlog.sh`, `events.sh` code argument. Write the adapter. Port `adapter_cc_check.sh`, add store unit cases.
4. Harness on RM520N: diff vs RM551E against the allowlist, record baseline, add RM520N scenarios. **STOP: review the diff list.**
5. Migration lib, installer function, seeds, `config.sh` defaults, Config Backup, migrate runner ×3.
6. CGIs, `qmanager_wd_flag` + sudoers, old CGI removal, contract runner ×3.
7. Poller, events, alerts, ping-history CGI, debug report, status key check, retired-symbol grep at zero (gated `QCAINFO` only if Q4 = yes).
8. Lifecycle: units, install, uninstall, `build.sh`; `installer-safety-auditor`.
9. Frontend port and gates; preview against fixtures. **STOP: UI review.**
10. Static audit, `busybox-portability-checker`, blind `qm-verifier`. **STOP: ask for the deploy OK.**
11. Live validation (§10.6), each write OK'd; RG501Q smoke.
12. Docs and release note.
13. Final report: branch, git status, live results item by item; ask merge / keep for PR / discard. Never merge without the owner.

---

## 16. Model tiering

- **Opus orchestrates:** plan and adapter design review; judging recon and builder reports with its own reads; harness diff allowlist decisions; all stop points; final validation.
- **Sonnet High builders:** steps 3-9 (adapter/libs, harness switch, migration/backup, CGIs/runner, poller/consumers, lifecycle, mechanical frontend port). Parallel only on disjoint file sets: 5, 6, 7 together after 3/4.
- **Haiku recon:** `qm-scout` per device (read-only shell), repo grep sweeps.
- **RM520N agent pins** (`.claude/agents`; never pass `model`): `qm-scout` Haiku; `qm-worker` / `cgi-endpoint-builder` / `busybox-portability-checker` / `installer-safety-auditor` Sonnet; `ui-builder` / `qm-verifier` / `docs-writer` / `modem-investigator` Opus (Q11).

---

## 17. Open questions for the owner

- **Q1** RM520N `CLAUDE.md` says "No test harnesses". Approve the CQ/WD dev tools (harness, contract, migrate, parity) as the exception the spec requires?
- **Q2** Trusted flags: root helper `qmanager_wd_flag` + sudoers line (recommended), or another way?
- **Q3** Timing: start after RM551E Step 4 live validation (recommended), or in parallel under the §4.3 re-sync rule?
- **Q4** Port the gated SA `QCAINFO` read and `ca.env` into the RM520N poller, or ship v1 LTE/NSA only (SA unknown; the UI already says "not available in 5G SA")?
- **Q5** Treat a running band-failover watcher as LOCKED (adapter `plat_long_running`)?
- **Q6** Add a manual SIM-switch flag to RM520N `cellular/settings.sh` (www-data trust rule), or bind `plat_manual_sim_switch` to "never"?
- **Q7** Keep RM520N's `service_enable_failed` / `service_disable_failed` codes (not in the contract), or map them to `save_failed`?
- **Q8** `sim_dual_capable` stays "assume two" on both repos, or write the cache from the poller's `AT+QUIMSLOT?`?
- **Q9** Add `fixtures.sha256` to `cq-wd-parity` so shared fixtures are hash-checked too?
- **Q10** RM520N status check: lightweight key check (recommended), or port `status_parity.sh`?
- **Q11** Frontend builder: `ui-builder` (Opus, repo pin) or `qm-worker` (Sonnet) for the mechanical copy?
- **Q12** Approve neutral fixes N1 (MAX_EVENTS), N2 (`plat_recovery_flag_raise`, adapter API addition) and, if recon proves R1, N3 (prefer adapter-only `systemd-run`)?

### Critical files

- RM551E: `scripts/usr/lib/qmanager/qm_platform_cqwd.sh`, `tools/cq-wd-parity/check.sh` + `manifest.sha256`
- RM520N (`D:\Projects\QM PROJECT\QManager-RM520N`): `scripts/usr/bin/qmanager_watchcat` (replaced), `scripts/usr/lib/qmanager/{config,platform,conn_state,events,qlog}.sh`, `scripts/install_rm520n.sh`, `uninstall_rm520n.sh`, `www/cgi-bin/quecmanager/monitoring/watchdog.sh`, `usr/bin/qmanager_poller`
