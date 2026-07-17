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
| Pending re-apply marker | `/tmp/qmanager_profile_pending_apply` (ICCID + caller, tab-separated; latest-wins) |
| SIM-switch quiesce flag | `/tmp/qmanager_sim_switch_active` (producer `cellular/settings.sh`, consumer `qmanager_poller`, mtime-bounded 60s) |

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

### APN Quick-Pick

The Network tab's **APN Name** input includes a **"Use my saved APN"** quick-pick button, visible only when the APN Settings slot 1 has a non-empty `apn`. The picker reads slot 1 via `useApnSettings()` (`hooks/use-apn-settings.ts`, GET `cellular/apn.sh`).

Selecting it copies three fields into the editable form:

| Field | Source | Notes |
|---|---|---|
| APN string (`apn_name`) | `slot1.apn` | Always copied |
| IP protocol (`pdp_type`) | `slot1.pdp_type` | Token space is identical (`ipv4/ipv6/ipv4v6`) — no translation needed |
| CID | `slot1.cid` | **NOT copied** when Verizon MNO is selected (the CID field is locked to 3 by the brick-guard; copying would fight it) |

This is a frontend-only feature: the form still emits the standard flat `apn_name/pdp_type/cid` body to `profiles/save.sh`; the backend is unchanged.

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
- **ICCID auto-apply**: `profile_mgr.sh::auto_apply_profile <iccid> <caller>` spawns worker detached, passing `--auto` (see "Auto-Mode Worker" below). Called via `( . /usr/lib/qmanager/profile_mgr.sh && auto_apply_profile "$iccid" "<tag>" )` from: poller boot (`boot`), `cellular/settings.sh` post-SIM-switch (`sim_switch`, now only after a **verified** slot change — see "Verified QUIMSLOT Read-Back" below — 5×1s ICCID retry that rejects the pre-switch ICCID), watchcat Tier 3 success (`watchdog`), watchcat SIM failover fallback (`watchdog_revert`, 3×1s retry).
- Auto-apply guards: `profile_check_lock` (no unconditional race with manual Activate — but see "Stale-Worker Supersession" below, a busy lock is now queued rather than silently skipped) + `profile_count > 0`. Worker's per-step skip logic is the single source of truth for "only apply what differs" — `auto_apply_profile` does NOT pre-compare.
- **ICCID matching is canonicalized at compare-time**: `auto_apply_profile`'s match loop and the mismatch-deactivate branch both run the live ICCID and each candidate's stored `sim_iccid` through `iccid_canonicalize()` (`sim_db.sh`) before comparing. See "ICCID Canonicalization" below for why.
- **Known-SIMs acknowledgement on activation**: `qmanager_profile_apply` calls `mark_sim_acknowledged()` (defined in `profile_mgr.sh`) at each `set_active_profile` success site — line ~401 (pre-CFUN IMEI path) and line ~543 (FINALIZE complete/partial branch). The helper sources `sim_db.sh`, issues `AT+QCCID` with the canonical parse pipeline (`grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r '`), and calls `sim_db_add` to add the ICCID to the persistent known-SIMs set (`/etc/qmanager/known_iccids`). This ensures that activating a profile for a freshly-inserted SIM registers that SIM as seen, so the "New SIM detected" banner does not fire on the next reboot. The helper skips on an empty read and is called only on activation success; never on deactivate or failure. See [`docs/features/known-sims.md`](known-sims.md) for the full known-SIMs model, byte-parity requirement, and migration from the retired `last_iccid` scheme.
- Events: `profile_applied`/`profile_failed`/`profile_deactivated` in `dataConnection` tab.

## Verified QUIMSLOT Read-Back — Why "OK" Cannot Be Trusted

`cellular/settings.sh` (SIM slot change branch) used to trust `AT+QUIMSLOT=N` returning `OK` as proof the switch happened, then immediately fed the "new" ICCID into `auto_apply_profile`. Under `qcmd` lock contention — most commonly a poller cycle racing the CFUN=0 → QUIMSLOT → CFUN=1 sequence — the modem can accept and acknowledge the write while silently staying on the old slot. The CGI would then auto-apply the OLD SIM's profile and report success, with no visible failure anywhere.

**Fix — `verify_quimslot()`:** after the CFUN=1 restore, the CGI polls `AT+QUIMSLOT?` up to 10× (1 s apart) until the reported active slot equals the requested slot.

- An **empty read** (qcmd lock timeout) counts as **not yet verified** — it is never treated as success. Only an active-slot value that literally matches the requested slot verifies the switch.
- If all 10 polls fail to verify, the CGI runs **one full CFUN-discipline retry** of the write (`CFUN=0` → sleep 2 → `QUIMSLOT=N` → sleep 2 → `CFUN=1`) and re-polls. If that also fails to verify, the switch is reported as **`sim_slot_switch_unverified`** (see [error-codes.md](error-codes.md)) — never `success: true` — and auto-apply is skipped entirely.
- Only a verified switch reaches the auto-apply block (`if [ -n "$sim_switch_verified" ]; then ...`).

**Pre-switch ICCID capture + stale-read rejection:** the CGI reads `AT+QCCID` and stores it as `sim_pre_iccid` *before* starting the CFUN/QUIMSLOT sequence. The post-switch ICCID retry loop (widened from 3 to 5 attempts, 1 s apart) rejects any read that equals `sim_pre_iccid` — a genuine switch always resolves as an empty read (SIM re-registering) followed by the new ICCID, never a read that still echoes the old one. This closes a second, independent path to the same wrong-profile bug: a verified slot switch whose ICCID read raced the modem's own SIM re-init and briefly returned the outgoing SIM's ICCID.

## Stale-Worker Supersession — `--auto` Mode, Pending Re-Apply Queue

Rapid back-to-back SIM switches (or a switch immediately followed by a watchdog SIM-failover event) can spawn a second `auto_apply_profile` call while the first worker is still running the first SIM's pipeline. Before this fix, `profile_check_lock` failing on the second call caused a silent skip — the second (and now-authoritative) SIM's profile was never applied, and the first worker went on to finalize `set_active_profile` for the WRONG (stale) SIM.

**Auto mode (`--auto`):** `auto_apply_profile` now spawns the worker as `qmanager_profile_apply <id> --auto`. The manual Activate path (`profiles/apply.sh` → same binary, no flag) is byte-identical to its prior behavior — it never sets `AUTO_MODE` and is exempt from every guard described below.

**Best-effort stale-SIM guard (auto mode only), two checkpoints:**
- **Pre-apply** (before Step 1 runs): if the profile is SIM-bound (`sim_iccid` non-empty) and a live `AT+QCCID` read (canonicalized, 3×1s retry) disagrees with the profile's `sim_iccid`, the worker aborts immediately as `apply_status: failed`, `apply_error: superseded_sim_changed`, WITHOUT touching the active marker.
- **Pre-finalize** (after the last step, before the FINALIZE block writes the active marker): the same re-check runs again. This is the checkpoint that actually fixes the bug — a switch that lands *during* the apply (after the pre-apply check passed) is still caught before the marker commits to the wrong SIM.
- **An empty live read never aborts** either checkpoint — a `qcmd` timeout is a "don't know," not evidence of a mismatch. This keeps the guard best-effort and prevents lock contention from turning into spurious apply failures.
- `superseded_sim_changed` is an `apply_status`-internal string (state-file `apply_error` field only) — it is **not** an `errors.json` key and is never surfaced through the CGI error envelope.

**Pending re-apply queue (busy-lock case):** when `auto_apply_profile` finds `profile_check_lock` busy, instead of skipping it now writes `/tmp/qmanager_profile_pending_apply` (`<iccid>\t<caller>`, atomic tmp-write + `mv`, so a second queued call simply overwrites — latest wins, no queue growth).

**Consumption order is the whole fix — cleanup-order invariant:** the running worker's `EXIT` trap does `rm -f "$PROFILE_APPLY_PID_FILE"` **first**, then calls `_consume_pending_apply()`. Consuming the marker before releasing the PID file would make the re-spawned `auto_apply_profile` see the (about-to-exit) worker as still holding the lock and re-queue instead of running — an infinite same-cycle bounce. Releasing the lock first lets the fresh worker actually acquire it.

`_consume_pending_apply()` does **not** blindly reuse the queued ICCID — it re-reads the live ICCID (3×1s retry) and uses that if non-empty, falling back to the ICCID stored in the pending marker only if the live read comes back empty. This means the very freshest SIM state wins even if a third switch happened while the second was queued.

Manual Activate is completely exempt from this queue: `apply.sh`'s spawn path is unaffected, and `profile_acquire_spawn_lock`/`profile_check_lock` semantics for the manual path are unchanged.

## ICCID Canonicalization — Compare-Time Only

`iccid_canonicalize()` (`scripts/usr/lib/qmanager/sim_db.sh`) strips space/CR/LF like `sim_db_normalize`, then strips **one** trailing BCD pad nibble (`F`/`f`) if present. An ICCID whose final significant digit is odd is padded to 20 nibbles with a trailing `F` per the ISO/IEC 7812 BCD convention; different read paths in this codebase disagreed on whether they kept that pad character, which caused an odd-length-ICCID SIM to never match its own profile.

> ⚠️ WARNING: This function is for **comparison only**. It must never be used to rewrite a value that gets *stored* — `sim_db_add` / the known-SIMs set continue to use `sim_db_normalize` and preserve full byte-parity (see [known-sims.md](known-sims.md)). Canonicalizing at storage time would break the `grep -qxF` whole-line membership test's byte-parity requirement.

Used to normalize **both operands** in `auto_apply_profile`'s profile-match loop and in its active-profile mismatch-deactivate branch. Also used by `profiles/current_settings.sh`'s ICCID parse (see below) and by the auto-mode stale-SIM guard helpers in `qmanager_profile_apply`.

**`current_settings.sh` fix**: the "Load from SIM" form action used to extract the ICCID with a digits-only `grep -o '[0-9]\{19,20\}'`, which silently dropped a trailing `F` pad. A profile saved from that form then stored a value that could never match the canonical apply-time `AT+QCCID` read for the same SIM — a latent bug that only manifested on F-padded (odd-length) ICCIDs. `current_settings.sh` now runs the same canonical pipeline (`grep '+QCCID:' | sed 's/+QCCID: //g'`) through `iccid_canonicalize()` before returning it, so the value the form saves matches what every apply-time comparison expects.

**Rich no-match diagnostics**: when `auto_apply_profile` finds no profile matching the live ICCID (and at least one profile exists), it now logs the live ICCID's canonicalized form alongside every candidate's stored `sim_iccid` and byte length (`qlog_warn`, not `qlog_info` — this is now a warn-level event) — a format/pad mismatch is visible in a single log read instead of requiring a manual `sim_db.sh` dump.

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
- **A third file, `/tmp/qmanager_profile_pending_apply`**, layers on top of the PID lock for the auto-mode stale-worker case — see "Stale-Worker Supersession" above for the full contract. In short: the worker's `EXIT` trap removes `$PROFILE_APPLY_PID_FILE` **before** consuming the pending marker, because consuming it first would make a re-spawned worker see the (exiting) old worker as still holding the lock.

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

## Poller Quiesce During a SIM Switch — `/tmp/qmanager_sim_switch_active`

`cellular/settings.sh` raises `/tmp/qmanager_sim_switch_active` (empty marker file, trap-guarded) for the entire duration of the CFUN/QUIMSLOT window — from immediately before `AT+CFUN=0` through the read-back verification. This exists because poller `qcmd` traffic racing that exact sequence is the root cause of the silent QUIMSLOT no-op (see "Verified QUIMSLOT Read-Back" above) — quiescing the poller removes the contention that caused it, on top of the read-back check that detects it if it still happens.

- **Producer**: `cellular/settings.sh` — `trap 'rm -f /tmp/qmanager_sim_switch_active' EXIT INT TERM` is installed right before the flag is created, so any exit path (including an unexpected CGI termination) clears it.
- **Consumer**: `qmanager_poller`'s `poll_cycle` — checked alongside `LONG_FLAG` in the same early-return block. When either is present, the poller reports `system_state: "scan_in_progress"` and skips its AT-bearing work for that cycle. This is a deliberate reuse of the existing scan-in-progress state rather than a new `system_state` value.
- **mtime-bounded (60 s)**: the poller reads the flag file's mtime on every cycle; if its age is ≥ `SIM_SWITCH_MAX_AGE=60`, the poller removes it itself and logs a warning, then resumes polling. This exists so a SIGKILL'd CGI (whose `EXIT` trap never runs) cannot mute the poller indefinitely.
- **Cleared before `/tmp/qmanager_force_tier2` is touched** — see below; this ordering is a hard invariant, not incidental.

## Force-Tier-2 Refresh After SIM Switch

After a **verified** SIM slot switch, `settings.sh` clears `/tmp/qmanager_sim_switch_active` (and disarms its trap), sleeps 2 seconds (registration settle), and only then touches `/tmp/qmanager_force_tier2`. The CGI is a write-only producer of both flags — it never reads or parses either.

> ⚠️ INVARIANT: The quiesce flag MUST be cleared **before** `/tmp/qmanager_force_tier2` is touched. If the order were reversed, the poller would still be in its quiesce early-return when the force-tier2 flag arrived, and the force-tier2 consume-and-refresh logic would never run on that cycle — the fast (~2–4 s) post-switch UI refresh this flag exists for would silently degrade to the next normal ~30 s Tier-2 boundary.

The poller's `poll_cycle` checks for the force-tier2 flag after the `LONG_FLAG`/SIM-switch-quiesce early-return block. When present it consumes the flag (`rm -f`) and immediately runs `poll_tier2` + `read_sim_state` + `refresh_sim_identity`. `refresh_sim_identity` issues `AT+CIMI;+QCCID` and updates the `boot_imsi`/`boot_iccid` globals — no swap logic, no profile side effects. The stale window for operator name, APN, DNS, WAN-IP, ICCID, and IMSI drops from ~30 seconds to ~4 seconds.

**Why:** Network-identity fields are Tier-2 (polled every `TIER2_EVERY=15` × `POLL_INTERVAL=2s` ≈ 30s). The flag forces an early execution of that tier without changing the global cadence.

**Invariants to preserve:**
- `settings.sh` MUST NOT write `/tmp/qmanager_status.json`. The poller is the sole atomic writer of that file (via `write_cache`). The CGI only touches the flags.
- The force-tier2 flag check is placed AFTER the `LONG_FLAG`/SIM-switch-quiesce early-return in `poll_cycle` on purpose. A long-running cell scan or an in-progress SIM switch returns early before reaching the Tier-2 block, so the flag is not consumed and discarded — it survives until the next cycle where neither block is active.
- `refresh_sim_identity` re-reads live modem state only; it does not trigger auto-apply, profile deactivation, or any other side effect.

See also [`docs/features/band-locking.md`](band-locking.md) — `bands/lock.sh` is the other producer of the same force-tier2 flag, with the identical contract.
