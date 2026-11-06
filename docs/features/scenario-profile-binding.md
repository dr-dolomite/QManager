# Scenario-to-Profile Binding

Each Custom SIM Profile carries a `.scenario` binding: a `default` scenario applied when the profile activates, and an optional time-of-day `schedule` that swaps scenarios automatically at configured boundaries via cron. This lets a single profile own both connectivity settings (APN, IMEI, TTL) and network-mode/band-lock preferences — all in one activate click.

## Quick Reference

| Item | Value |
|---|---|
| Profile storage | `/etc/qmanager/profiles/<id>.json` |
| Scenario configs | `/etc/qmanager/scenarios/<id>.json` |
| Active scenario marker | `/etc/qmanager/active_scenario` |
| Cron marker | `qmanager_profile_scenario` |
| Cron worker | `/usr/bin/qmanager_scenario_schedule` |
| Scenario library | `/usr/lib/qmanager/scenario_mgr.sh` |
| Activate CGI | `POST /cgi-bin/quecmanager/scenarios/activate.sh` |
| Guard error code | `scenario_locked_by_schedule` |
| Reboot on scenario apply | Never |

## Saving the Active Profile Re-Arms the Schedule (B1)

`profiles/save.sh` used to write to disk only, so a schedule edit on the active profile did nothing until the next reapply. Now, after a successful save of the **active** profile whose scenario binding changed, it calls `scenario_install_cron` (teardown when the schedule is now off) and returns `schedule_rearmed: true|false` beside the normal envelope. `scenario_install_cron` ends with a synchronous `scenario_apply` snap, so the current window applies immediately.

**Why:** the alternative (auto-reapplying the profile, as the RM520N fork does) runs the APN attach cycle, MPDN and possibly an IMEI reboot. Re-arming cron touches none of that: no CFUN, no MPDN, no reboot. Network-field edits stay pending until the user activates or hits Reapply; see [custom-sim-profiles.md](custom-sim-profiles.md) "No auto-reapply on save".

## Schema

The `.scenario` object stored inside a profile JSON:

```json
{
  "scenario": {
    "default": "balanced",
    "schedule": {
      "enabled": false,
      "blocks": [
        {
          "start": "22:00",
          "end":   "06:00",
          "days":  [0, 1, 2, 3, 4, 5, 6],
          "scenario": "gaming"
        }
      ]
    }
  }
}
```

- `default` — scenario id applied on profile activation and used as the "all other times" fallback when the schedule is enabled.
- `schedule.enabled` — boolean; when `false` the block array is ignored.
- `blocks[].start` / `blocks[].end` — `"HH:MM"` 24-hour, zero-padded. Start is **inclusive**, end is **exclusive**.
- `blocks[].days` — array of integers 0–6 where 0 = Sunday, 6 = Saturday. The UI now always writes `[0,1,2,3,4,5,6]` (every day); the field is retained for backend-resolver compatibility. See [Schedule Editor UI](#schedule-editor-ui).
- `blocks[].scenario` — any valid scenario id (`balanced`, `gaming`, `streaming`, or `custom-<n>` pointing to an existing file under `SCENARIOS_DIR`).

**Read-time migration default.** Legacy profiles with no `.scenario` key return `{"default":"balanced","schedule":{"enabled":false,"blocks":[]}}` at read time. The backend never rewrites the file on read; the default is injected by `profile_get`, `profile_list`, and `scenario_profile_block`. Saving a profile via `profile_save` always writes the normalized block, so once a legacy profile is edited and saved the field is persisted.

## Canonical Resolution Rule

Both the backend (`scenario_mgr.sh::scenario_block_for_now`) and the frontend (`lib/scenario-schedule.ts::resolveScheduledScenario`) implement the same rule. **The shell jq filter and the TypeScript port must stay in sync** — this contract is called out explicitly in the source comments.

For weekday `dow` (0=Sun..6=Sat) and minute-of-day `m` (0..1439):

1. Consider only blocks whose `days` array includes `dow`.
2. Compute `s = start minutes`, `e = end minutes`.
   - If `e > s`: block matches when `m >= s && m < e` (normal window).
   - If `e <= s`: overnight wrap; block matches when `m >= s || m < e`.
   - If `e === s`: zero-length; never matches.
3. **First matching block in array order wins.** When multiple blocks overlap, the one at the lowest index takes priority.
4. No block matches → `default`.

> ⚠️ WARNING: Minute arithmetic in `scenario_block_for_now` runs entirely inside `jq` using `tonumber`. Do **not** move it into shell `$(( ))` arithmetic — BusyBox shell treats octal-leading-zero strings like `"08"` and `"09"` as parse errors in `$(( ))`.

## DISK is the Single Source of Truth for Scenario Config

`scenario_resolve_config` reads `config.atModeValue`, `config.lte_bands`, `config.nsa_nr_bands`, and `config.sa_nr_bands` from `/etc/qmanager/scenarios/<id>.json` — not from any POST body. The activate CGI only receives `{"id":"..."}`.

Consequence for the UI: if a user edits a custom scenario while that scenario is scheduled, the next cron fire picks up the updated file automatically. The cron line bakes in the scenario **id**, not its config.

Built-in scenarios (`balanced`, `gaming`, `streaming`) send mode only and leave band locks unchanged (matching historic activate.sh behavior). Custom scenarios apply whatever `config.atModeValue`, `config.lte_bands`, `config.nsa_nr_bands`, and `config.sa_nr_bands` are set in their file.

## Apply: AT Commands, No Reboot

`scenario_apply` issues:

1. `AT+QNWPREFCFG="mode_pref",<MODE>` — always sent; if this fails, returns rc 1 and no marker is written.
2. `AT+QNWPREFCFG="lte_band",<bands>` — only when `lte_bands` is non-empty (200ms gap before each band lock).
3. `AT+QNWPREFCFG="nsa_nr5g_band",<bands>` — only when `nsa_nr_bands` is non-empty.
4. `AT+QNWPREFCFG="nr5g_band",<bands>` — only when `sa_nr_bands` is non-empty.

Return codes: `0` = full success, `2` = mode ok but at least one band lock failed (partial), `1` = unknown id or mode_pref failed. The active scenario marker (`/etc/qmanager/active_scenario`) is written on rc 0 or rc 2 (mode set counts as the primary action).

Scenario apply is **never** followed by `AT+CFUN=1,1`. It is safe to call from a CGI because it will not kill the HTTP session.

## Cron Install / Teardown

### `scenario_install_cron <profile_id>`

Called as a side-effect inside `qmanager_profile_apply` after the main apply steps succeed, and by `profiles/save.sh` when the active profile's binding changed. `qmanager_scenario_schedule` never installs cron; it only applies the transition it fires.

Steps:

1. If `schedule.enabled = false`: tear down any stale cron lines, apply the profile's `default` scenario, return.
2. Generate transition lines via `_scenario_generate_cron_lines`.
3. Strip existing `qmanager_profile_scenario` lines from the crontab.
4. Append the new marked lines, then issue `( /etc/init.d/cron reload </dev/null >/dev/null 2>&1 & )`.
5. Snap to the current block by calling `scenario_block_for_now` and `scenario_apply`.

> ℹ️ NOTE: **BusyBox crond dormant-crond gap.** On OpenWRT, `procd` only spawns `crond` once a non-empty crontab exists. Writing via `crontab -` does not wake a dormant crond — `( /etc/init.d/cron reload & )` is required after the first write. Without this, the schedule would be installed but never fire. Teardown does not need the reload; a running crond rescans every minute.

### Transition Line Generation Algorithm

`_scenario_generate_cron_lines` produces the minimal set of cron lines that implement the weekly schedule with no redundant fires:

1. For each weekday 0–6, collect block-start transitions (`rank 1`) and block-end default-restore transitions (`rank 0`). For an overnight block (`end <= start`), the end transition lands on the **next weekday** (modulo 7).
2. Within each weekday, sort transitions by minute; at equal minutes the higher-rank event (start, rank 1) overrides the lower-rank event (restore, rank 0). This prevents a flap when a block starts at exactly the same minute another block ends.
3. Walk each weekday with a running scenario seeded to the effective scenario at **23:59 of the previous weekday** (computed via the same `eff()` helper that mirrors `scenario_block_for_now`). This seeds overnight blocks correctly — a block that started yesterday and ends at 03:00 today still has its 03:00 restore emitted.
4. Emit a transition only when the target scenario differs from the running value.
5. Group surviving `(minute, scenario)` pairs across weekdays into comma-separated day lists.
6. Render: `<min> <hour> * * <days> /usr/bin/qmanager_scenario_schedule <scenario>  # qmanager_profile_scenario`

### `scenario_teardown_cron`

Removes only lines containing the `qmanager_profile_scenario` marker. Other scheduler markers (`qmanager_tower_schedule`, `qmanager_scheduled_reboot`) share the same root crontab; teardown greps only its own marker and leaves theirs intact. If removing the lines leaves an empty crontab, an empty crontab is written (`echo "" | crontab -`) so crond does not see a stale view.

### Cron Marker

```
  # qmanager_profile_scenario
```

The marker is appended by `scenario_install_cron` via `sed "s|\$|  # ${SCENARIO_CRON_MARKER}|"`. Teardown uses `grep -v "$SCENARIO_CRON_MARKER"`.

`_scenario_crontab_without_marker` also strips the standalone `# QManager Profile Scenario Schedule` header line (anchored `grep -v`) before the reinstall, so repeated `scenario_install_cron` calls do not accumulate duplicate headers. Without this strip, a device that had the schedule applied multiple times (e.g. repeated profile activations) would accumulate one header line per install.

## Teardown at Every Clear Site

Scenario cron must be removed whenever the profile it belongs to stops being active, and the Connection Scenario must be reset to Balanced so the radio does not stay locked to the deactivated profile's network mode.

Two helpers in `profile_mgr.sh` cover this, and both are called at every clear site:

- `_profile_teardown_scenario_cron` — lazy-sources `scenario_mgr.sh` and calls `scenario_teardown_cron`. Removes the `qmanager_profile_scenario` cron lines.
- `_profile_reset_scenario_to_default` — lazy-sources `scenario_mgr.sh` and calls `scenario_reset_to_default` (a thin wrapper over `scenario_apply "balanced"`). Issues `AT+QNWPREFCFG="mode_pref",AUTO` and writes `active_scenario=balanced`. This is the deactivate-time inverse of `scenario_install_cron` — the only activation path that calls `scenario_apply`.

**Mode-only reset by design.** `scenario_apply "balanced"` sets `mode_pref` to `AUTO` but does **not** clear any band locks a prior custom scenario applied. Built-in Balanced is mode-only; clearing band locks is not its job. Do not "fix" this.

The two helpers are called in sequence (teardown cron first, then reset scenario) at all five clear sites:

| Site | File | Notes |
|---|---|---|
| Manual deactivate | `profiles/deactivate.sh` | After `clear_active_profile` |
| Profile delete (was active) | `profile_mgr.sh::profile_delete` | Active id captured **before** `rm -f` — see ordering note below |
| SIM mismatch auto-clear | `profile_mgr.sh::auto_apply_profile` | After `clear_active_profile` |
| Worker total failure | `qmanager_profile_apply` | After `clear_active_profile` in the `failed` branch |
| Poller boot SIM mismatch | `qmanager_poller::collect_boot_data` | Previously a bare `rm -f "$_ap_file"`; upgraded to `( . profile_mgr.sh && clear_active_profile && _profile_teardown_scenario_cron && _profile_reset_scenario_to_default )` — this also closes a pre-existing gap where the bare rm skipped cron teardown entirely |

> ⚠️ WARNING: **`profile_delete` ordering invariant.** `get_active_profile` validates the marker by checking whether the profile file exists. In `profile_delete`, the active profile id is captured into `active_id` **before** `rm -f "$file"` — if the rm runs first, `get_active_profile` returns empty and the teardown branch never executes, leaving orphaned cron lines. This was a deliberate ordering fix; do not reorder.

The reset never reboots and is safe in the CGI request path. No UCI is involved — scenario state is the `active_scenario` marker file plus live modem only.

The cron worker has a **self-heal guard** as a backstop (not the primary teardown path): on each fire it checks whether a schedule-enabled profile is active. If not, it tears down the stale lines and exits without applying.

## Manual Scenario Activation Guard

`scenarios/activate.sh` checks whether the active profile has `schedule.enabled = true`. If it does, the endpoint returns HTTP 200 with:

```json
{"success": false, "error": "scenario_locked_by_schedule"}
```

The UI resolves this via `errors.json`. Scenario tiles remain visible and browsable; while a schedule is running the Selected-scenario card withholds Activate and shows an info block naming the next change instead. The locked state is surfaced via `useActiveProfile`'s `scheduleLocked` and `nextChangeAt` fields and a filled `info` "Scheduled" chip (`lock_clock` glyph) in that card.

## Frontend Display Contract

`useActiveProfile` (`hooks/use-active-profile.ts`) exposes four schedule-derived fields, all display-only — the device cron is authoritative for what actually runs:

| Field | Type | Meaning |
|---|---|---|
| `scheduleLocked` | `boolean` | Active profile has `schedule.enabled = true` |
| `scheduledScenarioId` | `string \| null` | Scenario resolved for right now |
| `nextChangeAt` | `string \| null` | `"HH:MM"` of next block boundary |
| `lockProfileName` | `string \| null` | Active profile name (for hint copy) |

The hook runs a 60-second tick (`TICK_INTERVAL_MS = 60_000`) to advance `scheduledScenarioId` and `nextChangeAt` at block edges without a network round-trip. The 30-second network poll (`POLL_INTERVAL_MS = 30_000`) re-reads the profile list from `profiles/list.sh`.

`lib/scenario-schedule.ts` contains `resolveScheduledScenario`, `nextChangeAt`, and `validateSchedule` — pure functions with no side effects. The schedule validation rejects malformed times and zero-length blocks. Overlapping blocks produce a warning (the first-in-array wins) but do not block save.

## Schedule Editor UI

The schedule editor is the Scenario tab of the profile wizard (hosted by `profile-form-dialog.tsx`), inline in `components/cellular/custom-profiles/profile-input.tsx` (the former `profile-form/scenario-card.tsx` and `scenario-binding/schedule-rule-row.tsx` are gone; the latter was dead code with no importers). The default scenario picker reads first; the time-of-day schedule is an explicit opt-in below it, switched by a `SegmentedField` (On/Off). The persisted JSON contract, device cron, and canonical resolution rule are unchanged from the backend's perspective.

### Simplified Daily-Only Model

The editor no longer asks about days of the week. Every window runs every day: the save path always writes `days: [0,1,2,3,4,5,6]` for each block (and `blocks: []` while the schedule is off). This keeps the device cron generator and the synced shell/TS resolver unchanged; `validateSchedule` still requires a non-empty `days` array and this invariant satisfies it. The `days` field is retained in `types/sim-profile.ts` as `days?: DayOfWeek[]` (optional) for backward-read compatibility with profiles saved earlier.

**Why removed:** per-day selection added complexity users did not need. All practical use cases (day/night split, work-hours swap) recur daily.

### Window Cap

The editor limits the schedule to `MAX_WINDOWS = 2` windows (`profile-input.tsx`). Each window is a flat card (scenario picker, start, end, remove) in the order added; a `windows_count` readout (`{{count}}` of `{{max}}`) sits beside the Add button, which is disabled at the cap. An empty schedule shows the `windows_empty` note. Order matters on the device: **first-in-array wins** when windows overlap.

### Client-Only `_key` Field

`ScenarioScheduleBlock` carries an optional `_key?: string` that `lib/scenario-schedule.ts` can add (`ensureScenarioKeys`) and strip (`stripScenarioKeys`) so a client list key never reaches the device JSON. The inline editor keys its rows with its own numeric `id` and builds blocks without `_key`, so these helpers currently have no importers; if a keyed editor returns, **`_key` must never be persisted** (strip before every POST to `profiles/save.sh`). The device JSON must stay byte-clean: shell scripts ignore extra keys, but they would create a silent diff between what was saved and what the modem operates on.

### i18n Keys (Schedule Section)

The editor reads `custom_profiles.form.{schedule_inline_label,schedule_inline_hint,windows_empty,window_label,window_remove_aria,add_window,windows_count}` and `custom_profiles.form.scenario.block_scenario_label` in the `cellular` namespace, in all five locales (en, zh-CN, zh-TW, id, it). The word "Block" is shown as "Window" in displayed strings; JSON key names such as `add_block` and `block_errors.*` are unchanged.

---

## Connection Scenarios Card UI

Scenarios no longer have their own page. They render as `ConnectionScenariosCard` (`connection-scenarios/connection-scenario-card.tsx`) on `/cellular/custom-profiles`, beside the saved profiles list (see [custom-sim-profiles.md](custom-sim-profiles.md) for the page anatomy). The old route `/cellular/custom-profiles/connection-scenarios` is a client-side redirect (`router.replace`) that maps `?action=create` to `?action=create-scenario`; on the merged page `?action=create-scenario` opens the scenario dialog once. `connection-scenario.tsx` (the page shell) was deleted. Other components in `components/cellular/custom-profiles/connection-scenarios/`: `scenario-item.tsx` (tile), `active-config-card.tsx` (Selected-scenario card), `scenario-dialog.tsx` (the one Add/Edit dialog), `scenario-icons.ts`. Hook: `hooks/use-connection-scenarios.ts`, shared through `ConnectionScenariosProvider` (one fetch for the page).

The card is embeddable: the page drives it with `openAddSignal`, `autoOpenAddDialog`, `radioOwnedByProfile` and `nextFireByScenarioId`. `nextFireByScenarioId` is a `Record<scenarioId, epoch ms>` computed by the page from the **active profile's** day timeline (`lib/schedule-timeline.ts`): each scenario's next start later today, and only while a schedule is armed, so a tile never claims a time nothing will honour. The Today ribbon (`schedule-ribbon.tsx`) uses the same timeline, which must agree with `lib/scenario-schedule.ts` (first match wins, blocks wrap past midnight).

- **No gradients; identity is an icon id (B5.25).** A custom scenario persists `icon`, a key from `SCENARIO_ICONS` (`connection-scenarios/scenario-icons.ts`, 12 Material glyphs, picked in the dialog), never the glyph itself; a missing or unknown id resolves to `auto_awesome`. Never rename or remove a shipped id (re-point it instead). `scenarios/save.sh` accepts `icon` only as `[a-z0-9_-]{1,32}` (shell `case`, the device jq has no regex), refuses anything else with `invalid_field`, drops an empty or `null` one, and strips the retired `gradient` on every save.
- **Stored display strings (B5.26, decided 2026-10-18: stable tokens).** `config.mode` is no longer written (the label comes from `atModeValue`; `save.sh` deletes it on save). `config.optimization` holds a stable English token the app writes (`Balanced`, `Latency`, `Throughput`, `Custom`; `OPTIMIZATION_TOKENS` in `types/connection-scenario.ts`) or the user's own text from the edit dialog; display goes through `optimizationLabelKey` (token to `cellular` key, else verbatim). The dialog seeds the translated label, and an untouched field writes back the original token. Records saved before this may hold a translated string and show it verbatim until edited. Nothing in the backend reads `mode`, `optimization` or `gradient`; the modem applies `atModeValue` and the band lists only.
- **Tiles** are identity, not decoration: a glyph disc on the strong `primary` fill, the name and description, and neutral `Tag`s for the network mode and, when the scenario pins bands, "Band lock". The active scenario has no chip: its disc turns `success` with two ambient pulse rings (`animate-pulse-ring`, stopped under reduced motion) and an sr-only "Active" on the name. The selected tile (a view-only choice) is a quiet neutral step (`surface-container-high` plus an inset `outline` ring), so selection never competes with the running state.
- **Scenarios card** lists built-ins then customs; **New scenario** (page header, and an icon-only `ExpandButton` in the card header that reveals its label on hover/focus) and `?action=create-scenario` open the Add dialog.
- **Selected-scenario card** shows the selected tile's configuration as glance metric pills (bands still on Auto render quiet) in a body that folds like an accordion (header chevron, closed by default), and commits from `CardFoot`: for customs, Delete (ghost) and Edit (`tonal-neutral`, always shown); Activate as a `SaveButton`, disabled when that scenario is already active and shown only while the body is open (a built-in's foot is absent while folded). While the active profile's schedule lock holds, Activate is withheld and an info block states the lock and names the next change (`nextChangeAt`).
- **One dialog** adds and edits custom scenarios; deletes confirm through an `AlertDialog`.
- **Hook contract.** `activateScenario` and `deleteCustomScenario` return `ScenarioActionResult = { ok: true } | { ok: false; error: string }`; `saveCustomScenario` returns `{ ok: true; id } | { ok: false; error }`. `error` is already resolved (`resolveErrorMessage`, so `scenario_locked_by_schedule` arrives translated) and handlers toast the returned reason, one toast per mutation.
- **Error state.** When `list.sh` fails the page renders a `ConditionScreen` with retry in place of the cards.

---

## Timezone Change Caveat

When the user changes the device timezone, the existing `system/settings.sh` handler restarts crond, which re-arms all cron lines at the new local time. The **currently-applied scenario is not re-snapped** — the modem keeps whatever scenario was last applied. The next cron transition at the new local time will snap it correctly. This is by design; a re-snap would require another `scenario_apply` call that may transiently disrupt the connection.

## Known Debt — Shared Crontab Writers Without Crond Reload

The existing scheduler subsystems — `tower/schedule.sh` (`qmanager_tower_schedule`) and scheduled-reboot (`system/settings.sh`) — write their crontab via `crontab -` **without** issuing `( /etc/init.d/cron reload & )`. They share the same dormant-crond gap that `scenario_install_cron` now handles for the scenario scheduler. This was deliberately not fixed in this change (out of scope for scenario-profile binding). A future pass should unify cron install across all scheduler subsystems with the reload idiom.
