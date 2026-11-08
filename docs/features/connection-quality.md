# Connection Quality

Connection Quality is the sensing half of the unified Connection Quality x Watchdog design. `qmanager_ping` probes the internet over ICMP, decides whether the link is reachable, and measures latency and loss. The Connection Quality page (Monitoring -> Connection Quality) sets how that probe behaves: one Sensitivity choice, four probe targets, and the latency and packet-loss limits that Network Events, the dashboard and the Watchdog's quality trigger share. Settings live in `/etc/config/quecmanager`, take effect without a reboot, and are saved through one CGI.

**Responsibility boundary.** Connection Quality senses; the [Connection Watchdog](connection-watchdog.md) acts. Every setting has exactly one writer:

- This page owns the probe cadence (Sensitivity), the targets and the latency/loss limits. Nothing else writes them.
- The Watchdog owns when to act (`act_after_sec`, `quality_after_sec`, `carrier_after_min`) and what to do. It reads this page's Sensitivity and limits; it cannot change them.
- There is **no probe-interval override**. The Watchdog used to be the sole writer of `ping_profile.interval_override`; the key is dropped (the install migration deletes it) and the cadence is whatever Sensitivity says. **Why:** two pages controlling one number made the Watchdog's "start after N failed probes" depend on a cadence the user set elsewhere. The Watchdog's trigger is now a time in seconds (`act_after_sec`), independent of the cadence.

## Quick Reference

| Item | Value |
|---|---|
| Page route | `/monitoring/connection-quality` |
| CGI | `GET/POST /cgi-bin/quecmanager/monitoring/connection_quality.sh` (replaces the removed `system/ping_profile.sh` and `system/quality_thresholds.sh`; no shims) |
| POST actions | `save_probe` (`sensitivity`, `targets[4]`), `save_thresholds` (`latency{preset,custom_ms?}`, `loss{preset,custom_pct?}`) |
| Logical config section | `connection_quality`, routed by the platform adapter `qm_platform_cqwd.sh` (`cfg_get` / `cfg_set` / `cfg_get_list` / `cfg_set_list`) |
| UCI package | `quecmanager` (not `qmanager`) |
| UCI keys | `quecmanager.ping_profile.{sensitivity,targets}` (`targets` is a 4-item list); `quecmanager.quality_thresholds.{latency_preset,latency_custom_ms,loss_preset,loss_custom_pct,alert_after_min}` |
| Retired keys (still routed, never written) | `ping_profile.profile`, `target_ipv4`, `target_ipv6`, `interval_override`. They stay in place after an upgrade so a rollback restores them (see [Migration](#migration-from-the-old-keys)). |
| Reload flags | `/tmp/qmanager_ping_reload` (`save_probe`); `/tmp/qmanager_quality_reload` and `/tmp/qmanager_watchcat_reload` (`save_thresholds`, both) |
| Ping daemon output | `/tmp/qmanager_ping.json`, `/tmp/qmanager_ping_slots.json`, `/tmp/qmanager_ping_history`, sidecars `/var/run/qmanager/ping.env` and `dns.env` |
| Shared reader and cadence table | `scripts/usr/lib/qmanager/conn_state.sh` (`conn_state_read`, `conn_state_resolve`, `conn_state_cadence`, `conn_state_tables_json`, `cq_ring_stats`) |
| Platform adapter | `scripts/usr/lib/qmanager/qm_platform_cqwd.sh` (the only per-repo file; see [Neutral files and the adapter](connection-watchdog.md#neutral-files-and-the-platform-adapter)) |
| Request body cap | 8192 bytes, answered `payload_too_large` before the body is read |
| Reboot required | No |

---

## Sensitivity

One choice replaces the old "ping profile" plus the Watchdog's interval override. The table lives in exactly one place, `conn_state_resolve` in `conn_state.sh`; the CGI generates the `tables` object of its GET from it (`conn_state_tables_json`), and the frontend keeps no copy.

| Sensitivity | Probe every | Down after (`fail_secs`) | Up after (`recover_secs`) | Stats window (`window_sec`) | Quality event debounce | ... when the preset is very-tolerant |
|---|---|---|---|---|---|---|
| sensitive | 1 s | 8 s | 3 s | 300 s | 12 s | 8 s |
| regular | 2 s | 12 s | 6 s | 300 s | 12 s | 8 s |
| relaxed (default) | 5 s | 20 s | 10 s | 300 s | 15 s | 10 s |
| quiet | 10 s | 40 s | 20 s | 600 s | 30 s | 20 s |

- `conn_state_resolve <sensitivity>` is pure (no config read, no override argument). An unknown or empty name resolves to `relaxed`. The ring size is `ceil(window_sec / interval_sec)`.
- `conn_state_cadence` is the same resolve fed from the config store (`connection_quality sensitivity`, falling back to the pre-rename `profile` key). The CGIs use it so their answer is right even while `qmanager_ping` is down.
- Times are seconds, not probe counts. `streak_success` / `streak_fail` in `ping.json` are still per-cycle counts, but nothing decides on them any more: the daemon's own debounce and the Watchdog's `act_after_sec` are wall-clock.

**Why a time table:** the old table stored fail/recover as seconds but the Watchdog counted probes, so the same setting meant 3 s on `sensitive` and 50 s on `quiet`. Seconds mean the same thing at every cadence.

---

## Probe Mechanics

`qmanager_ping` is an ICMP probe daemon, not HTTP/curl. **Why ICMP and not curl/HTTP:** the curl probe gave a false "down" on IPv6-only bearers (the IPv4 HTTP targets were unreachable), and ICMP with an IPv6 slot handles that case.

### Target slots

Four slots, `connection_quality targets` in order; each is an IPv4 literal, an IPv6 literal or a hostname. Defaults: `1.1.1.1`, `8.8.8.8`, `2606:4700:4700::1111`, `cloudflare.com`.

- **Rule (daemon, CGI and Config Backup restore all apply it):** 1-128 characters of `[0-9A-Za-z.:%-]`, no leading `-` (it would be parsed as a `ping` option), no spaces. A slot that fails the rule falls back to its own default in the daemon, with a warning; the CGI rejects it with `invalid_field` (`targets[n]`).
- A hostname slot gets `plat_timeout 4` as well as `-w 3`, because `-w` does not bound the DNS lookup.
- A slot whose family has no route is **skipped**, not failed: an IPv6 literal needs a working `ping -6` / `ping6` (`detect_ping6`, probing `::1` at startup and on every reload) and a non-`lo` `::/0` route in `/proc/net/ipv6_route`. The next usable slot is promoted to "alone".

### The cycle (`probe_cycle`)

1. The first usable slot is probed alone: `ping -c 1 -W 2 -w 3`. If it answers, the cycle is done: a healthy cycle sends one probe.
2. Otherwise every other usable slot runs **in parallel** as background jobs writing to `/var/run/qmanager/ping_fan/r<slot>` (root 0700). The daemon polls the result files every 0.2 s.
3. The winner is the **lowest-numbered slot that answered**, decided as soon as every lower slot has finished; the rest are killed together with their `ping` children. A fixed hard stop one second past the hostname deadline stops a vanished leg from hanging the cycle, and at that stop the lowest answered slot wins. The winner is never "the fastest", so the reported RTT is deterministic.

Results travel through the `PROBE_RTT`, `last_family`, `last_leg` (the winning slot 1-4, `0` = none) and per-slot state globals, not stdout: `rtt=$(probe_cycle)` would run in a subshell and lose them.

### Debounce and loop timing

- **Wall-clock, monotonic.** `_clock` reads `/proc/uptime` in centiseconds with the `read` builtin (no fork). A failure run is timed from the **start** of its first failing cycle; `reachable` flips to `false` once that elapsed time reaches `fail_secs`, and back to `true` once a success run (timed the same way) reaches `recover_secs`. The honest bound is `fail_secs` plus one cycle.
- **Fixed-rate.** After each cycle the daemon sleeps what is left of the interval (fractional, 0.2 s floor), so the period equals the interval whenever the cycle fits; `cycle_ms` publishes the measured period. In an outage a cycle runs the fan-out and outlasts a 1-2 s interval; readers that count samples by time use the larger of `interval_sec` and the rounded `cycle_ms` (`wd_probe_period`).
- If `/proc/uptime` cannot be parsed, the clock advances one interval per read so a failure run still reaches `fail_secs`.

### RTT parser (`parse_rtt`)

Builtins only. It takes the average from the summary line (`round-trip min/avg/max = 12.3/15.6/18.9 ms`, also the iputils `min/avg/max/mdev` form), else the first per-packet `time=<n>`, and rounds to one decimal in integer arithmetic (a leading-zero fraction is kept out of octal with the `1$frac - 100` trick). Only a value > 0 counts as an answer; 100% loss prints no round-trip line and so fails (the fail-safe).

### ping.json schema

```json
{
  "timestamp": 1710700000,
  "mono": 86400,
  "sensitivity": "relaxed",
  "targets": ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "cloudflare.com"],
  "interval_sec": 5,
  "fail_secs": 20,
  "recover_secs": 10,
  "last_rtt_ms": 34.2,
  "reachable": true,
  "streak_success": 12,
  "streak_fail": 0,
  "fail_elapsed_sec": 0,
  "during_recovery": false,
  "last_family": "ipv4",
  "last_leg": 1,
  "cycle_ms": 5010
}
```

`targets` is the four configured slots. `last_rtt_ms` is a number or `null`. `last_family` is `"ipv4"`, `"ipv6"` or `"none"`. `last_leg` is the slot that answered last cycle (`0` = none), so a fallback to slot 2-4 is visible. `fail_elapsed_sec` is how long the current failure run has lasted (0 when not failing): the Watchdog's outage age is built from it. `cycle_ms` is the last measured cycle period, start to start. The file is written with `printf` (no `jq` fork), tmp + `mv`; a failed write keeps the previous file, skips the sidecar and the slots file (they must never be newer than a JSON they do not match) and logs one warning until a write succeeds again.

### Per-slot state (`/tmp/qmanager_ping_slots.json`)

```json
{ "mono": 86400, "slots": [ {"state": "ok", "rtt_ms": 34.2}, {"state": "standby", "rtt_ms": null},
                            {"state": "skipped", "rtt_ms": null}, {"state": "standby", "rtt_ms": null} ] }
```

Exactly four entries. `state` is `ok` (answered), `miss` (probed, no answer), `skipped` (no route for its family) or `standby` (not probed this cycle, or killed because a lower slot won). The CGI's `live.slots` comes from this file, accepted only when it parses, has four well-formed entries and its `mono` is no older than the ping cache's staleness threshold; otherwise every slot reads `standby`.

### History ring (`/tmp/qmanager_ping_history`)

One line per recorded cycle, newest last: `<rtt|null> <slot>` where slot is `1`-`4` or `-` (no answer). Length is the ring size from the table (`ceil(window_sec / interval_sec)`: 300 lines at `sensitive`, 60 at `relaxed`); the file is trimmed to it only once the count passes size + 10, and is emptied at daemon start. The ring is never truncated when the winning slot changes. **Readers use `$1`**, so an older one-column file still parses. Statistics (min/avg/max, jitter, loss, the 60-point history) are computed by `cq_ring_stats` in `conn_state.sh`, the one reducer: jitter is the mean absolute difference between consecutive answers of the **same slot** (a switch to another slot is not jitter), loss keeps every `null`, and loss and jitter read `null` until the window holds `PING_MIN_SAMPLES` (10) samples. The Watchdog's quality trigger reads the same ring through its own window (`read_quality`).

---

## Shared Ping-Cache Reader (`conn_state.sh`)

`scripts/usr/lib/qmanager/conn_state.sh` is the one reader of `/tmp/qmanager_ping.json` and the one cadence resolver. It is sourced, never executed, guarded by `_CONN_STATE_LOADED`, and sources the platform adapter itself (guarded). Consumers that source it must guard the include (`[ -f ... ] && . ...`) and supply a fail-closed stub, because a dot-source of a missing file aborts the script under BusyBox: the poller and watchcat stub `conn_state_read` to "stale"; the CGIs refuse with `internal_error` when the platform functions are missing.

| Function | Contract |
|---|---|
| `conn_state_read` | One `jq` read of the cache into `CQ_*` vars. Returns 0 when fresh, 1 when missing, unreadable, or stale. |
| `conn_state_read_env` | The same read from the `ping.env` sidecar, builtins only (poller only; see [Poller sidecars](#poller-sidecars-pingenv-and-dnsenv)). Same contract and `CQ_*` results, plus return **2** = nothing read, so the caller falls back to `conn_state_read`. |
| `conn_state_why` | Reason for the last non-zero read (`missing`, `unreadable`, `no timestamp`, `mono ahead of uptime`, `age Ns > Ms`). |
| `conn_state_is_up` | True only for a fresh read with `reachable=true`. |
| `conn_state_resolve <sensitivity>` | Pure table lookup -> `CQ_CFG_*` (see [Sensitivity](#sensitivity)). |
| `conn_state_cadence` | `conn_state_resolve` fed from the config store. |
| `conn_state_tables_json` | The `tables` object of the CGI GET, generated from `conn_state_resolve`; restores the caller's `CQ_CFG_*` afterwards. |
| `cq_ring_stats <ring> <interval> <size> <min>` | The history-ring reducer (`CQ_RS_*`). |
| `cq_alert_after_min` | Lives in the adapter now; resolves the single alert wait (see [Alert wait](#alert-wait-alert_after_min)). |

**Verdict vars on a fresh read:** `CQ_REACHABLE` (`true`/`false`/`"null"`), `CQ_RTT_MS`, `CQ_STREAK_SUCCESS`, `CQ_STREAK_FAIL`, `CQ_FAIL_ELAPSED`, `CQ_DURING_RECOVERY`, `CQ_INTERVAL_SEC`, `CQ_FAIL_SECS`, `CQ_RECOVER_SECS`, `CQ_SENSITIVITY`, `CQ_LAST_FAMILY`, `CQ_TARGET` (slot 1), `CQ_LAST_LEG`, `CQ_CYCLE_MS` (empty on an older cache), `CQ_TIMESTAMP`, `CQ_MONO`, `CQ_AGE_SEC`.

**The one staleness rule:** the cache is stale when `age > max(3 * interval_sec, 15)` seconds. `interval_sec` comes from the cache and is clamped to 1-300, anything else becoming 5. `age` is `/proc/uptime` minus the cache's `mono`; the wall clock (`date +%s - timestamp`) is used only when `mono` is absent or `0`.

**Why:** a fixed window ignored the cadence, so a slow sensitivity made readers mark connectivity unknown on every cycle. Three probe intervals with a 15 s floor tolerates one or two lost cycles without hiding a dead daemon.

**Fail-closed:** any problem (missing, unreadable, stale, `mono` ahead of uptime, no timestamp) leaves `CQ_STALE=1` and `CQ_REACHABLE="null"`. A `mono` ahead of uptime cannot come from this boot's daemon (`/tmp` is tmpfs), so it is treated as garbage, not as fresh. A missing or corrupt `reachable` also reads as `"null"`, never as up. A stale cache is **no signal, not healthy**: the Watchdog keeps its previous values and skips the pass (it raises `ping_stale` after 300 s; see [connection-watchdog.md](connection-watchdog.md#dead-prober-ping_stale)).

> ⚠️ WARNING: Do not add regex (`test()`, `sub()`) to the lib's `jq` program. The device `jq` is built without Oniguruma and fails at runtime.

---

## Quality Thresholds

The latency and packet-loss limits decide when `events.sh` (`detect_data_connection_events`, [below](#one-detector-eventssh)) fires `high_latency`, `latency_recovered`, `high_packet_loss` and `packet_loss_recovered` into the Recent Activities log, when the dashboard grades a figure, and when the Watchdog's quality trigger sees a breach. One save moves all three. The Watchdog adds its own floors on top (50 ms / 10 %, on the Watchdog page only; this page shows the values as entered).

**Latency basis:** both the Network Events path and the Watchdog's quality trigger compare against the **windowed average** RTT (`avg_latency_ms`), never a single probe, so one noisy sample cannot fire an event.

### Preset table

| Preset | Latency | Packet loss |
|---|---|---|
| standard | 150 ms | 15 % |
| tolerant (default) | 250 ms | 30 % |
| very-tolerant | 500 ms | 50 % |
| custom | 1-10000 ms | 1-100 % |

- **Custom loss starts at 1 %.** A custom loss of 0 % would breach on every pass under the `>=` comparison, so the range is 1-100. A stored or restored `0` is read as invalid (tolerant default); Config Backup restore converts a backup's `0` to `1`.
- **Stored custom limits are range-checked wherever they are read** (the CQ CGI, the Watchdog's `resolve_quality_thresholds` and its CGI mirror `wd_quality_limits`, the poller's `resolve_quality_thresholds` via `_qt_custom_or`): a non-numeric, empty or out-of-range value (latency outside 1-10000, loss outside 1-100) reads as the tolerant default (250 ms / 30 %), and a `custom` preset without a valid custom value reads as `tolerant`. A hand-edited `latency_custom_ms=0` therefore cannot make every probe a breach. `tools/cq-wd-parity/poller_thresholds.sh` pins the poller side.
- The `QUALITY_PRESETS` constant in `types/modem-status.ts` is `["standard", "tolerant", "very-tolerant", "custom"]`.
- **Event debounce is in seconds and comes from the Sensitivity table** (`quality_debounce_sec`; the shorter `quality_debounce_vt_sec` applies when that metric's preset is `very-tolerant`). A run is due once it spans at least 2 new samples (a changed ping timestamp) and at least that many seconds of uptime (`_ev_qdeb_due`).

### One Detector (`events.sh`)

`detect_data_connection_events` in `scripts/usr/lib/qmanager/events.sh` is the **only** place link transitions (`internet_lost` / `internet_restored`) and quality pairs (`high_latency` / `latency_recovered`, `high_packet_loss` / `packet_loss_recovered`) are decided (ledger B2.3). The poller calls it every cycle from the always-run local block, after `read_ping_data` / `read_dns_data` and before `alert_engine_check`. It publishes `ev_link_state` (`"down"`, `"up"`, or `""` for stale or unknown) and the alert engine follows that value instead of keeping its own edge detector. **Why:** two detectors disagreed under watchdog recovery (live: two consecutive `internet_lost` with no restore between, and a `high_packet_loss` 100 % logged during an outage).

**Link rules, in order**

- It follows the ping daemon's reachable verdict (`conn_internet_available`), never `conn_status` (`"recovery"` would mask it), so a watchdog-fixed outage still logs `internet_restored`.
- Stale or unknown ping data is no transition; every counter stays frozen.
- The first reading after a poller start is adopted silently.
- The first true to false edge always logs `internet_lost`, even when the watchdog raised its recovery flag before the poller saw the drop. Only a **repeat** drop after a restore inside the same recovery window is held (`ev_recov_restored`, cleared when the daemon's recovery flag clears), so one outage logs exactly one lost/restored pair.

**Quality rules**

- Frozen while the link is down (the outage is the record).
- Debounced on **entry and exit** by the Sensitivity-table seconds above: a 40/0/40 flicker logs nothing.
- Entry is held while `CQ_STREAK_FAIL > 0` (the daemon is counting failures, the run-up to a down verdict) and for one stats window (`window_sec`) after a restore, because the outage nulls are still in the ring. Exits are never held.
- Latency basis is the windowed average (`conn_avg_latency`, "null" = no reading); thresholds come from the `QUALITY_*` globals including `custom`.

**Degraded status.** In `status.json`, `connectivity.status` is `"degraded"` when packet loss is at or above `QUALITY_LOSS_THRESHOLD`. Latency alone never degrades the status. The cuts are published as `connectivity.thresholds: { latency_ms, loss_pct }` so the UI grades against the configured values (`ConnectivityStatus.thresholds?` in `types/modem-status.ts`; absent on an older poller).

### Alert wait (`alert_after_min`)

One outage wait serves every alert channel (see [Alerts](alerts.md#one-alert-wait-for-every-channel)): `quecmanager.quality_thresholds.alert_after_min`, minutes, **1-1440**. The resolver `cq_alert_after_min` (in the adapter, reachable through `conn_state.sh`) sets `CQ_ALERT_AFTER_MIN` from that key, else `/etc/qmanager/sms_alerts.json` `threshold_minutes`, else `email_alerts.json` `threshold_minutes`, else 5. This page does not edit it: the Alerts page writes it (via `monitoring/alerts.sh`), and Config Backup carries it inside the `connection_quality` section ([config-backup-restore.md](config-backup-restore.md)).

### Why absence == default (never seeded)

The `quecmanager.quality_thresholds` section is **never seeded by the installer** and never created on read. Its absence is the "user has not changed this" signal: the GET reports `is_default: true` when **neither `latency_preset` nor `loss_preset` is stored** and shows `tolerant/tolerant`; the poller and the Watchdog fall back to the same pair. The section can exist while `is_default` is still `true`: `monitoring/alerts.sh` creates it to hold `alert_after_min` alone. The first `save_thresholds` writes both presets, and from then on `is_default` is always `false`.

The one installer exception is a one-time, idempotent migration from the retired `watchcat.latency_ceiling_ms` / `loss_ceiling_pct` keys, which seeds a `custom` preset (see [Migration](#migration-from-the-old-keys)).

> ℹ️ NOTE: To reset a device to "default" and also drop the alert wait, remove the section: `uci delete quecmanager.quality_thresholds && uci commit quecmanager`. To keep the wait, delete just `latency_preset`, `loss_preset` and the custom keys.

---

## Apply / Reload Pipeline

```
connection_quality.sh POST save_probe
  ──cfg_set sensitivity + cfg_set_list targets──▶ cfg_commit (uci commit quecmanager)
  ──touch /tmp/qmanager_ping_reload
                 │
  qmanager_ping reads flag ──▶ load_config() + detect_ping6() ──▶ rm flag

connection_quality.sh POST save_thresholds
  ──cfg_set presets (+ custom values) ──▶ cfg_commit
  ──touch /tmp/qmanager_quality_reload     (poller: events, degraded status)
  ──touch /tmp/qmanager_watchcat_reload    (watchdog: quality trigger limits)
                 │
  qmanager_poller reads quality flag ──▶ resolve_quality_thresholds() ──▶ rm flag
  qmanager_watchcat reads watchcat flag ──▶ read_config() ──▶ rm flag
```

> ⚠️ WARNING: **`save_thresholds` must always raise BOTH reload flags**, `/tmp/qmanager_quality_reload` and `/tmp/qmanager_watchcat_reload`. The limits feed two daemons; omitting either leaves one on stale limits until its next restart. The Watchdog deliberately does not consume the quality flag (the poller owns its deletion). Config Backup restore of the `connection_quality` section raises all three flags (it can change sensitivity, targets and limits at once).

Daemons check their flag at the **top of the main loop**, so a saved change takes effect within one cycle (at most about 10 s on `quiet`, 1 s on `sensitive`) without a restart. A `save_probe` that changes the sensitivity also changes the Watchdog's effective floors (`act_after_sec` is raised to the new `fail_secs`); the Watchdog reads the cadence from the ping cache, so it follows on the next pass.

---

## CGI Envelope

`GET/POST /cgi-bin/quecmanager/monitoring/connection_quality.sh`. Contract: `docs/plans/2026-11-07-cq-watchdog-contracts.md` §5.1-5.2 and §9 A, plus Amendment 3 A3.1. The contract fixtures live in `tools/cq-wd-contract/` ([Test tools](#test-tools)).

### GET

```json
{
  "success": true,
  "settings": {
    "sensitivity": "relaxed",
    "targets": ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "cloudflare.com"],
    "latency": { "preset": "tolerant", "custom_ms": null },
    "loss": { "preset": "tolerant", "custom_pct": null }
  },
  "cadence": { "interval_sec": 5, "fail_secs": 20, "recover_secs": 10, "window_sec": 300 },
  "tables": {
    "sensitivity": { "sensitive": { "interval_sec": 1, "fail_secs": 8, "recover_secs": 3, "window_sec": 300,
                                    "quality_debounce_sec": 12, "quality_debounce_vt_sec": 8 }, "...": "regular, relaxed, quiet" },
    "presets": { "latency": { "standard": 150, "tolerant": 250, "very-tolerant": 500 },
                 "loss": { "standard": 15, "tolerant": 30, "very-tolerant": 50 },
                 "custom_range": { "latency_ms": [1, 10000], "loss_pct": [1, 100] } }
  },
  "live": { "reachable": true, "last_leg": 1,
            "slots": [ {"state": "ok", "rtt_ms": 34.2}, {"state": "standby", "rtt_ms": null},
                       {"state": "standby", "rtt_ms": null}, {"state": "standby", "rtt_ms": null} ] },
  "last_outage": { "duration_s": 40, "ended_ago_s": 130, "wan_changed": true },
  "is_default": false
}
```

- `settings` is the **stored** configuration with every missing or invalid value replaced by its default (slot defaults above; an invalid slot reads as its slot default). `custom_ms` / `custom_pct` are `null` unless the stored custom value is valid; an invalid custom value turns that preset into `tolerant`.
- `cadence` is the stored Sensitivity's row (`conn_state_cadence`), correct while the daemon is down. `live` comes from the ping cache and is `reachable: null`, `last_leg: 0` and four `standby` slots when the cache is stale or missing.
- `last_outage` (Amendment 3 A3.1) is read from `/tmp/qmanager_last_outage` (the file the alert engine writes; see [Last Outage](#last-outage)), `null` until an outage clears this boot or when the file is unreadable or its end stamp is ahead of uptime. `wan_changed` is `true`, `false` or `null`. Durations are measured between the debounced edges (start about `fail_secs` late, end about `recover_secs` late), so the UI says "about". An outage still in progress is `live.reachable === false` plus the ping cache's `fail_elapsed_sec`, not this field.
- The GET never writes config.

### POST `save_probe`

```json
{ "action": "save_probe", "sensitivity": "regular",
  "targets": ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "cloudflare.com"] }
```

`targets` must be an array of **exactly four** strings. Success is `{ "success": true }`.

### POST `save_thresholds`

```json
{ "action": "save_thresholds",
  "latency": { "preset": "custom", "custom_ms": 400 },
  "loss": { "preset": "tolerant" } }
```

`custom_ms` / `custom_pct` are required, and range-checked, only when that preset is `custom`; with a named preset they are ignored (even when out of range) and the stored custom value is kept. They must be integer-valued JSON numbers. Success is `{ "success": true }`.

### Errors

HTTP 200, `success:false`. A validation failure is checked before anything is staged, so nothing needs reverting.

| `error` | Meaning |
|---|---|
| `invalid_field` | Carries `field` and `detail`. Fields: `sensitivity`, `targets`, `targets[0]`-`targets[3]`, `latency.preset`, `latency.custom_ms`, `loss.preset`, `loss.custom_pct`. |
| `payload_too_large` | `CONTENT_LENGTH` is not a plain number or exceeds 8192. Checked before the body is read, so a large POST never reaches `dd`. |
| `no_body`, `invalid_json` | Empty body; body is not a JSON object. |
| `missing_action`, `unknown_action` | `action` absent / not `save_probe` or `save_thresholds`. |
| `save_failed` | A `uci set` or `commit` failed; staged changes are reverted. |
| `internal_error` | The platform library (`cfg_get`, `conn_state_cadence`, `plat_flag_raise`) is missing. |
| `method_not_allowed` | Not GET or POST. |

---

## Migration from the old keys

The install migration (`cqwd_migrate.sh`, `cqm_migrate_uci`) runs from `install.sh` `seed_uci_defaults` (tarball, OTA and the ipk `--configure` all run it after the library directory is copied) and from the Config Backup restore, so the formulas cannot drift. Details and the Watchdog half are in [connection-watchdog.md](connection-watchdog.md#migration-from-the-old-keys). For this page:

| Old | New | Rule |
|---|---|---|
| `ping_profile.profile` (or an unknown value) | `ping_profile.sensitivity` | Same four names; unknown reads `relaxed`. Written only while `sensitivity` is absent, so a stored sensitivity always wins. |
| `ping_profile.target_ipv4`, `target_ipv6` | `ping_profile.targets` (list of 4) | `[target_ipv4, second IPv4, target_ipv6, cloudflare.com]`. The second IPv4 is the old hidden alternate: `1.1.1.1` when `target_ipv4` was `8.8.8.8`, `8.8.4.4` or `dns.google`, else `8.8.8.8`. A missing or invalid old target reads as its old default, so two defaults give exactly the new default list. |
| `ping_profile.interval_override` | dropped | Deleted after `act_after_sec` has used it. The saved sensitivity stays. |
| `watchcat.latency_ceiling_ms`, `loss_ceiling_pct` | `quality_thresholds` `custom` preset | `install.sh` keeps the **Watchdog-side** values (device defaults were 800 ms / 20 %); runs only while a ceiling key exists. |

Old keys stay in place, except `interval_override` (dropped), the two watchcat ceilings (moved into the custom limits and deleted) and `max_failures` (renamed to `fail_threshold` by an earlier install step), so reinstalling the previous release restores the pre-upgrade values for everything else. The migration is idempotent: every new key is written only while absent. `install.sh` also deletes the long-retired `target_1` / `target_2` HTTP keys and the stale `system/ping_profile.sh` and `system/quality_thresholds.sh` CGI files, and, when the migration changed anything, touches the three reload flags so running daemons re-read.

---

## DNS Lookup Time

Per-site latency (TCP handshake to a list of websites, with history) is a separate daemon outside the verdict: see [Sites Monitor](sites-monitor.md).

`qmanager_ping` also times a DNS lookup and the poller publishes it as `connectivity.dns_lookup_ms` (ledger B2.2). It is a separate reading from the ICMP probe.

**Contract.** The daemon runs `nslookup one.one.one.one <resolver>` in a detached background job, where `<resolver>` is the first `nameserver` in `/etc/resolv.conf`, re-read on every run. On the RM551E that is the carrier resolver (`/etc/resolv.conf` -> `/tmp/resolv.conf` -> `/tmp/resolv.conf.d/resolv.conf.auto`), not dnsmasq. The job writes `/tmp/qmanager_dns.json` (mode 644, atomic temp-and-rename):

```json
{ "ms": 52, "ok": true, "resolver": "10.0.0.1", "name": "one.one.one.one", "mono": 123456, "ts": 1760000000 }
```

`ms` is `null` when `ok` is `false`. Success means `nslookup` exited 0 and printed an `Address` line after a `Name:` line.

**Schedule.** Every 60 s, plus a forced lookup on a reachable `true` to `false` edge with a 10 s floor between forced runs. At most one job runs at a time (PID file, zombie check and a 15 s age guard). The job is never run inline in the probe loop, so the probe cycle (about 4 s at worst) is unchanged. **Why:** a slow or dead resolver would otherwise stall probes and the reachability verdict.

**Timing and bound.** The lookup is bounded at 5 s by the BusyBox `timeout` applet through the adapter's `plat_timeout`; a killed lookup exits 143 and reports `ok:false`. Elapsed time comes from `/proc/uptime` centiseconds, so the quantum is 10 ms and `ms` is floored at 10.

**Freshness gate.** The poller's `read_dns_data` publishes `dns_lookup_ms` as a number only when `ok` is true and the sample `mono` age against `/proc/uptime` is 0 to 180 s; otherwise `null`. `dns_resolver` is the resolver string, or `null` when unknown or stale. Both land in `/tmp/qmanager_status.json` under `connectivity` and in the `at_cmd/fetch_data.sh` response. The TS type `ConnectivityStatus` carries optional `dns_lookup_ms?: number | null` and `dns_resolver?: string | null`.

> ℹ️ NOTE: Live numbers on the RM551E are 40 to 70 ms against the carrier resolver. A dead resolver (`192.0.2.1`) gives `ok:false`, `ms:null` after 5.07 s.

> ⚠️ WARNING: The DNS reading is independent of the ICMP verdict. During validation ICMP reported unreachable while the carrier resolver kept answering at 40 to 70 ms. A consumer (ledger U4.7, the Connection Quality cards) must not read a DNS number as "online"; use `internet_available` for that.

`uninstall.sh` removes `/tmp/qmanager_dns.json`, `/tmp/qmanager_dns_out.*` and `/tmp/qmanager_dns.json.??????`.

---

## Last Outage

The poller publishes the most recently cleared outage as `connectivity.last_outage_s` (its length) and `connectivity.last_outage_ago_s` (seconds since it cleared). Both are `null` until one clears this boot, and absent on an older poller. Issue #27. The Connection Quality CGI reads the same file for its own `last_outage` field (no second writer): `{ duration_s, ended_ago_s, wan_changed }`, `null` until an outage clears this boot (Amendment 3 A3.1).

- **Source.** The alert engine's outage machine (`alert_engine.sh::_ae_handle_up`), which follows the one detector's `ev_link_state` and runs whether or not any alert channel is enabled. Every outage counts, however short; the `alert_after_min` wait gates only messages.
- **Clock.** The end stamp is `mono_now`, and `_wc_prepare` publishes the age as `_WC_MONO - end_mono`. A NITZ/ntpd step or a skewed browser clock cannot distort "ago"; never switch this to a wall-clock epoch compared with `Date.now()`.
- **WAN IP.** `connectivity.last_outage_wan_ip` (IPv4 preferred, else IPv6, else `null`) and `last_outage_wan_changed` (`true` / `false`, `null` when either side is unknown). The address comes from the kernel routing table (`_ae_wan_read`: the default route's `src`, and the IPv6 default route's device's global address), **never `t2_wan_*`**: those refresh only when someone opens the on-demand radio details, so they would report the pre-outage IP as the new one. The "before" side is read at outage start, falling back to the last address seen while up (`_ae_wan_seen*`, refreshed at most every 30 s, two `ip` forks, no AT). The "after" side is read when the outage clears, when probes already answer, so the bearer holds its current address.
- **Lifetime.** `"<seconds> <end_mono> <changed|-> <wan4|-> <wan6|->"` is written to `/tmp/qmanager_last_outage` (`qm_atomic_write`) and reloaded by `alert_engine_init`, so a poller respawn keeps it. A reboot clears it, which is correct: the mono base resets, and a reboot is its own event (Recent Reboots). The loader drops garbage and an end stamp ahead of the current uptime, and still reads the older two-field file (WAN fields stay null).
- **Both composers.** The printf composer (`_kN`) and `write_cache_jq` both emit all four fields; keep them in step (the `wc_parity` dump compares them).
- **Uninstall** removes `/tmp/qmanager_last_outage`; install and update need nothing (tmpfs).

The dashboard card shows it as the tile's fourth row (`history` glyph): "40s (2m ago)", or "None" in the quiet variant ink. It is a fact, not a verdict, so it has no chip or tone; the reachability verdict above it already carries any live outage, and the row keeps showing the last cleared one meanwhile. When the WAN IP is known, a `HintIcon` trails the label: "Reconnected with a new WAN IP:", "…the same WAN IP:" or "Reconnected on WAN IP:" (change unknown), with the address in mono. A tip rather than a tooltip because it must open on tap.

---
## Poller sidecars (`ping.env` and `dns.env`)

Since B5.29 Phase C `qmanager_ping` also writes two shell-assignment files in `/var/run/qmanager` (root 0700, created on demand), so the poller can read ping and DNS data with builtins instead of forking `jq` every 2 s cycle. They are **additive**: `ping.json` and `dns.json` keep their paths and shapes, and every other reader (the CGIs, the watchcat) still reads the JSON.

| File | Written by | Right after | Variables |
|---|---|---|---|
| `/var/run/qmanager/ping.env` | `write_ping_env` in `qmanager_ping`, after every `ping.json` write | the successful `mv` of `ping.json` | `_cq_ts`, `_cq_mono`, `_cq_reach`, `_cq_rtt`, `_cq_ss`, `_cq_sf`, `_cq_fe`, `_cq_dr`, `_cq_iv`, `_cq_fs`, `_cq_rs`, `_cq_sens`, `_cq_fam`, `_cq_tgt`, `_cq_leg`, `_cq_cyc` (the 16 raw fields `conn_state_read` extracts; null or empty becomes `-`) |
| `/var/run/qmanager/dns.env` | `write_dns_env`, from the detached DNS job | the successful `mv` of `dns.json` | `dns_s_ok`, `dns_s_ms`, `dns_s_mono`, `dns_s_res` (`ms` is `null` when the lookup failed) |

- **Format.** Every line is `name='value'` with `'` written as `'\''`, and the last line is `qm_sidecar_end='1'`. Files are written to `<name>.new` and renamed.
- **Who reads them.** Only the poller. `read_ping_data` calls `conn_state_read_env` first and falls back to `conn_state_read` on return 2; `read_dns_data` sources `dns.env` and falls back to its builtin JSON-shape parser, then to `jq`. `conn_state_read` is unchanged and remains the watchcat's reader.
- **When a sidecar is ignored.** The reader refuses a sidecar that is missing, **older than its JSON** (`-nt`: the upgrade window before `qmanager_ping` restarts, or a failed sidecar write), or incomplete (any line not a single-quoted assignment, or no end marker). A line the checker rejects is never sourced. **Why:** a syntax error in a dot-sourced file aborts the whole script under BusyBox, and the poller must never die from a half-written file.
- **Best effort.** A sidecar write failure returns non-zero from `write_ping_env` but never fails the probe cycle; the poller simply reads the JSON on that cycle.
- **Freshness is unchanged.** The staleness rule above is evaluated by `conn_state_read_env` from the sidecar's `_cq_mono` and `_cq_iv`, in lockstep with `conn_state_read`. If you change one, change both.
- **Lifecycle.** `init.d/qmanager` `stop_service` removes both files and their `.new` temps; the files live on tmpfs.

---
## status.json / Poller Surface

The poller merges the probe's verdict into `status.json` `connectivity` from `/tmp/qmanager_ping.json`, read through `conn_state_read` (or the `ping.env` sidecar). Consumers should treat each key as optional: it is absent on older poller output and on the first write before the ping daemon has run. When the cache is **missing** the poller clears the probe fields; when it is **stale** it keeps them and only marks connectivity unknown.

- **New keys:** `connectivity.sensitivity` (string), `last_leg` (0-4, the slot that answered), `fail_secs`, `recover_secs`. `connectivity.profile` is deprecated and no longer filled. `ConnectivityStatus` in `types/modem-status.ts` carries them as optional.
- `connectivity.last_family` is `"ipv4"`, `"ipv6"`, `"none"` or `""` (older poller output). The frontend reads it for the "Currently reachable via IPv6" indicator.
- The statistics (`min/avg/max_rtt_ms`, `jitter_ms`, `packet_loss_pct`, `history`) come from `cq_ring_stats` over the ring.

### Packet-loss maturity guard (`PING_MIN_SAMPLES`)

`cq_ring_stats` reports `packet_loss_pct` and `jitter_ms` as `null` while the window holds fewer than `PING_MIN_SAMPLES=10` samples (the poller passes 10; the published `packet_loss_pct` is `null` until the window matures, and the degraded-status check reads that as 0). The all-null arm (total outage) is suppressed the same way. Min/avg/max and the history array are unaffected.

**Why:** the ring is emptied on every (re)start of `qmanager_ping`. In the first seconds after a reboot or daemon restart the window may hold a handful of samples, and two transient boot-attach nulls in a 4-sample window read as 50 % loss, above the default quality limit. Live evidence: 0 % real loss on sustained probing, with every false breach inside the first ~78 s after daemon start. The guard costs nothing on a stable connection. Genuine total outages are caught independently by the reachability verdict (`fail_elapsed_sec`), which this guard does not touch. The Watchdog's own `read_quality` needs at least 10 samples since its window mark for the same reason.

Both `/tmp/qmanager_ping.json` and `/tmp/qmanager_status.json` carry a root-level **`mono`** integer next to the wall-clock `timestamp`: `mono_now()` from `qlog.sh`, integer seconds since boot from `/proc/uptime`, immune to NTP/NITZ steps. `conn_state_read` computes ping-cache staleness from it, falling back to the wall clock only when `mono` is absent, zero or non-numeric. **Why:** after an MPSS SSR the NITZ `time_daemon` and `ntpd` step the wall clock about 90 s forward, which produced a false "ping data stale" reading.

---

## Frontend

Rebuilt 2026-11-08 on the unified CGI `monitoring/connection_quality.sh` (contracts `docs/plans/2026-11-07-cq-watchdog-contracts.md` §5.1-5.2, §9 A; Amendment 3 A3.1). The old `system/ping_profile.sh` / `system/quality_thresholds.sh` hooks are gone. The frontend keeps NO copy of the sensitivity or preset tables: every number comes from the GET's `tables`.

| File | Purpose |
|---|---|
| `app/monitoring/connection-quality/page.tsx` | Route entry point (the old `/system-settings/connection-quality` is a client-side redirect stub) |
| `components/monitoring/connection-quality/connection-quality.tsx` | Page shell: one `useConnectionQuality()` passed to both cards of the pair |
| `components/monitoring/connection-quality/probe-targets-card.tsx` | Probe Targets: slot 1 under Primary, slots 2-4 under Fallbacks (one `HintIcon`), a numbered disc per slot carrying the live `live.slots[n].state` (ok / miss / skipped / standby), the answering slot (`live.last_leg`) lit, live verdict in the `CardFoot` status. Save sends `save_probe` with the SAVED sensitivity and the draft targets; a rejected `targets[n]` lands on that slot |
| `components/monitoring/connection-quality/last-outage-row.tsx` | A3.1 "Last outage": "About N", "Ended N ago (WAN IP changed)", "None since the last restart" when null, "Down now" while `live.reachable === false` |
| `components/monitoring/connection-quality/sensitivity-quality-card.tsx` | Sensitivity and Quality: 4-option `SegmentedField` over an Every / Down after / Up after comparison grid, then Latency and Packet loss (preset pills, Custom field with the range from `tables.presets.custom_range`, "Right now" from `connectivity.avg_latency_ms` / `packet_loss_pct`, amber over the limit). One Save: `save_probe` (draft sensitivity + saved targets) when the sensitivity changed, then `save_thresholds`, one toast. Values shown as entered; the 50 ms / 10 % watchdog floors live on the Watchdog page only |
| `components/monitoring/connection-quality/{shapes.ts,condition-block.tsx}` | Family-local geometry and the error state block (never imported across families) |
| `components/dashboard/connection-quality.tsx` (shapes from the dashboard `shapes.ts` since U4.10) | Dashboard card that replaced Live Latency: Internet / DNS lookup / Probing / Last outage rows, 30-minute reachability and jitter strips from `fetch_ping_history.sh`, Typical / Worst / Loss |
| `hooks/use-connection-quality.ts` | GET + `saveProbe` + `saveThresholds` |

Wire types and the hook contract are in `types/cq-watchdog.ts` (`CqGetResponse`, `UseConnectionQualityReturn`, `CqWdMutationResult`). `ConnectivityStatus` in `types/modem-status.ts` gains optional `sensitivity`, `last_leg`, `fail_secs`, `recover_secs`; `profile` is deprecated.

**Hook contract.** `useConnectionQuality()` GETs on mount and every 5 s while the tab is visible (`lib/visible-interval.ts`), silently: a failed poll keeps `data` and sets only `error`, and `data.settings` keeps its object identity while the values are unchanged so drafts survive polls. `live` missing reads as unknown (every slot standby). `saveProbe` / `saveThresholds` never throw: they resolve to `{ ok, message, code, field }` (message through `resolveErrorMessage`, `field` from the envelope such as `targets[2]` or `latency.custom_ms`) and re-GET before returning. The cards toast from that result, never from hook state after the await.

**Dashboard card.** The verdict line is `connectivity.status` only (`connected` Responsive, `degraded`/`recovery` Degraded, `disconnected` Unreachable, else Not measured) and links to `/monitoring/events/`. **The DNS lookup time is its own reading and never softens the verdict**: the carrier resolver can answer while ICMP is unreachable (B2.2), so the fork's "No ping reply" branch (disconnected + DNS answered) was not ported. Strip and bar cuts follow `connectivity.thresholds` (fallback 250 ms / 30 %): a reachability cell is red only with two or more failed rows at the loss cut, or a failed row of its own while the poller's rolling loss is at it; one drop is amber. A cell whose probes all answered is never red: the rolling loss spans the whole ring (~10 min at `quiet`), and counting it alone painted every answered cell after an old drop red. The Internet and DNS bars are amber at the latency cut and red at twice it, on a track of twice the cut. `internet_available === null` renders the "Nothing is probing" empty state linking to `/monitoring/connection-quality/`. Typical / Worst / Loss use the dashboard `FIGURE` shape and hold the card's bottom edge (`mt-auto`). **The speed test is not on this card** (moved 2026-10-19): it closes the Device & Speed card (`components/dashboard/device-metrics.tsx`, `metrics.*`) as a group with a primary "Run test" pill ("View" while running) over a pinned 68px tile (`SPEEDTEST` in `shapes.ts`) holding Download / Upload / Ping, so the two cards end on matching figure rows. That group runs `useSpeedtest({ watch: true })` (B5.23): it checks `speedtest_status.sh` every 10 s, and while a run is in flight, started from the dialog or another tab, it shows a live dot, the phase (Latency / Download / Upload, else "Running"), the current reading (no `TickingValue`: the 500 ms cadence would never let it settle) and a progress bar; otherwise the last result, re-read when the dialog closes, or dashes if no test has run. The dialog and the row then poll the endpoint together, which is safe only because `speedtest_status.sh` serializes the completion harvest behind a flock (`docs/API-REFERENCE.md`).

---

---

## Known Gotchas

- **ICMP RTT reads lower than a TCP-connect RTT.** On the same connection ICMP is typically 5-20 ms lower. Calibrate custom limits against ICMP readings from the dashboard.
- **Some carriers rate-limit ICMP.** If data works but the probe intermittently misses, raise Sensitivity toward `quiet` (longer down-after) or the Watchdog's `act_after_sec`; the probe cadence is not the lever.
- **100% loss = probe failure, not null RTT.** No round-trip line, no RTT, counted as a failure. The daemon cannot emit a false-zero latency.
- **`detect_ping6` runs on every reload.** Raising the ping reload flag re-reads the config and re-probes `::1`, so an OpenWRT IPv6 change is picked up on the next save.
- **Probe results use globals, not stdout.** `probe_cycle()` sets `PROBE_RTT`, `last_family`, `last_leg` and the slot states; `rtt=$(probe_cycle)` would run it in a subshell and lose them.
- **Latency events use the windowed average (`avg_latency_ms`), not the last RTT.** A single slow probe never fires an event.
- **`save_thresholds` must raise two reload flags** (`/tmp/qmanager_quality_reload` for the poller, `/tmp/qmanager_watchcat_reload` for the Watchdog). Omitting either leaves one daemon on stale limits.
- **Do not pre-seed `quality_thresholds`.** The frontend would never show `is_default: true`. The only exception is the one-time ceiling migration above.
- **Reload is a flag file per loop, not a signal.** A flag written mid-cycle is read at the start of the next one: at most one interval plus one cycle later (about `10 + 4 = 14 s` on `quiet`).
- **Unknown sensitivity names fall back to `relaxed`**, silently, in the daemon and in `conn_state_cadence`.
- **A target slot is promoted, not renumbered.** Skipping an IPv6 slot with no route makes the next usable slot "alone"; `last_leg` and the ring still carry the real slot number.
- **Attach warm-up: pre-attach probes are not loss.** `qmanager_ping` starts before the data call is up, so its first probes after boot fail. Until the first probe answers, at most `ATTACH_GRACE_SECS=120` after daemon start (on `mono_now`), a failed probe still drives `streak_fail`, `fail_elapsed_sec` and `reachable` but is **not** written to the ring. `/tmp/qmanager_ping_attaching` exists for that span (removed on first answer, at the cap, and by the EXIT trap). The poller's `append_ping_history` skips archive rows while it exists and the ping cache is fresh, so those seconds show as unmeasured instead of an outage, and the Watchdog holds its outage age at 0 while the flag exists (`wd_attach_tick` restarts the outage age when it clears). If nothing answers within the cap, failures are recorded again, so a boot with no service still shows red after 2 min.
- **A hand-edited config never reaches the probe unchecked.** The daemon, the CGI and Config Backup restore apply the same slot rule, and the three custom-limit readers apply the same range rule.

## Test tools

All dev-only, never installed (`install.sh` does not copy `tools/`). The BusyBox gates run under WSL with `jq` on `PATH`.

| Tool | What it proves | Run |
|---|---|---|
| `tools/ping-harness/` (20 scenarios) | `qmanager_ping`: slot order, early exit, skipped families, fan-out winner and hard stop, hostname timeout, attach warm-up, ring trim, the sensitivity table, `cq_ring_stats`. Byte-identical output across BusyBox 1.29.3 / 1.31.1 / 1.36.1. | `PH_BB=/usr/bin/busybox busybox sh tools/ping-harness/run.sh run -o /tmp/ph-new`, then `run.sh compare tools/ping-harness/baseline /tmp/ph-new` |
| `tools/cq-wd-contract/` (51 CQ + 69 Watchdog fixtures) | Both CGIs against the frozen contract: shapes, `equals`, and behaviour checks the fixtures cannot express (what a save wrote, which flags it raised, that a GET writes nothing). | `sh tools/cq-wd-contract/run.sh [-b BUSYBOX] [-j JQ] [-k] [FILTER]` |
| `tools/cq-wd-migrate/run.sh` | `cqwd_migrate.sh` and the Config Backup translate/apply, with a file-backed `uci` stub. | `busybox sh tools/cq-wd-migrate/run.sh` |
| `tools/cq-wd-parity/` | `check.sh` keeps the neutral files byte-identical to `manifest.sha256` (`--update` after an intentional change, then mirror it in the other repo); `adapter_cc_check.sh` unit-checks `plat_cc_count`; `poller_thresholds.sh` pins the poller's custom-limit ranges. | `sh tools/cq-wd-parity/check.sh` |
| `tools/poller-parity/` | The poller's composer and parsers, including `status_parity.sh` (the `watchcat` block, both composers) and `ca_env_parity.sh` (the carrier sidecar). Required for any `parse_at.sh` or composer edit. | See its README |
