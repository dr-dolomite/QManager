# QManager API Reference

Complete reference for all CGI endpoints. All endpoints are under `/cgi-bin/quecmanager/`.

All authenticated endpoints require a valid `qm_session` cookie (auto-sent by the browser). A `401` response means the session is expired or missing.

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

Check if first-time setup is required and rate limit status.

**Response:**
```json
{
  "setup_required": true,
  "rate_limited": false,
  "retry_after": 0
}
```

### POST `/auth/login.sh`

Login or first-time password setup.

**Login Request:**
```json
{ "password": "user_password" }
```

**Setup Request (first-time):**
```json
{ "password": "new_password", "confirm": "new_password" }
```

**Success Response:**
```json
{ "success": true }
```
Sets `qm_session` (HttpOnly) and `qm_logged_in=1` cookies.

**Error Response:**
```json
{
  "success": false,
  "error": "invalid_password",
  "detail": "Invalid password",
  "retry_after": 30
}
```

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

---

## Modem Data

### GET `/at_cmd/fetch_data.sh`

Main polling endpoint. Returns the cached modem status JSON (built by `qmanager_poller`).

> ℹ️ NOTE: The response does **not** contain a `traffic` object. Live network traffic (rx/tx speeds) is served only by the opt-in WebSocket bandwidth monitor on port 8838, not by the poller cache. When the monitor is off, the dashboard shows a prompt to enable it. See [`docs/features/bandwidth-monitor.md`](../features/bandwidth-monitor.md).

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
    "during_recovery": false
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
    "reboots_this_hour": 0
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

### GET `/at_cmd/fetch_events.sh`

Returns network events as a JSON array.

**Response:**
```json
[
  {
    "timestamp": 1710700000,
    "type": "band_change",
    "message": "LTE band changed from B2 to B66",
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

Start the cell scanner daemon.

**Response:**
```json
{ "success": true }
```

### GET `/at_cmd/cell_scan_status.sh`

Get cell scan results.

**Response:**
```json
{
  "success": true,
  "status": "complete",
  "cells": [...]
}
```

### POST `/at_cmd/neighbour_scan_start.sh` / GET `neighbour_scan_status.sh`

Same pattern as cell scanner for neighbor cells.

### POST `/at_cmd/speedtest_start.sh` / GET `speedtest_status.sh` / GET `speedtest_check.sh`

Start speed test, check results, and check if speedtest binary is available.

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

**GET Response:**
```json
{
  "success": true,
  "profiles": [
    {
      "cid": 1,
      "apn": "fast.t-mobile.com",
      "pdp_type": "IPV4V6",
      "is_data": true
    }
  ],
  "active_cid": 1
}
```

**POST Request (create/update):**
```json
{
  "action": "set",
  "cid": 1,
  "apn": "fast.t-mobile.com",
  "pdp_type": "IPV4V6"
}
```

**POST Request (delete):**
```json
{
  "action": "delete",
  "cid": 3
}
```

### GET/POST `/cellular/mbn.sh`

**GET Response:**
```json
{
  "success": true,
  "profiles": [
    { "name": "Commercial-TMO", "active": true }
  ],
  "auto_sel": true
}
```

**POST Actions:** `"apply_profile"`, `"auto_sel"`, `"reboot"`

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

SMS inbox and send functionality. Backed by `sms_tool -d /dev/smd11`, serialized against `qcmd`/`atcli_smd11` via the shared `/var/lock/qmanager.lock`. The `-d /dev/smd11` flag is belt-and-suspenders: the patched binary already defaults to `/dev/smd11` and guards termios calls via `isatty()`. See [`docs/features/sms.md`](features/sms.md) for binary patch details and the shared-lock contract.

**GET Response:**
```json
{
  "success": true,
  "messages": [
    {
      "indexes": [0, 1],
      "sender": "+14155550100",
      "content": "Concatenated multi-part message body",
      "timestamp": "25/03/14,15:27:04+08"
    }
  ],
  "storage": {
    "used": 3,
    "total": 25
  }
}
```

Multi-part messages (same sender + reference) are merged into a single entry; `indexes` lists every storage slot so `delete` can clear them all at once.

**POST (send):**
```json
{
  "action": "send",
  "phone": "+14155551234",
  "message": "Hello from QManager"
}
```

Phone-number handling: the endpoint strips a leading `+` before calling `sms_tool` and does nothing else. There is no IMSI lookup, no MCC-to-country-code table, and no local-number rewriting — users are responsible for providing the full international number (with or without a leading `+`).

**POST (delete one or more storage slots):**
```json
{ "action": "delete", "indexes": [0, 1] }
```

**POST (delete everything):**
```json
{ "action": "delete_all" }
```

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
      "last_error": "sms_tool send failed (rc=1)"
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

Tower locking general settings.

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
  "operstate": "up",
  "speed": 1000,
  "duplex": "full",
  "autoneg": "on",
  "speed_limit": "auto"
}
```

**POST Request:**
```json
{ "speed_limit": "auto" }
```
Values: `"auto"`, `"10"`, `"100"`, `"1000"`

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

Custom DNS override settings.

### GET/POST `/network/ip_passthrough.sh`

IP passthrough mode configuration.

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

### GET/POST `/monitoring/email_alerts.sh`

**GET Response:**
```json
{
  "success": true,
  "settings": {
    "enabled": true,
    "sender_email": "alerts@gmail.com",
    "recipient_email": "admin@example.com",
    "app_password_set": true,
    "threshold_minutes": 5
  }
}
```

**POST (save settings):**
```json
{
  "action": "save_settings",
  "enabled": true,
  "sender_email": "alerts@gmail.com",
  "recipient_email": "admin@example.com",
  "app_password": "xxxx xxxx xxxx xxxx",
  "threshold_minutes": 5
}
```
`app_password` only sent when changed. Backend returns `app_password_set: boolean` (never the actual password).

**POST (send test):**
```json
{ "action": "send_test" }
```

### GET `/monitoring/email_alert_log.sh`

```json
{
  "success": true,
  "entries": [
    {
      "timestamp": 1710700000,
      "trigger": "downtime_recovery",
      "status": "sent",
      "recipient": "admin@example.com"
    }
  ],
  "total": 5
}
```

### GET/POST `/monitoring/sms_alerts.sh`

**GET Response:**
```json
{
  "success": true,
  "settings": {
    "enabled": true,
    "recipient_phone": "14155551234",
    "threshold_minutes": 5
  }
}
```

**POST (save settings):**
```json
{
  "action": "save_settings",
  "enabled": true,
  "recipient_phone": "+14155551234",
  "threshold_minutes": 5
}
```

**POST (send test):**
```json
{ "action": "send_test" }
```

Validation notes:
- `recipient_phone` is required when `enabled=true`
- Accepts E.164 format with **or** without a leading `+` on input. The CGI strips a leading `+` exactly once before writing `sms_alerts.json`, so **storage and GET responses always return raw digits**. The send path passes the value verbatim to `sms_tool`.
- `threshold_minutes` range is `1..60`
- Test-send failures return `"error":"send_failed"` with a static `"detail":"sms_tool send failed — check logread for details"`. Full context (modem state, `sms_tool` stderr) is logged via `qlog_error`.

### GET `/monitoring/sms_alert_log.sh`

```json
{
  "success": true,
  "entries": [
    {
      "timestamp": "2026-04-10 15:27:04",
      "trigger": "Connection down 5m 2s",
      "status": "sent",
      "recipient": "14155551234"
    }
  ],
  "total": 3
}
```

Note: `recipient` mirrors the stored form in `sms_alerts.json` — raw digits, no leading `+`.

### GET/POST `/monitoring/bandwidth.sh`

Read and save bandwidth monitor settings. See [`docs/features/bandwidth-monitor.md`](../features/bandwidth-monitor.md) for the full contract.

**GET Response:**
```json
{
  "success": true,
  "settings": {
    "enabled": false,
    "refresh_rate_ms": 1000,
    "ws_port": 8838,
    "interfaces": "br-lan,eth0,rmnet_data0,rmnet_data1,rmnet_ipa0"
  },
  "status": {
    "websocat_running": false,
    "monitor_running": false
  },
  "dependencies": {
    "websocat_installed": true
  }
}
```

**POST (`save_settings`):**
```json
{
  "action": "save_settings",
  "enabled": true,
  "refresh_rate_ms": 1000,
  "ws_port": 8838,
  "interfaces": "br-lan,eth0,rmnet_data0,rmnet_data1,rmnet_ipa0"
}
```

All fields are optional except `action`. Enabling the monitor starts `init.d/qmanager_bandwidth` and its two procd instances (`websocat` + `bridge_traffic_monitor_rm551`). Disabling stops and disables the service.

**Response:** `{ "success": true }`

---

### GET/POST `/monitoring/watchdog.sh`

**GET Response:**
```json
{
  "success": true,
  "enabled": true,
  "state": "monitor",
  "config": {
    "check_interval": 10,
    "suspect_threshold": 3,
    "recovery_timeout": 60,
    "cooldown_period": 120,
    "max_tier": 4,
    "sim_failover_enabled": true,
    "reboot_enabled": true
  },
  "status": {
    "current_tier": 0,
    "failure_count": 0,
    "total_recoveries": 0,
    "reboots_this_hour": 0
  }
}
```

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

Read or write the ping-daemon sensitivity profile and probe targets. See [`docs/features/connection-quality.md`](../features/connection-quality.md) for the full apply pipeline and reload semantics.

**GET Response:**

```json
{
  "success": true,
  "profile": "relaxed",
  "target1": "http://cp.cloudflare.com/",
  "target2": "http://www.gstatic.com/generate_204"
}
```

`profile` is one of: `sensitive`, `regular`, `relaxed`, `quiet`. GET keys are `target1`/`target2` (no underscore).

**POST Request (`action: "save"`):**

```json
{
  "action": "save",
  "profile": "sensitive",
  "target_1": "http://cp.cloudflare.com/",
  "target_2": "http://www.gstatic.com/generate_204"
}
```

POST body keys are `target_1`/`target_2` (with underscore, matching UCI field names).

**POST Success:**
```json
{ "success": true }
```

Drops `/tmp/qmanager_ping_reload`; the ping daemon re-reads UCI within one probe cycle (≤10 s on `quiet`, ≤1 s on `sensitive`). No reboot.

**Error codes:** `invalid_profile`, `invalid_target`, `missing_action`, `unknown_action`

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
  "isDefault": false
}
```

**GET Response (section absent — factory / never saved):**

```json
{
  "success": true,
  "thresholds": {
    "latency": { "preset": "tolerant" },
    "loss": { "preset": "tolerant" }
  },
  "isDefault": true
}
```

`isDefault: true` means the `quecmanager.quality_thresholds` UCI section does not exist; the tolerant/tolerant values are the hardcoded fallback, not a stored setting.

**POST Request (`action: "save"`):**

```json
{
  "action": "save",
  "latency_preset": "standard",
  "loss_preset": "tolerant"
}
```

Each preset is one of: `standard`, `tolerant`, `very-tolerant`.

**POST Success:**
```json
{ "success": true }
```

Creates the `quality_thresholds` UCI section on first save, then drops `/tmp/qmanager_quality_reload`; the poller re-maps presets to numeric thresholds within one poll cycle. No reboot.

**Error codes:** `invalid_preset`, `missing_action`, `unknown_action`

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
| `method_not_allowed` | Request was not GET or POST |

---

### GET/POST `/system/settings.sh`

System preferences, scheduled reboot, and low power mode.

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
  "low_power": {
    "enabled": false,
    "start_time": "23:00",
    "end_time": "06:00",
    "days": [0, 1, 2, 3, 4, 5, 6]
  }
}
```

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

- `temp_unit`: `"celsius"` or `"fahrenheit"`
- `distance_unit`: `"km"` or `"miles"`
- `hostname`/`timezone`/`zonename`: written to UCI `system.@system[0]`. Handler compares each incoming value to the current UCI value and only writes when changed. When any of these three actually change, the handler backgrounds `/etc/init.d/system reload` to republish `/tmp/TZ`, `/tmp/localtime`, and kernel hostname. When `timezone` or `zonename` changes, it additionally backgrounds `/etc/init.d/cron restart` so busybox crond (which caches TZ at startup) picks up the new zone for `qmanager_scheduled_reboot` and `qmanager_low_power` entries. Both spawns are fire-and-forget so the HTTP response returns promptly.

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

**POST (save_low_power):**

```json
{
  "action": "save_low_power",
  "enabled": true,
  "start_time": "23:00",
  "end_time": "06:00",
  "days": [0, 1, 2, 3, 4, 5, 6]
}
```

- Creates two cron entries: `enter` at start_time on selected days, `exit` at end_time on all 7 days
- Exit cron fires on all days to handle overnight windows (e.g., 23:00-06:00) — no-ops if flag absent
- Enables/disables `qmanager_low_power_check` init.d (boot-time window check)
- Disabling while active immediately triggers `qmanager_low_power exit` (restores CFUN=1)

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

- `sections` — comma-separated list of section keys. Valid keys: `sms_alerts`, `watchdog`, `network_mode_apn`, `bands`, `tower_lock`, `ttl_hl`, `imei`, `profiles`. Unknown keys return 400.

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
| Not installed | `installed:false`, `install_hint`, `install_variants:["official","tiny"]` |
| Installed, daemon stopped | `installed:true`, `daemon_running:false`, `version`, `install_variant`, `enabled_on_boot` |
| Daemon running | All of the above + `backend_state`, `exit_node_advertised`, `auth_url`, `self`, `tailnet`, `peers`, `health` |

`install_variant` — `"official"` (QManager static tarball), `"tiny"` (opkg `tailscale-tiny`), or `"opkg"` (pre-marker legacy). The marker file `/etc/tailscale/.qm_install_method` is authoritative; opkg detection is the fallback.

`exit_node_advertised` — boolean derived from `.Self.ExitNodeOption` in `tailscale status --json`. Present on the Tier-3 (daemon running) response only.

**POST actions:**

| Action | Required fields | Notes |
|---|---|---|
| `install` | `variant` (`"official"`\|`"tiny"`, absent→`"tiny"`) | Background; poll `install_status` |
| `install_status` | — | Returns `/tmp/qmanager_tailscale_install.json` |
| `connect` | — | Orphaned double-fork `tailscale up --accept-dns=false --json` |
| `disconnect` | — | `tailscale down`; stays registered |
| `logout` | — | `tailscale logout`; removes device from tailnet |
| `start_service` | — | Starts `tailscaled` |
| `stop_service` | — | Stops `tailscaled` |
| `set_boot_enabled` | `enabled` (bool) | Writes `tailscale.settings.service_enabled` + `init.d enable/disable` |
| `set_exit_node` | `enabled` (bool) | `tailscale set --advertise-exit-node=<bool>`; requires `BackendState=="Running"` |
| `uninstall` | — | Method-aware: tarball path removes binaries + init.d + rc.d + UCI + `/etc/config/tailscale`; opkg path uses smart 6-package removal |

**Install progress shape** (polled via `install_status`):

```json
{ "success": true, "status": "running", "message": "Downloading Tailscale 1.98.4..." }
```

Terminal `status` values: `"complete"` (with `"variant"` field) or `"error"` (with `"detail"` field).

**Error codes:**

| Code | Action(s) | Meaning |
|---|---|---|
| `invalid_variant` | install | `variant` present but not `"official"` or `"tiny"` |
| `other_vpn_installed` | install | NetBird is installed |
| `already_running` | install, start_service | Already in progress / already running |
| `already_installed` | install | Binaries already present |
| `not_installed` | any post-install action | Tailscale not installed |
| `migration_in_progress` | all mutating | `migrate_tailscale_packages` lock held |
| `daemon_start_failed` | connect | Daemon did not start within 5 s |
| `auth_timeout` | connect | No auth URL appeared within 10 s |
| `disconnect_failed` | disconnect | `tailscale down` non-zero exit |
| `logout_failed` | logout | `tailscale logout` non-zero exit |
| `start_failed` | start_service | Daemon not running after start |
| `missing_field` | set_boot_enabled, set_exit_node | Required field absent |
| `no_init_script` | set_boot_enabled | `/etc/init.d/tailscale` absent |
| `invalid_value` | set_boot_enabled, set_exit_node | Field present but wrong type/value |
| `not_connected` | set_exit_node | Daemon not running or `BackendState != "Running"` |
| `set_failed` | set_exit_node | `tailscale set` non-zero exit |
| `uninstall_failed` | uninstall | Binary still present after removal |
