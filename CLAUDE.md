## Device & Architecture Context

QManager = Next.js static-export frontend + OpenWRT CGI shell backend, deployed **on the modem itself** (Quectel RM520N/RM551E/RM500Q-class). Backend is BusyBox `/bin/sh`: CGI under `scripts/www/cgi-bin/`, daemons under `scripts/usr/bin/`, libs under `scripts/usr/lib/qmanager/`; AT commands go through `qcmd`. Anything that reboots the modem kills the in-flight HTTP request, so reboots defer behind a dialog + the persistent deferred-reboot banner, never `AT+CFUN=1,1` mid-request. Overviews: `docs/ARCHITECTURE.md`, `docs/BACKEND.md`, `docs/FRONTEND.md`, `docs/API-REFERENCE.md`.

## Change Workflow

Lean: the main session understands, writes and validates; agents are for heavy or parallel work. This replaces the generic brainstorming / writing-plans / verification skills here (TDD still applies where tests exist). **Invoke `superpowers:brainstorming` only when the user asks.**

- **Small** (typos, copy, single-file or single-layer fixes outside the risky areas): understand → change → validate.
- **Large** (cross-layer; the **installer / `init.d` / UCI schema / firewall (fw4, nftables, DPI) / OTA / AT path (`qcmd`, `qmanager_atd`, lock files)**; anything that can reboot the modem or cut the connection): understand → **short plan, stop for OK** → build → validate → docs. "Just do it" / "skip the plan" drops it to small.

1. **Understand.** Read the code path and its doc (routing below). For every bug fix and large change, look at the live modem read-only first: past root causes often differed from the first theory.
2. **Plan (large).** Files, build order, risks, validation, rollback.
3. **Build** in the main session, bottom-up: backend (poller / CGI / lib / init.d) → hook → component. Builder agents only to parallelise independent file sets. UI craft goes through the Impeccable skill.
4. **Validate.** Shell: static audit (CRLF via `.claude/check-crlf.sh`, BusyBox/POSIX, bashisms, multi-var `local`, `jq` null-handling and no regex, lock/trap discipline, numeric guards, CGI envelope, reboot/CFUN safety) **and** on-device verification; static-only passes have shipped broken scripts. After 2 failed rounds, stop and ask. Frontend: `bunx tsc --noEmit` + lint on touched files.
5. **Docs** when behaviour, contracts or invariants change: feature doc, routing (here and `docs/features/README.md`), `RELEASE_NOTE.md` if user-visible.

Hard rules:
- **Lifecycle lockstep:** `install.sh`, update and uninstall stay in sync (file copy, UCI seed, daemon start, `/tmp` and reload-flag cleanup).
- **Live-state writes during investigation** need the user's OK first.
- **Agent briefs are self-contained:** inline paths, schemas, live evidence and relevant canon.
- **Never auto-merge.** End by reporting branch + git status and asking: merge, keep for PR, or discard.

**Worktrees** for large work or when another session may touch the branch: `EnterWorktree` after plan approval, then reset onto `development-home` (it branches from `origin/main`). Copy `.env` from the main checkout (confirm `git check-ignore .env`, never commit it); `bun install` only if a frontend build/`tsc` is needed. Give parallel agents `isolation: "worktree"` only when their file sets overlap.

**"Orchestrate"** = same steps, more delegation: parallel Haiku recon and parallel builders; the main session plans, judges reports with its own reads, holds the approval stop, and still validates.

Agents (`.claude/agents/`, models pinned there): `modem-investigator` (read-only evidence), `backend-writer` / `ui-builder`, `validator`, `docs-writer`.

## Design Context

`PRODUCT.md` and `DESIGN.md` are canon — **read them before any UI or product-facing work.** They are the RM520N fork's system, adopted wholesale with no exceptions; `DESIGN.md` is ahead of the code and its **Migration Deltas** list where the target still lags (port ledger `docs/rm520n-port-ledger.md`). Reference implementations when ambiguous: the fork's `components/dashboard/**` and `components/cellular/radio/**` (`git show a05c4e92:<path>`). A primitive the canon names but `components/ui/` lacks is created by its ledger row, not faked with the old pattern. New and reworked surfaces follow the canon; don't sweep untouched pages.

Rules reviews enforce most (detail and rationale in `DESIGN.md`):

- **Status chips:** filled tonal `Badge` (`success`/`warning`/`destructive`/`info`/`muted`, `components/ui/badge.tsx`) with a `size-3` glyph; never `variant="outline"` for status, hand-written classes, or two states sharing a glyph. Identity/metadata (band, radio family, capability, slot) is a `Tag` (`components/ui/tag.tsx`).
- **Fact-Is-Info:** a fact that is neither fault nor health is a filled `Badge variant="info"` with a glyph, shown only while it applies.
- **Signal quality** colours numerals and bars via `components/cellular/signal-quality-display.ts`, never chip fills; ramp ink needs a bar beside it; a missing reading is an empty track.
- **Cards:** `CardHeader` = plain `CardTitle` + `CardDescription`, no icons. A card editing a draft commits from `CardFoot` (`components/ui/card-foot.tsx`): status left; Discard/secondary (ghost or `tonal-neutral`, never stroked `outline`) then `SaveButton` (translated label) right. Never mid-card Save, a bar under the grid, or a sticky bar. Exempt: dialogs, wizards, per-row/inline and operational actions.
- **Toasts confirm** every finished user mutation (save, apply, persistent toggle, add, delete, reset, install, copy): one plain `sonner` `toast.success`/`toast.error`, `t()` copy in **all five** catalogs (en, zh-CN, zh-TW, it, id), fired in the handler at the terminal moment. Failure reason comes from the call's returned result via `resolveErrorMessage`, never hook `error` state read after `await`. Effect toasts take a deterministic `id` and never fire on mount. Copy uses `lib/clipboard.ts` `copyText`. Navigation or `/setup` step advances replace the success toast (failures still toast). Never toast polling, background work, draft edits or Discard. See `docs/reference/toast-confirmation.md`.
- **Booleans / short choices:** `SegmentedField` (`components/ui/segmented-field.tsx`, pass `glyph`), not a bare `Switch` (leave existing `<Switch` cards unless reworking them).
- **Typography:** Rethink Sans for UI and every figure (`tabular-nums`); JetBrains Mono only for opaque strings (ICCID, IMEI, MAC, IP, paths, interfaces, raw AT). EARFCN/ARFCN/PCI/band/TAC are quantities → Rethink. Fonts are vendored under `app/fonts/` via `next/font/local`; **never `next/font/google`**, never a new face.
- **Shape:** 8/10/12/16/20px + pill; `rounded-card` in grids, `rounded-hero` for the anchor, `rounded-pill` for anything that acts or labels. `card-sheen` only on the `Card` root and floating surfaces over a scrim.
- **Layout:** never `max-w-*` on a feature page; recompose wide cards with `@5xl/card:` (declare `@container/card` at the call site); a feature's settings live in one self-contained `Card`. Scan, don't read: key left / value right, at most one inner container per card, quiet defaults, fix a hard-to-scan list by grouping (not padding), and a glyph replaces text only if it needs no tooltip. Responsive via container queries; viewport breakpoints only for gutter and shell.
- **Three states** (loading, empty, error) on every data surface; skeletons import the loaded shape constant.
- **Motion** only from `lib/motion.ts` (`quick`/`standard`/`emphasized`, mirrored in `globals.css`); no raw `duration-*`, literal durations or bare `transition-all`. Reduced motion only via `useMotionReduced()` / `isMotionReduced()` (ESLint-enforced).
- **Copy:** one sentence per card/page description; jargon behind `HintIcon` (Popover, ~one per group). **No debug-build copy:** no `/etc/` or `/tmp/` paths, script/CGI/daemon/UCI/AT names, or provenance lines in UI text, except surfaces that exist to show them (AT Terminal, Logs, About Device diagnostics, System Health Check, Prometheus scrape config). Before shipping copy, grep the diff for `/etc/`, `/tmp/`, `uci `, `AT+`, `read back`, `saved to`.
- **Icons:** Material Symbols Rounded on the sidebar, `/dashboard`, `/`, `/login/` and all `/cellular/**`; lucide-react on `/setup`, `/local-network/**`, `/monitoring/**`, `/system-settings/**`, `/about-device`, `/support` and the header. `Banner`, `SaveButton`, `sonner` are lucide everywhere; `HintIcon` is Material everywhere. Never mix sets on one screen. Pass `size` to every `MaterialSymbol`; a glyph missing from the subset renders as text, so run `bun run icons:check`. See `docs/reference/icon-system.md`.
- **Colour roles:** `--primary` (hue 262) = action, brand, `info`, 5G NR identity; `--lte` identity only; `--downlink`/`--uplink` direction only; `--spatial` antennas/MIMO; only success/warning/destructive are verdicts. shadcn `--secondary` is neutral. Semantic tokens only, shadcn primitives first. See `docs/reference/color-system.md`.
- **Target-only surfaces** (Netbird, Config Backup, Adaptive Polling, Traffic Engine, Connection Scenarios, Custom SIM Profiles, deferred-reboot banner) follow every rule; their canon is `DESIGN.md` > Components > Target-only surfaces.

## Live Modem

Probe the live test modem instead of guessing: backend behaviour, CGI output, BusyBox compatibility, whether a fix landed. Use the `mcp__modem__*` bridge (reads `.env` itself; secrets never enter the transcript); `confirm: true` on its deny-listed commands (reboot, `AT+CFUN=1,1`, factory reset, `opkg remove`, raw `mtd`/`dd`, …) only for an action the user explicitly approved. UCI package: `quecmanager`. Avoid destructive commands without a stated reason; never echo `.env` values. Tool details, typical probes and the Posh-SSH fallback: `docs/reference/modem-probing.md`.

## Commits

- **Small, frequent, atomic:** one logical change per commit; commit as each step lands rather than one commit for a whole session.
- **Subject only by default:** Conventional Commits (`type(scope): summary`, e.g. `fix(sms): retry CPMS restore on busy`), imperative, lowercase, no trailing period, ≤ 72 chars.
- **Body only when the why isn't obvious** from the diff: 1–3 short lines on why, never a recap of the task or a file-by-file list.

## Release Notes (`RELEASE_NOTE.md`)

Version heading, then a 2–3 sentence summary (theme, headline features, features vs fixes vs polish; no bullets), then `## ✨ New Features` (headline additions, user-facing bullets, no internal names), `## ✅ Improvements` (headline fixes first), `## 📥 Installation` (one-line fresh install + Software Update path), `## 💙 Thank You`.

## Shared Constants

`ANTENNA_PORTS` (`types/modem-status.ts`): the 4 antenna ports (Main/PRX, Diversity/DRX, MIMO 3/RX2, MIMO 4/RX3), used by antenna-statistics + antenna-alignment. Never duplicate.

## Feature Docs (read before editing)

Each doc holds invariants the code doesn't show. CGI / hook / type / reboot table: `docs/features/README.md`. New feature with non-obvious invariants → new doc + a line here and in the README, not more text in this file.

`docs/features/`:
- `dpi-settings.md`: Traffic Engine (Video Optimizer + Masquerade, `/local-network/traffic-engine`), `nfqws`, NFQUEUE 200, `12-mangle-qmanager-dpi.nft`
- `custom-sim-profiles.md`: merged profiles+scenarios page (`custom-profile.tsx`, `active-profile-hero.tsx`, `schedule-ribbon.tsx`, `profile-form-dialog.tsx`), no auto-reapply on save (`schedule_rearmed`), deep links + scenarios-route redirect, `qmanager_profile_apply`, `profile_mgr.sh`, Verizon MPDN, ICCID auto-apply, profile locks
- `config-backup-restore.md`: `.qmbackup`, `qmanager_config_restore`, `config_backup_sections.sh`, deferred-reboot banner
- `language-packs.md`: i18n loading, `qmanager_language_install`, `language_packs.sh`, manifest, `bun run package:lang`
- `error-codes.md`: error envelopes, `resolveErrorMessage`, `errors.json`, `at-commands` namespace
- `tower-lock-failover.md`: tower locking, `qmanager_tower_failover`, failover spawn gating
- `antenna-alignment.md`: `/cellular/antenna-alignment` + `antenna-statistics`, `normalizeSignalValue` / `isPortReporting`, Positions recorder, antenna type toggle
- `scenario-profile-binding.md`: Connection Scenarios, `qmanager_scenario_schedule`, `scenario_mgr.sh`, `qmanager_profile_scenario` cron, `profiles/save.sh` re-arm (`schedule_rearmed`), scenarios card on the profiles page (old route redirects), per-profile band locks, `scenario_locked_by_schedule`
- `sms.md`: `cellular/sms.sh`, `sms_sent.sh`, `set_smsc`, `sms-settings-dialog.tsx`, `brand-mark.tsx`, `lib/logo-store.ts`, `qsms` broker client (`sms_tool` retired), `/dev/smd11`, `AT+CPMS` storage (`sms_storage.sh`, `qmanager_sms_storage`), ME+SM merge
- `alerts.md`: `/monitoring/alerts`, `alert_engine.sh` (downtime state machine on `ev_link_state`, reboot detection via `boot_id`), `alert_routing.sh`, `monitoring/alerts.sh`, `alert_routing.json`, `use-alerts.ts`, `alert_after_min`, `record_planned_reboot`, `/etc/qmanager/crash.log`, Recent Reboots, `AlertsMutationResult`
- `cellular-settings.md`: `/cellular/settings`, `cellular/settings.sh`, `use-cellular-settings.ts` (`ApplyPhase`, `WRITABLE_SETTING_KEYS`), `settings/shapes.ts`, `AT+QSIMDET`, `.sim.status`
- `apn-management.md`: single-APN model, `cellular/apn.sh`, `apn_mgr.sh`, `data_cid.sh` (QMAP-free data-CID detection, `data_cid_source`), `apn_profiles.json`, `use-apn-settings.ts`, COPS apply, boot reconcile, "Not live" badge, APN allow-list, `carrier_cid_protected`, suggested APNs (`apn-presets.json`, `bun run apn:update`, overlay)
- `band-locking.md`: `bands/current.sh`, `bands/lock.sh` (`lte`/`nsa_nr5g`/`sa_nr5g`/`nrdc_nr5g`), `qmanager_band_failover`, `supported_bands*.env`, `policy_band`
- `known-sims.md`: `sim_db.sh`, `known_iccids`, `system/known_sims.sh`, `tracked-sims-group.tsx`, `use-known-sims.ts`
- `connection-quality.md`: `qmanager_ping`, `conn_state.sh`, ICMP probe (v4/v6 fallback), ping profiles, `system/ping_profile.sh` + `quality_thresholds.sh`, DNS lookup time (`qmanager_dns.json`), `events.sh` `detect_data_connection_events` / `ev_link_state` / `ca_change` debounce, `connectivity.thresholds`, last outage (`connectivity.last_outage_*`, `/tmp/qmanager_last_outage`, mono age)
- `connection-watchdog.md`: `qmanager_watchcat` + `wd_*.sh` libs, `tools/watchdog-harness/`, `monitoring/watchdog.sh`, `use-watchdog-settings.ts`, recovery ladder, heartbeat, reboot ledger, SSR hold, verified SIM swap + failover record + auto-failback (`primary_recheck_*`)
- `scheduled-jobs.md`: crond jobs (scheduled reboot, tower/scenario schedule, auto-update), 1970 clock guard `schedule_guard.sh` / `_qm_timer_fire_allowed`, catch-up
- `sms-forwarding.md`: `qmanager_sms_forward`, `cellular/sms_forwarding.sh`, `forwarding-center.tsx`
- `tailscale-vpn.md`: `vpn/tailscale.sh`, `tailscale_mgr.sh` (install/update, sha256, rollback, lock), `tailscale_net.sh`, `qmanager_tailscale_net`, fw4 zone + `ip rule pref 1990`, `set_exit_node`
- `diagnostics.md`: `system/diagnostics.sh`, `qmanager_debug_report`, IPA offload (`ipa_offload.sh`, `r8125_ioss.init`), `pending_reboot_required`
- `system-health-check.md`: `qmanager_health_check`, `system/health-check/*.sh`, `use-system-health-check.ts`, 49-check catalog (runner + `shapes.ts` + `tests.<id>` keys), read-only invariant, redaction
- `adaptive-polling.md`: `qmanager_poller`, `system/adaptive_polling.sh`, `poller_tier`, `qmanager_force_tier2`, `write_cache`, `parse_at.sh` (parity gate `tools/poller-parity/`), `QC_WAIT_MS`, `status.json` composer, `*.env` sidecars
- `data-used.md`: Dashboard Data Used row (Storage row removed), `data_used.sh` sampler, `data_used.json`, `source` `wds`/`netdev`, `qmi_wds_*` consumer, `network/data_used.sh` (reset removed), `use-data-used.ts`
- `prometheus-metrics.md`: `/monitoring/prometheus`, `metrics/prometheus.sh`, `monitoring/prometheus.sh`, `api_auth.sh` (`qm_api_*` bearer auth), `quecmanager.metrics.*`, scrape hold
- `at-broker.md`: `qcmd`, `qmanager_atd` (Rust, `native/qmanager_atd/`), lanes (acceptor, reader pool, single AT-lane worker, queue cap 64), proto 3 / `qmi=1`, `at_engine.sh`, `qmanager_atd.sock`, host AT ports (`system/host_at_ports.sh`), `qcmd -t` / `QCMD_WAIT_MS`
- `qmi-lane.md`: `qmi` client (`/usr/bin/qmi`), `QMI` verb, read-only allow-list (18 pairs), `BROKER_CONFIG` / `BROKER_READ` (WDS packet stats, 0.6.0), `qmi_wds_*`, `qmi/` registry + codecs, SSR semantics, `qmi.env` / `qmanager_qmi.json` sidecars (`/var/run/qmanager/`), poller overlay consumer (`qmi_merge.sh`); the Phase 1 lease `/tmp/qmanager_qmi_live` is retired
- `live-signal.md`: real-time LTE serving signal (Antenna Alignment and dashboard 1 s, 5 Hz parked), `cellular/live_signal.sh` lease CGI (`bad_tier`, `lease_failed`), `qmi_live_{aim,watch}` stamps, capability token + `/qmlive/<token>.json`, `/var/run/qmanager/live` + `/www/qmlive` (`at_live_link`), `live=1` / broker 0.5.0 (`sinr` + `nr_*` sample fields), `live-signal-store.ts`, `use-live-signal.ts`, `use-live-lead.ts`, `qmi_merge.sh` overlay rule
- `ip-passthrough.md`: IPPT, `network/ip_passthrough.sh`, `ippt_config.json`, `parse_ippt_*`, Verizon lock, `network/lan_devices.sh`, `use-lan-devices.ts`
- `ondemand-radio-details.md`: `cellular/radio_details.sh`, `ondemand_radio.sh`, `qmanager_ondemand.json`, `useRadioDetails`, `stale:true`
- `custom-dns.md`: `network/dns.sh`, `dhcp.lan.dns`, odhcpd RDNSS, `use-dns-settings.ts`, `dns-providers.ts`, `dns_mode`
- `sites-monitor.md`: `qmanager_sites`, `monitoring/sites.sh`, `sites.json`, `/tmp/qmanager_sites*`
- `web-port.md`: `web_port.sh`, `qmanager_web_port`, `system/web_port.sh`, `quecmanager.web.*`, installer `prompt_web_port`, `lib/web-port.ts`
- `lan-config.md`: `network/lan_config.sh`, `use-lan-config.ts`, `lan-config-card.tsx`, self-severing apply
- `bandwidth-monitor.md`: retired; `retire_bandwidth_monitor()` upgrade cleanup in `install.sh`

`docs/reference/`:
- `ttl-mtu.md`: `/local-network/ttl-settings`, `ttl-mtu-settings/**`, `network/ttl.sh` / `mtu.sh`, SIM-profile TTL hold
- `cell-scanner.md`: `/cellular/cell-scanner/**`, `use-cell-scanner.ts`, `use-neighbour-scanner.ts`, SIM-PLMN lock gate, `prbToBandwidthMhz`, `lockScs`, scan lock
- `netbird.md`: `/monitoring/netbird`, `use-netbird.ts`, `vpn/netbird.sh`, post-uninstall `RebootDialog`
- `latency-monitor.md`: `/monitoring/latency`, `use-sites.ts`, `resolveCuts`, `SITE_MARKS`
- `safe-tmp.md`: `safe_tmp.sh` (`qm_trusted_file`, `qm_atomic_write`, `qm_run_dir`), symlink-write class
- `auth-rate-limiting.md`: `cgi_auth.sh` rate limit, `auth/login.sh`, `auth/check.sh` (read-only), lockout ladder
- `overview-splash.md`: pre-auth `/`, `public/*.sh`, `overview-card`, `resolveBodyMode`
- System Settings family: `system-settings.md`, `logs.md`, `languages.md`, `software-update.md`, `at-terminal.md`, `tailscale.md` (UI), `about-support.md`
- Design detail: `color-system.md`, `icon-system.md`, `motion-preference.md`, `toast-confirmation.md`; live-modem tooling: `modem-probing.md`
