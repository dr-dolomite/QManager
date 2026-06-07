# SMS Forwarding & Call Forwarding

SMS Forwarding automatically relays every new incoming SMS to a configured phone number. Call Forwarding (unconditional) redirects all incoming calls at the network level. Both features live under `/cellular/sms/forwarding` in the SMS Center sub-route.

## Quick Reference

| Item | Value |
|---|---|
| SMS Forwarding CGI | `GET/POST /cgi-bin/quecmanager/cellular/sms_forwarding.sh` |
| Call Forwarding CGI | `GET/POST /cgi-bin/quecmanager/cellular/call_forwarding.sh` |
| SMS Forward daemon | `/usr/bin/qmanager_sms_forward` |
| SMS Forward init.d | `/etc/init.d/qmanager_sms_forward` (procd, `START=99`, `STOP=10`) |
| Shared AT lock | `/var/lock/qmanager.lock` |
| UCI — SMS Forwarding | `quecmanager.sms_forwarding.{enabled,target_phone}` |
| UCI — Call Forwarding | `quecmanager.call_forwarding.last_number` |
| Daemon PID file | `/tmp/qmanager_sms_forward.pid` |
| Daemon seen-set | `/tmp/qmanager_sms_forward_seen` |
| Daemon failures file | `/tmp/qmanager_sms_forward_failures.json` |
| Daemon reload flag | `/tmp/qmanager_sms_forward_reload` |
| Poll interval | 15 s |
| Reboot | Never |

---

## SMS Forwarding

### How It Works

`qmanager_sms_forward` is a procd-managed daemon that wakes every 15 seconds, reads the modem inbox (ME + SM, identical to `sms.sh`), and forwards each message it has not yet seen to the configured number in the format `From <sender>: <body>`. The daemon sends outbound SMS via `sms_tool -d /dev/smd11` under the same `flock`-based shared lock used by `sms.sh` and `qcmd` — it is the **only** server-side inbox reader in the project. Read state everywhere else (the inbox UI tab) is entirely client-side; see [`docs/features/sms.md`](sms.md).

The init.d script uses `USE_PROCD=1` for automatic respawn (`3600 5 5`). The service is **UCI-gated**: `start_service()` reads `quecmanager.sms_forwarding.enabled` and returns early if it is not `1`, so enabling the init.d service on its own does nothing — UCI must also be set. For this reason the daemon is listed in `UCI_GATED_SERVICES` in `install.sh` and is **not** auto-enabled on install.

`stop_service()` removes all five `/tmp/qmanager_sms_forward_*` files. This means a disable-then-re-enable cycle wipes the seen-set, causing the daemon to re-seed from the current inbox on next start (see Seed-on-First-Run below).

### Invariant — Seed-on-First-Run

When `/tmp/qmanager_sms_forward_seen` is absent (daemon first start, or after a stop/disable), the daemon creates the file empty and calls `process_cycle 1` — a special pass that records every currently-present inbox fingerprint **without forwarding anything**. Only messages that appear in later poll cycles are relayed.

**Why:** Without this guard, enabling forwarding on a device that already has 50 messages in its inbox would immediately spray all 50 to the target number. The seen-file absence is the trigger — its presence (even empty) means seeding is complete.

### Invariant — Loop Guard

Before forwarding any message, the daemon calls `sf_is_relay()` to check whether the content matches the relay format `From <number>: <body>` (optional `+`, then digits only, then `: `). If it matches, the message is marked seen but **not forwarded**.

**Why:** If the target number can itself receive and store SMS (e.g., another SIM in the same modem or a forwarding chain), the relay message would appear as a new inbox entry and trigger another forward cycle. The loop guard cuts this immediately.

### Invariant — 3-Attempt Abandon, Feature Stays Enabled

A forward attempt that fails re-checks modem registration (`AT+CREG?` / `AT+CGREG?`, via `qcmd`) before each of the three tries, waits 5 seconds between attempts, and on exhaustion:

1. Marks the message seen (no further retry).
2. Appends a failure record to `/tmp/qmanager_sms_forward_failures.json` (capped at 20 entries, oldest dropped on overflow).
3. Continues running — the feature is **not** disabled.

The UI reads the failures list and shows a persistent warning badge and alert. Clearing failures from the UI sends `action=clear_failures`, which deletes the file. There is no "paused" state — the daemon is either enabled or disabled.

### Invariant — djb2 Fingerprint Is Internal-Only

The daemon fingerprints each message as `djb2(storage|sender|timestamp|content)` using raw UTF-8 byte values via BusyBox awk. The frontend read-state hook uses the same djb2 algorithm but iterates UTF-16 code units via `charCodeAt`. For ASCII messages the two produce the same numeric value; for non-ASCII (emoji, CJK, etc.) they diverge.

**Why this is safe:** The daemon seen-set (`/tmp/qmanager_sms_forward_seen`) never crosses the wire and is never compared against the frontend's `localStorage` set. All that matters for dedup is that the daemon produces a **stable hash for the same message across cycles** — which it does, because BusyBox awk consistently iterates raw bytes. The frontend uses its own fingerprints independently for the inbox read/unread display.

### Phone Number Handling

Outbound sends use the same convention as `sms.sh`: the daemon strips a single leading `+` from `SF_TARGET` before passing it to `sms_tool`. The validation rule (E.164-ish: optional `+`, first digit 1–9, 7–15 digits total) is applied both in the CGI (at save time, when `enabled=1`) and in the daemon (each cycle, before forwarding). A temporarily invalid number causes the daemon to idle rather than exit.

The test-send action (`action=send_test`) reads the **configured target from UCI directly** — it ignores any number in the POST body. This ensures the test verifies the actual forwarding path.

### CGI Contract (`cellular/sms_forwarding.sh`)

**GET**

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

`failures` is the raw content of `/tmp/qmanager_sms_forward_failures.json` (an array, capped at 20 entries); `failure_count` is `failures | length`.

**POST actions**

| Action | Required fields | Notes |
|---|---|---|
| `save_settings` | `enabled` (bool/0/1), `target_phone` (when `enabled=true`) | Validates phone only when enabling. Writes UCI, touches reload flag, calls `init.d enable && restart` (or `stop && disable`). |
| `clear_failures` | — | Deletes `/tmp/qmanager_sms_forward_failures.json`. Returns `{success:true}`. |
| `send_test` | — | Reads target from UCI. Single attempt. Test message body: `From QManager: SMS forwarding test`. Returns `{success:true}` or `{success:false,error,detail}`. |

**Error codes:** `invalid_phone`, `missing_action`, `invalid_action`, `send_failed`

---

## Call Forwarding

### How It Works

Call forwarding is purely network-level, with no daemon. The CGI issues `AT+CCFC` (3GPP supplementary service, reason 0 = unconditional, voice class) via `qcmd`. `qcmd` echoes the command line before the modem response; the echo line contains `CCFC=` (with equals), so anchoring the status parse on `+CCFC:` (with colon) safely skips it.

`quecmanager.call_forwarding.last_number` is written to UCI on a successful `set` so the UI can prefill the input field on next visit. It is a UI convenience only — the modem and the carrier network are the source of truth for whether forwarding is active and to which number.

### Invariant — CME-Error-Is-a-State Contract

The GET handler checks the network-rejection path **before** it tries to parse any `+CCFC:` status line. A response containing `+CME ERROR: 257` or the string `"network rejected"` returns:

```json
{ "success": false, "error": "cf_network_rejected" }
```

at HTTP 200. This is a **first-class UI state** — the call forwarding card renders a distinct "not supported on this network" message rather than a generic failure alert.

**Why:** `+CME ERROR: 257` is the standard supplementary-service rejection code emitted when the carrier's network doesn't permit the handset to query or control call forwarding (common on MVNOs and some IoT data plans). On the GLOBE test SIM this is the only response to `AT+CCFC=0,2`. Treating it as a generic AT error would show a broken card; treating it as a known state lets the UI explain the situation accurately.

Other AT errors with no `+CCFC:` line in the response return `error: "cf_query_failed"`. The `set` and `disable` POST actions also check for `cf_network_rejected` before the `OK` check.

### AT Command Map

| Operation | AT command | Notes |
|---|---|---|
| Query status | `AT+CCFC=0,2` | Reason 0 = unconditional. Returns one `+CCFC:` line per active class. |
| Set forwarding | `AT+CCFC=0,3,"<number>"` | Mode 3 = register + activate. |
| Disable forwarding | `AT+CCFC=0,0` | Mode 0 = disable. |

`+CCFC:` response format: `+CCFC: <status>,<class>[,"<number>",<type>]`. The CGI iterates all lines and sets `active=true` as soon as it finds status `1`. The number is extracted from the first double-quoted token on any active line.

### CGI Contract (`cellular/call_forwarding.sh`)

**GET — success**

```json
{
  "success": true,
  "supported": true,
  "active": false,
  "number": "",
  "last_number": "14155551234"
}
```

`number` is the network-reported forwarding number when `active=true`; empty otherwise. `last_number` is the UCI-persisted value for prefill.

**GET — carrier rejection (HTTP 200)**

```json
{ "success": false, "error": "cf_network_rejected" }
```

**GET — modem/AT error**

```json
{ "success": false, "error": "cf_query_failed" }
```

**POST `action=set`**

```json
{ "action": "set", "number": "+14155551234" }
```

Success:

```json
{ "success": true, "active": true, "number": "+14155551234" }
```

**POST `action=disable`**

```json
{ "action": "disable" }
```

Success:

```json
{ "success": true, "active": false }
```

**Error codes:** `cf_network_rejected`, `cf_set_failed`, `invalid_phone`, `missing_action`, `invalid_action`

---

## Frontend

| Artifact | Path |
|---|---|
| Hook — SMS Forwarding | `hooks/use-sms-forwarding.ts` |
| Hook — Call Forwarding | `hooks/use-call-forwarding.ts` |
| Page | `app/cellular/sms/forwarding/page.tsx` |
| Forwarding center | `components/cellular/sms/forwarding/forwarding-center.tsx` |
| SMS Forwarding card | `components/cellular/sms/forwarding/sms-forwarding-card.tsx` |
| Call Forwarding card | `components/cellular/sms/forwarding/call-forwarding-card.tsx` |

### `useSmsForwarding`

Fetches settings and failure state on mount, then polls every **20 seconds** (silent, does not show a spinner) so a background failure surfaces without a manual refresh. The daemon itself polls every 15 s — the 20 s UI poll adds a one-cycle lag at most. Exports: `data`, `isLoading`, `isSaving`, `isSendingTest`, `isClearing`, `error`, `saveSettings`, `sendTest`, `clearFailures`, `refresh`.

### `useCallForwarding`

Fetches live state once on mount. `CallForwardingStatus` has five values: `active`, `inactive`, `network_rejected`, `query_failed`, `unknown`. The hook maps `cf_network_rejected` and `cf_query_failed` backend error codes directly to typed status values rather than to the `error` string — this lets the card render an informative state banner instead of a generic error. Exports: `state`, `isLoading`, `isSaving`, `error`, `setForwarding`, `disableForwarding`, `refresh`.

---

## Error Codes

| Code | Meaning |
|---|---|
| `cf_network_rejected` | Carrier/network rejected the `AT+CCFC` command (`+CME ERROR: 257`). This is a carrier limitation, not a modem fault. |
| `cf_query_failed` | Modem returned a generic AT error when querying call-forwarding state. |
| `cf_set_failed` | Modem returned an error when trying to set or disable call forwarding. |
| `invalid_phone` | Phone number failed E.164-ish validation (optional `+`, first digit 1–9, 7–15 total digits). |
| `send_failed` | SMS test send via `sms_tool` failed. Check `logread` for full context. |

See [`docs/features/error-codes.md`](error-codes.md) for the full error vocabulary and the `resolveErrorMessage` resolution contract.

---

## Related Features

- [`docs/features/sms.md`](sms.md) — `sms_tool` binary, `/dev/smd11` invariant, shared lock contract, inbox CGI, client-side read/unread state. The daemon in this feature is the only **server-side** inbox consumer — everything else is client-side.
- [`docs/features/error-codes.md`](error-codes.md) — `resolveErrorMessage`, `errors.json` namespace, adding new error codes.
