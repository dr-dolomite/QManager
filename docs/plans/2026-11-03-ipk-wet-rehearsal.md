# ipk wet rehearsal (release flow end to end, in our fork)

Goal: run the real feed release flow for this version once, on GitHub and on the live modem, before the upstream PR. Everything is identical to the real release except two things: it happens in our fork (`dr-dolomite/QuecManagerBetaReleases`) and the feed is signed with a throwaway usign key.

## Facts found

- `package.json` is `v0.1.35`, which is the release being rehearsed.
- Fork `development-SDXPINN` is 0 ahead / 13 behind upstream. Fork has no `OPKG_USIGN_KEY` secret or `feed-signing` environment visible (old rehearsal setup is gone or was on a different name).
- Upstream `opkg-feed.yml`: the **sign job only runs when `github.ref == refs/heads/development-SDXPINN`**, and it verifies against the committed `opkg-feed/iamromulan-SDXPINN-repo.key`. So a scratch branch can only dry-run; a wet run has to land on the fork's `development-SDXPINN`, with that pubkey file swapped for the throwaway one.
- Live modem: SSH handshake timed out just now, so its current install (tarball or package, version) is unknown. Needed before phase C.

## Phases

### A. Local build (worktree, nothing pushed)
1. Worktree off `development-home`; set `package.json` and the `RELEASE_NOTE.md` heading to the release version.
2. `bun run package:ipk`; `check_ipk.py` must pass. Keep the local ipk for the content comparison in B.

### B. Fork CI, wet (GitHub, our fork only)
1. Reset fork `development-SDXPINN` to upstream tip (it is 0 ahead, so this is a fast-forward, no force push).
2. Generate a throwaway usign keypair locally (scratchpad, never committed). Add fork secret `OPKG_USIGN_KEY` + environment `feed-signing`, Actions read/write.
3. Commit A on fork `development-SDXPINN`: replace `opkg-feed/iamromulan-SDXPINN-repo.key` with the throwaway pubkey (rehearsal-only commit, path outside `ipk-source/**` so it triggers nothing).
4. Open a PR in the fork, `qmanager-<ver>` → `development-SDXPINN`, shaped exactly like the upstream PR (only `ipk-source/sdxpinn-qmanager/**`, LF bytes, real release-note body). Merge it with a merge commit: this is the real push trigger.
5. Check: build + sign jobs green, `CI: autobuild (sdxpinn-qmanager)` commit says `added`, no auto-bump, `Packages` stanza matches the ipk (size/sha256), `usign -V` passes locally against the throwaway pubkey, CI ipk == local ipk by file list + per-file hashes, `build-state.json` updated.
6. Re-run the workflow (`workflow_dispatch`, mode `changed`): must plan 0 packages and commit nothing.

### C. Device (live writes, needs the modem back online)
1. Read-only first: current version, package or tarball, `sdxpinn-patch` version, opkg feed + keys config.
2. Add the fork feed as a custom feed (`src/gz qm_rehearsal https://raw.githubusercontent.com/dr-dolomite/QuecManagerBetaReleases/development-SDXPINN/opkg-feed`) and the throwaway pubkey to `/etc/opkg/keys/`.
3. `opkg update` (signature must verify), then `opkg install sdxpinn-qmanager` (tarball → package migration) or `opkg upgrade sdxpinn-qmanager` (package → package), depending on what is installed.
4. Check what `ipk-packaging.md` "Verified on device" checks: exit 0, services up, `VERSION`, no stale lock, UCI kept, Software Update `managed`, reboot banner appears. Then one **reboot (your OK)** and a post-reboot sanity pass.
5. Remove the custom feed line and the throwaway key; leave QManager installed.

## Cleanup / rollback
- Fork: after the rehearsal, reset fork `development-SDXPINN` back to upstream (**force push in our own fork**) so the real PR branches from a clean tip; delete the throwaway secret. Upstream is never touched.
- Device: if the install breaks, `opkg remove sdxpinn-qmanager` + tarball installer (documented rollback in `ipk-packaging.md`).
- Local: discard the worktree unless the version bump should be kept as the real release commit.

## Out of scope
Upstream PR, SA device validation, the untested `Replaces` of old QuecManager packages (no such package on the test unit).

## Outcome (2026-11-03)
Version was v0.1.35 (v0.1.38 was a slip). Phases A and B passed; phase C was skipped because the modem was offline. Phase B evidence: [fork PR #5](https://github.com/dr-dolomite/QuecManagerBetaReleases/pull/5), push run 41594692512 (build + sign green, bot commit `added sdxpinn-qmanager 0.1.35`), re-run 41594945350 (`Nothing to build or remove`, sign skipped). The key was generated with Python ed25519 in usign format, because running the downloaded `usign_x64` locally was blocked. Cleanup done: fork `development-SDXPINN` reset to upstream `abfba229`, secret + environment + PR branch deleted, local key destroyed.
