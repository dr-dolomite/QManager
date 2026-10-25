# QManager API Reference

Complete reference for all CGI endpoints. All endpoints are under `/cgi-bin/quecmanager/`.

All authenticated endpoints require a valid `qm_session` cookie (auto-sent by the browser). A `401` response means the session is expired or missing. The one exception is the machine endpoint `/metrics/prometheus.sh`, which takes a bearer token instead of the cookie (see Monitoring).

---

## Response Format

All endpoints return JSON with a consistent structure:

```json
// Success
{ "success": true, ... }

// Error
{ "success": false, "error": "error_code", "detail": "Human-readable message" }
```

---

## Authentication

### GET `/auth/check.sh`

Public (`_SKIP_AUTH=1`). Reports setup, session and login-lockout state. Read-only: it calls `qm_get_rate_limit_status` and never mutates the attempts file, so a page refresh cannot extend a lockout. See [`reference/auth-rate-limiting.md`](reference/auth-rate-limiting.md).

**Response (first-time setup):**
```json
{ "authenticated": false, "setup_required": true }
```

**Response (valid session):**
```json
{ "authenticated": true }
```

**Response (signed out):**
```json
{
  "authenticated": false,
  "rate_limited": false,
  "retry_after": 0,
  "attempts_remaining": 5
}
```
`rate_limited` is `true` while a lockout is active and `retry_after` is then the seconds left. `attempts_remaining` is 5 minus the failures counted at the current level, and reads 0 on an unlocked form once the ladder is engaged (the next wrong password re-locks).

### POST `/auth/login.sh`

Login or first-time password setup.

**Login Request:**
```json
{ "password": "user_password" }
```

**Setup Request (first-time):**
```json
{ "password": "new_password", "confirm": "new_password", "enforce_strong": true }
```
Setup errors are `password_weak`, `password_mismatch` and `missing_password`. `enforce_strong` defaults to true; when false only the 5-character minimum applies.

**Success Response:**
```json
{ "success": true }
```
Sets `qm_session` (HttpOnly) and `qm_logged_in=1` cookies.

**Wrong password (HTTP 200):**
```json
{
  "success": false,
  "error": "invalid_password",
  "detail": "Invalid password",
  "attempts_remaining": 3
}
```

**Locked out (HTTP 429):** refused before the password is verified, so a correct password during a lockout is still refused.
```json
{
  "success": false,
  "error": "rate_limited",
  "detail": "Too many failed attempts",
  "retry_after": 30,
  "attempts_remaining": 0
}
```
Ladder: 5 free failures, then locks of 30, 120, 300 and 900 seconds (capped); one more failure after each expiry re-locks at the next rung; a success clears the state and an hour without a failure resets the level.

### POST `/auth/logout.sh`

Destroy current session.

**Response:**
```json
{ "success": true }
```
Clears session cookies.

### POST `/auth/password.sh`

Change password. Requires authentication.

**Request:**
```json
{
  "current_password": "old_password",
  "new_password": "new_password"
}
```

**Response:**
```json
{ "success": true }
```
Destroys all sessions (forces re-login).

**Verify only.** `{"current_password":"...","verify_only":true}` checks the current password and changes nothing: it needs no `new_password`, leaves the session and the password alone, and answers `{ "success": true }`. The Passwords card calls it for its Continue step. Only the JSON boolean `true` enables it (the string `"true"` falls through to a normal change and fails `missing_fields`).

The current-password check shares the login rate limit (`/tmp/qmanager_auth_attempts.json`): a wrong password returns `invalid_password` with `attempts_remaining` and counts toward the lockout, a locked caller gets `429 rate_limited` with `retry_after`, and a correct password clears the counter. See [`reference/auth-rate-limiting.md`](reference/auth-rate-limiting.md).

### POST `/system/ssh_password.sh`

Change the SSH (root) password. Requires authentication. Same request shape as `/auth/password.sh` (`current_password`, `new_password`, `enforce_strong`), but `current_password` is the **current SSH password**, checked against the root hash in `/etc/shadow` (not the QManager web password). Existing SSH sessions and the web session are unaffected. `{"current_password":"...","verify_only":true}` checks the current password and changes nothing. A wrong password answers `invalid_password` after a 1 s delay; this endpoint has no lockout ladder.

---

## Public (unauthenticated)

These back the pre-auth `/` splash and the login screen. They set `_SKIP_AUTH=1`, so every field is visible to anyone on the LAN; adding a field needs a security review. Full contracts: [`reference/overview-splash.md`](reference/overview-splash.md).

### GET `/public/overview.sh`

Projected modem overview for the splash (state, connection, carriers, temperature).

### GET `/public/hostname.sh`

```json
{ "hostname": "QManager" }
```

### GET `/public/units.sh`

The user's display units, so a signed-out visitor sees the modem temperature in their unit.

```json
{ "settings": { "temp_unit": "celsius", "distance_unit": "km" } }
```
Reads UCI `quecmanager.settings.temp_unit` / `distance_unit` and allowlists each value (`celsius|fahrenheit`, `km|miles`); anything else, or a missing section, reads as the default. Zero writes (never seeds the section). Any method other than GET (OPTIONS aside) returns the `method_not_allowed` envelope. Hook: `usePublicUnitPreferences` (`credentials: "omit"`).

---

## Modem Data

### GET `/at_cmd/fetch_data.sh`

Main polling endpoint. Returns the cached modem status JSON (built by `qmanager_poller`).

> ℹ️ NOTE: The response does **not** contain a `traffic` object. Live network traffic (rx/tx speeds) is not collected by the poller or the cache; the former WebSocket bandwidth monitor was retired (see [`docs/features/bandwidth-monitor.md`](features/bandwidth-monitor.md)).

**Response:** Full `ModemStatus` object (see `types/modem-status.ts`)

```json
{
  "timestamp": 1710700000,
  "system_state": "normal",
  "modem_reachable": true,
  "last_successful_poll": 1710700000,
  "errors": [],
  "network": {
    "type": "5G-NSA",
    "sim_slot": 1,
    "carrier": "T-Mobile",
    "service_status": "optimal",
    "ca_active": true,
    "ca_count": 2,
    "nr_ca_active": false,
    "nr_ca_count": 0,
    "total_bandwidth_mhz": 135,
    "bandwidth_details": "B66: 20 MHz + B2: 15 MHz + N41: 100 MHz",
    "apn": "fast.t-mobile.com",
    "wan_ipv4": "10.0.0.1",
    "wan_ipv6": "",
    "primary_dns": "8.8.8.8",
    "secondary_dns": "8.8.4.4",
    "carrier_components": [...]
  },
  "lte": {
    "state": "connected",
    "band": "B66",
    "earfcn": 66486,
    "bandwidth": 20,
    "pci": 123,
    "cell_id": 12345678,
    "enodeb_id": 48225,
    "sector_id": 78,
    "tac": 12345,
    "rsrp": -95,
    "rsrq": -11,
    "sinr": 15,
    "rssi": -65,
    "ta": 3
  },
  "nr": {
    "state": "connected",
    "band": "N41",
    "arfcn": 520110,
    "pci": 456,
    "rsrp": -100,
    "rsrq": -12,
    "sinr": 18,
    "scs": 30,
    "ta": null
  },
  "device": {
    "temperature": 45,
    "cpu_usage": 12,
    "memory_used_mb": 85,
    "memory_total_mb": 256,
    "uptime_seconds": 86400,
    "conn_uptime_seconds": 43200,
    "serving_read_mono": 123456,
    "ca_read_mono": 123450,
    "firmware": "RM520NGLAAR03A04M4GA",
    "build_date": "Jun 25 2025",
    "manufacturer": "Quectel",
    "model": "RM520N-GL",
    "imei": "123456789012345",
    "imsi": "310260123456789",
    "iccid": "89012345678901234567",
    "phone_number": "+15551234567",
    "lte_category": "20",
    "mimo": "LTE 1x4 | NR 2x4",
    "supported_lte_bands": "B1:B2:B3:B5:B7:...",
    "supported_nsa_nr5g_bands": "N41:N71:N77:...",
    "supported_sa_nr5g_bands": "N41:N71:N77:...",
    "supported_nrdc_nr5g_bands": "1:2:3:5:7:8:12:14:25:26:28:30:40:41:48:66:71:77:78:79:257:258:259:260:261"
  },
  "connectivity": {
    "internet_available": true,
    "status": "connected",
    "latency_ms": 34.2,
    "avg_latency_ms": 38.5,
    "min_latency_ms": 22.1,
    "max_latency_ms": 89.3,
    "jitter_ms": 4.8,
    "packet_loss_pct": 0,
    "ping_target": "8.8.8.8",
    "latency_history": [34.2, 36.1, 38.0, ...],
    "history_interval_sec": 5,
    "history_size": 60,
    "during_recovery": false,
    "last_family": "ipv4",
    "dns_lookup_ms": 52,
    "dns_resolver": "10.0.0.1",
    "thresholds": { "latency_ms": 250, "loss_pct": 30 }
  },
  "signal_per_antenna": {
    "lte_rsrp": [-95, -97, -102, null],
    "lte_rsrq": [-11, -12, -13, null],
    "lte_sinr": [15, 14, 12, null],
    "nr_rsrp": [-100, -103, null, null],
    "nr_rsrq": [-12, -13, null, null],
    "nr_sinr": [18, 16, null, null]
  },
  "watchcat": {
    "enabled": true,
    "state": "monitor",
    "current_tier": 0,
    "failure_count": 0,
    "last_recovery_time": null,
    "last_recovery_tier": null,
    "total_recoveries": 0,
    "cooldown_remaining": 0,
    "reboots_this_hour": 0,
    "age_sec": 4,
    "stale_after": 90
  },
  "sim_failover": {
    "active": false,
    "original_slot": null,
    "current_slot": null,
    "switched_at": null
  },
  "sim_swap": {
    "detected": false,
    "matching_profile_id": null,
    "matching_profile_name": null
  }
}
```

`lte.sinr` is in dB. `AT+QENG="servingcell"` reports LTE `<SINR>` as a raw value X from 0 to 25. The poller converts it with the RG520N/RM5xxN AT manual (§5.20) formula `Y = 2X - 20`, which gives -20 to +30 dB. Live checks on an RM551E against `AT+QCAINFO` RSSNR and `AT+QSINR` held from X=8 to X=24. Any raw value outside 0..25, or one that isn't a number (`-`, `-32768`, empty), is published as `null`. `nr.sinr` and the `signal_per_antenna` arrays are already in dB and are passed through unchanged.

`device.serving_read_mono` and `device.ca_read_mono` are the uptime seconds (same clock as `mono`) of the last `AT+QENG` reply carrying `+QENG:` lines and the last `AT+QCAINFO` parse; `0` means never read since the poller started. Age them with `mono - value`; the deep poller tier freezes CA values, so `ca_read_mono` can be hours old. Backs `qmanager_serving_cell_age_seconds` / `qmanager_carrier_components_age_seconds` ([`features/prometheus-metrics.md`](features/prometheus-metrics.md)).

`watchcat.age_sec` is the watchdog daemon's heartbeat age: seconds since it last wrote `/tmp/qmanager_watchcat.json`, as a monotonic delta (poller uptime minus the state file's `mono`, never negative). `watchcat.stale_after` is the daemon's own limit (`3 * check_interval + 60`, or 600 during a long recovery tier). `age_sec > stale_after` means the daemon stopped reporting, and the Watchdog page shows "Not reporting". Both are `null` while the daemon has never reported, and are absent on an older poller (consumers treat that as live). When the state file is gone (daemon stopped) the poller resets the whole block to defaults (`enabled: false`, `state: "disabled"`). `watchcat.state` also takes `"ssr_hold"` and `"radio_off"`. See [`docs/features/connection-watchdog.md`](features/connection-watchdog.md#heartbeat-contract).

`connectivity.status` is `"recovery"` during a watchdog recovery, `"connected"` / `"degraded"` while the internet is reachable, `"disconnected"` when it is not, and `"unknown"` on stale data; `"degraded"` means packet loss is at or above `connectivity.thresholds.loss_pct` (the configured Connection Quality loss cut, default 30 %; it was a fixed 10 % before ledger B2.3). Latency alone never degrades the status. `connectivity.thresholds` is `{ latency_ms, loss_pct }` and is absent on an older poller.

### GET `/at_cmd/fetch_events.sh`

Returns network events as a JSON array. `internet_lost`/`internet_restored` and the latency/loss pairs come from the single detector (one outage logs one lost/restored pair); `ca_change` events are settled and debounced (a one-sample carrier dip logs nothing, a flapping carrier logs one "CA churn detected" warning per episode). See [`docs/features/connection-quality.md`](features/connection-quality.md#one-detector-eventssh).

**Response:**
```json
[
  {
    "timestamp": 1710700000,
    "type": "band_change",
    "message": "LTE band settled on B66 (was B2) (PCI 101)",
    "severity": "info"
  }
]
```

### GET `/at_cmd/fetch_signal_history.sh`

Returns signal history entries as a JSON array.

**Response:**
```json
[
  {
    "ts": 1710700000,
    "lte_rsrp": [-95, -97, -102, null],
    "lte_rsrq": [-11, -12, -13, null],
    "lte_sinr": [15, 14, 12, null],
    "nr_rsrp": [-100, -103, null, null],
    "nr_rsrq": [-12, -13, null, null],
    "nr_sinr": [18, 16, null, null]
  }
]
```

### GET `/at_cmd/fetch_ping_history.sh`

Returns ping history entries as a JSON array.

**Response:**
```json
[
  {
    "ts": 1710700000,
    "lat": 34.2,
    "avg": 38.5,
    "min": 22.1,
    "max": 89.3,
    "loss": 0,
    "jit": 4.8
  }
]
```

### POST `/at_cmd/send_command.sh`

Execute a raw AT command.

**Request:**
```json
{ "command": "AT+QENG=\"servingcell\"" }
```

**Response:**
```json
{ "success": true, "response": "+QENG: \"servingcell\",..." }
```

### POST `/at_cmd/cell_scan_start.sh`

Start the cell scanner worker (`AT+QSCAN=3,1`, 30 to 180 s).

**Response:**
```json
{ "success": true, "pid": 12345 }
```

**Errors:** `already_running` (a cell scan is in flight; the page attaches to it), `other_scan_running` (a neighbour scan holds the modem; never reused as `already_running`, which would attach the page to a run of the other kind), `modem_busy` (`/tmp/qmanager_long_running` set by another long command), `start_failed` (worker missing or died at once).

**Singleton:** both start endpoints share `/tmp/qmanager_scan.lock`. The CGI opens it read-only on fd 7, takes `flock -x -n 7` and spawns the worker, which inherits fd 7, so the lock is held for the worker's run (and any child still on the modem) and released by the kernel on exit or SIGKILL. Acquire-then-spawn is atomic, so two near-simultaneous POSTs cannot both start. The PID files only identify which scan holds the lock (the CGI writes the PID from `$!`; a same-kind start that finds no PID yet re-reads after 0.3 s). Never unlink the lock file while a scan can run.

### GET `/at_cmd/cell_scan_status.sh`

Get cell scan status and results.

**Response:**
```json
{ "status": "idle" }
{ "status": "running" }
{ "status": "complete", "results": [...] }
{ "status": "error", "message": "AT+QSCAN command failed (exit=1)" }
```

The GET is read-only: the error file is not consumed (every poll reports it until the next start clears it), and the result is checked before the error, so a newer result is never hidden by a stale error.

### POST `/at_cmd/neighbour_scan_start.sh` / GET `neighbour_scan_status.sh`

Same pattern and shared lock as the cell scanner (`other_scan_running` while a full sweep runs). The worker reads LTE (`AT+QENG="neighbourcell"`) and NR (`AT+QNWCFG="nr5g_meas_info"`) separately; if one leg fails and the other found no cells it reports an error naming the leg ("Results are incomplete") rather than `complete` with `[]`, and a leg failing with `modem_busy` / `scan_in_progress` is reported as a busy modem. One failed leg with rows from the other still returns those rows.

### POST `/at_cmd/speedtest_start.sh` / GET `speedtest_status.sh` / GET `speedtest_check.sh`

Start speed test, check results, and check if speedtest binary is available.

`speedtest_status.sh` answers `idle`, `running` (`phase` + `progress` line), `complete` (`result`) or `error`. Several pollers can watch one run (the dashboard row and the dialog), so the destructive completion harvest (write `/tmp/qmanager_speedtest_result.json`, remove the output and PID files) runs under an exclusive flock on `/tmp/qmanager_speedtest.lock` (B5.23, ported from the RM520N source; BusyBox `flock` has no `-w`, so it polls `flock -x -n` every 0.2 s for up to 3 s). Invariants: the PID file is removed **last**, inside the lock, so a late poller stays in the harvest branch instead of falling through to `idle`; a poller that waited and finds the PID file gone serves the result the winner wrote (`speedtest_start.sh` clears the result file before every run, so it is this run's); a lock timeout answers `{"status":"running"}` with no `phase`, which `useSpeedtest` treats as "keep the current phase", never an error. A failed harvest is saved as `/tmp/qmanager_speedtest_failed.json` (detail = Ookla's last `"level":"error"` log message from `/tmp/qmanager_speedtest_error`, e.g. "Cannot open socket", else a generic line) and returned to every poller until `speedtest_start.sh` removes it with the other per-run files; before that, only the harvesting poller saw the error and the rest got `idle`. `useSpeedtest` also treats running-then-`idle` as a failure, and ignores non-`running` answers while its start POST is in flight (they describe the previous run).

---

## Cellular Settings

### GET/POST `/cellular/settings.sh`

**GET Response:**
```json
{
  "success": true,
  "mode_pref": "AUTO",
  "nr5g_disable_mode": 0,
  "roam_pref": 255,
  "sim_slot": 1,
  "ambr_dl": "1000",
  "ambr_ul": "500"
}
```

**POST Request:**
```json
{
  "mode_pref": "NR5G",
  "nr5g_disable_mode": 0,
  "roam_pref": 1,
  "sim_slot": 1
}
```

### GET/POST `/cellular/apn.sh`

Single-APN model (slot 1). See [apn-management.md](features/apn-management.md).

**GET Response:**
```json
{
  "success": true,
  "active": 1,
  "active_cid": 1,
  "internet_cid": 1,
  "data_cid_source": "route",
  "apn": { "apn": "fast.t-mobile.com", "pdp_type": "ipv4v6", "cid": 1 },
  "cids": [
    { "cid": 1, "apn": "fast.t-mobile.com", "apn_type": "", "is_internet": true, "activated": true },
    { "cid": 2, "apn": "ims", "apn_type": "ims", "is_internet": false, "activated": true }
  ]
}
```

`data_cid_source` is `route`, `local`, `ipv6_prefix`, `pdp` or `none` (no bearer up; `is_internet` is then false everywhere). `apn_type` is `""`, `"ims"` or `"emergency"`.

**POST Request (save):**
```json
{
  "action": "save",
  "cid": 1,
  "apn": "fast.t-mobile.com",
  "pdp_type": "ipv4v6",
  "allow_carrier_cid": false
}
```
`apn` must match `[A-Za-z0-9._-]`, 1-100 characters (`invalid_value`). `allow_carrier_cid` is required to overwrite an IMS/SOS context (`carrier_cid_protected` otherwise).

**POST Request (deactivate):** `{ "action": "deactivate" }` returns `{ "success": true, "active": 0 }`.

### GET/POST `/cellular/mbn.sh`

**GET Response:**
```json
{
  "success": true,
  "auto_sel": 1,
  "profiles": [
    { "index": 0, "selected": true, "activated": true, "name": "Commercial-TMO", "version": "...", "date": "..." }
  ]
}
```

**POST Actions:** `{"action":"apply_profile","profile_name":"..."}` and `{"action":"auto_sel","auto_sel":0|1}` both return `{"success":true,"reboot_required":true}` (the MBN change needs a reboot; the UI defers it behind a dialog and the deferred-reboot banner); `{"action":"reboot"}` reboots.

### GET/POST `/cellular/imei.sh`

**GET Response:**
```json
{
  "success": true,
  "imei": "123456789012345",
  "backup": { "enabled": true, "imei": "123456789012345" }
}
```

**POST Actions:** `"set_imei"`, `"save_backup"`, `"reboot"`

### GET/POST `/cellular/network_priority.sh`

**GET Response:**
```json
{
  "success": true,
  "mode_pref": "AUTO",
  "nr5g_disable_mode": 0
}
```

### GET/POST `/cellular/fplmn.sh`

**GET Response:**
```json
{
  "success": true,
  "has_entries": true
}
```

**POST Request:**
```json
{ "action": "clear" }
```

### GET/POST `/cellular/sms.sh`

SMS conversations: received messages (ME + SM) plus QManager's own sent log, grouped into threads. Backed by `qsms` (`/usr/bin/qsms`, a symlink to the `qmanager_atd` AT broker, which takes `/var/lock/qmanager.lock` itself for each operation) and, for the provider number, `qcmd` `AT+CSCA`. A busy modem returns `{"success":false,"error":"modem_busy","detail":"Could not acquire AT lock"}`; any other list failure returns `{"success":false,"error":"<code or command_failed>","detail":"..."}`. Full contract, message fields and the sent log: [`docs/features/sms.md`](features/sms.md).

**GET** (inbox):
```json
{
  "success": true,
  "messages": [
    {
      "addr": "+14155550100", "sender": "+14155550100", "content": "Hello",
      "indexes": [0, 1], "index": 0, "storage": "ME",
      "timestamp": "10/18/26 14:03:22", "time": 1792332202,
      "direction": "inbound", "type": 1, "status": "success", "result": 1,
      "identity": "ME0:1792332202",
      "display_name": "+14155550100", "display_source": "raw", "addr_kind": "msisdn"
    }
  ],
  "threads": [
    { "addr": "+14155550100", "sender": "+14155550100", "display_name": "+14155550100",
      "display_source": "raw", "addr_kind": "msisdn", "latestMessage": "Hello", "content": "Hello",
      "timestamp": "10/18/26 14:03:22", "timestampSec": 1792332202, "unreadCount": 0,
      "latestIndex": 0, "direction": "inbound", "type": 1, "status": "success" }
  ],
  "storage": { "used": 3, "total": 255 },
  "smsc": { "addr": "+639180000101", "status": "", "time": "" },
  "unread_total": 0
}
```

Multi-part messages are merged into one entry (`indexes` lists every storage slot so `delete` clears them all). Sent-log records appear in the same list with `storage: "SENT"`, `direction: "outbound"`, `indexes: []`, `index: null`, and `identity` `S<seq>:<time>`. `smsc` is `null` when the modem is busy or the read fails; it never fails the inbox. `unread_total` and `threads[].unreadCount` are always `0`: read state is client-side.

**GET `?addr=<percent-encoded addr>`**: one thread, oldest-first: `{ "success": true, "addr": "...", "count": N, "messages": [...], "has_more": false }`. `before` is ignored. Missing `addr` returns `missing_addr`.

**GET `?action=smsc`**: `{ "success": true, "smsc": { "addr": "+639180000101", "status": "", "time": "" } }`, or `smsc_read_failed`, or `modem_busy`.

**POST (send):**
```json
{ "action": "send", "phone": "+14155551234", "message": "Hello from QManager" }
```

Strips a leading `+` before `qsms send` and does nothing else (no IMSI lookup, no country-code table). The result is appended to the sent log as `success` or `failed`. Failure returns `send_failed` with the `qsms` detail; a busy modem returns `modem_busy`.

**POST (delete modem storage slots):**
```json
{ "action": "delete", "indexes": [0, 1], "storage": "ME" }
```

Indexes are validated as plain non-negative integers and sent in one `qsms delete <storage> i,j,k` call (`storage`: `ME` default or `SM`). Failures return `partial_failure`; busy returns `modem_busy`.

**POST (delete sent-log records):**
```json
{ "action": "delete", "storage": "SENT", "identities": ["S12:1792332202"] }
```

`missing_identities` if the array is absent or empty; a log write failure returns `partial_failure`.

**POST (delete a whole conversation):**
```json
{ "action": "delete", "addr": "+14155550100", "index": "ALL" }
```

Deletes every modem message from `addr` (one `qsms delete` per storage) and the sent records addressed to it. Returns `partial_failure` with a count if any slot fails.

**POST (delete everything):**
```json
{ "action": "delete_all" }
```

Clears ME, SM and the sent log. Failure returns `delete_all_failed` with details `ME: ... | SM: ... | SENT: ...`.

**POST (set provider number):**
```json
{ "action": "set_smsc", "addr": "+639180000101" }
```

Optional leading `+`, then 3 to 20 digits (`invalid_smsc` otherwise). Writes `AT+CSCA="<n>",<145|129>`, requires `OK`, then reads the value back; returns `{ "success": true, "smsc": {...} }`. `smsc_write_failed` if the modem rejects it or the read-back fails.

`mark_read` / `mark_unread` are not actions; read state lives in the browser. Unknown actions return `invalid_action`.

### GET/POST `/cellular/sms_forwarding.sh`

Manages the SMS forwarding daemon (settings + failure state). See [`docs/features/sms-forwarding.md`](features/sms-forwarding.md) for daemon invariants (seed-on-first-run, loop guard, 3-attempt abandon) and the Delivery & Health card derived-state model.

**GET Response:**

```json
{
  "success": true,
  "settings": {
    "enabled": true,
    "target_phone": "14155551234"
  },
  "failures": [
    {
      "sender": "+14155550100",
      "timestamp": "06/07/26 14:33:11",
      "last_error": "send_failed: +CMS ERROR: 500"
    }
  ],
  "failure_count": 1
}
```

`failures` comes from `/tmp/qmanager_sms_forward_failures.json` (capped at 20 entries by the daemon). `failure_count` equals `failures | length`. The UI polls this endpoint every 20 s (silent) to surface background delivery failures.

**POST (`save_settings`):**

```json
{
  "action": "save_settings",
  "enabled": true,
  "target_phone": "+14155551234"
}
```

Phone validation (E.164-ish: optional `+`, first digit 1–9, 7–15 digits) is enforced only when `enabled=true`. On save, UCI is updated, the reload flag `/tmp/qmanager_sms_forward_reload` is touched, and `init.d enable && restart` (or `stop && disable`) is called.

**POST (`clear_failures`):**

```json
{ "action": "clear_failures" }
```

Deletes `/tmp/qmanager_sms_forward_failures.json`. Returns `{ "success": true }`.

**POST (`send_test`):**

```json
{ "action": "send_test" }
```

Reads target from UCI (ignores request body). Single send attempt. Test body: `From QManager: SMS forwarding test`. Returns `{ "success": true }` or `{ "success": false, "error": "send_failed", "detail": "..." }`.

**Error codes:** `invalid_phone`, `missing_action`, `invalid_action`, `send_failed`

---

### POST `/cellular/live_signal.sh?tier=aim|watch`

Renews the real-time signal lease and returns the capability URL of the static file the broker publishes while a lease is fresh. Auth-gated; POST only, no body (the tier is the only input and selects a compiled period: 1000 ms for both `aim` and `watch`; `aim` was 200 ms until 2026-10-23). The page calls it at subscribe, every 5 s and on becoming visible, then polls the returned URL. See [`features/live-signal.md`](features/live-signal.md).

```json
{ "success": true, "available": true, "url": "/qmlive/<64 lowercase hex>.json", "period_ms": 1000, "renew_s": 5, "ttl_s": 10 }
```

`{ "success": true, "available": false }` means the running broker does not advertise `qmi=1` and `live=1` (or `/usr/bin/qmi` is missing); the client stays on the 2 s `status.json` path. No stamp is written in that case. The file at `url` is **unauthenticated by design** (capability token, rotates per lease episode) and identifier-free: `{ v, run, seq, period_ms, qmi_state, ssr_count, scan, samples[] }`, signals as integers x10.

**Error codes:** `bad_tier`, `lease_failed`

---

## Band Locking

See [`docs/features/band-locking.md`](features/band-locking.md) for the full contract, the SA grep-hazard invariant, the SA⇄NR-DC swap UX, and the failover flow.

### GET `/bands/current.sh`

Returns the currently configured (locked) band lists and failover state.

**Response:**
```json
{
  "success": true,
  "current": {
    "lte_bands": "1:3:7:28:41",
    "nsa_nr5g_bands": "41:78",
    "sa_nr5g_bands": "41:78",
    "nrdc_nr5g_bands": "41:78:257"
  },
  "failover": {
    "enabled": true,
    "activated": false
  }
}
```

Source: `AT+QNWPREFCFG="ue_capability_band"` (live, not cached). Empty string means no lock is set for that category (all supported bands allowed).

### POST `/bands/lock.sh`

Lock bands for a single category. One request per card — each category is independent.

**Request:**
```json
{ "band_type": "nrdc_nr5g", "bands": "41:78:257" }
```

- `band_type`: `"lte"` | `"nsa_nr5g"` | `"sa_nr5g"` | `"nrdc_nr5g"`
- `bands`: non-empty colon-delimited band numbers, e.g. `"1:3:7:41"`. Sending an empty or zero value is rejected — there is no "lock zero bands" state. To remove a lock, use `AT+QNWPREFCFG="restore_band"` directly.

**AT parameter mapping:**

| `band_type` | AT parameter |
|---|---|
| `lte` | `lte_band` |
| `nsa_nr5g` | `nsa_nr5g_band` |
| `sa_nr5g` | `nr5g_band` |
| `nrdc_nr5g` | `nrdc_nr5g_band` |

**Response:**
```json
{
  "success": true,
  "band_type": "nrdc_nr5g",
  "bands": "41:78:257",
  "failover_armed": true
}
```

**Error codes:** `no_band_type`, `no_bands`, `invalid_band_type`, `invalid_bands`, `modem_error`, `at_error`

### GET `/bands/failover_status.sh`

Band failover daemon status.

### POST `/bands/failover_toggle.sh`

Enable/disable band failover automation.

---

## Frequency Locking

### GET/POST `/frequency/lock.sh`

**POST Request:**
```json
{
  "earfcn": 66486,
  "pci": 123
}
```

### GET `/frequency/status.sh`

Current frequency lock state.

---

## Tower Locking

### GET/POST `/tower/lock.sh`

**POST Request:**
```json
{
  "lte_pci": 123,
  "nr_pci": 456,
  "lte_earfcn": 66486,
  "nr_arfcn": 520110
}
```

### GET `/tower/status.sh`

Current tower lock state.

### GET/POST `/tower/settings.sh`

Tower locking general settings. Every POST field is optional and an absent one is left alone, so a failover save never touches persistence.

**POST Request** (any subset):
```json
{ "persist_lte": true, "persist_nr": false, "failover_enabled": true, "failover_threshold": 20 }
```

`persist_lte` / `persist_nr` set `AT+QNWLOCK="save_ctrl",<lte>,<nr>` per radio (the other radio's live value is read first and re-sent); `persist` sets both (older clients). The response carries `persist_lte` / `persist_nr` (each radio's value after the call, `null` when persistence was not requested or the modem could not be read) and `persist_command_failed: true` when the write did not land.

### GET `/tower/failover_status.sh`

Tower failover daemon status.

### GET/POST `/tower/schedule.sh`

Scheduled tower lock changes (time-based).

---

## Network Settings

### GET/POST `/network/ethernet.sh`

**GET Response:**
```json
{
  "success": true,
  "link_status": "up",
  "speed": "1000Mb/s",
  "duplex": "full",
  "auto_negotiation": "on",
  "speed_limit": "auto",
  "supports_2500": true,
  "aspm_supported": true,
  "aspm_policy": "performance",
  "aspm_configured": "performance"
}
```
`aspm_policy` is the kernel's live PCIe ASPM policy (the bracketed token in `/sys/module/pcie_aspm/parameters/policy`); `aspm_configured` is UCI `quecmanager.eth_link.aspm_policy`, applied at boot by `qmanager_eth_link` and seeded to `performance` by the installer when absent. Both are `""` when unsupported or unset. Without `eth0` the GET answers `{success:false, error:"interface_not_found"}`.

**POST Request** (at least one field):
```json
{ "speed_limit": "auto", "aspm_policy": "performance" }
```
`speed_limit`: `"auto"`, `"10"`, `"100"`, `"1000"`, `"2500"`. `aspm_policy`: `"default"`, `"performance"`, `"powersave"`, `"powersupersave"`.

ASPM is written synchronously and read back; it never bounces the link. ASPM-only response: `{success:true, apply_in_progress:false, aspm_policy:"<active>"}`. With `speed_limit` the response is `{success:true, apply_in_progress:true, disconnect_window_seconds:5, speed_limit, aspm_policy?}` and the ethtool apply runs in the background (the link renegotiates). Errors: `missing_field`, `invalid_value`, `aspm_unsupported`, `aspm_apply_failed`, `save_failed`, `ethtool_missing`, `interface_not_found`.

### GET/POST `/network/ttl.sh`

**GET Response:**
```json
{
  "success": true,
  "ttl": 65,
  "hl": 65,
  "autostart": true
}
```

**POST Request:**
```json
{ "ttl": 65, "hl": 65 }
```
`0` = disabled.

### GET/POST `/network/mtu.sh`

**GET Response:**
```json
{
  "success": true,
  "mtu": 1500,
  "active": true
}
```

**POST Request:**
```json
{ "mtu": 1500 }
```
`"disable"` POST to remove MTU override.

### GET/POST `/network/dns.sh`

Custom DNS override settings. Auth-gated. See [`docs/features/custom-dns.md`](features/custom-dns.md) for the dual-stack delivery model, odhcpd invariants, and MPDN fragility note.

**GET Response:**

```json
{
  "success": true,
  "mode": "enabled",
  "currentDNS": "1.1.1.1,1.0.0.1",
  "currentDNS6": "2606:4700:4700::1111,2606:4700:4700::1001",
  "nic": "lan"
}
```

- `mode` — `"enabled"` or `"disabled"`, read from `/etc/qmanager/dns_mode`.
- `currentDNS` — comma-joined IPv4 addresses from `dhcp.<nic>.dhcp_option` (the `6,` prefix is stripped). Empty string when no option is set.
- `currentDNS6` — comma-joined IPv6 addresses from `dhcp.lan.dns` (UCI list, space-joined then comma-converted). Empty string when the list is absent.
- `nic` — `"lan"` when no MPDN rule is enabled; `"lan_bind4"` when an MPDN rule with `enabled=1` is present.

**POST Request:**

```json
{
  "mode": "enabled",
  "nic": "lan",
  "dns1": "1.1.1.1",
  "dns2": "1.0.0.1",
  "dns3": "",
  "dns1v6": "2606:4700:4700::1111",
  "dns2v6": "2606:4700:4700::1001"
}
```

- `mode` — required; `"enabled"` or `"disabled"`.
- `nic` — required; `"lan"` or `"lan_bind4"`.
- `dns1`/`dns2`/`dns3` — IPv4 addresses (optional individually, but at least one address across all six fields is required when enabling).
- `dns1v6`/`dns2v6` — IPv6 addresses (optional individually).

**POST Enable Response:**

```json
{ "success": true, "interface": "lan", "dns": "1.1.1.1,1.0.0.1", "dns6": "2606:4700:4700::1111,2606:4700:4700::1001" }
```

- `dns` — comma-joined IPv4 addresses actually applied; empty string if none.
- `dns6` — comma-joined IPv6 addresses actually applied; empty string if none.

**POST Disable Response:**

```json
{ "success": true, "interface": "lan", "dns": "203.0.113.1,203.0.113.2", "dns6": "" }
```

- `dns` — carrier IPv4 addresses read from `/tmp/resolv.conf.d/resolv.conf.auto` (what was restored).
- `dns6` — always `""` on disable; carrier IPv6 is not captured.

**Error Codes:**

| Code | Meaning |
|---|---|
| `invalid_value` | `mode` or `nic` has an unrecognised value |
| `missing_field` | Enabling with no addresses at all |
| `invalid_dns` | IPv4 address fails the dotted-decimal check, or IPv6 address fails the `:` presence + `[0-9a-fA-F:]`-only check |

### GET/POST `/network/ip_passthrough.sh`

IP passthrough mode configuration. Auth-gated. See [`docs/features/ip-passthrough.md`](features/ip-passthrough.md) for the full request/response shapes, apply pipeline, boot parser invariants, and Verizon lock semantics.

### GET `/network/lan_devices.sh`

Lists devices currently visible on the LAN. Auth-gated, **read-only** (GET only — `method_not_allowed` on any other verb). Backs the IP Passthrough "From connected device" MAC picker; does not touch the IPPT apply pipeline, config file, or any AT command. See [`docs/features/ip-passthrough.md`](features/ip-passthrough.md#connected-device-mac-picker) for the DHCP-lease + neigh/ARP merge and the UCI-overridden lease-path gotcha.

**Response:**

```json
{
  "success": true,
  "devices": [
    { "mac": "94:83:c4:a6:ff:8b", "ip": "192.168.225.129", "hostname": "GL-MT6000" }
  ]
}
```

An empty LAN returns `{ "success": true, "devices": [] }` — not an error. `hostname` is `""` when unknown.

### GET/POST `/network/lan_config.sh`

Read or write the LAN bridge (`br-lan`) IPv4 address and subnet. Auth-gated. See [`docs/features/lan-config.md`](features/lan-config.md) for the self-severing apply pattern and validation invariants.

**GET Response:**

```json
{
  "success": true,
  "device": "br-lan",
  "ipaddr": "192.168.1.1",
  "netmask": "255.255.255.0",
  "prefix": 24
}
```

`prefix` is derived from the stored `netmask` by a pure-shell popcount; it is never stored independently.

**POST Request:**

```json
{ "ipaddr": "192.168.2.1", "prefix": 24 }
```

- `ipaddr` — 4 dotted-decimal octets, each 0–255, no leading zeros, first octet 1–223 and not 127 (unicast only).
- `prefix` — integer, **16–30** (enforced). Values outside this range are rejected.

**POST Success Response:**

```json
{
  "success": true,
  "apply_in_progress": true,
  "disconnect_window_seconds": 30,
  "carrier_bounce": true,
  "new_ipaddr": "192.168.2.1",
  "netmask": "255.255.255.0",
  "prefix": 24
}
```

- `disconnect_window_seconds` — **30** when the IP or netmask changed (a carrier bounce follows `network reload`); **5** when the submitted values match UCI exactly (no-op, no bounce).
- `carrier_bounce` — `true` when a physical LAN-port bounce was scheduled (mirrors `disconnect_window_seconds == 30`); `false` on a no-op apply.

> ⚠️ WARNING: This response is emitted **before** the `network reload` fires. Changing the LAN IP severs the serving HTTP connection and makes the old origin unreachable. The frontend hook does not retry — it transitions directly to an applied state and shows a persistent banner with the new address. When `carrier_bounce` is true, the card shows auto-reconnect copy (`lan_config.applied_body_auto`) instead of the manual fallback.

**Error codes:** `invalid_ipaddr`, `invalid_prefix`, `invalid_host_in_subnet` (IP is the network/broadcast address of the resulting subnet), `lan_read_failed`, `lan_save_failed`

---

## Custom Profiles

### GET `/profiles/list.sh`

```json
{
  "success": true,
  "profiles": [
    {
      "id": "abc123",
      "name": "T-Mobile Optimized",
      "active": true,
      "created_at": 1710700000
    }
  ]
}
```

### GET `/profiles/get.sh?id=abc123`

Full profile details including APN, TTL/HL, and optional IMEI.

### POST `/profiles/save.sh`

Create or update a profile.

### POST `/profiles/delete.sh`

```json
{ "id": "abc123" }
```

### POST `/profiles/apply.sh`

Start the 3-step async apply process.

```json
{ "id": "abc123" }
```

### GET `/profiles/apply_status.sh`

```json
{
  "success": true,
  "status": "running",
  "step": 2,
  "total_steps": 3,
  "message": "Applying TTL/HL settings..."
}
```

Status values: `"idle"`, `"running"`, `"complete"`, `"error"`

### POST `/profiles/deactivate.sh`

Deactivate the currently active profile.

### GET `/profiles/current_settings.sh`

Get current modem settings for pre-filling profile creation forms.

---

## Connection Scenarios

### GET `/scenarios/list.sh`

List all saved connection scenarios (preset templates).

### POST `/scenarios/save.sh`

Create or update a scenario.

### POST `/scenarios/delete.sh`

Delete a scenario.

### POST `/scenarios/activate.sh`

Activate a scenario (applies it as a profile).

### GET `/scenarios/active.sh`

Get the currently active scenario.

---

## Monitoring

### GET/POST `/monitoring/alerts.sh`

Unified endpoint for the centralized Alerts page — replaces the four retired endpoints `monitoring/email_alerts.sh`, `monitoring/sms_alerts.sh`, `monitoring/email_alert_log.sh`, `monitoring/sms_alert_log.sh` (deleted; actively removed from installed devices on upgrade). See [`docs/features/alerts.md`](features/alerts.md) for the routing/capability model, the poller-sourced detection engine, and the rc-contract between the engine and the channel libs.

**GET Response:**
```json
{
  "success": true,
  "channels": {
    "sms": {
      "enabled": true,
      "recipient_phone": "14155551234",
      "threshold_minutes": 5,
      "configured": true
    },
    "email": {
      "enabled": true,
      "sender_email": "alerts@gmail.com",
      "recipient_email": "admin@example.com",
      "app_password_set": true,
      "threshold_minutes": 5,
      "msmtp_installed": true,
      "configured": true
    }
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
    { "epoch": 1737100000, "cause": "user" }
  ]
}
```
`email.app_password_set` is a boolean — the cleartext password is never returned by GET.

`reboots` is the device's recent-reboot history — read from the shared `/etc/qmanager/crash.log` ledger, newest-first, capped at 10, `cause` one of `"watchdog"` / `"user"` / `"unplanned"`. It is populated independently of `routing.events.reboot` — every real reboot is recorded here whether or not the reboot alert itself is routed to any channel. See [`docs/features/alerts.md`](features/alerts.md#reboot-alerts).

**POST (save settings)** — writes SMS + email + routing in one atomic call:
```json
{
  "action": "save_settings",
  "sms":   { "enabled": true, "recipient_phone": "+14155551234", "threshold_minutes": 5 },
  "email": { "enabled": true, "sender_email": "alerts@gmail.com", "recipient_email": "admin@example.com",
             "app_password": "xxxx xxxx xxxx xxxx", "threshold_minutes": 5 },
  "routing": {
    "events": {
      "connection_lost":     { "sms": true, "email": false },
      "connection_restored": { "sms": true, "email": true },
      "reboot":              { "sms": false, "email": false }
    }
  }
}
```
Validation notes:
- `recipient_phone` accepts E.164 with or without a leading `+`; the CGI strips a leading `+` exactly once before writing `sms_alerts.json` — **storage and GET responses always return raw digits**. The send path passes the value verbatim to `qsms send`.
- `threshold_minutes` is **one value shared by both channels** (the single alert wait, UCI `quality_thresholds.alert_after_min`). GET reports that wait as each channel's `threshold_minutes`. On POST, a channel that omits it keeps the current wait; if both are posted, the last one that differs from the current wait wins. Range is `1..60`. The CGI writes the UCI key (creating the section if absent) and mirrors the value into both channel files. See [`docs/features/alerts.md`](features/alerts.md#one-alert-wait-for-every-channel).
- `app_password` is only sent when the user typed a new one; an empty/omitted value preserves the currently-stored password.
- `routing.events.connection_lost.email` is **always clamped to `false` server-side** regardless of what is posted — email cannot deliver while the internet is down. This is the capability layer, not a routing preference; see the feature doc.
- `routing.events.reboot.sms`/`.email` default to `false` (not `true`) when omitted or `null` — unlike the other two events, `reboot` is opt-in. Both cells are otherwise unclamped (both channels are genuinely capable, since the alert only ever sends post-recovery).

**POST (send test):**
```json
{ "action": "send_test", "channel": "sms" }
```
`channel` is `"sms"` or `"email"`. Requires that channel be `enabled` (not just filled in). SMS failures return `"error":"send_failed"` with detail `"SMS send failed — check logread for details"`; full context is logged via `qlog_error`.

**POST (mailer lifecycle):**
```json
{ "action": "install" }
{ "action": "install_status" }
{ "action": "uninstall" }
```
`install` installs `msmtp` via `opkg` in the background (poll with `install_status`). `uninstall` is refused with `"error":"still_enabled"` while email alerts are still enabled.

**POST (merged activity log):**
```json
{ "action": "get_log" }
```
Response:
```json
{
  "success": true,
  "entries": [
    {
      "timestamp": "2026-04-10 15:27:04",
      "trigger": "Connection down 5m 2s",
      "status": "sent",
      "recipient": "14155551234",
      "channel": "sms"
    }
  ],
  "total": 3
}
```
Merges both channels' NDJSON logs, tags each entry with `channel: "sms"|"email"`, sorts by timestamp, returns newest-first, capped at 100. `recipient` mirrors the stored form (SMS: raw digits, no leading `+`).

---

### GET/POST `/monitoring/watchdog.sh`

Connection Watchdog settings and live state. Authoritative contract, invariants and the daemon behind it: [`docs/features/connection-watchdog.md`](features/connection-watchdog.md#cgi-envelope).

**GET Response:**
```json
{
  "success": true,
  "settings": {
    "enabled": true,
    "fail_threshold": 5,
    "check_interval": 10,
    "cooldown": 60,
    "tier1_enabled": true,
    "tier2_enabled": true,
    "tier3_enabled": false,
    "tier4_enabled": true,
    "backup_sim_slot": null,
    "max_reboots_per_hour": 3,
    "quality_enabled": false,
    "quality_consecutive": 5,
    "ssr_aware": true,
    "ssr_grace": 45,
    "primary_recheck_enabled": false,
    "primary_recheck_interval": 30
  },
  "probe_profile": "relaxed",
  "interval_override": null,
  "effective_interval": 5,
  "interval_sec": 5,
  "fail_secs": 15,
  "recover_secs": 10,
  "quality_thresholds": { "latency_ms": 250, "loss_pct": 30, "latency_preset": "tolerant", "loss_preset": "tolerant" },
  "status": {
    "timestamp": 1737158400, "mono": 5230, "stale_after": 90,
    "enabled": true, "state": "monitor", "current_tier": 0, "failure_count": 0,
    "last_recovery_time": null, "last_recovery_tier": null, "total_recoveries": 0,
    "cooldown_remaining": 0, "sim_failover_active": false,
    "original_sim_slot": null, "current_sim_slot": null,
    "reboots_this_hour": 1, "quality_breach_count": 0, "quality_enabled": false,
    "last_recovery_reason": "unreachable", "ssr_hold": false, "last_ssr_detected": null
  },
  "sim_failover": { "active": false },
  "sim_swap": { "detected": false },
  "auto_disabled": false,
  "recent_reboots": [1737158400, 1737150000]
}
```

- `status` is the raw daemon state file, `{}` when the daemon is not running (the file is removed when it exits). `status.mono` and `status.stale_after` are the heartbeat. The page reads the liveness verdict from the poller's `status.json` `.watchcat.age_sec` / `.stale_after`, not from this payload.
- `recent_reboots`: epoch seconds of the watchdog's own Tier 4 reboots from `/etc/qmanager/crash.log` (`tier4_escalation` rows only), newest first, at most 5, `[]` on any problem or when the ledger is absent. Epochs from a clockless (1970) boot can appear; consumers ignore values at or below 1600000000.
- `sim_failover` is the raw `/tmp/qmanager_sim_failover` record, `{ "active": false }` when absent. Besides `active`, `original_slot`, `current_slot`, `switched_at`, `reason`, `original_iccid` and `current_iccid` it can carry `confirmed: false` (written right after a Tier 3 swap, before the cooldown judged it) and `revert_pending: true` (a swap-back deferred because the radio was off).
- Bad input degrades instead of failing: a state file that is 0 bytes, half-written or not an object yields `"status": {}`; a garbage failover or swap file yields their defaults; a non-numeric UCI value (for example `cooldown=abc`) falls back to its default. The GET still returns `success: true`.

**GET while the daemon is silent** (enabled, but it stopped writing, or was killed and left a stale file): `status` keeps the last write, so `status.mono` stops advancing. Liveness is judged from the poller (`watchcat.age_sec > watchcat.stale_after`), and the Watchdog page shows "Not reporting":
```json
{
  "success": true,
  "settings": { "enabled": true, "...": "..." },
  "status": { "timestamp": 1737150000, "mono": 4100, "stale_after": 90, "enabled": true, "state": "monitor", "...": "..." },
  "sim_failover": { "active": false },
  "auto_disabled": false,
  "recent_reboots": []
}
```

**POST** `{ "action": "save_settings" | "dismiss_sim_swap" | "revert_sim", ... }`.

`save_settings` writes only the keys present in the body (an absent key, `backup_sim_slot` included, is left untouched) and accepts `probe_interval` (int 1-60, written to `ping_profile.interval_override` only when it changed; ledger U4.6). The key set is `enabled`, `fail_threshold`, `check_interval`, `cooldown`, `tier1_enabled`..`tier4_enabled`, `backup_sim_slot`, `max_reboots_per_hour`, `quality_enabled`, `quality_consecutive`, `ssr_aware`, `ssr_grace`, `primary_recheck_enabled`, `primary_recheck_interval`, `probe_profile`, `interval_override`, `probe_interval`. A save commits UCI, touches the daemon's reload flag and starts the daemon only if it is not already running. **It no longer restarts a running daemon**: the daemon reloads the settings within one `check_interval`.

```json
{ "success": true }
```

`dismiss_sim_swap` and `revert_sim` also return `{ "success": true }` (`revert_sim` adds a `message`). `revert_sim` queues the user's request; the daemon acts on it when it is idle (not mid-recovery, locked, radio off or holding for an SSR).

A rejected value returns HTTP 200 with the `invalid_field` envelope (`reason`, not `detail`) and discards everything the request had staged in UCI:

```json
{ "success": false, "error": "invalid_field", "field": "fail_threshold", "reason": "must be integer 1-20" }
```

Ranges: `fail_threshold` 1-20, `check_interval` 5-60, `cooldown` 10-300, `max_reboots_per_hour` 1-10, `backup_sim_slot` 1 or 2 (JSON `null` clears), `quality_consecutive` 1-60, `ssr_grace` 10-120, `primary_recheck_interval` 5-1440 minutes, `probe_interval` 1-60, `interval_override` 1-60 (`null` clears), `probe_profile` one of `sensitive`/`regular`/`relaxed`/`quiet`. Other errors use the standard `cgi_error` envelope (`missing_action`, `unknown_action`, `method_not_allowed`).

### GET/POST `/monitoring/sites.sh`

Sites monitor: per-site TCP-handshake latency from the `qmanager_sites` daemon, with history and a live "Now" mode. Full contract, buckets and invariants: [`docs/features/sites-monitor.md`](features/sites-monitor.md).

**GET** `?range=now|1h|3h|6h|12h|24h|7d|30d|90d` (default `24h`; anything else → `invalid_range`). `range=now` renews the live lease (only while enabled), reads no history and returns `series: []`.

```json
{
  "success": true,
  "enabled": true,
  "interval_sec": 300,
  "checked_at": 1760000000,
  "next_check_at": 1760000300,
  "checking": false,
  "live_at": null,
  "wans": ["cellular"],
  "summary": { "answered": 12, "total": 13 },
  "sites": [
    { "host": "google.com", "label": "google.com", "kind": "site",
      "latest": { "ts": 1760000000, "ms": 41.3, "ok": true, "wan": "cellular" },
      "series": [ { "ts": 1759998000, "ms": 43.1, "min": 38.2, "max": 61.0, "n": 4, "ok": 4 } ] }
  ]
}
```

`ms` is `null` for no answer; `latest` is `null` for a configured site not swept yet; `live_at` is set only on `range=now` with a live sample at most 6 s old.

**POST** `{"action":"check_now"}` (also `?action=check_now`) → `{"success":true}`, or `disabled` / `flag_failed`.

**POST** `{"action":"save","enabled":true,"interval_sec":300,"sites":[{"host":"youtube.com","label":"YouTube"}]}` → echoes the saved config `{"success":true,"enabled":…,"interval_sec":…,"sites":[…]}`. `interval_sec` is clamped to 60–3600; at most 32 sites; hosts are lower-cased, validated and deduped; labels are cleaned to printable, cut to 40 and fall back to the host. A bad field → `{"success":false,"error":"invalid_field","field":"sites","reason":"invalid host"}`; write failure → `save_failed`.

### GET `/metrics/prometheus.sh`

Prometheus scrape endpoint. **Not cookie-authenticated**: `Authorization: Bearer <64 lowercase hex>` (UCI `quecmanager.metrics.token`), checked by `api_auth.sh`. Opt-in, off by default. Full contract, metric catalog and data classification: [`features/prometheus-metrics.md`](features/prometheus-metrics.md).

| Case | Response |
|---|---|
| Authenticated | `200`, `Content-Type: text/plain; version=0.0.4; charset=utf-8`, `Cache-Control: no-store`; Prometheus text exposition (all gauges). A missing or stale (> 30 s) snapshot yields only `qmanager_snapshot_up 0`, `qmanager_snapshot_age_seconds` and `qmanager_build_info` |
| Disabled, setup required, missing / malformed / wrong token | `403 Forbidden`, `text/plain`, body `Forbidden`, identical bytes for every reason |
| Any method other than GET | `405`, `Allow: GET`, `text/plain` |

No CORS headers and no JSON envelope. An authenticated scrape renews the poller's scrape hold (`/var/run/qmanager/metrics_scrape`) but does not count as an open browser.

```text
# HELP qmanager_ping_rtt_seconds Latest ping round-trip time.
# TYPE qmanager_ping_rtt_seconds gauge
qmanager_ping_rtt_seconds 0.0342
```

### GET/POST `/monitoring/prometheus.sh`

Settings for the scrape endpoint (cookie auth). Full contract: [`features/prometheus-metrics.md`](features/prometheus-metrics.md).

**GET** (and the response to every successful POST):

```json
{
  "success": true,
  "settings": { "enabled": true, "freshness": "balanced", "token": "<64 hex or empty>" },
  "endpoint_path": "/cgi-bin/quecmanager/metrics/prometheus.sh",
  "https_port": 443,
  "last_scrape": { "age_seconds": 12, "mode": "balanced" },
  "holding": true,
  "poller": { "adaptive_enabled": true, "tier": "idle" }
}
```

`freshness` is `adaptive`, `balanced` or `realtime`. `last_scrape` is `null` until an authenticated scrape has arrived since boot. `holding` is true while an enabled `balanced`/`realtime` scrape is younger than 120 s. `token` is only ever returned to the signed-in owner.

**POST** `{"action":"save","enabled":true,"freshness":"balanced"}`: enabling with no token generates one first. `{"action":"regenerate_token"}`: only while enabled. Errors: `invalid_json`, `missing_action`, `unknown_action`, `invalid_value` (`detail` = `enabled` / `freshness`), `token_generation_failed`, `save_failed`, `method_not_allowed`.

---

## Device

### GET `/device/about.sh`

Device hardware and firmware information.

---

## System

### GET `/system/logs.sh`

System log output.

### GET/POST `/system/known_sims.sh`

Read or manage the persistent known-SIMs set. The poller fires the "New SIM detected" banner when the inserted SIM's ICCID is **not** in this set. See [`docs/features/known-sims.md`](../features/known-sims.md) for full invariants.

**GET Response:**
```json
{ "success": true, "count": 3 }
```

`count` is the number of distinct ICCIDs currently in the set.

**POST `{"action":"list"}` Response:** identical to GET.

**POST `{"action":"clear"}` Response:**
```json
{ "success": true, "count": 1 }
```

Resets the set to contain only the currently-inserted SIM (read live via `AT+QCCID`). The current SIM is kept so clearing never immediately re-fires the banner. Also removes the stale `/tmp/qmanager_sim_swap_detected` banner flag. If no SIM is readable, the set is emptied (`count: 0`). No reboot.

**Error response (unknown action):**
```json
{ "success": false, "error": "invalid_action", "detail": "Action must be: list or clear" }
```

### GET/POST `/system/ping_profile.sh`

Read or write the ping-daemon sensitivity profile and ICMP probe targets. See [`docs/features/connection-quality.md`](../features/connection-quality.md) for the full apply pipeline, probe mechanics, and reload semantics.

**GET Response:**

```json
{
  "success": true,
  "profile": "relaxed",
  "target_ipv4": "1.1.1.1",
  "target_ipv6": "2606:4700:4700::1111",
  "interval_override": null,
  "effective_interval": 5,
  "interval_sec": 5,
  "fail_secs": 15,
  "recover_secs": 10
}
```

`profile` is one of: `sensitive`, `regular`, `relaxed`, `quiet`. Both GET and POST use the same `target_ipv4`/`target_ipv6` keys — there is no GET/POST asymmetry in this endpoint. `interval_override` is `null` when not set (sole writer: Connection Watchdog). `effective_interval` is the resolved probe interval in seconds. `interval_sec` carries the same value; `fail_secs` and `recover_secs` are the profile's time-to-fail / time-to-recover in seconds. All three are resolved from UCI (`conn_state_cadence`), so they are correct while the ping daemon is stopped.

**POST Request (`action: "save"`):**

```json
{
  "action": "save",
  "profile": "sensitive",
  "target_ipv4": "1.1.1.1",
  "target_ipv6": "2606:4700:4700::1111"
}
```

Targets are bare IPv4/IPv6 literals or hostnames — no URL scheme. The POST does NOT write `interval_override`; that key is owned exclusively by the Connection Watchdog.

**POST Success:**
```json
{ "success": true }
```

Drops `/tmp/qmanager_ping_reload`; the ping daemon re-reads UCI and re-detects IPv6 capability within one probe cycle (≤10 s on `quiet`, ≤1 s on `sensitive`). No reboot.

**Error codes:** `invalid_profile`, `invalid_target`, `missing_action`, `unknown_action`

`invalid_target` is returned when `target_ipv4` or `target_ipv6` fails per-family host validation: empty, >128 chars, interior whitespace, shell/HTML metacharacters, or characters outside the family charset (`[0-9A-Za-z.-]` for IPv4; `[0-9A-Fa-f:.%]` for IPv6).

---

### GET/POST `/system/quality_thresholds.sh`

Read or write the latency and packet-loss event-threshold presets. These control when QManager fires `high_latency` / `high_packet_loss` events into Recent Activities. See [`docs/features/connection-quality.md`](../features/connection-quality.md) for the preset→numeric mapping and the `isDefault` semantics.

**GET Response (section present — user has saved at least once):**

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

**GET Response (no preset stored — factory / never saved):**

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

`isDefault: true` means neither `latency_preset` nor `loss_preset` is stored; the tolerant/tolerant values are the hardcoded fallback, not a stored setting. The UCI section may still exist holding only `alert_after_min`. `alert_after_min` is always present: the single outage wait (minutes) every alert channel uses.

**POST Request (`action: "save"`):**

```json
{
  "action": "save",
  "latency_preset": "standard",
  "loss_preset": "tolerant"
}
```

Each preset is one of: `standard`, `tolerant`, `very-tolerant`. Optional `alert_after_min` (integer 1-60, minutes) sets the single alert wait; absent leaves it unchanged.

**POST Success:**
```json
{ "success": true }
```

Creates the `quality_thresholds` UCI section on first save, then drops `/tmp/qmanager_quality_reload`; the poller re-maps presets to numeric thresholds within one poll cycle. No reboot.

**Error codes:** `invalid_preset`, `invalid_threshold` (bad `alert_after_min`), `missing_action`, `unknown_action`

---

### GET/POST `/system/adaptive_polling.sh`

Read or write the poller's adaptive-backoff settings. Auth-gated. See [`docs/features/adaptive-polling.md`](../features/adaptive-polling.md) for the full tier architecture, apply pipeline, force-tier2 chokepoints, and watchdog dependency invariant.

**GET Response (section present — user has saved at least once):**

```json
{
  "success": true,
  "settings": {
    "enabled": true,
    "active_grace": 20,
    "idle_interval": 15,
    "idle_threshold": 300,
    "deep_idle_interval": 60
  },
  "isDefault": false,
  "tier": "active"
}
```

**GET Response (section absent — factory / never saved):**

Same shape with `"isDefault": true`. The returned `settings` values are the hardcoded defaults, not stored UCI values.

`tier` is read from `.device.poller_tier` in `status.json`; falls back to `"active"` if the cache file is absent. Values: `"active"`, `"idle"`, `"deep"`.

**POST Request (`action: "save"`):**

```json
{
  "action": "save",
  "enabled": true,
  "active_grace": 20,
  "idle_interval": 15,
  "idle_threshold": 300,
  "deep_idle_interval": 60
}
```

- `enabled` — boolean. When `false`, the poller stays at the base 2 s cadence unconditionally.
- `active_grace` — seconds before transitioning from Active to Idle after the last heartbeat. Must be a positive integer.
- `idle_interval` — seconds between AT reads while Idle. Clamped `>= POLL_INTERVAL` (2 s).
- `idle_threshold` — seconds of heartbeat age at which the poller transitions from Idle to Deep.
- `deep_idle_interval` — seconds between AT reads while Deep. Clamped `>= POLL_INTERVAL` (2 s).

**POST Success:**

```json
{ "success": true }
```

Commits UCI and drops `/tmp/qmanager_poller_reload`. The running poller applies the new config within one base cycle (~2 s). No daemon restart, no reboot.

**Error codes:**

| Code | Meaning |
|---|---|
| `missing_action` | `action` field absent |
| `unknown_action` | `action` not `"save"` |
| `invalid_value` | Any numeric field is non-positive, non-integer, or out of range |
| `method_not_allowed` | Request was not GET or POST |

---

### POST `/system/health-check/run.sh`

Start a System Health Check run. Auth-gated, POST only, idempotent. See [`docs/features/system-health-check.md`](features/system-health-check.md).

**Response:** `{ "success": true, "job_id": "20261016-032530-d771", "started_at": 1792139044, "resumed": false }`. `resumed: true` means a run was already live and this POST joined it. A status left at `running` by a dead runner is rewritten to `status: "error"`, `error: "runner exited unexpectedly"` before a new run starts.

**Error codes:** `runner_missing`, `method_not_allowed`.

### GET `/system/health-check/status.sh`

Returns the live status file verbatim: `job_id`, `status` (`running` | `complete` | `complete_no_bundle` | `error`), `started_at`, `finished_at`, `pid`, `summary {pass, fail, warn, skip, total}`, `tests[] {id, category, label, status, duration_ms, detail}` (test status `pending` | `running` | `pass` | `fail` | `warn` | `skip`), `tarball_path`, `tarball_size`, `error`. With no run: `{ "success": true, "status": "none", "tests": [], "summary": {…zeros} }`.

`?test_id=<id>` returns `{ "success": true, "test_id", "output", "truncated" }` with the last 4096 bytes of that check's raw output. **Error codes:** `invalid_test_id`, `no_run`.

### POST `/system/health-check/clear.sh`

Deletes the status file, job directories and bundles. `{ "success": true, "cleared": true }`. **Error codes:** `job_running`, `runner_missing`, `clear_failed`.

### GET `/system/health-check/download.sh?job_id=<id>`

Streams the bundle as `application/gzip` with `Content-Length` and `Content-Disposition: attachment; filename="qmanager-health-check-<job>.tar.gz"`. Errors are JSON: 400 `invalid_job_id`, 404 `bundle_not_found`, 405 `method_not_allowed`; 401 when unauthenticated.

---

### POST `/system/diagnostics.sh`

Generate an on-demand plain-text diagnostics snapshot and return it inline for download. Auth-gated. Only POST is accepted. See [`docs/features/diagnostics.md`](../features/diagnostics.md) for the daemon–CGI contract, redaction invariants, and size-cap behaviour.

**Request:**

```json
{ "action": "capture" }
```

**Success Response:**

```json
{
  "success": true,
  "filename": "/tmp/qmanager_debug_1718300000.txt",
  "content": "===== QManager Debug Report =====\n..."
}
```

`filename` is the full on-device path. `content` is the plain-text report embedded as a JSON string via `jq --rawfile` (no base64). The report is byte-sanitized (non-printable bytes stripped) and capped at ~300 KB. The frontend materializes `content` into a `text/plain` Blob and triggers a browser download.

**Error Codes:**

| Code | Meaning |
|---|---|
| `report_tool_missing` | `/usr/bin/qmanager_debug_report` absent or not executable |
| `capture_failed` | Daemon ran but produced no artifact |
| `unknown_action` | `action` was not `"capture"` |
| `method_not_allowed` | Request was not POST |

---

### GET/POST `/system/ipa_offload.sh`

Read or toggle the boot-enable state of the Realtek r8125 NIC hardware offload (IPA). Auth-gated. The change takes effect only after a reboot — this endpoint never reboots inline. See [`docs/features/diagnostics.md`](../features/diagnostics.md) for the armed-on-reboot design, the `r8125_ioss` service name invariant, and the pessimistic toggle pattern.

**GET Response (`available: true`):**

```json
{ "success": true, "available": true, "enabled": true }
```

**GET Response (`available: false` — NIC absent on this SKU):**

```json
{ "success": true, "available": false, "enabled": false }
```

`available` reflects whether `/etc/init.d/r8125_ioss.init` exists. `enabled` reflects boot-enable state (the `/etc/rc.d/S91r8125_ioss.init` symlink), not whether the module is currently loaded.

**POST Request:**

```json
{ "action": "enable" }
```

Values: `"enable"` or `"disable"`.

**POST Success Response:**

```json
{ "success": true, "enabled": true, "pending_reboot_required": true }
```

`pending_reboot_required` is always `true`. The `stop()` function in the VENDOR init script is a no-op; the module remains loaded until the next reboot. The frontend calls `requestRebootLater("ipa_offload")` to surface the deferred-reboot banner.

**Error Codes:**

| Code | Meaning |
|---|---|
| `not_available` | `r8125_ioss.init` absent — SKU does not have this NIC |
| `invalid_action` | `action` was not `"enable"` or `"disable"` |

### GET/POST `/system/host_at_ports.sh`

Turn the vendor `port-bridged` service on or off. It relays the USB/PCIe host AT ports into the modem's AT engine; QManager itself never uses them (its path is `/dev/smd11`). Off stops an attached host from sending AT commands and sets `/dev/smd7` to `0600`; it does **not** change QManager's own AT speed. Applies immediately and persists across reboots (re-applied at boot by `qmanager_atd`); never reboots. Auth-gated.

**GET / POST Response:**

```json
{ "success": true, "available": true, "enabled": true, "running": true, "pcie": false }
```

`available` is false when `/etc/init.d/port-bridged` is absent (then everything else is false). `enabled` is the saved UCI choice (`quecmanager.ports.host_at`); `running` is the live bridge state; `pcie` is true when `/dev/mhi_ctrl` exists (the host's AT port is the PCIe link).

**POST Request:**

```json
{ "enabled": false }
```

`enabled` must be a JSON boolean.

**Error Codes:**

| Code | Meaning |
|---|---|
| `not_available` | `port-bridged` is absent on this firmware |
| `invalid_value` | `enabled` was not a boolean |
| `apply_failed` | UCI commit failed, or the `at_engine.sh` library is missing |
| `method_not_allowed` | Request was not GET or POST |

---

### GET/POST `/system/web_port.sh`

Read or change the HTTP / HTTPS ports of uhttpd's `main` instance (shared with LuCI, so LuCI moves too). The saved choice is UCI `quecmanager.web.http_port` / `https_port`. A POST that changes the ports is **self-severing**: it validates, saves UCI, replies first, then runs `qmanager_web_port apply` detached about 1 s later, which restarts uhttpd and rolls back to the old ports by itself if uhttpd cannot bind the new ones. Never reboots. No firewall change. Auth-gated. SSH twin: `qmanager_web_port`. See [`features/web-port.md`](features/web-port.md).

**GET Response:**

```json
{
  "success": true,
  "http_port": 80,
  "https_port": 443,
  "listening": { "http": true, "https": true },
  "last_result": { "status": "applied", "http_port": 80, "https_port": 443, "at": 1792398830 }
}
```

`listening` says whether uhttpd is bound to each port now. `last_result` is the outcome of the last apply (`applied` / `unchanged` / `rolled_back` / `failed`, ports it ended on, epoch seconds), or `null` before the first one.

**POST Request:**

```json
{ "http_port": 8080, "https_port": 8443 }
```

Both must be JSON numbers, 1 to 65535, different from each other, and not held by another service.

**POST Response:**

```json
{ "success": true, "apply_in_progress": true, "http_port": 8080, "https_port": 8443 }
```

`apply_in_progress` is `false` when the ports were already in effect (nothing restarts). When `true`, the current connection drops about 1 s later; the frontend moves to the new origin on the same protocol (`lib/web-port.ts`).

**Error Codes:**

| Code | Meaning |
|---|---|
| `invalid_port` | A port is missing, not a number, or outside 1 to 65535 |
| `ports_equal` | HTTP and HTTPS were the same port |
| `port_in_use` | Another service already listens on that port (`detail` names it) |
| `apply_failed` | UCI commit failed, or the `web_port.sh` library is missing |
| `method_not_allowed` | Request was not GET or POST |

---

### GET/POST `/system/settings.sh`

System preferences and scheduled reboot.

**GET Response:**
```json
{
  "success": true,
  "settings": {
    "temp_unit": "celsius",
    "distance_unit": "km",
    "timezone": "UTC0",
    "zonename": "UTC"
  },
  "scheduled_reboot": {
    "enabled": false,
    "time": "04:00",
    "days": [0, 1, 2, 3, 4, 5, 6]
  },
  "device_clock": {
    "epoch": 1792493731,
    "local": "2026-10-20T18:55:31"
  }
}
```

- `device_clock`: the modem's own clock from one `date '+%s %Y-%m-%dT%H:%M:%S'` call, so `epoch` (Unix seconds) and `local` (wall time in the device's TZ) are the same second; their difference is the device's UTC offset. `epoch` is `0` and `local` empty if the clock could not be read. A clock still in 1970 is reported as-is (the UI flags it).

**POST (save_settings):**
```json
{
  "action": "save_settings",
  "temp_unit": "celsius",
  "distance_unit": "km",
  "timezone": "EST5EDT,M3.2.0,M11.1.0",
  "zonename": "America/New_York"
}
```

- `force_tailscale_fixes` was retired: `settings.sh` neither returns nor reads it (an old client that posts it is ignored). The Tailscale fixes are automatic and toggled with `set_net_fixes` on `/vpn/tailscale.sh`.
- `temp_unit`: `"celsius"` or `"fahrenheit"`
- `distance_unit`: `"km"` or `"miles"`
- `hostname`/`timezone`/`zonename`: written to UCI `system.@system[0]`. Handler compares each incoming value to the current UCI value and only writes when changed. When any of these three actually change, the handler backgrounds `/etc/init.d/system reload` to republish `/tmp/TZ`, `/tmp/localtime`, and kernel hostname. When `timezone` or `zonename` changes, it additionally backgrounds `/etc/init.d/cron restart` so busybox crond (which caches TZ at startup) picks up the new zone for `qmanager_scheduled_reboot` entries. Both spawns are fire-and-forget so the HTTP response returns promptly.

**POST (save_scheduled_reboot):**

```json
{
  "action": "save_scheduled_reboot",
  "enabled": true,
  "time": "04:00",
  "days": [0, 1, 2, 3, 4, 5, 6]
}
```

- `days`: array of integers 0-6 (0=Sunday, 6=Saturday)
- Manages cron entries for `/usr/bin/qmanager_scheduled_reboot`
- Config persisted in UCI `quecmanager.settings.sched_reboot_*`

- Low Power Mode was removed: `settings.sh` no longer returns a `low_power` object, and `action: "save_low_power"` is rejected as an unknown action. `install.sh` `retire_low_power()` cleans up upgrades (see [`scheduled-jobs.md`](features/scheduled-jobs.md#retired-low-power-mode)).

### POST `/system/reboot.sh`

Triggers a device reboot. POST-only, no request body required.

**Response:**

```json
{ "success": true }
```

The HTTP response is flushed before the device reboots asynchronously. The connection will drop shortly after.

### GET `/system/config-backup/collect.sh`

Collects the plaintext sections selected by the user, ready for browser-side encryption into a `.qmbackup` file. No crypto runs on the server — the response is plaintext JSON over the localhost HTTP boundary.

**Query parameters:**

- `sections` — comma-separated list of section keys. Valid keys: `sms_alerts`, `alert_routing`, `watchdog`, `network_mode_apn`, `bands`, `tower_lock`, `ttl_hl`, `imei`, `profiles`. Unknown keys return 400.

**Response:**

```json
{
  "schema": 1,
  "header": {
    "magic": "QMBACKUP",
    "version": 1,
    "created_at": "2026-04-13T10:30:00Z",
    "device": {
      "model": "RM520N-GL",
      "firmware": "RM520NGLAAR03A07M4G",
      "imei": "860000000000000",
      "qmanager_version": "0.1.16"
    },
    "sections_included": ["network_mode_apn", "bands"]
  },
  "payload": {
    "schema": 1,
    "sections": {
      "network_mode_apn": { /* section-specific shape */ },
      "bands": { /* section-specific shape */ }
    }
  }
}
```

The browser uses the `header` as the canonical Associated Data when encrypting `payload`, then writes the result into a `.qmbackup` envelope. The CGI emits a `config_backup_collected` event on successful return.

**Error responses:**

- `400 {"error":"no_sections_selected"}` — empty or missing `sections` query param
- `400 {"error":"unknown_section","key":"<key>"}` — unrecognized section key
- `500 {"error":"collect_fragment_invalid"}` — pre-flight `jq -e` validation of the assembled `SECTIONS_JSON` failed (a section's `collect_*` function emitted invalid JSON)
- `500 {"error":"collect_failed","key":"<key>"}` — a section's collect function returned non-zero

### POST `/system/config-backup/apply.sh`

Accepts a decrypted backup payload and spawns the detached `qmanager_config_restore` worker. POST-only.

**Request body:** the plaintext `payload` object from a successfully-decrypted `.qmbackup` file:

```json
{
  "schema": 1,
  "sections": {
    "network_mode_apn": { ... },
    "bands": { ... }
  }
}
```

- Body size cap: **256 KiB** (enforced via `CONTENT_LENGTH` inspection before reading stdin)
- `Content-Type` must be `application/json`
- All section keys must be in the known-keys list

**Success response (202):**

```json
{ "status": "started", "job_id": "1712990400" }
```

The worker is spawned via double-fork (no `setsid` on OpenWRT). The frontend should immediately begin polling `apply_status.sh` at 500ms.

**Error responses:**

- `405 {"error":"method_not_allowed"}` — non-POST request
- `415 {"error":"unsupported_content_type"}` — Content-Type not `application/json`
- `413 {"error":"payload_too_large"}` — body exceeds 256 KiB
- `400 {"error":"invalid_json"}` — body is not parseable JSON
- `400 {"error":"wrong_schema"}` — `schema != 1`
- `400 {"error":"unknown_section","key":"<key>"}` — unrecognized section key in payload
- `400 {"error":"no_sections"}` — payload `sections` object is empty
- `409 {"error":"restore_in_progress","pid":<n>}` — concurrency guard (worker PID file alive)

### GET `/system/config-backup/apply_status.sh`

Returns the current restore progress JSON. Cheap; safe to poll at 500ms.

**Response (idle):**

```json
{ "status": "idle" }
```

**Response (running / done / cancelled):**

```json
{
  "job_id": "1712990400",
  "status": "running",
  "started_at": 1712990400,
  "completed_at": null,
  "sections": [
    { "key": "sms_alerts", "status": "success", "attempts": 1, "message": "" },
    { "key": "bands", "status": "retrying:2", "attempts": 2, "message": "" },
    { "key": "imei", "status": "pending", "attempts": 0, "message": "" }
  ],
  "summary": null,
  "reboot_required": false
}
```

**Section status values:** `pending`, `running`, `retrying:N` (N is the retry attempt number, 1-3), `success`, `failed`, `skipped:incompatible`, `skipped:not_in_backup`, `skipped:sim_mismatch`.

**Final-state fields:** when `status` becomes `done` or `cancelled`, `completed_at` is set and `summary` is populated:

```json
{
  "summary": { "success": 5, "failed": 1, "skipped": 1 },
  "reboot_required": true
}
```

`reboot_required` is `true` if any applied section queued a reboot-pending change (IMEI write or profile activation). The frontend uses this to show the post-restore "Reboot now or later" dialog.

### POST `/system/config-backup/apply_cancel.sh`

Signals the running worker to cancel after the current section completes. POST-only.

**Response:**

```json
{ "status": "cancel_requested" }
```

Writes `/tmp/qmanager_config_restore.cancel` as a sentinel. The worker checks this file between sections and exits cleanly with `final_status: "cancelled"`. **Cannot abort mid-section** — AT commands and applier functions run to completion. The cancel is best-effort.

**Error responses:**

- `405 {"error":"method_not_allowed"}` — non-POST request (important: a stray authenticated GET would otherwise silently abort a running restore)

---

## DPI Settings

The DPI Settings page manages two features through a single CGI endpoint: **Video Optimizer** (SNI splitting for video throttle bypass) and **Traffic Masquerade** (fake TLS ClientHello with spoofed SNI). Both share the nfqws binary and kernel module but run as separate nfqws instances on different NFQUEUE numbers.

### GET `/network/video_optimizer.sh`

Read video optimizer settings and service status.

**Response:**
```json
{
  "success": true,
  "enabled": true,
  "status": "running",
  "uptime": "2h 34m",
  "packets_processed": 48291,
  "domains_loaded": 22,
  "binary_installed": true,
  "kernel_module_loaded": true
}
```

Status values: `running`, `stopped`, `restarting`, `error`

### GET `/network/video_optimizer.sh?section=masquerade`

Read traffic masquerade settings and service status.

**Response:**
```json
{
  "success": true,
  "enabled": true,
  "status": "running",
  "uptime": "1h 12m",
  "packets_processed": 15320,
  "sni_domain": "speedtest.net",
  "binary_installed": true,
  "kernel_module_loaded": true
}
```

Status values: `running`, `stopped`

### GET `/network/video_optimizer.sh?action=verify_status`

Poll verification test progress/results.

**Response (running):**
```json
{"success": true, "status": "running"}
```

**Response (complete):**
```json
{
  "success": true,
  "status": "complete",
  "timestamp": "2026-03-24T14:30:00Z",
  "without_bypass": {"speed_mbps": 2.4, "throttled": true},
  "with_bypass": {"speed_mbps": 47.2, "throttled": false},
  "improvement": "19.7x"
}
```

### GET `/network/video_optimizer.sh?action=install_status`

Poll nfqws installation progress/results.

**Response (idle — no install started):**
```json
{"success": true, "status": "idle"}
```

**Response (running):**
```json
{"success": false, "status": "running", "message": "Downloading zapret v69...", "detail": ""}
```

**Response (complete):**
```json
{"success": true, "status": "complete", "message": "nfqws installed successfully", "detail": "v69"}
```

**Response (error):**
```json
{"success": false, "status": "error", "message": "Binary not found in archive", "detail": "No nfqws for linux-arm64 in tarball"}
```

### POST `/network/video_optimizer.sh`

**Save video optimizer settings:**
```json
{"action": "save", "enabled": true}
```

**Save traffic masquerade settings:**
```json
{"action": "save_masquerade", "enabled": true, "sni_domain": "speedtest.net"}
```

- `enabled` (boolean, required): Enable or disable traffic masquerade.
- `sni_domain` (string, optional): Domain to spoof in fake TLS ClientHello. Must contain at least one dot, max 253 characters. Defaults to `speedtest.net` if not provided.

Saving masquerade settings restarts the entire `qmanager_dpi` service (both instances) to apply changes.

**Start verification:**
```json
{"action": "verify"}
```

**Install nfqws binary** (downloads from zapret GitHub releases):
```json
{"action": "install"}
```

Returns `{"success": true, "status": "started"}` if the installer was spawned, or `{"success": true, "status": "running"}` if an install is already in progress. Poll `?action=install_status` for progress.

---

## VPN

### GET/POST `/vpn/tailscale.sh`

Tailscale VPN status and configuration. Full contract: [`docs/features/tailscale-vpn.md`](features/tailscale-vpn.md).

**GET — tiered response by install/daemon state:**

| Condition | Key fields returned |
|---|---|
| Install or update running | `installed:true`, `busy` (`"install"` or `"update"`), nothing else |
| Not installed | `installed:false`, `other_vpn_installed`, `other_vpn_name` |
| Installed, daemon stopped | `installed:true`, `daemon_running:false`, `version`, `install_variant`, `enabled_on_boot`, `latest_version`, `update_available`, `legacy_build`, `net_fixes_enabled` |
| Daemon running | All of the above + `backend_state`, `exit_node_advertised`, `ssh_enabled`, `auth_url`, `self`, `tailnet`, `peers`, `health` |

`install_variant` — `"official"` (QManager static tarball from pkgs.tailscale.com), `"tiny"` (iamromulan's opkg `tailscale-tiny`, installed as-is) or `"opkg"` (any other opkg Tailscale). The marker file `/etc/tailscale/.qm_install_method` is authoritative; the opkg info file is the fallback. `legacy_build` is `true` only for `opkg`. `install_hint` and `install_variants` are gone.

`tiny_available` (every non-busy tier) — the firmware already trusts the Tiny build's signed feed (feed line, usign key, `check_signature`, arch `aarch64_cortex-a53`). Gates the install card's source picker.

`latest_version` comes from the cache only (the GET never fetches); `update_available` is `true` on an official or Tiny install with a newer cached version of that source (Tiny compares package versions, so `-rN` rebuilds count). `net_fixes_enabled` is UCI `quecmanager.tailscale_net.enabled` (default on), omitted on Tiny, whose package owns its own network setup.

`exit_node_advertised` — boolean derived from `.Self.ExitNodeOption` in `tailscale status --json`. Present on the Tier-3 (daemon running) response only.

`ssh_enabled` — boolean from tailscaled's `RunSSH` pref (`tailscale debug prefs`), or `null` when the prefs can't be read. Tier-3 only.

**POST actions:**

| Action | Required fields | Notes |
|---|---|---|
| `install` | `source` (optional; `"official"` default, or `"tiny"`; `variant` accepted as an alias) | Background; poll `install_status`. Other values return `invalid_variant`; `"tiny"` without `tiny_available` returns `feed_unavailable` |
| `install_status` | — | Returns `/tmp/qmanager_tailscale_install.json` (`status`, `message`, `detail?`, `error?`, `op`) plus `log` (last 50 lines of `/var/run/qmanager/tailscale_install.log`) |
| `check_update` | `force` (bool, optional) | Returns `{installed_version, latest_version, update_available, checked_at}`. Cached 6 h (30 min back-off after a failed check); `force` always asks the installed source (pkgs.tailscale.com, or the Tiny feed index). `opkg` returns `legacy_build` |
| `update` | — | Official and Tiny. Background; poll `install_status` (`op:"update"`). Official stages, swaps, restarts; Tiny upgrades through opkg and restores the boot-enable choice; both health-check and roll back on failure |
| `set_net_fixes` | `enabled` (bool) | Writes UCI `quecmanager.tailscale_net.enabled`, returns `{success, enabled}`, then applies or tears down the fw4 zone and the pref-1990 routing rule in the background. `not_applicable` on an installed Tiny build |
| `connect` | — | Orphaned double-fork `tailscale up --accept-dns=false --json`; also re-asserts the routing rule |
| `disconnect` | — | `tailscale down`; stays registered |
| `logout` | — | `tailscale logout`; removes device from tailnet |
| `start_service` | — | Starts `tailscaled`; re-asserts the routing rule |
| `stop_service` | — | Stops `tailscaled` |
| `set_boot_enabled` | `enabled` (bool) | Writes `tailscale.settings.service_enabled` + `init.d enable/disable` |
| `set_exit_node` | `enabled` (bool) | `tailscale set --advertise-exit-node=<bool>`; requires `BackendState=="Running"` |
| `set_ssh` | `enabled` (bool) | `tailscale set --ssh=<bool>`; requires `BackendState=="Running"` |
| `uninstall` | — | Method-aware: tarball path removes binaries + init.d + rc.d + UCI + `/etc/config/tailscale`; opkg path uses smart 6-package removal (Tiny also drops the `network.tailscale` interface its init created and `/etc/config/tailscale`). Network fixes are torn down after the response |

**Install / update progress shape** (polled via `install_status`):

```json
{ "success": true, "status": "running", "message": "Downloading Tailscale 1.104.1...", "op": "update" }
```

Terminal `status` values: `"complete"` (with a `"variant"` field) or `"error"` (with `"detail"` and an `"error"` code from the table below). `op` is `"install"` or `"update"`.

**Error codes:**

| Code | Action(s) | Meaning |
|---|---|---|
| `library_missing` | any | `tailscale_mgr.sh` / `tailscale_net.sh` not installed |
| `invalid_variant` | install | `variant` present but not `"official"` |
| `other_vpn_installed` | install | NetBird is installed |
| `already_running` | install, update, start_service | A worker holds the lock / daemon already up |
| `already_installed` | install | Binaries already present |
| `not_installed` | any post-install action | Tailscale not installed |
| `migration_in_progress` | all mutating | Install/update lock held by a live process |
| `legacy_build` | update | Install is the legacy `tiny`/`opkg` build; uninstall and reinstall |
| `up_to_date` | update | No newer version |
| `update_check_failed` | check_update, install, update | pkgs.tailscale.com unreachable or format changed |
| `insufficient_space` | install, update | Not enough RAM to stage or flash to swap |
| `unsupported_arch` | install, update | Device is not aarch64 |
| `checksum_mismatch` | install, update | sha256 missing or does not match (fail closed) |
| `install_failed`, `update_failed` | install, update | Generic worker failure |
| `update_rolled_back` | update | New build failed its health check; the old version was restored |
| `daemon_start_failed` | connect | Daemon did not start within 5 s |
| `auth_timeout` | connect | No auth URL appeared within 10 s |
| `disconnect_failed` | disconnect | `tailscale down` non-zero exit |
| `logout_failed` | logout | `tailscale logout` non-zero exit |
| `start_failed` | start_service | Daemon not running after start |
| `missing_field` | set_boot_enabled, set_exit_node, set_ssh, set_net_fixes | Required field absent |
| `no_init_script` | set_boot_enabled | `/etc/init.d/tailscale` absent |
| `invalid_value` | set_boot_enabled, set_exit_node, set_ssh, set_net_fixes | Field present but wrong type/value |
| `save_failed` | set_net_fixes | `uci commit quecmanager` failed |
| `not_connected` | set_exit_node, set_ssh | Daemon not running or `BackendState != "Running"` |
| `set_failed` | set_exit_node, set_ssh | `tailscale set` non-zero exit |
| `uninstall_failed` | uninstall | Binary still present after removal |
