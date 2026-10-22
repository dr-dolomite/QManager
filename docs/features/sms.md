# SMS

The SMS feature is a two-pane conversation center (threads per contact, received and sent) over the modem's AT channel (`/dev/smd11`), with a settings dialog for the provider number (SMSC) and message storage. Every shell caller talks to the modem through `qsms`, the SMS client of the Rust AT broker (`qmanager_atd`). The broker is the only process that opens `/dev/smd11` and it takes `/var/lock/qmanager.lock` itself for the whole operation, so SMS calls never race against `qcmd`. The old bundled `sms_tool` binary is no longer called by anything (see [Legacy: `sms_tool`](#legacy-sms_tool)).

> ℹ️ NOTE: SMS **downtime alerts** (connection-lost/restored notifications sent over SMS) are documented separately in [`docs/features/alerts.md`](alerts.md) — they're one channel in the centralized Alerts feature, which also covers email and the shared routing/capability model. This doc covers the conversation CGI, the sent log, the SMS settings and the `qsms` transport only. `sms_alerts.sh` still exists as the SMS channel's transport lib (config I/O, `qsms send`, retry, logging) but no longer owns downtime *detection* — that lives in `alert_engine.sh`.

## Quick Reference

| Item | Value |
|---|---|
| Conversation CGI | `GET/POST /cgi-bin/quecmanager/cellular/sms.sh` (inbox, `?addr=` thread, `?action=smsc`; POST `send`, `delete`, `delete_all`, `set_smsc`) |
| Sent log | `/usrdata/qmanager/sms_sent.json` via `scripts/usr/lib/qmanager/sms_sent.sh`, lock `/var/run/qmanager/sms_sent.lock` (FD 8) |
| UI | `components/cellular/sms/sms-center.tsx` (two panes), `sms-settings-dialog.tsx`, `?thread=<addr>` deep link |
| AT channel | `/dev/smd11` (opened only by `qmanager_atd`) |
| Transport | `/usr/bin/qsms`, a symlink to `/usr/bin/qmanager_atd` (argv[0] `qsms` selects the SMS client); socket `/var/run/qmanager_atd.sock` |
| Lock | `/var/lock/qmanager.lock`, taken by the broker itself. Callers never wrap `qsms` in `flock` |
| Legacy binary | `/usr/bin/sms_tool`: retired in phase 4 (not bundled; `install.sh` and `uninstall.sh` delete it) |
| Storage boot daemon | `/usr/bin/qmanager_sms_storage` (init.d: `/etc/init.d/qmanager_sms_storage`, START=99) |
| Reboot | Never |

## `qsms` Transport

`/usr/bin/qsms` is a second symlink to `/usr/bin/qmanager_atd` (like `/usr/bin/qcmd`). argv[0] `qsms` selects the SMS client. Same transport as `qcmd`: the unix socket `/var/run/qmanager_atd.sock` first, with an in-process fallback only if the request never reached the broker. See [`at-broker.md`](at-broker.md). stdout is exactly one JSON line; exit 0 on success, 1 on failure.

| Command | Success shape | Failure shape |
|---|---|---|
| `qsms list [ME\|SM\|all]` (default `ME`) | `{"success":true,"msg":[{"index":N,"storage":"ME","stat":N,"sender":"...","timestamp":"MM/DD/YY HH:MM:SS","encoding":"gsm7","content":"..."}]}`. Multipart messages add `reference`, `part`, `total`. | `{"success":false,"error":"<code>"[,"detail":"..."]}` |
| `qsms status [ME\|SM\|all]` (default `all`) | `all`: `{"success":true,"storages":[{"storage":"ME","used":2,"total":255},{"storage":"SM",...}]}`. Single storage: `{"success":true,"storage":"SM","used":1,"total":255}` | generic failure |
| `qsms send <number> <text>` | `{"success":true,"parts":N,"refs":[...]}` | `{"success":false,"error":"send_failed","detail":"+CMS ERROR: 500","parts":3,"sent_parts":1,"refs":[41]}` |
| `qsms delete <ME\|SM> <idx,idx,...>` | `{"success":true,"storage":"SM","deleted":[1],"failed":[]}` | `success:false` with `"failed":[{"index":9,"error":"+CMS ERROR: 321"}]` |
| `qsms delete <ME\|SM> all` | `{"success":true,"storage":"ME","deleted":62,"remaining":0}` | generic failure |

Generic failure codes include `modem_busy` and `scan_in_progress` (the broker's transport codes), `send_failed`, `delete_failed` and usage errors. Details:

- With `list all`, an unusable SIM store does not fail the call. The response adds `"storage_errors":{"SM":"+CMS ERROR: 310"}` and the ME messages are still returned.
- A per-message decode failure shows up as `"error":"error decoding pdu"` inside that message object, not as a call failure.
- `delete <store> all` clears every index the store reports, not just 0..49.
- Message bodies and phone numbers never reach the broker log.

### Broker-Owned Lock

The broker takes `/var/lock/qmanager.lock` itself for the whole `qsms` operation, the same lock `qcmd` uses.

> ⚠️ WARNING: Callers must never wrap `qsms` in `flock` on `/var/lock/qmanager.lock`. The broker would wait on the caller's own lock until it gives up with `modem_busy`.

**Why:** The previous design had each shell caller hold the lock around `sms_tool` with a 10 s polling wait (BusyBox `flock` has no `-w`) and exit 99 on timeout. That duplicated the broker's job and could deadlock against it. Lock contention now surfaces as the `modem_busy` / `scan_in_progress` error codes from `qsms`, and each caller maps them (the inbox CGI to the `modem_busy` envelope; the alert transport to rc 2, see below).

Callers also no longer filter `tcgetattr`/`tcsetattr` noise from stderr: there is no termios code path in the broker, and stdout carries only the JSON line.

## SMS Storage Routing (`AT+CPMS`)

`AT+CPMS` controls three independent storage pointers: mem1 (read/delete source), mem2 (send destination), and mem3 (incoming-message routing). On the RM551E the modem defaults mem3 to `SM` (SIM card), so every incoming SMS is written to the SIM rather than modem memory (`ME`). QManager read `ME` exclusively, which meant incoming messages accumulated silently on the SIM card and never appeared in the inbox.

**The fix** is two-pronged: a boot daemon that points all three pointers at the chosen storage at startup, and `qsms` itself, which restores that routing after every operation that selects a storage.

### Storage choice (SMS settings dialog)

The user picks where **new** messages go: **Modem** (`ME`, 255 slots, the default) or **SIM** (`SM`, about 35 slots; the messages travel with the SIM). The choice is the one-line file `/etc/qmanager/sms_storage` (`ME` or `SM`); a missing file means `ME`, so upgrades need no seed. It is a plain file and not UCI because the broker must read it after every SMS operation (the same pattern as `band_failover_enabled`).

| Item | Value |
|---|---|
| CGI | `GET/POST /cgi-bin/quecmanager/cellular/sms_storage.sh` |
| Hook / UI | `hooks/use-sms-storage.ts`, the Message storage section of `components/cellular/sms/sms-settings-dialog.tsx` (header menu, SMS settings) |
| Readers | `qmanager_atd` (`sms/mod.rs` `PREF_FILE`, read at every restore), `qmanager_sms_storage` (boot), Config Backup section `sms_storage` |

- **GET** returns `{success, storage, routing, storages:[{storage,used,total}], storage_errors?}`. `storage` is the saved choice, `routing` the live mem3 from `AT+CPMS?` (`""` if the read failed). `qsms status all` fails as a whole when the SIM store is unusable, so the CGI then reads each store alone and names the failing one in `storage_errors`; the dialog disables the SIM option unless SIM is already saved.
- **POST** `{storage:"ME"|"SM"}`: validates (`invalid_storage`), refuses SIM when `qsms status SM` fails (`sim_storage_unavailable`, or `modem_busy`), writes the file (`save_failed`), sets `AT+CPMS="X","X","X"` and reads mem3 back. On a mismatch it writes the previous choice back, re-applies it and answers `apply_failed`.
- **Changing it moves nothing.** Existing messages stay where they are; the conversation list already reads both stores and tags SIM rows. Moving or copying messages between stores is not offered (`qsms` has no write path).
- **Full stores:** the dialog shows a warning chip at 90% and a destructive "Full" chip at 100% per store. A full mem3 store makes the modem refuse new messages, which is why Modem stays the default.
- **No automatic fallback.** `AT+CPMS=?` lists `MT`, but on the RM551E `MT` is the modem store alone (it reported ME's 99/255 and listed only ME messages, 2026-10-18), not ME plus SIM, so there is no "SIM, then modem when full" option.
- **Forwarder:** unaffected. Its fingerprint includes the storage, and a message never changes store.
- **Uninstall:** `/etc/qmanager/sms_storage` goes with `/etc/qmanager/` when config is purged. The modem's routing is not reset; it returns to its own default (SIM) at the next boot, as before QManager.

### `AT+CPMS` mem1/mem2/mem3 model

| Pointer | Controls | QManager target |
|---|---|---|
| mem1 | Storage read/delete operations | the chosen storage (`ME` by default) |
| mem2 | Storage used for sent messages | the chosen storage |
| mem3 | Storage for incoming SMS routing | the chosen storage |

**Why `ME` is the default:** The SIM card typically has 35 slots. `ME` provides 255 slots and is modem-resident, so it survives SIM swaps. If mem3 is `SM` and the SIM fills up, the modem refuses further incoming messages.

### Boot daemon (`qmanager_sms_storage`)

`/usr/bin/qmanager_sms_storage` runs once at boot (init.d START=99). It polls `qsms status ME` until it succeeds (20 tries, 3 s apart), then sets `AT+CPMS="X","X","X"` through `qcmd`, where X is the saved choice. If SIM is chosen but `qsms status SM` fails (no SIM), it uses `ME` for that boot and leaves the saved choice alone. It counts the set as done only if `qcmd` exits 0 **and** an `OK` line is present in the output, because `qcmd` exits 0 even on `AT ERROR`. There is no `flock` in the script. The daemon does not respawn and does not trigger a reboot or `AT+CFUN`.

The matching init.d script (`/etc/init.d/qmanager_sms_storage`) uses `#!/bin/sh /etc/rc.common`, is a non-procd one-shot, and double-forks the daemon so init.d's `start` call returns immediately. It is auto-enabled by the directory-driven `install.sh` discovery — it is NOT in `UCI_GATED_SERVICES`, so `enable_services()` enables it unconditionally. No installer change is needed when this file is added.

### Restore after every operation

Selecting the other store flips modem mem1 as a side effect. `qsms` restores `AT+CPMS="X","X","X"` (X = `/etc/qmanager/sms_storage`, `ME` if missing or not `SM`) after every operation that selects a storage (list, status, delete), even when the operation fails. Callers do not re-assert it, and there is no GET-time step sequence to maintain. A failed restore adds `"warning":"cpms_restore_failed"` to the reply.

**Why it matters:** every reader names its store explicitly, but a pointer left on the wrong store would also route new messages there until the next successful operation or reboot.

### Dual-storage merge

`qsms list all` returns every message already tagged `"storage": "ME"` or `"SM"`. Multi-part reassembly in the CGI groups by `sender + reference + storage` — not just `sender + reference` — so a message whose parts straddle both memories is never incorrectly merged. The key also carries `total`, and because the concat reference is only 8 bits (a sender reuses it; live case: `ref 185` seven weeks apart), parts inside a group are walked oldest-first and a repeated `part` number starts a new message. `qmanager_sms_forward` uses the same merge. The merge also drops `stat`.

`storage.used` and `storage.total` in the GET response are the **sum** of ME and SM usage (from `qsms status all`), not ME-only. This gives an honest picture when some messages still reside on the SIM. If the combined call fails, the CGI falls back to `qsms status ME`.

### Storage-aware delete

The `delete` POST takes a `storage` field (`"ME"` or `"SM"`, default `"ME"` if absent, validated). The CGI makes one `qsms delete <STORAGE> i,j,k` call for all indexes. Indexes that are not plain non-negative integers are not sent and count as failures. The failed count comes from the length of `.failed` in the response (all indexes if the call itself failed at transport level); a busy modem returns the `modem_busy` envelope.

`delete_all` clears both memories in sequence (`qsms delete ME all`, then `qsms delete SM all`) and then the sent log. A failure returns `delete_all_failed` with the reasons joined as `ME: ... | SM: ... | SENT: ...`. Deleting a whole conversation (`{addr, index:"ALL"}`) and sent-log records (`storage:"SENT"`) are described under [Conversation Model](#post).

## Conversation Model (`cellular/sms.sh`)

The CGI returns a conversation model, not just the modem's inbox. Received messages come from `qsms list all` (ME + SM, multi-part merged, see Dual-storage merge). Sent messages come from QManager's own **sent log** (see [Sent Log](#sent-log-sms_sentsh)), because the modem keeps received messages only. Both are normalised by one jq program (`SMS_JQ_MODEL`) into one flat list, newest first, and grouped into threads by `addr`.

**Why:** the two-pane UI needs per-contact threads with both directions, a stable per-message identity for delete and read state, and a sender name where the network supplied one. Building that in the CGI keeps the BusyBox-side parsing (UTC offset, concat reassembly) in one place.

### GET

| Request | Response |
|---|---|
| `GET sms.sh` | `{success, messages[], threads[], storage:{used,total}, smsc:{addr,status,time}\|null, unread_total:0}` |
| `GET sms.sh?addr=<percent-encoded addr>` | `{success, addr, count, messages[], has_more:false}`, one thread, **oldest-first**. `&before=` is accepted and ignored (the thread is always returned whole). A missing or empty `addr` returns `missing_addr`. |
| `GET sms.sh?action=smsc` | `{success, smsc:{addr,status,time}}`, or `modem_busy`, or `smsc_read_failed` |

`addr` must be percent-encoded by the caller; the CGI decodes it with an awk decoder (`+` is a space, `%XX` is a byte, UTF-8 survives, a malformed escape stays literal). The value is the **raw stored address**, the same string the thread key, delete payload and reply destination use.

`unread_total` is always `0`. Read state is client-side (below), so the backend never reports unread, and `threads[].unreadCount` is `0` for the same reason; the browser overlays the real counts.

Message object (inbound and outbound share one shape):

```json
{
  "addr": "+639171234567",
  "sender": "+639171234567",
  "content": "Hello",
  "indexes": [3],
  "index": 3,
  "storage": "ME",
  "timestamp": "10/18/26 14:03:22",
  "time": 1792332202,
  "direction": "inbound",
  "type": 1,
  "status": "success",
  "result": 1,
  "identity": "ME3:1792332202",
  "display_name": "+639171234567",
  "display_source": "raw",
  "addr_kind": "msisdn"
}
```

| Field | Meaning |
|---|---|
| `addr` | Thread key. The raw stored sender (inbound) or destination (outbound). |
| `storage` | `ME`, `SM`, or `SENT` for a sent-log record. Sent records have `indexes: []` and `index: null`, plus `seq`. |
| `identity` | Stable per-message handle: `<ST><idx>:<time>` for modem messages (`ME3:1792332202`), `S<seq>:<time>` for sent records. |
| `time` | Unix seconds, corrected for the device UTC offset (see Timestamp Handling). `0` if unparseable. |
| `direction` / `type` | `inbound` / `1`, or `outbound` / `0`. |
| `status` / `result` | `success` / `1`, or `failed` / `0`. Inbound is always `success`. |
| `display_name` / `display_source` / `addr_kind` | Sender label for the UI: `display_source` is `network` (alphanumeric sender ID the network sent as text) or `raw`; `addr_kind` is `alphanumeric`, `shortcode` (up to 6 digits) or `msisdn`. |

`threads[]` is one entry per `addr`, newest first: `{addr, sender, display_name, display_source, addr_kind, latestMessage, content, timestamp, timestampSec, unreadCount:0, latestIndex, direction, type, status}`.

`smsc` is read with `AT+CSCA?` through `qcmd` and is **decoration**: a busy or failed read yields `smsc: null`, never a failed inbox. The inbox GET therefore costs one extra AT call.

GET failure envelopes: a list failure with `modem_busy` or `scan_in_progress` returns `{"success":false,"error":"modem_busy","detail":"Could not acquire AT lock"}`; any other list failure returns `{"success":false,"error":"<code or command_failed>","detail":"..."}`. If the jq model produces nothing the reply is `command_failed`.

### POST

| Action | Body | Notes |
|---|---|---|
| `send` | `{phone, message}` | Strips one leading `+` before `qsms send`, no other normalisation. Success **and** failure both append a record to the sent log (`success`/`failed`) using the number as typed, so a failed bubble can be retried. Failure: `send_failed` with the `qsms` detail (HTTP 200, error in the body); a busy modem returns `modem_busy` and is not logged as failed. |
| `delete` | `{indexes:[..], storage:"ME"\|"SM"}` | Storage-aware delete (below). |
| `delete` | `{storage:"SENT", identities:["S<seq>:<time>", ..]}` | Drops sent-log records. Empty or missing `identities` returns `missing_identities`. |
| `delete` | `{addr, index:"ALL"}` | Deletes the whole conversation: lists the modem, groups that `addr`'s messages by storage, one `qsms delete <ST> i,j,k` per storage, then drops the sent records to `addr`. Any failed slot returns `partial_failure` with a count; busy returns `modem_busy`. |
| `delete_all` | none | `qsms delete ME all`, `qsms delete SM all`, and clears the sent log. Failure returns `delete_all_failed` with `ME: ... \| SM: ... \| SENT: ...`. |
| `set_smsc` | `{addr}` | Provider number write, see [Provider Number](#provider-number-smsc). |

`mark_read` and `mark_unread` are **not** backend actions. An unknown action returns `invalid_action`.

Error codes added with the redesign: `invalid_smsc`, `smsc_read_failed`, `smsc_write_failed`, `missing_identities`, `missing_addr`, `command_failed`. Only the first three have `errors.json` entries; the rest are guards the UI does not normally reach and fall through to the `Modem reported: ...` catch-all. Existing codes are unchanged: `missing_action`, `missing_phone`, `missing_message`, `missing_indexes`, `partial_failure`, `delete_all_failed`, `send_failed`, `modem_busy`.

## Sent Log (`sms_sent.sh`)

| Item | Value |
|---|---|
| Lib | `scripts/usr/lib/qmanager/sms_sent.sh`, sourced by `cellular/sms.sh` (no-op stubs are defined if the lib is missing) |
| File | `/usrdata/qmanager/sms_sent.json` (override `SMS_SENT_FILE`), a JSON array of `{seq, addr, content, time, status:"success"\|"failed"}`; created lazily on the first send; newest 300 kept |
| Lock | `/var/run/qmanager/sms_sent.lock` (override `SMS_SENT_LOCK`), its own `flock` on **FD 8**, polled for 3 s |
| Write path | read-modify-write under the lock in a subshell (so FD 8 closes however it exits), landed through `qm_atomic_write` (same-dir temp plus rename) |
| Corruption | a missing, empty or corrupt file reads as `[]`; non-object entries are dropped on read |
| Cleanup | `scripts/uninstall.sh` `remove_config` deletes the file. **Not** in Config Backup. `install.sh` copies libs by glob, so no installer change |

**Why:** the modem's SMS store holds only received messages, so a conversation view has nothing to show for outbound traffic unless QManager records it. The log lives under `/usrdata` so it survives reboots.

> ⚠️ WARNING: this lock is separate from `/var/lock/qmanager.lock`. Never hold the modem lock around the sent log or the reverse; the broker owns the modem lock and the log lock is only ever taken for a fast file update.

## Provider Number (SMSC)

The provider number (SMS service center) routes outgoing messages. It is read and written with `AT+CSCA` through `qcmd`, not `qsms`.

- **Read:** `AT+CSCA?`, parsed from the `+CSCA: "<number>",<toa>` line. `_sms_smsc_read` returns 0 ok, 1 failed, 2 modem busy.
- **Write (`set_smsc {addr}`):** validates an optional leading `+` then **3 to 20 digits** (`invalid_smsc` otherwise), sends `AT+CSCA="<n>",<toa>` with `toa` 145 for a `+` number and 129 otherwise, **requires an `OK` line** (`qcmd` exits 0 even on `AT ERROR`), then re-reads the value. Any rejection or a failed read-back is `smsc_write_failed`; busy is `modem_busy`. Success returns `{success:true, smsc:{addr,status:"",time:""}}` with the value read back.
- **Not persisted by QManager.** The SMSC lives in the modem/SIM, not in a QManager file.

> ℹ️ NOTE: the SMSC write, send logging and the delete-by-conversation path have not been exercised on the device yet (port ledger B5.38). The inbox, thread and SMSC reads are the validated surface.

## Frontend

The page (`app/cellular/sms/page.tsx`) renders `SmsCenterComponent`; the forwarding sub-route is documented in [`sms-forwarding.md`](sms-forwarding.md). The old inbox and storage cards (`sms-inbox-card.tsx`, `sms-storage-card.tsx`) are gone.

| File (under `components/cellular/sms/` unless noted) | Role |
|---|---|
| `sms-center.tsx` | Page header plus **one card with two panes**: thread list left, conversation right. Owns routing, dialogs and the poll consumers. |
| `sms-thread-list.tsx` | Search, All/Unread filter, thread rows with identity disc, preview ("You: ..." for outbound), unread pill |
| `sms-conversation.tsx` | Day-grouped bubbles, reply composer, phishing warning under inbound messages with links, one-time-code detection |
| `sms-composer.tsx`, `sms-compose-dialog.tsx` | Reply box; new-message dialog |
| `sms-forward-dialog.tsx` | Forward a message to another number (sent as a new message) |
| `sms-message-menu.tsx` | Per-bubble context menu (right-click, long-press, Shift+F10): Copy text, Copy code, Forward, Mark as unread, Details, Delete. Items a message cannot support are omitted, never disabled; pending optimistic sends get Copy text only. |
| `sms-message-details-dialog.tsx`, `sms-states.tsx` | Details dialog; loading, empty and error panels |
| `sms-threads.ts`, `sms-format.ts` | Thread view models and skeleton geometry; timestamp and text helpers (`parseSmsTimestamp`, `smsEpochMs`, `isOutbound`) |
| `sms-settings-dialog.tsx` | Header three-dot menu, **SMS settings**: Provider number (SMSC) and Message storage |
| `sms-identity.ts`, `sms-identity-disc.tsx` | Sender resolution ladder and the avatar disc |
| `lib/sms-directory.ts`, `lib/sms-logos.ts` | Bundled short-code names; curated name-to-domain map |
| `components/ui/brand-mark.tsx`, `lib/logo-store.ts` | Shared logo plate; browser-side fetched-logo store (see Sender Identity and Logos) |

**Routing.** Opening a thread pushes `/cellular/sms/?thread=<encodeURIComponent(addr)>`, so Back leaves the thread and a thread is deep-linkable. The query value is the raw stored address. **Why:** `output: "export"` rules out a `[addr]` dynamic segment (`generateStaticParams` cannot enumerate sender addresses), so this uses the fixed-route-plus-query pattern. Below `@3xl/main` the panes replace each other with a push; above it both show.

**Hook contract (`hooks/use-sms.ts`).**
- Polls the flat list every **25 s** (`POLL_MS`), skipping a tick while `document.visibilityState` is `hidden`. Thread history is fetched only on open (`fetchThread`, never on a poll), which also marks the thread read.
- Mutations return `SmsActionResult = { ok: boolean; error?: string; detail?: string }`; callers pass failures through `smsErrorMessage` / `resolveErrorMessage` and toast the returned reason. Hook `error` state is the list-read error only.
- Sends are **optimistic**: `queueSend(addr, text)` returns a `clientId`, and `pendingSends[]` renders `queued` / `sending` / `sent` / `failed` bubbles until the server list contains the message. `retrySend(clientId)` reuses the same id so a retried message never renders twice.
- Other exports: `sendSms`, `deleteSms(message)` (routes to modem indexes or to `storage:"SENT"` identities), `deleteThread(addr)`, `deleteAllSms`, `updateSmsc`, `markThreadRead`, `markMessageUnread`, `refresh`, `lastSyncedAt`.

**Settings dialog.** Provider number checks the same 3-to-20-digit rule client-side before the round trip. Message storage is the former card with the same behaviour: it uses `hooks/use-sms-storage.ts` (unchanged) and the `sms_storage.sh` contract above.

## Read/Unread State (Client-Side)

The modem cannot be the source of truth for per-message read state: every list uses `AT+CMGL=4`, which the modem treats as "mark all read", so a modem-side unread flag self-erases on every fetch. The CGI therefore reports `unread_total: 0` and `unreadCount: 0`, and read state is tracked in the browser.

**Hook:** `hooks/use-sms-read-state.ts` exports `useSmsReadState` and `smsFingerprint`. `parseSmsTimestamp` moved to `components/cellular/sms/sms-format.ts`.

**Persistence:** `localStorage` key `qmanager.sms.read.v1`, a JSON array of fingerprint strings, written on every change; errors are swallowed (read state is best-effort). Nothing is written while the message list is still empty, so the stored set survives the first load.

**API:** `isRead`, `markRead`, `markManyRead` (a whole thread in one update), `markUnread` (makes one message unread again), `markAllRead`, `unreadCount`.

**Fingerprint:** unchanged, a djb2 hash of `storage|sender|timestamp|content`, base-36. Do not change the inputs: doing so marks every message unread again. `storage` is in the hash so identical ME and SM copies are independent.

**Self-pruning:** the persisted set is filtered to the fingerprints of currently present messages on every write, so deleted messages cannot grow it without bound. Only **inbound** messages are passed in.

**Trade-offs:** read state is per-browser and resets if site data is cleared; new messages default to unread; opening a thread marks it read, and a message arriving in an already-open thread is marked read after an 800 ms debounce.

## Sender Identity and Logos

`sms-identity.ts::resolveSmsIdentity` is a four-tier ladder: `network` (clean text from the network), `decoded` (backend un-mangled a GSM-7-packed sender), `directory` (`lib/sms-directory.ts` bundled short-code table), `raw` (shown as stored). A name QManager inferred wears a different marker from one the network sent, and the disc hue is hashed from the raw address so it never implies a carrier brand.

> ⚠️ WARNING: `addr` is a **key** (storage path, thread fetch, delete payload, reply destination). Display fields are named `title` / `formattedAddr` and never replace it.

**Logos.** `lib/sms-logos.ts` is a curated map from a sender name (plus aliases) to a domain, **exact match only**: no fuzzy matching and no guessing, so a spoofed name that merely resembles a brand gets no logo. Aliases are sender IDs a brand really sends from (Smart: `SmartApp`, `SMARTLoad`; PLDT: `PLDTDeals`, `PLDTHome`, `PLDTUpgrade`; BDO: `BDO Deals`). TNT stays unmapped: it is a separate brand, never Smart's logo. Rows are kept sorted by name. `SmsIdentityDisc` renders them through the shared `components/ui/brand-mark.tsx` (see [`latency-monitor.md`](../reference/latency-monitor.md#brand-marks)). Resolution per sender: a `react-icons/si` glyph if the domain is mapped in `BRAND_MARKS`, else a fetched logo from `lib/logo-store.ts`, else initials.

**Fetched logos (`lib/logo-store.ts`, 2026-10-19).** The **browser** checks each domain once, never the device: Hunter (`https://logos.hunter.io/<domain>`, 128 px, CORS-open), else the Google s2 favicon, else a miss. A Hunter logo is redrawn on a canvas to a 128 px WebP (a few KB) and stored in `localStorage` (`qm_logos_v2`), so a known logo paints on the first frame and without internet. An s2 favicon is not CORS-readable, so only its verdict is stored and the image comes from the HTTP cache.

- **Check once.** A domain with a fresh verdict is never requested again (hit 30 days, miss 7 days; a stale hit keeps showing while it is re-checked). A network fault stores nothing, so the next visit retries. At most 4 checks run at a time; storage keeps the newest 200 verdicts and shrinks on a quota error. Each browser checks on its own; nothing is stored on the device.
- **Size floors.** A Hunter answer under 32 px (it serves `pldt.com` as a 16 px favicon) counts as none, so s2 gets its turn; an s2 image of 16 px or less is its stand-in globe and is a miss. PLDT and TNT therefore render initials.
- **Round fill.** A square fetched logo (width/height 0.8 to 1.25, and every s2 favicon) fills the disc edge to edge (`object-cover` zoomed to 115% so a round mark on a square asset, such as BDO's, leaves no corner ring; clipped round, `fillLogoClassName` on `BrandMark`), so a square asset such as GCash reads as a circle. A wide wordmark (Globe, 128x67) stays fitted on the plate with its inset rather than being cropped. Mapped glyphs and initials are unchanged.
- **Privacy:** only curated domains are ever requested from Hunter or Google; no sender text, number or message content is sent. With no internet and no stored logo the disc falls back to initials.
- **No logo backend.** The sibling repo proxies Hunter through the device (`sms_logos.sh`, a `/data` cache). Here the browser fetches directly (Hunter allows hotlinking: `cross-origin-resource-policy: cross-origin`, `access-control-allow-origin: *`), which needs no CGI, no flash cache and no device egress.
- Inbound messages containing a link carry a phishing warning row, because a sender name or logo can be faked.

---

## Timestamp Handling

`qsms` emits `"MM/DD/YY HH:MM:SS"` (zero-padded, fixed-width, device-local wall clock, no zone).

> ⚠️ WARNING: plain lexicographic sort on that string mis-orders messages across month and year boundaries (`"12/31/25 23:59:59"` sorts after `"01/01/26 00:00:00"`). Never sort the raw field.

The CGI converts each timestamp to unix seconds in jq (`epoch`: parse as UTC, then subtract the device UTC offset from `date +%z`, so the value is a true epoch) and sorts by `time`, with the slice-reorder key `.[6:8] + .[0:2] + .[3:5] + .[8:]` (`YYMMDD HH:MM:SS`) as the tiebreaker. Sent records store epoch `time` and are rendered back to the same string with the offset added.

The frontend uses `smsEpochMs`: the backend `time` first, then `parseSmsTimestamp` on `timestamp`, then ISO parse, returning `0` (sorts last) for anything unparseable. Multi-part merge still uses the slice-reorder key to walk parts oldest-first.

---

## Deferred Features

### Cross-Page Toast Notification (deferred)

Goal: show a toast when a new SMS arrives while the user is on a different page. A full `sms.sh` GET is too heavyweight to run app-wide (several `qsms`/`qcmd` calls, each taking the broker's lock), so the only AT-channel-safe path is piggybacking on `qmanager_poller`: it would write a new-count field into `/tmp/qmanager_status.json`, an `AppLayout` hook would consume it, and the global `<Toaster/>` would fire. This is a known follow-up; the plumbing is not in place.

> ℹ️ NOTE: SMS Forwarding (automatic relay of incoming messages to another number) is a separate daemon, see [`sms-forwarding.md`](sms-forwarding.md). `qmanager_sms_forward` is the **only** server-side inbox reader in the project; all other read state is client-side.

---

## SMS Channel Transport (`sms_alerts.sh`)

Sourced by `qmanager_poller`. Downtime *detection* (the outage timer, threshold debounce, recovery-guard suppression) lives in `alert_engine.sh` — see [`docs/features/alerts.md`](alerts.md). This lib owns the SMS channel's transport: config I/O, the actual `qsms send` with retry (`_sa_do_send`: 3 attempts, 5 s apart, registration check on each), and log writing. There is no lock in this lib; the broker serializes. The engine calls in via `sms_alert_emit <event> <secs>`, which returns:

- `0`: sent.
- `1`: failed, terminal.
- `2`: not ready, retry next cycle. This is either "modem not registered" or, since phase 3, "every attempt that reached `qsms` failed with `modem_busy` / `scan_in_progress`". **Why:** a busy modem is transient, so the alert engine must retry next cycle instead of burning the one send per outage. Attempts that were all skipped for registration with no `qsms` error stay terminal as before.

**Guards:**

- `_sa_is_registered()` short-circuits on `conn_internet_available=true` so the recovery branch is never blocked by stale `lte_state`/`nr_state`.

**Failure logging:** `qlog_error` receives full context — `modem_reachable`, `lte_state`, `nr_state`, `conn`, and `last_err` formatted `<code>[: <detail>]` from the `qsms` response. No breadcrumb file.

## Phone Number Handling

- Conversation CGI (`send` action): strips a leading `+` exactly once; everything else passes verbatim to `qsms send`. Users must supply the full international number.
- Alerts CGI (`monitoring/alerts.sh`): strips a leading `+` exactly once before writing to `sms_alerts.json`. Storage and GET responses always return raw digits (no leading `+`). The send path passes the stored value verbatim to `qsms send`.

## Legacy: `sms_tool`

Phase 3 moved every caller from the bundled `/usr/bin/sms_tool` to `qsms`, and phase 4 (2026-10-18) stopped bundling it: `build.sh` no longer packs it and `install.sh` no longer installs it. Like `atcli_smd11`, it is removed outright: `install_bundled_binaries` deletes an existing `/usr/bin/sms_tool` on every install and upgrade, and `uninstall.sh` deletes it too, so the broker is the only opener of `/dev/smd11`. Third-party scripts that call `sms_tool` (the test RM551E has a `/usr/bin/sub_menus/lan_menu` running `sms_tool at` for `AT+QMAP`) stop working; `qcmd` is the replacement. The `sms-tool` opkg package stays in the installer's conflict list.

What it was: a patched fork of [`obsy/sms_tool`](https://github.com/obsy/sms_tool) (Apache-2.0) at commit 94b66b9, statically linked for ARM EABI5. The binary, `sms_tool.patch` and the rebuild recipe are in git history before the phase 4 commit; its behaviour is in [`docs/reference/sms-tool/`](../reference/sms-tool/). The patch:

1. Default device `/dev/smd11` instead of `/dev/ttyUSB0` (bare `recv` used to segfault on the RM551E).
2. `isatty()` guards in `setserial()` and `resetserial()`, because `/dev/smd11` is a Qualcomm SMD char device and termios calls return `ENOTTY`.
3. `exit(1)` on open/reopen/fdopen failures instead of a `setvbuf(NULL,…)` SIGSEGV; `open()` traces gated behind `-D`.

The history behind the move: callers wrapped it in a shell `flock` with a 10 s polling wait (exit 99 on timeout), captured stderr to a temp file to keep termios noise out of the JSON stream, used `-s ME|SM` (which flipped mem1 and forced `AT+CPMS` re-assertion before and after reads), and parsed the word-format `status` line (`Storage type: ME, used: 0, total: 255`). None of that remains in live code. An earlier direction (PR #22) tried a native shell+awk PDU codec (`sms_pdu.awk`); it was abandoned in favour of `sms_tool` and later superseded by the Rust `qsms` client.

## On-Device Smoke Test

```sh
qsms status                          # both storages: {"success":true,"storages":[...]}
qsms status ME                       # single storage: used/total
qsms list all | jq '.msg | length'   # message count across ME + SM
cat /dev/null | qsms list SM         # SIM store only; stdin closed so nothing blocks
ls -l /usr/bin/qsms                  # -> qmanager_atd
```
