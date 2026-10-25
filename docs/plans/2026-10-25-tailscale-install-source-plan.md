# Tailscale: choose the install source (Official or Cameron's Tiny build)

Status: **draft, awaiting approval** (2026-10-25). Large change: it touches the install/update pipeline, an init.d script, fw4/ip-rule ownership, OTA (`install.sh`) and `uninstall.sh`.

## Goal

On a fresh install or a re-install, the user picks where Tailscale comes from:

- **Official**: today's pipeline. Static arm64 tarball from `pkgs.tailscale.com`, sha256-verified, QManager's own init script, QManager's network fixes (fw4 zone + `ip rule pref 1990`).
- **Tiny**: Cameron's (iamromulan) `tailscale-tiny` ipk from his signed opkg feed, installed as-is. **None of QManager's custom fixes are applied**: no QManager init script, no network fixes, no UCI seeding.

The chosen source then drives every later path: in-app update, connect/start, boot, QManager OTA, uninstall.

Switching source stays "Uninstall, then Install with the other source". There is no in-place switch action.

## What I found

### On the live modem (read-only, 2026-10-25)

- Tailscale is **not installed** right now. The only leftover is a stale `network.tailscale` interface (`proto none`, `device tailscale0`) from an earlier Tiny install.
- Cameron's feed is **already configured** in `/etc/opkg/customfeeds.conf`:
  `src/gz iamromulan-SDXPINN-repo https://raw.githubusercontent.com/iamromulan/quectel-rgmii-toolkit/SDXPINN/opkg-feed`
- **The feed is signed.** `opkg.conf` has `option check_signature`. The feed serves `Packages.sig`, and the firmware ships its key (`/etc/opkg/keys/6262698f038d1226`, "iamromulan-SDXPINN-repo"). So `opkg install` verifies the index signature and the ipk checksum: the same fail-closed integrity the Official path gets from sha256.
- The dependencies are already installed: `kmod-tun`, `ca-bundle`.
- Free space: 48.5 MB on the overlay, 254 MB in `/tmp`. The arch is `aarch64_cortex-a53` (OpenWrt 23.05.4, RM551E-GL).

### The `tailscale-tiny` 1.104.2 package (downloaded and unpacked locally)

- **Size:** 7.6 MB ipk, 20 MB on flash. Official needs roughly twice that.
- **One multicall binary:** `/usr/sbin/tailscaled`, with `/usr/bin/tailscale` as a symlink to it. Version 1.104.2. SSH (`tailssh`, `RunSSH`) and exit-node support are compiled in.
- **It ships its own `/etc/init.d/tailscale`:**
  - procd, `START=80`, `--state /etc/tailscale/tailscaled.state`, port 41641.
  - Its `stop_service` runs `tailscaled --cleanup`, **not** `tailscale down`, so `WantRunning` survives a reboot. This is the same property our Invariant 4 protects.
  - **`service_started` brings its own network fixes:**
    - `ensure_firewall_zone` creates `network.tailscale` and a fw4 zone named `tailscale`, accepting input.
    - `ensure_mwan3_compat` detects the modem's `20xx fwmark` mwan3 rules and moves tailscaled's ip rules to 1310–1370. That puts `lookup 52` ahead of mwan3's `2005 fwmark 0x11 lookup 5`, which is the same root cause our pref-1990 rule fixes.
  - **So QManager's fixes are redundant on Tiny.** Running both risks fighting over the `tailscale` zone.
- **It ships its own `/etc/config/tailscale` conffile,** with `service_enabled '1'`.
- **The postinst always runs `/etc/init.d/tailscale enable` and `start`, even on upgrade.** Our check of `default_postinst` on the device confirms it skips `enable` during an upgrade, but the package's own lines run regardless. Result: **every opkg upgrade turns boot-enable back on.** The update path must save the user's choice before the upgrade and put it back after.
- On upgrade, `default_prerm` stops the daemon but does not disable it (`PKG_UPGRADE=1`).

### In the code

- `ts_variant` already tells `official` / `tiny` / `opkg` apart. The marker `/etc/tailscale/.qm_install_method` is authoritative, and `opkg list-installed` is the fallback.
- Today `tiny` is a **legacy build**: banner, no update, `install variant:"tiny"` → `invalid_variant`.
- The old `install_tiny()` (before `ff9ae129`) was just `opkg update && opkg install tailscale-tiny` plus the marker. The old install card had an Official/Tiny `SegmentedField`.
- **QManager's fixes currently run for every variant:**
  - CGI `connect` / `start_service` (`ts_net_prep`)
  - the boot init `qmanager_tailscale_net`
  - OTA `migrate_tailscale_net`
  - `set_net_fixes`
  - the unconditional `ts_net_teardown` in `uninstall.sh` and in CGI uninstall
- **Two latent Tiny bugs this fixes:**
  - **QManager uninstall leaves Tiny unreachable.** `uninstall.sh` tears down the `tailscale` zone, but the opkg package stays installed and its init only recreates the zone on the next service start. The node is unreachable until then.
  - **Network fixes Off breaks reachability.** On a Tiny install, `set_net_fixes false` deletes the zone Cameron's init relies on.
- `qm_write_ts_initd` and `migrate_tailscale_initd_boot_fix` are already official-only.
- The health check (`/usr/bin/tailscale version`, `init.d/tailscale` instance) works for both sources.

## Design

### Ownership rule (one helper, used everywhere)

New in `tailscale_net.sh`: `ts_net_owned`. It returns rc 0 when QManager owns reachability, which means the installed variant is **not** `tiny`. Detection is cheap and needs no opkg call:
1. The marker, if present.
2. Otherwise, whether `/usr/lib/opkg/info/tailscale-tiny.control` exists.

Every QManager fix entry point checks it: `ts_net_prep`, the boot init, `migrate_tailscale_net` and `set_net_fixes`. `ts_variant` switches to the same opkg-info-file check, replacing the slower `opkg list-installed`.

### Backend: `tailscale_mgr.sh`

| Piece | Change |
|---|---|
| Source availability | `ts_tiny_available`: rc 0 when `customfeeds.conf` (or `distfeeds.conf`) has a `src/gz` line for the iamromulan SDXPINN feed, the matching usign key is in `/etc/opkg/keys`, and `/etc/opkg/arch.conf` lists `aarch64_cortex-a53`. The feed URL comes from the device's own feed line; nothing is hardcoded and nothing is added. |
| Latest version (Tiny) | `ts_tiny_fetch_latest`: `curl` the feed's `Packages` file (~12 KB) and read the `tailscale-tiny` stanza's `Version` (strip any `-rN`, numeric guard). It has its own cache, `/var/run/qmanager/tailscale_tiny_latest.json`, with the same 6 h / 30 min TTLs. The existing cache helpers take the cache path as a parameter. The value is display-only; the real install is verified by opkg's signature check. |
| Installed version (Tiny) | Package version from `/usr/lib/opkg/status` (catches `-rN` rebuilds). The binary version stays the health-check target. |
| `ts_progress` | `variant` on `complete` comes from `TS_SOURCE` instead of the hardcoded `"official"`. |
| opkg helper | `_ts_opkg_wait`: waits up to 30 s for `/var/lock/opkg.lock`. `_ts_opkg_refresh`: runs `opkg update`, then checks that `opkg info tailscale-tiny` resolves. A partial feed failure (an OpenWrt mirror down) is tolerated when Cameron's feed loaded; otherwise `feed_unavailable`. |
| `_ts_install_body_tiny` | 1. `ts_tiny_available`, else `feed_unavailable`. 2. Guards: `/tmp` free ≥ 32 MB, overlay free ≥ 28 MB, else `insufficient_space`. 3. Wait for the opkg lock, refresh, `opkg install tailscale-tiny`. 4. Verify `/usr/sbin/tailscaled` and the `tailscale` symlink; if verification fails, run `opkg remove tailscale-tiny` best-effort and report `install_failed`. 5. Marker `tiny` (`qm_durable_write`). 6. Progress `complete` (`variant:"tiny"`). **No** `qm_write_ts_initd`, `ts_seed_uci_settings` or `ts_net_apply`. The package's postinst starts and boot-enables the daemon (see decision 2). |
| `_ts_update_body_tiny` | 1. Fresh latest-version check, else `up_to_date`. 2. Snapshot boot-enable (UCI flag + `init.d enabled`) and was-running. 3. Space guard: overlay ≥ 28 MB, MemAvailable ≥ 20 MB + 96 MB for a RAM copy of the old `/usr/sbin/tailscaled` (the rollback source; the feed only carries the latest version). 4. Refresh, then `opkg install tailscale-tiny` (an upgrade: prerm stops, postinst enables and starts). 5. Put boot-enable back to the snapshot, and stop the daemon if it was not running. 6. `ts_wait_healthy <new> 30` (`nodaemon` when it was not running). 7. **Failure:** reinstall the RAM copy over `/usr/sbin/tailscaled` (`.new` + sync + mv), restart, report `update_rolled_back`. The opkg database then says new while the binary is old, which the next check shows honestly as "update available". 8. **Success:** drop the RAM copy, then `complete`. No `ts_net_ensure_rules`. |
| Dispatch | `ts_do_install <source>` and `ts_do_update` pick the body from the argument / `ts_variant`. Lock, progress file, log, EXIT-trap rollback and the stale-worker logic are shared unchanged. The RAM backup and restore get a Tiny mode beside `overlay` / `tmp`; `ts_recover_interrupted` stays official-only. |
| Test knob | `TS_TEST_FORCE_UPDATE=1` (shell only, `unset` in the CGI like `TS_TEST_FAIL_HEALTH`) skips the up-to-date check, so the Tiny upgrade and rollback can be exercised while the feed has no newer build. |

### Backend: CGI `vpn/tailscale.sh`

| Area | Change |
|---|---|
| GET, every tier | Adds `tiny_available` (bool). Tier 1 needs it for the picker. |
| GET, installed tiers | `legacy_build` is true **only** for `opkg` (an unknown opkg Tailscale, such as the upstream OpenWrt package). `update_available` is computed for `official` and `tiny` from their own caches. `net_fixes_enabled` is **omitted** on Tiny; the frontend already hides the row when the field is absent. |
| `install` | `{source?: "official" \| "tiny"}`. `variant` is accepted as an alias for older clients. Absent means `official`. `tiny` without `tiny_available` returns `feed_unavailable`. `spawn_ts_worker install <source>`. |
| `check_update` / `update` | Routed by `ts_variant`. `update` accepts `official` and `tiny`; only `opkg` returns `legacy_build`. |
| `connect` / `start_service` | `ts_net_prep` returns early when `! ts_net_owned`. The connect auto-boot-enable stays official-only, as today. |
| `set_net_fixes` | On a Tiny install, refused with `not_applicable`. Allowed when nothing is installed. |
| `uninstall` | Tiny goes through the existing opkg branch, plus: `uci delete network.tailscale`, but only when it is `proto none` / `device tailscale0` (the interface Cameron's init created), and `rm -f /etc/config/tailscale`. `opkg remove` keeps a modified conffile, and it is now known to resurrect (Invariant 6). The trailing `ts_net_teardown` stays: once the package is gone, removing its zone is cleanup. Also deletes the Tiny latest cache. |

New error codes in `errors.json` (5 locales): `feed_unavailable`, `not_applicable`.

### Lifecycle scripts (lockstep)

| Script | Change |
|---|---|
| `qmanager_tailscale_net` (boot) | Skip with a log line when `! ts_net_owned`. |
| `install.sh` `migrate_tailscale_net` (OTA) | The UCI key migration is unchanged. The rule/zone apply is skipped on Tiny. **Never tears anything down on Tiny:** a pref-1990 rule left by an older QManager is kernel-only and harmless (and gone at the next reboot), and the zone belongs to Cameron's init. |
| `install.sh` `migrate_tailscale_initd_boot_fix` | Already official-only; no change. |
| `install.sh` seed / fresh install | No change. Fresh `install.sh` never installs Tailscale; the source is picked in the UI. |
| `uninstall.sh` | When Tiny is still installed (the package stays, it is opkg-owned), skip `ts_net_teardown` so the node stays reachable. Otherwise unchanged. Also remove `tailscale_tiny_latest.json` with the other runtime state. |
| Health check | No change; both sources pass `t_bin_tailscale` / `t_svc_tailscale`. |

Existing installs after this OTA:
- **Official**: nothing changes.
- **Tiny** (marker `tiny`, or the opkg package without a marker): it stops being "legacy". The banner goes away, Update becomes available from Cameron's feed, and QManager stops re-asserting its own fixes.
- **Unknown opkg**: stays legacy, as today.

### Frontend

- **`hooks/use-tailscale.ts`:**
  - `runInstall(source)`.
  - `TailscaleStatus` gains `tiny_available`; `install_variant` keeps `"official" | "tiny" | "opkg"`.
  - The `check_update` gate drops the `legacy_build` exclusion only for Tiny (it keys on the variant).
- **`install-card.tsx`:**
  - A **Source** `SegmentedField` (Official / Tiny, with glyph) above Install, shown only when `tiny_available`. One sentence under it describes the selected source: Official is the build from Tailscale; Tiny is a smaller community build that sets up its own network rules.
  - A `HintIcon` covers the size and feature difference.
  - The default is Official. Without `tiny_available`, the card is exactly today's single path.
- **`connection-card.tsx`:**
  - The header `Tag` shows the source as identity: a "Tiny build" Tag on Tiny, while "Community build" stays for unknown opkg.
  - The Network fixes row disappears on Tiny automatically, because the field is omitted.
- **`update-control.tsx` / `device-card.tsx`:** the update offer works for both sources. The dialog copy is source-aware (Tiny: "updates through the package manager; the tunnel reconnects for a few seconds").
- **`tailscale.tsx`:** the legacy banner only for `opkg`.
- **Locales:** i18n is `common.json` `tailscale.*` and `errors.json`, in all five catalogs. Every finished mutation keeps its toast; the install toast now names the source.
- **Rules:** canon rules apply (lucide on this route, `SegmentedField`, filled-tonal chips, no debug copy: no feed URLs, `opkg`, or paths in UI text).

### Docs

- `docs/features/tailscale-vpn.md`: the source model, the Tiny install/update flows, ownership via `ts_net_owned`, the postinst boot-enable trap, new codes, and an updated Invariant 7 and the "Only the official build" paragraph.
- `docs/reference/tailscale.md`: the picker, the Tag, the banner scope.
- `docs/API-REFERENCE.md`, the CLAUDE.md / `docs/features/README.md` routing line, and `RELEASE_NOTE.md`.

## Build order

Work in a worktree reset onto `development-home`. The main checkout has another session's uncommitted antenna-alignment edits.

1. **Libs** (Opus, sensitive): `tailscale_net.sh` (`ts_net_owned`) and `tailscale_mgr.sh` (Tiny install/update, dispatch, caches).
2. **In parallel, after 1** (disjoint files):
   - **CGI** (`vpn/tailscale.sh`)
   - **Lifecycle:** `qmanager_tailscale_net`, `install.sh`, `uninstall.sh`
   - **Frontend:** hook, components, then locales
3. **Docs and release note.**

Atomic commits per layer.

## Validation

1. **Static:**
   - `.claude/check-crlf.sh`, `sh -n`, bashisms, multi-var `local`, jq without regex, lock/trap discipline, CGI envelope.
   - `bunx tsc --noEmit` + lint on touched files, `bun run icons:check`.
2. **Live, with your OK for each write:**
   1. Deploy libs, CGI and init (scp → `/tmp` → `mv`, then `sync`). Check that GET reports `tiny_available: true`.
   2. **Tiny install** through the UI or a CGI POST: about 8 MB of cellular data plus the opkg lists. Then check:
      - the marker reads `tiny`
      - `/usr/sbin/tailscaled` is present
      - **no** pref-1990 rule appears, and **no** QManager zone writes happen
   3. **Connect.** You authenticate in the browser. Then check:
      - Cameron's zone exists
      - rules 1310–1370 are present
      - a peer pings at 0% loss
      - the page loads over `100.x`
      - `set_ssh` / `set_exit_node` work
      - `ssh_enabled` reads back; if the stripped `debug prefs` is missing, the row hides
   4. **Tiny update** via `TS_TEST_FORCE_UPDATE=1` from a shell. Check:
      - the boot-enable snapshot is restored (test with boot **off**, because the postinst turns it on)
      - the node is still logged in
      - then rerun with `TS_TEST_FAIL_HEALTH=1` to exercise the rollback
   5. **OTA** `install.sh --no-reboot` with Tiny installed. Expect no rule/zone changes. Then reboot: Tiny reconnects and the boot init logs "skipping".
   6. **Uninstall Tiny.** Check that the package, `network.tailscale`, `/etc/config/tailscale` and the zone are all gone.
   7. **Official regression:** install, check the update flow (`check_update`), then uninstall.
3. **Rollback:**
   - **Code:** revert the branch.
   - **Device:** uninstall from the page. Neither source touches anything QManager can't remove.

## Decisions I need from you

1. **Where Tiny is offered.** Recommended: only when the firmware already trusts Cameron's feed (feed line + key present, as on this RM551E build). Elsewhere the picker doesn't appear. The alternative is for QManager to add the feed and key itself on any aarch64 device, which changes persistent opkg config and the trust anchor.
2. **Tiny's post-install behaviour.** Recommended: keep the package's behaviour; it starts right away and is enabled on boot, so the page lands on "Needs login". The alternative is to normalize to the Official behaviour (stopped, boot off until Connect), which fights the package's postinst.
3. **Existing Tiny installs** become first-class (no banner, updatable from the feed) after the OTA. Recommended: yes.
