# Custom SIM Profiles

Route: `/cellular/custom-profiles`. Stores named modem configuration bundles (APN, CID, PDP type, IMEI, TTL/HL, scenario binding) that can be activated on demand or automatically when a matching SIM is inserted. IMEI is optional — empty string means "don't change."

## Quick Reference

| Item | Value |
|---|---|
| Page route | `/cellular/custom-profiles` |
| Coordinator | `components/cellular/custom-profiles/custom-profile.tsx` |
| Left card (form) | `components/cellular/custom-profiles/profile-input.tsx` |
| Right card (list) | `components/cellular/custom-profiles/profile-view.tsx` |
| Empty state | `components/cellular/custom-profiles/empty-profile.tsx` |
| Shared override banner | `components/cellular/custom-profiles/profile-override-alert.tsx` |
| List hook | `hooks/use-sim-profiles.ts` |
| Apply hook | `hooks/use-profile-apply.ts` |
| Settings hook | `hooks/use-current-settings.ts` |
| Scenario hook | `hooks/use-scenario-list.ts` |
| Active profile hook | `hooks/use-active-profile.ts` |
| Types | `types/sim-profile.ts` |
| MNO presets | `constants/mno-presets.ts` |
| Apply worker | `/usr/bin/qmanager_profile_apply` |
| Active marker | `/etc/qmanager/active_profile` |
| Spawn lock | `/tmp/qmanager_profile_spawn.lock` |
| Worker PID | `/tmp/qmanager_profile_apply.pid` |

## Page Layout — 2-Column Card Surface

The feature is a single page at `/cellular/custom-profiles/` (`app/cellular/custom-profiles/page.tsx`). There are no sub-routes, no URL parameters, and no dialog-based editor. The URL never changes while creating or editing a profile.

The coordinator (`custom-profile.tsx`) owns the shared data layer and renders two cards side-by-side in a responsive 2-column grid (`grid-cols-1 @3xl/main:grid-cols-2`):

- **Left card — `profile-input.tsx`** — the Add/Edit form.
- **Right card — `profile-view.tsx`** — the Saved Profiles list.

The coordinator instantiates one `useSimProfiles()` and one `useCurrentSettings(true)` and passes them to both cards. A single `editingId: string | null` state is the Edit hand-off: when the user clicks Edit on a row in the right card, `setEditingId(id)` flips the left card into edit mode.

The page header (`h1` + muted description) is i18n-wired via `custom_profiles.page.title` and `custom_profiles.page.description`. Both cards are now fully internationalized: `profile-input.tsx`, `profile-view.tsx`, and `empty-profile.tsx` are all wired to the `cellular` namespace `custom_profiles.*` tree. 292 `custom_profiles.*` keys exist across en/id/it/zh-CN with full parity.

## Left Card — Add / Edit Profile (`profile-input.tsx`)

The card title flips between "Add Profile" (when `editingId` is null) and "Edit Profile" (when `editingId` is set). All form state is controlled React — no library form state.

### Tabs

The form body is a shadcn `Tabs` with four tabs, all freely clickable:

| Tab key | Fields |
|---|---|
| `identity` | Profile Name, SIM ICCID, Mobile Network Operator |
| `network` | APN name, PDP type, CID, Preferred IMEI, TTL, Hop Limit |
| `scenario` | Default Scenario, optional schedule with up to 2 daily windows |
| `review` | Live read-only summary across all tabs |

Submit and Cancel buttons sit below the tabs, always visible.

> ⚠️ INVARIANT: The footer button morphs between "Next" (`type="button"`, advances the tab) and the Submit button (`type="submit"`) depending on whether the Review tab is active. These two `<Button>`s **must carry distinct `key`s** (`profile-next` / `profile-submit`). Without them React reconciles by position, reuses the same `<button>` DOM node, and mutates `type` in place; because React 18 flushes the "Next" click synchronously, the node becomes `type="submit"` *before* the browser performs the click's default action — silently submitting (saving) the profile on every Next→Review step. Do not remove the keys.

### MNO Presets and Verizon Guard

Selecting a carrier from the MNO picker auto-fills APN, TTL, and HL from `MNO_PRESETS` (`constants/mno-presets.ts`). Selecting **Verizon** opens a brick-warning `AlertDialog` before committing — the user must confirm. On confirm, CID is locked to 3 (the `Select` is disabled with a helper note) for the lifetime of that MNO selection.

> ⚠️ WARNING: The `mno` field stores the preset's `label` string (e.g., `"Verizon"`), not the preset `id` (e.g., `"vzw"`). Every backend shell script that branches on MNO compares against the literal label. If you rename a label in `MNO_PRESETS`, you must update all `[ "$_x_mno" = "Verizon" ]` checks in the backend scripts.

### Load from SIM

The "Load from SIM" button (Identity tab header) calls `currentSettings.refresh()` and autofills ICCID, IMEI, APN, CID, and PDP type once the response lands. A `loadRequestedRef` flag gates the autofill so the coordinator's mount fetch never triggers it — only an explicit user button press fills the form.

### APN Profiles Picker

The Network tab pairs the free-text **APN Name** input with an **"APN Profiles"** `Select` in a two-column row, shown when at least one APN Management slot has a non-empty `apn`. (With no configured slots the APN Name input spans the row on its own.) The picker reads the named 5-slot APN registry via `useWanProfiles()` (`hooks/use-wan-profiles.ts`, GET `cellular/apn.sh`) and filters to slots where `apn.trim() !== ""`.

Picking a slot copies three fields into the editable form:

| Field | Source | Notes |
|---|---|---|
| APN string (`apn_name`) | `p.apn` | Always copied |
| IP protocol (`pdp_type`) | `p.pdp_type` | Token space is identical (`ipv4/ipv6/ipv4v6`) — no translation needed |
| CID | `p.cid` | **NOT copied** when Verizon MNO is selected (the CID field is locked to 3 by the brick-guard; copying would fight it) |

The Select value is **derived from the typed APN**, not held in its own state: when the current APN matches a saved slot that slot shows selected; otherwise a synthetic **"Custom"** option appears automatically (once the field is non-empty) so the trigger reflects a hand-typed APN. Picking "Custom" is a no-op — the APN Name input remains the source of truth and stays fully editable. This is a frontend-only feature: the form still emits the standard flat `apn_name/pdp_type/cid` body to `profiles/save.sh`; the backend is unchanged.

This is the third APN pre-fill source alongside MNO presets (`constants/mno-presets.ts`) and Load from SIM (`currentSettings.refresh()`).

**i18n keys** (all four locales: en, id, it, zh-CN):

| Key | Purpose |
|---|---|
| `custom_profiles.form.fields.reuse_apn_label` | Label for the APN Profiles `Select` |
| `custom_profiles.form.fields.reuse_apn_placeholder` | Placeholder shown when the APN field is empty |
| `custom_profiles.form.fields.reuse_apn_custom` | Synthetic "Custom" option label |

### Edit-Mode Prefill

When `editingId` is set, a `useEffect` calls `sim.getProfile(editingId)` (which hits `get.sh`) and populates all form fields. The PDP type maps through `PDP_FROM_BACKEND` on load and `PDP_TO_BACKEND` on submit — the UI tokens are `ipv4/ipv6/ipv4v6`; the backend tokens are `IP/IPV6/IPV4V6`.

### Schedule Windows

The Scenario tab supports up to **2** daily schedule windows (hard cap: `MAX_WINDOWS = 2` in source). Each window has a start time, end time, and scenario. The `days` field is always written as `[0,1,2,3,4,5,6]` (every day) — the UI does not expose per-day selection. Legacy profiles carrying narrower day sets still resolve correctly because `scenario_mgr.sh::scenario_block_for_now` still filters on `days`.

### Flat Save Body — Critical Invariant

`buildFormData()` emits a **flat** `ProfileFormData` object. The POST body to `profiles/save.sh` has APN keys at the top level (`name`, `cid`, `apn_name`, `pdp_type`, not nested under `settings`). The backend nests them into `settings.apn` itself. Sending a nested `settings` object would be silently dropped.

```json
{
  "name": "My Profile",
  "mno": "Verizon",
  "sim_iccid": "",
  "cid": 3,
  "apn_name": "vzwinternet",
  "pdp_type": "IPV4V6",
  "imei": "",
  "ttl": 65,
  "hl": 65,
  "scenario": {
    "default": "balanced",
    "schedule": { "enabled": false, "blocks": [] }
  }
}
```

`stripScenarioKeys(form.scenario)` strips the `_key` client-only fields before POST. See [scenario-profile-binding.md](scenario-profile-binding.md) for the full `_key` invariant.

## Right Card — Saved Profiles (`profile-view.tsx`)

Renders the `ProfileSummary[]` from `useSimProfiles()`. Profiles are sorted so the active one always leads.

### Pills Require Per-Row `get.sh` — Critical Invariant

`list.sh` returns summaries only — `ProfileSummary` has no `settings` field (no APN name, CID, PDP type, TTL, HL, IMEI). Each `ProfileRow` lazy-loads the full `SimProfile` via `sim.getProfile(id)` (which hits `get.sh`) to populate its config pills. A `PillsSkeleton` renders in the gap while the fetch is in flight. The fetch re-runs when `summary.updated_at` changes, so an edit immediately refreshes the pill display.

Config pills shown: `APN <name>`, `CID <n>`, `<PDP type>`, `TTL <n>` (omitted when 0), `HL <n>` (omitted when 0), `IMEI override` (info tone, shown when non-empty), `MPDN locked` (info tone, shown when MNO is Verizon).

### SIM Mismatch Is Client-Side — Critical Invariant

Status for each row is derived at render time via `deriveStatus(isActive, profileIccid, currentIccid)`. `currentIccid` comes from `useCurrentSettings(true).settings?.iccid` — the coordinator passes it down as a prop. A profile reaches `"mismatch"` only when: it is the active profile AND its `sim_iccid` is non-empty AND `sim_iccid !== currentIccid`. An empty `sim_iccid` means SIM-agnostic; such profiles never mismatch.

### Activate / Deactivate

**Activate** calls `handleActivate(id)`, which sets `applyOpen = true` then calls `useProfileApply().applyProfile(id)`. Opening the dialog first means the user sees the progress surface immediately rather than a button spinner hanging until the first poll lands. The `ApplyProgressDialog` (`components/cellular/custom-profiles/apply-progress-dialog.tsx`) — the Sequenced Pipeline Dialog — is the apply surface: status hero (glyph + determinate fill) on top, per-step ledger beneath. The dialog only allows close at a terminal state (`complete`, `partial`, `failed`).

On dialog close (`handleApplyClose`):
- Reads `applyState.status` and `applyState.requires_reboot` BEFORE calling `reset()` (reset clears the state).
- If `complete` or `partial` → `refresh()`. If `requires_reboot` is true → `setPendingReboot("imei")`.
- If `failed` → the dialog showed the error inline; no toast.

While the apply is in flight (not terminal) and `applyState.profile_id` matches the row, the Activate button shows a `Loader2Icon` spinner as a secondary affordance — the dialog is the primary signal. Deactivate and Delete still use `sonner` toasts.

**Deactivate** calls `sim.deactivateProfile()`. On success → `toast.success`. If `requiresReboot` is true (Verizon MPDN revert) → `setPendingReboot("verizon_revert")`. The deferred-reboot banner (`usePendingReboot`) picks up both sources. Deactivation also resets the Connection Scenario to Balanced (`mode_pref` → `AUTO`) — the radio is no longer left locked to the deactivated profile's network mode. See [`docs/features/scenario-profile-binding.md`](scenario-profile-binding.md) — "Teardown at Every Clear Site" for the full reset path. On the **non-Verizon path**, deactivation also calls `reapply_active_apn_slot` from `apn_mgr.sh` to restore the APN-Management active slot. If `active != 0` and the slot has a non-empty APN, a COPS detach/attach cycle is run to reapply it. If `active == 0` (the user previously chose carrier-default by disabling all APN profiles), `reapply_active_apn_slot` is a no-op — the carrier default is preserved and not overridden. The Verizon path skips this step because a pending reboot is already set; the poller's boot APN reconcile restores the active slot after reboot. See [`docs/features/apn-management.md`](apn-management.md) for the full slot-resolution contract.

**Delete** → `AlertDialog` confirm → `sim.deleteProfile(id)` → `toast.success/error`.

**Edit** → calls `onEdit(id)` (coordinator's `setEditingId`), which flips the left card into edit mode. There is no dialog; the URL does not change.

## `profile-override-alert.tsx` — Shared Banner (Not Part of the Registry)

`components/cellular/custom-profiles/profile-override-alert.tsx` is a standalone presentational component consumed by `apn-management/apn-settings.tsx` and other override gates to show the "Managed by Custom SIM Profile" warning banner. It is not part of the Custom SIM Profiles registry UI. Do not delete it when refactoring the profiles page.

## Apply Pipeline

- **Async 4-step apply** (`APN → TTL/HL → MPDN rule → IMEI`, ordered so the reboot-risk step is strictly last). Each step skips when unchanged. Worker: `qmanager_profile_apply`, polled via `profiles/apply_status.sh` at 500ms.
- **Why IMEI is last**: the IMEI step issues `AT+CFUN=1,1`, which on some configs USB-resets or reboots the host and kills the worker mid-run. Placing IMEI last ensures APN, TTL/HL, and the Verizon MPDN routing rule are all applied — and the active-profile marker pre-set — before that reboot. A worker death at the IMEI step cannot leave data routing or a carrier-switch revert half-applied.
- **MPDN rule pinned before reboot**: the MPDN step (step 3) always leaves the rule in a pinned state — PDP3 for a Verizon activation, or re-pinned to PDP1 on a Verizon revert. Rebooting with a pinned rule is safe. Only a bare-released rule followed by a reboot risks the firmware quirk; that sequence never occurs here because the IMEI reboot always follows a pinned rule.
- The state-file `steps[]` array order and `STEP_NAMES` in the worker match this sequence (`[apn, ttl_hl, mpdn_rule, imei]`), keeping `current_step` monotonic. The `ApplyProgressDialog` is data-driven and renders `steps[]` in array order.
- Active marker: `/etc/qmanager/active_profile` (plain text, profile ID). Written BEFORE the IMEI step (`AT+CFUN=1,1`) so a USB reset cannot lose the activation record. Finalization re-writes on success/partial; clears on total failure.
- Activate = runs full pipeline. Deactivate = clears marker + tears down scenario cron + resets `mode_pref` to AUTO + (non-Verizon only) calls `reapply_active_apn_slot`: reapplies the stored APN slot if `active != 0`, or is a no-op if `active == 0` (carrier-default preserved). Verizon deactivation sets `requires_reboot=true` and defers APN reapply to the poller's boot APN reconcile.
- **SIM mismatch**: poller `collect_boot_data()` auto-clears marker + emits `profile_deactivated` when active profile's `sim_iccid` ≠ current SIM. Empty `sim_iccid` = SIM-agnostic, left alone.
- TTL override: `ttl-settings-card.tsx` disables form when active profile has TTL/HL > 0.
- **ICCID auto-apply**: `profile_mgr.sh::auto_apply_profile <iccid> <caller>` spawns worker detached. Called via `( . /usr/lib/qmanager/profile_mgr.sh && auto_apply_profile "$iccid" "<tag>" )` from: poller boot (`boot`), `cellular/settings.sh` post-SIM-switch (`sim_switch`, 3×1s ICCID retry), watchcat Tier 3 success (`watchdog`), watchcat SIM failover fallback (`watchdog_revert`, 3×1s retry).
- Auto-apply guards: `profile_check_lock` (no race with manual Activate) + `profile_count > 0`. Worker's per-step skip logic is the single source of truth for "only apply what differs" — `auto_apply_profile` does NOT pre-compare.
- **Known-SIMs acknowledgement on activation**: `qmanager_profile_apply` calls `mark_sim_acknowledged()` (defined in `profile_mgr.sh`) at each `set_active_profile` success site — line ~401 (pre-CFUN IMEI path) and line ~543 (FINALIZE complete/partial branch). The helper sources `sim_db.sh`, issues `AT+QCCID` with the canonical parse pipeline (`grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r '`), and calls `sim_db_add` to add the ICCID to the persistent known-SIMs set (`/etc/qmanager/known_iccids`). This ensures that activating a profile for a freshly-inserted SIM registers that SIM as seen, so the "New SIM detected" banner does not fire on the next reboot. The helper skips on an empty read and is called only on activation success; never on deactivate or failure. See [`docs/features/known-sims.md`](known-sims.md) for the full known-SIMs model, byte-parity requirement, and migration from the retired `last_iccid` scheme.
- Events: `profile_applied`/`profile_failed`/`profile_deactivated` in `dataConnection` tab.

### Frontend Idle-Race Invariant — DO NOT add `"idle"` to the terminal set

`apply.sh` returns `{ success: true, status: "applying" }` as soon as the worker's PID file (`/tmp/qmanager_profile_apply.pid`) exists — before the worker writes `/tmp/qmanager_profile_state.json`. In that sub-second gap, `apply_status.sh` returns `{ status: "idle" }`. If the poller treated `"idle"` as a terminal state and stopped, the `ApplyProgressDialog` would hang with no progress and the user would have to manually refresh to discover the profile was actually applied.

**Fix** (`hooks/use-profile-apply.ts`): an `awaitingStartRef` flag is raised in `applyProfile()` after a successful `apply.sh` POST. While it is set, any `"idle"` poll response is silently skipped (counter incremented, keep polling). The flag clears on the first non-idle status. An `idleStartPollsRef` bounds the wait at `MAX_IDLE_START_POLLS = 30` polls (~15s): if the worker never writes a state file, the hook surfaces "Apply did not start" and stops. Genuine reset-to-idle (no active apply in flight) is unchanged — `awaitingStartRef` is false, so `"idle"` surfaces and stops normally.

**Why `apply.sh` does not pre-seed the state file**: `apply.sh` relies on detecting the absence of the state file to distinguish `start_failed` (worker launched but exited before writing any state) from a clean start. Pre-seeding `{"status":"idle"}` would make every failed start look like a clean reset. See `apply.sh` lines ~140-146. Do not add `"idle"` to the terminal set in the poller as a "fix" for the race — the `awaitingStartRef` guard is the correct solution and is already in place.

## Lock Layering — DO NOT collapse onto one file

Two distinct concerns, two files.

- `/tmp/qmanager_profile_spawn.lock` — owned by `apply.sh` CGI. Atomic-create via `set -C` noclobber. Rejects concurrent POSTs while the worker is coming up. Released after the CGI's poll loop confirms the worker is alive.
- `/tmp/qmanager_profile_apply.pid` — owned by the worker (`qmanager_profile_apply`). Singleton enforcement via `profile_acquire_lock`. Cleared by the worker's EXIT trap.
- **Why two**: the worker's `profile_acquire_lock` does `kill -0` on whatever PID it finds. If the CGI pre-wrote `$$` into the worker's PID file, the worker would see its own (still-sleeping) parent CGI as a foreign holder and abort. v0.1.22 hit this bug — manual Activate failed with `start_failed` while boot auto-apply still worked (boot path only `profile_check_lock`s, never acquires). Helpers: `profile_acquire_spawn_lock` / `profile_release_spawn_lock` / `profile_check_lock` / `profile_acquire_lock` in `profile_mgr.sh`.
- CGI must NEVER touch `$PROFILE_APPLY_PID_FILE`; worker must NEVER touch `$PROFILE_SPAWN_LOCK_FILE`.

## `start_failed` — Deployment-Integrity Cause

The UI error "Failed to start operation" (CGI error code `start_failed`) has two distinct root causes — the v0.1.22 lock-sharing bug above, and a **deployment-integrity failure**: `/usr/bin/qmanager_profile_apply` deployed as a 0-byte or truncated file (e.g. an interrupted install or OTA transfer). An empty shell file passes `sh -n`, execs, and exits 0 immediately without writing its PID file or state file; `apply.sh`'s 2-second start-detection poll times out and falls through to `cgi_error "start_failed"`. Boot auto-apply also silently does nothing, so neither manual nor automatic activation works.

**Diagnostic:** `md5sum /usr/bin/qmanager_profile_apply` — an empty file returns `d41d8cd98f00b204e9800998ecf8427e`; `wc -c /usr/bin/qmanager_profile_apply` — should be non-zero (repo source is ~6 KB). Fix: redeploy via the installer.

The installer now guards against this: `install_file()` compares `wc -c` of source vs copied file before finalizing, and aborts if they differ. See `docs/BACKEND.md` — Installer section for details.

## Verizon MPDN Handling (mno = "Verizon")

- **Why**: RM551E + Verizon SIM only delivers Data + SMS via PDP context 3, not the default 1. Backend forces APN onto CID 3 and writes a QMAP MPDN rule (`AT+QMAP="mpdn_rule",0,3,0,0,1`) routing the WAN data session through PDP3.
- **Form-level UX**: Selecting "Verizon" in the form triggers an explicit `AlertDialog` warning the user not to manually release the rule (firmware quirk: bare release + reboot can brick the modem until firmware reflash). On confirm, CID is locked to 3 (the CID `Select` is disabled with helper text) until the user switches MNO.
- **MNO comparator**: backend AND frontend compare the literal label `"Verizon"` (NOT the preset id `"vzw"`) — that's what `MNO_PRESETS` stores into `profile.mno`. If you rename the preset label, you must update every `[ "$_x_mno" = "Verizon" ]` shell check in scripts (worker, apply.sh, deactivate.sh, ip_passthrough.sh, profile_mgr.sh).
- **USB-mode pre-flight**: Verizon profiles require ECM (1) or RNDIS (3). `apply.sh` blocks pre-spawn with the `usb_mode_incompatible_for_verizon` error code if `AT+QCFG="usbnet"` returns 0 (RMNet) or 2 (MBIM). The worker has a defense-in-depth check too — fails all 4 steps with the same code if reached. Frontend resolves the code via `errors.json`. Note: `cgi_error` returns HTTP 200 with a JSON envelope (`{success:false, error:"...", detail:"..."}`), not a 4xx status — the frontend dispatches on the `error` field.
- **Switching AWAY from Verizon**: any non-Verizon profile that activates while PDP3 is the active context runs the documented release-then-immediately-reset pair (`AT+QMAP="mpdn_rule",0` → `AT+QMAP="mpdn_rule",0,1,0,0,1`, NO sleep between, NO reboot before re-pin). NEVER issue a bare release. The two `qcmd` calls are intentionally back-to-back in `mpdn_revert_to_default` (`profile_mgr.sh`); future maintainers must not insert anything between them.
- **Deferred reboot pattern**: revert step sets `apply_requires_reboot: true`. `deactivate.sh` returns `{ success, requires_reboot }`; frontend writes `setPendingReboot("verizon_revert")` (extends `lib/reboot/pending.ts` source union). Persistent banner via `usePendingReboot` picks it up.
- **Boot-path auto-revert**: `auto_apply_profile` in poller boot context — when SIM mismatch clears an active Verizon profile, it runs `mpdn_revert_to_default`, touches `/tmp/qmanager_pending_reboot_verizon`, emits `verizon_mpdn_reverted` warning event, then proceeds with the existing `profile_deactivated` warning event and marker clear.
- **IP Passthrough lock**: when active profile is Verizon, `ip_passthrough.sh` POST blocks with `ip_passthrough_locked_by_verizon_profile` (via `cgi_error` — HTTP 200 envelope, not a 4xx). Frontend `ip-passthrough-card.tsx` uses `useActiveProfile()` (lightweight read-only hook in `hooks/use-active-profile.ts`, polls `/profiles/list.sh` every 30s) and renders an info `Alert` + disables the entire form via outer `<fieldset disabled>`. GET endpoint stays open so the disabled form still shows current values.
- **New events** (both `dataConnection` tab): `verizon_mpdn_applied` (info), `verizon_mpdn_reverted` (info from CGI deactivate / warning from boot path).
- **New error codes** (in `errors.json` × 4 locales): `usb_mode_incompatible_for_verizon`, `mpdn_rule_failed`, `mpdn_rule_revert_failed`, `ip_passthrough_locked_by_verizon_profile`, `partial_apply`, `all_steps_failed`.

## Backend CGI Contracts

| CGI | Method | Request | Response |
|---|---|---|---|
| `profiles/list.sh` | GET | — | `{ profiles: ProfileSummary[], active_profile_id: string\|null }` — **summaries only, no `settings`** |
| `profiles/get.sh` | GET | `?id=<id>` | Full `SimProfile` including `settings.apn.{cid,name,pdp_type}`, `settings.imei`, `settings.ttl`, `settings.hl` |
| `profiles/save.sh` | POST | Flat body (see above) | `{ success, id? }` or `{ success:false, error, detail }` |
| `profiles/delete.sh` | POST | `{ id }` | `{ success }` |
| `profiles/apply.sh` | POST | `{ id }` | `{ success }` or `{ success:false, error, detail }` |
| `profiles/apply_status.sh` | GET | — | `ProfileApplyState` |
| `profiles/deactivate.sh` | POST | — | `{ success, requires_reboot }` |
| `profiles/current_settings.sh` | GET | — | `{ apn_profiles[], imei, iccid, active_cid }` |

> ℹ️ NOTE: `current_settings.sh` returns `iccid` (lowercase, no underscore). Use `settings.iccid` on the frontend, not `settings.sim_iccid` — that field belongs to `ProfileSummary`, not `CurrentModemSettings`.

## i18n Status

All components are fully internationalized. `custom-profile.tsx`, `profile-input.tsx`, `profile-view.tsx`, `apply-progress-dialog.tsx`, and `empty-profile.tsx` are all wired to the `cellular` namespace. 292 `custom_profiles.*` keys exist across en/id/it/zh-CN with full parity. Key subtrees added in the most recent pass: `custom_profiles.view.*`, `custom_profiles.form.*` (including `form.review.*`, `form.verizon_inline.*`, `form.pdp_inline.*`, and `form.fields.reuse_apn_{label,placeholder,custom}`), `custom_profiles.apply_dialog.*`, `custom_profiles.pills.*`, and `custom_profiles.card.*`.

## Force-Tier-2 Refresh After SIM Switch

After a successful SIM slot switch, `settings.sh` sleeps 2 seconds (registration settle) and then touches `/tmp/qmanager_force_tier2`. The CGI is a write-only producer — it never reads or parses the file.

The poller's `poll_cycle` checks for the flag after the `LONG_FLAG` early-return block. When present it consumes the flag (`rm -f`) and immediately runs `poll_tier2` + `read_sim_state` + `refresh_sim_identity`. `refresh_sim_identity` issues `AT+CIMI;+QCCID` and updates the `boot_imsi`/`boot_iccid` globals — no swap logic, no profile side effects. The stale window for operator name, APN, DNS, WAN-IP, ICCID, and IMSI drops from ~30 seconds to ~4 seconds.

**Why:** Network-identity fields are Tier-2 (polled every `TIER2_EVERY=15` × `POLL_INTERVAL=2s` ≈ 30s). The flag forces an early execution of that tier without changing the global cadence.

**Invariants to preserve:**
- `settings.sh` MUST NOT write `/tmp/qmanager_status.json`. The poller is the sole atomic writer of that file (via `write_cache`). The CGI only touches the flag.
- The flag check is placed AFTER the `LONG_FLAG` early-return in `poll_cycle` on purpose. A long-running cell scan returns early before reaching the Tier-2 block, so the flag is not consumed and discarded — it survives until the next normal cycle.
- `refresh_sim_identity` re-reads live modem state only; it does not trigger auto-apply, profile deactivation, or any other side effect.

See also [`docs/features/band-locking.md`](band-locking.md) — `bands/lock.sh` is the other producer of the same flag, with the identical contract.
