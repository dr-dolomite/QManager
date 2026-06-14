## Device & Architecture Context

QManager is a Next.js (static export) frontend + OpenWRT CGI shell backend, deployed **onto the modem itself** (Quectel RM520N/RM551E/RM500Q-class running OpenWRT). Backend = BusyBox `/bin/sh` scripts under `scripts/www/cgi-bin/`, daemons under `scripts/usr/bin/`, shared libs under `scripts/usr/lib/qmanager/`. Modem talks via `qcmd` AT-command wrapper. Because the app runs on the device, anything that reboots the modem also kills any in-flight HTTP request — defer reboots via dialog + persistent banner, never `AT+CFUN=1,1` mid-request.

See `docs/ARCHITECTURE.md`, `docs/BACKEND.md`, `docs/FRONTEND.md`, `docs/API-REFERENCE.md` for full breakdowns.

## Change Workflow

Every code-change request in this repo follows a tier-routed, 6-phase flow. Opus orchestrates; the specialist agents do the work. The user holds the approval gate. This flow is the project default for code changes and supersedes the generic brainstorming / writing-plans / verification skills; test-driven development still applies inside Phase 4 wherever tests exist.

**Signal each phase transition** with a header so the user always knows where we are: `**[Phase 1 — Triage]**`, `**[Phase 2 — Plan]**`, `**[Phase 3 — Approval]**`, `**[Phase 4 — Execute]**`, `**[Phase 5 — Validation]**`, `**[Phase 6 — Docs & Close]**`.

### The 6 Phases

1. **Triage & Recon (Opus):** Classify the request into Tier 0–4 by blast radius. For every **bug fix**, every **Tier 3+** change, and **all Tier 4** work, dispatch `modem-investigator` as a read-only Phase 1 gate — it maps the UI→hook→CGI→`qcmd`→modem flow statically and probes live state via Posh-SSH before any code is written. It returns an evidence report (file paths with line numbers, captured CGI/UCI/nft/log output, findings), never code. Synthesize its findings.
2. **Plan (Opus orchestrates, builders pre-flight):** For Tier 2+, dispatch builder agents in parallel — `backend-writer` (CGI / daemons / libs / init.d / AT flows) and/or `ui-builder` (pages / cards / hooks / types). They return scaffolding + design notes, NOT committed code. Opus synthesizes into ONE plan: tier, agent roster, file list, build order, risks, and the validation the change will need.
3. **Approval Gate (user):** Plan changes here are cheap; later changes are not.
4. **Execute (builders):** Bottom-up for cross-layer work: backend (poller / CGI / lib / init.d) → `validator` gate → hook → component → docs. Parallel where files are independent; sequential where there's a data dependency. `backend-writer` always hands off to `validator` after a meaningful backend change — the static audit is non-negotiable.
5. **Validation (`validator`, mandatory):** After every backend / shell change, run `validator`. It is a single agent that performs both the static audit (CRLF via `.claude/check-crlf.sh`, BusyBox/POSIX compliance, bashisms, `jq` null-handling, lock/trap discipline, numeric-input guards, CGI envelope, reboot/CFUN safety) **and** scoped on-device SSH verification of the deployed change. Loop failures back to Phase 4 — but after **2 failed validation rounds**, stop and surface to the user instead of looping further.
6. **Docs & Close (`docs-writer`):** Update `docs/`, the feature-doc routing tables in `CLAUDE.md` + `docs/features/README.md`, and `RELEASE_NOTE.md` as needed. Report summary + git status.

### Tier Routing

| Tier | Scope | Flow |
|------|-------|------|
| 0 | Typos, comments, copy edits, version bumps | Direct edit, no agents, no plan |
| 1 | Single existing file in one layer | Skip Phase 2–3. Implement + `validator` (if shell) + maybe docs |
| 2 | New feature, single layer | Full flow; pre-flight is the layer's builder only |
| 3 | Cross-layer feature (CGI + hook + component, or a poller field consumed across layers) | Full flow; `modem-investigator` runs the Phase 1 recon gate |
| 4 | Installer / `init.d` services / UCI schema / firewall (fw4 + nftables, incl. DPI nft rules) / OTA pipeline | Full flow with `modem-investigator` as a hard Phase 1 gate, and `validator` doing on-device verification of the deployed change |

Bug fixes match the tier of the *fix*, not the bug — and always get a Phase 1 `modem-investigator` recon first, because "understand the live flow before touching it" is cheaper than a wrong fix. Pure refactors with no behavior change drop one tier (`validator` still runs for any shell change; builders don't pre-flight).

### Agent Roster

All agents are defined in `.claude/agents/`. Models are pinned per agent — the orchestrator does not choose them.

- **Recon gate (Phase 1, read-only, Opus):** `modem-investigator` — traces the full stack statically and probes the live modem read-only via Posh-SSH; returns an evidence report and can halt work before code is written.
- **Builders (Phases 2 & 4, Opus):** `backend-writer` (BusyBox `/bin/sh` backend — CGI, daemons, libs, init.d, AT/`qcmd` flows, UCI, apply pipelines, locks), `ui-builder` (Next.js / shadcn / Tailwind frontend; may delegate craft to the Impeccable skill).
- **Validator (Phase 5, Sonnet):** `validator` — static BusyBox/CRLF/`jq` audit **and** scoped on-device verification. The closing gate before any backend change is done.
- **Closer (Phase 6, Sonnet):** `docs-writer`.

### Hard Rules

- **Tier is decided once, up-front.** If tempted to skip the recon or the validator mid-flow, re-triage rather than skip.
- **`validator` runs after every backend / shell change.** It is the single source of truth for BusyBox safety and on-device behavior; static-only passes have shipped broken scripts before, so let it do the on-device leg whenever the change is deployable.
- **`modem-investigator` is read-only and fails loud.** If recon reveals the change needs a write action on live state, or surfaces a broken invariant, it halts and reports — the main thread re-routes through `backend-writer` + `validator`.
- **`docs-writer` is the closing bracket.** If it doesn't run on Tier 2+, the change isn't done.
- **Builders and validators don't see the orchestrator's conversation.** Each dispatch is a self-contained brief with file paths, schemas, the live evidence from `modem-investigator`, and the relevant `CLAUDE.md` / `DESIGN.md` / `PRODUCT.md` sections inlined.
- **No in-flight reboot.** Any change that calls `reboot` / `AT+CFUN=1,1` mid-request must be deferred and surfaced via the deferred-reboot banner — `validator` rejects inline reboots in a CGI response path.

### Skip Phrases

User can short-circuit by saying "just do it" / "skip the plan" / "tier 0 it" — Opus drops to direct execution. Otherwise the flow is the default.

## Design Context

See **`PRODUCT.md`** (strategic: register, users, brand personality, anti-references, the six design principles including the safety principle, accessibility) and **`DESIGN.md`** (visual: OKLCH tokens incl. Signal Indigo as the single action accent and a lighter shade of it as the quiet secondary control, Manrope UI typography + scoped JetBrains Mono, status-badge pattern, hybrid elevation, mosaic dashboard composition, signature components — Topology Map / Circular Signal Meter / Live Data Tile, Apple-class motion contracts, full Do's and Don'ts).

Quick reminders the visual spec enforces:
- **Status badges**: always `variant="outline"` + `bg-{role}/15 text-{role} border-{role}/30` + `size-3` lucide icon. Solid variants are forbidden in feature surfaces. Reusable wrapper: `ServiceStatusBadge` at `components/local-network/service-status-badge.tsx`.
- **CardHeader**: plain `CardTitle` + `CardDescription`. No icons in headers; they go in badges or `CardAction`.
- **Save actions**: always use `SaveButton`.
- **Single typeface**: Manrope is the only UI font. The one sanctioned exception is **JetBrains Mono**, scoped strictly to the AT terminal and raw AT output (The Machine-Voice Rule); no other second font. Live numeric readouts use `font-variant-numeric: tabular-nums`.
- **Brand colors**: Signal Indigo (`--primary`) is the single action accent — the only brand color. The `--secondary` token is a quiet functional control surface — a lighter, desaturated shade of the primary (`oklch(0.91 0.05 264)` light / `oklch(0.40 0.08 264)` dark), not an identity or brand color. There is no `--brand-teal`, no gradient, no duotone. Governing rule: *Indigo acts · Mono speaks for the machine.*
- **Page layout**: feature pages are a page header (`h1` + muted description) followed by a uniform grid of self-contained cards (the established shape, see `ttl-settings`). Apple-class professional UI/UX (macOS System Settings) is the north star, not UniFi's hero-mosaic. A hero/mosaic is a rare, deliberate exception for a genuine glance surface, never the default. UniFi is kept only for data density (dense outline pills / tables).
- **Card-Wrapped Surface Rule**: a feature's settings live **inside one self-contained `Card`** (the card is the unit the page grid arranges), never spread across a full-bleed page with cards as loose parts. Traffic Engine + the `Add Profile` card are the reference; the earlier full-page Custom Profiles versions are the anti-pattern. See `DESIGN.md` ("The Card-Wrapped Surface Rule") + `PRODUCT.md` (Principle 4).
- **Components**: use shadcn/ui primitives (tabs, accordion, dialog, popover, select, etc.) before hand-rolling; build custom only when shadcn does not provide one.

## Probing the Live Modem (Development)

A live test modem is reachable on the LAN; **SSH credentials live in `.env`** (`SSH_HOST`, `SSH_USERNAME`, `SSH_PASSWORD`). When debugging backend behavior, reproducing CGI output, verifying a shell-script change actually runs under the device's BusyBox `/bin/sh`, or sanity-checking that a fix landed on disk, probe the device via PowerShell's **Posh-SSH** module rather than guessing from code alone.

One-time install (per dev machine):

```powershell
Install-Module Posh-SSH -Scope CurrentUser
```

Quick pattern (read variables from `.env`, do NOT hardcode or echo secrets in transcripts):

```powershell
$cred = [pscredential]::new($env:SSH_USERNAME, (ConvertTo-SecureString $env:SSH_PASSWORD -AsPlainText -Force))
$sess = New-SSHSession -ComputerName $env:SSH_HOST -Credential $cred -AcceptKey -Force
(Invoke-SSHCommand -SessionId $sess.SessionId -Command 'uci show qmanager').Output
Remove-SSHSession -SessionId $sess.SessionId | Out-Null
```

Use it to: read live UCI config, inspect `/tmp/qmanager_*.json` runtime state, tail `/tmp/qmanager.log` and other logs, hit a CGI endpoint with `curl http://127.0.0.1/cgi-bin/quecmanager/...`, check lock files (`/var/run/qmanager_*.pid`, `/tmp/qmanager_*.lock`), exercise `qcmd` AT calls, confirm `nft list ruleset` after a DPI toggle, verify init.d state, and re-read written config after an apply.

**Safety:**
- Treat the modem as a live system. Avoid destructive commands (reboots, `AT+CFUN=1,1`, factory resets, package removals, `rm -rf`) without a stated reason.
- Never echo `.env` values back to the user or paste them into transcripts; reference the variable names instead.
- `.env` should remain gitignored. Verify with `git check-ignore .env` before committing anything in the repo root.

## Release Notes (`RELEASE_NOTE.md`)

Sections: `## ✨ New Features`, `## ✅ Improvements`, `## 📥 Installation`, `## 💙 Thank You`. Short user-facing bullets; no internal function names. Headline features first; fixes/polish under Improvements. Include the one-line fresh install command + Software Update upgrade path.

## Shared Constants
- **`ANTENNA_PORTS`** (`types/modem-status.ts`): canonical metadata for 4 ports (Main/PRX, Diversity/DRX, MIMO 3/RX2, MIMO 4/RX3). Used by `antenna-statistics` + `antenna-alignment`. Do not duplicate.

## Feature Docs — Read On Demand

Detailed per-feature notes (apply pipelines, lock layering, contracts, gotchas, error codes) have been extracted to `docs/features/`. **Before editing any of these features, read the matching doc first** — they contain non-obvious invariants that aren't visible from the code alone.

| If you're touching… | Read |
|---|---|
| Traffic Engine (unified Video Optimizer + Masquerade, `/local-network/traffic-engine`), `nfqws`, NFQUEUE 200, `/etc/nftables.d/12-mangle-qmanager-dpi.nft` | [`docs/features/dpi-settings.md`](docs/features/dpi-settings.md) |
| Custom SIM Profiles, `qmanager_profile_apply`, `profile_mgr.sh`, Verizon MPDN, ICCID auto-apply, profile lock files | [`docs/features/custom-sim-profiles.md`](docs/features/custom-sim-profiles.md) |
| Config Backup / Restore, `.qmbackup`, `qmanager_config_restore`, `config_backup_sections.sh`, deferred-reboot banner | [`docs/features/config-backup-restore.md`](docs/features/config-backup-restore.md) |
| Language packs, i18n loading, `qmanager_language_install`, `language_packs.sh`, manifest, `bun run package:lang` | [`docs/features/language-packs.md`](docs/features/language-packs.md) |
| Backend error envelopes, `resolveErrorMessage`, `errors.json`, `at-commands` namespace | [`docs/features/error-codes.md`](docs/features/error-codes.md) |
| Tower locking, `qmanager_tower_failover`, signal failover daemon, failover spawn gating | [`docs/features/tower-lock-failover.md`](docs/features/tower-lock-failover.md) |
| `/cellular/antenna-alignment`, alignment meter, antenna type toggle | [`docs/features/antenna-alignment.md`](docs/features/antenna-alignment.md) |
| Bandwidth monitor, `bridge_traffic_monitor_rm551`, `websocat:8838`, UCI `quecmanager.bridge_monitor.*`, dashboard Live Traffic 5-state row | [`docs/features/bandwidth-monitor.md`](docs/features/bandwidth-monitor.md) |
| Connection Scenarios, scenario schedule, `qmanager_scenario_schedule`, `scenario_mgr.sh`, band locking per profile, `qmanager_profile_scenario` cron, `scenario_locked_by_schedule` | [`docs/features/scenario-profile-binding.md`](docs/features/scenario-profile-binding.md) |
| SMS inbox/send/delete (`cellular/sms.sh`), SMS alerts (`sms_alerts.sh`), `sms_tool` binary patches, `/dev/smd11` char-device invariant, shared lock, noise-filter defense-in-depth, `AT+CPMS` storage routing, dual ME+SM read/merge, `qmanager_sms_storage` boot daemon | [`docs/features/sms.md`](docs/features/sms.md) |
| APN Settings (single-APN model), `cellular/apn.sh`, `apn_mgr.sh` (shared APN lib: v2 config I/O + COPS apply + `reapply_active_apn_slot` + `reconcile_active_apn_slot_at_boot`), `apn_profiles.json` (slot 1 used; slots 2–5 preserved but unused), save/deactivate actions only (`activate`/`clear` removed), `active=0` carrier-default durable state, honest "Not live" badge, COPS detach/attach cycle, IMS/SOS context tagging + CID picker AlertDialog, boot reconcile (poller-hosted, idempotent, `active=0` no-op), `use-apn-settings.ts` / `types/apn-settings.ts`, no runtime ICCID polling (SIM swap forces reboot → boot reconcile covers it) | [`docs/features/apn-management.md`](docs/features/apn-management.md) |
| Band Locking, `bands/current.sh` (per-category register query: `lte_band`/`nsa_nr5g_band`/`nr5g_band`/`nrdc_nr5g_band`), `bands/lock.sh` (band_type: `lte`/`nsa_nr5g`/`sa_nr5g`/`nrdc_nr5g` — all four lockable), `qmanager_band_failover`, SA `nr5g_band` vs NR-DC `nrdc_nr5g_band` AT param mapping, NR-DC writes stick verbatim (no coercion, on-device verified), SA grep-hazard guard, `qcmd` echo-line grep-anchor invariant, SA⇄NR-DC swap UX, `policy_band` coloring-only (not locked source), `supported_bands.env` 4-field contract, "no zero-band lock" invariant, `supported_bands_hw.env` static band universe (force-copied on upgrade), `hw_lte_bands` / `hw_nsa_nr5g_bands` / `hw_sa_nr5g_bands` poller fields, two-tone primary/warning checkbox split, `policyBands` coloring-only / `supportedBands` universe for count + reset + all-unlocked, NR-DC borrows SA HW list, failover resets all four categories, `refresh_policy_band()` SIM-swap re-read, `/tmp/qmanager_refresh_policy_band` flag | [`docs/features/band-locking.md`](docs/features/band-locking.md) |
| Known-SIMs database, `sim_db.sh`, `known_iccids` persistent set, `sim_db_seed_if_absent` return semantics, byte-parity requirement, `system/known_sims.sh` CGI (list/clear), migration from retired `last_iccid`, `known-sims-row.tsx` | [`docs/features/known-sims.md`](docs/features/known-sims.md) |
| Connection Quality settings, `qmanager_ping` HTTP-probe daemon, ping profiles (sensitive/regular/relaxed/quiet), `system/ping_profile.sh` CGI, `system/quality_thresholds.sh` CGI, `quecmanager.ping_profile.*`, `quecmanager.quality_thresholds.*`, reload flags, `isDefault` absence semantics | [`docs/features/connection-quality.md`](docs/features/connection-quality.md) |
| LAN Gateway/Subnet editor, `network/lan_config.sh`, `use-lan-config.ts`, `lan-config-card.tsx`, `lan_address_changed` event, self-severing apply (response before `network reload`), hand-rolled POSIX validation (no `ipcalc.sh`, no jq regex), null-byte/SCP deploy quirk, WoL removal | [`docs/features/lan-config.md`](docs/features/lan-config.md) |
| Connection Watchdog, `qmanager_watchcat`, watchdog daemon, `monitoring/watchdog.sh`, `use-watchdog-settings.ts`, dual-trigger model (reachability + quality), `quality_enabled`, `latency_ceiling_ms`, `loss_ceiling_pct`, `quality_consecutive`, `STATUS_STALE_THRESHOLD`, status.json `.connectivity` data source, float-comparison awk rule, reason-aware cooldown, Tier 1 AT+COPS re-registration, Tier 1→4 recovery ladder, auto-disable token bucket | [`docs/features/connection-watchdog.md`](docs/features/connection-watchdog.md) |
| SMS Forwarding (`qmanager_sms_forward` daemon, `cellular/sms_forwarding.sh`), seed-on-first-run invariant, loop guard, 3-attempt abandon, djb2 fingerprint, lifted-hook architecture (`forwarding-center.tsx`), Delivery & Health card derived-state model, `send_test`-reads-UCI invariant, `quecmanager.sms_forwarding.*` | [`docs/features/sms-forwarding.md`](docs/features/sms-forwarding.md) |
| Tailscale VPN, `vpn/tailscale.sh`, two install variants (official static tarball + tiny opkg), `install_official`/`install_tiny` background installers, procd init.d heredoc (never a static file), `set_exit_node` action (`tailscale set` not `tailscale up`), marker-file contract (`/etc/tailscale/.qm_install_method`), `migrate_tailscale_packages` official-early-return guard, `uci delete` config-file resurrection quirk, `--accept-routes` ban, double-fork orphan for `tailscale up`, `exit_node_advertised` GET field | [`docs/features/tailscale-vpn.md`](docs/features/tailscale-vpn.md) |
| Diagnostics capture, `system/diagnostics.sh`, `qmanager_debug_report` daemon, IPA offload toggle, `system/ipa_offload.sh`, `/etc/init.d/r8125_ioss.init` (NOT rtl8125_ioss), last-stdout-line contract, UCI redaction glob list, 300 KB cap, armed-on-reboot pattern, `pending_reboot_required`, qlog.sh `tr '\n' '↵'` mojibake fix | [`docs/features/diagnostics.md`](docs/features/diagnostics.md) |
| Adaptive Polling, `qmanager_poller` AT backoff, `system/adaptive_polling.sh`, `quecmanager.poller.*` (never seeded), `/tmp/qmanager_ui_active` heartbeat, `/tmp/qmanager_poller_reload`, `/tmp/qmanager_force_tier2`, `.device.poller_tier` ∈ `active`\|`idle`\|`deep`, tier cadence (active 2s / idle 15s / deep 60s defaults), AT-due gating (`cycle_count % (interval/POLL_INTERVAL)`), full-refresh on idle touch, `write_cache` always-run invariant (watchdog dependency), force-tier2 apply chokepoints (`qmanager_profile_apply`, `apn_mgr.sh`), tower-lock Active pin, boot-seed invariant | [`docs/features/adaptive-polling.md`](docs/features/adaptive-polling.md) |

Quick CGI / hook / type / reboot table for all extracted features lives in [`docs/features/README.md`](docs/features/README.md).

If you add a substantial new feature with non-obvious invariants, drop its notes into `docs/features/<feature>.md` and add a row above rather than re-fattening this file.
