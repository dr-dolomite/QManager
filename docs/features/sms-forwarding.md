# SMS Forwarding

SMS Forwarding automatically relays every new incoming SMS to a configured phone number. The feature lives under `/cellular/sms/forwarding` in the SMS Center sub-route. Call Forwarding (previously here under the same route) was removed; all the `AT+CCFC` content that was in this doc no longer applies.

## Quick Reference

| Item | Value |
|---|---|
| CGI | `GET/POST /cgi-bin/quecmanager/cellular/sms_forwarding.sh` |
| Daemon | `/usr/bin/qmanager_sms_forward` |
| init.d | `/etc/init.d/qmanager_sms_forward` (procd, `START=99`, `STOP=10`) |
| Transport | `qsms` (`list all`, `send`); the AT broker holds `/var/lock/qmanager.lock` itself |
| UCI — enabled | `quecmanager.sms_forwarding.enabled` |
| UCI — target | `quecmanager.sms_forwarding.target_phone` |
| Daemon PID file | `/var/run/qmanager/sms_forward.pid` (root-only run dir, B5.13) |
| Daemon seen-set | `/var/run/qmanager/sms_forward_seen` (root-only run dir, B5.13) |
| Daemon failures file | `/tmp/qmanager_sms_forward_failures.json` (written atomically; the CGI shows it only when root-owned) |
| Daemon reload flag | `/tmp/qmanager_sms_forward_reload` |
| Poll interval | 15 s |
| Reboot | Never |

---

## How It Works

`qmanager_sms_forward` is a procd-managed daemon that wakes every 15 seconds, reads the modem inbox with one `qsms list all` (ME + SM, each message tagged with its storage), and forwards each message it has not yet seen to the configured number in the format `From <sender>: <body>`. The daemon sends outbound SMS via `qsms send`; the broker (`qmanager_atd`) takes the shared AT lock itself, so the daemon never wraps `qsms` in `flock`. It is the **only** server-side inbox reader in the project. Read state everywhere else (the SMS Center) is entirely client-side; see [`docs/features/sms.md`](sms.md).

The init.d script uses `USE_PROCD=1` for automatic respawn (`3600 5 5`). The service is **UCI-gated**: `start_service()` reads `quecmanager.sms_forwarding.enabled` and returns early if it is not `1`, so enabling the init.d service on its own does nothing — UCI must also be set. For this reason the daemon is listed in `UCI_GATED_SERVICES` in `install.sh` and is **not** auto-enabled on install.

`stop_service()` removes the pid file and seen-set under `/var/run/qmanager/`, plus the `/tmp/qmanager_sms_forward*` reload, seen, pid and failures files (and the `.tmp` leftover). This means a disable-then-re-enable cycle wipes the seen-set, causing the daemon to re-seed from the current inbox on next start (see Seed-on-First-Run below).

---

## Invariants

### Seed-on-First-Run

When `/var/run/qmanager/sms_forward_seen` is absent (daemon first start, or after a stop/disable), the daemon creates the file empty and calls `process_cycle 1` — a special pass that records every currently-present inbox fingerprint **without forwarding anything**. Only messages that appear in later poll cycles are relayed.

**Why:** Without this guard, enabling forwarding on a device that already has 50 messages in its inbox would immediately spray all 50 to the target number. The seen-file absence is the trigger — its presence (even empty) means seeding is complete.

**Failed reads:** if `qsms list all` fails (modem busy, scan in progress), the daemon logs it and skips the cycle (`process_cycle` returns 1), so a busy modem is never mistaken for an empty inbox. During initial seeding, a failed read deletes the just-created empty seen-file so the next cycle re-seeds. **Why:** otherwise the empty seen-file would mark seeding complete and the next successful read would forward the whole existing inbox.

### Loop Guard

Before forwarding any message, the daemon calls `sf_is_relay()` to check whether the content matches the relay format `From <number>: <body>` (optional `+`, then digits only, then `: `). If it matches, the message is marked seen but **not forwarded**.

**Why:** If the target number can itself receive and store SMS (e.g., another SIM in the same modem or a forwarding chain), the relay message would appear as a new inbox entry and trigger another forward cycle. The loop guard cuts this immediately.

### 3-Attempt Abandon, Feature Stays Enabled

A forward attempt that fails re-checks modem registration (`AT+CREG?` / `AT+CGREG?`, via `qcmd`) before each of the three tries, waits 5 seconds between attempts, and on exhaustion:

1. Marks the message seen (no further retry).
2. Appends a failure record to `/tmp/qmanager_sms_forward_failures.json` (capped at 20 entries, oldest dropped on overflow).
3. Continues running — the feature is **not** disabled.

There is no "paused" state — the daemon is either enabled or disabled.

### djb2 Fingerprint Is Internal-Only

The daemon fingerprints each message as `djb2(storage|sender|timestamp|content)` using raw UTF-8 byte values via BusyBox awk. The frontend read-state hook uses the same djb2 algorithm but iterates UTF-16 code units via `charCodeAt`. For ASCII messages the two produce the same numeric value; for non-ASCII (emoji, CJK, etc.) they diverge.

**Why this is safe:** The daemon seen-set (`/var/run/qmanager/sms_forward_seen`) never crosses the wire and is never compared against the frontend's `localStorage` set. All that matters for dedup is that the daemon produces a **stable hash for the same message across cycles** — which it does, because BusyBox awk consistently iterates raw bytes. The frontend uses its own fingerprints independently for the SMS Center read/unread display.

### Phone Number Handling

Outbound sends use the same convention as `sms.sh`: the daemon strips a single leading `+` from `SF_TARGET` before passing it to `qsms send`. The validation rule (E.164-ish: optional `+`, first digit 1–9, 7–15 digits total) is applied both in the CGI (at save time, when `enabled=1`) and in the daemon (each cycle, before forwarding). A temporarily invalid number causes the daemon to idle rather than exit.

The test-send action (`action=send_test`) reads the **configured target from UCI directly** — it ignores any number in the POST body. This ensures the test verifies the actual saved forwarding path.

---

## CGI Contract (`cellular/sms_forwarding.sh`)

### GET

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

`failures` is the raw content of `/tmp/qmanager_sms_forward_failures.json` (an array, capped at 20 entries); `failure_count` is `failures | length`.

### POST actions

| Action | Required fields | Notes |
|---|---|---|
| `save_settings` | `enabled` (bool/0/1), `target_phone` (when `enabled=true`) | Validates phone only when enabling. Writes UCI, touches reload flag, calls `init.d enable && restart` (or `stop && disable`). |
| `clear_failures` | — | Deletes `/tmp/qmanager_sms_forward_failures.json`. Returns `{success:true}`. |
| `send_test` | — | Reads target from UCI — ignores request body. Single attempt. Test message body: `From QManager: SMS forwarding test`. Returns `{success:true}` or `{success:false,error,detail}`. |

**Error codes:** `invalid_phone`, `missing_action`, `invalid_action`, `send_failed`

---

## Frontend Architecture

| Artifact | Path |
|---|---|
| Hook | `hooks/use-sms-forwarding.ts` |
| Page | `app/cellular/sms/forwarding/page.tsx` |
| Forwarding center | `components/cellular/sms/forwarding/forwarding-center.tsx` |
| Control card | `components/cellular/sms/forwarding/sms-forwarding-card.tsx` |
| Status card | `components/cellular/sms/forwarding/delivery-health-card.tsx` |
| Shared shapes | `components/cellular/sms/forwarding/shapes.ts` |

### Lifted-Hook Architecture

`forwarding-center.tsx` owns the single `useSmsForwarding()` call and passes the result down as a `fwd` prop to both cards. This means there is one fetch/poll loop and one source of truth — both cards stay in sync without independent polling.

**Layout.** Control first, report second: `SmsForwardingCard` (the left card CONTROLS the relay) leads and `DeliveryHealthCard` (the right card REPORTS on it) follows. They sit side by side at `@3xl/main` (`CARD_GRID` in `forwarding/shapes.ts`, a container query against `@container/main`, never a viewport breakpoint) and stack below it with the control card on top. `CARD_CELL` pins both cards to the row height, so a card whose data has not landed is not shorter. A failed first read (`!isLoading && !data`) replaces both cards with one destructive `ConditionScreen` with Retry, rather than two copies.

**Shared shapes.** `components/cellular/sms/forwarding/shapes.ts` holds the family's geometry once (`CARD_GRID`, `CARD_CELL`, `CARD_SHELL`, `CARD_FOOT_GUTTER`, the form and `HEALTH_*` skeleton and block constants), and the loaded view and its skeleton both read it, so a skeleton never restates a number. It is scoped to this folder; the SMS Center (a two-pane conversation UI, see [`sms.md`](sms.md)) shares nothing with it. Both cards use `rounded-card`, not `rounded-hero`, because two co-equal height-locked peers means neither anchors the page.

`useSmsForwarding` fetches settings and failure state on mount, then polls every **20 seconds** (silent, does not show a spinner) so a background delivery failure surfaces without a manual refresh. The daemon polls every 15 s — the 20 s UI poll adds a one-cycle lag at most. Exports: `data`, `isLoading`, `isSaving`, `isSendingTest`, `isClearing`, `error`, `saveSettings`, `sendTest`, `clearFailures`, `refresh`.

**Mutator contract.** `saveSettings`, `sendTest` and `clearFailures` return `SmsForwardingResult = { ok: true } | { ok: false; error: string }`; `error` is already resolved through `resolveErrorMessage` with `sms.forwarding.errors.*` fallbacks. Handlers toast the returned reason; hook `error` state is the read error only, and silent poll failures never clobber a working view.

### `sms-forwarding-card.tsx` — Control Card

Enable `SegmentedField` (On/Off) + destination number (with a `HintIcon` explaining the relay format) + a `CardFoot` carrying the unsaved status, Discard (ghost) and `SaveButton` last. This card intentionally holds no status display, no test button, and no failure history — those moved to `delivery-health-card.tsx`.

One behavioral invariant: phone validation is gated on `isEnabled`. Turning forwarding **off** is never blocked by a stale or invalid number left in the field.

### `delivery-health-card.tsx` — Delivery & Health Card

A single derived health state drives the entire card:

| Health state | Condition |
|---|---|
| `active` | `enabled=true`, `target_phone` set, no failures |
| `issue` | `enabled=true`, `target_phone` set, at least one failure in the failure file |
| `unconfigured` | `enabled=true`, `target_phone` empty |
| `off` | `enabled=false` |

The state drives one **focal health block** at the top of the card, the single status surface for the feature (deliberately no second header chip, because two indicators for one fact can disagree during a poll). The block is a tonal container plus disc resolved through `HEALTH_TONE` to `CONDITION_TONE`, with one glyph per state because the success and warning containers are 1.03:1 apart and the glyph is the only separation: `active` `check_circle`, `issue` `warning`, `unconfigured` `edit`, `off` `do_not_disturb_on`. Its detail line shows the destination number (mono, an opaque string) for `active`/`issue`, or a short explanation for `off`/`unconfigured`. `role="status"` is scoped to this block only: the hook rebuilds its data object every 20 s poll, so a page-root live region would announce on a loop.

**Recipient preview:** a static bubble showing `From +15550142: <sample body>` teaches the relay format. The sample sender is a placeholder (the recipient's number is not the sender, it is the destination), and a `HintIcon` beside the preview label says so rather than leaving the bubble to imply the number is real.

**Send test:** lives in the card's `CardFoot` (a `tonal-neutral` operational action), active only when `enabled=true` and `target_phone` is non-empty. The CGI reads the target from UCI, not from the request body — the test verifies the actual saved path, not whatever is currently in the control card's input field.

**Delivery failures:** a destructive `TonalBanner` (`role="alert"`) titled with the live count, listing up to 5 recent entries (sender, timestamp, last error); a `tonal-neutral` Clear button below it calls `action=clear_failures`. When no failures are present, a quiet row (`done_all` glyph, no container) says there are no delivery problems. The empty state is quiet on purpose: the fill is saved for the row that needs finding.

---

## Error Codes

| Code | Meaning |
|---|---|
| `invalid_phone` | Phone number failed E.164-ish validation (optional `+`, first digit 1–9, 7–15 total digits). |
| `send_failed` | SMS test send via `qsms send` failed. The message is `<code>: <detail>` from `qsms`. Full context is in the QManager tab of the Logs page. |
| `missing_action` | POST body did not include an `action` field. |
| `invalid_action` | POST `action` value is not one of the three recognized strings. |

See [`docs/features/error-codes.md`](error-codes.md) for the full error vocabulary and the `resolveErrorMessage` resolution contract.

---

## Related Features

- [`docs/features/sms.md`](sms.md) — `qsms` transport, `/dev/smd11` invariant, broker-owned lock contract, conversation CGI, sent log, alert library, client-side read/unread state. The daemon in this feature is the only **server-side** inbox consumer — everything else is client-side.
- [`docs/features/error-codes.md`](error-codes.md) — `resolveErrorMessage`, `errors.json` namespace, adding new error codes.
