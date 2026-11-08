# CQ × Watchdog UI build: plan (for the owner's OK)
> **Shipped (RM551E):** merged into development-home as dbfc827f on 2026-11-08. Archived; the live docs are docs/features/connection-quality.md and connection-watchdog.md.

Branch `claude/cq-watchdog-ui-c815f0` (cut from `feat/cq-watchdog-unify` @ c316bf08). No `scripts/` edits.
Design source: the approved artifact (2U4fFKyDFQ4HT9HqnvBXeU) + Amendment 3 frontend list, in the canon.

## What exists

Both pages already have the canon structure (page header + card pair; watchdog hero, ladder, detection,
activity, per-card `CardFoot`). They talk to the old contract: `system/ping_profile.sh`,
`system/quality_thresholds.sh` (removed) and the old watchdog GET (`fail_threshold`, `cooldown`,
`probe_interval`, `primary_recheck_*`, …). So this is a rework of ~5.3k lines, not a greenfield build.

## Data layer (step 1, one builder, then everything else builds on it)

- `types/modem-status.ts`: `WatchcatState` + `holdoff`; `WatchcatStatus` + the §4.2 hero keys;
  connectivity + `sensitivity`, `last_leg`, `fail_secs`, `recover_secs`; `NetworkEvent.code?`.
  New `types/cq-watchdog.ts`: CQ GET (§5.1 + `live` + `last_outage`), watchdog GET (§5.3 incl. the full §3
  status object + Amendment 1 C + A3 keys), save payloads, error envelope.
- `hooks/use-connection-quality.ts` (new; replaces and deletes `use-ping-profile.ts` +
  `use-quality-thresholds.ts`): GET, `saveProbe`, `saveThresholds`, results returned (not hook state) per the
  toast canon. Light 5 s visible-interval refresh of `live` only, never resetting a draft.
- `hooks/use-watchdog-settings.ts` (rewrite): GET polled every 5 s while visible (`lib/visible-interval.ts`)
  because the hero needs `offline_secs`, `tiers_tried`, `last_success_*`, `carrier_*`, which are NOT in
  `status.json`. `settings` keeps identity across polls so drafts survive. Actions: `save_settings`
  (partial), `revert_sim`, `retry_failback`.
- `hooks/use-watchdog-indicator.ts`: sidebar dot learns `holdoff`.

## Connection Quality page (step 2a, builder A)

Artifact layout, two cards in the pair:
1. **Probe Targets**: Primary slot + 3 Fallbacks (HintIcon), a numbered disc per slot carrying `live` state
   (ok + RTT / No reply / skipped (no IPv6) / Standby), the answering row lit; live verdict in the foot
   status; Save sends `save_probe` with the *saved* sensitivity. Client validation mirrors §5.2.
   **New (A3.1): "Last outage" row** under the slots: "About 2 min 10 s, ended 1 h ago" + WAN-IP-changed
   note, "Since the last restart" caption; "None since the last restart" when null. While `live.reachable`
   is false it reads "Down now".
2. **Sensitivity and Quality**: 4-column sensitivity comparison (Every / Down after about / Up after,
   from GET `tables`), then Latency and Packet loss blocks (presets from `tables`, Custom field with range,
   "Right now" from `status.json` connectivity, amber over the limit). One Save → `save_probe` (saved
   targets + new sensitivity) and/or `save_thresholds`, one toast. Values shown as entered (floors live on
   the Watchdog only).
Three states per card; skeletons import the loaded shapes.

## Watchdog page (step 2b, builder B; Opus medium if it proves too tangled)

- **Hero**: every phase in the artifact gallery (monitor, suspect, recovery, cooldown, holdoff by reason
  outage / quality / **carrier**, radio_off, ssr_hold countdown, ping stale, locked, disabled), one glyph each.
  Figures: Offline for (or Poor quality for / On one carrier for), Recoveries (caption
  **"Since last restart"**), Reboots N of limit (resting until … when spent), and **new (A3.2) "Last fix"**:
  "2 h ago", caption "Step 1, took 41 s"; "—" + "None since last restart" when null. Probe strip unchanged
  (status.json history).
- **Recovery Ladder**: "Recover automatically" first row (saved with the ladder); tier rows whose disc
  carries tried / running / resting / not used (from `tiers_tried`, `current_tier`, `state`,
  `reboot_rest_*`); Tier 3 gated on `sim_dual_capable` with backup-slot `SegmentedField`; failback child row
  with next try, "Gave up after 3 tries" + **Try again now** (`retry_failback`, toast); Tier 3/4 read "Not
  used for poor quality" / **"Not used for one-carrier recovery"** while that reason runs; reboots per hour;
  Advanced: failback every N min.
- **Detection**: read-only "Down after about X s (Relaxed)" linking to Connection Quality (CQ GET read once);
  Start recovery after (15 s / 30 s / 1 min / 2 min / Custom, effective clamp "→ 20 s"); Quality trigger
  (Off/On, 1 / 2 / 5 / 10 min / Custom, "Poor is over 250 ms or 30 % loss" with floor clamps from
  `effective.quality_limits`); **new (A3.3) Carrier trigger**: Off/On `SegmentedField`, "After" 5 / 15 / 30 /
  60 min / Custom (5-240, default 15), HintIcon (only after carrier aggregation was seen since boot; steps 1-2
  only), visible consequence "Step 1 drops the link for a few seconds; the WAN IP may change", "Right now: 1
  carrier for 6 min" from `carrier_single_secs` / `carrier_cc`. No "not available in 5G SA" fact (the gated SA
  read covers SA). Advanced: wait between steps (effective clamp), baseband restart hold. "If the link drops"
  timeline from effective values.
- **Recovery Activity**: rows by event `code` (§6 table, incl. hold-off, budget spent, ping stale, failback
  give-up, carrier start/success: "Link back after step N" / "Carrier aggregation back after step N");
  English-text matching kept only as the fallback for pre-upgrade rows without `code`.

## i18n (step 3)

Builders add **en** keys only (their own subtree: `connection_quality.*`, `watchdog.*`); then one builder
fills zh-CN, it, id and zh-TW (OpenCC s2twp from zh-CN + term alignment), drops dead keys, `bun run test:i18n`.

## Validation (step 4, me)

`bunx tsc --noEmit`, `bun run lint` on touched files, `bun run icons:check`, `bun run test:i18n`; grep the
diff for `/etc/`, `/tmp/`, `uci `, `AT+`. Browser preview on `next-dev` with a **local fetch shim fed from
`tools/cq-wd-contract/fixtures/**`** (nothing deployed to the modem, so the live device can't serve the new
CGIs): healthy, outage, quality hold-off, budget resting, carrier, failback gave up; light + dark; narrow
container. The shim is never committed.

## Docs (step 5)

Frontend sections of `docs/features/connection-quality.md` and `connection-watchdog.md` (hooks, polling,
code-based activity). Backend sections stay with the backend lead.

## Risks / rollback

- Polling the watchdog GET every 5 s adds a CGI + jq run per 5 s while the page is open (stops when hidden).
- Old routes/hooks deleted in the same branch; rollback = discard the branch.
- Commits: data layer, CQ page, watchdog page (several), i18n, docs. Never merged by me.

## Decisions I need

1. OK to poll the watchdog GET every 5 s while the page is visible (the hero data isn't in `status.json`)?
2. "Last outage" as a row in Probe Targets, and "Last fix" as a 4th hero figure: OK?
3. Carrier presets 5 / 15 / 30 / 60 min + Custom: OK?
