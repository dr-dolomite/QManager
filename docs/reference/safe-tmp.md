# Root-safe `/tmp` handling (`safe_tmp.sh`)

Ledger B4.1. Every QManager CGI and daemon runs as root, and most of them use
fixed names in `/tmp`. This note is the contract for writing such code.

## Threat and device facts

`/tmp` is world-writable and sticky. On the RM551E `fs.protected_symlinks=1`
(root does not follow another user's symlink placed directly in `/tmp`), but
`fs.protected_regular=0` and `fs.protected_fifos=0`: a regular file or FIFO
another user planted at a fixed name is opened by root's `>` and stays owned,
and rewritable, by the planter. Nothing protects the entries of a directory
another user created first, so `mkdir -p /tmp/x` followed by a write inside it
is fully steerable. QManager's own users are all root, so the real exposure is
local privilege escalation from a non-root vendor daemon. Treat it as defence
in depth, not a remote hole.

Since B5.10 QManager ships `/etc/sysctl.d/90-qmanager-hardening.conf`
(`fs.protected_regular=2`, `fs.protected_fifos=2`; applied at boot by
`/etc/init.d/sysctl` and live by `install.sh`; `uninstall.sh` removes it and
resets both to 0). With it, root's `>` into a file or FIFO another user planted
in a sticky dir fails with `EACCES` instead of writing through, so a plain `>`
to a planted name becomes a failed write (a DoS of that write, not an
escalation). The rules below still apply: they keep features working when a
name is planted and cover reads, sourcing and pid kills, which the sysctl does
not. Recon before enabling (2026-10-18): the only non-root entries directly in
`/tmp` were vendor `radio` items rewritten by `radio` itself (`/tmp/ipv4config1`
from QCMAP), so no vendor daemon depends on writing into another user's file.

## The helper

`/usr/lib/qmanager/safe_tmp.sh` (source with `[ -f LIB ] && . LIB`; a bare
`.` of a missing file aborts the whole script under BusyBox):

| Function | Use |
|---|---|
| `qm_trusted_file PATH` | Regular, root-owned, not a symlink. Gate every `.`, exec, extract or payload read of a `/tmp` path on it. |
| `qm_owned_by_root PATH` | Exists, not a symlink, uid 0 (files or dirs). |
| `qm_root_dir DIR [MODE]` | Makes DIR a real root-owned dir (default 0700), removing anything else at that name first. Returns 1 if it cannot; never use DIR then. |
| `qm_run_dir` | Ensures and prints `/var/run/qmanager` (root 0700). Prints nothing on failure, so guard `"$(qm_run_dir)/x"` against `/x`. |
| `qm_atomic_write DEST [MODE]` | stdin to DEST via a `mktemp` sibling and `mv -f` (default 0644). Replaces a planted file, FIFO or symlink instead of writing through it. |
| `qm_durable_write DEST [MODE]` | `qm_atomic_write` for files on flash (`/etc`, `/usr`, `/www`): `sync` before and after the rename. Use it for every persistent file. |
| `qm_self_pid` | Sets `QM_SELF_PID` to the calling shell's real pid. Use it inside a `( ... )` subshell, where ash's `$$` is still the parent's pid. Call it directly, never as `$(qm_self_pid)` (the command substitution forks). |
| `qm_read_pid PIDFILE [CMDLINE_SUBSTR]` | The pid when the file is root-owned, the pid numeric, > 1, alive and (optionally) its cmdline contains the substring. Use it before any `kill` of a pid read from `/tmp`. |

## Persistent files (UBIFS)

`/etc` is UBIFS and `/` is an overlay whose upper layer (`/usrdata`) is UBIFS
too; dirty data waits up to 30 s (`dirty_expire_centisecs=3000`). An in-place
`>` (or a `cp` over a file) cut by a power loss or an AP hang leaves the file
0 bytes (the 2026-10-19 deploy incident). Temp + `mv` alone is not enough
either: UBIFS can commit the rename before the temp's data. So:

- Rewrite a persistent file with `qm_durable_write` (temp, `sync`, `mv`,
  `sync`). BusyBox 1.36 `sync` takes no file argument, so it is a global flush:
  use it on user-initiated or rare writes, never in a poll loop.
- Build the content into a variable first when its producer can fail (`jq`):
  a pipeline's status is the writer's, so a failed `jq | qm_durable_write`
  durably writes an empty file. Check the variable is non-empty.
- Replace binaries the same way (`qm_durable_write /usr/bin/x 0755 < src`). A
  rename works while the old binary runs, where `cp` fails with `ETXTBSY`.
  Verify a new binary before it replaces the old one.
- Every planned reboot path calls `record_planned_reboot`, which ends with a
  `sync`; the deferred `( sleep N; sync; reboot )` subshells and watchcat tier 4
  sync again. Keep that when adding a reboot path.
- Append-only logs (`crash.log`, sites `.jsonl`) stay `>>`: a crash loses at
  most the last line, never the file. `known_iccids` appends lock-free by
  design and is not converted either.

## Rules

- Downloads, extraction and work trees that root later installs or executes
  live under `/var/run/qmanager/<feature>` (OTA `update/`, DPI
  `dpi_download`, language packs `lp_download` / `lp_staging`, Tailscale
  `tailscale_dl`, speedtest `speedtest/run.sh`), or a `mktemp -d` dir
  (installer bootstrap, `run_atd_qcmd`).
- Payload files a CGI hands to a worker (config restore, language install) are
  written with `qm_atomic_write ... 0600`; the worker refuses one that is not
  `qm_trusted_file`.
- Caches root sources (`/tmp/qmanager_supported_bands.env`) are written
  atomically and sourced only when trusted; otherwise they are re-queried.
- Flags and state a daemon acts on (watchcat revert flag, SIM failover file)
  are written atomically; the daemon drops an untrusted one.
- `/tmp/qmanager_sessions` is created by `qm_create_session` (root 0700), not
  by the installer; `qm_validate_session` rejects a session whose dir or file
  is not root-owned. Login returns `session_failed` when the dir cannot be made
  trustworthy.
- Singleton pidfiles a feature trusts for "already running" or `kill` live in
  `/var/run/qmanager` (B5.11/B5.13): `dpi_verify.pid`, `dpi_install.pid`,
  `netbird_install.pid`, `tailscale_install.pid`, `msmtp_install.pid`,
  `mtu_reapply.pid`, `sms_forward.pid` (plus the forwarder's `sms_forward_seen`).
  Write with `qm_atomic_write`, read with `qm_read_pid PIDFILE <cmdline>`. A
  background `( ... ) &` worker records `qm_self_pid`, or the spawner records
  `$!`; never `echo $$` from the subshell (that is the caller, so a later
  `kill` would hit the calling daemon).
- Machine-API state lives in `/var/run/qmanager` (Prometheus metrics, see
  [`../features/prometheus-metrics.md`](../features/prometheus-metrics.md)):
  `metrics_scrape` (`"<mode> <uptime_s>"`, written by the scrape CGI, read by
  the poller) and `api_authfail_<scope>.stamp` (uptime seconds of the last
  logged auth failure, one line, from `api_auth.sh`). Both are written with a
  `$$`-suffixed temp and `mv -f` instead of `qm_atomic_write`, which saves the
  `mktemp` fork on a request path. **That shortcut is acceptable only inside
  the root-only run dir**, where nobody else can plant the final name or a
  predictable temp. Do not copy it into `/tmp`. Readers parse defensively
  (digits only, no leading zero, at most 10 digits, uptime not in the future)
  and the stamp is read on the uptime clock.
- The live-signal channel is the one place a **web-root symlink points at a
  broker-written directory**: `/www/qmlive` -> `/var/run/qmanager/live`
  (root `0755`, inside the `0700` run dir; the broker verifies it with
  `ensure_own_dir` before every publish). It must never point into `/tmp`: a
  link into the world-writable dir would let a local user plant the target and
  have `uhttpd` (root) serve it. The directory always holds an empty
  `index.html` because `uhttpd` directory listing is on and the capability URL
  would otherwise be listed. The lease stamps, token and lock sit in the run
  dir beside it and use the same `$$` temp + `mv -f` shortcut as the scrape
  files above. See [`../features/live-signal.md`](../features/live-signal.md).
- Fail closed: when the helper is missing, a feature refuses to download,
  execute, source or kill, rather than falling back to the old fixed path.
- Not moved: lock files and their FD numbers (a flock target only needs to
  exist) and result/progress JSON the UI only reads. The SMS forwarder's
  failures list stays at `/tmp/qmanager_sms_forward_failures.json` for the CGI,
  written atomically and shown only when root-owned.

`uninstall.sh` removes `/var/run/qmanager`; `/var/run` is tmpfs, so a reboot
clears it too.
