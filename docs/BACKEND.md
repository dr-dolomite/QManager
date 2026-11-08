# QManager Backend Guide

This document covers the OpenWRT shell script backend: CGI endpoints, daemons, init.d services, shared libraries, and development conventions.

---

## Overview

The backend runs on OpenWRT as POSIX shell scripts executed by BusyBox `/bin/sh`. It consists of:

- **CGI endpoints** — HTTP API handlers executed by uhttpd
- **Daemons** — Long-running background processes
- **Init.d services** — Process lifecycle management
- **Shared libraries** — Reusable shell functions

All scripts live in `scripts/` and mirror the device filesystem:

```
scripts/
├── etc/init.d/                    → /etc/init.d/
├── usr/bin/                       → /usr/bin/
├── usr/lib/qmanager/              → /usr/lib/qmanager/
└── www/cgi-bin/quecmanager/       → /www/cgi-bin/quecmanager/
```

---

## Critical Constraints

### POSIX Shell Only

All scripts must be compatible with BusyBox `/bin/sh`. No bashisms allowed:

```sh
# WRONG (bash arrays, [[ ]], process substitution)
arr=(a b c)
[[ $var == "test" ]]
while read line < <(cmd); do ...

# CORRECT (POSIX)
var="a b c"
[ "$var" = "test" ]
cmd | while read line; do ...
```

### Line Endings

**All shell scripts MUST have LF line endings** (not CRLF). CRLF causes silent failures on OpenWRT — scripts produce no output and the CGI returns empty responses.

The `.gitattributes` file enforces LF for `scripts/**/*.sh`, `scripts/etc/init.d/*`, and `scripts/usr/bin/*`.

### AT Commands

All modem communication goes through `qcmd`:

```sh
result=$(qcmd 'AT+QENG="servingcell"')
```

Never access the modem's AT channel directly. `qcmd` is served by the Rust AT broker (`qmanager_atd`), the only AT path; its output contract is the one the original shell `qcmd` had. See [`docs/features/at-broker.md`](features/at-broker.md).

### Temperature: sysfs only — never AT+QTEMP

> ⚠️ WARNING: Do not reintroduce `AT+QTEMP` on RM551E-GL (SDX75) firmware. Issuing it on `/dev/smd11` can crash the AT channel, making the modem unreachable until the channel recovers or the device reboots.

Temperature is read exclusively from the SoC thermal sysfs (`/sys/class/thermal/thermal_zone*/`) and runs at **Tier 1.5 (10 s)**. The parser (`parse_temperature()` in `scripts/usr/lib/qmanager/parse_at.sh`) selects zones by **type-name allowlist** (`mdmss-*|mdmq6-*|sdr[0-9]*|xo-therm*|sys-therm-*|cpuss-*`), not by zone index — indices renumber across firmware builds, type names are stable. The allowlist spans the modem die (`mdmss`, `mdmq6`), the RF transceiver (`sdr`), the board/system thermistors (`sys-therm`, `xo-therm`), and the application-processor cores (`cpuss`), so the single averaged value reflects overall device temperature. Unavailable-sensor sentinels (`-273000`, `-40960`) and empty values are excluded (non-positive values are dropped) before averaging. The current `parse_temperature()` is builtins-only (no awk/cat). It falls back to `_parse_temperature_legacy()` (awk-based) only for unusual sysfs values. The result is millidegrees-to-degrees, rounded as `printf "%.0f", sum/1000/count`.

The poller global for this value is `t1_temperature` (renamed from `t2_temperature` when the read moved from Tier 2 to Tier 1.5). The `.temperature` key in `/tmp/qmanager_status.json` and `device.temperature` in the API response are unchanged.

> ℹ️ NOTE: `tools/debug_poller_at.sh` (dev-only, not packaged) lines 54–55 still reference `AT+QTEMP` as a Tier 3 probe. That file is a development diagnostic, not production code, and its cleanup is tracked separately — do not treat it as evidence that AT+QTEMP is safe to call.

### No `setsid`

BusyBox doesn't have `setsid`. Use the double-fork pattern for background daemons:

```sh
( "$DAEMON" </dev/null >/dev/null 2>&1 & )
```

### BusyBox `ash`: dot-sourcing a missing file kills the shell

In BusyBox `ash`, `. /path/to/file.sh 2>/dev/null || { stub; }` does **not** execute the `||` clause when the file is absent — it exits the entire shell with rc=2. The `2>/dev/null` silences the error but cannot prevent the shell from dying.

This is true **regardless of how the `.` is wrapped** — the failure is not specific to the `||` idiom. It also aborts the shell when the `.` is used as the condition of an `if`:

```sh
# ALSO WRONG — a `.` on a missing file aborts the shell before `if` can even
# evaluate the exit status. This is not a "did the guard work" bug — the
# process is already gone.
if . /usr/lib/qmanager/ondemand_radio.sh 2>/dev/null; then
    :
else
    stub
fi
```

Safe pattern: guard with an existence check **before** the `.` is ever reached, so the interpreter never attempts to open a nonexistent file.

```sh
# WRONG — the || clause never fires if the file is absent
. /usr/lib/qmanager/ondemand_radio.sh 2>/dev/null || true

# CORRECT
if [ -f /usr/lib/qmanager/ondemand_radio.sh ]; then
    . /usr/lib/qmanager/ondemand_radio.sh
fi

# Also correct, more compact — safe because `&&` short-circuits BEFORE `.`
# ever runs, so the file is never opened when [ -f ] fails.
[ -f /usr/lib/qmanager/qlog.sh ] && . /usr/lib/qmanager/qlog.sh
```

**Why:** POSIX says a shell may exit when a sourced file cannot be found; BusyBox `ash` does. `bash` and `dash` do not. This difference is invisible in development but fatal on the device.

**Practical consequence:** if a library is absent (e.g. introduced in a new release but not yet on the device because the installer was not re-run), any script that dot-sources it without an existence guard will silently die mid-execution. The only symptom is an abrupt empty response from the CGI or a silent poller crash. See the installer section below for the co-deployment requirement.

> ⚠️ WARNING: **This is not a hypothetical.** It bit the reboot-alert feature's `uninstall.sh` → `reboot_system()` path: `uninstall.sh` best-effort sources `qlog.sh` to call `record_planned_reboot` before its final reboot, but by the time that function runs, uninstall has normally **already deleted** `/usr/lib/qmanager` — so `qlog.sh` is expected to be missing on this path, not just possibly missing. Every `record_planned_reboot` caller (`cgi_base.sh`, `qmanager_poller`, `qmanager_scheduled_reboot`, `qmanager_imei_check`, `install.sh`, `uninstall.sh`) uses the `[ -f ] && .` / `if [ -f ]; then … else <stubs>; fi` guard for exactly this reason — see [`docs/features/alerts.md`](features/alerts.md#reboot-alerts) for the full call-site list.

### jq `//` Gotcha

**Never use `jq "$filter // empty"` when the value can be `false`**. jq's `//` (alternative operator) treats both `false` and `null` as empty:

```sh
# WRONG — false // "null" returns "null"
jq '(.reachable // "null")'

# CORRECT
jq '(.reachable | if . == null then empty else tostring end)'
```

---

## Shared Libraries

All libraries live in `/usr/lib/qmanager/` and are sourced with include guards.

### cgi_base.sh

CGI boilerplate — source this at the top of every CGI script:

```sh
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
qlog_init "cgi_myfeature"
cgi_headers
```

**Provides:**

| Function | Description |
|----------|-------------|
| `cgi_headers` | Emit JSON + CORS + no-cache headers |
| `cgi_ui_heartbeat` | Touch the UI-active heartbeat (`/tmp/qmanager_ui_active`) that drives the poller's adaptive tier |
| `cgi_handle_options` | Handle CORS preflight (OPTIONS) requests |
| `cgi_read_post` | Read POST body into `$POST_DATA` |
| `cgi_success` | Emit `{"success":true}` |
| `cgi_error <code> <detail>` | Emit `{"success":false,"error":"...","detail":"..."}` |
| `cgi_method_not_allowed` | Emit 405 JSON response |
| `cgi_reboot_response [reason]` | Emit success JSON, drop a `record_planned_reboot` breadcrumb (default reason `"user"`), then async reboot |
| `serve_ndjson_as_array <file>` | Convert NDJSON file to JSON array |

**Auto-enforces authentication** unless the script sets `_SKIP_AUTH=1` before sourcing.

### cgi_auth.sh

Session and password management:

| Function | Description |
|----------|-------------|
| `require_auth` | Validate session cookie, return 401 if invalid |
| `is_setup_required` | Check if password has been set |
| `qm_verify_password <pw>` | Check password against stored hash |
| `qm_save_password <pw>` | Hash and store password |
| `qm_create_session` | Create session file + set cookies |
| `qm_validate_session` | Check if session token is valid |
| `qm_destroy_session` | Remove session file + clear cookies |
| `qm_check_rate_limit` | Login gate: apply the progressive lockout ladder (mutating) |
| `qm_get_rate_limit_status` | Read-only lockout status; the only call `auth/check.sh` may make |
| `qm_record_failed_attempt` | Record a failed login and escalate the ladder |
| `qm_clear_attempts` | Clear rate limit after successful login |

The lockout ladder (30/120/300/900s, state in `/tmp/qmanager_auth_attempts.json`) is documented in [`reference/auth-rate-limiting.md`](reference/auth-rate-limiting.md).

### qlog.sh

Centralized logging library:

```sh
. /usr/lib/qmanager/qlog.sh
qlog_init "component_name"

qlog_debug "Detailed debug info"
qlog_info  "Normal operation info"
qlog_warn  "Something unexpected"
qlog_error "Something failed"
```

**Features:**
- Log levels: DEBUG, INFO, WARN, ERROR (configurable via `QLOG_LEVEL`)
- File logging to `/tmp/qmanager.log` (configurable via `QLOG_FILE`)
- Auto-rotation at 256KB (configurable), keeps 2 rotated files
- Optional syslog output (`QLOG_TO_SYSLOG=1`, default)
- Optional stdout output (`QLOG_TO_STDOUT=0`, default)
- Format: `[TIMESTAMP] LEVEL [COMPONENT:PID] Message`

**Utility functions:**
- `qlog_at_cmd <cmd> <response> [exit_code]` — Log AT command + response at DEBUG
- `qlog_lock <event> [detail]` — Log flock events
- `qlog_state_change <field> <old> <new>` — Log state transitions
- `record_planned_reboot <reason>` — Appends `<epoch>|reboot|<reason>` to the shared, persistent reboot ledger `/etc/qmanager/crash.log` (flock on `/tmp/qmanager_crashlog.lock`, trims to 20 lines). `reason` is sanitized to `[a-z_]` only. Called synchronously, before the actual reboot, by every intentional-reboot path (`cgi_reboot_response`, `qmanager_scheduled_reboot`, IPPT apply, IMEI-check restore, install/uninstall) so `alert_engine.sh`'s reboot-alert detector can classify the next boot as planned rather than unplanned. Also reused post-boot to record an inferred `unplanned` breadcrumb. See [`docs/features/alerts.md`](features/alerts.md#reboot-alerts).

### parse_at.sh

AT command response parsers. Extracts structured data from raw AT responses for the poller.

### events.sh

Network event detection (sourced by the poller). Detects state changes and appends events to NDJSON:

| Function | Description |
|----------|-------------|
| `append_event <type> <message> [severity]` | Write event to events file |
| `snapshot_event_state` | Save current state for next comparison |
| `detect_events` | Compare current vs. previous state, emit events |
| `detect_scc_pci_changes` | Detect SCC cell handoffs |
| `detect_data_connection_events` | The ONE link/quality detector (ledger B2.3). Called by the poller every cycle from the always-run local block (after `read_ping_data`/`read_dns_data`, before `alert_engine_check`), not from `detect_events`. Decides `internet_lost`/`internet_restored` and the `high_latency`/`latency_recovered` and `high_packet_loss`/`packet_loss_recovered` pairs; publishes `ev_link_state` (`down`/`up`/`""` for stale or unknown). Rules in [`connection-quality.md`](features/connection-quality.md#one-detector-eventssh) |
| `_ev_settle <channel> <value> [sticky]` | Generic settle debounce for discrete radio identifiers. rc 0 settled on a new value (`_EV_SETTLED_FROM`/`_EV_SETTLED_TO`), 1 nothing to report, 2 churning (`_EV_FLAP_N`). `EV_SETTLE_SAMPLES=3`, `EV_FLAP_THRESHOLD=6`, `EV_FLAP_WINDOW=300` s. A blank value is no observation. Channel name is interpolated into variable names, so it must be a bare identifier. State is poller memory (a restart re-settles) |
| `_ev_ca_check <channel> <tech> <scc-count>` | CA announcements for one tech (`lte_ca` / `nr_ca`), keyed on the SCC count through a sticky `_ev_settle`. Called from `detect_events`. See [CA settle rules](#ca-change-settle-rules) |
| `_ev_ca_diff` | Added/removed band diff, one `added\|removed` line (no more "(+B7, -B7)") |

#### CA change settle rules

`ca_change` events used to fire on every raw sample difference, so a secondary carrier dropping out of `AT+QCAINFO` for one sample produced an activated/deactivated pair seconds apart (9 events in about 60 s on the RM551E). They now go through `_ev_ca_check`:

- **Settle:** an SCC count must hold for 3 consecutive observations before it is announced. Real held changes keep the existing wording: `CA activated: ... (N carriers)`, `CA deactivated — single carrier (Bx)`, `carriers changed from A to B (+x, -y)` (diffed against the last announced carriers, not the previous sample).
- **Churn:** one-sample dips that never settle are counted; 6 within 300 s emit a single `LTE/NR CA churn detected` warning per episode (sticky: settling back onto the announced value does not reset the episode).
- **Episode end:** after 300 s with no candidate change the episode closes with `CA settled on <bands>` (info) or `CA settled inactive` (warning).
- **No observation:** an empty carrier list (`[]`) and the `deep` adaptive-polling tier (QCAINFO is skipped there, so the CA fields are stale). A blank never resets a counter.
- **Cold start:** the first settled value after a poller start is adopted silently.

#### Band and PCI settle rules

`band_change` / `pci_change` used a raw sample-to-sample inequality, so every rung of the modem's re-acquisition ladder after a drop (one or two samples per coverage band, then back) was logged, and a blank reading (`parse_serving_cell` blanks band and PCI whenever `AT+QENG` gives no usable line) was copied into the baseline, hiding the return leg. Channels `lte_band`, `lte_pci`, `nr_band`, `nr_pci` now go through a non-sticky `_ev_settle`:

- **Settle:** a value must hold for 3 consecutive observations. Settling back onto the announced value (the ladder case) is silent. A real change reads `LTE band settled on B1 (was B3) (PCI 101)` ("settled on", not "changed from", because skipped rungs are not reported); PCI keeps `LTE PCC cell handoff on B1 (PCI: 101 -> 202)`.
- **Churn:** 6 candidate changes within 300 s without settling emit one warning per window: `LTE band unstable (6 changes in the last 5 min)` / `LTE cell unstable (6 handoffs in the last 5 min)`, NR alike.
- **No observation:** a blank band or PCI, and the NR channels while `nr_state` is not `connected` (counters freeze, so an NSA drop-and-reacquire onto the same band is silent; the `nr_anchor` events report the drop).
- **Baseline:** `snapshot_event_state` keeps the last known good band and PCI across a blank, so `5G NR anchor lost (was n78)` keeps its clause.
- The event ring stays at `MAX_EVENTS=50` (the source also raised it to 300; not ported).

### profile_mgr.sh

Profile CRUD helpers for custom SIM profiles:
- List, get, save, delete profiles in `/etc/qmanager/profiles/`
- Profile ID generation and validation

### tower_lock_mgr.sh

Tower lock state management:
- Read/write tower lock configuration
- Lock/unlock AT commands
- Schedule management

### alert_routing.sh

Trigger×channel routing + capability library for the centralized Alerts feature (sourced by poller and by `monitoring/alerts.sh`):
- Owns `/etc/qmanager/alert_routing.json` (routing matrix, user preference; version 2 — additive `reboot` event)
- `alert_capable <event> <channel>` — hard-coded capability table; the only incapable pair is `connection_lost/email` (email needs internet+DNS, both down during an outage). Both `reboot` cells are capable (the alert is always delivered post-recovery).
- `alert_route_enabled <event> <channel>` — routing AND capability gate
- `alert_routing_load` re-clamps `connection_lost.email` to `false` on every load regardless of the file contents (fail-closed); `reboot.sms`/`reboot.email` get no clamp but default to `false` when absent/null (opt-in), so a pre-v2 file on disk needs no migration

### alert_engine.sh

One centralized downtime state machine (sourced by poller, last in the alert-lib sourcing chain), replacing the two duplicated per-channel state machines that used to live in `sms_alerts.sh`/`email_alerts.sh`:
- `alert_engine_check` — per-cycle entry point, called from the poller's always-every-cycle local block (before any AT work)
- Downtime timer uses the monotonic clock (`mono_now`, not wall-clock epoch) so an SSR-driven NITZ time step can't corrupt it
- `alert_engine_reboot_detect` — one-shot per poller start (called from `main()`), compares the kernel's per-boot `/proc/sys/kernel/random/boot_id` against `/etc/qmanager/last_boot_id`; a change means a real reboot happened (a bare procd respawn keeps the same `boot_id` and stages nothing). Classifies the cause from the shared `/etc/qmanager/crash.log` ledger (newest row within a ±300s window → `watchdog`/`user`/`unplanned`) and stages `/tmp/qmanager_reboot_pending.json`.
- `_ae_reboot_check` — per-cycle delivery of a staged reboot alert once `conn_internet_available == "true"`; reuses the same `sms_alert_emit`/`email_alert_emit` rc-contract; coalesces >3 all-cause reboots/hour into one storm message via `/tmp/qmanager_reboot_storm_hour`
- See [`docs/features/alerts.md`](features/alerts.md#reboot-alerts) for the full detection/classification/delivery model, and the critical **tier4-only vs all-cause reboot-count** distinction between `qmanager_watchcat`'s `count_recent_reboots()` and this engine's `_ae_reboot_count_last_hour()` — both read the same `crash.log` file but must never be conflated
- Has no edge detector of its own: follows `ev_link_state`, published each cycle by `events.sh` `detect_data_connection_events`. A watchdog recovery no longer freezes the outage machine (an outage the watchdog fixes is still alerted, SMS rc 2 retries a send made mid-CFUN). Reboot delivery (`_ae_reboot_check`) is still held mid-recovery and on stale ping data
- One alert wait for every channel: `CQ_ALERT_AFTER_MIN` from `cq_alert_after_min` (`conn_state.sh`), re-resolved at init, at outage start and on SMS/email reloads
- Dispatches sends via `sms_alert_emit`/`email_alert_emit <event> <secs>`, which return an rc contract of `0` (sent), `1` (failed, terminal), `2` (not ready, retry next cycle)
- See [`docs/features/alerts.md`](features/alerts.md) for the full routing/capability model and clock-step rationale

### email_alerts.sh

Email channel transport library (sourced by poller; downtime detection now lives in `alert_engine.sh`):
- Config management (`/etc/qmanager/email_alerts.json`, `/etc/qmanager/msmtprc`)
- `email_alert_emit <event> <secs>` — builds and sends the HTML recovery email via msmtp; a `connection_lost` call is a deliberate no-op (email is never capable during an outage)
- Log writing to `/tmp/qmanager_email_log.json`

### sms_alerts.sh

SMS channel transport library (sourced by poller; downtime detection now lives in `alert_engine.sh`):
- Config management (`/etc/qmanager/sms_alerts.json`; recipient stored as raw digits, no leading `+`)
- `sms_alert_emit <event> <secs>` — builds and sends via `qsms send` (`_sa_do_send`: 3 attempts, 5 s apart, registration check each); returns `2` (not ready to retry) when `_sa_is_registered()` fails rather than attempting a send, or when every attempt that reached `qsms` failed with `modem_busy` / `scan_in_progress`
- `_sa_is_registered()` short-circuits on `conn_internet_available=true` so the recovery branch is never blocked by stale `lte_state`/`nr_state`
- No lock in this lib: the broker takes `/var/lock/qmanager.lock` itself, so `qsms` serializes against `qcmd`. Never wrap it in `flock`.
- Test-send helper for CGI (`send_test` action)
- Log writing to `/tmp/qmanager_sms_log.json`
- Failures are logged via `qlog_error` (full context: `modem_reachable`, `lte_state`, `nr_state`, `conn`, and `last_err` formatted `<code>[: <detail>]` from the `qsms` response). No breadcrumb file.
- No stderr noise filtering: `qsms` prints one JSON line on stdout. See [`docs/features/sms.md`](features/sms.md).

### conn_state.sh

The one reader of `/tmp/qmanager_ping.json` and the one ping-profile/cadence resolver (ledger B2.1). It loads the platform adapter `qm_platform_cqwd.sh` (config store, paths, `cq_alert_after_min`). Sourced by `qmanager_ping`, `qmanager_poller`, `qmanager_watchcat`, `monitoring/connection_quality.sh` and `monitoring/watchdog.sh`; consumers guard the source (`[ -f ... ] && .`) and stub a fail-closed fallback.

- `conn_state_read` — one `jq` read into `CQ_*` vars; stale when `age > max(3 * interval_sec, 15)` s (monotonic `mono` vs `/proc/uptime`); stale or missing leaves `CQ_REACHABLE="null"`.
- `conn_state_resolve <sensitivity>` / `conn_state_cadence` — the single Sensitivity table (interval, `fail_secs`, `recover_secs`, window, quality debounce); there is no interval override, and an unknown name reads `relaxed`.
- `cq_alert_after_min` — resolves the single alert wait (minutes) into `CQ_ALERT_AFTER_MIN`: UCI `quecmanager.quality_thresholds.alert_after_min` (1-1440), else `threshold_minutes` from `sms_alerts.json`, then `email_alerts.json`, else 5. Defined in the adapter; used by `alert_engine.sh`, the poller (on `/tmp/qmanager_quality_reload`) and `monitoring/alerts.sh`; the CGIs stub a default of 5 if the lib is missing.

Full contract: [`docs/features/connection-quality.md`](features/connection-quality.md#shared-ping-cache-reader-conn_statesh).

### ethtool_helper.sh

Ethernet negotiation helpers:
- Build hex advertise masks from supported link modes
- Handle 2.5G auto-negotiation (bit 47, outside 32-bit range)

### cgi_at.sh

AT command execution helpers for CGI scripts that need to send AT commands.

### dpi_helper.sh

Video Optimizer helper functions. Guard-loaded (`_DPI_HELPER_LOADED`).

**Functions:**

| Function | Description |
|----------|-------------|
| `dpi_check_binary()` | Verify nfqws binary (`/usr/bin/nfqws`) exists |
| `dpi_check_kmod()` | Check NFQUEUE support (built-in via `/proc/config.gz` or loadable module) |
| `dpi_get_status()` | Return running/stopped |
| `dpi_get_uptime()` | Calculate from PID file timestamp |
| `dpi_get_packet_count()` | Read nftables counter |
| `dpi_get_domain_count()` | Count hostlist entries |

**Constants:** `NFQWS_BIN=/usr/bin/nfqws`, `NFQWS_PID=/var/run/nfqws.pid`, `DPI_QUEUE_NUM=200`, `DPI_NFT_COMMENT=qmanager_dpi`, `DPI_HOSTLIST=/etc/qmanager/video_domains.txt`.

The NFQUEUE rules are not added by a helper function. They are a persistent fw4 include, `scripts/etc/nftables.d/12-mangle-qmanager-dpi.nft` (chain `mangle_postrouting_qmanager_dpi`, `oifname "rmnet*"` TCP/UDP 443, first 4 packets of each connection, `queue num 200 bypass`). Runtime `nft add rule` would not survive a fw4 reload.

---

## Daemons

### qmanager_poller (Main Data Collector)

The core daemon — runs forever, polls the modem at tiered intervals.

**Location:** `scripts/usr/bin/qmanager_poller`
**Output:** `/tmp/qmanager_status.json`
**Size:** ~3000 lines

**Responsibilities:**
- Execute AT commands via `qcmd` at tiered intervals
- Parse responses via `parse_at.sh`
- Build complete JSON status object
- Detect and emit network events via `events.sh` (radio events from `detect_events` when an AT read is due; link and quality events from `detect_data_connection_events` every cycle, right after `read_ping_data`/`read_dns_data`)
- Manage signal/ping history NDJSON files
- Read ping daemon and watchcat status
- Run the centralized alert engine (`alert_engine_check`, every cycle, following `ev_link_state`) to time outages and dispatch SMS/email via `sms_alerts.sh`/`email_alerts.sh`, gated by `alert_routing.sh`'s routing + capability matrix; also runs `alert_engine_reboot_detect` once at startup to detect and stage a post-recovery reboot alert via `boot_id` comparison

**Tier System:**

| Tier | Interval | Data |
|------|----------|------|
| 1 | 2s cycle (AT every cycle while Active; slower Idle/Deep, see [ARCHITECTURE.md](ARCHITECTURE.md#polling-architecture-backend)) | `AT+QENG="servingcell"`, `AT+QCAINFO`, `AT+CFUN?`, per-antenna signal (`AT+QRSRP;+QRSRQ;+QSINR`), `/proc` traffic and uptime |
| 1.5 | 10s (every 5 cycles) | Ping history append, watchcat state read, SoC temperature (thermal sysfs, no AT) |
| 2 | 30s (every 15 cycles, Active only) | Identity: carrier (`AT+COPS?`), SIM slot (`AT+QUIMSLOT?`), phone number (`AT+CNUM`), SIM presence (`AT+CPIN?`) |
| Boot | Once | Firmware, IMEI, IMSI, ICCID, capabilities, supported bands |

Tier 2 no longer carries CA, MIMO, APN, or the data-plane/L1 group. CA is in Tier 1, and the data-plane/L1 values are fetched on demand by `cellular/radio_details.sh`. The QMI lane's `qmi.env` also fills LTE serving signal on cycles where AT did not read the serving cell (`qmi_merge.sh`).

**Boot APN reconcile:** `collect_boot_data()` invokes `reconcile_active_apn_slot_at_boot()` (defined in `apn_mgr.sh`) immediately after the profile auto-apply step. The function compares the stored active APN slot against the live `AT+CGDCONT?` value and runs a COPS detach/attach cycle only on mismatch — no AT commands fire when the APN is already correct. Two gates must both pass: no active Custom SIM Profile (`/etc/qmanager/active_profile` empty/absent) and a non-zero `active` pointer in `apn_profiles.json`. See [`docs/features/apn-management.md`](features/apn-management.md) for the full invariant.

**Force-Tier-2 flag (`/tmp/qmanager_force_tier2`):** CGI scripts that trigger a modem re-registration event (SIM slot switch in `cellular/settings.sh`, band lock in `bands/lock.sh`) touch this file after a 2-second settle delay. In `poll_cycle`, after the `LONG_FLAG` early-return, the poller checks for the flag: when present it consumes it (`rm -f`) and immediately executes `poll_tier2` + `read_sim_state` + `refresh_sim_identity`, collapsing the stale window for SIM-identity fields from ~30 seconds to ~4 seconds. `refresh_sim_identity` issues `AT+CIMI;+QCCID` and updates `boot_imsi`/`boot_iccid` — no profile or swap side effects. The flag check deliberately sits after `LONG_FLAG` so an in-progress cell scan does not consume and discard it. Producers MUST NOT write `/tmp/qmanager_status.json` — `write_cache` in the poller is the sole atomic writer.

> ℹ️ NOTE: Live network traffic (rx/tx bytes per second) is **not** collected by the poller and is **not** present in `/tmp/qmanager_status.json`. The former opt-in WebSocket bandwidth monitor that served it was retired on 2026-10-15; nothing replaces it. See [`docs/features/bandwidth-monitor.md`](features/bandwidth-monitor.md).

### qmanager_ping (Ping Daemon)

ICMP probe daemon that monitors internet reachability and latency (BusyBox `ping`). Each cycle probes target slot 1 alone, then on failure slots 2-4 in parallel; debounce is wall-clock on `/proc/uptime` and the loop is fixed-rate. Details: [`docs/features/connection-quality.md`](features/connection-quality.md#probe-mechanics).

**Location:** `scripts/usr/bin/qmanager_ping`
**Output:** `/tmp/qmanager_ping.json`
**History:** `/tmp/qmanager_ping_history` (ring of `<rtt|null> <slot>` lines; read as `$1` by the poller and the watchdog)
**Dependency:** BusyBox `ping` (with `-w`), `ping -6` or `ping6` for the IPv6 legs, `timeout` (hostname targets and the DNS job)

Also runs a detached DNS lookup job (every 60 s, plus on a reachable true to false edge) that writes `/tmp/qmanager_dns.json` (`{ms, ok, resolver, name, mono, ts}`); the poller publishes it as `connectivity.dns_lookup_ms` / `dns_resolver`. See the DNS Lookup Time section of [`docs/features/connection-quality.md`](features/connection-quality.md).

Writes slim JSON: `{ timestamp, mono, sensitivity, targets, interval_sec, fail_secs, recover_secs, last_rtt_ms, reachable, streak_success, streak_fail, fail_elapsed_sec, during_recovery, last_family, last_leg, cycle_ms }` (printf, keep-last-good). The poller handles all statistical analysis (avg/min/max/jitter/loss) in a single awk pass over the raw history file.

The probe cadence is set by **Sensitivity** alone (`sensitive` / `regular` / `relaxed` / `quiet`); the table lives in `conn_state.sh` and UCI stores only the name (`ping_profile.sensitivity`) and the four target slots (`ping_profile.targets`). A saved change drops `/tmp/qmanager_ping_reload`; the daemon re-reads UCI within one probe cycle without a restart. See [`docs/features/connection-quality.md`](features/connection-quality.md) for the full table and reload pipeline.

### qmanager_watchcat (Connection Watchdog)

Connection health recovery daemon: the acting half of the unified Connection Quality x Watchdog design (Connection Quality senses, the Watchdog acts). A thin main script plus eight sourced libraries (`wd_{config,state,detect,quality,carrier,ledger,tiers,sim}.sh`) behind the platform adapter `qm_platform_cqwd.sh`; the neutral files are byte-identical with the RM520N repo (`tools/cq-wd-parity/`).

**Location:** `scripts/usr/bin/qmanager_watchcat`
**State:** `/tmp/qmanager_watchcat.json` (heartbeat; removed on exit)
**Config:** UCI `quecmanager.watchcat.*` (17 keys, read through the adapter as logical section `watchdog`)

Three triggers feed one ladder, in priority outage > quality > carrier: the outage trigger (always on; recovery starts after `act_after_sec` of outage, a time in seconds, not a probe count), the opt-in quality trigger (`quality_after_sec`, judged on the raw ping history against the shared Connection Quality limits) and the opt-in carrier trigger (`carrier_after_min` on a single component carrier).

State machine: `MONITOR → SUSPECT → RECOVERY → COOLDOWN (step wait)`, plus `LOCKED`, `RADIO_OFF`, `SSR_HOLD`, `DISABLED`, and the derived `holdoff` state shown after an exhausted ladder.

| Tier | Action | Notes |
|------|--------|-------|
| 1 | `AT+COPS=2` → `AT+COPS=0` | Network re-registration |
| 2 | `AT+CFUN=0` → `AT+CFUN=1` | Reset modem radio (**skipped if an LTE or NR-SA tower lock is active**) |
| 3 | SIM failover | Verified slot swap (Golden Rule sequence); outage reason only |
| 4 | Full reboot | Outage reason only; hourly budget `max_reboots_per_hour` plus a 24 h long-run guard. At the cap Tier 4 **rests**; the daemon never auto-disables |

Quality and carrier ladders stop at Tier 2. Every "off" exit retires the service (`wd_retire_service`) because procd respawns any exit.

> ℹ️ NOTE: `/etc/qmanager/crash.log` is a **shared reboot ledger** — the centralized Alerts feature's `record_planned_reboot` (`qlog.sh`) writes `user`/`unplanned` rows into the same file the watchdog's Tier-4 writer uses for `tier4_escalation` rows. `count_recent_reboots()` (which feeds the hourly budget and `reboots_this_hour`) counts `awk ... $3 == "tier4_escalation"` only, so the watchdog's own reboot rate is unaffected by the other rows. See [`docs/features/alerts.md`](features/alerts.md#reboot-alerts) for the reboot-alert side of this shared-file contract.

Full contract: [`docs/features/connection-watchdog.md`](features/connection-watchdog.md).

### qmanager_cell_scanner / qmanager_neighbour_scanner

On-demand cell scanning daemons started by CGI endpoints.

**Output:** `/tmp/qmanager_cell_scan_result.json`, `/tmp/qmanager_neighbour_scan_result.json` (errors in `*_error`, PID in `*.pid`)

### qmanager_profile_apply

4-step custom profile application daemon, ordered least to most disruptive (`qmanager_profile_apply`):
1. APN → `AT+CGDCONT`
2. TTL/HL → Write `/etc/firewall.user.ttl`
3. MPDN rule → Verizon PDP3 routing or revert (no reboot)
4. IMEI → `AT+EGMR=1,7,"<IMEI>"` + reboot (always last)

**State:** `/tmp/qmanager_profile_state.json`

### qmanager_band_failover / qmanager_tower_failover

Signal-based automatic failover for bands and towers. `qmanager_band_failover` is a one-shot watcher, not a persistent daemon: `bands/lock.sh` spawns it via double-fork after a band lock when failover is enabled, and it exits when done. `qmanager_tower_failover` is the long-running tower watcher (init script `qmanager_tower_failover`).

### qmanager_sites (Sites Monitor)

Times a TCP handshake to each configured website every `interval_sec` (default 300) and keeps 90 days of hourly history; a live ~2 s probe runs while a browser holds the `range=now` lease. Never touches the AT port and feeds no verdict, event or alert.

**Location:** `scripts/usr/bin/qmanager_sites` (procd service `qmanager_sites`)
**Config:** `/etc/qmanager/sites.json`; **State:** `/tmp/qmanager_sites.json`, `/tmp/qmanager_sites_raw.ndjson`, `/tmp/qmanager_sites_live.json`; **History:** `/usrdata/qmanager/sites/*.jsonl`

See [`docs/features/sites-monitor.md`](features/sites-monitor.md).

Tower failover is an **explicit user toggle** (v0.1.18+) — applying a cell lock does not auto-enable the watcher. The user must flip the **Signal Failover** switch on the Tower Locking page for the daemon to spawn. Unlocking still stops and disables the daemon automatically. The init.d `stop()` escalates SIGTERM → 2 s wait → SIGKILL and always clears the PID file + activation flag, and `failover_status.sh` self-heals any orphan daemon it detects during the frontend's status poll.

### qmanager_tower_schedule

Cron-driven tower lock schedule executor.

### qmanager_mtu_apply

Waits for `rmnet_data0` interface (up to 120s), then applies MTU from `/etc/firewall.user.mtu`.

### qmanager_imei_check

Boot-time one-shot: checks if IMEI was rejected (cause 5 from `AT+QNETRC?`), restores backup IMEI if configured. Drops a `record_planned_reboot "user"` breadcrumb before the reboot that follows a backup-IMEI restore.

### qmanager_scheduled_reboot

Cron-called script that logs the event and reboots the device.

**Location:** `scripts/usr/bin/qmanager_scheduled_reboot`
**Triggered by:** Cron entry managed by `system/settings.sh`

Minimal script: logs via qlog, drops a `record_planned_reboot "user"` breadcrumb, then calls `reboot`. Scheduled reboots fold into the single `user` cause bucket for the reboot-alert feature — there is no separate "scheduled" classification.

### qmanager_dpi_install (nfqws Installer)

**Type:** One-shot background script (spawned by CGI)
**Location:** `scripts/usr/bin/qmanager_dpi_install`
**State file:** `/tmp/qmanager_dpi_install.json`
**PID file:** `/var/run/qmanager/dpi_install.pid` (root-only run dir, B5.11)

Downloads and installs the nfqws binary from the [zapret](https://github.com/bol-van/zapret) GitHub releases. The binary is **not bundled** with QManager and is **not installed via opkg** — it is fetched on demand from upstream to avoid dependency issues on custom firmware (e.g., iamromulan's RM551E-GL build).

**Flow:**

1. Detect device architecture via `uname -m` (aarch64, armv7l, x86_64, mips, mipsel)
2. Use the pinned zapret release (`ZAPRET_TAG`, currently `v72.13`); no GitHub API lookup. The URL is the `openwrt-embedded` tarball (binaries only).
3. Verify the download against the pinned release digest
4. Download the tarball to `/var/run/qmanager/dpi_download/`
5. Extract only the architecture-specific `nfqws` binary (`zapret-<tag>/binaries/<arch>/nfqws`, where `<arch>` is the mapped name such as `linux-arm64`)
6. Install to `/usr/bin/nfqws` with `chmod 755`
7. Verify the binary runs (`nfqws --help`)
8. Write success/error result to `/tmp/qmanager_dpi_install.json`

**Singleton:** The CGI checks the PID file before spawning; if an install is already running, it returns `"status": "running"` without starting a second instance.

**Cleanup:** Removes the download directory and PID file on exit (via `trap cleanup EXIT INT TERM`).

**Result file format:**

```json
{"success": true, "status": "complete", "message": "nfqws installed successfully", "detail": "v69"}
```

Status values: `running`, `complete`, `error`

### qmanager_dpi (DPI Evasion — Video Optimizer + Traffic Masquerade)

**Type:** Procd service, one nfqws instance
**Binary:** `/usr/bin/nfqws` (from zapret project), PID file `/var/run/nfqws.pid`
**Config:** UCI `quecmanager.video_optimizer` + `quecmanager.traffic_masquerade`

Runs a single nfqws instance on NFQUEUE 200. The two modes are mutually exclusive, and Traffic Masquerade wins when both are enabled:

- **Video Optimizer** (`video_optimizer.enabled=1`): `split2` desync on the hostnames in `/etc/qmanager/video_domains.txt`. Options: `desync_repeats` (clamped 1–10), `quic_enabled` (UDP length increment).
- **Traffic Masquerade** (`traffic_masquerade.enabled=1`): `fake` desync with a spoofed TLS SNI (`sni_domain`, default `speedtest.net`), applied to all HTTPS traffic.

**Start:** `start_service` checks the binary and kernel module, picks the mode from UCI, and launches nfqws via procd with `pidfile` set to `/var/run/nfqws.pid`. Returns without starting if neither mode is enabled. The NFQUEUE rules are a persistent fw4 include (see `dpi_helper.sh` above), not added at start time.
**Stop:** `stop_service` removes the PID file. procd stops the instance.
**Respawn:** 3600s window, 5s delay, max 5 respawns

Uses `STOP=10` and `USE_PROCD=1`.

### qcmd

AT command entry point. `/usr/bin/qcmd` is a symlink to `qmanager_atd` (the Rust broker client: talks to `/var/run/qmanager_atd.sock`, falls back to an in-process exchange if the daemon is down) always. It takes `/var/lock/qmanager.lock`, enforce per-command deadlines, and print identical output. See [`docs/features/at-broker.md`](features/at-broker.md).

```sh
result=$(qcmd 'AT+QENG="servingcell"')
```

---

## Init.d Services

| Service | Type | START | Daemon | Description |
|---------|------|-------|--------|-------------|
| `qmanager_atd` | procd | 98 | `qmanager_atd` | AT broker serving `qcmd`; reconciles the `qcmd` link and host AT ports at boot |
| `qmanager` | procd | 99 | `qmanager_poller` + `qmanager_ping` | Main poller and ping daemon |
| `qmanager_eth_link` | non-procd | 99 | — | Apply PCIe ASPM policy, then ethernet link speed, on boot |
| `qmanager_ttl` | non-procd | 99 | — | Apply TTL/HL rules on boot (sources `/etc/firewall.user.ttl`) |
| `qmanager_mtu` | non-procd | 99 | `qmanager_mtu_apply` | MTU application daemon |
| `qmanager_imei_check` | non-procd | 99 | `qmanager_imei_check` | Boot-time IMEI check (one-shot, double-fork) |
| `qmanager_tower_failover` | non-procd | 99 | `qmanager_tower_failover` | Tower failover watchdog |
| `qmanager_dpi` | procd | 99 | `nfqws` (x1) | DPI evasion on NFQUEUE 200: Video Optimizer or Traffic Masquerade (mutually exclusive, UCI-gated) |
| `qmanager_sites` | procd | 99 | `qmanager_sites` | Sites monitor (per-site latency); always enabled, on/off in `/etc/qmanager/sites.json` |
| `qmanager_watchcat` | procd | 99 | `qmanager_watchcat` | Connection watchdog (4-tier recovery ladder) |
| `qmanager_sms_forward` | procd | 99 | `qmanager_sms_forward` | SMS forwarding daemon (polls the inbox via `qsms`) |
| `qmanager_sms_storage` | non-procd | 99 | `qmanager_sms_storage` | One-shot at boot: points `AT+CPMS` at the chosen SMS storage (ME or SM) |
| `qmanager_netbird_zone` | non-procd | 99 | — | Boot-time self-heal of the NetBird firewall zone |
| `qmanager_tailscale_net` | non-procd | 99 | — | Boot-time re-assert of Tailscale network fixes |

Non-procd services use the double-fork pattern for daemonization:
```sh
start() {
    ( "$DAEMON" </dev/null >/dev/null 2>&1 & )
}
```

---

## CGI Endpoint Structure

Every CGI script follows this pattern:

```sh
#!/bin/sh
# Optional: skip auth for auth endpoints
# _SKIP_AUTH=1

. /usr/lib/qmanager/cgi_base.sh
qlog_init "cgi_feature"
cgi_headers

case "$REQUEST_METHOD" in
    GET)
        # Read data and return JSON
        ;;
    POST)
        cgi_handle_options
        cgi_read_post
        # Parse POST_DATA with jq, execute actions, return JSON
        ;;
    OPTIONS)
        exit 0
        ;;
    *)
        cgi_method_not_allowed
        ;;
esac
```

### CGI Endpoints by Category

#### Authentication (`auth/`)

| Script | Method | Description |
|--------|--------|-------------|
| `check.sh` | GET | Check setup status, session and lockout state (read-only) |
| `login.sh` | POST | Login or first-time password setup |
| `logout.sh` | POST | Destroy session |
| `password.sh` | POST | Change password |

All auth endpoints set `_SKIP_AUTH=1`.

#### Modem Data (`at_cmd/`)

| Script | Method | Description |
|--------|--------|-------------|
| `fetch_data.sh` | GET | Main cached status JSON (reads `/tmp/qmanager_status.json`) |
| `fetch_events.sh` | GET | Network event log (NDJSON → JSON array) |
| `fetch_signal_history.sh` | GET | Signal history (NDJSON → JSON array) |
| `fetch_ping_history.sh` | GET | Ping history (NDJSON → JSON array) |
| `send_command.sh` | POST | Execute raw AT command |
| `cell_scan_start.sh` | POST | Start cell scan daemon |
| `cell_scan_status.sh` | GET | Get cell scan results |
| `neighbour_scan_start.sh` | POST | Start neighbor scan |
| `neighbour_scan_status.sh` | GET | Get neighbor scan results |
| `speedtest_start.sh` | POST | Start speed test |
| `speedtest_status.sh` | GET | Get speedtest results |
| `speedtest_check.sh` | GET | Check speedtest availability |

#### Cellular Settings (`cellular/`)

| Script | Method | Description |
|--------|--------|-------------|
| `settings.sh` | GET/POST | Mode, roaming, AMBR configuration |
| `apn.sh` | GET/POST | APN settings — single APN (save / deactivate); shared lib `apn_mgr.sh` |
| `mbn.sh` | GET/POST | MBN profile select/auto |
| `imei.sh` | GET/POST | IMEI read/write/backup |
| `network_priority.sh` | GET/POST | LTE/NR mode preferences |
| `fplmn.sh` | GET/POST | Clear forbidden networks |
| `sms.sh` | GET/POST | SMS inbox/send |

#### Band Locking (`bands/`)

| Script | Method | Description |
|--------|--------|-------------|
| `current.sh` | GET | Current locked bands |
| `lock.sh` | GET/POST | Band lock configuration |
| `failover_status.sh` | GET | Band failover state |
| `failover_toggle.sh` | POST | Enable/disable band failover |

#### Frequency Locking (`frequency/`)

| Script | Method | Description |
|--------|--------|-------------|
| `lock.sh` | GET/POST | EARFCN/ARFCN locking |
| `status.sh` | GET | Current frequency lock |

#### Tower Locking (`tower/`)

| Script | Method | Description |
|--------|--------|-------------|
| `lock.sh` | GET/POST | PCI lock configuration |
| `status.sh` | GET | Current PCI lock state |
| `settings.sh` | GET/POST | Tower lock settings |
| `failover_status.sh` | GET | Tower failover state |
| `schedule.sh` | GET/POST | Scheduled tower changes |

#### Network Settings (`network/`)

| Script | Method | Description |
|--------|--------|-------------|
| `ethernet.sh` | GET/POST | Link speed, duplex, auto-negotiation, PCIe ASPM policy |
| `ttl.sh` | GET/POST | IPv4 TTL / IPv6 Hop Limit |
| `mtu.sh` | GET/POST | MTU size |
| `dns.sh` | GET/POST | Custom DNS override |
| `ip_passthrough.sh` | GET/POST | IP passthrough mode |
| `video_optimizer.sh` | GET/POST | DPI Settings (Video Optimizer + Traffic Masquerade), install, and verify |

#### Custom Profiles (`profiles/`)

| Script | Method | Description |
|--------|--------|-------------|
| `list.sh` | GET | List all SIM profiles |
| `get.sh` | GET | Get single profile by ID |
| `save.sh` | POST | Create or update profile |
| `delete.sh` | POST | Delete profile |
| `apply.sh` | POST | Start the 4-step apply process (`qmanager_profile_apply`) |
| `apply_status.sh` | GET | Get apply progress |
| `deactivate.sh` | POST | Deactivate active profile |
| `current_settings.sh` | GET | Current modem settings (for profile creation) |

#### Connection Scenarios (`scenarios/`)

| Script | Method | Description |
|--------|--------|-------------|
| `list.sh` | GET | List all scenarios |
| `save.sh` | POST | Create or update scenario |
| `delete.sh` | POST | Delete scenario |
| `activate.sh` | POST | Activate scenario (applies as profile) |
| `active.sh` | GET | Get currently active scenario |

#### Monitoring (`monitoring/`)

| Script | Method | Description |
|--------|--------|-------------|
| `alerts.sh` | GET/POST | Centralized SMS + email + reboot connection alerts: settings, routing matrix (incl. `reboot`), capability matrix, `reboots` history array, test send, merged activity log |
| `connection_quality.sh` | GET/POST | Connection Quality: Sensitivity, four probe targets, latency/loss limits (`save_probe`, `save_thresholds`); replaces `system/ping_profile.sh` and `system/quality_thresholds.sh` |
| `watchdog.sh` | GET/POST | Watchdog settings (17 keys), effective values and status (`save_settings`, `revert_sim`, `retry_failback`, `dismiss_sim_swap`) |

#### Device (`device/`)

| Script | Method | Description |
|--------|--------|-------------|
| `about.sh` | GET | Device info (firmware, model, etc.) |

#### System (`system/`)

| Script | Method | Description |
|--------|--------|-------------|
| `settings.sh` | GET/POST | System preferences, scheduled reboot |
| `reboot.sh` | POST | Trigger device reboot (uses `cgi_reboot_response`) |
| `logs.sh` | GET | System log output |

#### VPN (`vpn/`)

| Script | Method | Description |
|--------|--------|-------------|
| `tailscale.sh` | GET/POST | Tailscale VPN status and config |
| `netbird.sh` | GET/POST | NetBird VPN status and config |

#### Other endpoints (not itemised above)

The tree also ships these CGI scripts under `scripts/www/cgi-bin/quecmanager/`. Check each script's header for its exact methods and behaviour:

- `at_cmd/`: `reconnect_modem.sh`, `speedtest_servers.sh`
- `cellular/`: `live_signal.sh` (POST live-signal lease, see [`features/live-signal.md`](features/live-signal.md)), `radio_details.sh` (on-demand radio fields, populates `/tmp/qmanager_ondemand.json`), `sms_forwarding.sh`, `sms_storage.sh`
- `metrics/`, `monitoring/`: `prometheus.sh` (metrics scrape), `sites.sh` (sites monitor)
- `network/`: `data_used.sh`, `dns.sh`, `lan_config.sh`, `lan_devices.sh`
- `public/`: `hostname.sh`, `overview.sh`, `units.sh` (unauthenticated read-only data for the public overview)
- `system/`: `adaptive_polling.sh`, `config-backup/` (`collect.sh`, `apply.sh`, `apply_status.sh`, `apply_cancel.sh`), `diagnostics.sh`, `health-check/` (`run.sh`, `status.sh`, `download.sh`, `clear.sh`), `host_at_ports.sh`, `ipa_offload.sh`, `known_sims.sh`, `language-packs/` (`list.sh`, `install.sh`, `install_status.sh`, `install_cancel.sh`, `remove.sh`), `pending_reboot.sh`, `ssh_password.sh`, `storage.sh`, `update.sh`, `web_port.sh`

---

## File Locations on Device

### Temporary State (`/tmp/`)

| File | Owner | Purpose |
|------|-------|---------|
| `qmanager_status.json` | poller | Main cached modem status |
| `qmanager_signal_history.json` | poller | Signal history NDJSON |
| `qmanager_ping_history.json` | poller | Ping history NDJSON |
| `qmanager_events.json` | poller | Network events NDJSON |
| `qmanager_ping.json` | ping daemon | Current ping result |
| `qmanager_ping_history` / `qmanager_ping_slots.json` | ping daemon | Raw probe ring (`<rtt|null> <slot>` per line, read by the poller statistics and the Watchdog's quality window) / live state of the four target slots |
| `qmanager_dns.json` | ping daemon (detached job) | Last DNS lookup time `{ms, ok, resolver, name, mono, ts}` |
| `qmanager_sites.json` / `qmanager_sites_raw.ndjson` / `qmanager_sites_live.json` | sites daemon | Latest sweep, 24 h raw samples, live "Now" samples |
| `qmanager_sites_now` / `qmanager_sites_live` | CGI (`monitoring/sites.sh`) | Check-now flag; live lease (epoch), read-only for the daemon |
| `qmanager_watchcat.json` | watchcat | Watchdog state |
| `qmanager_profile_state.json` | profile_apply | Apply progress |
| `qmanager_pci_state.json` | poller (events) | SCC PCI tracking |
| `qmanager_email_log.json` | poller (email) | Email log NDJSON |
| `qmanager_email_reload` | CGI | Trigger file for config reload |
| `qmanager_sms_log.json` | poller (sms) | SMS log NDJSON |
| `qmanager_sms_reload` | CGI | Trigger file for SMS config reload |
| `qmanager_force_tier2` | CGI (settings.sh, bands/lock.sh) | Touch-flag; consumed by poller to force an early Tier-2 poll after SIM switch or band lock |
| `qmanager_dpi_install.json` | dpi_install | nfqws installer progress/result |
| `qmanager_dpi_install.pid` | dpi_install | Retired: now `/var/run/qmanager/dpi_install.pid` (B5.11) |
| `qmanager_dpi_verify.json` | dpi_verify | DPI verification test results |
| `qmanager_dpi_verify.pid` | dpi_verify | Retired: now `/var/run/qmanager/dpi_verify.pid` (B5.11) |
| `qmanager_reboot_pending.json` | poller (`alert_engine.sh`) | Staged reboot alert awaiting post-recovery delivery; tmpfs on purpose — a real reboot wipes it, a poller respawn does not |
| `qmanager_reboot_storm_hour` | poller (`alert_engine.sh`) | Mono-stamped marker suppressing further reboot alerts after a coalesced storm message |
| `qmanager_crashlog.lock` | qlog.sh (`record_planned_reboot`) | flock guarding appends to the shared `/etc/qmanager/crash.log` reboot ledger |
| `qmanager_sessions/` | CGI (auth) | Session files |
| `qmanager.log` | all (qlog) | Centralized log file |
| `/var/run/nfqws.pid` | qmanager_dpi (procd pidfile) | nfqws instance PID (uptime tracking) |
| `/tmp/qmanager_auth_attempts.json` | cgi_auth | Login rate-limit ladder state |
| `/tmp/qmanager_ondemand.json` | `cellular/radio_details.sh` / poller | Last-known on-demand radio fields |

### Persistent Configuration (`/etc/qmanager/`)

| File | Purpose |
|------|---------|
| `auth.json` | Password hash + salt (SHA-256) |
| `profiles/<id>.json` | Custom SIM profile configs |
| `tower_lock.json` | Tower lock configuration |
| `sites.json` | Sites monitor config (`interval_sec`, site list) |
| `imei_backup.json` | IMEI backup config (`{ enabled, imei }`) |
| `sms_alerts.json` | SMS alert settings (`{ enabled, recipient_phone, threshold_minutes }`). `recipient_phone` is stored as raw digits with no leading `+` — the CGI save handler normalizes input before writing. |
| `email_alerts.json` | Email alert settings (`{ enabled, sender_email, recipient_email, app_password, threshold_minutes }`). |
| `alert_routing.json` | Trigger×channel routing matrix, version 2 (`{ version, events: { connection_lost, connection_restored, reboot } }`); `connection_lost.email` is always clamped to `false`; `reboot.sms`/`reboot.email` default `false` (opt-in) when absent, no clamp. See [`docs/features/alerts.md`](features/alerts.md). |
| `crash.log` | Shared reboot ledger, format `<epoch>\|reboot\|<reason>`, capped at 20 lines. Written by `qmanager_watchcat` (`tier4_escalation` rows) and by `record_planned_reboot` in `qlog.sh` (`user`/`unplanned` rows). Read by `count_recent_reboots()` (tier4-only) and `alert_engine.sh` (all-cause). See [`docs/features/alerts.md`](features/alerts.md#reboot-alerts). |
| `last_boot_id` | Persisted copy of `/proc/sys/kernel/random/boot_id`, compared once per poller start by `alert_engine_reboot_detect` to detect a real reboot (vs. a procd respawn). |
| `last_iccid` | Last seen SIM ICCID (for swap detection) |
| `msmtprc` | Gmail SMTP config (chmod 600) |
| `imei_check_pending` | Flag for boot-time IMEI check |

### UCI Configuration

| Key | Values | Purpose |
|-----|--------|---------|
| `quecmanager.settings.temp_unit` | `celsius`, `fahrenheit` | Dashboard temperature display |
| `quecmanager.settings.distance_unit` | `km`, `miles` | Dashboard distance display |
| `quecmanager.settings.sched_reboot_enabled` | `0`, `1` | Scheduled reboot on/off |
| `quecmanager.settings.sched_reboot_time` | `HH:MM` | Scheduled reboot time |
| `quecmanager.settings.sched_reboot_days` | `0,1,...,6` | Scheduled reboot days (0=Sun) |
| `quecmanager.video_optimizer.enabled` | `0`, `1` | Video Optimizer on/off |
| `quecmanager.video_optimizer.quic_enabled` | `0`, `1` | QUIC desync on/off (default `1`) |
| `quecmanager.video_optimizer.desync_repeats` | `1`–`10` | Video Optimizer desync repeats (clamped; default 1) |
| `quecmanager.traffic_masquerade.enabled` | `0`, `1` | Traffic Masquerade on/off |
| `quecmanager.traffic_masquerade.sni_domain` | domain name | Spoofed SNI domain (default `speedtest.net`) |
| `system.@system[0].timezone` | POSIX TZ string | System timezone |
| `system.@system[0].zonename` | IANA zone name | System timezone display name |

### Firewall Rules

| File | Owner | Purpose |
|-----|--------|---------|
| `/etc/firewall.user.ttl` | ttl.sh, apn.sh, profile_apply | TTL/HL iptables rules |
| `/etc/firewall.user.mtu` | mtu.sh | MTU `ip link set` rules |

---

## Development Guidelines

### Creating a New CGI Endpoint

1. Create the script in `scripts/www/cgi-bin/quecmanager/<category>/<name>.sh`
2. Start with the standard boilerplate (source `cgi_base.sh`, call `qlog_init`, `cgi_headers`)
3. Authentication is **automatic** — no extra code needed
4. Use `jq` for JSON construction (never echo raw JSON strings)
5. Use `qcmd` for AT commands
6. Return consistent JSON: `{ "success": true/false, ... }`
7. **Ensure LF line endings** (check with `file` or `cat -A`)

### Creating a New Daemon

1. Create the daemon script in `scripts/usr/bin/qmanager_<name>`
2. Create an init.d script in `scripts/etc/init.d/qmanager_<name>`
3. Use double-fork for daemonization (no `setsid`)
4. Set `START=99` in init.d
5. Source `qlog.sh` and call `qlog_init`
6. Write state to `/tmp/qmanager_<name>.json`
7. Handle `SIGTERM` and `SIGINT` via `trap cleanup EXIT INT TERM`

---

## Installer (`scripts/install.sh`)

The installer copies QManager onto the device filesystem and starts services. It is used both for fresh installs (via `qmanager-installer.sh`) and for OTA updates (Software Update path, `--no-reboot --skip-packages`).

### Service stop / restart

`stop_services` stops every `qmanager*` init script (watchcat first, under the `/tmp/qmanager_watchcat.lock` maintenance lock), then kills stragglers. Before stopping, `snapshot_running_services` records which services were running: procd scripts are asked `running`, and `qmanager_tower_failover` (non-procd) is checked through its pid file. Do not call `running` on a non-procd rc.common script: it prints usage and returns 0.

`start_services` starts `qmanager_atd`, `qmanager` and `qmanager_sites`, then `restore_running_services` starts every other service from the snapshot. Gated services re-check their own UCI flag in `start`, so this restores the pre-install state without force-enabling anything. This matters on `--no-reboot` installs; without it a running `qmanager_dpi` stayed down until the next reboot (B5.27).

### File-copy helpers

| Function | Used for |
|----------|----------|
| `install_file(src, dst, mode)` | Single file (daemons, libs, config defaults) |
| `install_dir_flat(src, dst, mode)` | All files in a flat directory (e.g. `usr/bin/`) |
| `install_tree(src, dst)` | Recursive directory tree (CGI endpoints) |

`install_dir_flat` stages every file (`stage_file`: copy to `<dst>.qm_install.$$`, size check, CRLF strip, chmod), flushes once, then renames them all into place (`commit_file`), and `die`s on the first failure. `install_file` does the same for one file. `install_tree` builds a fresh copy of the tree under `/usr/lib/.qmanager_stage/new.$$` (same overlay as `/www`, but outside the web root so nothing half-installed is executable over HTTP), runs its own integrity sweep (see below) and the CRLF strip there, flushes, then swaps it in for the live directory.

### Crash-safe writes (`flush_storage`)

`/usr`, `/www` and `/etc` all live on the UBIFS `/usrdata` volume, and its dirty pages reach flash only after `dirty_expire` (30 s). A rename alone is not durable: after an AP hang or power loss the rename can survive while the new file's data did not, leaving a 0-byte file. On 2026-10-19 a dev deploy copied 8 poller files, restarted the poller without `sync`, the AP hung about 30 s later, and the power cycle left all 8 files 0 bytes.

So the installer runs `flush_storage` (a logged `sync`) between staging and renaming every file or tree, once more after `seed_uci_defaults` and before any service is enabled or started, once after `finalize_version` (this also covers frontend-only installs), and in `reboot_system` before rebooting. A crash at any point then leaves the old file or the new one, never an empty one. `qmanager_update` syncs before each of its reboots, and `uninstall.sh` syncs after removing files and before rebooting. The `tools/modem-mcp` `modem_write` dev tool follows the same pattern: temp file beside the target, size and `sh -n` check, `sync`, `mv`, `sync`.

### Truncation-integrity check

Both `install_file` and `install_tree` verify that each copied file is byte-for-byte the same size as its source. This catches truncated transfers caused by ENOSPC, an interrupted OTA download, or an aborted SSH copy.

**`install_file`:** After `cp` and before the CRLF strip, compares `wc -c < "$src"` with `wc -c < "$tmp"`. On mismatch:
1. Logs `install_file: SIZE MISMATCH (truncated copy) <src> (<N> B) -> <tmp> (<M> B)` to `/tmp/qmanager_install.log`.
2. Removes the temp file and returns 1.
3. `install_dir_flat` receives the failure and calls `die`, aborting the entire install.

**`install_tree`:** After `cp -r "$src"/. "$dst"/` and before the CRLF strip, walks `find "$src" -type f` and compares `wc -c` for each file pair. Mismatches are recorded to a temp marker file (`/tmp/qm_install_treechk.$$`). After the loop (not inside it — the `while` body runs in a subshell, so `die` there would only kill the subshell), if any mismatches were recorded the installer logs them and calls `die "install_tree: $src -> $dst copy truncated (see $LOG_FILE)"`.

**Why this matters:** A truncated-but-present shell script (including a 0-byte file) passes `sh -n` syntax check and execs cleanly — it just exits immediately without doing anything. This once shipped an empty `qmanager_profile_apply` to a device, which caused SIM Profile activation to fail with `start_failed` every time with no visible error in the script layer. The integrity check turns that silent breakage into a loud install failure.

**Log location:** `/tmp/qmanager_install.log`. Both signatures — `SIZE MISMATCH` and `copy truncated` — appear here and can be grepped after a failed install to identify which files were affected.

> ℹ️ NOTE: The integrity check runs on byte counts, not checksums, to stay within BusyBox's toolset without requiring `md5sum` or `stat`. `wc -c` is a BusyBox core applet. `tr -d ' '` normalizes the leading whitespace that some `wc` builds emit.

### `set -e` and `uci -q get` invariant

`install.sh` and `uninstall.sh` both run under `set -e`. Inside a `set -e` shell, a bare command-substitution assignment such as:

```sh
val=$(uci -q get quecmanager.watchcat.fail_threshold)
```

inherits the exit status of the subshell command. When `uci -q get` finds no matching key it exits 1, which propagates to the parent shell and kills the script **silently** — there is no error message and the exit looks like a clean exit to the caller (including the OTA update daemon).

**`2>/dev/null` does not help.** It suppresses stderr but has no effect on the exit status that kills the shell.

**Conditions are exempt.** Commands on the right side of `||` / `&&`, inside `if`/`while`/`until` tests, and after `!` are not subject to `set -e` termination. Only bare statements and the right-hand side of a pipeline are affected.

**Safe pattern:** append `|| true` to every optional `uci -q get` assignment, and `|| warn "..."` to any migration-helper call that might legitimately return non-zero:

```sh
# WRONG — silent kill when the key is absent (e.g. a retired key or a fresh install)
val=$(uci -q get quecmanager.watchcat.fail_threshold)

# CORRECT
val=$(uci -q get quecmanager.watchcat.fail_threshold) || true
```

**Why this matters (v0.1.29 regression):** Commit 7f0a5a8 (2026-06-19, "split probe interval from fail threshold, unify quality thresholds") retired the `latency_ceiling_ms` and `loss_ceiling_pct` UCI keys and added six unguarded reads of the new keys plus two unguarded migration-function calls. On fresh installs the new keys did not exist yet; on upgrades the retired keys were already gone. Both paths caused `install.sh` to silently die mid-execution at Step 11/16 "Seeding UCI defaults", leaving Steps 12–16 unrun: `qmanager_sms_forward` and `quality_thresholds` UCI sections were never seeded, and no services were enabled or started. The OTA update daemon (`qmanager_update`) calls `install.sh` directly, so Software Update was equally broken. Fix: append `|| true` / `|| warn` to all six assignments and both migration calls.

> ⚠️ WARNING: When retiring a UCI key or adding a new optional one in `install.sh`, always audit every line in the Seed UCI defaults and migration blocks for bare command-substitution assignments. A single unguarded `$(uci -q get <gone-key>)` will silently abort the entire installer on any device that has already had that key removed or never had it seeded.

### Library co-deployment invariant

Any script that sources a library under `/usr/lib/qmanager/` **must ship the library in the same release** as the script that depends on it. Devices on an older install that upgrade only via `install.sh` may not have the library yet. If the library is absent and the sourcing script lacks an `[ -f ]` guard (see BusyBox dot-sourcing gotcha above), the script silently dies.

**Concrete case:** `ondemand_radio.sh` was introduced in a release after the initial install. Devices that ran the old installer had no `/usr/lib/qmanager/ondemand_radio.sh`. `qmanager_poller` sourced it unconditionally at start-up; on those devices the poller exited on the first cycle with no logged error. Fix: add `[ -f ]` guard around the source call AND ensure `install.sh` always copies the library via `install_dir_flat "usr/lib/qmanager" "/usr/lib/qmanager" 644`.

**Rule:** when adding a new library, add its `install_dir_flat` (or `install_file`) call to `install.sh` in the same commit. Never rely on the library being present from a prior install.

---

### JSON Response Conventions

```sh
# Success with data
jq -n --arg value "$value" '{"success":true,"data":$value}'

# Success with object
jq -n --arg f1 "$field1" --argjson f2 "$field2_num" \
  '{"success":true,"field1":$f1,"field2":$f2}'

# Error
cgi_error "error_code" "Human-readable detail message"

# Reboot after response
cgi_reboot_response  # flushes HTTP, then reboots async
```
