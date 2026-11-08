# QMI DMS reads: online state and IMEI off the AT lane

Date: 2026-11-08. Status: draft, awaiting approval.

## Goal

Move the frequent standalone AT reads of radio state (`AT+CFUN?`) to `qmi opmode`, so the poller and watchdog stop queueing on the AT lane for a value QMI answers in about 5 ms without the AT lock. Fix the stale IMEI compare in IMEI Settings. No broker change: `qmi rev`, `qmi ids` and `qmi opmode` already exist, decode, and match AT on the RM551E (probe 2026-11-08).

## What is in and out

| Call site | AT today | Decision | Why |
|---|---|---|---|
| Poller Tier 1, `qmanager_poller:3014` | standalone `AT+CFUN?` every AT-due cycle (2 s in Active) | **Move** (hybrid, below) | Highest volume; one full AT round trip per cycle |
| Watchdog `wd_cfun_now`, `wd_state.sh:190` (callers in watchcat, `wd_detect`, `wd_sim`, `wd_tiers`) | standalone `AT+CFUN?` | **Move** (same hybrid) | Runs during recovery, when the AT lane is most likely stuck |
| IMEI Settings `cellular/imei.sh` | GET reads the poller cache; POST compares against it | **Fix** with a pending marker | Write X then the original before reboot is skipped as "already set" |
| Config backup `collect_imei`, `config_backup_sections.sh:853` | cache, then `AT+CGSN` | **Move the fallback** to `qmi ids`, then AT | Cheap, same helper |
| Poller boot identity, `qmanager_poller:847` | one compound AT that also carries CIMI, QCCID, CNUM, capability | **Keep** | Dropping CGMM/CGSN from a compound saves nothing; CVERSION also gives build date, which QMI does not |
| About Device `device/about.sh` | none (cache only) | **Keep** | Already free |
| Cellular Settings GET, profile form GET | `CFUN?` / `CGSN` inside a compound | **Keep** | Inside a compound, so no round trip saved |
| `qmanager_profile_apply` post-reboot `CGSN` verify, health check | AT | **Keep** | Verify straddles a `CFUN=1,1` reboot; the health check exists to test the AT path |

## The hybrid rule (radio state)

Every consumer only needs "is it 1", plus the exact 0 or 4 for display and the airplane-mode event (`events.sh:676`, `network-status.tsx:312`, `status-rail.tsx:333`). So:

- `qmi opmode` says `online` (code 0) → CFUN is 1, no AT.
- Anything else (low_power, offline, `modem_not_ready`, broker without `qmi=1`) → fall through to today's `AT+CFUN?` for the exact digit.

Steady state (online) never touches the AT lane. Rare states keep today's exact behaviour. `wd_cfun_now` keeps its contract: prints 0, 1 or 4, or nothing for unknown.

**Gate:** this is only correct if `opmode` is never `online` while CFUN is 0 or 4. Phase 0 proves that on the device.

## Phase 0: live validation (needs your OK; drops the data connection briefly)

1. Baseline: `qmi opmode` and `qcmd 'AT+CFUN?'` paired, 10 reads.
2. `AT+CFUN=4`, read both 5 times over 10 s, then `AT+CFUN=1` and confirm both return to online/1 and data comes back.
3. Same with `AT+CFUN=0`.
4. Watchdog and watchcat held off during the test (the watchdog treats CFUN 0/4 as user airplane mode, but confirm it is disabled or in hold-off first).

Expected: CFUN 0 and 4 read as `low_power` (or another non-online code). If either reads `online`, stop: the plan drops to the IMEI part only.

The IMEI part does not depend on whether `qmi ids` shows a pending EGMR value before reboot, so no test IMEI write is needed.

## Build (bottom-up)

1. **New lib** `scripts/usr/lib/qmanager/qmi_dms.sh` (copied by `install_dir_flat`, so no installer edit; check the ipk manifest picks it up):
   - `qm_qmi_ready`: `/usr/bin/qmi` executable and `qmi=1` in `/var/run/qmanager_atd.proto` (same test as the poller's `_qmi_cli_ready`, which then calls it).
   - `qm_qmi_online`: rc 0 only when `qmi opmode` returns `ok:true` and `mode == "online"`. jq without regex, null-safe.
   - `qm_qmi_imei`: prints a 15-digit IMEI from `qmi ids`, or nothing.
   - Sourced with `[ -f LIB ] && . LIB` (a missing file must not abort BusyBox `.`).
2. **Poller**: before the Tier 1 `AT+CFUN?`, `qm_qmi_online && t1_cfun=1` and skip the AT read; otherwise today's code. `_tap_at` is not called on the QMI path (it records AT replies only).
3. **Watchdog**: `wd_cfun_now` tries `qm_qmi_online` first, prints 1; otherwise today's AT read.
4. **IMEI Settings** (`cellular/imei.sh`):
   - POST success writes the new IMEI to `/tmp/qmanager_imei_pending` (`qm_atomic_write`; `/tmp` clears on reboot, which is exactly when the write takes effect).
   - POST compares the request against the pending value if present, else the cache. Writing the original back before reboot now really writes it (and updates the marker).
   - GET adds `pending_imei` (empty when none). Additive, so old frontends ignore it.
5. **Config backup** `collect_imei`: cache, then `qm_qmi_imei`, then `AT+CGSN`.
6. **Frontend** (small): `use-imei-settings.ts` type gains `pending_imei`; the IMEI card shows it as an `info` Badge ("Applies after reboot") while it applies. i18n key in all five catalogs.

## Risks

- **opmode/CFUN disagreement** in a state not tested in Phase 0 (factory test, persistent low power). Mitigated: only `online` short-circuits; everything else still asks AT.
- **SSR window**: QMI answers `modem_not_ready`, which falls through to AT, the same as today.
- **Older broker** without `qmi=1`: `qm_qmi_ready` fails, AT path as today.
- **Pending marker vs a reboot from outside QManager**: `/tmp` clears on any reboot, so the marker never outlives the pending write.
- `qmanager_profile_apply` also writes the IMEI (`:508`) but reboots at once, so it needs no marker.

## Validation

- Static: `.claude/check-crlf.sh`, BusyBox/POSIX audit (one `local` per line, jq null-handling and no regex, guarded dot-source), `bunx tsc --noEmit` + lint on touched TS.
- On device: deploy with `sync`; poller log shows no `AT+CFUN?` in Active while online; `status.json` `network.cfun` stays 1; `CFUN=4` → `cfun` 4 and the airplane event fires; watchdog start gate still honours user airplane mode; IMEI GET/POST round trip including the X-then-original case (write with your OK only, and with a reboot after).

## Rollback

Each consumer falls back to AT on any QMI miss, so reverting is a plain `git revert` of the build commits. No UCI, init.d, firewall or broker change.

## Docs

`qmi-lane.md` (named reads `rev` / `ids` / `opmode` and their shell consumers; "IDs, revision, op mode" row moves from candidate to used), `connection-watchdog.md` (`wd_cfun_now` source), `adaptive-polling.md` (Tier 1 CFUN), `RELEASE_NOTE.md` (IMEI fix under Improvements).
