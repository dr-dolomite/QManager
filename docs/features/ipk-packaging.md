# Package Install (ipk) — `sdxpinn-qmanager`

QManager ships a second install channel next to the GitHub tarball: an opkg package, `sdxpinn-qmanager`, in iamromulan's SDXPINN software feed. The package carries exactly the files a tarball install would copy, and its maintainer scripts drive the same installer logic, so one lifecycle serves two front doors. While the package is installed, opkg owns the files and the tarball/OTA path refuses to touch them.

## Quick Reference

| Thing | Where |
|---|---|
| Package / arch | `sdxpinn-qmanager`, `Architecture: sdxpinn` (added to the device's opkg arch list by `sdxpinn-patch`) |
| Version | `package.json` `version` with a leading `v` stripped (`assemble_ipk_source.py` `read_version`) |
| Depends | `sdxpinn-patch (>= 3.0), jq` |
| Conflicts + Replaces | `sdxpinn-quecmanager, sdxpinn-quecmanager-beta, sms-tool, socat-at-bridge, socat, websocat` |
| Ownership marker | `/usr/lib/opkg/info/sdxpinn-qmanager.control` (every guard tests this file) |
| Build | `bun run package:ipk` (= `bun run package` then `bun run ipk`) |
| Build only the ipk (tarball already built) | `bun run ipk` → `scripts-dev/ipk/build-ipk.sh` |
| Build tooling | `scripts-dev/ipk/{assemble_ipk_source.py,build_ipk.py,check_ipk.py,build-ipk.sh}` |
| Outputs (`qmanager-build/`, git-ignored) | `sdxpinn-qmanager_<ver>_sdxpinn.ipk`, `ipk-source/sdxpinn-qmanager/{CONTROL,root}` (the tree the feed PR adds) |
| Installer modes | `install.sh --configure` (postinst), `QM_INSTALL_ENTRY=ipk_preinst` (preinst), `install.sh --ignore-package`; `uninstall.sh --deconfigure` (prerm), `uninstall.sh --ignore-package` |
| On-device package files | `/usr/share/qmanager/{install.sh,uninstall.sh,index.html,manifest,defaults/}` |
| Reboot flag | `/tmp/qmanager_pending_reboot_package` → `system/pending_reboot.sh` `package` → banner source `package_install` |
| Hand-off files | `/tmp/qmanager_ipk_running` (services running before preinst stopped them), `/tmp/qmanager_watchcat.lock` (maintenance lock held across the unpack) |
| Update CGI | `system/update.sh` GET `managed_by`/`package_name`, POST error `package_managed` |
| Frontend | `components/system-settings/software-update/{derive.ts,managed-card.tsx,status-band.tsx,page-header.tsx}` (`"managed"` view), `hooks/use-software-update.ts`, `hooks/use-boot-pending-reboot.ts`, `lib/reboot/index.ts` |
| Install log | `/tmp/qmanager_install.log` (preinst truncates it, postinst appends, so one log covers the whole package install) |

## Package and container

- **Container is a gzip'd tar, not `ar`.** The outer file holds `debian-binary` (`2.0\n`), `control.tar.gz`, `data.tar.gz` in that order, inner members named `./path`. This matches every ipk already in the SDXPINN feed and is what the device's opkg accepts. `check_ipk.py` asserts the member order.
- **Deterministic build.** `build_ipk.py` sets owner `root:root` and per-file modes itself instead of reading them from disk. A Windows checkout (no exec bits, `core.autocrlf=true`) therefore builds the same bytes as Linux CI. Executable (0755): the four maintainer scripts, files starting `#!`, ELF binaries, `*.sh`, everything under `bin/`, `sbin/`, `usr/bin/`, `usr/sbin/`, `etc/init.d/`. Everything else is 0644.
- **CR stripping is limited to scripts and config** (CONTROL files, `#!` files, `*.sh`, `*.nft`, `*.conf`, `*.env`, `etc/init.d/*`). Web assets and the ELF are copied byte-for-byte. Timestamps come from `SOURCE_DATE_EPOCH` (`build-ipk.sh` passes the HEAD commit time), gzip headers carry no timestamp, entries are sorted: same input, same bytes.
- **Why `Depends` is only `sdxpinn-patch, jq`.** `curl`, `ethtool`, `openssl-util` and `ca-bundle` are baked into the firmware image; `timeout`, `flock`, `sha256sum` are BusyBox applets; `sdxpinn-patch` installs no userland. `jq` is the one real gap: roughly 136 scripts use it and the tarball installer was the thing that installed it (it is not in the firmware). `msmtp` stays on-demand (the alerts feature installs it), so it is not a dependency. The `>= 3.0` floor is the version tested live.
- **Why `Conflicts` + `Replaces`.** They mirror what the tarball installer does by hand: `remove_conflicts` (anything that opens `/dev/smd11`, which the `qmanager_atd` broker must own alone) and `retire_bandwidth_monitor` (`websocat`). `sdxpinn-quecmanager` and `-beta` are the predecessor packages; the new name avoids the version trap (QuecManager is at 2.3.4, so reusing its name would make `opkg upgrade` treat 0.1.x as older).
- **Payload layout** (`assemble_ipk_source.py` `target_for`, built from `qmanager.tar.gz` so the package carries exactly what a tarball install copies): `/www/**` (minus `index.html`), `/www/cgi-bin/quecmanager/**`, `/usr/bin/*` plus `qmanager_atd`, `/usr/lib/qmanager/*`, `/etc/init.d/*`, `/etc/nftables.d/*`, `/etc/sysctl.d/*`, and `/usr/share/qmanager/**`. The assembler fails the build if a tarball member has no package path, if `www/index.html` appears, or if `install.sh` is not stamped with the `package.json` version.

## Invariants

### One lifecycle, two front doors

The maintainer scripts do not re-implement the installer. They call modes of `install.sh` and `uninstall.sh`, so a fix to a lifecycle step lands in both channels.

| opkg hook | What runs | Notes |
|---|---|---|
| preinst | `install.sh` itself, embedded by `assemble_ipk_source.py` behind `QM_INSTALL_ENTRY=ipk_preinst` | The new files are not on disk yet, so it cannot be a path call. Runs `mark_version_pending`, `retire_bandwidth_monitor`, `retire_low_power`, `stop_services`, writes `/tmp/qmanager_ipk_running`. The watchcat maintenance lock is released on failure only; on success the postinst holds it across the unpack. |
| postinst | `/bin/sh /usr/share/qmanager/install.sh --configure` | If it fails part-way, its EXIT trap (`configure_exit`) restarts the services the preinst stopped and drops the watchcat lock, so the modem is never left without its daemons. |
| prerm | `/bin/sh /usr/share/qmanager/uninstall.sh --deconfigure \|\| true` | `remove` only; an `upgrade` skips it because the new preinst handles the stop. |
| postrm | `sync` | `remove` only. `/usr`, `/www`, `/etc` are UBIFS, so the removal is committed to flash. |

**`--configure` runs every post-copy phase and nothing else:** firmware check (warn-only), web-port read, the `index.html` swap, pruning of unshipped files, fw4 reload and `sysctl -p`, `seed_runtime_files`, `cleanup_legacy_scripts`, Tailscale migrations, `seed_uci_defaults` (symlinks, `/www/qmlive`, UCI seed and migrations), `enable_services` (honouring `UCI_GATED_SERVICES`), `start_services` (restoring the running-services snapshot), `finalize_version`, `sync`. `seed_runtime_files` and `src_has` are the shared pieces: the tarball path calls the same function, `--configure` just reads from the package's `defaults/` and `manifest` instead of a source tree.

**Why the maintainer scripts never call opkg, prompt, or reboot.** opkg holds its own lock while they run (a nested `opkg` call deadlocks), `opkg` can hand a script the terminal (`prompt_web_port` also checks `IN_OPKG`), and a reboot would kill the install mid-transaction. `IN_OPKG=1` makes `retire_bandwidth_monitor` skip its `opkg remove websocat` (the `Conflicts`/`Replaces` pair covers it). The firmware gate is a warning, never a `die`: `Architecture: sdxpinn` already limits the package to the SDX75 family, and a failing postinst leaves a half-configured package behind.

**Deferred reboot, not a reboot.** The postinst ends by touching `/tmp/qmanager_pending_reboot_package`. `system/pending_reboot.sh` returns `{ "verizon": bool, "package": bool }`, deleting each flag as it reports it (clear-on-read), and `use-boot-pending-reboot.ts` turns `package: true` into `requestRebootLater("package_install")`, which raises the persistent banner (`common.json` `pending_reboot.description.package_install`). Same deferred-reboot pattern as [`config-backup-restore.md`](config-backup-restore.md) and [`diagnostics.md`](diagnostics.md) (IPA offload). The tarball/OTA path reboots after every install; the package path cannot, so the banner is how the user finishes the update. The flag is `/tmp`, so a reboot clears it.

**Every maintainer script exits at once when `IPKG_INSTROOT` is set**, the preinst included. An offline-root install with `--force-postinstall` runs all four on the build host; without the guard the preinst would stop and kill services there.

**A failed unpack after a successful preinst leaves services stopped** until reboot (or until the package is installed again): the postinst never runs, and `/tmp/qmanager_watchcat.lock` stays until `/tmp` clears. opkg has no hook between the two to restore them.

**The services file is untrusted input.** `/tmp/qmanager_ipk_running` carries the preinst's running-services snapshot to the postinst, which runs as root. `restore_running_services` only starts plain `qmanager*` names from it.

### `/www/index.html` is not shipped

`luci-base` owns `/www/index.html`; shipping it from QManager would make opkg report a file conflict (or silently replace LuCI's). The package ships QManager's entry page as `/usr/share/qmanager/index.html`. `--configure` calls `backup_originals` (moves LuCI's file to `/www/index.html.old`) and copies ours into place; `uninstall.sh` `remove_frontend` moves `index.html.old` back. `check_ipk.py` and the assembler both fail the build if `www/index.html` is in the payload.

### Defaults deploy only if missing; opkg never owns user config

`/etc/qmanager/*` defaults ship under `/usr/share/qmanager/defaults/` and `seed_runtime_files` copies each only when the target is absent. There are no `conffiles`. The one exception is `supported_bands_hw.env`, a hardware spec sheet that is force-copied on every configure, as the tarball install does.

### The manifest and pruning

`/usr/share/qmanager/manifest` lists every payload path (root-relative, no leading slash, including itself). The self-entry is a sentinel: `preflight_configure` refuses an empty manifest or one that does not list itself, because a cut-short manifest would make every "is this shipped?" test fail and delete the install. `--configure` uses it two ways:

- `src_has <path>`: `cleanup_legacy_scripts` asks the manifest, not a source tree, whether a `qmanager_*` binary, init.d script or library is still shipped; unshipped ones are legacy and are removed.
- `prune_unshipped`: removes regular files and symlinks under `/www` (keeping `cgi-bin luci-static index.html index.html.old qmlive`) and under `/www/cgi-bin/quecmanager` that the manifest does not list, then empty directories. **Why:** a tarball install over which the package lands leaves files opkg does not track, and a Next.js chunk or CGI removed in a later release would otherwise live forever.

> ℹ️ NOTE: Language packs installed at runtime (`/www/locales/<code>`, [`language-packs.md`](language-packs.md)) are not in the manifest, so `--configure` prunes them. The tarball install's `/www` wipe does the same, so this is parity, not a new regression. Reinstall the pack afterwards.

### Tarball / OTA coexistence

While `/usr/lib/opkg/info/sdxpinn-qmanager.control` exists, every non-opkg writer refuses. A tarball install over a package install would leave opkg's file list wrong; opkg would later remove or upgrade the wrong files.

| Surface | Behaviour under a package install |
|---|---|
| `install.sh` | Exits 1 with "update it with `opkg update && opkg upgrade sdxpinn-qmanager`" and "to switch, `opkg remove` first". `--ignore-package` bypasses. (`--configure` is exempt: it is the package's own path.) |
| `uninstall.sh` | Exits 1 with "`opkg remove sdxpinn-qmanager`". `--ignore-package` bypasses; `--deconfigure` (the prerm) is exempt. |
| `qmanager_update` | `die`s in `preflight()` before the watchdog is stopped, so a refused run changes nothing. |
| `qmanager_auto_update` | Logs and `exit 0` at start (crond job; no error noise). |
| `system/update.sh` GET | Returns early with `managed_by: "opkg"`, `package_name: "sdxpinn-qmanager"`, `update_available: false`, `auto_update_enabled: false`, and every GitHub-derived field `null`/empty (no network call). The tarball branches emit `managed_by: "tarball"`. |
| `system/update.sh` POST | `download`, `install_staged`, `install`, `rollback`, `save_auto_update` return `cgi_error "package_managed"` (HTTP 200 envelope). `save_prerelease` is not gated. |

`--ignore-package` only bypasses the installer guards. While `/usr/lib/opkg/info/sdxpinn-qmanager.control` exists, Software Update and auto-update stay in the `managed` state; run `opkg remove` first to hand updates back to the app.

Details of the page contract are in [`../reference/software-update.md`](../reference/software-update.md); the error key is in [`error-codes.md`](error-codes.md).

### Uninstall (`--deconfigure`) is a full removal that keeps `/etc/qmanager` and UCI

`--deconfigure` = `--force --keep-config --no-reboot`. The code path is the ordinary uninstall: `stop_services`, `remove_services`, `remove_backend`, `remove_frontend`, `remove_runtime_state`. That stops and disables services, restores uhttpd to 80/443 if QManager moved it, tears down nft/sysctl/Tailscale state, **deletes the packaged files**, restores LuCI's `index.html`, and clears `/tmp/qmanager_*` including both package hand-off files. Unlike a tarball uninstall, package mode **keeps the whole `quecmanager` UCI config** (`/etc/config/quecmanager`, the `tailscale_net` section included), as OpenWrt packages keep `/etc/config`, so a reinstall picks the settings back up (`seed_uci_defaults` only adds). `/etc/qmanager` (password hash, profiles, locks, backups) is kept too. An **upgrade** skips the prerm entirely.

Package mode also **keeps QManager's cron lines** (scheduled reboot, tower schedule, auto-update, scenario schedule). **Why:** only a settings save writes them, so stripping them while UCI says "enabled" left a reinstall showing a scheduled reboot that never fired (seen on device). With `/usr/bin/qmanager_*` gone they do nothing, and they fire again after a reinstall.

Prerm deletes the files before opkg's own deletion pass. On the device opkg treats the paths that are already gone as a silent no-op: `opkg remove` exits 0, prints nothing extra, and leaves none of the 829 listed paths behind (verified 2026-10-26).

## Building

```sh
bun run package:ipk      # next build + build.sh + ipk (full)
bun run ipk              # ipk only, from an existing qmanager-build/qmanager.tar.gz
```

`build-ipk.sh` needs Python 3.8+ (standard library only). It runs `assemble_ipk_source.py` (tarball → `qmanager-build/ipk-source/sdxpinn-qmanager/{CONTROL,root}`), `build_ipk.py` (tree → `.ipk`), then `check_ipk.py` (exit 1 unless the structure is right). `check_ipk.py` asserts: gzip container and member order, `debian-binary`, control fields (`Package`, `Architecture`, exact `Depends`, file name matches `Version`), the four scripts are 0755 with `#!/bin/sh` and no CR, preinst is `install.sh` behind `QM_INSTALL_ENTRY=ipk_preinst`, everything is root-owned, no `www/index.html`, `qmanager_atd` is a 0755 ELF, scripts have no CR, and the manifest equals the payload exactly.

> ℹ️ NOTE: `scripts-dev/ipk/build_ipk.py` must stay **byte-identical** with the feed repo's `.github/scripts/build_ipk.py` (checked against the merged upstream copy, `55f1bfd7`, 2026-11-03). `.gitattributes` pins `scripts-dev/ipk/*` to LF so a Windows checkout cannot change the bytes. Edit one, copy to the other, in a PR to each repo.
>
> The local ipk and the CI ipk have the **same contents, not the same bytes**: `build-ipk.sh` stamps mtimes with QManager's HEAD commit time, while CI uses the time of the last upstream commit touching `ipk-source/sdxpinn-qmanager`. Compare by file list and per-file hashes, not by the ipk's sha256.

## Releasing to the feed

Devices follow the `SDXPINN` branch of `iamromulan/quectel-rgmii-toolkit` with signature checking on. Feed CI ([iamromulan/quectel-rgmii-toolkit#218](https://github.com/iamromulan/quectel-rgmii-toolkit/pull/218), merged 2026-10-31) builds and signs on merge, so a release is our PR plus two merges by the feed owner. Nobody builds or signs by hand.

1. **Bump `package.json` `version` to a final release** (`v0.1.36`, never `-draft`, `-testN` or `-beta`; see versioning below). `bun run package:ipk`; `check_ipk.py` must pass.
2. **Sync the fork's `development-SDXPINN` with upstream first.** CI pushes bot commits (`CI: autobuild (…)`) to upstream, sometimes editing `ipk-source/<pkg>/CONTROL/control`. Branch from the synced tip.
3. **PR to `iamromulan/quectel-rgmii-toolkit:development-SDXPINN`** that replaces `ipk-source/sdxpinn-qmanager/{CONTROL,root}` with `qmanager-build/ipk-source/sdxpinn-qmanager/` (copy the whole tree so removed files go too; commit with `-c core.autocrlf=false`). Touch **nothing else**, `opkg-feed/` above all: `Packages*`, the ipks and `opkg-feed/build-state.json` belong to the bot. Body: release notes in the QuecManager format. Ask for a merge commit or rebase, not squash, so authorship is kept.
4. **On merge**, `.github/workflows/opkg-feed.yml` runs (push to `development-SDXPINN` with paths `ipk-source/**`):
   - **build** job (no secrets, read-only): `plan_build.py` compares each `ipk-source/<dir>` git tree hash with `opkg-feed/build-state.json` and selects what changed (state, not history: re-runs, cancelled runs and force-pushes are safe, a re-run is a no-op). Then the central `build_ipk.py` per package and the incremental `build_feed.py` (only rebuilt stanzas replaced, new ones appended, `Packages.gz` regenerated, superseded ipks deleted).
   - **sign** job (environment `feed-signing`, `contents: write`): checks out the exact commit the build used, verifies the pinned sha256 of `opkg-feed/usign_x64`, applies auto-bumped control files only if just the `Version:` line differs, cross-checks the new state against the source trees, signs `Packages` with secret **`OPKG_USIGN_KEY`** (one key for every feed branch), verifies against `opkg-feed/iamromulan-SDXPINN-repo.key`, and commits `CI: autobuild (sdxpinn-qmanager)` with one line per package (`added` / `upgraded` / `rebuilt` / `removed`). On a push race it rebases once and pushes only if the signature still verifies.
5. **The feed owner merges `development-SDXPINN` into `SDXPINN`**; devices see the release only then.

Manual runs (`workflow_dispatch`) take a form: `mode` `changed` (default) / `all` (rebuilds every package and overwrites hand-curated stanzas, deliberate only) / `listed` (+ `packages`), and `dry_run`.

**Why central build scripts:** package content never runs in CI, and the sign job executes nothing from the repo except the hash-pinned `usign_x64`, so a PR cannot reach the signing key. There are no `pull_request` triggers.

### Versioning rules the feed enforces

opkg compares versions the dpkg way (`epoch:upstream-revision`, revision = after the last `-`), and `plan_build.py` uses the same algorithm.

- **Always bump `Version`** when `root/` changes. If the source changed but `Version` equals the feed's, CI adds a package revision as a fallback (`0.1.36` → `0.1.36-1`, `-1` → `-2`, `-rN` keeps its style) and writes it back into upstream `CONTROL/control`. That build works, but the opkg version (`0.1.36-1`) no longer matches the `VERSION` stamped into `install.sh` (`v0.1.36`), and the fork must re-sync before the next PR.
- **A lower version fails the build.** `0.1.36-draft`, `0.1.36-test1` and `0.1.36-beta` all sort **above** `0.1.36` (a non-empty revision beats an empty one), so shipping one to the feed would make the final `0.1.36` a downgrade that CI rejects. If a pre-release must reach the feed, use `~` (`0.1.36~beta1` sorts below `0.1.36`); otherwise keep pre-releases on the tarball channel.
- **Deleting `ipk-source/sdxpinn-qmanager/` removes the package** (stanza and ipk) from the feed on the next `changed` run. Deleting files inside `root/` is an ordinary update.

## Install, upgrade, remove

```sh
opkg update
opkg install sdxpinn-qmanager      # fresh install, or over a tarball install
opkg upgrade sdxpinn-qmanager      # upgrade; prerm skipped, preinst stops services
opkg remove sdxpinn-qmanager       # prerm tears down; /etc/qmanager kept
```

A first package install over a tarball install is supported: opkg overwrites the files it ships and `--configure` prunes the stale unowned `/www` files. `Conflicts`/`Replaces` cover the old QuecManager packages (untested, see below). Installing needs `sdxpinn-patch` on the device (it adds the `sdxpinn` architecture). After any install or upgrade the Software Update page shows the `managed` view and the reboot banner asks the user to reboot.

### Rollback to the tarball install

```sh
opkg remove sdxpinn-qmanager
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
# or, from an extracted release: sh /tmp/qmanager_install/install.sh --ignore-package
```

`--ignore-package` is only needed if the opkg `.control` file is still present (a broken removal). After a clean `opkg remove` the plain installer works, and it reuses the UCI settings the removal kept.

## Software Update `managed` view

See [`../reference/software-update.md`](../reference/software-update.md). Summary: `resolveView` returns `"managed"` when `managed_by === "opkg"` (checked after the `unreachable` guard, before any run state). The band shows an info chip "Package install"; tiles read Installed ("Installed as a software package"), Updates ("Package manager", "Not checked on this page") and Automatic updates ("Not available for a package install"). One card (`managed-card.tsx`) names the package and says upgrades come from the package manager (LuCI Software page). No check/download/install/version/notes controls render, and the header's check button is hidden.

## Lifecycle lockstep

The tarball path in `install.sh`, `--configure`, `uninstall.sh` `--deconfigure` and the update path must stay in sync. A new service, `/tmp` file, reload flag, symlink or UCI key goes into **both** the tarball steps and the `--configure` / `--deconfigure` steps (usually one shared function, as with `seed_runtime_files`). A new payload directory also needs a row in `assemble_ipk_source.py` `target_for`, otherwise the build fails with "no package path" (by design).

## Verified on device (RM551E, 2026-10-26)

Install over a tarball v0.1.35 install, `opkg remove`, then reinstall:

- **Tarball-to-package migration works.** `opkg install` exits 0; opkg overwrites the tarball's files, and `--configure` pruned 124 stale `/www` files (old Next.js chunks) while keeping LuCI's `cgi-bin` and `luci-static`. `qmanager`, `qmanager_atd` and `qmanager_sites` run; `/www/index.html` is QManager's and `index.html.old` is LuCI's 838 B page; `VERSION` = `v0.1.35`, no `VERSION.pending`; no watchcat lock left; UCI choices preserved.
- Software Update GET returns `managed_by:"opkg"`; POST `download` returns `package_managed`; `sh /usr/share/qmanager/install.sh` refuses with exit 1; `system/pending_reboot.sh` reports `package:true` once, then `false`.
- **`opkg remove`**: exit 0, LuCI's `index.html` back, no QManager processes, no payload path left, `/etc/qmanager` kept. The UCI keep and the cron keep above came out of this run: the first remove dropped `tailscale_net` and the cron lines, and both were fixed afterwards. With the final ipk, a second remove left `crontab -l` and `uci show quecmanager` byte-identical, and the reinstall picked both up unchanged.
- `/etc/qmanager/VERSION` is removed on deconfigure and rewritten by the next install (expected).
- `opkg install --force-reinstall` of the same version is a full remove (the installed prerm runs, not the upgrade skip) followed by a fresh install.

## Known unverified assumptions

1. **`Replaces` auto-removal of an old QuecManager package.** The test unit never had `sdxpinn-quecmanager(-beta)` installed, so `Conflicts`+`Replaces` removing it on install is untested. If it does not, `opkg remove` the old package first. Two more things to check in that test: QuecManager's postrm restores LuCI's `index.html` from `index.html.old`, so if opkg runs it after our postinst the device lands on LuCI (a `--force-reinstall` fixes it); and opkg never moves QuecManager users across by itself (`opkg upgrade` follows package names), so they must `opkg install sdxpinn-qmanager`. Retiring the old packages from the feed is the feed owner's call (deleting their `ipk-source/` dirs drops them on the next CI run).
2. **Feed CI on GitHub with the real key.** Merged upstream 2026-10-31. Our original workflow passed a fork rehearsal with a throwaway key; the feed owner's additions (state-based planning, auto-bump, deletions) were run locally with a throwaway key but not yet on GitHub. The first `sdxpinn-qmanager` PR will be the first real run: check the `CI: autobuild` commit, the job summary and `opkg update` + `opkg install` on a device after the `SDXPINN` merge.
3. **The QManager package has not been PR'd upstream yet.** The feed owner asked (PR #218 comment) how QManager packaging will be published, since `build_ipk.py` points at `scripts-dev/ipk/`, which is only public once this branch merges into `development-home` and is pushed.

## Related

- [`config-backup-restore.md`](config-backup-restore.md), [`diagnostics.md`](diagnostics.md): the deferred-reboot banner pattern
- [`language-packs.md`](language-packs.md): runtime `/www/locales` packs and pruning
- [`error-codes.md`](error-codes.md): `package_managed`
- [`../reference/software-update.md`](../reference/software-update.md): the page contract
- [`../DEPLOYMENT.md`](../DEPLOYMENT.md): install paths
- [`../plans/2026-10-25-ipk-packaging-plan.md`](../plans/2026-10-25-ipk-packaging-plan.md): the approved plan and recon
