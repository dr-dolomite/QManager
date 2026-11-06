# Band Locking

Band Locking lets users restrict which LTE, NSA NR5G, SA NR5G, and NR-DC bands the modem is allowed to use. Constraining the band set can improve stability, latency, or throughput when one or two bands are dominant at a given site. It is independent of Connection Scenarios (which control network mode); the two features compose — a scenario can also carry a band lock via the Custom SIM Profiles integration.

NR-DC bands are **fully lockable** via the same apply path as LTE/NSA/SA. On-device testing confirmed that `AT+QNWPREFCFG="nrdc_nr5g_band",<list>` writes stick verbatim on the RM551E — the modem does not coerce or reject the value, even for bands outside the current policy set.

## Quick Reference

| Item | Value |
|---|---|
| Current bands | `GET /cgi-bin/quecmanager/bands/current.sh` |
| Apply lock | `POST /cgi-bin/quecmanager/bands/lock.sh` |
| Failover state | `GET /cgi-bin/quecmanager/bands/failover_status.sh` |
| Failover toggle | `POST /cgi-bin/quecmanager/bands/failover_toggle.sh` |
| HW universe (poller) | `data.device.hw_{lte,nsa_nr5g,sa_nr5g}_bands` (static hardware spec) |
| Policy marker (poller) | `data.device.supported_{lte,nsa_nr5g,sa_nr5g,nrdc_nr5g}_bands` (policy_band) |
| AT command (read current) | `AT+QNWPREFCFG="lte_band";+QNWPREFCFG="nsa_nr5g_band";+QNWPREFCFG="nr5g_band";+QNWPREFCFG="nrdc_nr5g_band"` (single appended command) |
| AT command (read supported) | `AT+QNWPREFCFG="policy_band"` |
| AT command (unlock / restore) | `AT+QNWPREFCFG="restore_band"` |
| Static HW spec file | `/etc/qmanager/supported_bands_hw.env` (force-copied on every install/upgrade) |
| Env cache | `/tmp/qmanager_supported_bands.env` |
| SIM-swap policy refresh flag | `/tmp/qmanager_refresh_policy_band` |
| Failover PID | `/tmp/qmanager_band_failover.pid` |
| Failover activated flag | `/tmp/qmanager_band_failover` |
| Failover enabled flag | `/etc/qmanager/band_failover_enabled` |
| Reboot on lock? | No |
| Types | `types/band-locking.ts`, `types/modem-status.ts` |
| Hook | `hooks/use-band-locking.ts` |
| Component | `components/cellular/band-locking/band-locking.tsx` (coordinator) + `band-status-card.tsx` + `band-grid-card.tsx` + `shapes.ts` |
| Backend scripts | `scripts/www/cgi-bin/quecmanager/bands/` |
| Parse lib | `scripts/usr/lib/qmanager/parse_at.sh` — `parse_policy_band` |
| Failover daemon | `scripts/usr/bin/qmanager_band_failover` |
| HW spec repo source | `scripts/etc/qmanager/supported_bands_hw.env` |

---

## Band Types and AT Parameter Mapping

All four band categories are lockable, each mapping to a distinct `AT+QNWPREFCFG` parameter name. This mapping is the authoritative source; get it wrong and you write to the wrong radio capability.

| `BandCategory` (frontend) | `band_type` (POST body) | AT parameter (`QNWPREFCFG`) | Band prefix (UI) | Writable? |
|---|---|---|---|---|
| `"lte"` | `"lte"` | `lte_band` | `B` | Yes |
| `"nsa_nr5g"` | `"nsa_nr5g"` | `nsa_nr5g_band` | `N` | Yes |
| `"sa_nr5g"` | `"sa_nr5g"` | `nr5g_band` | `N` | Yes |
| `"nrdc_nr5g"` | `"nrdc_nr5g"` | `nrdc_nr5g_band` | `N` | **Yes** |

Note the asymmetry on the SA row: the frontend key is `sa_nr5g` but the AT parameter is `nr5g_band` (no `sa_` prefix). NR-DC uses `nrdc_nr5g_band`, which is a unique substring and does not collide with the SA guard.

> ℹ️ NOTE: On-device testing confirmed that `AT+QNWPREFCFG="nrdc_nr5g_band",<list>` writes stick verbatim — the modem applies the value without coercion, even for bands outside the current policy set or speculative bands (n91–94, mmWave). The old assumption that the modem managed this register internally was incorrect.

---

## Critical Invariant: The SA grep Substring-Match Hazard

`AT+QNWPREFCFG="policy_band"` and the per-category registers queried by `current.sh` all return lines containing the string `nr5g_band`. Naively grepping for `"nr5g_band"` would match three lines:

```
+QNWPREFCFG: "nsa_nr5g_band",41:78
+QNWPREFCFG: "nrdc_nr5g_band",1:3:5:...
+QNWPREFCFG: "nr5g_band",41:78
```

**Both `parse_at.sh` (`parse_policy_band`) and `current.sh` guard the SA extraction with a double negative-grep:**

```sh
line=$(printf '%s\n' "$raw" | grep '"nr5g_band"' | grep -v 'nsa_' | grep -v 'nrdc_' | head -1)
```

Removing either `grep -v` would silently assign the NSA or NR-DC band list to SA. This has no error at runtime — the wrong data simply replaces the right data. NR-DC extraction is safe by contrast because `"nrdc_nr5g_band"` is a unique substring; it only matches its own line.

> ⚠️ WARNING: If you add a new band type that contains the substring `nr5g_band`, update the SA extraction guards in both `parse_at.sh` and `current.sh` to exclude the new key.

---

## Critical Invariant: grep Anchoring in Multi-Sub-Command `qcmd` Output

When `qcmd` executes a semicolon-appended multi-statement AT command (e.g. `AT+QNWPREFCFG="lte_band";+QNWPREFCFG="nsa_nr5g_band";...`), its output **line 1 is the echoed AT command itself** — a single line containing every key string in the command. Response lines that follow start with `+QNWPREFCFG:`.

A bare `grep '"lte_band"'` matches the echo line first and extracts garbage. The fix is to anchor the grep to the response-line prefix:

```sh
# WRONG — matches the echo line (contains all key strings)
line=$(printf '%s\n' "$result" | grep '"lte_band"' | head -1)

# CORRECT — +QNWPREFCFG: appears only on response lines; the echo starts with AT+
line=$(printf '%s\n' "$result" | grep '+QNWPREFCFG:.*"lte_band"' | head -1)
```

**Why:** The `AT+` echo prefix and the `+QNWPREFCFG:` response prefix are distinct strings — anchoring to the latter is a reliable discriminator even when the command string itself contains all the keys you are searching for. This pattern bit `current.sh` and was fixed; all four band-register greps in that file now use the `+QNWPREFCFG:.*"<key>"` anchor form.

> ⚠️ WARNING: Any future CGI that issues a multi-sub-command `qcmd` call MUST anchor its response-line greps to the `+<PREFIX>:` response prefix, not to the bare key string. A bare grep will silently match the echo line and return the entire AT command string as the "value."

---

## Universe vs. Marker vs. Locked: Three Band Layers

The Band Locking page works with three distinct band sets. Confusing any two of them causes subtle bugs (failover resets to the wrong set, or the UI shows an incorrect chip universe).

| Layer | Source | AT command / file | When queried | `status.json` fields | UI role |
|---|---|---|---|---|---|
| **HW universe** | `/etc/qmanager/supported_bands_hw.env` (spec sheet) | — (no AT command; static file) | Sourced at poller boot | `device.hw_lte_bands`, `device.hw_nsa_nr5g_bands`, `device.hw_sa_nr5g_bands` | Chip universe — all bands the modem hardware can use |
| **Policy marker** | `AT+QNWPREFCFG="policy_band"` | On boot + SIM swap | `/tmp/qmanager_supported_bands.env` cache → `device.supported_*_bands` | `device.supported_{lte,nsa_nr5g,sa_nr5g,nrdc_nr5g}_bands` | Subset of the HW universe the current SIM/network actually uses — fallback universe only (not drawn) |
| **Currently locked** | per-category registers via `current.sh` | On demand (`current.sh`) | Not cached — always live | (not emitted in status.json) | What the modem is restricted to right now |

**Why three layers exist:** `policy_band` was the original universe source but it can narrow when a SIM or firmware limits the advertised set. The static HW spec file ensures the UI always shows the full physical capability — bands the modem can use even if the current SIM doesn't announce them. The policy set is only the fallback universe when the HW list is missing; the UI no longer groups bands by it.

**Why `hw_*` does NOT feed failover.** `qmanager_band_failover` resets to the `supported_*` (policy_band) set — the set the modem has confirmed it can register on with the current SIM. Resetting to the full HW universe could include bands the SIM never activates, leaving the modem unable to re-register. `hw_*` is additive/display-only; it never enters the write path.

**Boot fallback.** If `/etc/qmanager/supported_bands_hw.env` is missing (pre-upgrade device that hasn't re-run install), the poller falls back to the `boot_supported_*` (policy_band) values for all three HW fields. The page degrades to the old single-layer behavior: every band chip uses the policy set as its universe, and no "Not used by your network" group appears. The fallback is self-healing — it resolves on the next `install.sh` run.

**NR-DC has no dedicated HW field.** `device.supported_nrdc_nr5g_bands` is still sourced from `policy_band` only. The NR-DC card borrows `hw_sa_nr5g_bands` as its chip universe (NR-DC bands are NR bands ⊆ the SA set), falling back to `supported_nrdc_nr5g_bands` on pre-upgrade devices.

### UI Band Chips and Policy Grouping

`band-locking.tsx` derives two props per lockable card:

- `supportedBands` — set to `hwBands` (from `device.hw_*`, falling back to `device.supported_*` when absent). This is the chip universe.
- `policyBands` — set to the `device.supported_*` value for that category. Used **only** for grouping.

Band chips are not checkboxes. Two facts ride two channels (`shapes.ts`): **fill** = selected in the local draft, **inset ring** = configured on the modem now (from `current.sh`). A pending add (fill, no ring) and a pending removal (ring, no fill) are therefore visible before Apply.

Bands in `policyBands` render first. Bands in `supportedBands` but not `policyBands` are no longer tinted yellow (a warning tone is a verdict, and "unused here" is not a fault); they render as a second labelled group "Not used by your network" (`legend.unused_group`) with a `HintIcon` (`legend.unused_hint`) explaining that locking only to those can leave the user without service. The group shows only when at least one such band exists.

**Critical:** `onUnlockAll`, the "all unlocked" detection and the `X of Y` ratios all measure against the full `supportedBands` universe, NOT the `policyBands` set. "Unlock all" writes the entire hardware-spec universe for that category, not just the policy-confirmed bands.

> ⚠️ WARNING: The modem may reject locking bands that lie outside its current policy set. An Unlock all that includes policy-unused bands can therefore fail at the modem. This is an accepted tradeoff — the user can see every band they chose to lock rather than having policy silently shrink the display.

**NR-DC card:** `band-locking.tsx` sets `supportedBands` for NR-DC to `hwBands.sa_nr5g`, falling back to `policyBands.nrdc_nr5g` on pre-upgrade devices. Its `policyBands` prop is `device.supported_nrdc_nr5g_bands`; bands in the SA HW universe but not the NR-DC policy set land in the "Not used by your network" group. The card has the same footer controls as LTE/NSA/SA.

### Page Layout and Hook Contract

Top to bottom: `CellularPageHeader` with a Refresh button; a read-failure `ConditionScreen` (retry gated exactly like Refresh); the scenario-override `Banner role="override"` while a non-Balanced scenario owns the bands (cards are gated); `BandStatusCard`; then the LTE and NSA cards and the shared SA / NR-DC slot card (`BandGridCard`).

**Status card.** On-air carrier tiles, a per-category lock-posture rail (each row scrolls to its card and, for SA / NR-DC, switches the slot), and the failover row: a `SegmentedField` Off/On plus a filled status chip (disabled / ready / checking / fallback active). A failed read freezes the cards in an "unavailable" posture rather than showing "0 of N".

**Hook (`hooks/use-band-locking.ts`).**
- `lockBands`, `unlockAll` and `toggleFailover` return `BandActionResult = { ok: true } | { ok: false; error: string }`; `error` is already resolved through `resolveErrorMessage`. Every mutation toasts the **returned** reason. A per-card write failure also shows in that card's `CardFoot` status (the coordinator scopes it by category).
- `readError` is a separate channel for the `current.sh` read; a write that succeeded never lands there.
- `refresh()` returns `Promise<boolean>` and sets `isRefreshing`; it never sets the skeleton `isLoading`. A refresh failure toasts (`toast.refresh_error`) since it belongs to no card.
- `FailoverState.watcher_running` is optional (only `failover_status.sh` reports it). Refresh is blocked while any write or the failover watcher runs (`current.sh` takes the AT lock, and the watcher reads a failed check as "no carrier").

### Static HW Spec File

`/etc/qmanager/supported_bands_hw.env` is a manually-maintained shell env file holding the RM551E-GL band capability for LTE, NSA NR5G, and SA NR5G. Its repo source is `scripts/etc/qmanager/supported_bands_hw.env`.

`install.sh` **force-copies** this file on every install and upgrade — it is carved out of the deploy-if-missing loop that governs all other `/etc/qmanager/*` files. This ensures that spec or firmware corrections in the repo reach existing installs without requiring a factory reset or manual file placement. The OTA worker `qmanager_update` re-runs `install.sh`, so no separate update-script edit is needed.

`uninstall.sh` removes the file along with `/tmp/qmanager_supported_bands.env` and `/tmp/qmanager_refresh_policy_band`.

---

## Policy-Band Re-Read on SIM Swap

`policy_band` was previously queried only at poller boot and cached for the poller's lifetime. A SIM swap can narrow or widen the policy set (different SIMs may expose different band subsets). To keep the policy grouping accurate after a swap, `cellular/settings.sh` drops the flag `/tmp/qmanager_refresh_policy_band` after a successful SIM swap.

The poller's `poll_cycle` checks for this flag after the `LONG_FLAG` early-return block. When present, it consumes the flag (`rm -f`) and calls the new `refresh_policy_band()` helper, which re-queries `AT+QNWPREFCFG="policy_band"`, re-parses, and rewrites `/tmp/qmanager_supported_bands.env` and the relevant `device.supported_*` fields in the next `status.json` write.

**The HW universe is NOT re-read on SIM swap.** `/etc/qmanager/supported_bands_hw.env` is hardware-spec, not SIM-dependent; sourcing it again would be redundant and waste an AT round-trip.

**Why the re-read is harmless even when redundant.** `policy_band` reflects modem hardware capabilities and is hardware-fixed in most deployments. The re-read typically returns the same set. The invariant noted in the previous version of this doc — "never changes at runtime" — holds for normal use, but the re-read is cheap insurance for edge cases (SIM firmware/carrier provisioning that narrows the advertised set) and ensures the grouping is always fresh after a swap.

**Flag placement in `poll_cycle`.** The flag is consumed after the `LONG_FLAG` early-return on purpose: a long-running cell scan short-circuits `poll_cycle` before reaching the flag check. The flag survives until the next normal cycle, guaranteeing it is eventually processed without interrupting a scan.

**QMI fallback (broker 0.7.0).** If `AT+QNWPREFCFG="policy_band"` gives no LTE list at boot or on a refresh, the poller takes the LTE list from `qmi bands` (DMS `0x0045`) for that run. When AT answered with no list, the cache file is removed and nothing is written from QMI, so the next refresh asks AT again. When the AT read failed, the QMI list is used and the cache is left as it was. NR lists always stay AT-sourced. DMS `0x0045` reports hardware band capability, not the SIM's policy set, so this is a boot-robustness fallback only.

---

## Env Cache and `status.json` Emission

After `parse_policy_band` runs during the poller's boot sequence (or during a SIM-swap refresh), the poller writes the cache and emits values into `status.json` under `device.*`. The full set of band-related fields now emitted:

```json
{
  "device": {
    "hw_lte_bands": "1:2:3:4:5:7:8:12:...",
    "hw_nsa_nr5g_bands": "41:66:71:77:78:...",
    "hw_sa_nr5g_bands": "41:66:71:77:78:...",
    "supported_lte_bands": "1:2:3:4:5:7:8:12:...",
    "supported_nsa_nr5g_bands": "41:66:71:77:78:...",
    "supported_sa_nr5g_bands": "41:66:71:77:78:...",
    "supported_nrdc_nr5g_bands": "1:2:3:5:7:8:12:14:25:26:28:30:40:41:48:66:71:77:78:79:257:258:259:260:261"
  }
}
```

`hw_*` fields are absent on a pre-upgrade device until `install.sh` has placed `supported_bands_hw.env`. The frontend falls back to `supported_*` in that case (see "Boot fallback" above).

The env cache file retains exactly four shell variable assignments for the policy set (unchanged):

```sh
boot_supported_lte_bands="..."
boot_supported_nsa_nr5g_bands="..."
boot_supported_sa_nr5g_bands="..."
boot_supported_nrdc_nr5g_bands="..."
```

**Stale-cache tolerance (pre-NR-DC):** A cache written before NR-DC support was added will lack the fourth line. Its absence means the NR-DC card chip universe falls back to an empty set until the next cold boot clears `/tmp` and the poller rewrites the full cache. Self-healing.

**Cache rewrite on SIM swap:** Since `refresh_policy_band()` rewrites the same cache file, the env cache now reflects the current SIM's policy set rather than only the boot-time set. The `hw_*` binds are emitted from the in-memory variables sourced at boot; they are not re-read from disk on swap.

---

## SA ⇄ NR-DC Swap UX

The Band Locking page uses three category cards (below the status card). LTE and NSA NR5G are fixed. The third slot is shared between SA NR5G and NR-DC; only one is visible at a time.

**How it works:**

- `BandLockingComponent` holds a `saSlotView` state (`"sa_nr5g" | "nrdc_nr5g"`), initialized to `"sa_nr5g"`.
- The third `BandGridCard` is rendered with `key={category}` (the visible slot category). Changing `saSlotView` remounts the card completely.
- A swap button in the card header calls `onSwapView()` which toggles `saSlotView` to the other value; a status-card rail row for SA or NR-DC also sets it.
- The swap button label and tooltip show the *target* mode (what you will switch to), not the current mode.

**Why remount rather than re-render:** Remounting resets the draft selection from the new mode's locked band list, rather than showing the previous mode's selected bands in the new category's chip grid. It also replays the card's entrance animation, giving a clear "mode changed" cue without any additional animation logic.

**Behavioral note:** Swapping does not send any AT command. It only changes which category is displayed and which band set is loaded. For both SA and NR-DC, the user presses Save to apply changes. NR-DC uses identical card controls to SA — Lock, Unlock all, Select all, Deselect all. The old `readOnly` / "View only" branch left with `band-cards.tsx`, and the `card_badges.view_only` key no longer exists.

---

## Lock Operation (POST `lock.sh`)

Each band card sends an independent lock request. The lock is per-category; the other three categories are untouched.

**Request:**

```json
{ "band_type": "sa_nr5g", "bands": "41:78" }
```

- `band_type`: one of `lte`, `nsa_nr5g`, `sa_nr5g`, `nrdc_nr5g`
- `bands`: colon-delimited non-empty list of band numbers. Must match `^[0-9:]+$`. There is no "lock zero bands" state.

**AT command sent:**

```
AT+QNWPREFCFG="nr5g_band",41:78
```

**Response:**

```json
{
  "success": true,
  "band_type": "sa_nr5g",
  "bands": "41:78",
  "failover_armed": true
}
```

`failover_armed` is `true` when failover is enabled and a one-shot watcher was spawned.

**Error codes:**

| `error` | Cause |
|---|---|
| `no_band_type` | Missing `band_type` field |
| `no_bands` | Missing or empty `bands` field |
| `invalid_band_type` | `band_type` not one of `lte`, `nsa_nr5g`, `sa_nr5g`, `nrdc_nr5g` |
| `invalid_bands` | `bands` contains characters other than digits and colons |
| `modem_error` | `qcmd` returned non-zero or empty |
| `at_error` | Modem responded with `ERROR` |

---

## "No Zero-Band Lock" — Why `bands,0` Is Invalid

Early in the NR-DC feature development, a "Deselect All → Save sends `,0`" behavior was considered. Investigation found that `AT+QNWPREFCFG="<param>",0` is not a valid radio capability command — band parameters require a non-empty colon-delimited allow-list. The real "remove the lock and return to all supported bands" verb is a separate AT sub-command:

```
AT+QNWPREFCFG="restore_band"
```

The existing guards are intentional:
- The UI Save button is disabled when no bands are selected.
- `useBandLocking` hook rejects an empty `[]` band array.
- `lock.sh` returns `no_bands` error on an empty field.

Do not change any of these guards to permit sending an empty or `,0` band list.

---

## Band Failover

When failover is enabled, `lock.sh` spawns `qmanager_band_failover` (double-forked, detached) after each successful lock. The watcher:

1. Sleeps 5 seconds (the failover tooltip says "about 5 seconds") to let the modem settle after the band change.
2. Queries `AT+QCAINFO`. If any `+QCAINFO:` line is present, signal is OK and the watcher exits.
3. If no carrier data is returned, it reads the LTE/NSA/SA/NR-DC supported band sets from `status.json` (falling back to the env cache) and resets each category to its full supported set. NR-DC is reset via `AT+QNWPREFCFG="nrdc_nr5g_band",${all_nrdc}` using `.device.supported_nrdc_nr5g_bands` (env fallback: `boot_supported_nrdc_nr5g_bands`).
4. Writes the `/tmp/qmanager_band_failover` flag: `"activated"` on full success, `"partial"` if any category's reset AT command failed.

The UI reads `failover_status.sh` to surface the `activated` flag as the status chip's "Fallback active" state, and `watcher_running` as "Checking".

**Lock supersedes failover:** On a new lock, `lock.sh` removes the `/tmp/qmanager_band_failover` activation flag and kills any running watcher before spawning a fresh one. The most recent lock is always the one being monitored.

---

## i18n

All five locales (`public/locales/{en,id,it,zh-CN,zh-TW}/cellular.json`) carry the band-locking keys under `cell_locking.band_locking.*`:

| Key path | Purpose |
|---|---|
| `page.title` / `page.description` | Page header |
| `actions.refresh`, `refreshing`, `refresh_blocked_watcher` | Refresh button, live-region text, blocked-while-watcher reason |
| `read_error_title`, `errors.{read_failed,no_bands,no_supported,lock_failed,failover_failed}` | Read-failure screen and returned write reasons |
| `scenario_gate_title`, `scenario_gate_note` | Scenario-override banner |
| `settings_card.*` | Failover row: label, tooltip (about 5 s), `status.{disabled,ready,fallback,monitoring}`, `toast.{failover_enabled,failover_disabled}` |
| `cards.<category>.{title,description}` | Per-category card copy (incl. `nrdc_nr5g`) |
| `card_category_label.<category>`, `card_buttons.{lock_selected,select_all,deselect_all,unlock_all,swap_view}` | Swap target label and footer buttons |
| `card_badges.*`, `card_empty`, `card.{empty_title,unavailable_note,pending_one,pending_other}` | Ratios, posture chips, empty and unavailable states, unsaved-change count |
| `toast.{locked_success,unlocked_success,refresh_error}` | Confirmations |
| `legend.{selected,live,unused_group,unused_hint_label,unused_hint}` | Chip key and the "Not used by your network" group |
| `a11y.{band_live,band_selected,band_unselected}` | Chip accessible names |
| `status.*` | Status card: on-air tiles, lock-posture rail, subtitles |

The "Not used by your network" group renders only when a card has at least one band outside the policy set (i.e., when `hw_*` is populated and differs from the policy set). On a pre-upgrade device where `hw_*` is absent, no group appears.

---

## Force-Tier-2 Refresh After Band Lock

After a successful band lock, `lock.sh` sleeps 2 seconds (modem re-registration settle) and then touches `/tmp/qmanager_force_tier2`. The CGI is a write-only producer — it never reads or parses the file.

The poller's `poll_cycle` checks for the flag after the `LONG_FLAG` early-return block. When present it consumes the flag (`rm -f`) and immediately runs `poll_tier2` + `read_sim_state` + `refresh_sim_identity`. This refreshes operator name, APN, DNS, WAN-IP, ICCID, and IMSI within ~4 seconds of the lock, rather than waiting up to ~30 seconds for the next Tier-2 boundary.

**Why:** A band change forces the modem to re-register on a different carrier cell. The new cell can advertise a different operator name, APN, and network addressing. Without the flag, the UI shows stale data for the full Tier-2 cadence (`TIER2_EVERY=15` × `POLL_INTERVAL=2s` ≈ 30s).

**Invariants to preserve:**
- `lock.sh` MUST NOT write `/tmp/qmanager_status.json`. The poller is the sole atomic writer of that file (via `write_cache`). The CGI only touches the flag.
- The flag check is placed AFTER the `LONG_FLAG` early-return in `poll_cycle` on purpose. A long-running cell scan returns early before the Tier-2 block — the flag survives until the next normal cycle.
- `refresh_sim_identity` re-reads `AT+CIMI;+QCCID` only; it has no band-lock or profile side effects.

See also [`docs/features/custom-sim-profiles.md`](custom-sim-profiles.md) — `cellular/settings.sh` is the other producer of the same flag, triggered on SIM slot switch.

## Related Docs

- [`docs/features/custom-sim-profiles.md`](custom-sim-profiles.md) — band lock per profile via Connection Scenario binding; also uses the force-Tier-2 flag
- [`docs/features/scenario-profile-binding.md`](scenario-profile-binding.md) — how scenario band locks are applied at profile activation
