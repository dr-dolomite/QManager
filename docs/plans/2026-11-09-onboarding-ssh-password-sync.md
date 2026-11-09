# Onboarding password also becomes the SSH (root) password

Status: PLAN, awaiting approval. Nothing is changed yet.

## What happened

After a reflash and a fresh v0.1.35 install, the onboarding password was accepted for the web UI but SSH rejects it. Even the `mcp__modem__` bridge (credentials in `.env`) fails with "All configured authentication methods failed". The root password on the device is whatever the reflashed firmware ships with, not what was typed at onboarding.

## Root cause (traced in code)

The belief "onboarding password = web + SSH password" is true only in the **RM520N fork**, never in this repo:

| Piece | RM520N fork | This repo (RM551E) |
|---|---|---|
| Installer seeds a known root password | `install_rm520n.sh` sets `qmanager` | nothing (`scripts/install.sh` never touches `/etc/shadow`) |
| Onboarding syncs root | `auth/login.sh` calls `qm_set_ssh_password` (sudo helper `qmanager_set_ssh_password`) | **absent**. `auth/login.sh` first-time branch only calls `qm_save_password` (web hash in `AUTH_CONFIG`) |
| Web password change syncs root | yes | no, by design: two tabs, each with its own current password (`docs/plans/2026-10-20-device-access-password-tabs.md`) |

`docs/reference/auth-rate-limiting.md:113` records it: "`qm_set_ssh_password` were not ported". The only code path that ever writes the root password here is `system/ssh_password.sh` (Settings > Passwords > SSH tab), which needs the *current* root password first, so it cannot rescue a device whose root password you no longer know.

So there is no QManager "default password" on the RM551E. The root password after a reflash is the firmware's stock one. I could not read it from the repo and cannot probe the device (login fails), so I will not guess. Ways to learn or reset it: the sdxpinn / toolkit release notes for the image you flashed, or the recovery route below.

The RM520N `qmanager` default is also a known weakness (`docs/security/2026-10-23-security-review-findings.md`, finding 4), so the fix must NOT reintroduce a hardcoded default.

## Recovery for the device right now (needs you, not code)

Pick one:
1. Stock root password of the flashed image (check the release notes for the sdxpinn build you flashed).
2. If ADB over USB is available, `adb shell` then `passwd root` (route unverified on this firmware).
3. Reflash again.

Once in, set root to your onboarding password (Settings > Passwords > SSH tab, or `passwd root`). Then update `.env` `SSH_PASSWORD` so the bridge works again.

## Fix

### 1. Backend: sync root at onboarding (the actual bug)

- `scripts/usr/lib/qmanager/cgi_auth.sh`: add `qm_set_ssh_password <pw>`. uhttpd CGIs already run as root (`ssh_password.sh` relies on that), so no sudo helper: `printf '%s\n%s\n' "$1" "$1" | passwd root`, return its status. Guard empty input. Add a fail-closed stub next to the existing one in `cgi_base.sh:56`.
- `scripts/www/cgi-bin/quecmanager/auth/login.sh`, first-time branch: after `qm_save_password` succeeds, call `qm_set_ssh_password`. Order and failure rule:
  - Web save first (as today). If the SSH sync fails, onboarding still completes (never lock the user out of the web UI over SSH), `qlog_warn`, and the success body gains `"ssh_synced": false`. On success `"ssh_synced": true`.
  - Reason for not failing hard: web access is the recovery path; the Passwords > SSH tab can fix SSH later. This is the trade-off the user should confirm (alternative: block onboarding until both succeed).
- `ssh_password.sh` already uses `passwd root`; no change. Optionally switch it to the new helper later (not in this patch).

### 2. Frontend: say it, and surface a failed sync

- `components/onboarding/steps/step-password.tsx`: one sentence under the field: this password also signs you in over SSH. Copy in all five catalogs (en, zh-CN, zh-TW, it, id). No `/etc/` or `passwd` wording.
- `hooks/use-auth.ts` (setup call): read `ssh_synced`; if `false`, show the existing Banner/toast pattern once ("Web password set. SSH password could not be set; change it in Settings > Passwords."), `t()` in all five catalogs, deterministic toast id.
- Run `bunx tsc --noEmit` and lint on touched files.

### 3. Lifecycle lockstep

- `install.sh` / ipk preinst: unchanged on purpose (no default password, no seeding). Confirm `uninstall.sh` and `--deconfigure` do not restore or reset root's password (they should leave it alone).
- `qmanager_reset_password` (web password reset helper): decide whether it should also reset root. Proposal: no, it only clears the web hash, so the next onboarding re-seeds both. Confirm in step 1 testing that re-onboarding after reset re-syncs root.

### 4. Docs

- `docs/reference/auth-rate-limiting.md:113`: replace "not ported" with the new behaviour (`ssh_synced`).
- `docs/reference/system-settings.md` Passwords section: note onboarding seeds both, the two tabs diverge afterwards.
- `RELEASE_NOTE.md` Improvements: "The password you choose at setup now also signs you in over SSH."

## Validation

- Static: CRLF (`.claude/check-crlf.sh`), BusyBox/POSIX, no multi-var `local`, jq null-handling, CGI envelope unchanged apart from the extra field.
- On device (blocked until access is recovered): wipe the auth file (`qmanager_reset_password`), run onboarding with a password containing a quote, `$` and a space, then `ssh root@modem` with it; confirm `ssh_synced:true`; force a failure (e.g. temporarily unwritable shadow on a throwaway test) to confirm onboarding still completes with `ssh_synced:false`; confirm Settings > Passwords > SSH tab still verifies the same password.
- Rollback: revert the commit; no schema or lifecycle state to undo.

## Open decisions for you

1. Soft fail (onboarding completes, warns) vs hard fail (block onboarding if root cannot be set). Recommended: soft.
2. Should a later web-password change also change root? Recommended: no, keep the two tabs independent as designed.
3. Order of work: do you want recovery of the current device first, then I validate on-device?
