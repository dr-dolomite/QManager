# Session briefs: CQ × Watchdog unification (2026-11-07)

Spec for both: `D:\Projects\QM PROJECT\QManager\docs\plans\2026-11-07-cq-watchdog-unified-architecture.md` (v2, approved incl. the §5.6 reboot guard).

---

## Brief 1: Frontend proposal artifact (fresh session, no worktree, Impeccable)

Design task, artifact only. Do NOT edit, create or commit any file in either repo, and do not touch any live modem.

Background: The user owns two QManager products, RM551E (OpenWRT, `D:\Projects\QM PROJECT\QManager`) and RM520N (systemd, `D:\Projects\QM PROJECT\QManager-RM520N`). Their Connection Quality and Watchdog features had drifted apart. A unified architecture (v2) was approved after an independent Opus review. In it, Connection Quality senses (it owns probe cadence, targets, down/up timing and quality thresholds) and Watchdog acts (it owns the ladder, timings in seconds and minutes, and the reboot budget), with one writer per setting. A separate session builds the backend. This session only produces the visual proposal, so the user can approve the UI before frontend code is written.

Goal: use the Impeccable skill (`impeccable:impeccable`) to build one published artifact (claude-artifacts) showing the **proposed frontend** for **Connection Quality** (`/monitoring/connection-quality`) and **Watchdog** (`/monitoring/watchdog`). Both pages must be identical in structure and behaviour on RM551E and RM520N.

Read first:
1. The spec above. §2, §3, §4.2, §5.2-5.9, §6 and §8 drive the UI.
2. `PRODUCT.md` and `DESIGN.md` in `D:\Projects\QM PROJECT\QManager` (canon), plus the "Design Context" rules in that repo's `CLAUDE.md`:
   - filled tonal status Badges
   - `CardFoot` save
   - Rethink Sans with tabular-nums
   - no debug copy
   - lucide icons on `/monitoring/**`
   - container queries
   - three data states
   - `SegmentedField`
3. The current pages, to show what changes:
   - `components/monitoring/connection-quality/*` and `components/monitoring/watchdog/*` in both repos
   - copy in `public/locales/en/monitoring.json` (RM551E) and `system-settings.json` / `common.json` (RM520N)

Must show:

**Connection Quality**
- Sensitivity card:
  - 4 pills, each with interval, "about N s" down-after and up-after (sensitive 1/8/3 s, regular 2/12/6, relaxed 5/20/10, quiet 10/40/20).
  - A live verdict chip naming the slot that answered.
- Probe Targets card:
  - 4 slots: slot 1 primary, slots 2-4 parallel fallbacks.
  - Defaults `1.1.1.1`, `8.8.8.8`, `2606:4700:4700::1111`, `cloudflare.com`.
  - A quiet "skipped, no IPv6" state.
- Quality Thresholds card: presets plus Custom (loss 1-100).
- No "set by Watchdog" override.

**Watchdog**
- Hero status with the full phase set: holdoff (outage/quality reason), radio_off, reboot budget resting (hourly vs long-outage), SSR hold countdown, ping data stale.
- Ladder card:
  - Tier 3 gated on dual-SIM.
  - Failback give-up after 3 tries.
  - Tier 4 "resting".
- Detection card:
  - "Start recovery after [N] offline" (min 15 s).
  - "Quality trigger after [N] of poor quality".
  - SSR hold.
  - Read-only "Down is detected after about X s (Sensitivity: Relaxed)", linking to CQ.
  - Effective values shown where clamped.
  - No "Probe every".
- Timeline uses effective values.
- Recovery Activity stays.

**Across both pages**
- A short before/after note per card.
- States: healthy, outage (Tier 2 cooldown), quality holdoff, budget resting.
- Loading, empty and error for at least one card.
- Light and dark if feasible.

Done = a published artifact link, plus a short list of design questions and deviations.

---

## Brief 2: Backend implementation orchestrator (fresh session, Opus, own worktree off `development-home`)

Background: same as Brief 1. Implement the **backend** of the approved spec on **RM551E only** (`D:\Projects\QM PROJECT\QManager`). The frontend is designed in a parallel artifact session and is built only after the user approves it, so **do not touch `components/`, `hooks/` or `app/`**, apart from minimal type changes that the contracts force. The RM520N port (spec §10 step 5) is a separate plan.

Workflow: follow the repo `CLAUDE.md` "Change Workflow". This counts as a **Large** change, and its plan is the approved spec, so no new approval stop is needed unless you deviate from the spec.

1. Work in a worktree, reset onto `development-home`. Copy `.env` from the main checkout (check `git check-ignore .env`, never commit it).
2. You orchestrate. Delegate per the user's model setup (memory):
   - Haiku 5.5 for recon.
   - Sonnet 5.5 High for routine builders: `backend-writer`.
   - Opus medium for sensitive pieces: the watchcat state machine, the migration and `install.sh`.
   - `validator` after every shell change.
   - Give agents self-contained briefs.
3. Follow spec §10 in order:
   - **Step 0:** freeze the contracts and write the contract-test fixtures.
   - **Step 1a:** a behaviour-neutral adapter extraction. The 71 `tools/watchdog-harness` baselines must stay byte-identical.
   - **Step 1b:** one behaviour rule per commit, each with a new baseline. Add a harness mono model emitting `fail_elapsed_sec`. Run the harness under BusyBox 1.29.3, 1.31.1 and 1.36.1.
   - **Step 2:** migration in `install.sh`, update, uninstall and ipk postinst (lifecycle lockstep); Config Backup sections with permanent translation.
   - **Step 3:** CGIs, poller republish (both composers, plus `tools/poller-parity`), Prometheus.
   - **Step 4:** live validation on the RM551E via the `mcp__modem__*` bridge.
   - **Step 6:** docs.
4. Hard rules:
   - Static audit every shell file: CRLF via `.claude/check-crlf.sh`, BusyBox/POSIX, no jq regex, numeric guards, lock/trap discipline, never `AT+CFUN=1,1`.
   - **Ask the user before any live-state write or deploy to the modem.** Always `sync` after a deploy.
   - Commit small and atomic with Conventional Commits.
   - **Never merge.** End by reporting the branch and `git status`, and ask: merge, keep for PR, or discard.
5. After 2 failed validation rounds on the same issue, stop and ask.

Done =
- The RM551E backend implements spec v2 on a branch.
- The harness passes on all three BusyBox versions.
- Live validation checklist (§10 step 4) results are reported.
- Docs are updated.
- A draft RM520N port plan is written for approval (do not start it).
