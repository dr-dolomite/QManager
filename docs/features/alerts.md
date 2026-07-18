# Alerts

Alerts notifies you when the modem's internet connection drops and when it comes back, over SMS and/or email. It replaces two previously separate pages (SMS Alerts, Email Alerts) — each with its own downtime-detection state machine — with **one page, one CGI, and one poller-resident detection engine**. The mental model is a **trigger × channel routing matrix** (which event goes to which channel) layered on top of a **capability table** (which event/channel pairs are physically possible at all) — the two are deliberately separate concepts, and the backend is the sole authority for capability.

A third event, **`reboot`**, tracks every real device restart — detected via the kernel `boot_id`, classified into `watchdog`/`user`/`unplanned`, and delivered post-recovery once connectivity is back (see [Reboot Alerts](#reboot-alerts) below). It is **opt-in** (off on both channels by default); detection and the "Recent reboots" history record every boot regardless of routing.

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
| Routing config | `/etc/qmanager/alert_routing.json` (version 2, additive `reboot` event) |
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

Three events, two channels:

- **Events**: `connection_lost` (internet has been down ≥ the channel's threshold), `connection_restored` (it came back after a qualifying outage), `reboot` (the device restarted — see [Reboot Alerts](#reboot-alerts)).
- **Channels**: `sms`, `email`.

**Routing** is a *user preference* — "should this event go out over this channel" — persisted in `alert_routing.json` and edited from the routing matrix on the Alerts page.

**Capability** is a *physical fact* the backend owns: `alert_capable()` in `scripts/usr/lib/qmanager/alert_routing.sh` hard-codes that `connection_lost/email` is the only incapable pair — email needs the internet and DNS to send, both of which are down during the very outage it would be reporting. Every other pair is capable, including both `reboot` cells — a reboot alert is by definition delivered *after* connectivity is back, so email is never actually incapable for it.

```sh
alert_capable() {
    case "$1/$2" in
        connection_lost/sms)       return 0 ;;
        connection_lost/email)     return 1 ;;
        connection_restored/sms)   return 0 ;;
        connection_restored/email) return 0 ;;
        reboot/sms)                return 0 ;;
        reboot/email)              return 0 ;;
        *)                         return 1 ;;
    esac
}
```

The **effective send rule**, evaluated once per channel by the engine: `channel master-enabled AND routing-cell true AND capable`.

> ⚠️ WARNING: Capability is clamped **server-side in two places**, not just rendered client-side: `alert_routing_load()` forces `_ar_cl_email="false"` after reading the file (`alert_routing.sh:78`), and `save_settings` in the CGI hard-sets `r_cl_email="false"` before writing regardless of what the client posted (`alerts.sh:268`). `config_backup_sections.sh`'s `apply_alert_routing()` does the same on restore (`.events.connection_lost.email = false`, `config_backup_sections.sh:160`). A stale or hand-edited `alert_routing.json` claiming `connection_lost.email:true` can never actually route — all three read/write paths refuse it.

**Why split routing from capability:** the frontend never hard-codes which cells are toggleable. `alerts.sh` GET returns a `capabilities` object (`alert_capabilities_json()`, `alert_routing.sh:119-121`) with a stable `email_reason: "email_needs_internet"` key; `AlertRoutingGrid` (`components/monitoring/alerts/alert-routing-grid.tsx`) renders a disabled "Unavailable" chip with an info tooltip for any cell where `capabilities[event][channel]` is `false`, and a live `Switch` otherwise. If a future event/channel pair becomes capable, the UI updates itself — no frontend redeploy needed, only a backend `alert_capable()` change.

### Default routing = legacy behavior (zero-regression upgrade)

```json
{"version":2,"events":{"connection_lost":{"sms":true,"email":false},"connection_restored":{"sms":true,"email":true},"reboot":{"sms":false,"email":false}}}
```

This is exactly what the two old pages did before centralization (SMS fired on both events, email only fired on recovery). An upgrade with no `alert_routing.json` present fails closed to these defaults (`alert_routing_load()` resets to them before reading the file), and the installer idempotently seeds the same document (via `alert_default_routing_json()`), so existing SMS/email settings and behavior carry over unchanged.

> ℹ️ NOTE: The document is now **version 2** — the additive `reboot` key. No migration step exists or is needed: `alert_routing_load()` reads `.events.reboot.sms`/`.email` with the null-safe `if . == null then "false" else tostring end` form, so a v1 file on disk (no `reboot` key at all) silently fail-closes both `reboot` cells to `false`. That fail-closed default is exactly the desired opt-in behavior, so an existing v1 file never needs to be rewritten just to pick up the new event.

## The Engine: Poller-Sourced, Not a Daemon

`alert_engine.sh` is a **library sourced into `qmanager_poller`**, not a standalone process. It replaces the two duplicated per-channel state machines that used to live in `sms_alerts.sh::check_sms_alert` and `email_alerts.sh::check_email_alert` with one downtime state machine (`_ae_outage_active`, `_ae_outage_start_mono`, per-channel `armed`/`lost_sent` flags — all poller-process memory, not persisted to disk).

`alert_engine_check` is called from the poller's **always-every-cycle local block**, before any AT command:

```
qmanager_poller poll_cycle():
  update_proc_metrics
  read_ping_data        # sets conn_internet_available / conn_during_recovery
  alert_engine_check     # <-- here, every 2s base cycle, every tier
```

**Why here:** this is the same "no modem access, runs regardless of adaptive-polling tier" block that keeps watchdog connectivity data fresh (see [Adaptive Polling](adaptive-polling.md) Invariant 1 — `write_cache`/`read_ping_data` always run). Alert detection reads ICMP reachability that `read_ping_data` just wrote and needs to keep running at the base 2s cadence even when AT reads back off into the Idle/Deep tier — an outage doesn't pause just because the modem is quiet.

**Library sourcing order** (`qmanager_poller:302-335`) matters — `alert_engine.sh` is sourced last because it reads globals/functions owned by everything before it:

```
qlog.sh (mono_now, qlog_*) → events.sh → email_alerts.sh → sms_alerts.sh
  → alert_routing.sh → alert_engine.sh
```

`alert_engine_init` runs once at poller startup (`main()`, after `email_alerts_init`/`sms_alerts_init` so the engine's threshold reads see already-loaded channel config) and resets state to idle.

### Clock-step hardening (`mono_now`)

The downtime timer measures elapsed time with `mono_now()` (`/proc/uptime`'s monotonic integer seconds), **not** wall-clock epoch. `_ae_outage_start_mono` is stamped at the leading edge of an outage and every subsequent elapsed calculation is `mono_now() - _ae_outage_start_mono`.

**Why:** an SSR (baseband subsystem restart) can trigger a NITZ time step that jumps the wall clock mid-outage. A wall-clock timer would see a multi-hour "jump" and either fire immediately or never fire depending on jump direction. This mirrors the exact hardening already validated for the watchdog's staleness detection (see [Connection Watchdog](connection-watchdog.md) `ssr_aware`/SSR-hold section) — `/proc/uptime` is unaffected by NTP/NITZ steps.

### Suppression (both channels, one place)

`alert_engine_check` bails before touching outage state when either guard trips:

- `/tmp/qmanager_low_power_active` present → low-power mode, no radio-adjacent work.
- `conn_during_recovery = "true"` → watchdog is mid-recovery (AT+COPS/AT+CFUN cycling); `lte_state`/`nr_state` are transiently stale. Outage state is untouched — the mono timer keeps its start — so a qualifying `connection_restored` still fires on the first cycle after recovery finishes.

> ℹ️ NOTE: This fixes a latent bug. The old `check_email_alert` state machine did **not** check `conn_during_recovery` — only `check_sms_alert` did. Email could fire a "recovered" message during watchdog recovery churn (a false-positive recovery signal) that SMS correctly suppressed. Both channels now share the same suppression gate.

### `sms_alert_emit` / `email_alert_emit` — the rc contract

The engine dispatches to the channel libs via `sms_alert_emit <event> <secs>` / `email_alert_emit <event> <secs>` (`_ae_channel_emit`, `alert_engine.sh:103-109`). Both return one of three codes the engine interprets identically:

| rc | Meaning | Engine behavior |
|---|---|---|
| `0` | Sent | Marks `lost_sent=1` for the channel; won't re-attempt this outage |
| `1` | Attempted, failed (terminal — e.g. `sms_tool` send error, msmtp failure after 3 retries) | Marks `lost_sent=1`; won't re-attempt this outage |
| `2` | Not ready, retry later (SMS: modem not yet registered) | Leaves `lost_sent` clear; retried next cycle without burning an attempt |

`email_alert_emit` never returns `2` — it has no registration concept — and treats `connection_lost` as a deliberate no-op success (`return 0`) rather than attempting a send it knows is incapable, since the engine still calls `_ae_channel_emit` for the *arming* check even on incapable pairs (arming determines whether a later `connection_restored` fires; sending does not).

**Arming vs. sending are independent.** In `_ae_handle_down` (`alert_engine.sh:183-206`), a channel is armed (`_ae_set_armed`) purely from crossing its own threshold — capability is not checked for arming. Only the actual `connection_lost` send attempt is gated by `alert_route_enabled` (routing AND capability). This is why email arms during an outage (warranting a `connection_restored` email later) even though it never sends a `connection_lost` email.

## Reboot Alerts

Unlike `connection_lost`/`connection_restored`, a reboot has no outage window and no downtime timer — it is a **separate one-shot detect-then-deliver path** inside `alert_engine.sh`, called from `alert_engine_check` (`_ae_reboot_check`, step 4, after the suppression/ping-null guards so it inherits low-power + recovery-churn suppression, before the outage machine runs).

### Detection: `boot_id`, not uptime or a shutdown hook

The device exposes no clean-shutdown signal — a reboot can be a button press, a panic, or a power cut, and QManager cannot instrument any of them from userspace. Instead, detection happens **once per poller start**, in `alert_engine_reboot_detect()` (called from `qmanager_poller`'s `main()`, right after `alert_engine_init`):

1. Read `/proc/sys/kernel/random/boot_id` — a per-boot kernel UUID, regenerated on every real reboot, stable for the lifetime of a boot.
2. Compare it against the value persisted in `/etc/qmanager/last_boot_id` (ubifs, survives the reboot being detected).
3. **Unchanged** → this poller start is a bare procd respawn (crash, manual restart), not a reboot. No alert is staged, and any already-staged pending alert is left untouched.
4. **Changed** → a real reboot happened. Classify the cause, stage a pending alert, and immediately overwrite `last_boot_id` with the new value (so a mid-boot procd respawn of the *new* boot can't re-detect the same reboot a second time).
5. **No stored value** (fresh install / first boot ever) → record the id and stage nothing. There is no "before" to compare against.

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

> ⚠️ WARNING: **`crash.log` now has two classes of consumer with different scopes, and conflating them breaks either the watchdog token bucket or the reboot-alert rate.** `qmanager_watchcat`'s `count_recent_reboots()` (which feeds the tier-4 escalation token bucket and the dashboard's `reboots_this_hour`) was tightened to `awk ... $3 == "tier4_escalation"` — it counts **only** watchdog rows, exactly as before this feature landed. `alert_engine.sh`'s `_ae_reboot_count_last_hour()` (the storm coalescer, below) counts **every** row regardless of reason — it's the true all-cause boot rate. Do not merge these two counters or change one without checking the other; see [Connection Watchdog](connection-watchdog.md) for the watchdog-side half of this contract.

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

### Frontend: Recent Reboots card

The Alerts page's left column now stacks **Status → Recent Reboots → Activity Log** (`RebootHistoryCard`, `components/monitoring/alerts/reboot-history-card.tsx`), reading `state.reboots` from the same `useAlerts()` GET — no separate poll loop. It is read-only device telemetry, not tied to routing: every recorded reboot shows regardless of whether the `reboot` alert is actually routed to any channel, because the history's value is independent of whether you chose to be notified. Each row shows a cause badge (`REBOOT_CAUSE_META` in `components/monitoring/alerts/constants.tsx` — `watchdog`→info/`ShieldCheckIcon`, `user`→muted/`PowerIcon`, `unplanned`→warning/`TriangleAlertIcon`, always icon+text+color per the accessibility rule) plus a localized relative time (`Intl.RelativeTimeFormat`) and an absolute tooltip-free timestamp. A matching `RebootHistorySkeleton` covers the loading state.

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
      "reboot":              { "sms": false, "email": false }
    }
  },
  "capabilities": {
    "connection_lost":     { "sms": true, "email": false, "email_reason": "email_needs_internet" },
    "connection_restored": { "sms": true, "email": true },
    "reboot":              { "sms": true, "email": true }
  },
  "reboots": [
    { "epoch": 1737158400, "cause": "watchdog" },
    { "epoch": 1737100000, "cause": "user" },
    { "epoch": 1737000000, "cause": "unplanned" }
  ]
}
```

`email.app_password_set` is a boolean — the cleartext password is **never** returned by GET.

`reboots` is read straight from the shared `/etc/qmanager/crash.log` ledger (all reason tags, not just this feature's own rows), newest-first, capped at 10. It powers the Recent Reboots card and is independent of `routing.events.reboot` — a reboot is always recorded here even when the alert itself is routed to neither channel.

**POST actions** (dispatched on `.action`):

| Action | Body | Notes |
|---|---|---|
| `save_settings` | `{sms:{...}, email:{...}, routing:{events:{...}}}` | Writes all 3 config files atomically (temp-file + validate + `mv`); clamps `connection_lost.email` to `false` server-side regardless of the posted value; a missing/null `routing.events.reboot.*` defaults to `false` (opt-in), unlike the other events which default `true`/preserve; no server-side clamp on `reboot` (both channels stay capable); touches all 3 reload flags |
| `send_test` | `{channel: "sms"\|"email"}` | Sends a real test message over the real send path; requires the channel be `enabled` (not just filled in) |
| `install` | — | Installs `msmtp` via `opkg` in the background; progress file at `/tmp/qmanager_msmtp_install.json` |
| `install_status` | — | Polls install progress |
| `uninstall` | — | Removes `msmtp`; refused with `still_enabled` while email alerts are still enabled |
| `get_log` | — | Merges both NDJSON logs, tags each entry `channel:"sms"\|"email"`, sorts by timestamp, returns newest-first, capped at 100 |

**On-disk shapes are unchanged for backward compat** — `sms_alerts.json`/`email_alerts.json` keep exactly the same fields they had before centralization. This matters because `config_backup_sections.sh`'s `apply_sms_alerts()` has a strict `jq -e 'has("enabled") and has("recipient_phone") and has("threshold_minutes")'` gate; that gate is unchanged and still passes against `save_settings`'s output.

### Validation gotchas

- **No regex in jq on this device** (see [Error Code Vocabulary](error-codes.md) and the device-jq note in project memory) — `_validate_phone`/`_validate_email` in `alerts.sh` do shape-checking in POSIX shell/`grep -E`, not `jq test()`.
- **Never `//` on a routing boolean.** A routing cell that is legitimately `false` (e.g. `connection_lost.email`) must survive a round-trip. Every boolean read in `alert_routing.sh` and `alerts.sh` uses the null-safe `if . == null then <default> else tostring end` form, never `.foo // default` — `//` treats JSON `false` as falsy and silently coerces it to the default, which would have flipped `connection_lost.email` back to a truthy default and defeated the capability clamp.
- **Phone `+`-strip is preserved exactly**: a single leading `+` is stripped once before writing `sms_alerts.json` (`sed 's/^+//'`); GET/storage always return raw digits; the send path passes the stored value verbatim to `sms_tool`. Same behavior as before centralization — see [SMS](sms.md#phone-number-handling).
- **Password preservation**: `save_settings` re-reads the currently-stored `app_password` from `email_alerts.json` when the client posts an empty one, so re-saving other email fields (or SMS/routing only) never blanks the stored password.

## Config Backup / Restore

`alert_routing` is a new, additive section in `config_backup_sections.sh` (`CFG_BACKUP_APPLY_ORDER`), inserted immediately after `sms_alerts` — both alert-config sections restore together, ahead of the riskier AT/IMEI work. `collect_alert_routing()` emits the canonical default document (now version 2, with `reboot`) when `alert_routing.json` is absent (deterministic restores). `apply_alert_routing()` validates `.events` is present, then **re-clamps `connection_lost.email = false`** on the incoming document before writing — restoring a backup taken on a hypothetical future version that allowed the pair can never re-enable it on this version. **`reboot` gets no clamp** and passes through untouched (both channels are legitimately capable); a v1 backup with no `reboot` key restores fine — `alert_routing_load` fail-closes the missing cells to `false` on the next read, which is the correct opt-in default anyway. See [Config Backup & Restore](config-backup-restore.md) for the general apply-order/lock model.

## Install / Uninstall Lifecycle

- **Install**: the two new libs (`alert_engine.sh`, `alert_routing.sh`) and the new CGI (`monitoring/alerts.sh`) ship via the normal directory-driven copy; the four retired CGIs are actively deleted from the device on upgrade (not just omitted from the new tree). `alert_routing.json` is seeded idempotently — only if absent — by sourcing `alert_routing.sh` in a subshell and capturing `alert_default_routing_json()`, so the installer's own shell namespace never inherits the lib's globals. `install.sh`'s `reboot_system()` best-effort sources `qlog.sh` (present at this point — it was just deployed by the same install run) and drops a `user` breadcrumb before the post-install reboot.
- **Uninstall**: `alert_routing.json` is grouped with `sms_alerts.json`/`email_alerts.json` as user config — it is **not** unconditionally deleted. It follows the same `--keep-config`/`--purge`/ask-prompt treatment as every other file under `/etc/qmanager/`, swept up only by the wholesale `rm -rf "$CONF_DIR"` when the user chooses purge. `msmtprc` and the runtime logs/reload flags are removed unconditionally (regenerable / ephemeral state), matching prior behavior. `crash.log` (the shared reboot ledger) is **not** touched by uninstall either way — it lives outside `CONF_DIR`'s alert-specific keys and simply stops growing once no poller is left to write to it. `uninstall.sh`'s `reboot_system()` also best-effort sources `qlog.sh`, but by this point in the uninstall flow the library has normally already been removed — this is the path that made the `[ -f ] && .` guard load-bearing rather than defensive (see [Reboot Alerts](#reboot-alerts) above).

## Frontend

`/monitoring/alerts` follows the status-first anatomy (see [Connection Watchdog](connection-watchdog.md) for the pattern this was modeled on): a 2-column desktop grid (`@4xl/main:grid-cols-2`) — left column stacks **Channel Readiness** (`alerts-status-card.tsx`) → **Recent Reboots** (`reboot-history-card.tsx`) → the merged **Activity Log** (`alerts-log-card.tsx`); right column is the full-height **Settings** card (`alerts-settings-card.tsx`) with 3 tabs (Routing · SMS · Email) sharing one sticky save bar via `use-alerts-form.ts`. The routing tab's matrix (`AlertRoutingGrid`) now renders a third row for `reboot`, live `Switch`es on both channels since both are always capable.

One `useAlerts()` instance owns fetch/save/test/install-lifecycle state; `AlertsBody` is keyed on a `settingsSignature(state)` string so the whole form subtree remounts (resetting local edit state) after every successful save, rather than trying to reconcile server state into a live-edited form.

`AlertRoutingGrid` (events as rows, channels as columns) never renders a disabled/dead toggle for an incapable cell — per the accessibility rule (color must be paired with icon + text), an incapable cell renders a `MinusCircleIcon` + "Unavailable" text + an `InfoTip` explaining why, sourced from `capabilities[event].email_reason`/`sms_reason`.

> ✅ i18n parity (2026-07-18): all four non-EN locales (`it`, `id`, `zh-CN`, `zh-TW`) now carry the full 114-key `alerts.*` block in `public/locales/<lang>/monitoring.json`, and the dead `email_alerts`/`sms_alerts` blocks were removed from both `monitoring.json` and `sidebar.json` (the two old sidebar items collapsed into a single `items.alerts`). `bun run lib/i18n/check.ts` is clean (0 errors, 0 warnings). Per project convention `zh-TW` was derived from the freshly-translated `zh-CN` (Taiwan term variants: 簡訊/郵件/信箱/應用程式密碼/管道), not machine-translated from EN. Phone-example placeholders are localized per country (id `+62`, it `+39`, zh-CN `+86`, zh-TW `+886`); the `<link>` tag in `email_app_password_description` and all `{{placeholders}}` are preserved, and `log_showing_count_one/_other` follow each language's plural rule (identical for id/zh, inflected for it).
>
> ⚠️ Reboot-alert i18n exception: the reboot keys added in this feature (`event_reboot_*`, `reboot_history_*`, `reboot_cause_*`) are **EN-only** — the 2026-07-18 parity sweep predated them, so the four non-EN locales fall back to EN for just those keys (functional via `fallbackLng: "en"`). Backfilling them is the one remaining follow-up; per convention derive `zh-TW` from `zh-CN` via OpenCC rather than machine-translating from EN.

## Cross-References

- [Connection Watchdog](connection-watchdog.md) — status-first page anatomy this page follows; SSR-aware clock-step hardening this engine mirrors; owns the `tier4_escalation`-only half of the shared `crash.log` ledger contract (`count_recent_reboots`).
- [Adaptive Polling](adaptive-polling.md) — the always-every-cycle local-block invariant `alert_engine_check` (and `alert_engine_reboot_detect`) depends on.
- [SMS](sms.md) — `sms_tool` transport, `/dev/smd11` invariant, shared `flock`, phone-number normalization (unchanged by this centralization).
- [Config Backup & Restore](config-backup-restore.md) — apply-order model, atomic-write pattern.
- [Error Code Vocabulary](error-codes.md) — `{error, detail}` envelope, device-`jq`-has-no-regex constraint.
- [`docs/BACKEND.md`](../BACKEND.md#busybox-ash-dot-sourcing-a-missing-file-kills-the-shell) — the general BusyBox dot-source-missing-file invariant that `record_planned_reboot`'s callers all guard against.
