# qmanager_atd: planted-FIFO / foreign-file hardening (plan, awaiting OK)

## Verdict on the report

**Confirmed in this repo, and it is live here.** The report says the crate "isn't built or installed here". That is true of the RM520N port it came from, but on QManager the broker is the shipped `qmanager_atd` 0.6.1. Commit `98b3da73` (D15/T2.1) is not in this repository or any of its worktrees. It belongs to the other run.

Code facts (verified by reading the code):

| Site | Problem |
|---|---|
| `safefs.rs:14-23` `open_nofollow` | `O_WRONLY\|O_CREAT\|O_TRUNC\|O_NOFOLLOW`, no `O_NONBLOCK`, no fstat. Only a symlink (ELOOP) is handled. |
| `exec.rs:218`, `exec.rs:176` | `write_nofollow(PID_FILE)` runs on **every** AT command and SMS session, on the single AT-lane worker, **while holding the modem flock**. A FIFO at the path freezes all AT/SMS. Only the client's 340 s timeout recovers, by restarting the broker. Capped callers (the poller) never trigger that restart. The restarted broker blocks again because nothing removes a PID_FILE FIFO at its start. |
| `exec.rs:221` | Same for LONG_FLAG, on long commands only. |
| `exec.rs:51-53` `long_running()` | `Path::exists()` (follows links, any type). Anything planted makes every short command answer `scan_in_progress` until the broker restarts. This needs no blocking at all. |
| `lock.rs:28-36` `LockFile::open` | No type/owner check, mode 0644. A foreign file there either stops the daemon from starting (with the sysctl) or lets the attacker hold the flock (without it). |
| `log.rs:126` | Already has `O_NONBLOCK` + `is_file`, which is the reference pattern (with `live.rs:129-145` `read_small`: `is_file` + uid check). |

**Nothing reads PID_FILE.** No script or crate code reads it. It is a leftover from the shell qcmd, and only `init.d/qmanager:93` removes it.

**Exploitability today: low.**
- Exploiting this needs a non-root local process. uhttpd CGIs and every daemon run as root.
- `scripts/etc/sysctl.d/90-qmanager-hardening.conf` sets `fs.protected_fifos=2` / `protected_regular=2`. With those, root's `O_CREAT` open of a FIFO or file another user planted fails with EACCES instead of blocking. The error is silently ignored.
- The sysctl does not cover:
  - a root-owned planted entry,
  - the boot window before `/etc/init.d/sysctl` runs,
  - a failed live apply,
  - after uninstall (`uninstall.sh:432` resets both to 0),
  - kernels older than 4.19.

  The code must not rely on the sysctl alone. Stock RM551E ships `protected_fifos=0` (`safe_tmp.sh:4-6`).
- Not verified on the device: the modem SSH handshake timed out during this check. These three facts still need confirming:
  - sysctl values,
  - process uids,
  - whether `/var` is a symlink to `/tmp`.

**On the report's "www-data must be allowed":** that applies only to the RM520N port. Here the cell scanner does not create the flag (`qmanager_cell_scanner:54` just calls `qcmd`). The broker writes it, and qcmd's in-process fallback runs as a root CGI. So the owner rule here is **owner == euid (root)**, with no www-data exception.

## Patch set (one crate bump, 0.6.1 → 0.6.2)

1. **Drop PID_FILE.** Remove the writes and removes at `exec.rs:176,179,218,225,247`, and the constant. This removes the per-command open on the hot path entirely, so nothing needs to move into a root-only directory. Keep `rm -f /var/lock/qmanager.pid` in `init.d/qmanager`, and add it to `install.sh` upgrade cleanup and `uninstall.sh` (lifecycle lockstep), so a stale or planted entry is cleared.
2. **Harden `safefs::open_nofollow` / `write_nofollow`** (covers LONG_FLAG and any future caller):
   - open with `O_NONBLOCK` added, then fstat;
   - accept only `S_ISREG && uid == euid && nlink == 1`;
   - otherwise close, `unlink` (never follows, root can unlink in sticky dirs), and recreate with `O_CREAT|O_EXCL|O_NOFOLLOW|O_NONBLOCK`, as the symlink path does today;
   - `O_EXCL` makes a racing re-plant fail instead of being trusted;
   - truncate only after the check, so drop `O_TRUNC` from the open and `ftruncate` after verifying. This also closes the hardlink-truncation case.
   This heals the planted entry rather than refusing, so a planted entry cannot keep the broker down. Clear `O_NONBLOCK` is not needed for regular files.
3. **`long_running()`:** `symlink_metadata`, then true only for a regular file owned by root. Shared helper so `qcmd.rs:64`, `qsms.rs:23`, `transport.rs:61` and `live.rs:389` agree.
4. **`clear_stale_long_flag`:** also remove a LONG_FLAG that is not a root-owned regular file, regardless of age, at start.
5. **`LockFile::open`:**
   - `O_NONBLOCK` plus a fstat check for regular file and euid owner;
   - if the check fails, unlink and recreate with `O_EXCL`;
   - mode `0600`, so a non-root user cannot open it read-only and `flock` it.
   - Check BusyBox `flock` in `qmanager_health_check:610-631` still works as root (it does: root ignores mode).
6. **`log.rs`:** add `uid == euid` to the existing `is_file` check. `rotate` should use `symlink_metadata`. This is a small change done in the same pass.
7. **Shell readers (phase 2, same branch, separate commits):**
   - `cell_scan_start.sh:79-80` and `neighbour_scan_start.sh:78-79` gate the `cat "$LONG_FLAG"` on `qm_trusted_file`;
   - the watchdog (`qmanager_watchcat:91`, `wd_state.sh:157`, `wd_tiers.sh:99`) and the poller (`qmanager_poller:47,2760`) switch `[ -f "$LONG_FLAG" ]` to `qm_trusted_file`, so a planted file cannot put them in maintenance or scan tier.
8. **Docs:**
   - comment in safefs.rs naming the sysctl as defence in depth, not the fix;
   - `docs/features/at-broker.md` invariants (no PID file; state-file rule);
   - `docs/reference/safe-tmp.md`.

## Team / build order

- **Worktree** off `development-home`.
- **Rust:** Opus medium, sensitive AT path. Steps 1-6, bottom-up: safefs → lock → exec → log. Add tests using the template `log.rs:199-223`, `a_planted_fifo_never_blocks_the_logger`:
  - FIFO at target (thread + `recv_timeout`, no block, ends up a regular file);
  - foreign-owner file (skipped unless running as root);
  - hardlink not truncated;
  - `long_running()` false for FIFO, dir, symlink.
  Then run `cargo test --release` in WSL and `cargo build` for aarch64-musl.
- **Shell (step 7):** Sonnet high backend-writer, in parallel, disjoint files.
- **validator:**
  - CRLF/BusyBox audit of the shell edits.
  - Then on device:
    - deploy the binary (scp, md5, `sync`);
    - run the AT smoke (`qcmd ATI`, a cell scan, SMS list);
    - confirm `/var/lock/qmanager.pid` is no longer created.
  - FIFO test on device only with your OK: `mkfifo` as root at LONG_FLAG and the old lock path, confirm there is no hang and the entry is healed, then clean up.
- **docs-writer:** step 8 plus a `RELEASE_NOTE.md` Improvements line.

## Risks / rollback

- Getting the lock-file mode or owner check wrong would stop the broker from starting. That would break every AT path, so the device smoke is mandatory, and the old binary stays in `/tmp` for a quick swap back.
- Dropping PID_FILE: a third-party script might read it. Nothing in this repo does, and this risk is accepted.
- Rollback: revert the branch and redeploy the 0.6.1 binary.

## Open before build

- The modem was unreachable during this check. Re-read the sysctl values, process uids and `/var` layout once it is back up. This changes the severity only, not the plan.
