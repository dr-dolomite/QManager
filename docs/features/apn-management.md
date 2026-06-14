# APN Management

APN Settings (`/cellular/settings/apn-management`) lets users configure a single custom APN that the modem uses for its data connection. It is AT-only — every live modem value comes directly via `qcmd`. The setting is persisted to `/usrdata/qmanager/apn_profiles.json`. The page uses a **single-APN model**: one APN, one PDP type, one CID. Switching to carrier-default runs a COPS detach/attach cycle with a blank APN so the carrier negotiates its own. Carrier-managed IMS and SOS contexts are tagged (not hidden) in the CID picker so the editor can badge them and require confirmation before you target one.

The page label changed to "APN Settings" in the sidebar and breadcrumb; the **route and folder stay `/cellular/settings/apn-management`** to avoid breaking bookmarks.

## Quick Reference

| Item | Value |
|---|---|
| CGI endpoint | `GET/POST /cgi-bin/quecmanager/cellular/apn.sh` |
| CGI script | `scripts/www/cgi-bin/quecmanager/cellular/apn.sh` |
| Config file | `/usrdata/qmanager/apn_profiles.json` (v2: `{version,active,profiles[5]}`) |
| Hook | `hooks/use-apn-settings.ts` (`useApnSettings()`) |
| Types | `types/apn-settings.ts` (`ApnSetting`, `CidContext`, `ApnSettingsResponse`, `ApnSaveRequest`, `PDP_TYPE_OPTIONS`) |
| Coordinator | `components/cellular/settings/apn-management/apn-settings.tsx` |
| Settings card | `components/cellular/settings/apn-management/apn-settings-card.tsx` |
| MBN card | `components/cellular/settings/apn-management/mbn-card.tsx` (unchanged) |
| Shared AT libs | `run_at` from `scripts/usr/lib/qmanager/cgi_at.sh` |
| Shared APN lib | `scripts/usr/lib/qmanager/apn_mgr.sh` — v2 config I/O (`read_config_v2`, `write_config_v2`, `normalize_v2`), COPS apply primitives (`cops_recover`, `apply_apn_to_modem`), slot constants (`MAX_SLOTS`, `MAX_CID`, `PROFILE_FILE`), and `reapply_active_apn_slot`. Sourced by `apn.sh` and `profiles/deactivate.sh`. |
| i18n namespace | `public/locales/{en,id,it,zh-CN}/cellular.json` — `core_settings.apn.*` |
| Reboot? | No (boot-time reconcile in `qmanager_poller` replays the active APN but does not reboot) |
| Lock files? | No |
| Boot reconcile | `reconcile_active_apn_slot_at_boot()` in `apn_mgr.sh`, invoked from `qmanager_poller`'s `collect_boot_data()` — no separate daemon |

## Config File Shape (v2)

`/usrdata/qmanager/apn_profiles.json` stores exactly 5 slots with a single `active` pointer. Only **slot 1** is used by the single-APN UI; slots 2–5 exist in the file and are preserved by all read/write paths but are never written or activated by `apn.sh` in the current model.

```json
{
  "version": 2,
  "active": 1,
  "profiles": [
    { "id": 1, "name": "", "apn": "gomo.ph", "pdp_type": "ipv4v6", "cid": 1 },
    { "id": 2, "name": "", "apn": "",         "pdp_type": "ipv4v6", "cid": 1 },
    { "id": 3, "name": "", "apn": "",         "pdp_type": "ipv4v6", "cid": 1 },
    { "id": 4, "name": "", "apn": "",         "pdp_type": "ipv4v6", "cid": 1 },
    { "id": 5, "name": "", "apn": "",         "pdp_type": "ipv4v6", "cid": 1 }
  ]
}
```

`active` is `1` when the custom APN is applied (live), or `0` when the user has chosen carrier-default. A slot with an empty `apn` can never be `active` — `normalize_v2()` enforces this on every read and write path. Writes are atomic: a per-PID temp file is written, `chmod 644`-ed, then `mv`-ed over the target.

> ℹ️ NOTE: The `name` field in slot 1 is no longer written by `apn.sh` — it is always `""`. The field remains in the schema because `apn_mgr.sh` is shared with the boot-reconcile path and preserves the full v2 shape. Do not add UI for it; it is a schema artifact.

## GET Contract

**Request:** `GET /cgi-bin/quecmanager/cellular/apn.sh`

**Success response:**

```json
{
  "success": true,
  "active": 1,
  "active_cid": 1,
  "internet_cid": 1,
  "apn": { "apn": "gomo.ph", "pdp_type": "ipv4v6", "cid": 1 },
  "cids": [
    { "cid": 1, "apn": "gomo.ph", "apn_type": "",          "is_internet": true  },
    { "cid": 2, "apn": "ims",     "apn_type": "ims",       "is_internet": false },
    { "cid": 3, "apn": "sos",     "apn_type": "emergency", "is_internet": false },
    { "cid": 4, "apn": "",        "apn_type": "",          "is_internet": false }
  ]
}
```

- `active` — `1` when a custom APN is applied, `0` for carrier-default.
- `apn` — the stored slot-1 object. **Always present** (pre-fills the form even when `active == 0`), so the form retains the last-used APN when the user temporarily deactivates.
- `cids` — the modem's live PDP contexts 1–6, each tagged via `apn_type_of()`. IMS and SOS contexts are **included and tagged**, not hidden. `is_internet` = (`cid === active_cid`).
- `active_cid` and `internet_cid` are always equal — both identify the live WAN-bearing PDP context.
- **Removed from this version:** `profiles[]` array and `max_profiles`.

**Error response:**

```json
{ "success": false, "error": "<code>", "detail": "<human detail>" }
```

Error codes: `parse_failed`, `at_failed`.

- `at_failed` — emitted when the compound live AT read (`AT+CGDCONT?;+CGACT?;+CGPADDR;+QMAP="WWAN"`) returns empty even after one immediate retry. The GET never pairs `active:1` with an empty `cids[]`; it dies instead, and the hook's `if (!data.success) return;` preserves the last-known-good `cids` state rather than clobbering it.

## POST Contracts

### action: save

Persists the APN configuration to slot 1, **always applies to the modem** (COPS detach/attach cycle), and sets `active = 1`.

**Request body:**

```json
{ "action": "save", "apn": "gomo.ph", "pdp_type": "ipv4v6", "cid": 1 }
```

No `id` or `name` field. `cid` must be 1–6. `pdp_type` must be `ipv4`, `ipv6`, or `ipv4v6`. `apn` is required (non-empty).

**Success response:** `{ "success": true }`

> ⚠️ WARNING: If the modem apply (COPS cycle) succeeds but the config persist to `/usrdata/qmanager/apn_profiles.json` fails, the action still returns `success: true`. The modem is already live on the new APN; returning an error would mislead the UI. A `qlog_warn` is emitted. The hook's 1500 ms silent reconcile fetch will resync the stored state.

Error codes: `parse_failed`, `missing_fields`, `invalid_cid`, `invalid_pdp_type`, `invalid_value`, `persist_failed`, `cops_detach_failed`, `cgdcont_failed`, `cops_attach_failed`.

### action: deactivate

Reverts the modem to a carrier-assigned APN and sets `active = 0` in config. Slots are left untouched — the stored APN is preserved for the next `save`.

**Request body:**

```json
{ "action": "deactivate" }
```

**Success response:** `{ "success": true, "active": 0 }`

**Idempotent:** if `active` is already `0`, the modem is not touched and the response is returned immediately.

**Error codes:** `cops_detach_failed`, `cgdcont_failed`, `cops_attach_failed`. The config write is best-effort: if it fails after a successful modem apply, the action still returns `success: true` and emits a `qlog_warn`. The 1500 ms reconcile will resync config state.

The final `die "invalid_action"` detail string is: `"action must be save or deactivate"`.

> ℹ️ NOTE: `active = 0` is a **first-class durable state** meaning "let the carrier choose the APN." It persists across boots. The poller's boot reconciler sees `active == 0` and makes no modem change — the carrier default set at the prior deactivate is left intact.

## Reapply Triggers

The product requirement — "reapply the custom APN after reboots and SIM changes unless a Custom SIM Profile manages it" — is fulfilled by three code paths, all preserved from the prior multi-slot model:

| Trigger | Path | Notes |
|---|---|---|
| Reboot | `reconcile_active_apn_slot_at_boot()` in `qmanager_poller`'s `collect_boot_data()` | Gated on: no active Custom SIM Profile (`[ ! -s /etc/qmanager/active_profile ]`), `active != 0`, slot APN non-empty. COPS cycle only on mismatch — idempotent. |
| SIM swap | Physical SIM swap forces a device reboot → covered by boot reconcile | There is **no runtime ICCID polling** in the APN system. None is needed — a physical SIM swap always reboots the device, so the boot reconcile fires automatically. Do not add ICCID polling to this path. |
| Custom SIM Profile deactivated | `profiles/deactivate.sh` calls `reapply_active_apn_slot()` in `apn_mgr.sh` | `active == 0` → no-op, preserving the deliberate carrier-default choice. Best-effort; failure does not fail the deactivation. |
| Custom SIM Profile active | Absolute authority — overrides the single APN | Enforced at boot (poller gate) and in the UI (`ProfileOverrideAlert` + disabled fieldset). Custom SIM Profile APN > APN-Settings APN at all times. |

## AT Commands

| Operation | AT sequence |
|---|---|
| GET (one round-trip) | `AT+CGDCONT?;+CGACT?;+CGPADDR;+QMAP="WWAN"` |
| save / deactivate — deregister | `AT+COPS=2` |
| save — write APN | `AT+CGDCONT=<cid>,"<PDP_AT>","<apn>"` |
| deactivate — write blank APN (forces carrier default) | `AT+CGDCONT=<cid>,"<PDP_AT>",""` |
| save / deactivate — reattach | `AT+COPS=0` |
| boot reconcile — read live contexts | `AT+CGDCONT?` |
| boot reconcile — deregister (mismatch only) | `AT+COPS=2` |
| boot reconcile — write APN (mismatch only) | `AT+CGDCONT=<cid>,"<PDP_AT>","<apn>"` |
| boot reconcile — reattach (mismatch only) | `AT+COPS=0` |

PDP type translation: `ipv4` → `IP`, `ipv6` → `IPV6`, `ipv4v6` → `IPV4V6`.

## Key Invariants

### Empty live read is unknown, not a mismatch

An empty `cids[].apn` value (`""`) means "the live AT read failed or the context has no APN defined" — it is NOT confirmation that the modem has APN `""`. Both layers treat it as unknown:

- **Backend:** the GET now retries the compound AT call exactly once on empty; if still empty, it calls `die "at_failed"` rather than returning `active:1` alongside an empty `cids[]`. No `success:true` response ever carries a fully empty `cids[]`.
- **Frontend:** `liveApn` is derived as `liveCtx?.apn || null` — the `||` operator (not `??`) collapses an empty string to `null`. The existing `liveApn !== null` guards then fall through to the **"Active"** badge. Only a *non-empty* live APN that differs from the stored one produces a confirmed "Not live".

> ℹ️ NOTE: The `||` vs `??` distinction is load-bearing. `??` passes through `""` as a defined value, causing the badge comparison to treat an AT-read failure as a confirmed APN mismatch. Always use `||` here.

### Single compound GET round-trip

The GET handler issues one `run_at` call: `AT+CGDCONT?;+CGACT?;+CGPADDR;+QMAP="WWAN"`. All four sections parse from the single `blob`.

> ⚠️ WARNING: Do NOT call `detect_active_cid()` from `cgi_at.sh` inside the GET path. That function issues its own `qcmd 'AT+CGPADDR;+QMAP="WWAN"'`, negating the single-round-trip optimization and adding an extra modem channel handshake for no benefit.

Active-CID detection is inlined: QMAP is authoritative (first non-zero IP wins); CGPADDR (first octet > 0, valid 4-octet IPv4) is the fallback; default `"1"`.

### COPS detach/attach cycle (required, not legacy)

On LTE/5G (EPS), the default EPS bearer is negotiated at *attach time* — the APN is a contract field with the MME/PGW. `AT+CGACT=0,<cid>` / `AT+CGACT=1,<cid>` cycles only the user-plane of an already-established bearer; the MME retains the original APN. The new `CGDCONT` value never reaches the network.

`AT+COPS=2` forces a full detach. The subsequent `AT+COPS=0` triggers a fresh Attach Request that carries the newly written APN, causing the PGW to build a new default bearer.

The CGI path is LAN/Wi-Fi → lighttpd → modem. The cellular WAN drops briefly during the cycle but the HTTP path to the modem does not. No sleep is needed between steps — `run_at` goes through `qcmd`'s `flock` and is synchronous on `OK`/`ERROR`. No reboot, no `AT+CFUN`.

`cops_recover()` issues `AT+COPS=0` best-effort on every post-detach error path, so the modem is never left in manual-deregistered state after a partial operation.

### Boot-time APN reconcile (poller-hosted)

The user PDP context APN does NOT survive a modem power cycle in NVRAM. Carrier-provisioned contexts (IMS, SOS on CIDs 2/3) persist, but the user data context (typically CID 1) comes back empty. Without intervention, an `active = 1` slot stored in `apn_profiles.json` would be silently un-applied after every reboot.

`reconcile_active_apn_slot_at_boot()` in `scripts/usr/lib/qmanager/apn_mgr.sh` closes this gap. It is invoked from `qmanager_poller`'s `collect_boot_data()` immediately after the boot profile auto-apply step, and follows this sequence:

1. **Defer to Custom SIM Profiles.** If `/etc/qmanager/active_profile` is non-empty, the profile system owns the APN at boot via `auto_apply_profile`. The reconciler returns immediately. The call-site in `qmanager_poller` additionally gates on `[ ! -s /etc/qmanager/active_profile ]` before calling the function.
2. Read `apn_profiles.json`. If `active == 0` or slot 1's `apn` is empty, nothing to do. (`active == 0` means the user deliberately chose the carrier-default state — it is preserved unconditionally.)
3. Compare the stored APN against the live `AT+CGDCONT?` value for slot 1's CID.
4. **Match:** return without touching the modem (idempotent — no WAN drop on a clean boot where the APN is already correct).
5. **Mismatch:** run the mandatory COPS detach/attach cycle.

**COPS-recovery pattern:** every AT-command failure inside a COPS=2 session issues a best-effort `AT+COPS=0` before returning. No `AT+CFUN`, no reboot.

**Why the poller hosts this, not a separate daemon:** the poller (`S99qmanager`) is reliably enabled at boot on all QManager installations, runs after network init, and already sequences the profile auto-apply in `collect_boot_data()`. Co-locating the APN reconcile here keeps authority ordering (profile auto-apply runs first, reconcile runs only when no profile is active) deterministic without an additional init.d service.

### carrier-default state

`active = 0` is a first-class durable state meaning "let the carrier choose the APN." Pressing "Use carrier default" in the UI opens an AlertDialog ("Your carrier will choose the APN; the cellular connection drops briefly"), and on confirm sends the `deactivate` action. The modem runs a COPS detach/attach cycle with a blank APN so the carrier assigns its default, and `active` is written to `0`.

**Why the confirm dialog:** the COPS cycle briefly drops the WAN. The dialog text makes this explicit so the user does not click accidentally.

The `active = 0` state persists across boots. The poller's boot reconciler sees `active == 0` and makes no modem change.

### IMS/SOS classification — tagging, not exclusion

`apn_type_of()` performs a case-insensitive substring match on the live APN string:

| Pattern match | Classification | Returned in |
|---|---|---|
| `*ims*` | `ims` | `cids[]` only (tagged) |
| `*sos*`, `*emergency*`, `*xcap*`, `*rcs*` | `emergency` | `cids[]` only (tagged) |
| (none) | `""` | `cids[]` (untagged) |

IMS and SOS contexts appear in the `cids` array (the CID picker) with their `apn_type` set. They are **not** dropped.

> ⚠️ WARNING: The classification is a heuristic substring match, NOT an authoritative source. Carriers may use unexpected APN strings. The CID picker's AlertDialog confirmation is the deliberate mitigation — selecting a tagged context requires an explicit "I understand" step.

### Frontend state model

`apn-settings-card.tsx` renders the APN form and a live-status badge derived from `ApnSettingsResponse`:

| Condition | Badge |
|---|---|
| Custom SIM Profile active with APN | **Overridden** (muted + CircleSlashIcon) — fieldset disabled; `ProfileOverrideAlert` shown |
| `active == 1` and stored APN matches live CID APN | **Active** (success/green + GlobeIcon) |
| `active == 1` and live CID APN is non-empty and differs from stored APN | **Not live** (warning/amber + TriangleAlertIcon) — suppressed while `isSaving` to avoid flicker; an empty or absent live APN falls through to **Active** (unknown, not a mismatch) |
| `active == 0` | **Carrier default** (muted) — form is pre-filled with stored APN but "Use carrier default" button state reflects that carrier is in control |

**Why "Not live" exists:** if for any reason the boot reconcile does not run or cannot match the APN (e.g. a carrier that overrides the APN string on attach), `active == 1` but the live CID APN differs. The badge makes this visible without requiring manual intervention. It also appears when the carrier genuinely replaces the configured APN string.

**Optimistic badge suppression during COPS cycle:** `patchCidApn` in `use-apn-settings.ts` optimistically updates the matching `cids[]` entry immediately after a successful save, so the badge does not briefly flash "Not live" against a stale snapshot. The 1500 ms reconcile then overwrites this with the live server value.

### CID picker — carrier badges and AlertDialog confirmation

`apn-settings-card.tsx` renders the CID selector from `cids[]` (the live modem contexts). Each option carries a `CidBadge`:

| `apn_type` | Badge | Color |
|---|---|---|
| `"ims"` | PhoneCall icon + "IMS" | warning/amber |
| `"emergency"` | Siren icon + "SOS" | destructive/red |
| `""` and `is_internet` | Globe icon + "Internet" | success/green |
| `""` and not internet | (none) | — |

When the user selects a CID whose `apn_type` is `"ims"` or `"emergency"`, `handleCidChange` intercepts it, stashes it in `pendingCid`, and opens an `AlertDialog`. The Select remains controlled by the prior `cid` value, so it visually reverts on cancel. Only after confirming does `setCid` apply the new value.

### jq null-guard pattern

All `jq` expressions in `apn.sh` use explicit `if x == null then … else … end` guards. The project rule — never use `// empty`, `// ""`, or `// {}` on fields that might be boolean — is enforced by `validator`. No `//` null-coalescing operators appear anywhere in the script.

### Optimistic update + reconcile

After a successful save or deactivate, the hook applies an optimistic local patch immediately, then schedules a silent background re-fetch after 1500 ms (`RECONCILE_DELAY_MS`). This is necessary because `AT+COPS=0` returns `OK` before the attach fully completes — the fresh `active_cid` / `cids` state is not readable immediately after the POST returns.

On save, `patchCidApn` also optimistically updates the matching entry in `cids[]` with the stored APN, so the honest-badge comparison does not flash "Not live" against a stale CID snapshot during the COPS settle window.

### Custom SIM Profile override gate

`apn-settings.tsx` checks whether an active Custom SIM Profile has a non-empty `settings.apn.name`. If it does, the page is locked read-only with a `ProfileOverrideAlert` banner showing the controlling profile name and the fieldset is disabled (`overridden={true}`), so no Save or Deactivate control is ever live while a profile manages the APN.

The verdict arrives over **two sequential fetches** — `useSimProfiles` first learns `activeProfileId` (`list.sh`), then an effect fetches that profile's APN (`get.sh`). Until both settle, the page holds the APN card in its loading skeleton and keeps the fieldset disabled (`overrideUndetermined`). The "still determining" status is **derived during render** from `simLoading` + a `checkedId` state — there is no synchronous `setState` in the effect, satisfying the React-Compiler `set-state-in-effect` rule.

> ℹ️ NOTE: `apn_profiles.json`'s `active` pointer is intentionally NOT cleared when a Custom SIM Profile takes over. The stored pointer represents the user's intent for when the profile deactivates — resetting it would silently discard the APN the user had configured. The badge change (`Overridden`) is purely presentational.

When the Custom SIM Profile is **deactivated** (non-Verizon path), `deactivate.sh` calls `reapply_active_apn_slot` (defined in `apn_mgr.sh`) to restore the live APN:

- `active != 0` and slot 1 has a non-empty APN → reapply it (COPS detach/attach cycle).
- `active == 0` → **no-op.** The modem is already on the carrier's default APN (the user deliberately deactivated). The old behavior — auto-picking the lowest-id non-empty slot and applying it — has been **removed**. A deliberate carrier-default choice now survives a Custom SIM Profile deactivation.
- Slot 1 empty → no modem change; `active` stays 0.

Reapply is best-effort — a failure does NOT fail the deactivation. The Verizon path skips this step (a reboot is already pending); the poller's boot APN reconcile restores the active slot after the user reboots.

Custom SIM Profiles remain the absolute authority for APN configuration when a profile is active.

### "Copy from saved APN" in Custom Profiles

`components/cellular/custom-profiles/profile-input.tsx` provides a quick-pick to pre-fill a profile's APN from the stored APN Settings. The multi-slot list has been collapsed to a **single "Use my saved APN" option** that reads slot 1 directly. If slot 1's APN is empty, the option does not appear.

## Migration

`read_config_v2()` runs on every GET. It detects the on-disk shape and migrates once, then re-persists so subsequent reads are a straight load.

| Precedence | Shape detected | Migration result |
|---|---|---|
| 1 | Already v2 (`version == 2`, `profiles` is array) | Normalize to 5 slots; re-persist only if bytes changed |
| 2 | Old cid-keyed object `{"<cid>":{name,apn,pdp_type}}` | Lowest cid → slot 1; `active=1` if apn non-empty, else `active=0`; slots 2–5 empty |
| 3 | Legacy `apn_names.json` `{"<cid>":"<name>"}` | Lowest cid name → slot 1; `apn=""`; `active=0`; slots 2–5 empty |
| 4 | Nothing usable | 5 empty slots, `active=0` |

Existing installations with a v2 config file keep working without change — the single-APN UI reads slot 1 and ignores slots 2–5. No migration step required.

## Removed from Prior Versions

The following were removed and must not be re-introduced:

- **5-slot radio-select model** — the prior UI presented up to five named profiles in a list where exactly one could be active. Replaced by the single-APN form.
- **`profiles[]` array and `max_profiles` in GET** — the GET response no longer returns the full profiles array or a slot count. Only `apn` (slot-1 object) is returned.
- **`activate` action** — making a specific slot active was a multi-slot concern. The save action always activates the single APN.
- **`clear` action** — clearing a named slot was a multi-slot concern. Superseded by saving an empty APN (which the backend rejects — `invalid_value`) or using `deactivate` to go carrier-default.
- **`id` and `name` in POST save** — the save body no longer accepts a slot id or a profile name.
- **Invalid-action detail string** — changed from `"action must be save, activate, deactivate, or clear"` to `"action must be save or deactivate"`.
- **`wan-profile-list.tsx` and `wan-profile-edit.tsx`** — deleted. Replaced by `apn-settings-card.tsx`.
- **`hooks/use-wan-profiles.ts` and `types/wan-profiles.ts`** — renamed to `hooks/use-apn-settings.ts` and `types/apn-settings.ts`.
- **Per-CID toggle (`AT+CGACT`)** — the v1 `toggle` action cycled individual contexts. This does not negotiate the APN with the carrier on EPS.
- **`apn_type` exclusion from `profiles`** — v1 skipped IMS/SOS rows from the profiles list entirely. v2 tags them in `cids` instead.
- **`index` field** — v1 used `index` as the row key. v2 uses `id`.
- **`enabled` field** — v1 per-row boolean. v2 uses `active` (single integer pointer).
- **Auth type, username, password, `AT+QICSGP`** — authentication machinery for the Casa RDB path only.
- **`dataSource` branching** — the hook no longer has a `dataSource` field.

## Related Docs

- [Custom SIM Profiles](custom-sim-profiles.md) — the override gate source of truth; profiles with a non-empty APN lock this page read-only.
- [Error Code Vocabulary](error-codes.md) — how the `{ error, detail }` envelope maps to frontend toast messages.
