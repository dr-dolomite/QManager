# Alerts

Alerts notifies you when the modem's internet connection drops and when it comes back, over SMS and/or email. It replaces two previously separate pages (SMS Alerts, Email Alerts) — each with its own downtime-detection state machine — with **one page, one CGI, and one poller-resident detection engine**. The mental model is a **trigger × channel routing matrix** (which event goes to which channel) layered on top of a **capability table** (which event/channel pairs are physically possible at all) — the two are deliberately separate concepts, and the backend is the sole authority for capability.

A third event, **`reboot`**, tracks every real device restart — detected via the kernel `boot_id`, classified into `watchdog`/`user`/`unplanned`, and delivered post-recovery once connectivity is back (see [Reboot Alerts](#reboot-alerts) below). It is **opt-in** (off on both channels by default); detection and the "Recent reboots" history record every boot regardless of routing.

A fourth event, **`thermal_throttling`**, fires once per heat-throttling episode (see [Thermal Throttling Alert](#thermal-throttling-alert) below and [`thermal-throttling.md`](thermal-throttling.md)). It is also **opt-in** and additive within routing version 2.

## Quick Reference

| Item | Value |
|---|---|
| CGI | `GET/POST /cgi-bin/quecmanager/monitoring/alerts.sh` |
| Routing + capability library | `/usr/lib/qmanager/alert_routing.sh` |
| Detection engine library | `/usr/lib/qmanager/alert_engine.sh` |
| SMS transport library | `/usr/lib/qmanager/sms_alerts.sh` |
| Email transport library | `/usr/lib/qmanager/email_alerts.sh` |
| SMS config | `/etc/qmanager/sms_alerts.json` (shape unchanged) |
| Email config | `/etc/qmanager/email_alerts.json` (shape unchanged) |
| Routing config | `/etc/qmanager/alert_routing.json` (version 2, additive `reboot` and `thermal_throttling` events) |
| Single alert wait | UCI `quecmanager.quality_thresholds.alert_after_min` (logical `connection_quality.alert_after_min` through the platform adapter; minutes, 1-1440, optional, never seeded); resolver `cq_alert_after_min` in `/usr/lib/qmanager/qm_platform_cqwd.sh` (reachable through `conn_state.sh`) |
| Link detector | `detect_data_connection_events` in `/usr/lib/qmanager/events.sh` (publishes `ev_link_state`; the engine follows it) |
| Thermal detector | `detect_thermal_events` in `/usr/lib/qmanager/events.sh` (publishes the `ev_thermal_active` / `ev_thermal_since_mono` / `ev_thermal_parts` latch that `_ae_thermal_check` follows) |
| SMS log | `/tmp/qmanager_sms_log.json` (NDJSON, cap 100) |
| Email log | `/tmp/qmanager_email_log.json` (NDJSON, cap 100) |
| Reload flags | `/tmp/qmanager_sms_reload`, `/tmp/qmanager_email_reload`, `/tmp/qmanager_alert_routing_reload` |
| msmtp config (generated) | `/etc/qmanager/msmtprc` |
| Shared reboot ledger | `/etc/qmanager/crash.log` (ubifs, persistent) — watchdog's `tier4_escalation` rows + this feature's `user`/`unplanned` rows, format `<epoch>\|reboot\|<reason>`, trimmed to 20 lines |
| Boot marker | `/etc/qmanager/last_boot_id` (persisted copy of `/proc/sys/kernel/random/boot_id`, compared once per poller start) |
| Reboot pending state | `/tmp/qmanager_reboot_pending.json` (tmpfs — survives a poller respawn, wiped by an actual reboot) |
| Reboot storm marker | `/tmp/qmanager_reboot_storm_hour` (mono-stamped, suppresses further reboot alerts for the rest of the hour) |
| Frontend route | `/monitoring/alerts` → `components/monitoring/alerts/alerts.tsx` |
| Hooks | `hooks/use-alerts.ts` (settings), `hooks/use-alerts-log.ts` (merged log) |
| Types | `types/alerts.ts` |
| Reboot | Never issues one itself — the CGI/backend only *observes* reboots. `record_planned_reboot` (`qlog.sh`) writes an intent breadcrumb before every OTHER path's reboot (system reboot button, scheduled reboot, IPPT apply, IMEI/MBN apply, watchdog tier-4 escalation, install/uninstall) so the next boot classifies correctly. |

## The Model: Routing vs. Capability

Four events, two channels:

- **Events**: `connection_lost` (internet has been down ≥ the single alert wait, `alert_after_min`, shared by both channels), `connection_restored` (it came back after a qualifying outage), `reboot` (the device restarted — see [Reboot Alerts](#reboot-alerts)), `thermal_throttling` (the modem has been heat-throttling for the alert wait — see [Thermal Throttling Alert](#thermal-throttling-alert)).
- **Channels**: `sms`, `email`.

**Routing** is a *user preference* — "should this event go out over this channel" — persisted in `alert_routing.json` and edited from the routing matrix on the Alerts page.

**Capability** is a *physical fact* the backend owns: `alert_capable()` in `scripts/usr/lib/qmanager/alert_routing.sh` hard-codes that `connection_lost/email` is the only incapable pair — email needs the internet and DNS to send, both of which are down during the very outage it would be reporting. Every other pair is capable, including both `reboot` cells — a reboot alert is by definition delivered *after* connectivity is back, so email is never actually incapable for it. Both `thermal_throttling` cells are capable too: a throttle does not take the link down. The engine instead holds the email leg while the internet is unreachable (see [Thermal Throttling Alert](#thermal-throttling-alert)).

```sh
alert_capable() {
    case "$1/$2" in
        connection_lost/sms)       return 0 ;;
        connection_lost/email)     return 1 ;;
        connection_restored/sms)   return 0 ;;
        connection_restored/email) return 0 ;;
        reboot/sms)                return 0 ;;
        reboot/email)              return 0 ;;
        thermal_throttling/sms)    return 0 ;;
        thermal_throttling/email)  return 0 ;;
        *)                         return 1 ;;
    esac
}
```

The **effective send rule**, evaluated once per channel by the engine: `channel master-enabled AND routing-cell true AND capable`.

> ⚠️ WARNING: Capability is clamped **server-side in two places**, not just rendered client-side: `alert_routing_load()` forces `_ar_cl_email="false"` after reading the file (`alert_routing.sh:78`), and `save_settings` in the CGI hard-sets `r_cl_email="false"` before writing regardless of what the client posted (`alerts.sh:268`). `config_backup_sections.sh`'s `apply_alert_routing()` does the same on restore (`.events.connection_lost.email = false`, `config_backup_sections.sh:160`). A stale or hand-edited `alert_routing.json` claiming `connection_lost.email:true` can never actually route — all three read/write paths refuse it.

**Why split routing from capability:** the frontend never hard-codes which cells are toggleable. `alerts.sh` GET returns a `capabilities` object (`alert_capabilities_json()`, `alert_routing.sh:119-121`) with a stable `email_reason: "email_needs_internet"` key; the Channels card's "Sends for" list (`SendsFor` in `alerts-settings-card.tsx`, via `readCapability` in `derive.ts`) renders the reason in place of a checkbox for any pair where `capabilities[event][channel]` is `false`, and a live checkbox otherwise. If a future event/channel pair becomes capable, the UI updates itself — no frontend redeploy needed, only a backend `alert_capable()` change.

### Default routing = legacy behavior (zero-regression upgrade)

```json
{"version":2,"events":{"connection_lost":{"sms":true,"email":false},"connection_restored":{"sms":true,"email":true},"reboot":{"sms":false,"email":false},"thermal_throttling":{"sms":false,"email":false}}}
```

This is exactly what the two old pages did before centralization (SMS fired on both events, email only fired on recovery). An upgrade with no `alert_routing.json` present fails closed to these defaults (`alert_routing_load()` resets to them before reading the file), and the installer idempotently seeds the same document (via `alert_default_routing_json()`), so existing SMS/email settings and behavior carry over unchanged.

> ℹ️ NOTE: The document is now **version 2** — the additive `reboot` key. No migration step exists or is needed: `alert_routing_load()` reads `.events.reboot.sms`/`.email` with the null-safe `if . == null then "false" else tostring end` form, so a v1 file on disk (no `reboot` key at all) silently fail-closes both `reboot` cells to `false`. That fail-closed default is exactly the desired opt-in behavior, so an existing v1 file never needs to be rewritten just to pick up the new event.

> ℹ️ NOTE: `thermal_throttling` is additive **within version 2** (no version bump). `alert_routing_load()` reads `.events.thermal_throttling.sms`/`.email` with the same null-safe form, so a file without the key (every file written before this event) reads as off/off. The CGI `save_settings` treats a missing `routing.events.thermal_throttling.*` as `false`. `collect_alert_routing()` (Config Backup) emits the cell, with `false` for a missing key, and `apply_alert_routing()` passes it through with no clamp.

## The Engine: Poller-Sourced, Not a Daemon

`alert_engine.sh` is a **library sourced into `qmanager_poller`**, not a standalone process. It replaces the two duplicated per-channel state machines that used to live in `sms_alerts.sh::check_sms_alert` and `email_alerts.sh::check_email_alert` with one downtime state machine (`_ae_outage_active`, `_ae_outage_start_mono`, per-channel `armed`/`lost_sent` flags — all poller-process memory, not persisted to disk).

`alert_engine_check` is called from the poller's **always-every-cycle local block**, before any AT command:

```
qmanager_poller poll_cycle():
  update_proc_metrics
  read_ping_data        # sets conn_internet_available / conn_during_recovery
  read_dns_data
  parse_thermal + detect_thermal_events   # every 5th cycle (~10 s): sets the ev_thermal_* latch
  detect_data_connection_events   # events.sh: the ONE link detector, sets ev_link_state
  alert_engine_check     # <-- here, every 2s base cycle, every tier
```

**Why here:** this is the same "no modem access, runs regardless of adaptive-polling tier" block that keeps watchdog connectivity data fresh (see [Adaptive Polling](adaptive-polling.md) Invariant 1 — `write_cache`/`read_ping_data` always run). Alert detection reads ICMP reachability that `read_ping_data` just wrote and needs to keep running at the base 2s cadence even when AT reads back off into the Idle/Deep tier — an outage doesn't pause just because the modem is quiet.

**The engine has no edge detector of its own.** Since ledger B2.3, `detect_data_connection_events` (`events.sh`) is the only place a link transition is decided; it publishes `ev_link_state` (`down` / `up` / `""`) and the engine just follows it (`down` runs `_ae_handle_down`, `up` runs `_ae_handle_up`, `""` leaves a running outage untouched and starts nothing). **Why:** with two detectors the Activity feed and the alert channels could disagree about whether an outage happened (live evidence: two consecutive `internet_lost` with no restore between). It is called from the poller's local block, not from `detect_events`, because `detect_events` only runs when an AT read is due. The detector's rules (reachable verdict, stale handling, recovery handling) are in [Connection Quality](connection-quality.md#one-detector-eventssh).

**Library sourcing order** (`qmanager_poller:302-335`) matters — `alert_engine.sh` is sourced last because it reads globals/functions owned by everything before it:

```
qlog.sh (mono_now, qlog_*) → events.sh → email_alerts.sh → sms_alerts.sh
  → alert_routing.sh → alert_engine.sh
```

`alert_engine_init` runs once at poller startup (`main()`, after `email_alerts_init`/`sms_alerts_init` so the engine's channel-enabled reads see already-loaded channel config), resets state to idle, reloads the last cleared outage and resolves the single wait.

**Last cleared outage.** `_ae_handle_up` keeps the outage's length and mono end stamp (`_ae_last_outage_s`, `_ae_last_outage_end_mono`) before the reset, and persists them to `/tmp/qmanager_last_outage` so a poller respawn keeps them. The poller publishes them as `connectivity.last_outage_*` for the dashboard; see [Connection Quality](connection-quality.md#last-outage).

### One alert wait for every channel

A `connection_lost` / `connection_restored` pair only reaches a channel when the outage lasted at least the **single wait**, owned by Connection Quality: UCI `quecmanager.quality_thresholds.alert_after_min` (minutes). The resolver `cq_alert_after_min` (`qm_platform_cqwd.sh`, reachable through `conn_state.sh`) sets `CQ_ALERT_AFTER_MIN`: the UCI key (integer 1-1440) when valid, else `threshold_minutes` from `/etc/qmanager/sms_alerts.json`, else from `email_alerts.json` (where the wait lived before it moved, so an upgrade keeps the user's value), else `5`. The engine re-resolves at init, at outage start and on every SMS/email reload flag; the poller re-resolves on `/tmp/qmanager_quality_reload`. `_ae_wait_secs` turns it into seconds (300 on garbage). Both channels arm on the same threshold (arming still ignores capability, see below).

The per-channel `threshold_minutes` fields survive only as a compatibility shape: `sms_alerts.sh` / `email_alerts.sh` `_read_config` set `_sa_threshold_minutes` / `_ea_threshold_minutes` to the single wait, and `monitoring/alerts.sh` mirrors the wait into both channel files (see [CGI](#cgi-monitoringalertssh)).

### Clock-step hardening (`mono_now`)

The downtime timer measures elapsed time with `mono_now()` (`/proc/uptime`'s monotonic integer seconds), **not** wall-clock epoch. `_ae_outage_start_mono` is stamped at the leading edge of an outage and every subsequent elapsed calculation is `mono_now() - _ae_outage_start_mono`.

**Why:** an SSR (baseband subsystem restart) can trigger a NITZ time step that jumps the wall clock mid-outage. A wall-clock timer would see a multi-hour "jump" and either fire immediately or never fire depending on jump direction. This mirrors the exact hardening already validated for the watchdog's staleness detection (see [Connection Watchdog](connection-watchdog.md) `ssr_aware`/SSR-hold section) — `/proc/uptime` is unaffected by NTP/NITZ steps.

### Suppression (both channels, one place)

`alert_engine_check` has no global suppression gate: it follows `ev_link_state` every cycle.

A watchdog recovery (`conn_during_recovery = "true"`) **no longer freezes the outage machine**. Before B2.3 the engine bailed entirely during recovery, so an outage the watchdog fixed was invisible to the channels. Now:

- The outage is tracked and alerted like any other. The mono timer runs through the recovery; if the wait elapses mid-recovery the `connection_lost` SMS is attempted.
- A send made mid-CFUN returns SMS rc 2 (modem not registered), which the engine already treats as "retry next cycle without burning the attempt", so no extra gate is needed.
- Link flapping caused by recovery tiers cannot produce extra alerts: the detector holds a repeat drop after an in-recovery restore (`ev_recov_restored`), so one outage is one lost/restored pair.
- **Reboot delivery is still held** during recovery and on stale ping data (`_ae_reboot_check` runs only when `conn_during_recovery != "true"` and `conn_internet_available` is `true` or `false`): a post-recovery reboot message needs a settled link.

> ℹ️ NOTE: The earlier fix that gave email the same recovery gate SMS had is superseded: neither channel is gated by recovery any more, both follow `ev_link_state`.

### `sms_alert_emit` / `email_alert_emit` — the rc contract

The engine dispatches to the channel libs via `sms_alert_emit <event> <secs> [<cause> [<count>]]` / `email_alert_emit <event> <secs> [<cause> [<count>]]` (`_ae_channel_emit`). The two optional args are only read by the `reboot` and `thermal_throttling` messages. `_ae_channel_emit` takes the channel first, so its own arguments are `$1` channel, `$2` event, `$3` seconds, `$4` and `$5` forwarded as `<cause>` and `<count>`; for `thermal_throttling` `$4` is the affected-parts label (`5G, LTE`, may be empty) and `$5` is the headroom in whole degrees C (may be empty, the clause is then omitted). Both return one of three codes the engine interprets identically:

| rc | Meaning | Engine behavior |
|---|---|---|
| `0` | Sent | Marks `lost_sent=1` for the channel; won't re-attempt this outage |
| `1` | Attempted, failed (terminal — e.g. `qsms send` error, msmtp failure after 3 retries) | Marks `lost_sent=1`; won't re-attempt this outage |
| `2` | Not ready, retry later (SMS: modem not yet registered, or every attempt that reached `qsms` failed with `modem_busy` / `scan_in_progress`) | Leaves `lost_sent` clear; retried next cycle without burning an attempt |

`email_alert_emit` never returns `2` — it has no registration concept — and treats `connection_lost` as a deliberate no-op success (`return 0`) rather than attempting a send it knows is incapable, since the engine still calls `_ae_channel_emit` for the *arming* check even on incapable pairs (arming determines whether a later `connection_restored` fires; sending does not).

**The log names the trigger key, never a sentence.** Since ledger B2.4 both libs write the event key into the NDJSON log's `trigger` field (`connection_lost`, `connection_restored`, `reboot`, or `test` for a CGI test send), not English text like "Test SMS" or "Reboot (user) ~5m ago". The Activity table translates the key (`triggerLabelKey` in `constants.tsx`: the event's `alerts.event_<key>_name`, or `alerts.trigger_test`); a row logged before the change has no key and renders as logged. The send detail (duration, cause) stays in the message itself, not the log.

**Log trims copy through the inode.** The poller and a CGI test send can both append and trim the same log, so the trim writes to a per-process temp (`.tmp.$$`) and copies it back over the same inode (`cat tmp > log`), never `mv`. A shared fixed `.tmp` name let two trimmers clobber each other's temp.

**msmtp has a network timeout.** `_ea_do_send` passes `--timeout=30` on the command line (not in `msmtprc`, so configs generated before the change get it too). Without it a dead route held the send for the OS connect timeout (about two minutes) on each of the three attempts, stalling the poller cycle. Verified on the RM551E's msmtp 1.8.25: an unreachable host gives up after the set timeout (rc 75).

**Arming vs. sending are independent.** In `_ae_handle_down` (`alert_engine.sh:183-206`), a channel is armed (`_ae_set_armed`) purely from the outage crossing the single wait — capability is not checked for arming. Only the actual `connection_lost` send attempt is gated by `alert_route_enabled` (routing AND capability). This is why email arms during an outage (warranting a `connection_restored` email later) even though it never sends a `connection_lost` email.

## Reboot Alerts

Unlike `connection_lost`/`connection_restored`, a reboot has no outage window and no downtime timer — it is a **separate one-shot detect-then-deliver path** inside `alert_engine.sh`, called from `alert_engine_check` (`_ae_reboot_check`, step 2, only while `conn_during_recovery != "true"` and the ping data is not stale, so it inherits recovery-churn suppression; it runs before the outage machine).

### Detection: `boot_id`, not uptime or a shutdown hook

The device exposes no clean-shutdown signal — a reboot can be a button press, a panic, or a power cut, and QManager cannot instrument any of them from userspace. Instead, detection happens **once per poller start**, in `alert_engine_reboot_detect()` (called from `qmanager_poller`'s `main()`, right after `alert_engine_init`):

1. Read `/proc/sys/kernel/random/boot_id` — a per-boot kernel UUID, regenerated on every real reboot, stable for the lifetime of a boot.
2. Compare it against the value persisted in `/etc/qmanager/last_boot_id` (ubifs, survives the reboot being detected).
3. **Unchanged** → this poller start is a bare procd respawn (crash, manual restart), not a reboot. No alert is staged, and any already-staged pending alert is left untouched.
4. **Changed** → a real reboot happened. Classify the cause, stage a pending alert, and immediately overwrite `last_boot_id` with the new value (so a mid-boot procd respawn of the *new* boot can't re-detect the same reboot a second time).
5. **No stored value** (fresh install / first boot ever) → record the id and stage nothing. There is no "before" to compare against.

**Held until the clock is set (ledger B2.4).** Classification compares crash.log's wall-clock epochs against `now - uptime`, and at poller start the wall clock can still read 1970 (NITZ/ntpd not stepped yet). Classifying then misses the in-window breadcrumb (a planned reboot labelled `unplanned`) and writes the post-facto `unplanned` row with a 1970 epoch. So when `boot_id` changed but `date +%s` is below `_AE_SANE_EPOCH` (1700000000), detection holds: it stores the live id in `_ae_boot_unresolved`, does **not** commit `last_boot_id` (a poller respawn in the window re-detects it) and stages nothing. `alert_engine_check` step 1b retries `alert_engine_reboot_detect` every cycle until the clock is sane; it runs ahead of the outage machine because it only records the reboot. The "holding" log line prints once per boot id. Harness-verified on the RM551E with a stubbed 1970 clock: nothing committed or written while held; one classification with a real epoch once the clock was restored, and no second detection.

**Why `boot_id` and not `/proc/uptime` or a wall-clock delta:** a baseband subsystem restart (SSR) does **not** reset the kernel's uptime counter or regenerate `boot_id` — only a real Linux kernel reboot does. Any detector built on uptime dropping, or on a wall-clock gap, would misfire on every SSR self-heal (already a semi-frequent event on this hardware — see [Connection Watchdog](connection-watchdog.md) SSR-aware hold). `boot_id` is also immune to the NITZ/ntpd clock-step problem the rest of this engine works around.

> ℹ️ NOTE: `alert_engine_reboot_detect` is stubbed to a no-op alongside `alert_engine_check`/`alert_engine_init` in the poller's `[ -f ] && .`-guarded fallback for a missing `alert_engine.sh` (same guard pattern as `record_planned_reboot` below, applied to a different library) — an old poller on a device that hasn't picked up `alert_engine.sh` yet simply never detects reboots, degrading gracefully rather than crashing.

### Classification: three causes from one shared ledger

`/etc/qmanager/crash.log` — previously watchdog-only — is now a **shared reboot ledger** written by multiple producers, one row per real reboot, format `<epoch>|reboot|<reason>`:

| Reason tag | Writer | Meaning |
|---|---|---|
| `tier4_escalation` | `qmanager_watchcat` (unchanged) | Watchdog's own tier-4 recovery reboot |
| `user` | `record_planned_reboot "user"` (new — see below) | Any intentional reboot: CGI reboot button, scheduled reboot, IPPT apply, IMEI/MBN apply, install/uninstall |
| `unplanned` | `alert_engine_reboot_detect` (post-facto, this feature) | A boot with no matching breadcrumb — recorded *after* the fact purely so it shows up in history/storm-counting |

At detection time, `_ae_classify_reboot <boot_epoch>` scans `crash.log` for the **newest row within a ±300s window** (`_AE_REBOOT_WINDOW`) of the computed boot epoch (`now - uptime`, deliberately wall-clock since it's compared against wall-clock breadcrumbs) and maps it: `tier4_escalation` → `watchdog`, `user` → `user`, anything else / no match → `unplanned`. A 300s window absorbs normal boot time and modest clock drift without being wide enough to swallow the *previous* reboot's breadcrumb.

An inferred-`unplanned` boot has, by definition, no breadcrumb of its own — `alert_engine_reboot_detect` writes one post-facto (`record_planned_reboot "unplanned"`) purely so it appears in the "Recent reboots" history and counts toward the all-cause hourly rate. `record_planned_reboot` is a neutral ledger writer despite its name (named for its primary caller set, the pre-reboot breadcrumb writers).

> ⚠️ WARNING: **`crash.log` now has two classes of consumer with different scopes, and conflating them breaks either the watchdog reboot budget or the reboot-alert rate.** `qmanager_watchcat`'s `count_recent_reboots()` (which feeds the hourly Tier-4 reboot budget, the long-run guard and the dashboard's `reboots_this_hour`) was tightened to `awk ... $3 == "tier4_escalation"` — it counts **only** watchdog rows, exactly as before this feature landed. `alert_engine.sh`'s `_ae_reboot_count_last_hour()` (the storm coalescer, below) counts **every** row regardless of reason — it's the true all-cause boot rate. Do not merge these two counters or change one without checking the other; see [Connection Watchdog](connection-watchdog.md) for the watchdog-side half of this contract.

### `record_planned_reboot` — the pre-reboot breadcrumb

`record_planned_reboot <reason>` (`scripts/usr/lib/qmanager/qlog.sh`) appends a row to `/etc/qmanager/crash.log` under `flock -x` on `/tmp/qmanager_crashlog.lock`, then trims the file to the last 20 lines (mirroring watchcat's own tier-4 writer). The `reason` argument is sanitized to `[a-z_]` only — a stray `|` or newline would corrupt the pipe-delimited format every consumer parses.

It is called **synchronously, before** the actual reboot, by every intentional-reboot path in the codebase:

| Caller | File | Notes |
|---|---|---|
| `cgi_reboot_response` | `scripts/usr/lib/qmanager/cgi_base.sh` | Now takes an optional reason arg (defaults `"user"`); used by `system/reboot.sh`, `cellular/imei.sh`, `cellular/mbn.sh` |
| `qmanager_scheduled_reboot` | `scripts/usr/bin/qmanager_scheduled_reboot` | Cron-triggered reboot |
| `network/ip_passthrough.sh` | IPPT apply-then-reboot path | Called before the backgrounded `reboot` |
| `qmanager_imei_check` | Backup-IMEI restore path | Called before `reboot` |
| `install.sh` / `uninstall.sh` `reboot_system()` | Installer/uninstaller | Best-effort — see the guard note below |

The watchdog's own tier-4 writer is deliberately **not** routed through `record_planned_reboot` — it keeps writing `tier4_escalation` rows directly and does not take the `record_planned_reboot` lock, because it is already about to reboot and never races a planned writer.

> ⚠️ WARNING: **`. FILE` on a missing file is fatal in BusyBox `ash` — even inside an `if` condition, and even with `2>/dev/null || { stub }`.** Every one of the callers above guards the `qlog.sh` source with `[ -f /usr/lib/qmanager/qlog.sh ] && . /usr/lib/qmanager/qlog.sh` (or the `if [ -f ... ]; then . ...; else <stubs>; fi` form) before calling `record_planned_reboot`, because a bare `. qlog.sh 2>/dev/null || { stubs }` would abort the whole script the instant the file is absent — the `||` clause never runs. This bit the **uninstall → reboot** path specifically: uninstall normally runs *after* `/usr/lib/qmanager` has already been removed, so `qlog.sh` is expected to be missing on that path, and the guard is load-bearing rather than defensive boilerplate. See [`docs/BACKEND.md`](../BACKEND.md#busybox-ash-dot-sourcing-a-missing-file-kills-the-shell) for the general rule — this is the case that generalized it beyond the original `. FILE || {}` form.

### Delivery: pending file, storm coalescer, rc-2 reuse

A detected reboot stages `/tmp/qmanager_reboot_pending.json` — deliberately **tmpfs**, so an actual reboot wipes it (nothing to deliver until the *next* detection cycle re-stages fresh), while a bare poller respawn mid-delivery leaves it intact so an unsent alert survives:

```json
{"boot_id":"<uuid>","cause":"watchdog","detected_mono":12345,"sms_sent":false,"email_sent":false}
```

Every poller cycle, `_ae_reboot_check` early-outs if no pending file exists (the common case), then waits for `conn_internet_available == "true"` before doing anything else — a reboot alert is inherently post-recovery, since at the reboot instant all of userspace (SMS/email transports included) was dead.

**Storm coalescer:** before per-channel delivery, `_ae_reboot_count_last_hour()` (all-cause, see the warning above) is checked against `_AE_REBOOT_STORM_THRESHOLD` (3). Above threshold, a **single** coalesced "reboot-looping (N/hr)" message is sent per channel instead of one alert per boot (SMS costs money, and a looping device doesn't need N separate pages), and `/tmp/qmanager_reboot_storm_hour` is mono-stamped so further reboot alerts are suppressed for the rest of the hour. The pending file is dropped either way — the storm message consumes it.

**Per-channel delivery** (`_ae_reboot_deliver_channel`) reuses the exact `sms_alert_emit`/`email_alert_emit` rc-contract documented above: SMS returns `2` ("not ready") until the modem has re-registered post-reboot, which the engine treats as "retry next cycle, don't mark done"; email has no registration concept and either sends or terminally fails. A channel that is master-disabled or not routed for `reboot` is trivially "done" (nothing to send) via `_ae_reboot_channel_done`. The pending file is cleared only once **both** channels are done — sent, terminally failed, or not-actionable.

### Frontend: reboots in Activity

Since ledger U4.9 recorded reboots are not a card of their own: the Activity card interleaves `state.reboots` (from the same `useAlerts()` GET, no separate poll loop) with the delivery log by time. A reboot row shows regardless of whether the `reboot` alert is routed anywhere, because the history's value is independent of whether you chose to be notified. Its glyph and tag name the cause (`REBOOT_GLYPH` / `REBOOT_CAUSE_KEY` in `alerts-log-card.tsx`: `unplanned` → `TriangleAlertIcon` "Unexpected", `watchdog` → `ShieldCheckIcon` "Watchdog", `user` → `PowerIcon` "Planned"); an unknown cause falls back to `unplanned`.

## Thermal Throttling Alert

`thermal_throttling` tells you the modem has been slowing its radio or CPU because of heat. It is a **non-outage, once-per-episode** event driven by the `ev_thermal_*` latch from `detect_thermal_events` (`events.sh`, debounced about 20 s to enter and 30 s to exit; see [`thermal-throttling.md`](thermal-throttling.md)). It is opt-in: off on both channels by default.

`alert_engine_check` calls `_ae_thermal_check` as **step 2b**, after the reboot check (step 2) and before the link signal (step 3):

```
1   reload gate            1b  deferred reboot detect
2   reboot alert           2b  thermal throttling alert   <-- _ae_thermal_check
3   link signal (ev_link_state) -> outage machine
```

**Inputs.** `ev_thermal_active` (0|1), `ev_thermal_since_mono` (the `mono_now` clock), `ev_thermal_parts` (space-separated union over the episode) and `thermal_headroom_c` (message text only). Unset reads as inactive.

**Semantics.**

- **One send per episode, per channel**, once the episode has lasted the same single wait the outage alerts use (`_ae_wait_secs`, from `alert_after_min`). An episode shorter than the wait is logged in Activity and never sent.
- **A new `ev_thermal_since_mono` re-arms both channels.** The engine remembers the episode it is tracking (`_ae_th_ep`) and compares stamps; no explicit reset is needed. It also clears the state (and logs "thermal episode over") on the first cycle where `ev_thermal_active != 1`.
- **Each channel finishes on its own** (`_ae_th_sms_done`, `_ae_th_email_done`): rc 0 (sent) and rc 1 (terminal failure) end that channel's episode; rc 2 retries next cycle. A channel that is master-disabled or not routed is skipped (and retried each cycle until the episode ends, which costs nothing).
- **Email is held while `conn_internet_available != "true"`.** An smtp attempt without DNS or a route would block the poller's local block for minutes, so the engine skips the leg and retries next cycle instead of burning the attempt. SMS is not gated on the link.
- **SMS rc 2 retries.** `sms_alert_emit` returns 2 when the modem is not registered (`_sa_is_registered`) without calling the sender.
- **Not gated on `conn_during_recovery`.** A throttle is independent of the watchdog.
- **No "recovered" message.** The Activity feed already carries `thermal_recovered`.
- **A poller respawn mid-episode may duplicate one alert.** The latch and the engine's sent flags are poller memory. The new poller starts a fresh episode with a new `ev_thermal_since_mono`, waits the full `alert_after_min` again and can send a second message for what is physically one episode. This is accepted.
- **SMS text is ASCII only:** `[QManager] Modem is thermal throttling (5G, LTE) for 5m. Temperature headroom: 6 C.` The parts and headroom clauses are dropped when empty. **Why:** a degree sign forces UCS-2 encoding and cuts the message to 70 characters, so the unit is written as the letter `C`.
- **Email:** subject `Thermal Throttling`, a "Thermal Alert" body with Affected (parts), Throttling for (duration) and Temperature headroom rows; the Affected and headroom rows are omitted when empty.
- Both libs log `trigger: "thermal_throttling"`; the Activity table translates it with the event's `alerts.coverage.event.thermal_throttling.name`.

> ℹ️ NOTE: The "Wait before alerting" hint on the Channels card now reads "Outages and heat throttling shorter than this are logged, not sent."

## CGI (`monitoring/alerts.sh`)

Unified replacement for four retired endpoints: `monitoring/sms_alerts.sh`, `monitoring/email_alerts.sh`, `monitoring/sms_alert_log.sh`, `monitoring/email_alert_log.sh`. All four are deleted from the repo and actively removed from `/www/cgi-bin/quecmanager/monitoring/` on upgrade (`install.sh:1094-1104`, unconditional — harmless no-op on fresh installs).

**GET** response:

```json
{
  "success": true,
  "channels": {
    "sms":   { "enabled": true, "recipient_phone": "14155551234", "threshold_minutes": 5, "configured": true },
    "email": { "enabled": true, "sender_email": "a@gmail.com", "recipient_email": "b@example.com",
               "app_password_set": true, "threshold_minutes": 5, "msmtp_installed": true, "configured": true }
  },
  "routing": {
    "events": {
      "connection_lost":     { "sms": true, "email": false },
      "connection_restored": { "sms": true, "email": true },
      "reboot":              { "sms": false, "email": false },
      "thermal_throttling":  { "sms": false, "email": false }
    }
  },
  "capabilities": {
    "connection_lost":     { "sms": true, "email": false, "email_reason": "email_needs_internet" },
    "connection_restored": { "sms": true, "email": true },
    "reboot":              { "sms": true, "email": true },
    "thermal_throttling":  { "sms": true, "email": true }
  },
  "reboots": [
    { "epoch": 1737158400, "cause": "watchdog" },
    { "epoch": 1737100000, "cause": "user" },
    { "epoch": 1737000000, "cause": "unplanned" }
  ]
}
```

`email.app_password_set` is a boolean — the cleartext password is **never** returned by GET.

**`threshold_minutes` is one value.** GET reports the single wait (`cq_alert_after_min`) as both channels' `threshold_minutes`, not the value in the channel file. On `save_settings`: a channel that omits `threshold_minutes` keeps the current wait; if both are posted the last one that differs from the current wait wins (an unchanged field never overwrites an edit); the result is still validated 1-60. The CGI writes UCI `quality_thresholds.alert_after_min` (creating the section if absent) when the wait changed or the key is absent, then mirrors the wait into both channel files so Config Backup's strict gate keeps passing. The Connection Quality page does not edit this key (its unified CGI has no wait field); this CGI and Config Backup are the only writers ([connection-quality.md](connection-quality.md#alert-wait-alert_after_min)).

`reboots` is read straight from the shared `/etc/qmanager/crash.log` ledger (all reason tags, not just this feature's own rows), newest-first, capped at 10. It powers the Recent Reboots card and is independent of `routing.events.reboot` — a reboot is always recorded here even when the alert itself is routed to neither channel.

**POST actions** (dispatched on `.action`):

| Action | Body | Notes |
|---|---|---|
| `save_settings` | `{sms:{...}, email:{...}, routing:{events:{...}}}` | Writes all 3 config files atomically (temp-file + validate + `mv`); clamps `connection_lost.email` to `false` server-side regardless of the posted value; a missing/null `routing.events.reboot.*` defaults to `false` (opt-in), unlike the other events which default `true`/preserve; no server-side clamp on `reboot` (both channels stay capable); a missing/null `routing.events.thermal_throttling.*` defaults to `false` the same way and is not clamped; touches all 3 reload flags |
| `send_test` | `{channel: "sms"\|"email"}` | Sends a real test message over the real send path; requires the channel be `enabled` (not just filled in) |
| `install` | — | Installs `msmtp` via `opkg` in the background; progress file at `/tmp/qmanager_msmtp_install.json` |
| `install_status` | — | Polls install progress |
| `uninstall` | — | Removes `msmtp`; refused with `still_enabled` while email alerts are still enabled |
| `get_log` | — | Merges both NDJSON logs, tags each entry `channel:"sms"\|"email"`, sorts by timestamp, returns newest-first, capped at 100 |

**On-disk shapes are unchanged for backward compat** — `sms_alerts.json`/`email_alerts.json` keep exactly the same fields they had before centralization. This matters because `config_backup_sections.sh`'s `apply_sms_alerts()` has a strict `jq -e 'has("enabled") and has("recipient_phone") and has("threshold_minutes")'` gate; that gate is unchanged and still passes against `save_settings`'s output.

### Validation gotchas

- **No regex in jq on this device** (see [Error Code Vocabulary](error-codes.md) and the device-jq note in project memory) — `_validate_phone`/`_validate_email` in `alerts.sh` do shape-checking in POSIX shell/`grep -E`, not `jq test()`.
- **Never `//` on a routing boolean.** A routing cell that is legitimately `false` (e.g. `connection_lost.email`) must survive a round-trip. Every boolean read in `alert_routing.sh` and `alerts.sh` uses the null-safe `if . == null then <default> else tostring end` form, never `.foo // default` — `//` treats JSON `false` as falsy and silently coerces it to the default, which would have flipped `connection_lost.email` back to a truthy default and defeated the capability clamp.
- **Phone `+`-strip is preserved exactly**: a single leading `+` is stripped once before writing `sms_alerts.json` (`sed 's/^+//'`); GET/storage always return raw digits; the send path passes the stored value verbatim to `qsms send`. Same behavior as before centralization — see [SMS](sms.md#phone-number-handling).
- **Password preservation**: `save_settings` re-reads the currently-stored `app_password` from `email_alerts.json` when the client posts an empty one, so re-saving other email fields (or SMS/routing only) never blanks the stored password.

## Config Backup / Restore

`alert_routing` is a new, additive section in `config_backup_sections.sh` (`CFG_BACKUP_APPLY_ORDER`), inserted immediately after `sms_alerts` — both alert-config sections restore together, ahead of the riskier AT/IMEI work. `collect_alert_routing()` emits the canonical default document (now version 2, with `reboot`) when `alert_routing.json` is absent (deterministic restores). `apply_alert_routing()` validates `.events` is present, then **re-clamps `connection_lost.email = false`** on the incoming document before writing — restoring a backup taken on a hypothetical future version that allowed the pair can never re-enable it on this version. **`reboot` gets no clamp** and passes through untouched (both channels are legitimately capable), and so does `thermal_throttling`: `collect_alert_routing()` now includes its cell (a missing key is emitted as `false`/`false`, and the no-file default document carries it); a v1 backup with no `reboot` key restores fine — `alert_routing_load` fail-closes the missing cells to `false` on the next read, which is the correct opt-in default anyway. See [Config Backup & Restore](config-backup-restore.md) for the general apply-order/lock model.

> ℹ️ NOTE: Config Backup carries the wait twice. The `connection_quality` section holds `alert_after_min` (1-1440, restored after `sms_alerts`), and `sms_alerts.json` keeps the mirrored `threshold_minutes`. A backup whose `connection_quality` has a wait overwrites the device's UCI key; a backup without one **deletes** it, so the resolver falls back to the restored channel file's `threshold_minutes`. See [Config Backup & Restore](config-backup-restore.md).

## Install / Uninstall Lifecycle

- **Install**: the two new libs (`alert_engine.sh`, `alert_routing.sh`) and the new CGI (`monitoring/alerts.sh`) ship via the normal directory-driven copy; the four retired CGIs are actively deleted from the device on upgrade (not just omitted from the new tree). `alert_routing.json` is seeded idempotently — only if absent — by sourcing `alert_routing.sh` in a subshell and capturing `alert_default_routing_json()`, so the installer's own shell namespace never inherits the lib's globals. `install.sh`'s `reboot_system()` best-effort sources `qlog.sh` (present at this point — it was just deployed by the same install run) and drops a `user` breadcrumb before the post-install reboot.
- **Uninstall**: `alert_routing.json` is grouped with `sms_alerts.json`/`email_alerts.json` as user config — it is **not** unconditionally deleted. It follows the same `--keep-config`/`--purge`/ask-prompt treatment as every other file under `/etc/qmanager/`, swept up only by the wholesale `rm -rf "$CONF_DIR"` when the user chooses purge. `msmtprc` and the runtime logs/reload flags are removed unconditionally (regenerable / ephemeral state), matching prior behavior. `crash.log` (the shared reboot ledger) is **not** touched by uninstall either way — it lives outside `CONF_DIR`'s alert-specific keys and simply stops growing once no poller is left to write to it. `uninstall.sh`'s `reboot_system()` also best-effort sources `qlog.sh`, but by this point in the uninstall flow the library has normally already been removed — this is the path that made the `[ -f ] && .` guard load-bearing rather than defensive (see [Reboot Alerts](#reboot-alerts) above).

## Frontend

`/monitoring/alerts` is the compact bento ported from the RM520N fork (ledger U4.9, source `dd1cd602` + `71fb714c`). `alerts.tsx` renders a `MonitoringPageHeader` (`components/monitoring/page-header.tsx`) with ONE Refresh that reloads both reads, then a grid (`BENTO` in `shapes.ts`): **Coverage** over **Channels** on the left (3fr), **Activity** spanning both rows on the right (2fr, from `@5xl/main`). The retired pieces are the status band, the editable 3x3 routing matrix (`AlertRoutingGrid`) and `info-tip.tsx`.

- **Coverage** (`coverage-card.tsx`) shows SAVED truth only, from `deriveCoverage` (`derive.ts`, the page's one derived model: capable AND enabled AND routed). One row per event lists the channels that will deliver (neutral `Tag`s), a warning chip for a channel that would fire but is not configured, and a verdict chip in `CardAction` (all covered / outage not covered / n of m / nothing). A draft in Channels never moves it.
- **Channels** (`alerts-settings-card.tsx`) owns the write path: the one "Wait before alerting" field, a channel rail (`channel-rail.tsx`, roving-tabindex tablist; the dot reports saved status), and the selected channel's panel (Off/On `SegmentedField`, the "Sends for" checkboxes, its fields from `channel-field.tsx`). One `CardFoot` carries Test, Discard and the `SaveButton`; Save commits both channels and the routing in one POST. The form is `use-alerts-form.ts`, re-seeded in render on a settings signature (no remount, so the save flash and the active channel survive a save).
- **Optional events.** `OPTIONAL_ALERT_EVENTS` (`types/alerts.ts`) lists `thermal_throttling`. `visibleEvents(capabilities)` (`derive.ts`) hides an optional event the backend never advertised (an older device) instead of showing it as incapable, while a core event missing from the table still shows as incapable (fail closed). Coverage rows for optional events never pull the verdict down (`optional` on `CoverageRow`, "not sent" in quiet ink), and `AlertRouting.events` / `AlertCapabilities` are `Partial<Record<...>>`.
- **Activity** (`alerts-log-card.tsx` + `activity-row.tsx`) interleaves deliveries and reboots by time in day groups of 52px rows; the list scrolls inside the card and, wide, the card stretches to the left column's height (`FEED_FILL`). A read failure with rows in hand is a notice above them, never a blank card.

**The wait is sent per channel.** The target CGI still takes per-channel `threshold_minutes` (1-60) and mirrors the value into UCI `alert_after_min` (B2.3), so the form sends the one field as both channels' `threshold_minutes` and validates 1-60. The source's top-level `alert_after_min` (1-1440) in the POST was not ported.

**Triggers.** Activity names a row with `triggerLabelKey` (`constants.tsx`): an event key maps to `alerts.coverage.event.<key>.name`, `test` to `alerts.activity.trigger.test`, anything else (rows logged before B2.4) renders as logged.

**Not ported from the source:** the Discord channel (B3.2), the `scheduled` reboot cause (the target backend never reports it), the source's slug-to-key error map (the target's `resolveErrorMessage` result is used instead, see below). The mailer uninstall action left the UI with the source; `useAlerts().uninstall` remains. The log hook toasts only on a user Refresh, never on a failed first load (the card shows that).

> ✅ i18n parity (2026-07-18): all four non-EN locales (`it`, `id`, `zh-CN`, `zh-TW`) now carry the full 114-key `alerts.*` block in `public/locales/<lang>/monitoring.json`, and the dead `email_alerts`/`sms_alerts` blocks were removed from both `monitoring.json` and `sidebar.json` (the two old sidebar items collapsed into a single `items.alerts`). `bun run lib/i18n/check.ts` is clean (0 errors, 0 warnings). Per project convention `zh-TW` was derived from the freshly-translated `zh-CN` (Taiwan term variants: 簡訊/郵件/信箱/應用程式密碼/管道), not machine-translated from EN. Phone-example placeholders are localized per country (id `+62`, it `+39`, zh-CN `+86`, zh-TW `+886`); the `<link>` tag in `email_app_password_description` and all `{{placeholders}}` are preserved, and `log_showing_count_one/_other` follow each language's plural rule (identical for id/zh, inflected for it).
>
> ✅ Reboot-alert i18n backfilled (ledger B2.4, 2026-10-16): `event_reboot_name`/`_desc`, `reboot_cause_*`, `log_reboot_event`, `log_time_unknown` and the new `trigger_test` are in all five catalogs; `bun run i18n:check` is 0/0.

**Mutation failures come from the returned result (ledger B2.4).** `saveSettings`, `sendTest` and `uninstall` return an `AlertsMutationResult` (`{ok, error, code}`, `types/alerts.ts`): `error` is the CGI slug already translated through `resolveErrorMessage` (null for an unknown slug or a transport failure, so the caller's own generic copy shows, never the English `detail`), and `code` is the raw slug. The Channels card toasts `result.error`, falling back to `alerts.channels.save.failed`. Before, the handlers toasted `hook.error` after the `await`, a stale closure that was always `null`, so every failure showed the generic copy. A test send that fails with `send_failed` keeps the channel's own `alerts.channels.test.errors.send_failed_<channel>` line, since the shared errors-catalog line cannot say which channel. The hook's `error` state now means load failures only.

## Cross-References

- [Thermal Throttling](thermal-throttling.md) — the `.thermal` block, the `detect_thermal_events` latch and sampling invariants behind the `thermal_throttling` trigger.
- [Connection Watchdog](connection-watchdog.md) — status-first page anatomy this page follows; SSR-aware clock-step hardening this engine mirrors; owns the `tier4_escalation`-only half of the shared `crash.log` ledger contract (`count_recent_reboots`).
- [Adaptive Polling](adaptive-polling.md) — the always-every-cycle local-block invariant `alert_engine_check` (and `alert_engine_reboot_detect`) depends on.
- [SMS](sms.md) — `qsms` transport, `/dev/smd11` invariant, broker-owned lock, phone-number normalization (unchanged by this centralization).
- [Config Backup & Restore](config-backup-restore.md) — apply-order model, atomic-write pattern.
- [Error Code Vocabulary](error-codes.md) — `{error, detail}` envelope, device-`jq`-has-no-regex constraint.
- [`docs/BACKEND.md`](../BACKEND.md#busybox-ash-dot-sourcing-a-missing-file-kills-the-shell) — the general BusyBox dot-source-missing-file invariant that `record_planned_reboot`'s callers all guard against.
