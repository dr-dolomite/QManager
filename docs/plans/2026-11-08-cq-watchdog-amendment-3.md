# CQ × Watchdog: Amendment 3 (approved by the owner 2026-11-08)
> **Shipped (RM551E):** merged into development-home as dbfc827f on 2026-11-08. Archived; the live docs are docs/features/connection-quality.md and connection-watchdog.md.

Owner request 2026-11-08: (1) know the last disconnection and its duration, (2) know the last
restore, (3) an opt-in watchdog trigger for a modem stuck on one component carrier (1CC), with a
configurable duration in minutes and a sensible default, disabled by default. Extends spec v2
(`2026-11-07-cq-watchdog-unified-architecture.md`) and the frozen contracts
(`2026-11-07-cq-watchdog-contracts.md`). An independent Opus review (2026-11-08) checked the draft,
the spec, the contracts and the 1b plan; the owner answered its decision list the same day:

| Question | Owner answer |
|---|---|
| R9b: Tier 2 skip on band locks (no file records a band lock on the RM551E) | **Drop it on RM551E**; confirm read-only in Step 4 that a radio restart keeps the band lock |
| "Last restore" meaning | **Show both**: connection back (A3.1) and last successful watchdog recovery (A3.2) |
| 1CC design | **Simple draft** (no traffic gating, armed once per boot, `carrier_*` names), **plus a gated SA read** (poller AT carrier read in idle/deep tiers only while the toggle is on) |
| Persist recovery history across restarts | **No**, in memory; the UI labels it "since last restart" |

## R9b disposition (spec §5.4 / §7 deviation, approved)

The RM551E has no NSA tower lock (`tower_lock.json` holds only `lte` and `nr_sa`,
`tower_lock_mgr.sh:44`; `tower/lock.sh:54,322`) and no file-based band-lock state (`bands/lock.sh:86`
writes only the modem NV via `AT+QNWPREFCFG`; `policy_band` in the poller is the carrier's
*supported* list, not the lock). `plat_tower_locked` on the RM551E stays LTE + NR-SA tower locks.
Band locks live in modem NV and are expected to survive `CFUN=0/1`; Step 4 adds a read-only check
(read the configured bands before and after a Tier 2 in the live test). The RM520N port binds
`plat_tower_locked` to whatever lock state it has.

## A3.1 Last outage (Connection Quality) — mostly exists

Already published: `status.json.connectivity.last_outage_s`, `last_outage_ago_s`,
`last_outage_wan_ip`, `last_outage_wan_changed` (poller from `/tmp/qmanager_last_outage`, alert
engine, this boot only). Addition: `GET monitoring/connection_quality.sh` gains
`"last_outage": {"duration_s": int, "ended_ago_s": int, "wan_changed": bool|null} | null`, read
from the same file (no new writer), `null` until an outage clears this boot. An outage still in
progress comes from ping.json `fail_elapsed_sec` (also valid while the watchdog is disabled), not
watchdog `offline_secs`. Durations are measured between the debounced edges (start about
`fail_secs` late, end about `recover_secs` late): the UI says "about" and "since the last restart".
Lands with the Step 3 CQ CGI.

## A3.2 Last successful recovery (Watchdog) — in memory

New state keys (contract §3, CGI `status`; not republished in `status.json.watchcat`):
`last_success_time` (int|null, epoch; null while the clock is insane per the 1970 rule),
`last_success_tier` (int|null), `last_success_reason` (`outage|quality|carrier`|null),
`last_success_took_s` (int|null, trigger to verdict). Set when a cooldown verdict is success (the
`wd_succeeded` event). A natural recovery does not count; a Tier 4 reboot cannot reach a verdict
and is not recorded (in memory only, owner decision). `total_recoveries` and `last_recovery_*` stay
in memory too; the UI labels all of them "since last restart". The `wd_succeeded` row in the event
log does not carry an offline duration; the UI's "Link back after step N" text uses the step only.

## A3.3 Stuck on one carrier (Watchdog, opt-in)

**Settings** (`watchdog`, spec §3.2): `carrier_enabled` bool, default `false`;
`carrier_after_min` int, default **15**, range 5-240. CGI rejects out-of-range as `invalid_field`.
Migration: new keys only, seeded off. Config Backup carries them.

**Signal (data source is a fact, not a choice).** The carrier count must be fresh while the UI is
idle, and the poller's deep tier skips carrier reads (poller ~:2983, Adaptive Polling Invariant 7).
The broker's QMI sidecar (`/var/run/qmanager/qmi.env`) is rewritten every 2 s whatever the poller
tier, so the watchdog reads it through the adapter: `plat_cc_count` parses it WITHOUT sourcing (as
`data_used.sh` does), requires the end marker, `qmi_state=up`, `qmi_registered=1` and a
`qmi_mono` age ≤ 10 s, and sets `PLAT_CC` = 1 + configured LTE SCCs (`qmi_ca_count`), or empty =
unknown. No second QMI reader, no AT. QMI exposes LTE carriers only, so for 5G SA / NR-DC the
count comes from the gated SA read below. RM520N binds `plat_cc_count` to its own source in the port.

**Gated SA read (owner, 2026-11-08: "Add gated SA read").** When the serving RAT is not LTE / NSA
(QMI not registered on LTE, or the poller's serving cell reports SA or NR-DC), `plat_cc_count`
falls back to an AT-derived count. The poller supplies it: while `carrier_enabled=1`, it keeps
`AT+QCAINFO=1;+QCAINFO;+QCAINFO=0` (one exchange, never leaving `=1` set, R01A04 rule) running in
the idle and deep tiers, at most once per 60 s (the active tier already reads it), and writes the
NR component-carrier count plus its read mono to a small sidecar `PF_RUN_DIR/ca.env`
(`qm_atomic_write`, end marker, parsed without sourcing). The fallback is valid only when that read
is ≤ 90 s old; otherwise unknown. With the toggle off the deep tier stays QENG-only (Adaptive
Polling Invariant 7 unchanged); the read never runs while LOCKED, during a scan, a SIM switch or
radio off (existing poller AT-suppression rules). Cost: about one extra AT command per minute only
while the feature is on. NSA counts the LTE side from QMI (anchor + LTE SCCs); the NR leg is not
added in v1 (QMI's EN-DC flag is unvalidated). `docs/features/adaptive-polling.md` Invariant 7
gains the gated exception.

**Arming.** Counts only after this boot (or settings reload) has seen ≥ 2 CCs at least once. Never
while LOCKED, radio off, SSR hold, an outage episode, or `plat_tower_locked`.

**Trigger.** `reachable=true` AND a fresh 1CC read, continuously for `carrier_after_min` on the
mono clock (`carrier_single_secs` in the state file). Unknown keeps the timer; ≥ 2 resets it.
Trigger priority when more than one is due on the same pass: outage > quality > carrier.

**Ladder.** Reason `carrier`: Tier 1 and Tier 2 only (Tier 3 and Tier 4 always skipped, like
quality). Start gate and hold-off as quality: own hold-off 15 → 30 → 60 min (`holdoff_carrier_level`
0-2), resets after a clean hour, cleared early by ≥ 2 CCs or a settings save; never blocks an
outage or quality ladder and vice versa; the reported hold-off is the one that ends last (outage
wins a tie, then quality). Verdict: success iff a fresh read ≥ 2 CCs and still reachable; unknown →
extend, max 3, then inconclusive (tier kept); link down at the verdict → the outage trigger takes
over on its own rules. Tier 1 drops a working link briefly (the WAN IP may change): the UI says so
next to the toggle. Reboot budget untouched.

**Contracts touched.** Reason vocabulary `outage|quality|carrier` in `recovery_reason`,
`last_recovery_reason`, `holdoff_reason`, `last_success_reason` — `recovery_reason` and
`holdoff_reason` ARE in the `status.json.watchcat` hero set (contracts §4.2), so both poller
composers, `tools/poller-parity/status_parity.sh` and the contract fixtures accept the new value.
New state keys `carrier_single_secs` (int), `carrier_cc` (int|null, last read),
`holdoff_carrier_level` (0-2). Spec §5.4 skip column: "quality or carrier reason" for Tiers 3 and
4. Spec §6: a settings save also resets the carrier hold-off growth and re-arms the trigger. Event
texts `Watchcat: starting recovery (Tier N) — stuck on one carrier for M min` (code
`wd_tier_start`) and `Watchcat: recovery succeeded (Tier N) — carrier aggregation restored` (code
`wd_succeeded`). Watchdog GET `settings` + `effective` gain the two keys; POST `save_settings`
accepts them. Prometheus unchanged.

## Build slots

- R9b: nothing to build on the RM551E beyond this note (Step 4 read-only check added).
- R10 (after R9c/R9d): A3.2 last success, in memory.
- R11: A3.3 carrier trigger + `plat_cc_count` adapter binding, harness scenarios (never-CA boot,
  lock skip, unknown reads, SA via the AT sidecar, stale sidecar = unknown, priority vs outage and
  quality, hold-off growth). Poller part (not neutral): the gated idle/deep `QCAINFO` read and
  `ca.env` writer, `tools/poller-parity` updated; on-device AT-cadence check in Step 4.
- Step 2: migration seeds `carrier_enabled=0`, `carrier_after_min=15`; Config Backup
  `_WATCHCAT_KEYS` (`config_backup_sections.sh:499`) switches to the new names and gains the A3 keys.
- Step 3: A3.1 CQ GET field; watchdog GET/POST keys; status.json composers + parity for the
  `carrier` reason value.
- Frontend (separate session, after Step 3): CQ "Last outage" fact; watchdog hero "last successful
  recovery" figure; detection-card carrier row (SegmentedField, minute presets, HintIcon, Fact-Is-Info
  "not available in 5G SA", Tier 1 link-drop note); Tier 3/4 rows "not used for carrier"; activity
  rows by code; all copy in five catalogs; "since last restart" labels.

## Review findings carried to other steps (not A3)

- Config Backup `_WATCHCAT_KEYS` still lists the old key names (Step 2 owns it).
- The ipk manifest must list any new lib file (Step 2).
