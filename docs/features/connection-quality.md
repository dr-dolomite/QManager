# Connection Quality Settings

The Connection Quality settings page (Monitoring → Connection Quality) controls two things: how often and what the ping daemon probes for internet reachability (the Probe Targets card: ping profile + targets), and at what latency/loss levels QManager fires a Network Event notification (quality thresholds). Both settings live in `/etc/config/quecmanager` and take effect without a reboot.

**Responsibility boundary (important):** The Probe Targets card owns ONLY the probe interval (profile name) and the two targets. It does NOT own fail thresholds or recovery — those belong to the Connection Watchdog. The Connection Watchdog is the sole writer of `quecmanager.ping_profile.interval_override`; when an override is active, the card's Probe interval row reads `Every N s (set by Watchdog)` and links to `/monitoring/watchdog/`. The Sensitivity pills stay interactive (not disabled) — the selected profile becomes the fallback once the override is cleared.

## Quick Reference

| Item | Value |
|---|---|
| Page route | `/monitoring/connection-quality` |
| Ping profile CGI | `GET/POST /cgi-bin/quecmanager/system/ping_profile.sh` |
| Quality thresholds CGI | `GET/POST /cgi-bin/quecmanager/system/quality_thresholds.sh` |
| UCI package | `quecmanager` (not `qmanager`) |
| UCI section — ping | `quecmanager.ping_profile.{profile,target_ipv4,target_ipv6,interval_override}` |
| UCI section — thresholds | `quecmanager.quality_thresholds.{latency_preset,latency_custom_ms,loss_preset,loss_custom_pct}` |
| Ping daemon reload flag | `/tmp/qmanager_ping_reload` |
| Poller reload flag | `/tmp/qmanager_quality_reload` |
| Watchdog reload flag | `/tmp/qmanager_watchcat_reload` (touched by `quality_thresholds.sh` POST — dual reload invariant) |
| Interval override owner | `quecmanager.watchcat` (watchdog is sole writer of `ping_profile.interval_override`) |
| Ping daemon output | `/tmp/qmanager_ping.json` |
| Shared ping-cache reader + profile table | `scripts/usr/lib/qmanager/conn_state.sh` (`conn_state_read`, `conn_state_resolve`, `conn_state_cadence`); sourced by `qmanager_ping`, `qmanager_poller`, `qmanager_watchcat`, `ping_profile.sh`, `watchdog.sh` |
| Reboot required | No |

---

## Probe Mechanics

`qmanager_ping` is an ICMP probe daemon, not HTTP/curl. It was rewritten in v0.1.36 from the best parts of this daemon and the RM520N one (plan: `docs/plans/ping-daemon-rewrite.md`).

**Why ICMP and not curl/HTTP:** the curl probe was the biggest behavioural difference from the old QuecManager and the prime suspect in a disconnection bug, and it gave a false "down" on IPv6-only bearers (the IPv4 HTTP targets were unreachable). ICMP with an IPv6 leg handles that case.

### Legs and the cycle (`probe_cycle`)

| Leg | Target | Notes |
|---|---|---|
| `p4` | `target_ipv4` (default `1.1.1.1`) | Probed alone first. A hostname gets `timeout 4` (the `-w` deadline does not cover the DNS lookup). |
| `s4` | the other provider's IPv4 | `1.1.1.1` when `p4` is Google (`8.8.8.8`, `8.8.4.4`, `dns.google`), else `8.8.8.8` (also for any custom target). |
| `p6` | `target_ipv6` (default `2606:4700:4700::1111`) | IPv6 legs run only when `detect_ping6` found a ping and the kernel has an IPv6 default route. |
| `s6` | the other provider's IPv6 | `2606:4700:4700::1111` when `p6` is Google (`2001:4860:4860:*`), else `2001:4860:4860::8888`. |

The alternates are built in (no UCI key, no UI). There are no hostname legs of the daemon's own: DNS health is the separate DNS sampler, so a resolver outage never reads as "internet down".

1. `p4` alone: `ping -c 1 -W 2 -w 3`. If it answers, the cycle is done (one probe per healthy cycle).
2. Otherwise `s4`, `p6` and `s6` run **in parallel** as background jobs writing to `/var/run/qmanager/ping_fan/<leg>` (root 0700), and the daemon `wait`s for them. The IPv6 default route is read from `/proc/net/ipv6_route` with builtins (`::/0` not on `lo`).
3. The winner is the first leg **in priority order** `s4 > p6 > s6` that answered, never the fastest, so the reported RTT is deterministic.

Worst case is about 4 s (a blackholed `p4` costs 2.0 s, the parallel fan-out another 2.0 s), well under the 15 s stale floor for every profile. An unroutable leg fails in ~0.02 s, and a locally dropped one (firewall `EPERM`) instantly.

Results travel through the `PROBE_RTT`, `last_family`, `last_target` and `last_leg` globals, not stdout: `rtt=$(probe_cycle)` would run in a subshell and lose them.

### Debounce and loop timing

- **Wall-clock, monotonic.** `_clock` reads `/proc/uptime` in centiseconds with the `read` builtin (no fork). A failure run is timed from the **start** of its first failing cycle; `reachable` flips to `false` once that elapsed time reaches `fail_secs`, and back to `true` once a success run (timed the same way) reaches `recover_secs`. The honest bound is `fail_secs` + one cycle. Live (RM551E, 2026-11-06, ICMP dropped at the firewall): `quiet` flipped 33 s after the drop and recovered 23 s after it cleared; `sensitive` flipped in 7.3 s and recovered in 4.2 s. The old cycle-count debounce took 22-32 s for a promised 6-15 s.
- **Counts stay counts.** `streak_success` / `streak_fail` are still per-cycle counts: the watchdog's `fail_threshold` is a number of failed probes.
- **Fixed-rate.** After each cycle the daemon sleeps what is left of the interval (`S.CC` fractional sleep, 0.2 s floor), so the period equals the interval whenever the cycle fits; `cycle_ms` publishes the measured period.
- If `/proc/uptime` cannot be parsed, the clock advances one interval per read so a failure run still reaches `fail_secs`.

### IPv6 detection (`detect_ping6`)

At startup and on every reload-flag trip the daemon probes `::1` with `ping -6`, then the `ping6` applet. If neither works, `PING6_CMD` is empty, the daemon logs one warning and runs IPv4-only. Running it on reload picks up OpenWRT IPv6 changes without a restart.

### RTT parser (`parse_rtt`)

Builtins only (no `grep`/`cut`/`awk` per probe). It takes the average from the summary line (`round-trip min/avg/max = 12.3/15.6/18.9 ms`, also the iputils `min/avg/max/mdev` form), else the first per-packet `time=<n>`, and rounds to one decimal in integer arithmetic (a leading-zero fraction is kept out of octal with the `1$frac - 100` trick). Only a value > 0 counts as an answer; 100% loss prints no round-trip line and so fails (the fail-safe).

### Targets

`load_config` re-checks both targets with the CGI's charsets (`[0-9A-Za-z.-]` for IPv4, `[0-9A-Fa-f:.%]` for IPv6, at most 128 chars) and also rejects a leading `-` (it would be parsed as a `ping` option). A rejected value falls back to the Cloudflare default with a warning.

### ping.json schema

```json
{
  "timestamp": 1710700000,
  "mono": 86400,
  "profile": "relaxed",
  "targets": ["1.1.1.1", "2606:4700:4700::1111"],
  "interval_sec": 5,
  "fail_secs": 15,
  "recover_secs": 10,
  "last_rtt_ms": 34.2,
  "reachable": true,
  "streak_success": 12,
  "streak_fail": 0,
  "during_recovery": false,
  "last_family": "ipv4",
  "last_target": "1.1.1.1",
  "fail_elapsed_sec": 0,
  "cycle_ms": 5010
}
```

`targets` is `[target_ipv4, target_ipv6]` (the configured primaries, not the alternates). `interval_sec` is the effective interval (override applied); `fail_secs` / `recover_secs` are the profile's time-to-fail / time-to-recover. `last_rtt_ms` is a number or `null`. `last_family` is `"ipv4"`, `"ipv6"` or `"none"`. `last_target` is the address that answered (`""` when nothing did), so a fallback to the second provider is visible. `fail_elapsed_sec` is how long the current failure run has lasted (0 when not failing). `cycle_ms` is the last measured cycle period, start to start.

The file is written with `printf` (no `jq` fork), tmp + `mv`. A failed write keeps the previous file, skips the sidecar and logs one warning until a write succeeds again. Only the profile name can carry characters that need JSON escaping; `_json_str` escapes `\` and `"`.

### History ring (`/tmp/qmanager_ping_history`)

One line per recorded cycle, newest last, `HISTORY_SIZE=60` lines: `<rtt|null> <leg>` where leg is `p4`, `s4`, `p6`, `s6` or `-` (no answer). The ring is never truncated when the winning leg changes (the RM520N daemon did that and lost loss and jitter on every switch); it is emptied only at daemon start. **Readers use `$1`**, so an older one-column file still parses. The poller computes jitter only between consecutive answers from the **same leg**, so a switch to the second provider is not counted as jitter; loss keeps every `null`. Readers: the poller's stats awk (`read_ping_data`) and the watchdog's `read_quality` (`wd_detect.sh`). `fetch_ping_history.sh` serves the poller's NDJSON archive, not this ring.

---

## Shared Ping-Cache Reader (`conn_state.sh`)

`scripts/usr/lib/qmanager/conn_state.sh` is the one reader of `/tmp/qmanager_ping.json` and the one cadence resolver. It is sourced, never executed, and guarded by `_CONN_STATE_LOADED`. Consumers that source it must guard the include (`[ -f ... ] && . ...`) and supply a fail-closed stub, because a dot-source of a missing file aborts the script under BusyBox: the poller and watchcat stub `conn_state_read` to "stale"; the CGIs stub `conn_state_cadence` to `relaxed`.

| Function | Contract |
|---|---|
| `conn_state_read` | One `jq` read of the cache into `CQ_*` vars. Returns 0 when fresh, 1 when missing, unreadable, or stale. |
| `conn_state_read_env` | The same read from the `ping.env` sidecar, builtins only (poller only; see [Poller sidecars](#poller-sidecars-pingenv-and-dnsenv)). Same contract and `CQ_*` results as `conn_state_read`, plus return **2** = nothing read (no usable sidecar), so the caller falls back to `conn_state_read`. |
| `conn_state_why` | Reason for the last non-zero read (`missing`, `unreadable`, `no timestamp`, `mono ahead of uptime`, `age Ns > Ms`). |
| `conn_state_is_up` | True only for a fresh read with `reachable=true`. |
| `conn_state_resolve <profile> [override]` | Pure profile table + override → `CQ_CFG_*` (see [Ping Profiles](#ping-profiles)). |
| `conn_state_cadence` | `conn_state_resolve` fed from UCI `quecmanager.ping_profile.{profile,interval_override}`. |

**Verdict vars on a fresh read:** `CQ_REACHABLE` (`true`/`false`/`"null"`), `CQ_RTT_MS`, `CQ_STREAK_SUCCESS`, `CQ_STREAK_FAIL`, `CQ_DURING_RECOVERY`, `CQ_INTERVAL_SEC`, `CQ_FAIL_SECS`, `CQ_RECOVER_SECS`, `CQ_PROFILE`, `CQ_LAST_FAMILY`, `CQ_TARGET` (first of `targets`), `CQ_LAST_TARGET` (the address that answered, `""` when none), `CQ_CYCLE_MS` (measured cycle period; empty on an older cache), `CQ_TIMESTAMP`, `CQ_AGE_SEC`.

**The one staleness rule:** the cache is stale when `age > max(3 * interval_sec, 15)` seconds. `interval_sec` comes from the cache and is clamped to 1–300, anything else becoming 5. `age` is `/proc/uptime` minus the cache's `mono`; the wall clock (`date +%s - timestamp`) is used only when `mono` is absent or `0`.

**Why:** the old windows were fixed per reader (poller 10 s, watchcat 15 s) and ignored the profile, so `quiet` (10 s interval, 30 s fail window) made the poller mark connectivity unknown on every cycle. Three probe intervals with a 15 s floor tolerates one or two lost cycles without hiding a dead daemon.

**Fail-closed:** any problem (missing, unreadable, stale, `mono` ahead of uptime, no timestamp) leaves `CQ_STALE=1` and `CQ_REACHABLE="null"`. A `mono` ahead of uptime cannot come from this boot's daemon (`/tmp` is tmpfs), so it is treated as garbage, not as fresh. A missing or corrupt `reachable` also reads as `"null"`, never as up.

> ⚠️ WARNING: Do not add regex (`test()`, `sub()`) to the lib's `jq` program. The device `jq` is built without Oniguruma and fails at runtime.

---

## Ping Profiles

The profile→parameters table lives in exactly one place: `conn_state_resolve` in `scripts/usr/lib/qmanager/conn_state.sh`. UCI stores the **profile name**, two probe targets, and optionally an `interval_override`. Changing the profile name in UCI (or via the CGI) is sufficient — `qmanager_ping` re-derives the parameters from the name through the lib. **`interval_override`, if set, supersedes the profile-derived interval entirely.** The `interval_override` key is written and cleared only by the Connection Watchdog — never by `ping_profile.sh` POST.

### Profile Table

| Profile | Interval | Fail (secs → probes) | Recover (secs → probes) |
|---|---|---|---|
| sensitive | 1 s | 6 s → 6 | 3 s → 3 |
| regular | 2 s | 10 s → 5 | 6 s → 3 |
| relaxed | 5 s | 15 s → 3 | 10 s → 2 |
| quiet | 10 s | 30 s → 3 | 20 s → 2 |

`conn_state_resolve <profile> [override]` is pure (no UCI, no I/O) and sets `CQ_CFG_*` globals. An unknown or empty profile resolves to `relaxed`. A valid override (integer 1–60) changes the **probe cadence only**; the thresholds stay `ceil(fail_secs / profile_interval)` using the profile's own interval, so an override never re-derives them. `conn_state_cadence` is the same resolve fed from UCI (`quecmanager.ping_profile.profile` + `interval_override`); the CGIs use it so their answer is right even while the daemon is down. `ping_profile.sh` and `watchdog.sh` no longer carry their own `profile_interval()` mirrors.

**Why ceil division:** The lib converts seconds to probe counts via `ceil(secs/profile_interval)`. This keeps the real-world time-to-fail and time-to-recover stable when the interval changes — a 6-second fail window at 1 s interval and the same 6 s at 2 s interval still declare failure after roughly the same wall-clock time.

**Why one lib owns this table:** The UI uses the profile name as an opaque key. Before `conn_state.sh`, the daemon and two CGIs each carried a copy of the interval column, and the poller and watchcat each hard-coded a staleness window that ignored the profile (the poller's fixed 10 s tripped on every cycle under `quiet`). Storing interval in UCI would still be a second source of truth, so UCI holds only the profile name and the optional override.

### UCI defaults (seeded by installer)

`install.sh`'s `seed_uci_defaults()` writes:

```
quecmanager.ping_profile=ping_profile
quecmanager.ping_profile.profile=relaxed
quecmanager.ping_profile.target_ipv4=1.1.1.1
quecmanager.ping_profile.target_ipv6=2606:4700:4700::1111
```

The `ping_profile.sh` CGI also seeds these defaults on-read (via `ensure_ping_profile_config`) if the section is absent — so the section always exists after the first GET.

**Why Cloudflare DNS as the default targets:** Both `1.1.1.1` and `2606:4700:4700::1111` are anycast DNS resolvers that respond to ICMP reliably across carriers worldwide. They produce low-noise RTT baselines. The IPv4 target is pinged first every cycle; the IPv6 target is the fallback. Either can be replaced with any ICMP-reachable host using the Probe Targets card's inputs.

**Migration on upgrade:** `install.sh seed_uci_defaults()` seeds `target_ipv4` and `target_ipv6` only when those keys are absent — user customizations are left untouched. The legacy `target_1` and `target_2` keys (HTTP URLs from the old curl probe) are deleted unconditionally on upgrade; they are useless as ICMP targets and the old probe engine is gone. No reload flag needs to be touched for the deletion since the daemon does not read those keys.

---

## Quality Thresholds

Quality thresholds control when `events.sh` (`detect_data_connection_events`, [see below](#one-detector-eventssh)) fires `high_latency`, `latency_recovered`, `high_packet_loss`, and `packet_loss_recovered` events into the Recent Activities log. They also drive the Connection Watchdog's quality trigger — the same resolved threshold applies to both paths. See [connection-watchdog.md](connection-watchdog.md) for the watchdog's own debounce (`quality_consecutive`) which is independent.

**Latency basis:** both the Network Events path in `events.sh` and the watchdog's quality trigger compare against `avg_latency_ms` — the **windowed average** RTT from `status.json`. The old `events.sh` path previously used the last single RTT (`latency_ms`); it was unified to `conn_avg_latency` (which maps to `avg_latency_ms`) so that a single noisy probe cannot fire a latency event.

### Preset Table

**Latency**

| Preset | Threshold | Debounce (consecutive readings) |
|---|---|---|
| standard | 150 ms | 3 |
| tolerant | 250 ms | 3 |
| very-tolerant | 500 ms | 2 |
| custom | user-defined (1–10000 ms) | 3 (same as tolerant) |

**Packet Loss**

| Preset | Threshold | Debounce (consecutive readings) |
|---|---|---|
| standard | 15 % | 3 |
| tolerant | 30 % | 3 |
| very-tolerant | 50 % | 2 |
| custom | user-defined (0–100 %) | 3 (same as tolerant) |

The `custom` preset stores the user-supplied value in `latency_custom_ms` / `loss_custom_pct` in UCI. The `QUALITY_PRESETS` constant in `types/modem-status.ts` is `["standard", "tolerant", "very-tolerant", "custom"]`.

### One Detector (`events.sh`)

`detect_data_connection_events` in `scripts/usr/lib/qmanager/events.sh` is the **only** place link transitions (`internet_lost` / `internet_restored`) and quality pairs (`high_latency` / `latency_recovered`, `high_packet_loss` / `packet_loss_recovered`) are decided (ledger B2.3). The poller calls it every cycle from the always-run local block, after `read_ping_data` / `read_dns_data` and before `alert_engine_check`; it is no longer called from `detect_events`, which only runs when an AT read is due. It publishes `ev_link_state` (`"down"`, `"up"`, or `""` for stale or unknown) and the alert engine follows that value instead of keeping its own edge detector. **Why:** two detectors disagreed under watchdog recovery (live: two consecutive `internet_lost` with no restore between, and a `high_packet_loss` 100 % logged during an outage).

**Link rules, in order**

- It follows the ping daemon's reachable verdict (`conn_internet_available`), never `conn_status` (`"recovery"` would mask it), so a watchdog-fixed outage still logs `internet_restored`.
- Stale or unknown ping data is no transition; every counter stays frozen.
- The first reading after a poller start is adopted silently.
- The first true to false edge always logs `internet_lost`, even when the watchdog raised its recovery flag before the poller saw the drop. Only a **repeat** drop after a restore inside the same recovery window is held (`ev_recov_restored`, cleared when the daemon's recovery flag clears), so one outage logs exactly one lost/restored pair.

**Quality rules**

- Frozen while the link is down (the outage is the record).
- Debounced on **entry and exit**: `QUALITY_*_DEBOUNCE` consecutive readings to raise, the same number of consecutive clear readings (`ev_lat_clear_streak` / `ev_loss_clear_streak`) to recover. A 40/0/40 flicker logs nothing.
- Entry is held while `CQ_STREAK_FAIL > 0` (the daemon is counting failures, the run-up to a down verdict) and for one history window after a restore (`CONN_HISTORY_SIZE x conn_history_interval`, default 300 s; the outage nulls are still in the window). Exits are never held.
- Kept from the pre-B2.3 target: latency basis is the windowed average (`conn_avg_latency`, "null" = no reading), thresholds come from the `QUALITY_*` globals including the `custom` preset, and the message wording is unchanged.

**Degraded status.** In `status.json`, `connectivity.status` is `"degraded"` when packet loss is at or above `QUALITY_LOSS_THRESHOLD` (it was a hard-coded 10 %). Latency alone never degrades the status. The cuts are published as `connectivity.thresholds: { latency_ms, loss_pct }` so the UI grades against the configured values (`ConnectivityStatus.thresholds?` in `types/modem-status.ts`; absent on an older poller).

### Alert wait (`alert_after_min`)

One outage wait serves every alert channel (see [Alerts](alerts.md#one-alert-wait-for-every-channel)): UCI `quecmanager.quality_thresholds.alert_after_min`, minutes. The resolver `cq_alert_after_min` in `conn_state.sh` sets `CQ_ALERT_AFTER_MIN` from the UCI key (1-1440), else `/etc/qmanager/sms_alerts.json` `threshold_minutes`, else `email_alerts.json` `threshold_minutes`, else 5. `quality_thresholds.sh` GET returns it as top-level `alert_after_min`; POST accepts an optional `alert_after_min` (1-60). The Alerts page can write the same key (via `monitoring/alerts.sh`).

> ⚠️ WARNING: Config Backup does not carry the `quality_thresholds` section. The wait travels only as `sms_alerts.json`'s `threshold_minutes` mirror, and restoring onto a device that already has an `alert_after_min` key keeps that device's wait.

### Why absence == default (never seeded)

The `quecmanager.quality_thresholds` UCI section is **never seeded by the installer** and is **never created by `ensure_*` on read**. Its absence is the "user has not changed this" signal. The GET endpoint reports `isDefault: true` when **neither `latency_preset` nor `loss_preset` is stored** and returns `tolerant/tolerant` in the response body — the frontend displays a "Using defaults" notice instead of a "saved" state. The poller also falls back to `tolerant/tolerant` in that case (see `resolve_quality_thresholds()` in `qmanager_poller`).

The section itself may exist while `isDefault` is still `true`: `monitoring/alerts.sh` creates it to hold `alert_after_min` alone (a `quality_thresholds.sh` POST always carries both presets). When the user saves thresholds for the first time, `quality_thresholds.sh` writes both presets; from that point on, `isDefault` is always `false` even if the user picks the same tolerant/tolerant values.

> ℹ️ NOTE: To reset a device back to "default" state (isDefault=true) and also drop the alert wait, remove the UCI section: `uci delete quecmanager.quality_thresholds && uci commit quecmanager`. To keep the wait, delete just `latency_preset` and `loss_preset` (plus the custom keys).

---

## Apply / Reload Pipeline

```
ping_profile.sh POST
  ──uci commit──▶ /etc/config/quecmanager
  ──touch /tmp/qmanager_ping_reload
                 │
  qmanager_ping reads flag ──▶ load_config() + detect_ping6() ──▶ rm flag

quality_thresholds.sh POST
  ──uci commit──▶ /etc/config/quecmanager
  ──touch /tmp/qmanager_quality_reload     (poller + events.sh path)
  ──touch /tmp/qmanager_watchcat_reload    (watchdog quality trigger)
                 │
  qmanager_poller reads quality flag ──▶ resolve_quality_thresholds() + cq_alert_after_min() ──▶ rm flag
  qmanager_watchcat reads watchcat flag ──▶ read_config() ──▶ rm flag
```

> ⚠️ WARNING: **`quality_thresholds.sh` must always touch BOTH reload flags** — `/tmp/qmanager_quality_reload` and `/tmp/qmanager_watchcat_reload`. The quality thresholds now feed two daemons. Omitting either flag means one daemon continues running stale thresholds until its next restart. This is the dual reload-flag invariant.

All daemons check for their respective flag at the **top of their main loop**, before the next probe/cycle. A saved change therefore takes effect in at most one cycle — at most 10 seconds on `quiet`, at most 1 second on `sensitive`. No daemon restart, no procd touch.

On ping profile reload, `load_config()` re-reads UCI and `detect_ping6()` re-probes `::1` to refresh the IPv6 ping invocation. Both run synchronously before the next probe cycle begins.

---

## CGI Envelopes

### `ping_profile.sh`

**GET response**

```json
{
  "success": true,
  "profile": "relaxed",
  "target_ipv4": "1.1.1.1",
  "target_ipv6": "2606:4700:4700::1111",
  "interval_override": null,
  "effective_interval": 5
}
```

`interval_override` is `null` when not set. `effective_interval` is the resolved probe interval in seconds: `interval_override` if set, else the profile-derived value (sensitive=1, regular=2, relaxed=5, quiet=10). The GET also returns numeric `interval_sec` (same value as `effective_interval`, which is kept for existing consumers), `fail_secs` and `recover_secs`, all resolved from UCI via `conn_state_cadence` rather than from the cache, so they stay correct while `qmanager_ping` is stopped. Both GET and POST use the same `target_ipv4`/`target_ipv6` snake_case keys — there is no GET/POST asymmetry in this endpoint (unlike the old `target1`/`target_1` split that existed in the prior HTTP-probe version).

> ⚠️ WARNING: `ping_profile.sh` POST does NOT write `interval_override`. That key is owned exclusively by the watchdog. Only a watchdog `save_settings` POST can set or clear `interval_override`.

**POST request**

```json
{
  "action": "save",
  "profile": "sensitive",
  "target_ipv4": "1.1.1.1",
  "target_ipv6": "2606:4700:4700::1111"
}
```

**POST success**

```json
{ "success": true }
```

**Error codes**

| Code | Meaning |
|---|---|
| `invalid_profile` | `profile` not one of: `sensitive`, `regular`, `relaxed`, `quiet` |
| `invalid_target` | `target_ipv4` or `target_ipv6` failed per-family host validation: empty, >128 chars, interior whitespace, shell/HTML metacharacters, or characters outside the family charset (`[0-9A-Za-z.-]` for IPv4; `[0-9A-Fa-f:.%]` for IPv6) |
| `missing_action` | `action` field absent |
| `unknown_action` | `action` not `save` |

**Validation detail:** `validate_target()` applies common rules first (trim, non-empty, length ≤ 128, no interior whitespace, no shell/HTML metacharacters: `` ` $ ( ) ; | < > " \ ``), then a per-family charset whitelist. The error detail message names the offending field (`target_ipv4` or `target_ipv6`). No URL scheme is prepended — targets are bare hosts or IP literals.

---

### `quality_thresholds.sh`

**GET response (section present, named preset)**

```json
{
  "success": true,
  "thresholds": {
    "latency": { "preset": "tolerant" },
    "loss": { "preset": "tolerant" }
  },
  "alert_after_min": 5,
  "isDefault": false
}
```

`alert_after_min` is always present: the resolved single alert wait in minutes (`cq_alert_after_min`), whether or not a preset is stored.

**GET response (section present, custom preset)**

```json
{
  "success": true,
  "thresholds": {
    "latency": { "preset": "custom", "custom_ms": 400 },
    "loss": { "preset": "custom", "custom_pct": 10 }
  },
  "isDefault": false
}
```

`custom_ms` and `custom_pct` are present only when the respective preset is `"custom"`.

**GET response (no preset stored — factory state)**

```json
{
  "success": true,
  "thresholds": {
    "latency": { "preset": "tolerant" },
    "loss": { "preset": "tolerant" }
  },
  "alert_after_min": 5,
  "isDefault": true
}
```

**POST request (named preset)**

```json
{
  "action": "save",
  "latency_preset": "standard",
  "loss_preset": "tolerant"
}
```

**POST request (custom preset)**

```json
{
  "action": "save",
  "latency_preset": "custom",
  "latency_custom_ms": 400,
  "loss_preset": "custom",
  "loss_custom_pct": 10
}
```

`latency_custom_ms` and `loss_custom_pct` are required in the POST body when the corresponding preset is `"custom"`. The hook `useQualityThresholds` flattens the nested client type (`QualityThresholdsSettings`) to these flat wire keys before posting.

`alert_after_min` is optional in the POST body (integer 1-60, minutes); absent leaves the stored wait unchanged. It is written to the same UCI section and picked up by the poller on the same `/tmp/qmanager_quality_reload` flag (the alert engine re-resolves it at the next outage start or channel reload).

> ℹ️ NOTE: The POST body uses flat keys (`latency_preset`, `loss_preset`, `latency_custom_ms`, `loss_custom_pct`) even though the GET response uses a nested shape (`thresholds.latency.{preset,custom_ms}`). This asymmetry is intentional — the GET was shaped for front-end destructuring; the POST mirrors UCI field names.

**POST success**

```json
{ "success": true }
```

**Error codes**

| Code | Meaning |
|---|---|
| `invalid_preset` | `latency_preset` or `loss_preset` not one of: `standard`, `tolerant`, `very-tolerant`, `custom` |
| `invalid_custom_ms` | `latency_custom_ms` not an integer 1–10000 (required when `latency_preset=custom`) |
| `invalid_custom_pct` | `loss_custom_pct` not an integer 0–100 (required when `loss_preset=custom`) |
| `invalid_threshold` | `alert_after_min` present but not an integer 1-60 |
| `missing_action` | `action` field absent |
| `unknown_action` | `action` not `save` |

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

**Timing and bound.** The lookup is bounded at 5 s by the BusyBox `timeout` applet through a local `qm_timeout` fallback (the target has no `platform.sh`); a killed lookup exits 143 and reports `ok:false`. Elapsed time comes from `/proc/uptime` centiseconds, so the quantum is 10 ms and `ms` is floored at 10.

**Freshness gate.** The poller's `read_dns_data` publishes `dns_lookup_ms` as a number only when `ok` is true and the sample `mono` age against `/proc/uptime` is 0 to 180 s; otherwise `null`. `dns_resolver` is the resolver string, or `null` when unknown or stale. Both land in `/tmp/qmanager_status.json` under `connectivity` and in the `at_cmd/fetch_data.sh` response. The TS type `ConnectivityStatus` carries optional `dns_lookup_ms?: number | null` and `dns_resolver?: string | null`.

> ℹ️ NOTE: Live numbers on the RM551E are 40 to 70 ms against the carrier resolver. A dead resolver (`192.0.2.1`) gives `ok:false`, `ms:null` after 5.07 s.

> ⚠️ WARNING: The DNS reading is independent of the ICMP verdict. During validation ICMP reported unreachable while the carrier resolver kept answering at 40 to 70 ms. A consumer (ledger U4.7, the Connection Quality cards) must not read a DNS number as "online"; use `internet_available` for that.

`uninstall.sh` removes `/tmp/qmanager_dns.json`, `/tmp/qmanager_dns_out.*` and `/tmp/qmanager_dns.json.??????`.

---

## Last Outage

The poller publishes the most recently cleared outage as `connectivity.last_outage_s` (its length) and `connectivity.last_outage_ago_s` (seconds since it cleared). Both are `null` until one clears this boot, and absent on an older poller. Issue #27.

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
| `/var/run/qmanager/ping.env` | `write_ping_env` in `qmanager_ping`, after every `ping.json` write | the successful `mv` of `ping.json` | `_cq_ts`, `_cq_mono`, `_cq_reach`, `_cq_rtt`, `_cq_ss`, `_cq_sf`, `_cq_dr`, `_cq_iv`, `_cq_fs`, `_cq_rs`, `_cq_prof`, `_cq_fam`, `_cq_tgt`, `_cq_last_target`, `_cq_cyc` (the 15 raw fields `conn_state_read` extracts; null or empty becomes `-`) |
| `/var/run/qmanager/dns.env` | `write_dns_env`, from the detached DNS job | the successful `mv` of `dns.json` | `dns_s_ok`, `dns_s_ms`, `dns_s_mono`, `dns_s_res` (`ms` is `null` when the lookup failed) |

- **Format.** Every line is `name='value'` with `'` written as `'\''`, and the last line is `qm_sidecar_end='1'`. Files are written to `<name>.new` and renamed.
- **Who reads them.** Only the poller. `read_ping_data` calls `conn_state_read_env` first and falls back to `conn_state_read` on return 2; `read_dns_data` sources `dns.env` and falls back to its builtin JSON-shape parser, then to `jq`. `conn_state_read` is unchanged and remains the watchcat's reader.
- **When a sidecar is ignored.** The reader refuses a sidecar that is missing, **older than its JSON** (`-nt`: the upgrade window before `qmanager_ping` restarts, or a failed sidecar write), or incomplete (any line not a single-quoted assignment, or no end marker). A line the checker rejects is never sourced. **Why:** a syntax error in a dot-sourced file aborts the whole script under BusyBox, and the poller must never die from a half-written file.
- **Best effort.** A sidecar write failure returns non-zero from `write_ping_env` but never fails the probe cycle; the poller simply reads the JSON on that cycle.
- **Freshness is unchanged.** The staleness rule above is evaluated by `conn_state_read_env` from the sidecar's `_cq_mono` and `_cq_iv`, in lockstep with `conn_state_read`. If you change one, change both.
- **Lifecycle.** `init.d/qmanager` `stop_service` removes both files and their `.new` temps; the files live on tmpfs.

---

## status.json / Poller Surface

The poller merges `connectivity.profile` into `status.json` from `/tmp/qmanager_ping.json`, read through `conn_state_read` (field names and types are unchanged). Consumers should treat it as optional — it is absent on older poller output and on the first write before the ping daemon has run. When the cache is **missing** the poller clears `target`, `profile` and `last_family`; when it is **stale** it keeps them and only marks connectivity unknown. The `connectivity` object in the response holds both the live profile name and all latency/loss stats.

The poller also passes `last_family` from `ping.json` through into `status.json` as `connectivity.last_family`. Values: `"ipv4"` (IPv4 probe answered), `"ipv6"` (IPv4 failed, IPv6 fallback answered), `"none"` (both failed), `""` (older poller output before the field existed). The frontend reads this to show the "Currently reachable via IPv6" indicator next to the IPv6 DNS Server input.

### Packet-loss maturity guard (`PING_MIN_SAMPLES`)

The poller's `read_ping_data()` function computes `packet_loss_pct` via an awk pass over the raw history ring buffer at `/tmp/qmanager_ping_history`. The computation is `int(lost*100/n)`. A constant `PING_MIN_SAMPLES=10` gates this: the poller reports `packet_loss_pct=0` whenever the sample count `n` is below 10, regardless of how many failures the window contains. The all-null arm (total-outage path) likewise suppresses `100%` to `0` until `n >= 10`. All other output — `min_rtt_ms`, `avg_latency_ms`, `max_rtt_ms`, `jitter_ms`, and the `history` array — is unaffected.

**Why this guard exists:** `qmanager_ping` truncates `/tmp/qmanager_ping_history` on every (re)start. In the first ~20–100 seconds after a reboot or daemon restart (depending on profile — 100 s at `quiet`/10 s interval, 50 s at `relaxed`, 20 s at `regular`), the window may hold only a handful of samples. Two transient boot-attach null probes in a 4-sample window produce 50% reported loss, which is above the default watchdog quality threshold (30% for `tolerant` preset). At 5 consecutive breach cycles that is enough to trip the Connection Watchdog's quality-LOSS trigger → Tier 1 recovery (`AT+COPS=2`) → `/tmp/qmanager_ping_history` truncates again on reconnect → loop. Live evidence: 0% real loss on sustained probing; all false breaches clustered in the first ~78 s after daemon start; no recurrence once the window filled. The guard costs nothing on a stable connection — once the window has 10 samples the math is unaffected.

Genuine total outages are independently caught by the reachability/`streak_fail` path, which reads raw `ping_streak_fail` from `qmanager_ping.json` and is unaffected by this guard.

Both `/tmp/qmanager_ping.json` (written by `qmanager_ping`) and `/tmp/qmanager_status.json` (written by `qmanager_poller`) carry a root-level **`mono`** integer field alongside the existing wall-clock `timestamp`. The value is `mono_now()` from `scripts/usr/lib/qmanager/qlog.sh` — integer seconds since boot read from `/proc/uptime` (kernel monotonic counter, immune to NTP/NITZ steps). `conn_state_read` (used by the poller's `read_ping_data` and the watchdog's `read_ping`) computes ping-cache staleness from this field when it is valid, falling back to wall-clock age only when `.mono` is absent, zero, or non-numeric; the watchdog's `read_quality` still checks `status.json`'s own `mono`. This guards against the ~90 s false-stale event caused by the NITZ `time_daemon` + `ntpd` stepping the system clock after MPSS SSR `rmnet` re-registration.

---

## Frontend

Re-authored by ledger U4.7 from `rm520n` `cebb8185` (page) and `9d156cbe` `e029d43b` `313492ef` `932122bb` (dashboard card), adapted to the target's profile + IPv4/IPv6 model.

| File | Purpose |
|---|---|
| `app/monitoring/connection-quality/page.tsx` | Route entry point (the old `/system-settings/connection-quality` is a client-side redirect stub) |
| `components/monitoring/connection-quality/connection-quality.tsx` | Page shell: `MonitoringPageHeader` over a 1:1 equal-height pair (stacked below `@[58rem]/main`) |
| `components/monitoring/connection-quality/probe-targets-card.tsx` | Probe Targets: Sensitivity `SegmentedField` (4 profiles), Probe interval row, numbered IPv4 leg and IPv6 fallback leg (mono fields, one `HintIcon`), verdict chip, `CardFoot` with Restore defaults + Save |
| `components/monitoring/connection-quality/quality-thresholds-card.tsx` | Quality Thresholds: per metric a `SegmentedField` (Standard / Tolerant / Very tolerant / Custom), a Limit field when Custom, "Flags after" and "Right now" pill rows, `CardFoot` with Save |
| `components/monitoring/connection-quality/{shapes.ts,condition-block.tsx}` | Family-local geometry and the error state block (never imported across families) |
| `components/dashboard/connection-quality.tsx` (shapes from the dashboard `shapes.ts` since U4.10) | Dashboard card that replaced Live Latency: Internet / DNS lookup / Probing / Last outage rows, 30-minute reachability and jitter strips from `fetch_ping_history.sh`, Typical / Worst / Loss (the speed test moved to Device & Speed, `device-metrics.tsx`) |
| `hooks/use-ping-profile.ts` | Fetch + save ping profile |
| `hooks/use-quality-thresholds.ts` | Fetch + save quality thresholds |

Types are in `types/modem-status.ts`: `PING_PROFILES`, `PingProfile`, `QUALITY_PRESETS`, `QualityPreset`, `QualityThresholdsSettings`. `QUALITY_PRESETS` is `["standard", "tolerant", "very-tolerant", "custom"]`. `QualityThresholdsSettings` has the shape `{ latency: { preset, custom_ms?: number }, loss: { preset, custom_pct?: number } }`. The save hook flattens this to flat wire keys (`latency_custom_ms`, `loss_custom_pct`) before posting, and never sends `alert_after_min` (the Alerts page owns that wait; an absent key leaves it unchanged). `ConnectivityStatus` has `last_family?: "ipv4" | "ipv6" | "none" | ""`.

**Hook contracts.** `usePingProfile()` returns `settings` (`{profile, target_ipv4, target_ipv6}` or null), `cadence` (`intervalSec`, `failSecs`, `recoverSecs`, `intervalOverride`, from the GET), `isLoading`, `loadFailed`, `isSaving`, `save`, `refresh`. `useQualityThresholds()` returns `thresholds` (or null), `isDefault`, `isLoading`, `loadFailed`, `isSaving`, `save`, `refresh`. Both `save`s never throw: they resolve to `{ ok, error }`, where `error` is the backend code translated through `resolveErrorMessage` (`errors.json`: `invalid_profile`, `invalid_target`, `invalid_preset`, `invalid_custom_latency`, `invalid_custom_loss`, `invalid_threshold`) or null for the card's generic copy. The cards toast from that result (Toast-Confirms Rule), never from hook state after the await.

**Probe Targets verdict chip** (ICMP only): `IPv4 answering` (success), `IPv6 answering` (info: the fallback carrying the link is a fact, not a fault), `No answer` (destructive: `internet_available === false` or `last_family === "none"`), `Not reporting` (muted: status unknown, `internet_available === null`, or `ping_target` differs from the saved IPv4 target, which means the daemon is still on the previous chain). The answering leg's number disc fills `primary`. The Probe interval row previews an unsaved profile from the same table as `conn_state_resolve`; the saved one comes from the CGI's `interval_sec`.

**Quality Thresholds** reads `connectivity.avg_latency_ms` for "Right now" (the poller compares the windowed average, not the last RTT) and `packet_loss_pct`. Over the limit, a lucide `TriangleAlert` appears beside the figure: amber over the latency cut, red past twice it; red at or over the loss cut. Figures stay neutral ink. Custom debounce mirrors tolerant (3 samples). `isDefault` shows an `info` chip ("Built-in defaults") in the foot, and Save stays enabled so the defaults can be written.

**Dashboard card.** The verdict line is `connectivity.status` only (`connected` Responsive, `degraded`/`recovery` Degraded, `disconnected` Unreachable, else Not measured) and links to `/monitoring/events/`. **The DNS lookup time is its own reading and never softens the verdict**: the carrier resolver can answer while ICMP is unreachable (B2.2), so the fork's "No ping reply" branch (disconnected + DNS answered) was not ported. Strip and bar cuts follow `connectivity.thresholds` (fallback 250 ms / 30 %): a reachability cell is red only with two or more failed rows at the loss cut, or a failed row of its own while the poller's rolling loss is at it; one drop is amber. A cell whose probes all answered is never red: the rolling loss spans the whole ring (~10 min at `quiet`), and counting it alone painted every answered cell after an old drop red. The Internet and DNS bars are amber at the latency cut and red at twice it, on a track of twice the cut. `internet_available === null` renders the "Nothing is probing" empty state linking to `/monitoring/connection-quality/`. Typical / Worst / Loss use the dashboard `FIGURE` shape and hold the card's bottom edge (`mt-auto`). **The speed test is not on this card** (moved 2026-10-19): it closes the Device & Speed card (`components/dashboard/device-metrics.tsx`, `metrics.*`) as a group with a primary "Run test" pill ("View" while running) over a pinned 68px tile (`SPEEDTEST` in `shapes.ts`) holding Download / Upload / Ping, so the two cards end on matching figure rows. That group runs `useSpeedtest({ watch: true })` (B5.23): it checks `speedtest_status.sh` every 10 s, and while a run is in flight, started from the dialog or another tab, it shows a live dot, the phase (Latency / Download / Upload, else "Running"), the current reading (no `TickingValue`: the 500 ms cadence would never let it settle) and a progress bar; otherwise the last result, re-read when the dialog closes, or dashes if no test has run. The dialog and the row then poll the endpoint together, which is safe only because `speedtest_status.sh` serializes the completion harvest behind a flock (`docs/API-REFERENCE.md`).

---

## Known Gotchas

- **ICMP RTT reads lower than the old TCP-connect RTT.** The previous probe measured TCP three-way handshake time; ICMP skips the TCP stack entirely. On the same connection, ICMP readings are typically 5–20 ms lower. The quality preset thresholds (150/250/500 ms) were already generous relative to the prior TCP readings, so they have even more headroom now. If you are calibrating custom thresholds, use ICMP readings from the dashboard as the baseline.
- **Some carriers rate-limit ICMP.** A small number of cellular networks deprioritize ICMP echo-reply, producing slightly elevated or occasionally dropped probe results independent of actual internet access. If your modem is consistently reachable (data works) but the ping daemon intermittently counts failures, the watchdog's `fail_threshold` (number of consecutive failures before declaring a drop) is the right lever, not the probe profile.
- **100% loss = probe failure, not null RTT.** When `ping` reports 100% packet loss, no round-trip summary line is emitted. The RTT parser finds nothing, so `last_rtt_ms` is `null` and the probe is counted as a failure. This is the fail-safe — the daemon cannot emit a false-zero latency reading.
- **`detect_ping6` runs on every reload.** Dropping the reload flag (`/tmp/qmanager_ping_reload`) causes the daemon to re-run `detect_ping6` as well as re-read UCI. If you later disable IPv6 in OpenWRT, the next ping profile save will make the daemon pick that up and stop issuing IPv6 probes.
- **Latency events now use windowed average (`avg_latency_ms`), not last single RTT.** `events.sh` sources `conn_avg_latency` (which maps to `avg_latency_ms` in `status.json`) rather than `latency_ms`. A single high-latency probe will not fire the event; it must be sustained across the debounce window. This is consistent with the watchdog quality trigger.
- **Probe results use globals, not stdout.** `probe_cycle()` stores results in `PROBE_RTT`, `last_family`, `last_target` and `last_leg`; `rtt=$(probe_cycle)` would run it in a subshell and lose them.
- **Quality preset thresholds (150/250/500 ms) have generous headroom.** Against honest ICMP RTT they comfortably exceed 3× normal cellular RTT on a healthy link. `tolerant` (250 ms) is the shipping default.
- **`quality_thresholds.sh` POST must touch two reload flags.** Both `/tmp/qmanager_quality_reload` (poller) and `/tmp/qmanager_watchcat_reload` (watchdog) must be touched on every successful save. Omitting either leaves one daemon on stale thresholds.
- **The `quality_thresholds` section must not be pre-seeded in new installs.** If it is, the frontend will never show `isDefault: true` and users won't know they haven't customised it. The installer intentionally skips seeding it. Exception: the `install.sh` migration from old watchcat ceiling keys seeds a `custom` preset for users who had non-default ceilings — this is a one-time idempotent migration, not routine seeding.
- **The Probe interval row links to the Watchdog when `interval_override` is active.** The Sensitivity pills remain interactive — the user can pre-select a profile to fall back to. The daemon ignores the profile-derived interval while an override is active; to change the override itself, use the Connection Watchdog settings page (the watchdog is the sole writer of `interval_override`).
- **Reload is flag-file per loop, not a signal.** A flag written mid-cycle is read at the start of the next one: at most one interval plus one cycle later (about `10 + 4 = 14 s` on `quiet`).
- **Unknown profile names fall back to `relaxed`.** If you hand-edit UCI to an unrecognised profile name, the daemon silently resets to `relaxed` and continues. No error is logged.
- **False high-packet-loss immediately after a reboot is structurally prevented by `PING_MIN_SAMPLES=10`.** The poller suppresses `packet_loss_pct` to `0` until the ring-buffer window holds at least 10 samples (~20–100 s depending on profile). Without this guard, two transient boot-attach null probes in a 4-sample window report 50% loss, which trips the Connection Watchdog quality trigger and can cause a reboot loop. Do not remove this guard. Real outages are still caught by the independent `streak_fail` reachability path.
- **Attach warm-up: pre-attach probes are not loss.** `qmanager_ping` starts before the data call is up, so its first few probes after boot fail. The maturity guard alone only delayed the problem: once the window reached 10 samples those nulls read as 20 % loss (2/10, decaying over the 60-sample ring, ~10 min at `quiet`), enough for `degraded` and `high_packet_loss` on the `standard` preset, and a red strip. Until the first probe answers, at most `ATTACH_GRACE_SECS=120` after daemon start (on `mono_now`), a failed probe still drives `streak_fail` and `reachable` (watchdog and verdict unchanged) but is **not** written to the ring. `/tmp/qmanager_ping_attaching` exists for that span (removed on first answer, at the cap, and by the EXIT trap), and `append_ping_history` in the poller skips archive rows while it exists **and** the ping cache is fresh (`conn_internet_available != null`), so those seconds show as unmeasured instead of an outage. If nothing answers within the cap, failures are recorded again, so a boot with no service still shows red after 2 min.

> ℹ️ NOTE: Validated on the RM551E on 2026-11-06: healthy cycles send one probe with a 10.01 s period on `quiet`; a blackholed primary (`192.0.2.1`) hands the answer to `s4` with `reachable` unchanged and no history loss; firewall-dropped ICMP gives the time-to-fail and recovery figures under [Debounce and loop timing](#debounce-and-loop-timing).
