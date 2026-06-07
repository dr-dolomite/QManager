# SMS

The SMS feature exposes a read/send/delete inbox and automated downtime alert notifications over the modem's AT channel (`/dev/smd11`). All modem access is serialized through the shared `flock`-based lock so `sms_tool` calls never race against `qcmd` or `atcli_smd11`.

## Quick Reference

| Item | Value |
|---|---|
| Inbox CGI | `GET/POST /cgi-bin/quecmanager/cellular/sms.sh` |
| Alert config CGI | `GET/POST /cgi-bin/quecmanager/monitoring/sms_alerts.sh` |
| Alert log CGI | `GET /cgi-bin/quecmanager/monitoring/sms_alert_log.sh` |
| Alert library | `/usr/lib/qmanager/sms_alerts.sh` |
| AT channel | `/dev/smd11` |
| Shared lock | `/var/lock/qmanager.lock` |
| Alert config | `/etc/qmanager/sms_alerts.json` |
| Alert log | `/tmp/qmanager_sms_log.json` |
| Binary | `/usr/bin/sms_tool` (patched static armhf build) |
| Storage boot daemon | `/usr/bin/qmanager_sms_storage` (init.d: `/etc/init.d/qmanager_sms_storage`, START=99) |
| Reboot | Never |

## `sms_tool` Binary

The bundled `/usr/bin/sms_tool` is a patched fork of [`obsy/sms_tool`](https://github.com/obsy/sms_tool) (Apache-2.0), statically linked for ARM EABI5. The four patches and the full rebuild recipe are in [`dependencies/README.md`](../../dependencies/README.md). Summary of what changed and why:

1. **Default device is `/dev/smd11`** — upstream defaulted to `/dev/ttyUSB0`, which does not exist on the RM551E. Bare `sms_tool recv` (no `-d` flag) used to segfault; now it works silently.
2. **`isatty()` guard in `setserial()`** — `/dev/smd11` is a Qualcomm SMD char device, not a serial line. Calling `tcgetattr`/`tcsetattr` on it returns `ENOTTY` ("Inappropriate ioctl for device"). The guard makes `setserial()` a no-op on non-TTY devices, eliminating the noise at its source.
3. **`isatty()` guard in `resetserial()`** — same guard on the exit-time termios restore; removes the `failed tcsetattr: Inappropriate ioctl` line on clean exit.
4. **`exit(1)` on open/reopen/fdopen failures** — upstream fell through to `setvbuf(NULL,…)` and SIGSEGV'd. A missing port (`/dev/ttyUSB0` on RM551E) now exits 1 cleanly; the verbose `open()`/`reopen()` traces are gated behind the `-D` debug flag.

**Why `isatty()` and not a compile-time constant:** The device running this binary may expose both SMD and TTY interfaces in edge cases. The runtime check lets the same binary work on both without a rebuild.

**Binary facts:** statically linked (no INTERP segment), ARM EABI5, ~440 KB stripped. Behavior outside the patched paths is unchanged — `-d` overrides the default, `send`/`recv`/`delete`/`status`/`ussd`/`at`, `-j` JSON, and `-D` debug all work as before.

## Wrappers and Defense-in-Depth Noise Filters

Both CGI wrappers still explicitly pass `-d /dev/smd11` and still strip `tcgetattr`/`tcsetattr` lines from `sms_tool` stderr:

- `scripts/www/cgi-bin/quecmanager/cellular/sms.sh` — `_sms_run()` captures stderr to a temp file and filters `^tcgetattr(`, `^tcsetattr(`, and `Inappropriate ioctl for device$` before returning it on failure.
- `scripts/usr/lib/qmanager/sms_alerts.sh` — `_sa_strip_noise()` applies the same three `grep -v` patterns.

**Why these filters still exist:** With the patched binary these filters are no-ops — the binary no longer emits termios noise. They are kept as defense-in-depth pending a cleanup pass. Do not remove them until the binary's `isatty()` behavior has been stable across a few releases.

**Why stderr is not merged with stdout (`2>&1`):** When a `recv -j` response exceeds the ~4 KB stdout block buffer, partial flushes interleave any stderr line into the middle of the JSON stream. A line-based filter then sees JSON bytes glued onto `...Inappropriate ioctl for device` and drops the whole chunk. The wrappers capture stderr to a temp file instead, returning pure stdout on success and clean stderr on failure.

> ℹ️ NOTE: The decision to keep `sms_tool` and harden the binary reversed an earlier direction (started in PR #22) that had begun migrating the SMS read path to a native shell+awk PDU codec (`sms_pdu.awk`). Those native-codec files are not on the current branch. The binary is the canonical read path.

## Shared Lock (`/var/lock/qmanager.lock`)

All `sms_tool` calls run inside a `flock -x` on `/var/lock/qmanager.lock`, the same lock held by `qcmd` and `atcli_smd11`. This prevents concurrent `recv -j` fetches from colliding with poller or watchcat AT calls on `/dev/smd11`.

Both wrappers use a polling fallback loop (`_sms_flock_wait` / `_sa_flock_wait`) with a 10-second timeout because BusyBox `flock` does not support `-w <timeout>`. The lock file is created as an empty file if absent before the `flock` call — `flock` on a non-existent file returns 0 immediately (no lock held), so the creation step is load-bearing.

## SMS Storage Routing (`AT+CPMS`)

`AT+CPMS` controls three independent storage pointers: mem1 (read/delete source), mem2 (send destination), and mem3 (incoming-message routing). On the RM551E the modem defaults mem3 to `SM` (SIM card), so every incoming SMS is written to the SIM rather than modem memory (`ME`). QManager read `ME` exclusively, which meant incoming messages accumulated silently on the SIM card and never appeared in the inbox.

**The fix** is two-pronged: a boot daemon that asserts `AT+CPMS="ME","ME","ME"` at startup, and GET-time self-healing that re-asserts the same routing before and after every fetch.

### `AT+CPMS` mem1/mem2/mem3 model

| Pointer | Controls | QManager target |
|---|---|---|
| mem1 | Storage read/delete operations | `ME` (255 slots) |
| mem2 | Storage used for sent messages | `ME` |
| mem3 | Storage for incoming SMS routing | `ME` |

**Why `ME` and not `SM`:** The SIM card typically has 35 slots. `ME` provides 255 slots and is modem-resident, so it survives SIM swaps. If mem3 stays `SM` and the SIM fills up, the modem silently discards further incoming messages.

### Boot daemon (`qmanager_sms_storage`)

`/usr/bin/qmanager_sms_storage` runs once at boot (init.d START=99). It polls `sms_tool status` under the shared `flock` on `/var/lock/qmanager.lock` until the modem is ready, then sets `AT+CPMS="ME","ME","ME"` and exits. The daemon does not respawn and does not trigger a reboot or `AT+CFUN`.

The matching init.d script (`/etc/init.d/qmanager_sms_storage`) uses `#!/bin/sh /etc/rc.common`, is a non-procd one-shot, and double-forks the daemon so init.d's `start` call returns immediately. It is auto-enabled by the directory-driven `install.sh` discovery — it is NOT in `UCI_GATED_SERVICES`, so `enable_services()` enables it unconditionally. No installer change is needed when this file is added.

### GET-time self-healing

Any `-s SM` call to `sms_tool` flips modem mem1 to `SM` as a side effect. The inbox GET sequence is therefore:

1. Assert `AT+CPMS="ME","ME","ME"` (routes future incoming to ME; ensures `sms_tool status` reads ME).
2. Fetch ME messages: `_sms_run -s ME recv -j` + `_sms_run -s ME status`.
3. Fetch SM messages: `_sms_run -s SM recv -j` + `_sms_run -s SM status`.
4. Re-assert `AT+CPMS="ME","ME","ME"` (counteracts the mem1 flip from step 3).
5. Merge and return.

**Why the re-assert at the end matters:** `sms_alerts`' bare `recv`/`status` calls carry no `-s` flag. If mem1 is left pointing at `SM` after a GET, the alert library reads the SIM instead of modem memory until the next GET or reboot.

### Dual-storage merge

Each message object from `_sms_run -s ME recv -j` is tagged `"storage": "ME"`; each from `-s SM` is tagged `"storage": "SM"`. Multi-part reassembly groups by `sender + reference + storage` — not just `sender + reference` — so a message whose parts straddle both memories is never incorrectly merged.

`storage.used` and `storage.total` in the GET response are the **sum** of ME and SM usage (not ME-only). This gives an honest picture when some messages still reside on the SIM.

> ⚠️ WARNING: `sms_tool status` output is word format, not slash-separated. The line reads `Storage type: ME, used: 0, total: 255`. Parse with `grep -o 'used: [0-9]*'` etc. A pattern like `[0-9]*/[0-9]*` will never match — this was a latent bug in the old parser that caused storage counts to always read `0/0`.

### Storage-aware delete

The `delete` POST now requires a `storage` field (`"ME"` or `"SM"`, default `"ME"` if absent, validated). The CGI calls `_sms_run -s "$STORAGE" delete "$idx"` for each index. After any SM delete, `AT+CPMS="ME","ME","ME"` is re-asserted for the same reason as after a GET.

`delete_all` clears both memories in sequence (`_sms_run -s ME delete all`, then `_sms_run -s SM delete all`) and re-asserts ME routing afterward.

## Read/Unread State (Client-Side)

The modem cannot be the source of truth for per-message read/unread status for two reasons: (1) `sms_tool -j` strips the `REC READ`/`REC UNREAD` field from message objects, so it never reaches the CGI; (2) every inbox GET issues `AT+CMGL=4` which the modem treats as "mark all read", so any modem-side unread flag self-erases on every fetch. Read state is therefore tracked entirely in the browser.

**Hook:** `hooks/use-sms-read-state.ts` — exports `useSmsReadState`, `smsFingerprint`, and `parseSmsTimestamp`.

**Persistence:** `localStorage` under the key `qmanager.sms.read.v1` as a JSON array of fingerprint strings. Reads on mount, writes on every state change (errors are swallowed — quota exceeded or storage disabled; read-state is best-effort).

### Message Fingerprinting

There is no stable backend message ID. The fingerprint is a djb2 hash of the string `storage|sender|timestamp|content`. It is base-36 encoded (unsigned 32-bit). The hash covers `storage` so that two messages with identical sender/timestamp/content but different storage locations (ME vs. SM) produce different fingerprints and can be marked independently.

### Self-Pruning

On every write (`markRead` and `markAllRead`), the stored set is intersected with the fingerprints of the **currently-present** message list before the new entry is added. This ensures that when messages are deleted on the modem, their read-markers are evicted from `localStorage` on the next state change — the set cannot grow unbounded.

**Why:** Without pruning, every deleted message leaves a dead fingerprint in `localStorage` indefinitely. The prune step is implicit in `markRead` and explicit in `markAllRead`.

### Known Trade-offs

- Read state is **per-browser**. It does not sync across devices. Clearing browser storage resets all read markers.
- New incoming messages appear as unread by default (fingerprint absent from the stored set).
- Opening the View dialog marks the message read immediately (`markRead` is called in the `openMessage` callback inside `sms-inbox-card.tsx`).

### Inbox Tabs and UI

`components/cellular/sms/sms-inbox-card.tsx` adds three shadcn `Tabs`: **All**, **Unread {count}**, and **Read**. Unread rows carry a primary-color dot indicator and `font-semibold` styling. A "Mark all read" action in the card's `CardAction` area calls `markAllRead` and fires a toast.

---

## Timestamp Sorting

> ⚠️ WARNING: `sms_tool` emits timestamps in `"MM/DD/YY HH:MM:SS"` format (zero-padded, fixed-width, ASCII). Plain lexicographic sort (`sort_by(.timestamp)`) mis-orders messages across month/year boundaries — for example, `"12/31/25 23:59:59"` sorts alphabetically **after** `"01/01/26 00:00:00"` because `"12"` > `"01"`. Never sort directly on the raw timestamp field.

The backend (`sms.sh` GET handler, `messages=$(... jq ...)` block) applies a slice-reordering key before reversing:

```sh
sort_by(.timestamp[6:8] + .timestamp[0:2] + .timestamp[3:5] + .timestamp[8:]) | reverse
```

This rearranges the fixed-width slices into `"YYMMDD HH:MM:SS"` — a sortable string that orders correctly across month and year boundaries.

The frontend (`parseSmsTimestamp` in `hooks/use-sms-read-state.ts`) parses the same `MM/DD/YY HH:MM:SS` format into epoch millis and sorts descending client-side, so newest-first ordering is robust regardless of backend ordering.

**Why both layers:** The backend sort is authoritative. The client-side sort is a safety net for any future scenario where backend ordering is disrupted (e.g., storage merge returning unsorted results).

---

## Deferred Features

### Cross-Page Toast Notification (deferred)

Goal: show a toast when a new SMS arrives while the user is on a different page. The only AT-channel-safe path is piggybacking on `qmanager_poller` — a full `sms.sh` GET holds the shared `/var/lock/qmanager.lock` for ~0.26 s, making it too heavyweight to run app-wide on every poll cycle. The intended design: `qmanager_poller` writes an unread/new-count field into `/tmp/qmanager_status.json`; an `AppLayout` hook consumes that field; the existing global `<Toaster/>` fires the notification. Latency would be bounded by the poller's SMS-check cadence (not instant). This is a known, intended follow-up — the plumbing is not yet in place.

> ℹ️ NOTE: SMS Forwarding (automatic relay of incoming messages to another number) is a separate daemon — see [`docs/features/sms-forwarding.md`](sms-forwarding.md). `qmanager_sms_forward` is the **only** server-side inbox reader in the project; all other read-state is client-side.

---

## Inbox CGI (`cellular/sms.sh`)

**GET** — asserts `AT+CPMS="ME","ME","ME"`, fetches from ME, fetches from SM, re-asserts ME routing, then merges results. Multi-part messages are grouped by `sender + reference + storage`. `indexes` in each message lists every storage slot for that message so a single `delete` call clears them all.

Response message object shape:

```json
{
  "sender": "+1234567890",
  "message": "Hello",
  "indexes": [3],
  "storage": "ME"
}
```

`storage` is `"ME"` or `"SM"`. The `storage.used`/`storage.total` envelope fields reflect the sum of both memories.

**POST actions:**

| Action | Required fields | Notes |
|---|---|---|
| `send` | `phone`, `message` | Strips a leading `+` from `phone` before calling `sms_tool`; no other normalization |
| `delete` | `indexes` (array), `storage` (`"ME"`\|`"SM"`, default `"ME"`) | Deletes each slot individually; re-asserts ME routing after SM deletes; returns `partial_failure` if any slot fails |
| `delete_all` | — | Clears ME then SM; re-asserts ME routing |

On `send` failure the envelope is `{ "success": false, "error": "send_failed", "detail": "<stderr>" }` (HTTP 200 with the error in the JSON body, not a 4xx status).

## Alert Library (`sms_alerts.sh`)

Sourced by `qmanager_poller`. Entry point is `check_sms_alert`, called on every poll cycle.

**Downtime tracking state (in-process, not persisted):**

- `_sa_was_down` — whether the previous poll saw the connection down.
- `_sa_downtime_start` — epoch second when the outage began.
- `_sa_downtime_sms_status` — `none` | `pending` | `sent` | `failed`. Controls whether a recovery SMS is sent and which template it uses.

**Guards:**

- `check_sms_alert` skips entirely while `/tmp/qmanager_recovery_active` is set (mirrors `events.sh` recovery guard); downtime tracking state persists across the guard.
- `_sa_is_registered()` short-circuits on `conn_internet_available=true` so the recovery branch is never blocked by stale `lte_state`/`nr_state`.

**Failure logging:** `qlog_error` receives full context — `modem_reachable`, `lte_state`, `nr_state`, `conn`, and the cleaned `sms_tool` stderr. No breadcrumb file.

## Phone Number Handling

- Inbox CGI (`send` action): strips a leading `+` exactly once; everything else passes verbatim to `sms_tool`. Users must supply the full international number.
- Alert config CGI: strips a leading `+` exactly once before writing to `sms_alerts.json`. Storage and GET responses always return raw digits (no leading `+`). The send path passes the stored value verbatim to `sms_tool`.

## On-Device Smoke Test

```sh
sms_tool status                      # defaults to /dev/smd11, silent, exit 0
sms_tool recv -d /dev/smd11          # no tcgetattr/tcsetattr noise
sms_tool recv -d /dev/ttyUSB0        # "open port failed", exit 1, no segfault
sms_tool -D recv -d /dev/ttyUSB0     # open() trace reappears under -D
```
