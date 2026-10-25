# QManager as an opkg ipk in iamromulan's SDXPINN feed

Status: **plan, awaiting approval**. Large change (installer + OTA + lifecycle lockstep).

## What the recon established

**How QuecManager shipped** (`QuecManagerBetaReleases/ipk-source/sdxpinn-quecmanager-beta/`):
- `CONTROL/{control,preinst,postinst,prerm,postrm}` + `root/` (final on-device layout) + `build-ipk`.
- The ipk is a **gzip'd tar** (`debian-binary`, `control.tar.gz`, `data.tar.gz`), not `ar`. I checked this on the feed files, and the device's opkg accepts it.
- `Architecture: sdxpinn`. The device's arch list includes `sdxpinn 2`, which `sdxpinn-patch` adds.
- It never shipped `/www/index.html`, because that file is owned by `luci-base` (checked live). Instead, postinst moved `index.html` to `index.html.old` and copied `login.html` over it. postrm restored it.
- The maintainer scripts were tiny: they only stopped, enabled and started services. None of them looked at `$1`.
- Known defects we won't copy:
  - the cgi `chmod` glob is a no-op;
  - modes and CRLF come from whatever the Windows working copy has;
  - it needs `sudo` just to `chown`.

**How it reached the feed** (PRs #180–#209 on iamromulan/quectel-rgmii-toolkit):
1. We PR the fork's `development-SDXPINN` into upstream `development-SDXPINN`. The PR touches only `ipk-source/<pkg>/CONTROL/control` (the version bump) and `root/**`. The body is release notes.
2. Cameron merges it, runs `build-ipk`, and copies the ipk into `opkg-feed/`. He then runs `rebuild-feed.sh` (signed with his private usign key, key id `6262698f038d1226`) and hand-fixes the stanza.
3. He commits "QM Beta X" and merges `development-SDXPINN` into `SDXPINN`. Devices only follow `SDXPINN`: `src/gz iamromulan-SDXPINN-repo …/SDXPINN/opkg-feed`, with signature checking ON.
- Our fork's `development-SDXPINN` is 40 commits behind upstream and needs syncing first.

**Dependencies on a real RM551E (live, read-only):**

| Dependency | Status | Verdict |
|---|---|---|
| `timeout`, `flock`, `sha256sum` | BusyBox applets | drop `coreutils-timeout` |
| `curl`, `ethtool`, `openssl-util`, `ca-bundle` | in the firmware image | drop, as you asked |
| `jq` | **not** in the firmware; installed by our own `install.sh` (Apr 2026); `sdxpinn-patch` installs nothing | **must stay** (used by 136 scripts) |
| `msmtp`, `ookla-speedtest` | optional; alerts installs msmtp on demand | drop |
| `inotifywait`, `sms-tool`, `websocat`, `socat`, `uhttpd`, `ca-certificates` | unused or already present | drop |

So the Depends list becomes `sdxpinn-patch (>= 3.0), jq`. The live unit has `sdxpinn-patch` 3.0 and upstream is at 3.2.

## Package

```
Package: sdxpinn-qmanager
Version: 0.1.35            (from package.json, leading "v" stripped)
Architecture: sdxpinn
Depends: sdxpinn-patch (>= 3.0), jq
Conflicts: sdxpinn-quecmanager, sdxpinn-quecmanager-beta, sms-tool, socat-at-bridge, socat, websocat
Replaces:  (same list)     → opkg removes them on install, mirroring install.sh remove_conflicts
Maintainer / Source / Description: same convention as QuecManager
```

The payload has the same layout `install.sh` produces today: `/www` (minus `index.html`, which ships as `/www/qmanager-index.html`), `/www/cgi-bin/quecmanager/**`, `/usr/bin/*` + `qmanager_atd`, `/usr/lib/qmanager/*`, `/etc/init.d/qmanager*`, `/etc/nftables.d`, `/etc/sysctl.d` and `/etc/qmanager/*` defaults. It also includes `/usr/share/qmanager/{install.sh,uninstall.sh}`, which the maintainer scripts drive. Size is about 15 MB installed against 48 MB free.

## Design: one lifecycle, two front doors

The maintainer scripts **don't re-implement** `install.sh`. They call new non-interactive modes in it, so lockstep holds automatically.

- **`install.sh --configure`** (postinst): runs every phase except file copy, opkg calls, prompts, the firmware gate, long health checks and reboot.
  - Retire steps: bandwidth monitor and low power.
  - Legacy cleanup.
  - Generated artifacts: the `qcmd`/`qsms`/`qmi` symlinks, `/www/qmlive`, `alert_routing.json`.
  - UCI seed and migrations, `fw4 reload`, `sysctl -p`.
  - The `index.html` swap, two-phase `VERSION`, enabling services (honouring `UCI_GATED_SERVICES`) and restoring the running-services snapshot.
  - `sync`.
  - It sets `pending_reboot_required` so the deferred-reboot banner prompts the user. It never reboots.
- **preinst:** takes the watchcat maintenance lock, snapshots running services to `/tmp`, and stops `qmanager*` (to avoid ETXTBSY on `qmanager_atd`). On a first ipk install over a tarball install (no prior package version), it wipes the stale unowned `/www/*` the way `install_frontend` does. It keeps `cgi-bin`, `luci-static` and `index.html.old`.
- **prerm** (`remove` only, not `upgrade`): runs **`uninstall.sh --deconfigure`**. This does everything except deleting packaged files (opkg does that), prompts and reboot:
  - stop and disable services, restore uhttpd ports, and run `port-bridged`;
  - tear down nft, sysctl and tailscale state;
  - strip cron lines, remove the symlinks and `/tmp/qmanager_*`.
  - Config in `/etc/qmanager` and UCI is kept, per opkg convention.
- **postrm:** restores `luci-base`'s `index.html` from `index.html.old`, then runs `sync`.

**Channel coexistence.** The tarball and GitHub Releases path stays as is.
- `install.sh` and `qmanager_update` detect an opkg-owned install (`/usr/lib/opkg/info/sdxpinn-qmanager.control`). They refuse a tarball install over it unless `--force`, because that would orphan opkg's file list.
- Under an ipk install, the Software Update CGI reports `managed_by: "opkg"` (see decision 2).

## Build tooling (in this repo)

- **`scripts-dev/build-ipk.sh`** + **`bun run package:ipk`**: reuses `build.sh`'s staging, then assembles `CONTROL/` + `root/`.
  - Explicit modes: 755 for `.sh`, init.d, `/usr/bin` and the ELF.
  - CR stripping on every text file.
  - `tar --owner=0 --group=0 --numeric-owner`, so no `sudo` is needed.
  - Output: `qmanager-build/sdxpinn-qmanager_<ver>_sdxpinn.ipk` and an exportable `ipk-source/sdxpinn-qmanager/` tree (CONTROL + root + a fixed `build-ipk`) for the upstream PR.
- Static check: `tar tzvf` asserts the outer member order, LF-only scripts, the 755 bits, and that `/www/index.html` is absent.

## Build order

1. Worktree off `development-home`.
2. Add the `install.sh --configure` and `uninstall.sh --deconfigure` modes, plus the opkg-ownership guard in `install.sh` and `qmanager_update`.
3. `CONTROL/` scripts + `build-ipk.sh` + `package:ipk`.
4. The Software Update `managed_by` field and its UI state (decision 2).
5. Docs:
   - `docs/features/ipk-packaging.md`;
   - routing in CLAUDE.md and `docs/features/README.md`;
   - `DEPLOYMENT.md`;
   - `RELEASE_NOTE.md`.
6. Feed CI (workflow + scripts), rehearsed in our fork with a throwaway key.
7. Upstream PRs, CI first and then QManager, each needing a separate approval (see below).

## Validation

- **Static:** CRLF checker, BusyBox/POSIX audit of all CONTROL scripts and the new modes, and the `tar` structure check. Frontend: `bunx tsc --noEmit` + lint on touched files.
- **On-device:** this needs your OK, because it writes live state. Install the built ipk locally with `opkg install /tmp/sdxpinn-qmanager_*.ipk` over the current tarball install, then check:
  - the services come up;
  - `index.html` is swapped and `VERSION` is correct;
  - the CGI responds;
  - the deferred-reboot banner shows.
  - Then `opkg remove sdxpinn-qmanager` and check that LuCI's `index.html` is back and nothing is left running. Reinstall, then restore the tarball install.
- **Not testable live:** the auto-removal of an old `sdxpinn-quecmanager-beta` via `Replaces`. This unit never had it, so I'd test it on a spare unit or document it as unverified.
- **Rollback:** `qmanager-installer.sh` or the tarball `install.sh --force` puts the current install back.

## Upstream: CI builds and signs the feed in Cameron's repo (option B)

Goal: a QManager release is just our PR plus Cameron's merge. A GitHub Actions workflow in `iamromulan/quectel-rgmii-toolkit` builds the ipks and signs the feed. His private key lives only in his repo secrets, and neither we nor any PR code can read it.

### Workflow `.github/workflows/opkg-feed.yml`

- **Triggers:**
  - `push` to `development-SDXPINN` with `paths: ipk-source/**`;
  - `workflow_dispatch`, for a manual full rebuild.
  - Never `pull_request_target`, so fork PRs can't reach the secret.
- **Job `build`** (no secrets, `contents: read`):
  - Diffs `before..after` to find the changed `ipk-source/<pkg>/` dirs. On dispatch, it takes all of them.
  - Builds each one with a single central `.github/scripts/build-ipk.sh`, never a per-package `build-ipk`, so package content can't inject code into CI.
  - Same format as today: a gzip'd tar of `debian-binary`, `control.tar.gz` and `data.tar.gz`, built with `--owner=0 --group=0 --numeric-owner`, explicit 755 modes and CR stripping. No `sudo`.
  - `.github/scripts/build-feed.sh` regenerates `Packages` from scratch out of each ipk's own `control` file (plus `Filename`, `Size`, `MD5Sum` and `SHA256sum`), then writes `Packages.gz`. This removes the hand-fixed placeholder-stanza step in `rebuild-feed.sh`.
  - Superseded versions of a rebuilt package are deleted from `opkg-feed/`.
  - It uploads the new ipks and `Packages*` as an artifact. The diff against the current `Packages` goes into the job summary.
- **Job `sign`** (`needs: build`, `contents: write`, runs in GitHub environment `feed-signing`):
  - It runs only the workflow's inline steps and executes nothing from the repo.
  - It downloads the artifact and writes secret `SDXPINN_USIGN_KEY` to a `umask 077` temp file.
  - It runs `opkg-feed/usign_x64 -S -m Packages -s <key>` (a Linux x86-64 ELF, so it runs on `ubuntu-latest`). It then verifies with `usign_x64 -V -p opkg-feed/iamromulan-SDXPINN-repo.key -m Packages`, and the job fails if that check fails.
  - The key file is deleted. The bot commits `opkg-feed/` as "opkg-feed: rebuild (<pkgs>)".
  - That commit can't retrigger the workflow, because pushes made with `GITHUB_TOKEN` don't fire workflows.
- Third-party actions are pinned by commit SHA.
- Cameron's `rebuild-feed.sh` stays in place as his manual fallback.

### Cameron's one-time setup (goes in the PR body)

1. Add the repo secret `SDXPINN_USIGN_KEY` (the contents of `iamromulan-SDXPINN-repo-private.key`).
2. Create the environment `feed-signing`, optionally with himself as required reviewer. With that, he approves each signing run with one click.
3. Under Settings → Actions → Workflow permissions, allow read and write.

Devices still see a release only when he merges `development-SDXPINN` into `SDXPINN`, same as today.

### Rehearsal in our fork before any upstream PR

- Sync the fork's `development-SDXPINN` (40 behind).
- Generate a throwaway usign keypair, store it as a fork secret, and run the workflow end to end on a scratch branch.
- Check that `Packages` matches the ipks, `usign -V` passes, the CI-built `sdxpinn-qmanager` ipk installs on the live modem (step 5 of the validation), and a rerun with no changes commits nothing.
- Commits keep LF bytes (`-c core.autocrlf=false`); `.gitattributes` in the PR pins `ipk-source/** text eol=lf`.

### Two upstream PRs to `iamromulan/quectel-rgmii-toolkit:development-SDXPINN` (each only after your OK)

1. **"ci: build and sign the SDXPINN opkg feed"**: the workflow, the two scripts and `.gitattributes`. It's worth having for every package in his feed, so it lands on its own merits. Merging it plus the one-time setup above turns it on.
2. **"QManager <ver>"**: adds `ipk-source/sdxpinn-qmanager/` (CONTROL + root). The body uses the QuecManager release-notes format and notes the new package name and the `Conflicts`/`Replaces` on the old QuecManager packages.
   - Once the CI PR is live, this PR's merge builds, signs and commits the ipk with no manual steps.
   - Future releases are a version bump plus a `root/` refresh, exported straight from `bun run package:ipk` here.

`build-ipk.sh` in this repo and `.github/scripts/build-ipk.sh` upstream stay byte-identical: ours is a vendored copy, and a test compares the two outputs. That way the ipk we test on-device is the one CI ships.

## Decisions I need from you

1. **Package name:** `sdxpinn-qmanager` (new, recommended), or reuse `sdxpinn-quecmanager`? Reusing it fails `opkg upgrade` because 0.1.35 < 2.3.4.
2. **In-app Software Update under an ipk install:** show "Managed by package manager" and refuse the tarball OTA (recommended, smallest), or have it run `opkg update && opkg upgrade sdxpinn-qmanager`?
3. **`sdxpinn-patch` floor:** `>= 3.0` (tested live, recommended) or the old `>= 2.5`?
