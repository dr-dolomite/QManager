# CQ × Watchdog: frozen contracts (spec v2 §10 step 0)

Status: **frozen 2026-11-07** for the RM551E backend build and the RM520N port. Companion to
`2026-11-07-cq-watchdog-unified-architecture.md` (the spec); section numbers `§` refer to it.
A change to anything here is a spec deviation and needs the owner's OK. Fixtures that pin these
shapes live in `tools/cq-wd-contract/fixtures/`.

Conventions: `int` = JSON integer, `num` = JSON number, `str` = JSON string, `bool` = JSON
`true`/`false`, `|null` = may be JSON `null`. Key order is fixed where the writer is printf-built
(ping.json, ring, ping.env); everywhere else consumers must not depend on order.

## 1. Sensitivity and preset tables (one copy: `conn_state.sh`)

| sensitivity | interval_sec | fail_secs ("down after") | recover_secs | window_sec | quality_debounce_sec | quality_debounce_vt_sec | ring size |
|---|---|---|---|---|---|---|---|
| sensitive | 1 | 8 | 3 | 300 | 12 | 8 | 300 |
| regular | 2 | 12 | 6 | 300 | 12 | 8 | 150 |
| relaxed (default; unknown → relaxed) | 5 | 20 | 10 | 300 | 15 | 10 | 60 |
| quiet | 10 | 40 | 20 | 600 | 30 | 20 | 60 |

Ring size = `ceil(window_sec / interval_sec)`. `quality_debounce_vt_sec` applies when the
metric's preset is `very-tolerant`; both are seconds of new samples, at least 2 samples.

Presets: latency `standard 150 | tolerant 250 | very-tolerant 500 | custom latency_custom_ms (1-10000)`,
breach `avg > limit`. Loss `standard 15 | tolerant 30 | very-tolerant 50 | custom loss_custom_pct (1-100)`,
breach `loss >= limit`. Default `tolerant`/`tolerant`. A stored custom value outside its range
reads as the tolerant default.

Watchdog quality limits (§5.2) = CQ limits raised to floors: `max(latency, 50)` ms, `max(loss, 10)` %.

## 2. `/tmp/qmanager_ping.json` (writer `qmanager_ping`, printf, tmp + mv)

16 keys, this order:

```
{"timestamp":int,"mono":int,"sensitivity":str,"targets":[str,str,str,str],"interval_sec":int,
 "fail_secs":int,"recover_secs":int,"last_rtt_ms":num|null,"reachable":bool,"streak_success":int,
 "streak_fail":int,"fail_elapsed_sec":int,"during_recovery":bool,"last_family":str,"last_leg":int,
 "cycle_ms":int}
```

- `sensitivity`: one of the four names. `targets`: the 4 configured slots in slot order (slot 1 first).
- `last_family`: `ipv4|ipv6|none`. `last_leg`: answering slot `1-4`, `0` = none answered.
- `fail_elapsed_sec`: seconds since the start of the first failing cycle of the current failure
  run; `0` while the last cycle answered.
- Removed vs today: `profile` (→ `sensitivity`), `last_target` (→ `last_leg`).
- Freshness (the one rule, `conn_state_read`): fresh iff `uptime − mono ≤ max(3 × interval_sec, 15)`;
  `mono` 0/absent → wall clock fallback; `mono` ahead of uptime → stale. Stale = fail-closed (`reachable` unknown).

### 2.1 History ring `/tmp/qmanager_ping_history`

One line per cycle, newest last: `<rtt> <slot>` where `rtt` is a one-decimal number or `null`
and `slot` is `1-4`, or `-` when nothing answered (`null -`). Length = ring size (§1); trimmed
(tail) only when the count exceeds size + 10. Truncated at daemon start. Not written during the
attach warm-up (`/tmp/qmanager_ping_attaching` present, at most 120 s). Readers use `$1`; `$2` is
used only to pair jitter samples of the same slot.

### 2.2 `ping.env` sidecar (`PF_RUN_DIR/ping.env`, written right after ping.json, both repos)

Single-quoted assignments, this order, then the end marker; empty/null → `'-'`:

```
_cq_ts _cq_mono _cq_reach _cq_rtt _cq_ss _cq_sf _cq_fe _cq_dr _cq_iv _cq_fs _cq_rs _cq_sens
_cq_fam _cq_tgt _cq_leg _cq_cyc
qm_sidecar_end='1'
```

`_cq_tgt` = `targets[0]`. New vs today: `_cq_fe` (fail_elapsed_sec), `_cq_sens` replaces
`_cq_prof`, `_cq_leg` replaces `_cq_last_target`.

### 2.3 `conn_state_read` / `conn_state_read_env` outputs (CQ_*)

`CQ_STALE CQ_STALE_REASON CQ_AGE_SEC CQ_STALE_THRESHOLD CQ_TIMESTAMP CQ_MONO CQ_REACHABLE(true|false|null)
CQ_RTT_MS CQ_STREAK_SUCCESS CQ_STREAK_FAIL CQ_FAIL_ELAPSED CQ_DURING_RECOVERY CQ_INTERVAL_SEC
CQ_FAIL_SECS CQ_RECOVER_SECS CQ_SENSITIVITY CQ_LAST_FAMILY CQ_TARGET CQ_LAST_LEG(0-4) CQ_CYCLE_MS`.
`CQ_PROFILE` and `CQ_LAST_TARGET` are removed.

Cadence resolver: `conn_state_resolve <sensitivity>` sets `CQ_CFG_SENSITIVITY CQ_CFG_INTERVAL_SEC
CQ_CFG_FAIL_SECS CQ_CFG_RECOVER_SECS CQ_CFG_WINDOW_SEC CQ_CFG_RING_SIZE CQ_CFG_QDEB_SEC CQ_CFG_QDEB_VT_SEC`
(no override argument). `conn_state_cadence` = the same from `cfg_get connection_quality sensitivity`.
`conn_state_tables_json` prints the `tables` object of §5.1.

## 3. `/tmp/qmanager_watchcat.json` (writer `wd_state.sh`)

Full set, read by the watchdog CGI (`status`):

| key | type | meaning |
|---|---|---|
| `timestamp` | int | wall clock of the write |
| `state` | str | `monitor\|suspect\|ssr_hold\|recovery\|cooldown\|holdoff\|radio_off\|locked\|disabled` |
| `enabled` | bool | |
| `current_tier` | int | 0-4; kept after an inconclusive cooldown (§5.4) |
| `recovery_reason` | str\|null | reason of the episode in progress (`outage\|quality\|carrier`; carrier: Amendment 3), null when idle |
| `last_recovery_time` | int\|null | epoch of the last tier action |
| `last_recovery_tier` | int\|null | |
| `last_recovery_reason` | str\|null | `outage\|quality\|carrier` (carrier: Amendment 3) |
| `total_recoveries` | int | |
| `last_success_time` | int\|null | epoch of the last cooldown verdict that was a success (`wd_succeeded`); null until one, or while the wall clock is insane (1970 rule) (Amendment 3) |
| `last_success_tier` | int\|null | tier of that success (Amendment 3) |
| `last_success_reason` | str\|null | `outage\|quality\|carrier` (Amendment 3) |
| `last_success_took_s` | int\|null | seconds from the ladder's trigger to that verdict on the mono clock; null when mono was unreadable. In memory only, reset at daemon start; a natural recovery and a Tier 4 reboot never set these (Amendment 3) |
| `failure_count` | int | = ping `streak_fail` as seen this pass (kept for Prometheus) |
| `failure_secs` | int | current outage age (§5.2), 0 when reachable |
| `cooldown_remaining` | int | seconds, derived from `step_wait_until − mono` (kept for compatibility) |
| `step_wait_until` | int\|null | mono deadline of the current step wait |
| `holdoff_until` | int\|null | mono deadline of the hold-off |
| `holdoff_reason` | str\|null | `outage\|quality\|carrier`: the pause that ends last, a tie goes to outage, then quality (carrier: Amendment 3) |
| `holdoff_carrier_level` | int | 0-2, the step of the 15 → 30 → 60 min carrier hold-off (Amendment 3) |
| `reboots_this_hour` | int | |
| `reboot_budget_exhausted` | bool | |
| `reboot_rest_reason` | str\|null | `hourly\|long_outage` while Tier 4 rests |
| `ssr_hold` | bool | |
| `ssr_hold_until` | int\|null | mono deadline |
| `last_ssr_mono` | int\|null | mono of the last detected SSR |
| `quality_breach_secs` | int | seconds the current quality breach has lasted |
| `carrier_single_secs` | int | seconds the current single-carrier run has lasted (mono), 0 when none (Amendment 3) |
| `carrier_cc` | int\|null | last component-carrier count read (`plat_cc_count`); null when unknown or while `carrier_enabled` is off (Amendment 3) |
| `failback_active` | bool | a primary-SIM recheck is settling |
| `failback_failures` | int | 0-3; 3 = given up until the next save or boot |
| `failback_next_at` | int\|null | mono of the next failback try |
| `sim_failover_active` | bool | |
| `original_sim_slot` | int\|null | |
| `current_sim_slot` | int\|null | |
| `ping_stale` | bool | ping cache stale for more than 5 min (§5.2 dead prober) |
| `mono` | int | uptime of the write; deadlines are interpolated against it |
| `stale_after` | int | heartbeat window (s) |

Reason vocabulary changes from `unreachable` to `outage`. Removed: `quality_breach_count`,
`quality_enabled`, `last_ssr_detected`.

## 4. `status.json`

### 4.1 `connectivity` (both composers; additions in bold)

`internet_available, status, latency_ms, avg_latency_ms, min_latency_ms, max_latency_ms,
jitter_ms, packet_loss_pct, ping_target, latency_history, history_interval_sec, history_size,
during_recovery, profile, thresholds{latency_ms,loss_pct}, dns_lookup_ms, dns_resolver, last_family,
last_outage_s, last_outage_ago_s, last_outage_wan_ip, last_outage_wan_changed,`
**`sensitivity, last_leg, fail_secs, recover_secs`**.

- `latency_history`: ≤ 60 points, oldest first; each point = max RTT of its bucket, `null` only
  when every sample in the bucket was lost. `history_interval_sec` = bucket length in seconds
  (`interval_sec × ceil(ring_size / 60)`), `history_size` = number of points (≤ 60).
- `profile` is kept with the same value as `sensitivity` until the frontend no longer reads it.
- `ping_target` = `targets[0]`. Loss/jitter `null` below 10 samples. `status` =
  `recovery > degraded (loss ≥ loss limit) > connected > disconnected > unknown`.

### 4.2 `watchcat` (hero set)

Today's 11 keys `enabled, state, current_tier, failure_count, last_recovery_time,
last_recovery_tier, total_recoveries, cooldown_remaining, reboots_this_hour, age_sec, stale_after`
**plus** `recovery_reason, step_wait_until, holdoff_until, holdoff_reason,
reboot_budget_exhausted, ssr_hold_until, failback_next_at, ping_stale, mono`.

### 4.3 Prometheus

Unchanged families, including `qmanager_watchdog_failure_count` and `qmanager_watchdog_recoveries`.
No family is removed.

## 5. CGIs

Envelope on every error: `{"success":false,"error":<code>,"field":<str>?,"detail":<str>?}`.
Shared codes: `method_not_allowed`, `invalid_json`, `missing_action`, `unknown_action`,
`invalid_field` (with `field` = the request key, `detail` = English reason), `save_failed`
(the store could not be committed; nothing was published). GET never writes config.

### 5.1 `GET monitoring/connection_quality.sh`

```
{"success":true,
 "settings":{"sensitivity":str,"targets":[str,str,str,str],
             "latency":{"preset":str,"custom_ms":int|null},
             "loss":{"preset":str,"custom_pct":int|null}},
 "cadence":{"interval_sec":int,"fail_secs":int,"recover_secs":int,"window_sec":int},
 "tables":{"sensitivity":{"<name>":{"interval_sec":int,"fail_secs":int,"recover_secs":int,
                                    "window_sec":int,"quality_debounce_sec":int,
                                    "quality_debounce_vt_sec":int}, ...4 names},
           "presets":{"latency":{"standard":150,"tolerant":250,"very-tolerant":500},
                      "loss":{"standard":15,"tolerant":30,"very-tolerant":50},
                      "custom_range":{"latency_ms":[1,10000],"loss_pct":[1,100]}}},
 "is_default":bool}
```

`custom_ms`/`custom_pct` = the stored custom value even while another preset is selected (kept
when switching away), else null. `is_default` = no threshold preset has ever been saved (today's
`isDefault`). `cadence` comes from the stored sensitivity, not the cache.

### 5.2 `POST monitoring/connection_quality.sh`

- `{"action":"save_probe","sensitivity":str,"targets":[str,str,str,str]}`: both keys required.
  Target rule: IPv4 literal, IPv6 literal or hostname; ≤ 128 chars; charset `[0-9A-Za-z.:%-]`;
  no leading `-`; no empty slot. `field` values: `sensitivity`, `targets[0]` … `targets[3]`.
  Raises the ping reload flag. → `{"success":true}`.
- `{"action":"save_thresholds","latency":{"preset":str,"custom_ms":int?},"loss":{"preset":str,"custom_pct":int?}}`:
  `custom_*` required when that preset is `custom`, ignored (stored value kept) otherwise.
  `field` values: `latency.preset`, `latency.custom_ms`, `loss.preset`, `loss.custom_pct`.
  Raises the quality (poller) and watchdog reload flags. → `{"success":true}`.

### 5.3 `GET monitoring/watchdog.sh`

```
{"success":true,
 "settings":{"enabled":bool,"act_after_sec":int,"step_wait_sec":int,
             "tier1_enabled":bool,"tier2_enabled":bool,"tier3_enabled":bool,"tier4_enabled":bool,
             "backup_sim_slot":1|2|null,"max_reboots_per_hour":int,
             "quality_enabled":bool,"quality_after_sec":int,
             "ssr_aware":bool,"ssr_grace_sec":int,
             "failback_enabled":bool,"failback_every_min":int},
 "effective":{"act_after_sec":int,"step_wait_sec":int,
              "quality_limits":{"latency_ms":int,"loss_pct":int}},
 "status":{…§3 object, or {} when the daemon has not written one},
 "sim_failover":{…failover record, or {"active":false}},
 "recent_reboots":[int,…≤5 epochs, newest first],
 "sim_dual_capable":bool,
 "auto_disabled":bool}
```

`effective.act_after_sec = max(act_after_sec, fail_secs)`; `effective.step_wait_sec =
max(step_wait_sec, recover_secs + 20)` (fail/recover from the stored sensitivity).
`auto_disabled` is true only while a pre-upgrade auto-disable flag is present (the new daemon
never auto-disables, §5.6).

### 5.4 `POST monitoring/watchdog.sh`

- `save_settings`: any subset of `settings` keys; an absent key is untouched; `backup_sim_slot:null`
  clears. Ranges: `act_after_sec 15-600`, `step_wait_sec 10-300`, `max_reboots_per_hour 1-10`,
  `quality_after_sec 30-1800`, `ssr_grace_sec 10-120`, `failback_every_min 5-1440`; booleans must
  be JSON booleans; slot `1|2|null`. Two passes: validate everything first, then stage and commit
  once. Cross-field (against the merged result): `tier3_enabled:true` with no slot →
  `invalid_field` `field:"tier3_enabled"`; clearing the slot while Tier 3 stays on →
  `invalid_field` `field:"backup_sim_slot"`; a body that sets `tier3_enabled:true` and
`backup_sim_slot:null` together reports `field:"tier3_enabled"`. Unknown `settings` keys (including
the retired `fail_threshold`, `check_interval`, `cooldown`) → `invalid_field` with that key. Turning Tier 3 off during an active failover is
  allowed. Raises the watchdog reload flag (never restarts the daemon); `enabled` changes
  enable+start / stop+disable the service; a save resets failback give-up and the quality
  hold-off growth. → `{"success":true}`.
- `revert_sim` → `{"success":true}` (the daemon defers it while busy, §5.7).
- `dismiss_sim_swap` (RM551E only) → `{"success":true}`.

Removed endpoints: `system/ping_profile.sh`, `system/quality_thresholds.sh`.

## 6. Events

`append_event <type> <message> [severity] [code]`. With a non-empty `code` the NDJSON row gains
`"code":<str>` after `severity`; without it the row is byte-identical to today. Types stay
`watchcat_recovery` / `sim_failover`.

| code | type | severity | message (English, identical on both repos) |
|---|---|---|---|
| `wd_tier_start` | watchcat_recovery | warning | `Watchcat: starting recovery (Tier N) — internet unreachable` / `… — connection quality degraded` / `… — stuck on one carrier for M min` (Amendment 3) |
| `wd_tier_start` | watchcat_recovery | warning | `Watchcat: re-registering on network (Tier 1)` / `Watchcat: toggling radio (Tier 2)` |
| `wd_tier4_reboot` | watchcat_recovery | error | `Watchcat: rebooting system (Tier 4)` |
| `wd_succeeded` | watchcat_recovery | info | `Watchcat: recovery succeeded (Tier N) — internet connectivity restored` / `… — connection quality restored` / `… — carrier aggregation restored` (Amendment 3) |
| `wd_escalate` | watchcat_recovery | warning | `Watchcat: recovery escalating to Tier N — previous tier did not restore the connection` |
| `wd_holdoff` | watchcat_recovery | error | `Watchcat: all recovery steps tried, pausing N minutes` |
| `wd_ssr_hold` | watchcat_recovery | info | `Watchcat: recoverable baseband restart detected — holding recovery to let the modem self-heal` |
| `wd_radio_paused` | watchcat_recovery | info | `Watchcat: radio is off, recovery paused until it is turned back on` |
| `wd_budget_spent` | watchcat_recovery | warning | `Watchcat: reboot limit reached (N per hour), reboots paused` / `Watchcat: reboots paused until the connection comes back (long outage)` |
| `wd_ping_stale` | watchcat_recovery | warning | `Watchcat: connection probe not reporting, restarting it` |
| `sim_swap` | sim_failover | warning/info | today's Tier 3 swap / confirm / skip texts |
| `sim_revert` | sim_failover | info/warning/error | today's revert texts (user request, backup failed, could not revert) |
| `sim_failback` | sim_failover | info/error | today's recheck / failed-back / kept / still unhealthy texts |
| `sim_failback_giveup` | sim_failover | warning | `Watchcat: primary SIM rechecks stopped after 3 failed tries` |

The quality-trigger line (`connection quality degraded (latency …) — starting recovery`) carries
`wd_tier_start`. The Tier 4 message keeps the literal `Tier 4` + `reboot` (the activity card
de-dups on it for pre-upgrade rows).

## 7. Platform adapter `qm_platform_cqwd.sh`

Function contracts exactly as spec §7, with these RM551E bindings:

| logical | RM551E storage |
|---|---|
| `connection_quality sensitivity` | `quecmanager.ping_profile.sensitivity` |
| `connection_quality targets` (list) | `quecmanager.ping_profile.targets` (UCI list) |
| `connection_quality latency_preset / latency_custom_ms / loss_preset / loss_custom_pct` | `quecmanager.quality_thresholds.*` (same key names) |
| `watchdog <key>` | `quecmanager.watchcat.<key>` (new key names, old keys left in place) |

`cfg_get` rc: 0 value printed, 1 absent, 2 store unavailable (`/etc/config/quecmanager` or `uci`
missing). `cfg_commit` commits the `quecmanager` package. `PF_*` names set by `plat_paths`:
`PF_PING_RELOAD PF_QUALITY_RELOAD PF_WD_RELOAD PF_MAINT_LOCK PF_PROFILE_APPLY_PID
PF_RESTORE_PID PF_SIM_SWITCH_FLAG PF_LONG_RUNNING PF_STATE_DIR PF_FAILOVER_RECORD
PF_FAILOVER_MIRROR PF_CRASH_LOG PF_RUN_DIR PF_DUAL_SIM_CACHE PF_EVENTS_FILE PF_TOWER_LOCK_CONFIG
PF_FORCE_TIER2_FLAG PF_REFRESH_POLICY_FLAG` (the last four added in step 1a; a platform without the
poller-tier or policy-band flags sets them empty and the neutral code skips them).
`plat_tower_failover pause|resume`. `plat_ssr_poll` sets
`PLAT_SSR_MONO` (int or empty) and `PLAT_SSR_ID` (identity string or empty).

## 8. Contract tests

`tools/cq-wd-contract/fixtures/<endpoint>/<case>.json`: `{"method","query","body","setup":{store
keys},"expect":{"status_keys":…,"shape":{json path: type token},"equals":{json path: value}}}`.
Type tokens: `int num str bool null array object` joined with `|`. A runner (step 3) feeds each
request to the repo's CGI with the platform store seeded from `setup` and checks `shape` + `equals`
with jq (no regex).

## 9. Amendment 1 (approved by the owner 2026-11-07, from the approved UI design)

A. **Per-slot live status.** `qmanager_ping` also writes `/tmp/qmanager_ping_slots.json` (printf, tmp + mv,
   after ping.json): `{"mono":int,"slots":[{"state":str,"rtt_ms":num|null}, ×4]}`, `state` one of
   `ok` (answered this cycle, `rtt_ms` set) `miss` (probed, no answer) `skipped` (no route for its
   address family) `standby` (not probed this cycle because a lower slot answered). ping.json stays at
   its 16 keys. `GET monitoring/connection_quality.sh` adds
   `"live":{"reachable":bool|null,"last_leg":int,"slots":[…same objects…]}`; when the cache is stale or
   missing: `reachable:null`, `last_leg:0`, every slot `{"state":"standby","rtt_ms":null}`.
B. **Failback retry** (deviation from spec §5.7, approved). `POST monitoring/watchdog.sh
   {"action":"retry_failback"}` raises a flag the daemon consumes on its next pass: `failback_failures`
   resets to 0 and the next try is scheduled at once. → `{"success":true}` (also when no failover is
   active; the daemon ignores the flag then).
C. **Watchdog status additions** (contract §3 object and the CGI `status`): `offline_secs` (int, raw
   `fail_elapsed_sec` of the last fresh read, 0 when reachable), `reboot_limit` (int, the configured
   `max_reboots_per_hour`), `reboot_rest_until` (int|null, mono when Tier 4 may run again: the hourly
   window end, or the long-outage guard's 24 h end), `holdoff_quality_level` (int 0-2, the step of the
   15 → 30 → 60 min quality hold-off), `tiers_tried` (int array, tiers run in the current episode, in
   order; `[]` when idle). Not republished in `status.json.watchcat`.

## 10. Amendment 2 (approved by the owner 2026-11-07, from the R4 validation)

**Quality cooldown floor.** A quality verdict needs at least 10 samples, but the spec's step wait
`max(step_wait_sec, recover_secs + 20)` plus 3 one-pass extensions gathers only 9 samples on `quiet`
(10 s interval), so every quality recovery there ended inconclusive. Quality cooldowns therefore wait
`max(step_wait_eff, 10 × interval_sec + 10)` seconds (110 s on `quiet`; unchanged on the other
sensitivities with the default `step_wait_sec`). Outage cooldowns and the Tier 3 / SIM settle floor
(90 s) are unchanged. `effective.step_wait_sec` in the watchdog GET stays the outage value.

## 11. Adapter addition (R6, 2026-11-07)

`plat_paths` also sets `PF_PING_SVC`, the service the dead-prober (§5.2) passes to `svc_start` when
the ping cache has been stale for more than 300 s (at most once per 900 s). RM551E: `qmanager` (the
procd service whose `ping` instance is the probe daemon; procd `start` on a running service only
starts missing instances, so the poller instance is left alone; `restart` is never used). RM520N sets
its own unit name in the port.

## 12. Adapter addition (R9a, 2026-11-08)

`plat_manual_sim_switch`: rc 0 while a trusted (root-owned) manual SIM-switch flag
`PF_SIM_SWITCH_FLAG` is up. RM551E: `qm_trusted_file /tmp/qmanager_sim_switch_active` (raised by
`cellular/settings.sh` for a slot switch, trap-cleaned). The watchdog's own Tier 3 swap raises the
same flag; the neutral `check_locked` ignores it while `WD_SWAP_FLAG_OWNED=1` and counts any other
holder for at most 120 s from first sight on the mono clock. The config-restore PID
(`PF_RESTORE_PID`) needs no helper: `check_locked` applies the same `kill -0` test as to the
profile-apply PID. RM520N binds its own flag and trust rule in the port.

## 13. Adapter addition (R9c, 2026-11-08)

`plat_paths` also sets `PF_FAILBACK_RETRY_FLAG`, the flag `POST monitoring/watchdog.sh
{"action":"retry_failback"}` raises (Amendment 1 B) and the daemon consumes on its next pass.
RM551E: `/tmp/qmanager_watchcat_retry_failback`. The daemon honours it only when it is a regular
root-owned file (`qm_trusted_file`, the same rule as the revert flag `qmanager_watchcat_revert_sim`):
a planted flag would make the watchdog cut the link for a recheck. An untrusted flag is removed with
one warning. A trusted flag is removed on sight; with a failover active and `failback_enabled` set it
resets `failback_failures` to 0 and makes the next try due at once (`failback_next_at` shows the
mono of the request until the try starts), otherwise it is only removed. RM520N binds its own path
and trust rule in the port.

Failback give-up (spec §5.7), in the neutral `wd_sim.sh`: a try that ends on the backup slot (the
primary still unhealthy, the swap not verified, or the return not proven) counts as one failure; a
failback, a user revert or a new Tier 3 failover resets the count to 0. The third consecutive
failure stops the tries: one `sim_failback_giveup` event, `failback_failures: 3`,
`failback_next_at: null`. A settings reload clears it (the next try is one full
`failback_every_min` later, not at once), as do a `retry_failback` request and a daemon start; the
count lives in memory only.

## 14. Adapter addition (R11b, 2026-11-08)

`plat_cc_count` sets `PLAT_CC` (component carriers in use, an integer >= 1, or empty = unknown) and
`PLAT_CC_RAT` (`sa` | `lte` | empty) for the opt-in carrier trigger (Amendment 3 A3.3). The neutral
`wd_carrier.sh` calls it only while `carrier_enabled=1`, once per evaluated pass and once per carrier
verdict. `plat_paths` also sets `PF_QMI_ENV` and `PF_CA_ENV`. RM551E binding, in this order:

1. `PF_CA_ENV` = `/var/run/qmanager/ca.env` (the poller's gated AT carrier sidecar, written only
   while `carrier_enabled=1`): complete (every line `ca_*='...'` inside `[A-Za-z0-9_='-]`, last line
   `qm_sidecar_end='1'`), `ca_rat='sa'` (the writer never emits `nrdc`, so `sa` covers NR-DC),
   `ca_mono` at most 90 s older than `/proc/uptime` → `ca_nr_cc` an integer >= 1 gives
   `PLAT_CC=ca_nr_cc`, `PLAT_CC_RAT=sa`; a zero, empty or invalid `ca_nr_cc` reads unknown
   (both empty) and does NOT fall through to `qmi.env` (hardening 2026-11-08).
2. else `PF_QMI_ENV` = `/var/run/qmanager/qmi.env` (the broker's QMI sidecar, every 2 s): complete
   (the `qmi_*` line rule of `_qmi_env_source`, end marker last), `qmi_state='up'`,
   `qmi_registered='1'`, `qmi_ca_count` an integer >= 1 (LTE carriers including the PCC) and
   `qmi_mono` at most 10 s older than `/proc/uptime` → `PLAT_CC=qmi_ca_count`, `PLAT_CC_RAT=lte`
   (LTE, or the NSA anchor side).
3. else both empty.

Both files are parsed line by line and never sourced, with builtins only (no jq, no fork). A number
with a leading zero, more than two digits (counts) or more than ten digits (mono) reads as unknown.
RM520N binds its own source in the port.

## 15. Adapter additions (Step 3a, approved by the owner 2026-11-08)

Two behaviours the Step 3a CGIs need and the earlier sections did not state:

1. `cfg_set` and `cfg_set_list` create a missing UCI section before staging the value. On RM551E
   `uci set quecmanager.<s>.<k>=<v>` on an absent section fails with "Entry not found", so the
   adapter first stages `quecmanager.<s>=<s>` (the section type is its own name, as the installer
   seeds it). This covers a store that was never migrated or seeded (for example a first save to
   `connection_quality` on an old install). Nothing is committed by the adapter; the caller's
   `cfg_commit` still decides. `cfg_del` does not create sections (absent is not an error).
2. `plat_paths` sets `PF_POLLER_RELOAD` (RM551E: `/tmp/qmanager_poller_reload`, the same live-reload
   flag `adaptive_polling.sh` drops). The watchdog CGI raises it with `plat_flag_raise` after a
   successful save that carried `carrier_enabled`, because the poller gates its SA carrier read
   (Amendment 3, `ca.env`) on that toggle. The flag is cleaned by `init.d` and uninstall alongside
   the other reload flags. RM520N binds its own poller reload path (or a no-op if its poller has no
   gated carrier read) in the port.
