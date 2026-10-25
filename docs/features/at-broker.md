# AT Broker (`qmanager_atd`) and Host AT Ports

Every AT command QManager sends reaches the modem through `/usr/bin/qcmd`,
which is a symlink to the persistent Rust AT broker `qmanager_atd`. It is the
only AT path: the original shell gatekeeper and its `atcli_smd11` helper were
removed on 2026-10-16. A separate, unrelated-in-speed toggle turns the vendor
host AT bridge on or off.

Since broker 0.3.0 the same binary also serves **read-only QMI over QRTR** to
`/usr/bin/qmi`, on a lane of its own that never touches the modem lock. The
QMI side (allow-list, field coverage, sidecars, SSR behaviour) is in
[`qmi-lane.md`](qmi-lane.md); this doc covers the process model both lanes
share. Broker 0.4.0 adds the live signal sampler (1 Hz since 0.4.1) (`live=1`, a static file for
the UI, see [`live-signal.md`](live-signal.md)); it is not an AT path and adds
no wire verb. Broker 0.5.0 holds the NAS signal config (`0x006C`) so the live file carries SINR and NR; still no wire change, no new verb and no new capability line. Broker 0.6.0 runs two broker-internal WDS clients and publishes the modem's packet counter as `qmi_wds_*` in the QMI sidecars for Data Used ([`qmi-lane.md`](qmi-lane.md#wds-packet-statistics-broker-060), [`data-used.md`](data-used.md)); again no wire change, no verb and no capability line.

**UI:** System Settings: Host AT Ports card (On / Off) on **Hardware** (`/system-settings/hardware`).
**Source:** `native/qmanager_atd/` (Rust crate). The prebuilt binary is
`dependencies/qmanager_atd`. The build recipe is in `dependencies/README.md`.

## Contents

- [Components](#components)
- [The output contract is frozen](#the-output-contract-is-frozen)
- [Lanes and threads](#lanes-and-threads)
- [How an exchange works](#how-an-exchange-works)
- [Client wait cap (`qcmd -t` and `QCMD_WAIT_MS`)](#client-wait-cap-qcmd--t-and-qcmd_wait_ms), [`--version`, the daemon-mode rule and the capability file](#version-the-daemon-mode-rule-and-the-capability-file-proto-2)
- [The QMI verb](#the-qmi-verb-qmi-proto-3)
- [Invariants (and why they exist)](#invariants-and-why-they-exist)
- [Source layout and tests](#source-layout-and-tests)
- [Host AT ports (`quecmanager.ports.host_at`)](#host-at-ports-quecmanagerportshost_at)
- [Lifecycle](#lifecycle)
- [Validated on the RM551E](#validated-on-the-rm551e-2026-10-16)
- [Rollback](#rollback)

## Components

| Piece | Path | Role |
|---|---|---|
| Rust multicall binary | `/usr/bin/qmanager_atd` | Run as `qmanager_atd` (or `--daemon`): it is the broker. Invoked through the `qcmd` name: it is the client. |
| `qcmd` | `/usr/bin/qcmd` | A **symlink** to `qmanager_atd`, always. `install.sh` creates it and `/etc/init.d/qmanager_atd` re-asserts it at every broker start (`at_qcmd_link`). |
| `qsms`, `qmi` | `/usr/bin/qsms`, `/usr/bin/qmi` | Symlinks to `qmanager_atd` (argv0 picks the client; both are always clients, whatever their arguments). `at_qsms_link` / `at_qmi_link`, same atomic repoint as `qcmd`. |
| Broker socket | `/var/run/qmanager_atd.sock` | `0600` root. One request per connection. |
| Capability file | `/var/run/qmanager_atd.proto` | `0644`, `proto=3`, `version=0.6.0`, `qmi=1` and `live=1` lines (that order). Written by the running daemon after it binds; removed by `init.d/qmanager_atd` stop and by `uninstall.sh`. See [below](#version-the-daemon-mode-rule-and-the-capability-file-proto-2). |
| Link and port library | `/usr/lib/qmanager/at_engine.sh` | `at_qcmd_link` (idempotent atomic repoint of `qcmd`), `at_broker_available`, `at_broker_running`, and the `host_at_*` port-bridge functions. The filename is historical. |
| QMI sidecars | `/var/run/qmanager/qmi.env`, `/tmp/qmanager_qmi.json` | Published by the daemon's QMI sampler (the poller sources `qmi.env`). See [`qmi-lane.md`](qmi-lane.md#snapshot-sidecars-and-the-live-lease). |
| Live signal | `/var/run/qmanager/live/`, `/www/qmlive`, `qmi_live_{aim,watch}`, `qmi_live.token`, `qmi_live.lock` | Published while a lease is fresh; `at_live_link` re-asserts the link at every start. See [`live-signal.md`](live-signal.md). |
| Boot service | `/etc/init.d/qmanager_atd` | procd, `START=98` (before the poller at 99), `STOP=11`. |
| CGI | `system/host_at_ports.sh` | GET and POST. See `docs/API-REFERENCE.md`. |
| Hook and types | `use-host-at-ports.ts`, `types/at-engine.ts` (host-AT-port types only) | Pessimistic: state is taken from the POST read-back, never flipped locally. |

## The output contract is frozen

The broker reproduces the original shell `qcmd` exactly, because about 50
callers parse its output. The on-device parity suite ([`tools/atd-parity/`](../../tools/atd-parity/README.md), 50 cases) checks it, and so do the
crate's unit tests:

- **Raw mode:** atcli's bytes with all trailing `\n` stripped, then one `\n`
  added. This mirrors the legacy `result=$(…)` capture followed by `echo`.
  The output keeps the echoed command, the CRLFs and the final `OK`.
  - Callers strip `^AT`, `^OK$` and blank lines themselves (`qmanager_poller` `qcmd_exec`).
- **`-j` mode:** byte-identical to the legacy `jq -n` layout,
  `{success, response, command}` or `{success:false, error, command}`.
- **Exit codes and error strings:**
  - rc 0 means a reply arrived.
  - **AT `ERROR` is rc 0** with `ERROR` in stdout, not a failure.
  - rc 1 with `ERROR: <code>` on stderr (raw mode) means one of: `modem_busy`,
    `modem_not_ready`, `scan_in_progress`, `command_timeout`, `command_failed`,
    `invalid_command`. A new code keeps rc 1, because callers such as
    `at_cmd/reconnect_modem.sh` test `-eq 1`; callers that need the reason read
    the stderr code (`qmanager_poller` `qcmd_exec`, `qmanager_health_check`,
    `qmanager_neighbour_scanner`, `cellular/sms.sh`).
  - The broker's mapping: lock budget spent (including time queued in the
    broker) is `modem_busy`; the channel lost or reset under a command (EOF,
    `ECONNRESET`, `ENETRESET`, `EBUSY`, `EPIPE`, … — `channel::is_reset`, what an
    SSR produces) or a failed resync is `modem_not_ready`; no terminator before
    the deadline is `command_timeout`; anything else is `command_failed`.
  - A closed stdout never crashes the client: write errors are ignored like
    the shell's `echo`, and the exit code still reports the AT result.
  - No argument: the legacy `no_command` JSON on stderr, rc 1.
  - A bad `-t` value: `{"error":"bad_cap",...}` on stderr, rc 1 (see the wait cap below).
- **Only AT commands are sent** (2026-10-19). `classify::is_at_command`: an
  `AT` prefix in any case and no control characters (bytes below 0x20, or
  0x7F). Anything else answers `invalid_command` at once and never takes the
  modem lock. The client checks before the long-flag gate and the socket, and
  `Executor::run_after` checks again (the socket is the trust boundary, and the
  in-process fallback runs the same path). `A/` (repeat last) is not accepted:
  nothing uses it. qcmd knows only `-j`, so an unknown flag such as `--bogus`
  used to go to the modem as text. The modem never answers a line that does
  not start with AT, so each such call held the lock for the full 20 s
  `SHORT_DEADLINE`, and every other caller failed `modem_busy` (seen live: three
  `qcmd --bogus` calls made the poller log a false `signal_lost`). An embedded
  CR or LF is refused for the same reason: the channel appends CR LF, so it
  would put a second, unanswered line on the wire. `qsms` has its own argument
  parser and fixed commands, so it is unaffected.
- **Long-command behaviour:**
  - Commands classed long (QSCAN, QSCANFREQ, QFOTADL, COPS=0, COPS=2, plus
    `/etc/qmanager/long_commands.list`) set `/tmp/qmanager_long_running` and
    run an `AT` warm-up first.
  - While that flag exists, short commands fast-reject with `scan_in_progress`.
  - The classification matches the original shell `qcmd` exactly (case-sensitive substring).

## Lanes and threads

Until 0.2.0 the daemon was a single-threaded loop, and its kernel accept
backlog was the queue. Since 0.3.0 it is **one process with independent lanes**
(the AT behaviour below is unchanged; only its hosting moved):

```
acceptor (main thread)
  └─ reader thread (pool of 16, 128 KiB stacks, 2 s read timeout)
       uid check, size cap, exact length, route by verb
       ├─ REQ / SMS ─► AT lane: bounded FIFO (64) ─► ONE worker ─► Executor ─► flock ─► Channel(/dev/smd11)
       └─ QMI ───────► answered on the reader thread from the QMI registry (no lock, no queue)
```

- **Acceptor.** Takes a free reader slot *before* `accept()`. With all 16
  readers busy it stops accepting and the kernel backlog holds callers, as it
  did before. If a reader thread cannot be started the request is read inline.
- **Reader.** Authenticates (`SO_PEERCRED`, uid 0), reads to EOF within 2 s,
  applies the per-verb size cap (AT 8 KB, SMS 64 KB, QMI 1 KB), validates the
  framing, then routes. A bad request is refused and logged on the reader
  (`refused request: ...`, answered `command_failed`), never queued.
- **AT lane** (`daemon/at_lane.rs`). A reader pushes a job (`stream`, request,
  `sent_ms`) with `try_send`: it never blocks, so a slow modem cannot hold a
  reader. **One worker thread** pops jobs in arrival order and runs exactly what
  the single-threaded broker ran. A full queue (64) answers `modem_busy`
  at once (`qcmd` gets `ERR modem_busy`; `qsms` gets the same `RES` envelope its
  own lock budget produces) and logs `AT queue full`. If the worker ever stops,
  the process exits so procd restarts it (otherwise the broker would accept
  forever and answer nobody).
- **QMI lane** (`daemon/qmi_lane.rs`). Built on a background thread
  (`qmi-start`) after the AT lane is up, because the registry's name-server
  lookup is bounded at 500 ms and AT serving must never wait on it. Until it
  arrives a valid `QMI` request answers `modem_not_ready`. If the lane never
  started, or 4 QMI requests are already in flight, a valid `QMI` request
  answers `ERR command_failed` and the client reads in-process, so AT keeps at
  least 12 of the 16 readers. Each QMI request has a 2.0 s overall deadline.
  Details in [`qmi-lane.md`](qmi-lane.md#daemon-limits-cap-deadline-circuit).
- **Logger** is thread-safe: one `Mutex` around write and rotate. The log file
  is opened `O_NOFOLLOW` and `O_NONBLOCK`, and a line is dropped unless the
  open object is a regular file, so a planted FIFO can never block an AT caller.

**Why the AT invariants survive the move.** The queue is the old backlog
in-process: still FIFO, still one request on the modem at a time.

| Frozen AT behaviour | How the lane keeps it |
|---|---|
| The client's long-flag watch ("seeing the flag while waiting means still queued") | Only the single worker runs requests, so a queued short command never is the one running. A second AT worker would break this. |
| Time queued is charged to the lock budget | The worker computes `waited = now - sent_ms` at dequeue, where `sent_ms` is the client's send time, so time in the lane queue counts. |
| A caller that hung up is dropped | `peer_gone` is checked at dequeue, so a killed or capped caller's request never runs (`caller gone before its turn, not run`). |
| A frozen broker is restarted by its clients | Unchanged (340 s reply timeout, see below). With lanes, a stuck AT worker leaves the acceptor, readers and QMI lane running: QMI keeps answering while AT callers queue and then get `modem_busy`. QMI clients never trigger the restart. |

Order is arrival at the queue. Readers finish in parallel, so a peer that is
slow to write goes after a fast one instead of holding it up for up to 2 s;
each request's budget comes from its own `sent_ms`, so nobody is charged for
another's delay.

## How an exchange works

Both the daemon and the in-process fallback run the same `exec::Executor`, so
there is a single behaviour, not two:

1. **Long-flag gate** (short commands only). The *client* checks it before
   it connects, so a short command answers `scan_in_progress` at once instead
   of queueing behind a scan in the AT lane. The executor
   checks it again when the request is served.
   - A short command that was **already queued** when a scan started keeps
     watching the flag while it waits (250 ms slices). Only a long command
     raises the flag and the AT lane runs one request at a time, so seeing it
     while waiting means "still queued, behind a scan": the client answers
     `scan_in_progress` and drops the socket, and the broker skips the request
     (`peer_gone`), so it never runs. Once reply bytes start arriving the
     client takes the reply instead. Long commands do not watch.
2. **`flock` on `/var/lock/qmanager.lock`.** This uses the same 100 ms grain
   and the same 5 s (short) / 10 s (long) budgets as the original shell `qcmd`. It is also why
   any other opener that takes this lock (the retired `sms_tool` did) can
   still work beside the broker.
   - The AT lane serves one request at a time, so waiting in its queue
     *is* waiting for the modem. Each request carries its send time
     (`CLOCK_MONOTONIC`), and the queue time is taken off the lock budget: a
     caller never waits longer in total than the original shell `qcmd` did, and a
     request already past its budget answers `modem_busy` without running.
   - A request whose caller has gone (killed by a CGI timeout or a `timeout`
     wrapper while queued, seen as `POLLHUP`) is dropped, not run, like a
     shell `qcmd` killed while waiting for the lock.
3. **Zero-wait drain** of anything stale in the channel, such as a late reply
   or a URC. Drained bytes are logged, never returned.
4. **Write** the command plus `\r\n`.
5. **Read until a terminator line, with a real deadline.**
   - The terminators are atcli's: `OK`, `ERROR`, `+CME ERROR:`, `+CMS ERROR:`,
     `BUSY`, `NO ANSWER`, `NO CARRIER`, `NO DIALTONE`.
   - Deadlines are 20 s for short commands and 300 s for long ones.
   - A *slow* class (COPS=?, CFUN=, QMBNCFG, CGATT=, QPRTPARA) gets 60 s but
     never sets the long flag.

**After a timeout,** the channel is marked dirty. Before its next use the
broker proves the channel is back in step (`AT` → `OK`), reopens it if
necessary, and otherwise returns `modem_not_ready`. A late reply can therefore
never leak into the next caller's output, which the original shell `qcmd` could not
guarantee.

**After an I/O error or EOF** on the channel, the fd is closed and the
channel marked dirty, so the next exchange reopens `/dev/smd11` and proves it
with `AT` → `OK` first. The daemon holds one fd for its whole life; keeping a
fd that errored would make recovery depend on glink healing that fd (on the
RM551E it did after one `ENETRESET`, but nothing guarantees it), and procd
never restarts a daemon that has not exited.

**The client** first tries the socket. It falls back to the same exchange
in-process **only when the request never reached the broker** (no socket,
`ECONNREFUSED`, or a failed write — a short body is refused, see below). Once
the request is delivered, a lost reply (broker died, 340 s reply timeout,
malformed reply) is reported as `command_failed` / `command_timeout`, never
re-run: the broker may already have executed it, and running `COPS=2` or a
`QCFG` write twice is worse than one honest error. AT therefore never depends
on the daemon being up, and a command never runs twice.

**A frozen broker is restarted by its clients.** 340 s
(`CLIENT_REPLY_TIMEOUT`) is longer than any exchange can take in the broker
(300 s long deadline + 10 s lock budget + warm-up + worst-case resync, and the
queue budget rejects anything queued behind it at once). So a client that hits
it knows the broker is alive but stuck, which procd never fixes because the
process has not exited. The client logs it, runs
`/etc/init.d/qmanager_atd restart` detached (`setsid`, so a CGI timeout
killing the caller can't abort the restart), and still answers
`command_timeout` without re-running. `/var/run/qmanager_atd.restart`,
created `O_EXCL`, allows one restart per 120 s however many clients time out
together; an older marker is replaced.

**Wire format** (`src/common/proto.rs`): `REQ <nbytes> <sent_ms>\n<command>`, reply
`OK <nbytes>\n<raw>` or `ERR <code>\n`. The broker reads the request to EOF
within 2 s and refuses (`command_failed`, logged `refused request`) anything
that times out, exceeds 8 KB, or whose body is not exactly `nbytes`, so a
truncated command never reaches the modem. Client and daemon are one binary
and `install.sh` stops the daemon before replacing it, so the format has no
cross-version compatibility path; an old client against a new daemon is
refused, not executed. `SMS` and `QMI` are further verbs with the same
framing rules (below).

## Client wait cap (`qcmd -t` and `QCMD_WAIT_MS`)

Since broker 0.2.0 (B5.29 Phase B) a read-only caller can limit how long `qcmd` waits for a short command, so one stuck exchange ahead in the queue cannot freeze the caller. The poller is the user: it caps its per-cycle reads at 2500 ms (see [`adaptive-polling.md`](adaptive-polling.md), Invariant 8).

- **Two ways to ask.** `qcmd -t MS "AT..."` for one call, or the environment variable `QCMD_WAIT_MS=MS` for that call. `-t` wins when both are given. `-t` must come **before** the command (a later `-t` is an ordinary extra argument, ignored as before). `-j` and `-t` can appear in either order before the command.
- **Valid range.** 50 to 60000 ms, plain decimal digits only (at most 6 characters). A bad `-t` value prints `{"error":"bad_cap","detail":"Usage: qcmd [-j] [-t MS] \"AT+COMMAND\" (MS 50-60000)"}` on stderr and exits 1, before anything is sent. A bad `QCMD_WAIT_MS` value is **ignored** (no cap), not an error.
- **What happens on expiry.** The wait is counted from when the client started. When it runs out the client drops the socket and answers `ERROR: modem_busy` (rc 1). The broker skips the request if it is still queued (`peer_gone`), or discards the reply if it is already running. A capped timeout is **not** read as a frozen broker, so it never triggers the restart described above; an uncapped wait that reaches 340 s still does.
- **Long commands are never capped.** A command classed long (scans, `COPS=0/2`, `QFOTADL`, the custom list) ignores both `-t` and the variable: giving up would only throw away a reply the broker spends minutes producing.
- **In-process fallback.** If the request never reached the broker, the fallback runs with the cap minus the time already spent.
- **Cap only reads.** The cap applies to whatever command the caller passes, including a write. A write that is abandoned mid-run still executes in the broker. Callers cap read queries only; boot one-shots and writes keep the full wait.

**Why the poller uses the environment variable and not `-t`:** an older `qcmd` binary (a rollback, or the upgrade window) ignores an unknown variable, but would forward `-t 2500` to the modem as an AT command (before the non-AT refusal existed it also held the lock for 20 s). The environment variable is set per call and never exported.

## `--version`, the daemon-mode rule and the capability file (proto 2)

- **`--version`.** `qmanager_atd --version` and `qcmd --version` (any invoked name) print `qmanager_atd 0.6.0 proto=3` and exit 0. (`qmi --version` prints the same line.) This only exists in 0.2.0 or later: an older `qcmd` would send `--version` to the modem as a command, and an older `qmanager_atd` would start a second daemon (below). Scripts must not probe with it; they read the capability file.
- **Daemon-mode rule.** Under a name containing `atd` (`qmanager_atd`), the daemon starts only with **no argument** or `-d` / `--daemon`. Any other argument prints a usage line on stderr and exits 2. **Why:** older binaries treated any invocation under an "atd" name as a request to start a daemon. A second daemon unlinked the live broker's socket and left it serving nobody while every client fell back to in-process. This happened for real on 2026-10-19 when `qmanager_atd --version` was run on a v0.1.32 binary. Under the `qcmd` name only an explicit `--daemon` starts the daemon, and `qsms` is always a client.
- **Refuse to start if a broker is listening.** `run_daemon` connects to the socket first; if something answers, it logs `another broker is listening` and exits 1 without touching the socket. A stale socket file (nothing listening) is still replaced.
- **Capability file `/var/run/qmanager_atd.proto`.** After the socket is bound, the daemon writes `proto=3`, `version=0.6.0`, `qmi=1` and `live=1`, one per line in that order (mode 0644), to a `.new` temp file (`O_EXCL` plus `O_NOFOLLOW`, a leftover or planted temp is unlinked first) and renames it into place. It describes the **running daemon**, not the binary on disk. `/etc/init.d/qmanager_atd` `stop_service` and `uninstall.sh` remove it (and the `.new` temp), so a rolled-back binary that never writes it is not credited with a protocol it does not speak. Scripts read it with a builtin `read`; they never run the binary to ask.
- **Protocol numbers.** 1 = `REQ` / `SMS` framing (v0.1.32, no capability file). 2 = the client wait cap and `--version` (client-side only, no wire change). 3 = the `QMI` verb and the `qmi=1` capability line (0.3.0). Number 3 was once reserved for a `POLL` verb; that is parked (Phase D wiring was not built, decided 2026-10-19), so a future `POLL` would be **4**. A new capability is a new `name=value` line after the first two, never a reorder (`live=1`, 0.4.0, is one: the wire is unchanged, still proto 3; the lease CGI gates on it so a rolled-back 0.3.0 answers `available:false`). 0.5.0 adds no line: its signal config state is in the QMI JSON sidecar (`qmi_sig_config`), not in this file. Because the poller passes its cap through the environment variable, no current script depends on the capability file. The `qmi` client does: it uses the broker only when the file says `proto>=3` **and** `qmi=1` (`broker_serves_qmi`), else it runs in-process.

## SMS in the broker (`qsms`)

Since 2026-10-16 the broker also speaks SMS natively, so only the broker
opens `/dev/smd11`. **Every SMS caller uses `qsms`** (phase 3):
`cellular/sms.sh`, `qmanager_sms_forward`, `sms_alerts.sh`,
`sms_forwarding.sh`, `qmanager_sms_storage` (`qsms status ME`, then
`qcmd 'AT+CPMS="ME","ME","ME"'`) and `qmanager_health_check` (`bin.qsms` link
check). `install.sh` links `/usr/bin/qsms` with `at_qsms_link`. `sms_tool` is
retired (phase 4): not bundled, and the installer deletes it. Caller contracts are
in [`sms.md`](sms.md), [`sms-forwarding.md`](sms-forwarding.md) and
[`alerts.md`](alerts.md).

- **Callers never take the modem lock around `qsms`.** The broker takes
  `/var/lock/qmanager.lock` itself; a caller already holding it would make the
  broker wait until `modem_busy`. Callers also no longer re-assert
  `AT+CPMS="ME","ME","ME"` (qsms restores it after every op) or filter
  `tcgetattr` noise.
- **Live check after the migration (2026-10-16):** the inbox GET is
  byte-identical before and after (sorted JSON hash, 64 merged messages,
  105/290 used); only `qmanager_atd` held `/dev/smd11` during three GETs; the
  forwarder's seen-set from old and new code is identical (64/64), so nothing
  re-forwards. No live send or delete was run.

- **Client:** `/usr/bin/qsms` → `qmanager_atd` (argv[0] `qsms` is always a
  client, whatever its arguments, since message text may be `-d`). Commands:
  `qsms list [ME|SM|all]` (default ME), `qsms status [ME|SM|all]` (default
  all), `qsms send <number> <text>`, `qsms delete <ME|SM> <idx,...|all>`.
  stdout is one JSON line; rc 0 on success, 1 on failure. Same transport as
  `qcmd`: socket first, in-process only if the request never reached the
  broker, never run twice, frozen-broker restart at 340 s.
- **Wire format:** `SMS <nbytes> <sent_ms>\n` + the arguments joined by NUL
  (argv can't contain NUL, so any text round-trips). Cap 64 KB (AT requests
  keep 8 KB). Reply `RES <0|1> <nbytes>\n<json>` or `ERR <code>\n`. The broker
  re-validates the arguments (`sms::parse_args`).
- **One lock hold per operation** (`exec::Session`): the same long-flag gate,
  5 s lock budget and queue-time accounting as a short AT command, and a 270 s
  session cap (under the client's 340 s reply timeout). Every exchange keeps
  the channel invariants above.
- **CPMS is always restored.** `list`, `status` and `delete` select storage
  with `AT+CPMS="<mem>"` and always finish with `AT+CPMS="ME","ME","ME"`, even
  after a failure (a failed restore adds `"warning":"cpms_restore_failed"`).
- **Send:** `AT+CMGF=0`, then per part `AT+CMGS=<n>`, wait for the `> `
  prompt (bytes, not a line, 10 s), write the hex + Ctrl-Z, read to the final
  code (60 s per part), so the `OK` after `+CMGS:` is consumed. No prompt:
  ESC cancels and the channel is resynced. Stops at the first failed part.
- **Codec** (`src/sms/pdu.rs`, 23.040/23.038): DELIVER only (stored SUBMITs and
  status reports from `AT+CMGL=4` are skipped and counted); sender never gets
  a `+` (consumers fingerprint on bare digits); timestamp `MM/DD/YY HH:MM:SS`
  sender-local, timezone ignored, exactly as `sms_tool`; GSM7 with the full
  extension table (€), UCS2 with surrogate pairs, 8-bit as hex; concat IE
  00 and 08 (full 16-bit reference). Submit picks GSM7 when every character
  fits (extension = 2 septets), else UCS2; 160/70 single, 153/67 per part,
  never splitting an ESC or surrogate pair, at most 255 parts, TOA 0x91 for
  `+` or ≥6 digits. The legacy encoder's extra-octet, `+` and `?` bugs are not
  reproduced.
- **JSON:** `list` → `{"success":true,"msg":[{"index","storage","stat",
  "sender","timestamp",["reference","part","total",]"encoding","content"}],
  "skipped":N[,"storage_errors":{"SM":"+CMS ERROR: …"}]}` (an unusable SIM
  store doesn't hide ME with `all`). `status` → `{"success":true,"storage",
  "used","total"}` or `{"storages":[…]}`. `send` → `{"success":true,"parts",
  "refs":[…]}`. `delete` → `{"deleted":[…],"failed":[…]}` or, for `all`,
  `{"deleted":N,"remaining":0}` (via `AT+CMGD=<first>,4` with a per-index
  fallback, indexes from `AT+CMGD=?`; covers indexes past 49, which
  `sms_tool delete all` missed). Errors: `{"success":false,"error":<code>,
  "detail"?}` with `modem_busy`, `modem_not_ready`, `scan_in_progress`,
  `command_timeout`, `command_failed`, `send_failed` (detail = `+CMS ERROR: n`),
  `delete_failed`, `bad_number`, `message_too_long`, `bad_args`.
- **Privacy:** SMS replies, numbers and bodies are never logged; the log
  gets one line per operation (`SMS list ME+SM: ok in 222ms`).

**Parity on the RM551E (2026-10-16):** 105 live messages (97 ME, 8 SM):
sender, timestamp, part, total and content equal `sms_tool recv -j` for
105/105; reference differs on 4, all 16-bit references whose low byte is what
`sms_tool` reported. `status` equals `sms_tool status` for ME and SM.
`AT+CPMS?` reads ME,ME,ME after every op (since 2026-10-18 the restore target is
the user's storage choice, `/etc/qmanager/sms_storage`, ME by default; see
[`sms.md`](sms.md)). `qsms list all` takes about 0.24 s
against 0.29 s for the two `sms_tool` reads. In-process fallback output is
byte-identical. The 57 `qcmd` parity outputs (9 commands raw and `-j` with rc,
no argument) are byte-identical to the previous broker. Send and delete are
covered by fake-modem tests only (86 crate tests).

## The QMI verb (`qmi`, proto 3)

- **Client:** `/usr/bin/qmi` → `qmanager_atd`. `qmi <read> [<read>...]` prints one JSON line; rc 0 ok, rc 1 failure. Reads, envelope, error words and the allow-list are in [`qmi-lane.md`](qmi-lane.md).
- **Wire format:** `QMI <nbytes> <sent_ms>\n` + the read names joined by NUL (cap 1 KB, same exact-length and uid rules). Reply `RES <0|1> <nbytes>\n<json>` (as SMS) or `ERR command_failed` for a refused frame. A bad read name is a normal `RES 1` answer (`bad_args`), not a refusal.
- **No lock, no queue.** The reader thread answers it itself, in about a millisecond, even while the AT lane holds a 20 s command or a scan runs. That independence is the reason the lane exists; a test pins it (`a_qmi_read_answers_in_milliseconds_while_an_at_job_holds_the_lane`).
- **Bounded on the reader pool.** At most 4 QMI requests run at once; over the cap the reader answers `ERR command_failed` immediately. A silent QMI service can hold a reader for at most about 2 s (the 2.0 s daemon deadline, plus the per-service circuit that fails requests at once after 2 timeouts). Limits and the circuit rules are in [`qmi-lane.md`](qmi-lane.md#daemon-limits-cap-deadline-circuit).
- **Transport order:** broker (only if the capability file allows it), else the same reads in the client process on its own registry. QMI is read-only and lock-free, so unlike AT a retry or a duplicate is harmless; the client falls back if the broker hangs up, answers `ERR`, or says nothing within 3 s. It never restarts a frozen broker.

## Invariants (and why they exist)

- **The smd11 fd stays blocking.** Verified on the device: glink_pkt rejects
  `O_NONBLOCK` at `open()` with `EBUSY`, and a *non-blocking write never
  succeeds* (`EBUSY` for the whole deadline), because it is the blocking write
  that asks the remote for an RX intent. Deadlines are enforced elsewhere:
  - Reads go through `poll()` first. This is what bounds the old 300 s
    `glink_pkt_read` stall (see the memory note on the atcli glink hang).
  - Writes and opens each run on a helper thread bounded at 5 s.
- **A wedged write abandons the fd without closing it.** Closing would free
  the fd number while the stuck thread could still finish its write into
  whatever file reused that number. The next exchange opens a fresh fd.
- **A fresh fd is never read before its first write.** glink resets the
  channel (`EBUSY`/`ECONNRESET`) otherwise. atcli always wrote first, and
  `Channel::established` enforces the same order.
- **The broker reads smd11 only inside a locked exchange.** It keeps the fd
  open between exchanges, which is safe because a second opener (`sms_tool`)
  still gets its own reply while this fd is idle (verified on the device).
  - **Openers outside QManager's control bypass the broker and its lock.**
    The firmware's Quectel `atcmd` (opkg `atcmd`, defaults to `/dev/smd11`)
    and iamromulan's `sdxpinn-console-menu` (`/usr/bin/menu`, whose
    `sub_menus/lan_menu` drives `atcmd`) open smd11 directly with no lock. They
    run only when someone starts them by hand over SSH, and a command sent
    while the broker is mid-exchange can interleave with it.
- **The socket is `0600` root and every peer is `SO_PEERCRED`-checked
  (uid 0).** `/dev/smd11` itself is `crw------- root`, and uhttpd runs CGIs
  as root, so no legitimate caller needs more. The umask is set *before*
  `bind`, so the socket is never briefly world-reachable.
- **State files never follow symlinks.**
  - `/tmp` and `/var/lock` are both `1777` on the device.
  - The long flag, PID file, lock file and log are therefore opened with
    `O_NOFOLLOW`. A planted symlink is unlinked and the file recreated with
    `O_EXCL`.
  - Paths are unchanged, so other scripts keep reading them.
- **A stale long flag is cleared at broker start.** A broker killed during a
  scan (`kill`, upgrade restart) leaves `/tmp/qmanager_long_running` behind, and
  every short command would answer `scan_in_progress` until the main service
  restarts. On start the broker removes the flag only if it is at least 15 s
  old **and** the modem lock is free. The in-process fallback client runs the
  same `Executor`, which writes the flag right after it takes the lock, so a
  live holder is normally caught by the lock check alone; the 15 s age floor
  is extra margin against clearing the flag of a caller that has only just
  started a long command.
- **Log lines match `qlog.sh`.**
  - Format: `[YYYY-MM-DD HH:MM:SS] LEVEL [component:pid] msg`, with the same
    256 KB / 2-file rotation.
  - Static musl only honours `$TZ`, so the broker loads OpenWrt's `/etc/TZ`
    itself; without that, its lines would be stamped UTC.
- **`/usr/bin/qcmd` and `/usr/bin/qsms` are never written through.**
  - `at_qcmd_link` / `at_qsms_link` share `_ate_link_to <link> <target>`: a
    temp symlink (`/usr/bin/.qcmd.<pid>`, `.qsms.<pid>`) plus `rename(2)`,
    never `ln -sf`, which would leave a moment with no link at all. Both are
    idempotent, so re-asserting them at every broker start is harmless.
  - `cleanup_legacy_scripts` skips `qmanager_atd` and `qcmd` explicitly; its
    glob never matches `qsms`.

- **The AT lane has exactly one worker, and readers never block on it.**
  - A second consumer would run two AT exchanges at once and break the
    client-side long-flag watch and the one-exchange-per-lock contract.
  - `submit` is `try_send`; a full queue answers `modem_busy` instead of
    holding a reader (which would eventually stop `accept`).
- **QMI never enters the AT queue and never takes `/var/lock/qmanager.lock`.**
  Routing a QMI read through the AT lane would put it behind a 20 s to 300 s
  exchange.
- **The sourced QMI sidecar lives in a root-only directory.**
  `/var/run/qmanager` is made `0700`, owned by the daemon's euid and verified
  (`safefs::ensure_own_dir`: a planted symlink, file or foreign directory is
  removed first) before every env write. **Why:** the poller will `source` this
  file in Phase 2; a path under world-writable `/tmp` could be planted before
  the first write. The JSON and the lease stay in `/tmp` (nothing sources them).

## Source layout and tests

`native/qmanager_atd/src/`:

| Dir | Contents |
|---|---|
| `main.rs` | Role dispatch only (argv0: `qmanager_atd` daemon, `qcmd`, `qsms`, `qmi`). |
| `common/` | `proto.rs` (wire format, capability file), `log.rs`, `lock.rs`, `safefs.rs` (no-follow writes, `write_atomic`, `ensure_own_dir`), `json.rs`. |
| `at/` | `channel.rs`, `exec.rs`, `classify.rs`, `output.rs`: the AT path. |
| `sms/` | `mod.rs`, `pdu.rs`. |
| `daemon/` | `mod.rs` (bind, acceptor, readers, router), `at_lane.rs`, `qmi_lane.rs`, `qmi_snapshot.rs`. |
| `client/` | `transport.rs` (socket-first, reply wait, frozen-broker restart), `qcmd.rs`, `qsms.rs`, `qmi.rs`. |
| `qmi/` | `transport.rs`, `registry.rs`, `allow.rs`, `model.rs`, `query.rs`, `msg.rs`, `error.rs`, `codec/{nas,dms,uim,wds,dsd}.rs`. |
| `poll/` | The parked B5.29 `POLL` parsers and env writer (`parse.rs`, `parse/ca.rs`, `envout.rs`). Compiled **only** with `--features poll` (off by default, so the shipped binary does not carry them). They are library code with host tests; no CLI entry point is wired to them. |

The crate is `libc`-only (no async runtime, no other crates). `cargo test --release`
runs **222** tests and `cargo test --release --features poll` runs **236**
(WSL, 2026-10-22, working tree with the QMI limit and hardening tests).

## Host AT ports (`quecmanager.ports.host_at`)

The vendor `/etc/init.d/port-bridged` (START=10) runs two `port-bridge`
instances:
- `at_mdm0 ↔ at_usb0`, the USB AT port;
- `smd7 ↔ at_usb2`, or `smd7 ↔ mhi_pipe_32` when `/dev/mhi_ctrl` exists
  (PCIe mode).

These are the AT ports a USB- or PCIe-attached **host** sees. QManager never
uses them; its path is `/dev/smd11`.

- **Off** (`host_at=0`) runs `port-bridged disable`, then `stop` (procd kills
  both instances and suppresses respawn), then `chmod 600 /dev/smd7`. The
  vendor `start` sets `smd7` to `777`, which leaves a world-writable direct
  path into the AT engine.
- **On** (the default, stock behaviour) runs `enable` and `start`. The vendor
  script restores its own permissions.
- **What it changes:** isolation only. An attached host can no longer issue
  AT commands. **It does not make QManager faster.**
- The UI keeps the consequence visible while Off is selected, with
  PCIe-aware wording.
- **Persistence:** `disable` removes the rc.d links. A firmware update can
  bring them back, so `qmanager_atd` re-applies the setting at boot.
- **Uninstall** restores the bridge (`enable` + `start`) only when QManager
  turned it off, and it does this *before* the `quecmanager` UCI namespace is
  deleted.

## Lifecycle

Every path goes through `install.sh`; the OTA updater runs it too.

**`install.sh`:**
1. `install_bundled_binaries` installs `qmanager_atd` only, and removes any
   leftover `qcmd.sh` / `atcli_smd11` / `sms_tool`.
2. `seed_uci_defaults` seeds `ports.host_at` (no `at.engine`). On upgrade it
   deletes the retired `quecmanager.at` section, so a device that had chosen
   Legacy moves to the broker. It then runs `at_qcmd_link`, `at_qsms_link`
   and `at_qmi_link`.
3. `start_services` starts `qmanager_atd` before the main service.
4. `stop_services` already stops and kills `qmanager_*`.
5. Firmware detection and the install smoke test run the client through
   `run_atd_qcmd`, a temporary symlink named `qcmd` pointing at
   `qmanager_atd`. Mode comes from argv[0]: never run `qmanager_atd` under
   its own name for a command. A 0.2.0 binary refuses any argument there
   (usage, exit 2), but a v0.1.32 binary run with any argument starts a
   **second daemon** that takes over the socket, and during an upgrade the
   old binary can still be the one on disk. Detection
   keeps the status-cache fallback (an old broker still running during an
   upgrade refuses the new client's request).

`/etc/init.d/qmanager_atd` `start_service` always re-asserts the `qcmd`,
`qsms` and `qmi` links (verified for `qsms`: a removed link comes back on
restart),
applies the host AT port setting, then starts the broker. It has no engine
check. It has no procd reload trigger on purpose: many CGIs commit
`quecmanager`.

**`uninstall.sh`** restores host AT ports if needed, then removes:
- the `qcmd`, `qsms` and `qmi` links (dangling-safe, via `-L`) and any
  `.qcmd.*` / `.qsms.*` / `.qmi.*` temp links;
- `qmanager_atd`, plus leftover `qcmd.sh` and `atcli_smd11` from old installs;
- the socket, the capability file (`/var/run/qmanager_atd.proto` and its `.new` temp), the forgotten `/var/run/qmanager_atd.restart` marker and the init script;
- the QMI sidecars: `/var/run/qmanager/qmi.env` (+ `.new`), `/tmp/qmanager_qmi.json` (+ `.new`) and the retired `/tmp/qmanager_qmi_live`; the live-signal files (the `/www/qmlive` link, `/var/run/qmanager/live`, any `/tmp/qmanager_live`, the `qmi_live_*` stamps, token and lock) and `qmi.stamp`. `init.d` removes the same files in `service_stopped`, which rc.common runs **after** procd has killed the broker; it waits up to about 5 s for the pid to exit first, because the live broker keeps rewriting the env and can recreate `live/index.html` until it is gone. A stopped broker therefore never leaves a sidecar that looks fresh by content.

**`build.sh`** requires and packages `dependencies/qmanager_atd`.
`.gitattributes` marks it `binary` so it never gets CRLF-converted.

## Validated on the RM551E (2026-10-16)

- **Output parity:** 18/18 against the then-shipping legacy `qcmd`, both in-process and through
  the daemon.
  - Static commands are byte-identical, including `AT+FOOBAR` → `ERROR` rc 0.
  - Live commands are framing-identical.
  - `-j` is byte-identical.
- **Latency:** about **10 ms per call against about 50 ms** for legacy (the
  `/proc/uptime` resolution floor).
- **`sms_tool`** works while the broker holds smd11.
- **Fallback:** works with the daemon down.
- **procd** respawns the broker after `kill -9`.
- **Load:** the poller, watchcat and CGIs ran through the broker with zero
  AT or lock errors.
- **Switches:** engine broker → legacy → broker (switch since removed) and
  host-AT off → on round-trip; invalid input is rejected.

**Error-handling hardening (2026-10-16, same day):** a review found six gaps,
all fixed and re-validated on the RM551E:

- Parity re-run 31/31 (12 static commands raw and `-j`, 6 live by shape, no
  argument), both through the daemon and in-process with the daemon stopped.
- Lock held 7 s with two callers queued: both answer `modem_busy` at about
  5 s (the second no longer waits 5 s + 5 s). A caller killed while queued is
  logged `caller gone before its turn, not run`.
- Long flag set: a short command answers `scan_in_progress` in 10 ms. A fresh
  flag survives a broker restart; a 60 s old one is cleared at start.
- A closed stdout pipe: rc 0, no abort. An old-format request is refused.
- Field evidence for the channel fix: at 14:46 the pre-fix broker hit a real
  `ENETRESET` on its long-lived fd and reported `command_failed`. It now
  reports `modem_not_ready` and reopens. The "fd never heals" case is covered
  by the crate's socketpair tests (30 total).

**Client wait fixes and live QSCAN (2026-10-16):** the queued-short-command
watch and the frozen-broker restart (34 crate tests). Parity 31/31 (daemon and
fallback) and every check above re-ran clean. Then one real `AT+QSCAN=3,1`
through the broker, behind a 3 s lock hold so a short call queued behind it:

- The queued short call answered `scan_in_progress` 2.6 s after it was sent,
  the moment the scan took the lock, and was then skipped by the broker
  (`caller gone before its turn, not run`). Before this fix it would have
  waited for the whole scan.
- Short calls during the scan answered `scan_in_progress` in 10 ms.
- 40 s into the scan the **baseband crashed** (SSR,
  `remoteproc-mss: fatal error … nr_rx_ctl_agc.c:7563 RXCTL_IUSS`, crash #33
  since boot; #32 at 14:46 was the same signature without a scan). The broker
  saw `ENETRESET`, answered `modem_not_ready`, cleared the long flag and
  recovered on the next call without a restart, same pid, no leaked fds: the
  first live SSR against the hardened channel.
- A second `AT+QSCAN=3,1` (15:06) **completed** through the broker in 153 s
  with no SSR (crash counter unchanged at #33): the echo
  (`AT+QSCAN=3,1\r\r\n`), 13 `+QSCAN: "LTE"` rows of 13 fields each, then
  `OK\r` (trailing `\n` stripped per the contract), long flag cleared, the
  next call answered at once. Replayed into `qmanager_cell_scanner`, it parsed
  all 13 cells with no missing band / EARFCN / PCI / signal (bands 1, 3, 8,
  28, 40, 41). No NR5G cell was in range, so the 16-field NR row is untested
  live. One SSR in two scans, matching the crash seen without a scan at 14:46,
  so there is no evidence QSCAN itself causes it.

**Legacy engine removed (2026-10-16):** `qcmd.sh`, `atcli_smd11` and the
engine switch (CGI, Modem Commands card, hook, `quecmanager.at.engine`) were
deleted. The broker is the only AT path.

**Not exercised on the device:** a forced timeout and resync, and the
frozen-broker restart (it needs a broker stuck for 340 s while every AT call
waits). Both are covered by the crate's tests.

## QMI Phase 1 on-device validation

Run 2026-10-22 on an RM551E-GL (fw `RM551EGL00AAR02A01M8G`), `qmanager_atd` 0.3.0 (md5 `dbe079d2964854d91eb23209f78a4c8a`) against 0.2.0 (`2aac2309…`). No reboot and no SSR during the run. The QMI reads and their timings are in [`qmi-lane.md`](qmi-lane.md#validation). The AT path results:

| Check | Result |
|---|---|
| Parity suite ([`tools/atd-parity/`](../../tools/atd-parity/README.md)), daemon and in-process fallback | 42/50 byte-identical to 0.2.0. The 8 live cases that differ (QENG, QCAINFO, QTEMP, CCLK) also differ between two 0.2.0 runs |
| Lock busy, lock held 8 s | `modem_busy` rc 1 at 5076 ms (0.2.0: 5073 ms) |
| Queued caller gone before its turn | Skipped and logged on both binaries. A capped waiter (`-t 1000`) returned busy at 1007 ms |
| Long flag (`scan_in_progress`) | 5–6 ms when raised before the call; 1018 ms when raised during a queued wait (0.2.0: 1030 ms) |
| 20 simultaneous `qcmd` (10 `ATI`, 10 `AT+CSQ`) | 20/20 rc 0, no interleaving |
| Daemon stopped (fallback) | `qmi bundle` rc 0 in 9 ms, same JSON paths as the daemon |
| Lifecycle, old init.d on device | Socket and proto removed. `/tmp/qmanager_qmi.json` and `qmi.env` stay (the old script does not clean them); the repo `stop_service` does |

Not run on device: install, OTA re-install and uninstall (static review only).

## Rollback

A previous release's binary (0.2.0) ignores `/usr/bin/qmi` and never writes
`qmi=1`, so a dangling or inert `qmi` link is harmless; reinstalling re-asserts
or removes it. Nothing in Phase 1 consumes the sidecars, so there is nothing to
unwind. There is no runtime switch. To go back to a pre-broker AT path, revert to a
previous release through Software Update or reinstall it.

## Parked poll module (`src/poll/`): what it is and what removing it touches

`native/qmanager_atd/src/poll/` (about 2.7k lines: `parse.rs`, `parse/ca.rs`, `parse/tests.rs`, `envout.rs`) is the B5.29 Phase D port of the poller's AT reply parsers and its env-file writer to Rust. It is compiled only with `--features poll` (off by default, declared in `Cargo.toml`, `mod poll` gated in `main.rs`), so the shipped binary does not contain it. It is **unwired**: no daemon code, `qcmd` argument or poller path calls it, there is no `POLL` verb and no `--parse-only` entry point, and the poller still parses every reply in shell. Phase D was decided against on 2026-10-19 (A+B+C already met the active-tier gate; D would save about 1-2 %). It costs nothing at run time and only adds the 14 `--features poll` host tests (267 vs 281 at 0.6.0).

Removing it would touch:

- **Code:** delete `src/poll/`, the `#[cfg(feature = "poll")] mod poll;` lines in `main.rs`, and the `[features] poll` entry in `Cargo.toml`.
- **Test tooling that already cannot run:** `tools/poller-parity/rx_rust.sh`, `rx_expect.sh`, and `native/qmanager_atd/tests/parity/{rx_rust.sh,rx_expect.sh,rx_pack.py,expected.txt,README.md}` drive `qcmd --parse-only`, which no build provides.
- **Docs:** the `poll/` row and the 222/236 counts in the Source layout section above, the matching counts in `qmi-lane.md`, `live-signal.md`, `data-used.md` and `dependencies/README.md`, the "Rust parser ports are built, not wired" bullet in `adaptive-polling.md`, and the design notes in `docs/architecture/poller-on-broker.md` and `docs/plans/2026-10-22-qmi-phase1-broker-architecture.md`.

Keeping it preserves the parity-tested parsers if the poller is ever moved into the broker. The decision to delete or keep is open.
