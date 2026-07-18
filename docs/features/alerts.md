# Alerts

Alerts notifies you when the modem's internet connection drops and when it comes back, over SMS and/or email. It replaces two previously separate pages (SMS Alerts, Email Alerts) — each with its own downtime-detection state machine — with **one page, one CGI, and one poller-resident detection engine**. The mental model is a **trigger × channel routing matrix** (which event goes to which channel) layered on top of a **capability table** (which event/channel pairs are physically possible at all) — the two are deliberately separate concepts, and the backend is the sole authority for capability.

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
| Routing config | `/etc/qmanager/alert_routing.json` (new, additive) |
| SMS log | `/tmp/qmanager_sms_log.json` (NDJSON, cap 100) |
| Email log | `/tmp/qmanager_email_log.json` (NDJSON, cap 100) |
| Reload flags | `/tmp/qmanager_sms_reload`, `/tmp/qmanager_email_reload`, `/tmp/qmanager_alert_routing_reload` |
| msmtp config (generated) | `/etc/qmanager/msmtprc` |
| Frontend route | `/monitoring/alerts` → `components/monitoring/alerts/alerts.tsx` |
| Hooks | `hooks/use-alerts.ts` (settings), `hooks/use-alerts-log.ts` (merged log) |
| Types | `types/alerts.ts` |
| Reboot | Never |

## The Model: Routing vs. Capability

Two events, two channels:

- **Events**: `connection_lost` (internet has been down ≥ the channel's threshold), `connection_restored` (it came back after a qualifying outage).
- **Channels**: `sms`, `email`.

**Routing** is a *user preference* — "should this event go out over this channel" — persisted in `alert_routing.json` and edited from the routing matrix on the Alerts page.

**Capability** is a *physical fact* the backend owns: `alert_capable()` in `scripts/usr/lib/qmanager/alert_routing.sh:88-96` hard-codes that `connection_lost/email` is the only incapable pair — email needs the internet and DNS to send, both of which are down during the very outage it would be reporting. Every other pair is capable.

```sh
alert_capable() {
    case "$1/$2" in
        connection_lost/sms)       return 0 ;;
        connection_lost/email)     return 1 ;;
        connection_restored/sms)   return 0 ;;
        connection_restored/email) return 0 ;;
        *)                         return 1 ;;
    esac
}
```

The **effective send rule**, evaluated once per channel by the engine: `channel master-enabled AND routing-cell true AND capable`.

> ⚠️ WARNING: Capability is clamped **server-side in two places**, not just rendered client-side: `alert_routing_load()` forces `_ar_cl_email="false"` after reading the file (`alert_routing.sh:78`), and `save_settings` in the CGI hard-sets `r_cl_email="false"` before writing regardless of what the client posted (`alerts.sh:268`). `config_backup_sections.sh`'s `apply_alert_routing()` does the same on restore (`.events.connection_lost.email = false`, `config_backup_sections.sh:160`). A stale or hand-edited `alert_routing.json` claiming `connection_lost.email:true` can never actually route — all three read/write paths refuse it.

**Why split routing from capability:** the frontend never hard-codes which cells are toggleable. `alerts.sh` GET returns a `capabilities` object (`alert_capabilities_json()`, `alert_routing.sh:119-121`) with a stable `email_reason: "email_needs_internet"` key; `AlertRoutingGrid` (`components/monitoring/alerts/alert-routing-grid.tsx`) renders a disabled "Unavailable" chip with an info tooltip for any cell where `capabilities[event][channel]` is `false`, and a live `Switch` otherwise. If a future event/channel pair becomes capable, the UI updates itself — no frontend redeploy needed, only a backend `alert_capable()` change.

### Default routing = legacy behavior (zero-regression upgrade)

```json
{"version":1,"events":{"connection_lost":{"sms":true,"email":false},"connection_restored":{"sms":true,"email":true}}}
```

This is exactly what the two old pages did before centralization (SMS fired on both events, email only fired on recovery). An upgrade with no `alert_routing.json` present fails closed to these defaults (`alert_routing_load()` resets to them before reading the file), and the installer idempotently seeds the same document (`install.sh:1163-1181`, via `alert_default_routing_json()`), so existing SMS/email settings and behavior carry over unchanged.

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
      "connection_restored": { "sms": true, "email": true }
    }
  },
  "capabilities": {
    "connection_lost":     { "sms": true, "email": false, "email_reason": "email_needs_internet" },
    "connection_restored": { "sms": true, "email": true }
  }
}
```

`email.app_password_set` is a boolean — the cleartext password is **never** returned by GET.

**POST actions** (dispatched on `.action`):

| Action | Body | Notes |
|---|---|---|
| `save_settings` | `{sms:{...}, email:{...}, routing:{events:{...}}}` | Writes all 3 config files atomically (temp-file + validate + `mv`); clamps `connection_lost.email` to `false` server-side regardless of the posted value; touches all 3 reload flags |
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

`alert_routing` is a new, additive section in `config_backup_sections.sh` (`CFG_BACKUP_APPLY_ORDER`), inserted immediately after `sms_alerts` — both alert-config sections restore together, ahead of the riskier AT/IMEI work. `collect_alert_routing()` emits the canonical default document when `alert_routing.json` is absent (deterministic restores). `apply_alert_routing()` validates `.events` is present, then **re-clamps `connection_lost.email = false`** on the incoming document before writing — restoring a backup taken on a hypothetical future version that allowed the pair can never re-enable it on this version. See [Config Backup & Restore](config-backup-restore.md) for the general apply-order/lock model.

## Install / Uninstall Lifecycle

- **Install**: the two new libs (`alert_engine.sh`, `alert_routing.sh`) and the new CGI (`monitoring/alerts.sh`) ship via the normal directory-driven copy; the four retired CGIs are actively deleted from the device on upgrade (not just omitted from the new tree). `alert_routing.json` is seeded idempotently — only if absent — by sourcing `alert_routing.sh` in a subshell and capturing `alert_default_routing_json()`, so the installer's own shell namespace never inherits the lib's globals.
- **Uninstall**: `alert_routing.json` is grouped with `sms_alerts.json`/`email_alerts.json` as user config — it is **not** unconditionally deleted. It follows the same `--keep-config`/`--purge`/ask-prompt treatment as every other file under `/etc/qmanager/`, swept up only by the wholesale `rm -rf "$CONF_DIR"` when the user chooses purge. `msmtprc` and the runtime logs/reload flags are removed unconditionally (regenerable / ephemeral state), matching prior behavior.

## Frontend

`/monitoring/alerts` follows the status-first anatomy (see [Connection Watchdog](connection-watchdog.md) for the pattern this was modeled on): a 2-column desktop grid (`@4xl/main:grid-cols-2`) — left column is **Channel Readiness** (`alerts-status-card.tsx`) stacked over a merged **Activity Log** (`alerts-log-card.tsx`); right column is the full-height **Settings** card (`alerts-settings-card.tsx`) with 3 tabs (Routing · SMS · Email) sharing one sticky save bar via `use-alerts-form.ts`.

One `useAlerts()` instance owns fetch/save/test/install-lifecycle state; `AlertsBody` is keyed on a `settingsSignature(state)` string so the whole form subtree remounts (resetting local edit state) after every successful save, rather than trying to reconcile server state into a live-edited form.

`AlertRoutingGrid` (events as rows, channels as columns) never renders a disabled/dead toggle for an incapable cell — per the accessibility rule (color must be paired with icon + text), an incapable cell renders a `MinusCircleIcon` + "Unavailable" text + an `InfoTip` explaining why, sourced from `capabilities[event].email_reason`/`sms_reason`.

> ✅ i18n parity (2026-07-18): all four non-EN locales (`it`, `id`, `zh-CN`, `zh-TW`) now carry the full 114-key `alerts.*` block in `public/locales/<lang>/monitoring.json`, and the dead `email_alerts`/`sms_alerts` blocks were removed from both `monitoring.json` and `sidebar.json` (the two old sidebar items collapsed into a single `items.alerts`). `bun run lib/i18n/check.ts` is clean (0 errors, 0 warnings). Per project convention `zh-TW` was derived from the freshly-translated `zh-CN` (Taiwan term variants: 簡訊/郵件/信箱/應用程式密碼/管道), not machine-translated from EN. Phone-example placeholders are localized per country (id `+62`, it `+39`, zh-CN `+86`, zh-TW `+886`); the `<link>` tag in `email_app_password_description` and all `{{placeholders}}` are preserved, and `log_showing_count_one/_other` follow each language's plural rule (identical for id/zh, inflected for it).

## Cross-References

- [Connection Watchdog](connection-watchdog.md) — status-first page anatomy this page follows; SSR-aware clock-step hardening this engine mirrors.
- [Adaptive Polling](adaptive-polling.md) — the always-every-cycle local-block invariant `alert_engine_check` depends on.
- [SMS](sms.md) — `sms_tool` transport, `/dev/smd11` invariant, shared `flock`, phone-number normalization (unchanged by this centralization).
- [Config Backup & Restore](config-backup-restore.md) — apply-order model, atomic-write pattern.
- [Error Code Vocabulary](error-codes.md) — `{error, detail}` envelope, device-`jq`-has-no-regex constraint.
