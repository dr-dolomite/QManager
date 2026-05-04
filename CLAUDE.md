## Design Context

**Users**: hobbyist power users + field technicians managing Quectel modems on OpenWRT. Technically literate, not developers. Sessions range from quick checks to focused configuration.

**Brand**: Modern, Approachable, Smart — premium tool that respects user intelligence without requiring modem-engineer knowledge.

**Aesthetic**: Vercel/Linear polish meets Grafana/UniFi density. Light + dark first-class (OKLCH). Euclid Circular B (primary), Manrope (secondary). Radius `0.65rem`. Avoid terminal/legacy/consumer styling.

### Status Badge Pattern
All status badges: `variant="outline"` + semantic color classes + `size-3` lucide icons. Never solid variants.

| State | Classes | Icon |
| ----- | ------- | ---- |
| Success | `bg-success/15 text-success hover:bg-success/20 border-success/30` | `CheckCircle2Icon` |
| Warning | `bg-warning/15 text-warning hover:bg-warning/20 border-warning/30` | `TriangleAlertIcon` |
| Destructive | `bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30` | `XCircleIcon` / `AlertCircleIcon` |
| Info | `bg-info/15 text-info hover:bg-info/20 border-info/30` | Context-specific |
| Muted | `bg-muted/50 text-muted-foreground border-muted-foreground/30` | `MinusCircleIcon` |

Reusable `ServiceStatusBadge` at `components/local-network/service-status-badge.tsx`. Use muted for deliberately inactive states; destructive for failure/error states.

### Design Principles
1. **Data clarity first** — metrics scannable at a glance.
2. **Progressive disclosure** — essentials upfront, advanced controls accessible.
3. **Confidence through feedback** — every action shows loading/success/error.
4. **Consistent** — shadcn/ui + design tokens uniformly, no one-off styles.
5. **Responsive + resilient** — graceful loading/empty/error states, never blank.

### UI Component Conventions
- **CardHeader**: plain `CardTitle` + `CardDescription`, no icons (icons go in badges / action areas).
- **Primary actions**: default variant (not outline). Use `SaveButton` for save actions.
- **Step progress**: `Loader2Icon` spinner + dot indicators. Reserve fill bars for data viz (signal strength, quality meters) only.

## Release Notes (`RELEASE_NOTE.md`)

Sections: `## ✨ New Features`, `## ✅ Improvements`, `## 📥 Installation`, `## 💙 Thank You`. Short user-facing bullets; no internal function names. Headline features first; fixes/polish under Improvements. Include the one-line fresh install command + Software Update upgrade path.

## CGI Endpoint Reference (Additions)

| Feature | CGI Script | Hook | Types | Reboot? |
|---|---|---|---|---|
| Video Optimizer | `network/video_optimizer.sh` | `use-video-optimizer.ts` + `use-cdn-hostlist.ts` | `video-optimizer.ts` | No |
| Traffic Masquerade | `network/video_optimizer.sh` | `use-traffic-masquerade.ts` | `video-optimizer.ts` | No |
| NetBird VPN | `vpn/netbird.sh` | `use-netbird.ts` | inline | Yes (uninstall) |
| Config Backup | `system/config-backup/{collect,apply,apply_status,apply_cancel}.sh` | `use-config-backup.ts` + `use-config-restore.ts` | `config-backup.ts` | Deferred (dialog + banner for IMEI/profile) |

## Feature-Specific Notes

### DPI Settings (Video Optimizer + Traffic Masquerade)
- Routes: `/local-network/video-optimizer` (settings + CDN hostlist), `/local-network/traffic-masquerade`. Old `/local-network/dpi-masking` redirects.
- Binary: `nfqws` from zapret, installed to `/usr/bin/nfqws` on demand by `qmanager_dpi_install` (arch-detect → fetch `openwrt-embedded.tar.gz`). State files: `/tmp/qmanager_dpi_install.{json,pid}`.
- **Single shared nfqws on queue 200** — VO and masquerade are mutually exclusive modes of ONE process: single PID (`/var/run/nfqws.pid`). Backend enforces mutex in `save`/`save_masquerade`; init.d checks masquerade first, then VO.
- **nft rules are persistent**, shipped as `/etc/nftables.d/12-mangle-qmanager-dpi.nft` (chain `mangle_postrouting_qmanager_dpi`, `oifname "rmnet*"`, `queue num 200 bypass`). fw4 sources the file on every load/reload, so rules survive `fw4 reload` (VPN toggles, port-forward edits, mwan3 ipset refreshes, etc. — all of which used to silently wipe the runtime-injected rules). The `bypass` flag means rules are safe to leave permanent even when nfqws is not running. The init.d script never touches nftables — it only manages the daemon. `dpi_helper.sh` no longer has `dpi_insert_rules` / `dpi_remove_rules`. Uninstall removes the .nft file and drops the live chain.
- Modes: VO = SNI split (`split2`) + QUIC desync, filtered by `--hostlist`. Masquerade = fake TLS ClientHello with spoofed SNI (default `speedtest.net`), all traffic.
- Hostlist: `/etc/qmanager/video_domains.txt` (active) + `video_domains_default.txt` (immutable). Hostlist CGI supports GET `?section=hostlist`, POST `save_hostlist`, POST `restore_hostlist`.
- GET handlers gate live stats on UCI `enabled` to avoid cross-mode contamination. Kernel check: `dpi_check_kmod()` reads `/proc/config.gz` for `CONFIG_NETFILTER_NETLINK_QUEUE=y`.
- Boot persistence: enabling either mode → init.d `enable`; disabling → `disable` only if BOTH are off. Uninstall always `disable`s.
- Deps: `libnetfilter-queue`, `libnfnetlink`, `libmnl`, full `curl`, NFQUEUE kernel support.

### Custom SIM Profiles
- Route: `/cellular/custom-profiles`. IMEI is optional (empty = don't change).
- **Async 4-step apply** (APN → TTL/HL → IMEI → MPDN rule, least → most disruptive). Each step skips when unchanged. Worker: `qmanager_profile_apply`, polled via `profiles/apply_status.sh` at 500ms.
- Active marker: `/etc/qmanager/active_profile` (plain text, profile ID). Written BEFORE `AT+CFUN=1,1` (USB reset can kill the script). Finalization re-writes on success/partial; clears on total failure.
- Activate = runs full pipeline. Deactivate = clears marker only, zero modem changes.
- **SIM mismatch**: poller `collect_boot_data()` auto-clears marker + emits `profile_deactivated` when active profile's `sim_iccid` ≠ current SIM. Empty `sim_iccid` = SIM-agnostic, left alone. Frontend shows "SIM Mismatch" warning badge.
- TTL override: `ttl-settings-card.tsx` disables form when active profile has TTL/HL > 0.
- **ICCID auto-apply**: `profile_mgr.sh::auto_apply_profile <iccid> <caller>` spawns worker detached. Called via `( . /usr/lib/qmanager/profile_mgr.sh && auto_apply_profile "$iccid" "<tag>" )` from: poller boot (`boot`), `cellular/settings.sh` post-SIM-switch (`sim_switch`, 3×1s ICCID retry), watchcat Tier 3 success (`watchdog`), watchcat SIM failover fallback (`watchdog_revert`, 3×1s retry).
- Auto-apply guards: `profile_check_lock` (no race with manual Activate) + `profile_count > 0`. Worker's per-step skip logic is the single source of truth for "only apply what differs" — `auto_apply_profile` does NOT pre-compare.
- Events: `profile_applied`/`profile_failed`/`profile_deactivated` in `dataConnection` tab.
- **Lock layering — DO NOT collapse onto one file**: two distinct concerns, two files.
  - `/tmp/qmanager_profile_spawn.lock` — owned by `apply.sh` CGI. Atomic-create via `set -C` noclobber. Rejects concurrent POSTs while the worker is coming up. Released after the CGI's poll loop confirms the worker is alive.
  - `/tmp/qmanager_profile_apply.pid` — owned by the worker (`qmanager_profile_apply`). Singleton enforcement via `profile_acquire_lock`. Cleared by the worker's EXIT trap.
  - Why two: the worker's `profile_acquire_lock` does `kill -0` on whatever PID it finds. If the CGI pre-wrote `$$` into the worker's PID file, the worker would see its own (still-sleeping) parent CGI as a foreign holder and abort. v0.1.22 hit this bug — manual Activate failed with `start_failed` while boot auto-apply still worked (boot path only `profile_check_lock`s, never acquires). Helpers: `profile_acquire_spawn_lock` / `profile_release_spawn_lock` / `profile_check_lock` / `profile_acquire_lock` in `profile_mgr.sh`.
  - CGI must NEVER touch `$PROFILE_APPLY_PID_FILE`; worker must NEVER touch `$PROFILE_SPAWN_LOCK_FILE`.

#### Verizon MPDN Handling (mno = "Verizon")
- **Why**: RM551E + Verizon SIM only delivers Data + SMS via PDP context 3, not the default 1. Backend forces APN onto CID 3 and writes a QMAP MPDN rule (`AT+QMAP="mpdn_rule",0,3,0,0,1`) routing the WAN data session through PDP3.
- **Form-level UX**: Selecting "Verizon" in `custom-profile-form.tsx` triggers an explicit `AlertDialog` warning the user not to manually release the rule (firmware quirk: bare release + reboot can brick the modem until firmware reflash). On confirm, CID is locked to 3 (input disabled with helper text) until the user switches MNO.
- **MNO comparator**: backend AND frontend compare the literal label `"Verizon"` (NOT the preset id `"vzw"`) — that's what `MNO_PRESETS` stores into `profile.mno`. If you rename the preset label, you must update every `[ "$_x_mno" = "Verizon" ]` shell check in scripts (worker, apply.sh, deactivate.sh, ip_passthrough.sh, profile_mgr.sh).
- **USB-mode pre-flight**: Verizon profiles require ECM (1) or RNDIS (3). `apply.sh` blocks pre-spawn with the `usb_mode_incompatible_for_verizon` error code if `AT+QCFG="usbnet"` returns 0 (RMNet) or 2 (MBIM). The worker has a defense-in-depth check too — fails all 4 steps with the same code if reached. Frontend resolves the code via `errors.json`. Note: `cgi_error` returns HTTP 200 with a JSON envelope (`{success:false, error:"...", detail:"..."}`), not a 4xx status — the frontend dispatches on the `error` field.
- **Switching AWAY from Verizon**: any non-Verizon profile that activates while PDP3 is the active context runs the documented release-then-immediately-reset pair (`AT+QMAP="mpdn_rule",0` → `AT+QMAP="mpdn_rule",0,1,0,0,1`, NO sleep between, NO reboot before re-pin). NEVER issue a bare release. The two `qcmd` calls are intentionally back-to-back in `mpdn_revert_to_default` (`profile_mgr.sh`); future maintainers must not insert anything between them.
- **Deferred reboot pattern**: revert step sets `apply_requires_reboot: true`. `deactivate.sh` returns `{ success, requires_reboot }`; frontend writes `setPendingReboot("verizon_revert")` (extends `lib/config-backup/pending-reboot.ts` source union). Persistent banner via `usePendingReboot` picks it up.
- **Boot-path auto-revert**: `auto_apply_profile` in poller boot context — when SIM mismatch clears an active Verizon profile, it runs `mpdn_revert_to_default`, touches `/tmp/qmanager_pending_reboot_verizon`, emits `verizon_mpdn_reverted` warning event, then proceeds with the existing `profile_deactivated` warning event and marker clear.
- **IP Passthrough lock**: when active profile is Verizon, `ip_passthrough.sh` POST blocks with `ip_passthrough_locked_by_verizon_profile` (via `cgi_error` — HTTP 200 envelope, not a 4xx). Frontend `ip-passthrough-card.tsx` uses `useActiveProfile()` (lightweight read-only hook in `hooks/use-active-profile.ts`, polls `/profiles/list.sh` every 30s) and renders an info `Alert` + disables the entire form via outer `<fieldset disabled>`. GET endpoint stays open so the disabled form still shows current values.
- **New events** (both `dataConnection` tab): `verizon_mpdn_applied` (info), `verizon_mpdn_reverted` (info from CGI deactivate / warning from boot path).
- **New error codes** (in `errors.json` × 4 locales): `usb_mode_incompatible_for_verizon`, `mpdn_rule_failed`, `mpdn_rule_revert_failed`, `ip_passthrough_locked_by_verizon_profile`, `partial_apply`, `all_steps_failed`.

### Configuration Backup and Restore
- Route: `/system-settings/config-backup`. 8 sections: Network Mode + APN, LTE/5G bands, Tower Lock, TTL/HL, IMEI, Custom SIM Profiles, SMS Alerts, Watchdog.
- **Overlap rule**: Custom SIM Profiles is mutex with APN/TTL/HL/IMEI — profile activation owns those.
- **Encryption**: mandatory passphrase, AES-256-GCM via WebCrypto. PBKDF2-SHA256 200k iters, 16-byte salt, 12-byte IV. Header bound as AES-GCM AAD via `canonicalHeaderAad()`. Passphrase never leaves browser.
- **File**: `.qmbackup` JSON envelope — plaintext header + base64 ciphertext (+ appended GCM tag). Filename: `qmanager-<model>-<YYYYMMDD-HHMMSS>.qmbackup` (UTC).
- **Section library**: `/usr/lib/qmanager/config_backup_sections.sh` — one `collect_<key>`/`apply_<key>` pair per section + `cfg_backup_{collect,apply}` dispatcher. Sourced by `collect.sh` CGI + worker. **Caller owns `qlog_init`**.
- **Apply order (fixed)**: `sms_alerts → watchdog → network_mode_apn → bands → tower_lock → ttl_hl → imei → profiles`. Safe first, reboot-queuing last.
- **Async worker**: `/usr/bin/qmanager_config_restore` (double-fork via `apply.sh`). PID `/var/run/qmanager_config_restore.pid`; progress `/tmp/qmanager_config_restore.json`; input `/tmp/qmanager_config_restore_input.json`; cancel `/tmp/qmanager_config_restore.cancel`.
- **Retry**: 3 retries, backoff 1s/2s/4s, only on rc=1. rc=2 (unsupported) / rc=3 (SIM mismatch) bypass retries. Cancel checked between sections.
- **States**: `pending`, `running`, `retrying:N`, `success`, `failed`, `skipped:incompatible`, `skipped:not_in_backup`, `skipped:sim_mismatch`. Frontend `RestoreProgressList` uses `min-w-[7.5rem] justify-center` on all badges for width stability.
- **Deferred reboot (CRITICAL — QManager runs ON the modem)**: `apply_imei` writes IMEI via `AT+EGMR=1,7,"<imei>"` but does NOT `AT+CFUN=1,1`. `apply_profiles` writes `active_profile` marker but does NOT spawn `qmanager_profile_apply`. Both `touch /tmp/qmanager_config_restore.reboot_required`. Worker surfaces `reboot_required: true`. Frontend shows reboot AlertDialog + persistent banner (localStorage `qmanager_pending_reboot`). **One reboot total** — on next reboot, poller's boot-time `auto_apply_profile` picks up the marker, finds IMEI already correct.
- Reboot dialog handlers in `restore-backup-card.tsx` / `config-backup.tsx` check `res.ok` and rethrow on non-2xx (`authFetch` only throws on network errors).
- Guards: `apply.sh` returns 409 on active PID. `apply.sh`/`apply_cancel.sh` reject non-POST. 256 KiB cap via `CONTENT_LENGTH`.
- Cross-device: backup records `device.{model,firmware,imei}`. Browser compares `device.model` → `model_warning` state on mismatch. Appliers still silently downgrade unsupported items to `skipped:incompatible`.
- Profile auto-activation: ICCID match (`profile_iccid` vs `/tmp/qmanager_status.json::current_iccid`); mismatch → rc=3 → `skipped:sim_mismatch`, marker NOT written.
- Events (`dataConnection` tab): `config_backup_collected`, `config_restore_{started,section_success,section_failed,section_skipped,completed}`.
- Tests: `lib/config-backup/{crypto,format,sections}.test.ts` via `bun test`. Project's first Bun test setup — `tsconfig.json` excludes `**/*.test.ts` so `bun tsc --noEmit` doesn't choke on `bun:test` imports.
- TS 5.9 quirk: `crypto.ts` public API accepts bare `Uint8Array`; private `toFixedBuffer()` coerces to `Uint8Array<ArrayBuffer>` for `crypto.subtle.*`.

### Language Packs (Plan 11+)
- Route: `/system-settings/languages`.
- **Hybrid delivery**: EN + zh-CN bundled via `public/locales/` static imports (`lib/i18n/resources.ts`). Additional packs downloaded from a remote manifest → installed to `/www/locales/<code>/` on-device.
- **i18next-http-backend** wired in `lib/i18n/config.ts`. Load path `/locales/{{lng}}/{{ns}}.json`. Detection accepts any catalog code (`AVAILABLE_LANGUAGES`), not just `BUNDLED_CODES` — the backend lazy-loads non-bundled packs.
- **CGI contract** (`/cgi-bin/quecmanager/system/language-packs/`):
  - `list.sh` GET → `{ installed:[{code,version}], manifest, manifest_error? }`
  - `install.sh` POST `{code, manifest_url}` → 202 `{ok,state:"running",code}` or 409 on active install
  - `install_status.sh` GET → `{ state, code, progress, message }` — polled 1500ms
  - `install_cancel.sh` POST → `{ok:true}` (touches `/tmp/qmanager_language_install.cancel`)
  - `remove.sh` POST `{code}` → `{ok:true}`. Rejects `en` / `zh-CN` with `cannot_remove_bundled`.
- **Shared library**: `/usr/lib/qmanager/language_packs.sh` — `lp_list_installed`, `lp_pack_is_code_safe`, `lp_fetch_manifest`, `lp_manifest_find_pack`, `lp_verify_sha256`, `lp_validate_pack_tree`, `lp_remove_pack`, `lp_disk_free_kb`, `lp_write_progress`. Callers own `qlog_init`.
- **Install worker**: `/usr/bin/qmanager_language_install` — double-fork pattern mirror of `qmanager_config_restore`. Progress JSON `/tmp/qmanager_language_install.json`; PID `/var/run/qmanager_language_install.pid`; cancel flag `/tmp/qmanager_language_install.cancel`; input `/tmp/qmanager_language_install_input.json`. Pipeline: fetch manifest → find pack → disk-space pre-flight → curl tarball → sha256 verify → extract to staging → validate namespace tree → atomic `mv` to `/www/locales/<code>/` → write `.version`.
- **Manifest shape** (spec §6.2): `{ manifest_version:1, generated_at, packs:[{ code, native_name, english_name, rtl, version, completeness, size_bytes, sha256, url, contributors? }] }`. Default URL: `lib/i18n/language-pack-manifest.ts::DEFAULT_MANIFEST_URL`. Overridable per-install via the `manifest_url` body field.
- **Pack tarball layout**: flat — `<ns>.json` files at top level (same shape as bundled `public/locales/<code>/<ns>.json`). Must contain every namespace in `LP_REQUIRED_NS` (matches `ALL_NAMESPACES`). Missing or invalid JSON → worker fails with "Pack is missing required namespaces".
- **Firmware updates wipe `/www/*`** — `install.sh::install_frontend` preserves only `cgi-bin`, `luci-static`, `index.html.old`. Downloaded language packs are wiped on each firmware update; user re-installs via the Languages card. Spec §2 accepts this as a non-goal.
- **Remove-active-language flow**: frontend switches i18n to `en` and flips `<html lang dir>` BEFORE calling `remove.sh`, so i18next doesn't fail to resolve a freshly-deleted pack.
- **Concurrency**: `install.sh` returns 409 if `/var/run/qmanager_language_install.pid` is live. `remove.sh` has no concurrency guard — fast enough to race-safely.
- **Disk-space pre-flight**: worker checks `df /www` against `pack.size_bytes / 1024 + 64 KB slack`; fails fast with "Not enough disk space".
- **Sidebar**: Languages entry under System Settings (sibling of Software Update / AT Terminal / Luci, not inside the System Settings collapsible). `t_key: "languages"` resolves via `sidebar.items.languages`.
- **LanguageSwitcher** lists bundled + installed packs. Downloadable-but-not-installed packs are hidden from the switcher — they only surface in the Languages card's Available section.
- **i18next-icu is PINNED OUT** — native `_one`/`_other` plurals + default `{{var}}` interpolation handle every shipped string. Re-adding the plugin breaks plurals (Plan 4 post-ship incident — commit `00bdd9e`).

#### Language Pack Publishing Workflow
- **Builder**: `bun run package:lang <code> [version] [--publish] [--push] [--update-manifest <url>] [--contributors <csv>] [--skip-check]`. Implemented as a pure TypeScript file at `scripts-dev/build-lang-pack.ts` (not `scripts/` — that dir is OpenWRT staging and gets shipped to devices). Runs entirely inside one bun process to avoid bash→node/bun PATH resolution hell (see commit `c4f3708` for the bash-based attempt that was reverted).
- **`scripts-dev/` convention**: dev-only tooling. Excluded from `tsconfig.json` (Bun ambient globals, different target). NOT copied into the firmware tarball by `build.sh`.
- **Pipeline**: validates code registration in `available-languages.ts` → extracts `LP_REQUIRED_NS` from `language_packs.sh` → verifies namespace files → JSON-parses every `*.json` → runs `bun run i18n:check` → tars flat (`tar -czf <archive> -C <localeDir> *.json`, spawned with cwd=outDir and RELATIVE paths for cross-shell compat) → sha256 + size → writes `.sha256` sidecar → walks dotted scalar paths for `completeness` ratio vs EN → optionally patches `language-packs/manifest.json` (dedupe by code, sort, atomic tmp+rename).
- **Windows tar quirk**: Windows ships two tar variants — `System32\tar.exe` (bsdtar, used in pwsh/cmd) and MSYS2 GNU tar (used in Git Bash). Absolute-path forms are incompatible between them (`D:/foo/bar` fails under MSYS2 tar which reads `D:` as an rcp remote host; `/d/foo/bar` fails under bsdtar). Builder sidesteps this by spawning tar with `cwd=outDir` + relative paths. **Different tar flavors produce different sha256 for the same source files** (header format, file ordering, gzip params all differ) — pick one shell per pack so the manifest-hosted sha stays stable across republishes. Recommended: pwsh (matches typical dev default).
- **Recommended one-command publish** (same-day republish OK, tarball is deterministic if source files unchanged and shell is the same):
  ```
  bun run package:lang <code> --publish --push
  bun run package:lang <code> --publish --push --contributors "@handle"
  ```
  `--publish` requires `gh` CLI + `gh auth login`. It uploads the tarball to the persistent `language-packs` GitHub Release (creates it on first run with `--latest=false` so it stays out of the firmware feed), replaces any existing asset of the same filename (`--clobber`), and auto-patches `language-packs/manifest.json`. `--push` then commits and pushes the manifest; skips gracefully if manifest is already up to date in git.
- **Persistent release**: all language pack tarballs live as assets under a single `language-packs` release tag. Never delete this release. Per-code-version releases (`lang-it-2026.04.23` etc.) are legacy and no longer created.
- **Manual publish** (fallback if `gh` unavailable):
  1. `bun run package:lang <code> [--contributors "@handle"]` → writes tarball.
  2. Upload asset to the `language-packs` GitHub Release manually.
  3. `bun run package:lang <code> --update-manifest <asset-url> --push` → patches and commits manifest.
- **`--contributors` preservation**: re-running without `--contributors` automatically reads the existing manifest entry and preserves the contributors field. Pass `--contributors` explicitly only to change or set it.
- **GitHub raw CDN caches `raw.githubusercontent.com/.../development-home/manifest.json` for 5 min** (`max-age=300`). After push, devices see stale manifest until cache expires. Verify with `curl -sI <url> | grep -iE "cache-control|source-age"`. No workaround — inherent to the CDN choice. Manual install commands shown in the Languages card are generated from the (possibly stale) manifest sha — use the new command after the CDN revalidates if sha verification fails on-device.
- **Default manifest URL**: `lib/i18n/language-pack-manifest.ts::DEFAULT_MANIFEST_URL` points at the `development-home` raw URL. Change here if switching branches or CDNs.

### Error Code Vocabulary (Plan 12+)

- **Namespace**: `errors` in `public/locales/{en,zh-CN}/errors.json`. Flat dictionary, 148 keys: 146 stable backend error-code strings + two catch-alls (`unknown`, `unknown_with_detail`).
- **Backend contract**: CGI scripts + daemons emit `{ error: "<code>", detail?: "<string>" }` (or `{ success: false, error, detail }`). Codes are stable snake_case tokens. Do NOT rename existing codes without a coordinated frontend sync — they are contract.
- **Frontend resolution**: use `lib/i18n/resolve-error.ts::resolveErrorMessage(t, code, detail, fallback)`. Tries `errors.<code>`; unknown code with detail → "Modem reported: {{detail}}"; no code → detail verbatim; else caller fallback.
- **Usage pattern** (any component with `t` in scope from any namespace):
  ```ts
  toast.error(resolveErrorMessage(t, res.error, res.detail, "Save failed"));
  ```
  The helper resolves via `{ ns: "errors" }` explicitly, so the caller's own namespace hook is fine — no second `useTranslation` needed.
- **Adding a new code**: emit the snake_case string from the CGI → add one key to EN `errors.json` → add the zh-CN counterpart. `bun run i18n:check` enforces parity.
- **AT-commands namespace migration**: Plan 12 moved `system-settings.at_terminal.{commands,blocked_*,warning_disable_radio}` out into a new `at-commands` namespace (26 command labels + `blocked.*` + `warnings.*`). `BLOCKED_COMMANDS` / `WARNING_COMMANDS` `messageKey` values dropped the `blocked_`/`warning_` prefix; consumers resolve via `t(\`blocked.\${key}\`, { ns: "at-commands" })` / `t(\`warnings.\${key}\`, { ns: "at-commands" })`.

### Tower Lock Failover (v0.1.18+)
- Route: `/cellular/tower-locking`.
- **Contract**: LTE/NR-SA cell lock does NOT auto-enable Signal Failover — user must explicitly flip switch in `tower-settings.tsx`. Unlocking still auto-stops + auto-disables failover.
- Default: `TOWER_DEFAULT_CONFIG.failover.enabled = false`. Existing configs preserved by `tower_config_init` on upgrade.
- Install gating: `qmanager_tower_failover` in `UCI_GATED_SERVICES` (install.sh) — fresh install cannot auto-run; upgrade preserves prior symlink.
- **Unlock hardening**: init.d `stop` = SIGTERM → poll `is_daemon_pid_running` up to 2s via `sleep_fractional` (`usleep 100000` fallback to `sleep 1`) → `kill -9`. Always clears `$PID_FILE` + `$ACTIVATED_FLAG`, `return 0`.
- **Self-heal**: `failover_status.sh` (polled 3s) checks `.lte.enabled`/`.nr_sa.enabled`. Orphan watcher with no active lock → inline `stop` (NOT `disable` — preserve user's `failover.enabled` intent).
- **Spawn gating**: `tower_spawn_failover_watcher()` is the single choke point — early-returns `"false"` when `.failover.enabled != "true"`. All callers (`lock.sh`, `settings.sh`, `qmanager_tower_schedule`) go through it.
- Frontend: `use-tower-locking.ts::sendLockRequest` does NOT force `config.failover.enabled = true` from `data.failover_armed`. Config flows only from `fetchStatus()` / `updateSettings()`.
- UX hint: `tower-settings.tsx` shows "Failover is off — enable it to auto-unlock on poor signal." when `hasActiveLock && !failover.enabled`.
- `settings.sh` disable-on-off + unlock-when-no-locks paths still run init.d `disable` (user intent). Band failover (`bands/lock.sh`) is out of scope — separate feature.

### Antenna Alignment
- Route: `/cellular/antenna-alignment`. No CGI — reads `useModemStatus` (`signal_per_antenna`).
- Structure: `antenna-alignment.tsx` (coordinator) + `antenna-card.tsx` + `alignment-meter.tsx` + `utils.ts`.
- Shared constant: `ANTENNA_PORTS` from `types/modem-status.ts` (re-exported via local `utils.ts`).
- **Signal quality gotcha**: `getSignalQuality()` returns **lowercase** (`excellent`/`good`/`fair`/`poor`/`none`). All switch/map consumers must use lowercase.
- Alignment Meter: 3-slot recorder, averages 3 samples per slot. Composite score = 60% RSRP + 40% SINR (primary antenna, NR preferred in EN-DC). Recommendation appears after 2+ slots.
- Two antenna types (user-selectable toggle): Directional (0°/45°/90°) + Omni (A/B/C), labels editable.
- Recording progress uses `Loader2Icon` + dots (not fill bars). `detectRadioMode()` returns `lte`/`nr`/`endc`.

## Shared Constants
- **`ANTENNA_PORTS`** (`types/modem-status.ts`): canonical metadata for 4 ports (Main/PRX, Diversity/DRX, MIMO 3/RX2, MIMO 4/RX3). Used by `antenna-statistics` + `antenna-alignment`. Do not duplicate.
