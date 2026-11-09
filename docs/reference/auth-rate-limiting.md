# Auth Rate Limiting: the progressive lockout ladder

`auth/login.sh` throttles password guessing with a progressive lockout ladder. The first five wrong passwords are free, the sixth locks the form for 30 seconds, and every single failure after that escalates one rung (120s, 300s, 900s) until a correct password or an hour of quiet resets it. It is short where humans mistype and long where scripts live. Ported from the RM520N fork in ledger row U3.3 (`738d6759`); the source doc is `rm520n/development:docs/reference/auth-rate-limiting.md`.

The limiter is a small JSON file in `/tmp` guarded by a lock file, read and written by shell functions in `cgi_auth.sh`, and surfaced to the UI by two CGI endpoints. The one rule that is easy to break: **`auth/check.sh` may only ever read the limiter state**.

> ℹ️ NOTE: **On-device validation of the ladder is pending** (the modem's SSH was unreachable when U3.3 shipped). The static audit passed and the UI was exercised against a stub CGI server. The probes to run are listed in `docs/rm520n-port-ledger.md` > Findings.

## Quick Reference

| Item | Value |
|---|---|
| Library | `scripts/usr/lib/qmanager/cgi_auth.sh` (stub for `qm_get_rate_limit_status` in `cgi_base.sh`) |
| State file | `/tmp/qmanager_auth_attempts.json` (tmpfs, clears on reboot) |
| Lock file | `/tmp/qmanager_auth_attempts.lock` |
| Login endpoint | `POST /cgi-bin/quecmanager/auth/login.sh` |
| Status endpoint | `GET /cgi-bin/quecmanager/auth/check.sh` (public, `_SKIP_AUTH=1`) |
| Frontend | `hooks/use-auth.ts` (`useLogin()` returns `lockout`), `components/auth/login-component.tsx` |
| Free attempts | `MAX_ATTEMPTS=5` |
| Ladder | `LOCKOUT_STEPS="30 120 300 900"` (seconds; the last entry is the cap) |
| Pre-ladder window | `LOCKOUT_WINDOW=300` (seconds the level-0 attempt counter lives) |
| Level decay | `LEVEL_DECAY=3600` (seconds of quiet before the level resets to 0) |
| Cleared by | successful login, `qmanager_reset_password`, reboot, `uninstall.sh` |
| i18n keys (`common`) | `login.locked_title`, `login.locked_body`, `login.locked_countdown`, `login.lockout_seconds`, `login.invalid_password`, `login.attempts_left_one/_other` |

> ℹ️ NOTE: **flock** is a kernel advisory lock on a file descriptor. **tmpfs** is a RAM-backed filesystem (`/tmp`), so its contents vanish on reboot. **429** is the HTTP status for "too many requests".

## The ladder

| Event | Level after | Locked for | `attempts_remaining` reported |
|---|---|---|---|
| Failures 1 to 5 | 0 | none (form usable) | 4, 3, 2, 1, 0 |
| 6th request (the gate trips) | 1 | 30s | 0 |
| Next single failure | 2 | 120s | 0 |
| Next single failure | 3 | 300s | 0 |
| Next single failure | 4 (cap) | 900s | 0 |
| Every further failure | 4 | 900s | 0 |
| Successful login | 0 | none | state file deleted, 5 on the next read |
| One hour with no failure | 0 | none | recomputed from `count` |

Two behaviours are deliberate and easy to misread:

- **The lock is applied before the password is checked.** `login.sh` calls `qm_check_rate_limit` ahead of `qm_verify_password`, so a locked caller gets a 429 without the hash being computed, and a correct password submitted during a lockout is still refused. **Why:** the gate must not become a password oracle.
- **Once the ladder is engaged, one failure escalates.** `count` only gates the first level-0 to level-1 transition; after that the `level` field alone drives the timing. A human who mistypes once, waits 30 seconds and gets it right is never punished further.

The decay is computed on read from `last_failure`, not by a timer, so nothing is scheduled. **Why:** without it one bad afternoon would pin the device at the 15-minute rung.

## State file

`/tmp/qmanager_auth_attempts.json`:

```json
{ "count": 3, "first_attempt": 1753000000, "locked_until": 0, "level": 1, "last_failure": 1753000000 }
```

| Field | Meaning |
|---|---|
| `count` | Failed attempts inside the current pre-ladder window |
| `first_attempt` | Epoch of the attempt that opened the window (`LOCKOUT_WINDOW` measures from here) |
| `locked_until` | Epoch the lockout lifts; `0` means not locked |
| `level` | Ladder rung 0 to 4, clamped to the number of `LOCKOUT_STEPS` entries |
| `last_failure` | Epoch of the most recent failure; drives `LEVEL_DECAY` |

Reads use jq defaults (`.level // 0`, `.last_failure // 0`), so an older flat file with only the first three fields loads at level 0. Writes go to `${ATTEMPTS_FILE}.tmp` then `mv`, so a reader never sees a half-written object.

**Every stored field is passed through `_qm_rl_int`** (prints the value if it is a non-negative integer, else `0`) before any `$(( ))`. **Why:** a non-integer in shell arithmetic is a fatal ash error that would abort the login CGI mid-flow, and `/tmp` is writable by anything on the box.

## Functions in `cgi_auth.sh`

| Function | Mutates | Purpose |
|---|---|---|
| `qm_get_rate_limit_status` | Never | Read-only probe. Sets `RATE_LIMIT_RETRY_AFTER` and `RATE_LIMIT_ATTEMPTS_REMAINING`. Returns 0 = not locked, 1 = locked |
| `qm_check_rate_limit` | Yes | Login gate. Same read, plus the level-0 to level-1 engage and the expired-window reset |
| `qm_record_failed_attempt` | Yes | Called after a failed `qm_verify_password`. Bumps `count`; if the ladder is engaged, escalates a rung and re-locks |
| `qm_clear_attempts` | Yes | Called on successful login. Deletes the state file |
| `qm_attempts_flock_wait <fd> <timeout>` | n/a | Bounded lock acquisition |

`cgi_base.sh` carries a **fail-closed** stub for `qm_get_rate_limit_status`, so a script that sources the base without the auth library still resolves the symbol and cannot read "unlocked" by accident.

The session helpers on the same request path (every authenticated CGI, and `check.sh`) are builtin-only so a request costs two forks (`stat`, `date`) before its own work:

- `qm_cookie_value <name>` sets `QM_COOKIE` with no subshell; `qm_get_cookie` is a printing wrapper kept for `logout.sh` / `password.sh`. Same first-match rules as the awk parser it replaced: pairs split on `;`, blanks after each `;` dropped, exact name, value up to the next `=`.
- `_is_valid_token` is a `case` plus a length check (64 lowercase hex).
- `qm_validate_session` reads the body with `read` (one bare epoch line; a second line, blanks or non-digits are rejected and the file removed), checks both the directory and the file are non-symlinks owned by uid 0 with a single `stat`, and exports the epoch it read as `QM_AUTH_NOW` for the calling CGI (the UI heartbeat reuses it).

### Invariants a future edit will break

**1. `check.sh` calls only `qm_get_rate_limit_status`, never `qm_check_rate_limit`.** `check.sh` is public and fetched on every load of `/` and `/login/`. A mutating call would let a visitor engage or extend their own lockout by pressing F5. Verify by hand: snapshot the state file (`md5sum`), call `check.sh`, confirm it is unchanged.

**2. Mutations run in a subshell, so their variables do not survive.** Every write is wrapped as `( qm_attempts_flock_wait 9 3; ... ) 9>>"$ATTEMPTS_LOCK"`. The block holds the lock for its duration but discards anything the inner helpers assign. Callers re-read the state after the block before reporting (`qm_check_rate_limit` does this to compute `RATE_LIMIT_RETRY_AFTER`). A "just read the variable the helper set" shortcut runs and silently reports zeros.

### Locking on BusyBox

`flock` has no `-w` / `--timeout`. `qm_attempts_flock_wait` polls `flock -x -n` every `sleep 0.1` for up to 3 seconds, matching `qcmd`'s lock polling (a 1-second grain cost seconds of latency elsewhere). If the lock is still held after the budget, the write **proceeds unlocked**. **Why:** losing one counted attempt to a race is better than a login endpoint that hangs or returns 500, and concurrent logins on a single-admin device are rare.

The target differs from the RM520N source here: uhttpd runs CGI as root, so the lock file is created by the CGI with no `chmod 666` and no ownership concern, and the source's 1-second polling is tightened to 0.1s.

## Response shapes

### `POST auth/login.sh`

| Case | HTTP | Body |
|---|---|---|
| Locked out | 429 | `{"success":false,"error":"rate_limited","detail":"Too many failed attempts","retry_after":118,"attempts_remaining":0}` |
| Wrong password | 200 | `{"success":false,"error":"invalid_password","detail":"Invalid password","attempts_remaining":2}` |
| Correct password | 200 | `{"success":true}` (sets `qm_session` and `qm_logged_in`) |
| First-time setup | 200 | unchanged: `setup_required`, `password_weak`, `password_mismatch` or `{"success":true}` |

`attempts_remaining` on the wrong-password branch comes from `qm_get_rate_limit_status` called after `qm_record_failed_attempt`, so it reflects the failure that just happened.

`auth/password.sh` (the web-password change, including its `verify_only` mode) runs the same gate: `qm_check_rate_limit` first (a locked caller gets the same `429 rate_limited` body), `qm_record_failed_attempt` on a wrong current password, `qm_clear_attempts` once it is right. The counter is shared with sign-in, so wrong guesses typed into the Passwords card count toward locking the owner out of `/login`, and a correct one never clears a lock that has already engaged. `system/ssh_password.sh` is not part of the ladder.

The target keeps its own password rules for first-time setup: `enforce_strong` from the request, a 5-character minimum plus upper, lower and digit when strong is on, and the `password_weak` error. The source's `password_too_short` code was not ported. First-time setup also makes the new password the SSH (root) password through `qm_set_ssh_password` (`cgi_auth.sh`: `passwd root` over stdin, CGIs run as root, no sudo helper and no seeded default password, unlike the RM520N fork). It is a soft fail: the web password is saved first, a failed `passwd` logs a warning and the success body carries `"ssh_synced":false` (otherwise `true`), and onboarding toasts a pointer to Settings > Passwords. Later web-password changes do not touch root; the two tabs stay independent.

### `GET auth/check.sh`

| State | Body |
|---|---|
| Setup required | `{"authenticated":false,"setup_required":true}` |
| Signed in | `{"authenticated":true}` |
| Signed out | `{"authenticated":false,"rate_limited":true,"retry_after":24,"attempts_remaining":0}` (`rate_limited:false`, `retry_after:0` and a live `attempts_remaining` when not locked) |

The signed-out fields are what let a page reload during a lockout restore the countdown instead of re-enabling the submit button.

> ⚠️ WARNING: An anonymous caller can now learn that the device is rate-limited and for how long. That widening is deliberate (a login form that cannot say why it refuses you is worse on a single-admin LAN appliance). It reveals no credential material. Treat any further field on `check.sh`'s signed-out branch as a security change.

## Design decisions

- **The counter is global, not per-IP.** One attacker can lock out the owner. On a private-LAN appliance that is a nuisance, not a compromise: SSH still works and the lock clears in at most 15 minutes. Per-IP keying would need a keyed map with stale-entry pruning in shell.
- **State lives in `/tmp`, so a reboot clears the lockout.** Only an authenticated user can reboot through the UI, so this is not a web-side escalation; it is a bypass only for someone who can cut power. **Why:** persisting to flash would write on every failed attempt and turn the limiter into a wear-out vector. `qmanager_reset_password` also deletes the file, so a recovered password is never blocked by an old lock.

## Gotcha: `attempts_remaining: 0` on an unlocked form

After a lockout expires the form is usable again, but `attempts_remaining` still reports 0 because `count` stays at 5 or more until a success or the one-hour decay. It means "the next wrong password re-locks you immediately", not "you cannot try". The UI therefore never renders "0 attempts left": at 0 it shows the plain `login.invalid_password` ("Incorrect password."). `LoginResult.attempts_remaining` in `hooks/use-auth.ts` carries a comment saying so.

## Frontend contract

`hooks/use-auth.ts`:

```ts
type LoginError = "invalid_password" | "rate_limited" | "setup_required" | "network";

interface LoginResult {
  success: boolean;
  error?: LoginError;        // always the backend code, never English prose
  detail?: string;           // backend English, diagnostic fallback only
  retry_after?: number;      // present when error is "rate_limited"
  attempts_remaining?: number;
}

interface LockoutState { active: boolean; retryAfter: number; attemptsRemaining: number }
```

`useLogin()` returns `lockout`, seeded on mount from `check.sh` fetched with `cache: "no-store"` (a cached copy would show an enabled button during a lockout the server still enforces). `error` carries the code so the form can branch on `rate_limited` and translate every message. Before U3.3 it was overwritten with the English `detail`, which is why other locales showed English login errors; unknown codes go through `resolveErrorMessage` ([`error-codes.md`](../features/error-codes.md)).

The lockout label is built by `formatLockout()` in `login-component.tsx` (`28 s` under a minute, `4:32` above it), so the i18n template must not bake in a unit. The 900s rung forced that. Slot copy goes through `components/auth/interpolation-slot.tsx` (`withSlot`); wrap a slotted sentence in a single span, because inside an `inline-flex gap` container each text node becomes a flex item and the gap spaces it out.

## Verifying the ladder

No test harness. Exercise `login.sh` and `check.sh` on the device and check:

1. Failures 1 to 5 are allowed and `attempts_remaining` counts 4 down to 0.
2. The 6th request returns 429 with `retry_after` 30, before the password is checked.
3. Once on the ladder, each single failure escalates one rung.
4. The ladder caps at 900s.
5. A successful login deletes the state file.
6. An hour of quiet decays the level: set `level` and `last_failure` (now minus 3700) directly in the JSON instead of waiting.
7. An older flat file without `level` / `last_failure` still loads (429 at 30 on the 6th request).
8. `check.sh` leaves the state file byte-identical.

`qm_check_rate_limit` returns 1 as the normal "locked" signal, so do not treat that as an error when scripting. Clean up `/tmp/qmanager_auth_attempts.json` afterwards.

## Related

- [`docs/BACKEND.md`](../BACKEND.md) (`cgi_auth.sh`, `auth/` endpoints) and [`docs/API-REFERENCE.md`](../API-REFERENCE.md) (exact request and response shapes)
- [`docs/FRONTEND.md`](../FRONTEND.md) (login page files, pre-auth scale)
- `DESIGN.md` > Typography > The pre-auth card exception; [`icon-system.md`](icon-system.md) for glyphs on `/` and `/login/`
