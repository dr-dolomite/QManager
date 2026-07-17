# Known-SIMs Database

QManager tracks a persistent set of ICCIDs it has already "seen." A SIM is considered new — triggering the "New SIM detected" toast and banner — only when its ICCID is absent from this set. Adding the ICCID to the set happens immediately on detection, so the banner fires exactly once per SIM.

This model replaced the older single-value `/etc/qmanager/last_iccid` scheme, which could only remember one prior SIM and caused spurious banners whenever a second or third SIM was cycled back in.

## Quick Reference

| Item | Value |
|---|---|
| Shared library | `scripts/usr/lib/qmanager/sim_db.sh` |
| CGI endpoint | `scripts/www/cgi-bin/quecmanager/system/known_sims.sh` |
| Persistent set file | `/etc/qmanager/known_iccids` (UBIFS, newline-delimited) |
| Legacy file (retired) | `/etc/qmanager/last_iccid` (read-once for migration; no longer written) |
| Banner flag | `/tmp/qmanager_sim_swap_detected` (tmpfs; cleared by `clear` action) |
| Frontend component | `components/system-settings/known-sims-row.tsx` |
| Frontend i18n namespace | `system-settings`, keys `known_sims.*` |

## Storage Format

`/etc/qmanager/known_iccids` is a plain-text newline-delimited file, one normalized ICCID per line. It lives on UBIFS and survives reboots. Membership is tested with `grep -qxF` (whole-line, fixed-string match), so every stored line must be exactly the byte string the QCCID read pipeline produces — no trailing whitespace, no carriage returns.

## `sim_db.sh` API

All functions are in `scripts/usr/lib/qmanager/sim_db.sh`. The file guards against double-sourcing with `_SIM_DB_LOADED`. Internal variables use the `_simdb_` prefix to avoid clobbering caller scope.

| Function | Signature | Returns | Purpose |
|---|---|---|---|
| `sim_db_normalize` | `<raw>` | prints normalized string | Strip space/CR/LF from a raw ICCID string. Matches the canonical `tr -d '\r '` pipeline output. |
| `sim_db_seed_if_absent` | — | 0 = prior knowledge existed; 1 = fresh empty set created | Migration + first-run guard (see below). |
| `sim_db_known` | `<iccid>` | 0 = member; 1 = not member | Membership test via `grep -qxF`. Empty input is never a member. |
| `sim_db_add` | `<iccid>` | — | Idempotent append. Normalizes input; checks membership before appending to avoid duplicates. |
| `sim_db_clear_keep` | `<iccid>` | — | Rewrite the set to contain only the given ICCID. Empty input truncates to an empty set. |
| `sim_db_count` | — | prints integer | Count of non-empty lines in the set file. Prints `0` when the file is absent. |

## `sim_db_seed_if_absent` — Migration and Fresh-Device Suppression

This function runs once at the poller's boot-time SIM-detection site and must be called before any membership check. It has two jobs:

1. **Migration**: if `known_iccids` does not exist but the legacy `last_iccid` file is non-empty, it seeds the new file from `last_iccid`. This means the SIM that was current before the upgrade is not re-flagged as new after the upgrade. `last_iccid` is then left in place but is never written again.

2. **Fresh-device suppression**: if neither file exists (a device that has never run QManager, or one that was reset), the function creates an empty `known_iccids` and returns **1**. The poller checks this return code and skips the new-SIM detection path entirely. Without this guard, the very first boot would always false-fire the banner.

**Why the return code matters**: the old scheme suppressed false-fire via `[ -f last_iccid ]` — the file's existence was the gate. The new scheme preserves that semantic through the return code. If you refactor the poller's boot-time detection block, preserve the `_had_prior_sim_db` gate.

```sh
# Correct pattern (from qmanager_poller):
local _had_prior_sim_db=0
if sim_db_seed_if_absent; then _had_prior_sim_db=1; fi
if [ -n "$boot_iccid" ]; then
    if [ "$_had_prior_sim_db" = "1" ] && ! sim_db_known "$boot_iccid"; then
        # ... fire banner ...
    fi
    sim_db_add "$boot_iccid"
fi
```

## Byte-Parity Requirement

Membership is a fixed-string whole-line match. A stored ICCID that differs from the polled ICCID by even one byte (a trailing space, a CR, letter case) will never match, causing the banner to re-fire on every boot.

The canonical QCCID read pipeline is:
```sh
qcmd 'AT+QCCID' 2>/dev/null | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r '
```

All six write sites use exactly this pipeline (or `sim_db_normalize`, which reproduces its effect). They are:

| Site | File | Approx. line |
|---|---|---|
| Boot detector | `qmanager_poller` | ~462 |
| Profile activation | `qmanager_profile_apply` (via `mark_sim_acknowledged`) | ~401, ~543 |
| UI SIM-slot switch | `cellular/settings.sh` (post-switch `sim_switch` block) | ~346 |
| Watchcat SIM revert | `qmanager_watchcat` | ~440 |
| Watchcat SIM failover | `qmanager_watchcat` | ~644 |
| CGI clear action | `system/known_sims.sh` | ~56 |

> ℹ️ NOTE: The UI SIM-slot switch (`cellular/settings.sh`) registers the switched-to SIM so the Known SIMs count updates immediately and a deliberate switch does not trigger a redundant "New SIM" toast on the next poller boot. Without it, a slot switch would not register the new SIM until the next reboot ran the boot detector.

> ⚠️ WARNING: If you add a new QCCID read site, use the identical pipeline. Do not use the profile's stored `sim_iccid` field as a substitute — that field may be hand-typed or carry a different format than the modem's `AT+QCCID` response.

> ℹ️ NOTE: `sim_db.sh` also defines `iccid_canonicalize()`, a **compare-time-only** helper (strips space/CR/LF like `sim_db_normalize`, plus one trailing BCD pad `F`/`f`) used by Custom SIM Profiles' `auto_apply_profile` matching and the manual/auto apply worker's stale-SIM guard. It exists to reconcile read paths that disagree on whether they keep an ICCID's trailing pad nibble. It must never be used to rewrite what gets *stored* — `sim_db_add` and this file's byte-parity requirement above are unaffected; only comparisons run through it. See [`docs/features/custom-sim-profiles.md`](custom-sim-profiles.md) — "ICCID Canonicalization" for the full contract.

## Lock-Free Duplicate Tolerance

`sim_db_add` is check-before-append but not atomic. In theory, two concurrent callers (for example, the poller at boot and a profile activation that completes in the same second) could both observe "not a member" and both append. The file would then contain two identical lines.

This is intentional. Membership (`grep -qxF`) is indifferent to duplicates — a line appearing twice reads as a match just as well as once. The `sim_db_count` function uses `grep -c .` which counts lines (so duplicates inflate the count slightly), but the count is only used for the UI display and has no behavioral effect on detection logic.

> ℹ️ NOTE: No flock or mutex guards `sim_db_add`. Do not add one without auditing that all six write sites can acquire it — the poller and watchcat run as independent daemons and a deadlock here would block boot-time SIM detection indefinitely.

## CGI: `system/known_sims.sh`

Sources `cgi_base.sh` and `sim_db.sh`. Handles GET, POST `list`, POST `clear`, and rejects any other method with `cgi_method_not_allowed`.

**GET** and **POST `{"action":"list"}`** are equivalent: both return `{ "success": true, "count": N }`.

**POST `{"action":"clear"}`**:
1. Reads the live ICCID via `AT+QCCID` (same canonical pipeline as all other sites).
2. Calls `sim_db_clear_keep` with that ICCID — rewrites the set to a single entry.
3. Removes `/tmp/qmanager_sim_swap_detected` so a stale banner flag does not linger after a clear.
4. Returns `{ "success": true, "count": N }` where N is 1 if a SIM is present, 0 if not.

**Why clear keeps the current SIM**: clearing the set exists to let a user "forget" old SIMs (so they stop counting against the set but won't re-trigger the banner for the SIM that is actually in use right now). If the current SIM were also removed, the very next reboot would immediately fire the banner again, defeating the purpose of the control.

Unknown actions return `cgi_error "invalid_action"`.

## Frontend: `known-sims-row.tsx`

Rendered inside `components/system-settings/system-settings-card.tsx`. Shows:

- Left side: info-tooltip + "Known SIMs" label.
- Right side: the current count (fetched on mount via GET) + a destructive **Clear** button.

Clicking Clear opens an `AlertDialog` that explains the current SIM will be kept. On confirm, POSTs `{"action":"clear"}` and updates the displayed count from the response.

i18n keys live under `system-settings.known_sims.*` in all four locales (en, id, it, zh-CN) with full key parity.

## `previous_iccid` Shape Compatibility

The banner flag JSON (`/tmp/qmanager_sim_swap_detected`) retains the `previous_iccid` field for frontend shape compatibility. Under the set model there is no single "previous" ICCID, so the field is always written as `""`. The frontend toast (`components/monitoring/watchdog/sim-swap-banner.tsx`) does not display `previous_iccid`; it is safe to keep as a zero-value permanently.
