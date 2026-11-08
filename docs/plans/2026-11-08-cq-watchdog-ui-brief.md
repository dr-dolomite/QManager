# Brief: CQ × Watchdog UI/UX build (RM551E)
> **Shipped (RM551E):** merged into development-home as dbfc827f on 2026-11-08. Archived; the live docs are docs/features/connection-quality.md and connection-watchdog.md.

Start a fresh session in a worktree cut from `refs/heads/feat/cq-watchdog-unify` and paste this brief.

## Background

QManager is a Next.js static-export UI + BusyBox CGI backend running on a Quectel RM551E modem. A unified
Connection Quality (probe daemon `qmanager_ping`, sensitivity table, 4 probe targets, quality thresholds) ×
Watchdog (`qmanager_watchcat` recovery ladder Tiers 1-4, hold-off, reboot budget, SSR hold, SIM
failover/failback, new "stuck at one carrier" trigger) architecture was approved (spec v2 + Amendments 1-3).
Its RM551E backend is built on `feat/cq-watchdog-unify`: settings migration, Config Backup translation, new
CGIs `monitoring/connection_quality.sh` and a rewritten `monitoring/watchdog.sh` (162/162 contract tests on
BusyBox 1.29.3/1.31.1/1.36.1). The current frontend still calls the removed endpoints and expects the old
watchdog shape, so the UI is broken on that branch until this build lands.

## Task

You are the orchestrator for the frontend build.

**FIRST ACTION: invoke the Skill `impeccable:impeccable`** (owner requirement). Then read `PRODUCT.md` and
`DESIGN.md` fully (canon, adopted wholesale) and the repo `CLAUDE.md` Design Context rules.

### Design source
- Approved UI design artifact: https://claude.ai/artifact/2U4fFKyDFQ4HT9HqnvBXeU (read with
  `mcp__claude-artifacts__read_artifact`). It predates Amendment 3 and does NOT show the newer features below;
  design them in the same language.
- Spec §8 (frontend IA): `docs/plans/2026-11-07-cq-watchdog-unified-architecture.md`.
- Contracts: `docs/plans/2026-11-07-cq-watchdog-contracts.md` §5 (GET/POST of both CGIs, error codes), §1
  tables (served by GET only; the frontend keeps NO mirror), §4 status.json `connectivity` + `watchcat`, §9
  Amendment 1 (incl. per-slot `live` verdict), §10 Amendment 2.
- Amendment 3 `docs/plans/2026-11-08-cq-watchdog-amendment-3.md`, "Frontend" bullet (~line 119):
  - CQ "Last outage" fact (A3.1, `last_outage` in the CQ GET).
  - Watchdog hero "last successful recovery" figure (A3.2; in memory only, label "since last restart";
    Tier 4 successes not recorded).
  - Detection-card carrier row: `carrier_enabled` (default off), `carrier_after_min` 5-240 (default 15),
    `SegmentedField` with minute presets, `HintIcon`, Tier 1 link-drop note.
  - Tier 3/4 rows "not used for carrier"; activity rows by event code; `recovery_reason` /
    `holdoff_reason` value `carrier`.
  - NOTE: that bullet mentions a Fact-Is-Info "not available in 5G SA". The owner later approved a gated SA
    read (the poller reads carriers via AT on SA while the toggle is on), so SA IS supported. Check A3.3 and
    drop/adjust that fact; ask the owner if unclear.
- Response examples: `tools/cq-wd-contract/fixtures/**`; runner `tools/cq-wd-contract/run.sh`
  (`sh run.sh -b <busybox>` in WSL from an ext4 copy; jq at `$HOME/bin/jq`).

### Scope
- Pages `/monitoring/connection-quality` and `/monitoring/watchdog` (`app/monitoring/**`,
  `components/monitoring/connection-quality/**`, `components/monitoring/watchdog/**`).
- Hooks `hooks/use-ping-profile.ts`, `hooks/use-quality-thresholds.ts`, `hooks/use-watchdog-settings.ts`,
  `hooks/use-watchdog-indicator.ts`: rework/replace for the two new endpoints (the old
  `system/ping_profile.sh` and `system/quality_thresholds.sh` were removed). Types, i18n.
- Anything else consuming the old watchdog GET shape or old status.json watchcat keys (grep `components/`,
  `hooks/`, `lib/`, `types/`). The SIM-swap banner reads `status.json` `sim_swap`, which still exists.
- Do NOT edit `scripts/` (backend). If the contract looks wrong, report it to the owner.
- All copy via `t()` in five catalogs (en, zh-CN, zh-TW, it, id; zh-TW via OpenCC from zh-CN). Toasts per
  `docs/reference/toast-confirmation.md`. Icons per the CLAUDE.md rule for `/monitoring/**`;
  `bun run icons:check`.

### Workflow
- Large change: write a short plan to an .md file in the session folders, link it, and stop for the
  owner's OK before building.
- Orchestrate: Opus plans/judges; Sonnet 5.5 High builders (`model: "sonnet", effort: "high"`); Opus medium
  only for very complex pieces; Haiku recon.
- Validate: `bunx tsc --noEmit`, lint on touched files, `bun run test:i18n`, and visual verification in the
  browser preview against the dev server. Use `bunx`, never `npx`.
- Small atomic commits (Conventional Commits, subject only, no attribution lines). NEVER merge. End by
  reporting branch + git status and asking the owner: merge, keep for PR, or discard.
- `feat/cq-watchdog-unify` may gain a few more backend commits (poller/Prometheus follow-ups); ask the owner
  before merging it into your branch.
