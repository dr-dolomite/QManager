# RM551E Verification of the 2026-10-23 Security Review

**Date:** 2026-10-25
**Checks:** [2026-10-23-security-review-findings.md](2026-10-23-security-review-findings.md) (reported against `QManager-RM520N`)
**Target:** QManager RM551E edition (`development-home` @ `cbcf35a1`), OpenWRT/BusyBox build: uhttpd, fw4/nftables, procd
**Method:** static code review of this repo, plus a review of iamromulan's `sdxpinn-patch` source (`quectel-rgmii-toolkit`, branch `development-SDXPINN`). One read-only network probe of the test RM551E ran before the review was scoped to code only. Its results appear below, marked **[live]**. The probe changed no settings and made no login attempts. Nothing was probed from outside the carrier network.

## Summary

The review was written against a different stack (lighttpd, systemd, sudo, Entware, a Discord bot), so several of its files and mechanisms don't exist here. The RM551E edition holds up well against the review:

- **Not reproduced (or not applicable):** #1, #2, #5, #7, #8.
- **Mostly fixed, with gaps left:** #3, #4, #6.
- **Reproduced as reported:** #9.

The code review also turned up one new issue that is worth fixing: a **truncated or empty `cgi_auth.sh` still fails open** (see #3).

| # | Claim | RM551E verdict | Covered by |
|---|---|---|---|
| 1 | Unauthenticated root shell via `/console` | **Not reproduced** | No console proxy in QManager. Toolkit ttyd is LAN-only and needs a login [live] |
| 2 | SSH open over public IPv6 | **Not reproduced** [live] | fw4 drops/rejects WAN input on v4 and v6. sdxpinn-patch disabled the `wan_all` Allow rules |
| 3 | CGI auth fails open when the auth lib fails | **Mostly fixed, gap left** | `cgi_base.sh` fails closed when the file is *missing*, but not when it is *empty or truncated* |
| 4 | Known default SSH password, MD5-crypt | **Not reproduced in QManager**, related weaknesses | QManager never sets a root password. The web password hash is a fast hash. Toolkit firmware images ship a known root password |
| 5 | Discord bot authorization | **Not applicable** | No Discord bot in this repo |
| 6 | Updates install without checksum verification | **Mostly fixed, gap left** | Fail-closed SHA-256 plus a URL allow-list. No signature. The DPI download has no checksum |
| 7 | Over-privileged web layer (sudo, 777) | **Not applicable as stated** | No sudo, no `chmod 777`. But every CGI runs as root |
| 8 | Installer downloads over plain HTTP | **Not reproduced** | No Entware. Every URL is HTTPS. opkg uses OpenWRT's signed feeds |
| 9 | `curl -k` on public-IP lookups | **Reproduced** | `device/about.sh:54,56` |

## Findings

### 1. `/console` root shell: not reproduced

- **Code:** QManager ships no ttyd, no `/console` route and no reverse proxy. A grep for `ttyd` and `/console` in `scripts/` finds nothing. `websocat` appears only in retirement and cleanup code (`install.sh:796-834`).
- **Toolkit:** sdxpinn-patch installs stock `luci-app-ttyd` and replaces `/bin/login` with `shadow-login`.
- **[live]** On the test unit:
  - ttyd listens only on `192.168.224.1:7681`. That is a LAN-only bind: UCI sets `interface=@lan`.
  - It runs `/bin/login`, so you need the root password to get a shell.
  - There is no WAN exposure. Any LAN client can reach the login prompt, so protection rests on how strong the root password is (see #4).

### 2. SSH over public IPv6: not reproduced

- **Code:** QManager doesn't own the WAN firewall. That belongs to fw4. QManager's nft fragments are DPI mangle rules only, plus tailscale and netbird zones.
- **Toolkit:** sdxpinn-patch's only security change is `wan_all_firewall_patch`, commit `efc97e69`, titled "Security Patch: WAN access". Its commit message confirms that stock SDXPINN firmware was exposed over WAN on both IPv4 and IPv6. The patch disables every `@rule[N]` with `src='wan_all'`. It doesn't touch dropbear, uhttpd or the zone policies, and it runs only on install of sdxpinn-patch 3.x.
- **[live]** On the test unit (sdxpinn-patch 3.0 installed):
  - The fw4 `inet` input hook has policy `drop`, and `rmnet_data0` sends traffic to `reject_from_wan`. No rule accepts any port on WAN.
  - The `wan` zone covers both `wan` and `wan_v6`, with input REJECT. All the `wan_all` Allow-* rules are `enabled=0`.
  - dropbear, uhttpd :80 and uhttpd :443 bind to `0.0.0.0` and `[::]`. That is wider than the reporter saw on RM520N, where uhttpd bound IPv4 only. The firewall is the only thing protecting them.
- **Residual risk:**
  - **Single layer:** the services listen on every address, so one firewall regression would expose them.
  - **Older toolkit units:** units on sdxpinn-patch older than 3.x, or on stock firmware, don't get the `wan_all` fix. QManager doesn't check for it.
  - **Dormant zones:** the `swip` zone has input ACCEPT. It is harmless today because `mhi_swip0` doesn't exist.
  - **Not tested end to end:** nothing was probed from outside the carrier network.
- **Recommendation:** add a System Health Check item that flags any enabled `wan_all` or `wan` Allow rule, or a WAN zone input policy that isn't REJECT or DROP. Optionally bind dropbear to the LAN interface.

### 3. CGI auth fail-open: mostly fixed, one gap left

- **Fixed:** in `scripts/usr/lib/qmanager/cgi_base.sh:33-56`, a *missing* `cgi_auth.sh` now installs a `require_auth` that returns HTTP 500 and exits.
  - **[live]** 12 sampled protected endpoints returned `401` without a cookie.
  - Only `auth/{check,login,logout}.sh` and `public/{hostname,overview,units}.sh` set `_SKIP_AUTH=1`.
- **Gap (new):** the guard is `[ -f … ]`, which only checks that the file exists. If `cgi_auth.sh` exists but is empty or cut short, sourcing it succeeds without defining `require_auth`. Then:
  - Line 89 calls `require_auth`.
  - The shell prints `not found` and returns 127.
  - Nothing checks that return code, so the handler runs **without auth**.

  This isn't hypothetical: an unsynced deploy followed by a power loss has already zeroed core files on the test unit (2026-10-19).
- **Recommendation:** after sourcing, add `command -v require_auth >/dev/null 2>&1 || <the same 500 stub>`. Make the call itself fail closed too: `require_auth || exit 0`.

### 4. Default SSH password and weak hashing: not reproduced in QManager, related weaknesses

- **Default password:** `install.sh` and `qmanager-installer.sh` never set or change the root password. A grep finds no `passwd` or `chpasswd` in either.
- **SSH password changes:** `system/ssh_password.sh` needs a valid session *and* the current root password. It re-hashes that password with the algorithm already used in `/etc/shadow` (`$1$`, `$5$` or `$6$`, lines 91-94). It then sets the new password through `passwd root`, so the new hash uses the system default algorithm. That default wasn't checked on the device.
- **Weaknesses that remain:**
  - **Fast web password hash.** The web UI password is a single salted SHA-256, `sha256(salt‖password)` (`cgi_auth.sh:55-57`). It is stored in `/etc/qmanager/auth.json`, so anyone who gets a copy of that file could brute-force it cheaply offline. An iterated KDF would be better: for example, `openssl passwd -6`, or a PBKDF2 loop if the build supports it.
  - **Open first-time setup window.** Until a web password is set, `auth/login.sh:45-80` accepts the first `password`+`confirm` POST from any LAN client. The minimum length is 5 characters. This is expected for onboarding, but worth noting.
  - **Known root password on toolkit images (not QManager).** iamromulan's prebuilt firmware sets root to a documented static password (`fw_prep.sh:54`). The user-facing toolkit uses interactive `passwd` instead.
  - **[live] Password SSH for root.** dropbear has `PasswordAuth=on` and `RootPasswordAuth=on`, so password login for root over SSH is allowed.
  - **[live] Plain-HTTP admin UI.** uhttpd has `redirect_https=0`, so a client on :80 sends its login and session cookie in cleartext across the LAN. Cookies are `HttpOnly; SameSite=Strict`, which mitigates CSRF, but they carry no `Secure` flag.

### 5. Discord bot authorization: not applicable

There is no `discord-bot/` and no bot integration in this repo or in the toolkit.

### 6. Update integrity: mostly fixed, gaps left

- **Fixed:**
  - `scripts/usr/bin/qmanager_update:224-275` (`verify_sha256`) fails closed. It refuses to install on a missing checksum URL, a fetch failure, a missing `sha256sum`, a malformed hash or a mismatch.
  - URLs are pinned to `https://github.com/dr-dolomite/QManager/…` (`validate_url`, lines 188-201).
  - `qmanager_auto_update` hands off to the same updater.
  - `qmanager-installer.sh` runs `set -e` plus `sha256sum -c`, so a mismatch aborts before the archive is extracted.
- **Gaps:**
  - **No signature.** `sha256sum.txt` comes from the same GitHub release as the tarball, so a compromised account or release defeats the check. A detached signature would close this: minisign/signify, with the public key pinned in the installed tree.
  - **DPI download has no checksum.** `qmanager_dpi_install:80-133` downloads the *latest* `bol-van/zapret` release over HTTPS with no checksum, then installs the `nfqws` binary, which runs as root. This is the weakest download path. Pin a version and its SHA-256.
  - **Language packs.** These are checked against a SHA-256 in a manifest from the same channel. That is acceptable, since a pack contains data, not code.
  - **Tailscale.** `tailscale_mgr.sh` is already the reference pattern: `--proto =https` plus a sha256 check.

### 7. Over-privileged web components: not applicable as stated

- **Not applicable:** there is no sudo on this build, and a grep finds no `chmod 777`/`666`/`o+w` in `scripts/`. Runtime directories go through `safe_tmp.sh` (`qm_root_dir`, `qm_atomic_write`).
- **The underlying point still applies, in a stronger form:** uhttpd runs every CGI as root, so any injection bug in a CGI handler is root code execution. Authenticated users also get arbitrary AT commands (`at_cmd/send_command.sh`), by design.
- **Recommendation:** keep the "every CGI is root" model in mind during code review. In particular, look at the `eval` in `device/about.sh:80`, which reads jq output from local files.

### 8. Installer downloads over plain HTTP: not reproduced

- There is no Entware bootstrap.
- A grep finds no plain `http://` download URLs in `scripts/` or `qmanager-installer.sh`. The only `http://` addresses are LAN ones in comments.
- Release downloads use the GitHub HTTPS API and releases. `opkg` installs come from OpenWRT's signed feeds.
- sdxpinn-patch adds its own feed over HTTPS and imports that feed's signing key with `opkg-key`.

### 9. `curl -k` on public-IP lookups: reproduced

- `scripts/www/cgi-bin/quecmanager/device/about.sh:54` and `:56` call `curl -sLk` against `https://api.ipify.org` and `https://api6.ipify.org`, which skips TLS certificate checks.
- It is the only `-k` or `--insecure` in the tree.
- **Fix:** drop the `k`. The installer already requires `curl` and `ca-bundle`, so certificate checks will work.
- Also list these two outbound lookups in `docs/features/` or the About page docs.

## Recommended fixes (priority order)

1. **P1: close the #3 gap.** **Done 2026-10-25.** `cgi_base.sh` now installs the fail-closed stubs whenever `require_auth` is undefined after sourcing (`type require_auth`). That covers a missing, empty or truncated library. A harness run under `bash --posix` returned 500 for missing, empty and truncated files, and the old code ran the handler on an empty file. Not yet verified on the device under BusyBox ash.
2. **P1: drop `-k` in `device/about.sh` (#9).** **Done 2026-10-25.** If no CA bundle is present, the lookup fails and the public IP is left blank.
3. **P1: pin the zapret version and its SHA-256 in `qmanager_dpi_install` (#6).** **Done 2026-10-25.** Pinned to v72.13, sha256 `b2a9f454…f4c2e6`. The GitHub asset digest and a local re-hash agree. Downloads are HTTPS-only, and the archive is verified before extraction. Not yet run on the device.
4. **P2: add a Health Check item for the WAN firewall posture (#2).** It would catch units without sdxpinn-patch 3.x.
5. **P2: replace the web password hash with an iterated KDF, with migration on next login (#4).**
6. **P2: optional hardening.** Bind dropbear to LAN, default to an HTTPS redirect, and add the `Secure` cookie flag when served over HTTPS (#2, #4).
7. **P3: sign releases (#6).**

## Not verified

- **External WAN reachability:** not tested. That needs a host outside the carrier network and the owner's approval.
- **New SSH password hashes:** the algorithm `passwd root` writes on this firmware wasn't read.
- **sdxpinn-patch binary:** the ipk wasn't compared byte for byte with its source tree.
- **Other `sdxpinn-*` packages on the unit:** `console-menu`, `firstboot` and `mount-fix` weren't inspected.
