# Journal (`qmanager_logd` + `qlog`)

The journal is QManager's one store for log lines, Network Events and a filtered slice of the kernel log. `qmanager_logd` is a small daemon (an argv0 role of the `qmanager_atd` binary) that takes records from shell and broker writers through a spool file, stamps them with a sequence number and a trustworthy time, keeps the newest in RAM, mirrors them to the old `/tmp` files, and persists them to flash so the lines that explain an unplanned reboot survive it. `qlog` is its client role: the Logs page, Recent Activities, History and the System/Kernel tab all read through it. Before the journal, `/tmp/qmanager.log` and `/tmp/qmanager_events.json` lived on tmpfs and vanished at every reboot, `append_event` forked `date`, `jq`, `wc`, `tail` and `mv` per event and was unlocked, and `system/logs.sh` re-parsed the whole file on every 10 s poll.

Design record: [`../plans/2026-11-10-qmanager-logd-journal.md`](../plans/2026-11-10-qmanager-logd-journal.md). Binding names, paths and formats: [`../plans/2026-11-10-logd-contract.md`](../plans/2026-11-10-logd-contract.md). Broker binary and build: [`at-broker.md`](at-broker.md), [`../../dependencies/README.md`](../../dependencies/README.md). UI: [`../reference/logs.md`](../reference/logs.md).

## Quick Reference

| Thing | Where |
|---|---|
| Daemon | `/usr/bin/qmanager_logd` (symlink to `qmanager_atd`; started with no arguments or `-d`) |
| Client | `/usr/bin/qlog` (symlink to `qmanager_atd`): `qlog stat`, `qlog logq k=v ...`, `qlog evq k=v ...`, `qlog clear`, `qlog --version` |
| Source | `native/qmanager_atd/src/logd/*.rs` (engine in `core.rs`, queries in `query.rs`, kernel filter in `kmsg.rs`, event registry in `registry.rs`), client `src/client/qlog.rs` |
| Init script | `/etc/init.d/qmanager_logd`, procd, `START=97` (before the broker at 98), `STOP=12` (after the poller and broker so late lines still land) |
| Run dir (tmpfs) | `/var/run/qmanager/journal/`: `spool`, `spool.work`, `alive`, `debug` |
| Socket | `/var/run/qmanager_logd.sock` (`0600`, `SO_PEERCRED` uid 0 only) |
| Capability file | `/var/run/qmanager_logd.proto`: `proto=1`, `version=<crate>`, `logq=1`, `evq=1`, `lclr=1`, then `kmsg=1` when `/dev/kmsg` is open. Written after the socket is bound; removed by init stop and uninstall |
| Flash journal | `/usrdata/qmanager/journal/`: `log-<epochday>.jsonl`, `ev-<epochday>.jsonl`, `state` (epochday = floor(wall / 86400), UTC) |
| Text mirror | `/tmp/qmanager.log` (+ `.1`, `.2`), 256 KB each, same line format as before; written in 1 s batches |
| Events mirror | `/tmp/qmanager_events.json`, newest 50 rows, legacy row shape, at most one rewrite per second |
| Config | UCI `quecmanager.logging.{level,persist_level,forward_syslog}` (defaults `INFO`, `INFO`, `0`) |
| CGIs | `system/logs.sh`, `system/log_debug.sh`, `system/syslog.sh`, `at_cmd/fetch_events.sh`, `history/events.sh` ([`../API-REFERENCE.md`](../API-REFERENCE.md)) |
| Shell writers | `qlog.sh` (`qlog_*`), `events.sh` (`append_event`), `history.sh` (`hist_event`) |
| Durable identity files | `/etc/qmanager/last_imei`, `/etc/qmanager/last_version` (event baselines) |
| Event runtime files | `/var/run/qmanager/events.lock`, `/var/run/qmanager/broker.seen`, `/var/run/qmanager/data_cid.last` |
| Env overrides (tests, trials) | `QLOGD_RUN_DIR`, `QLOGD_JOURNAL_DIR`, `QLOGD_SOCK`, `QLOGD_PROTO`, `QLOG_FILE`, `QLOGD_EVENTS_MIRROR`, `QLOGD_UPTIME`, `QLOGD_BOOT_ID`; the shell side honours `QLOGD_RUN_DIR` |

> ℹ️ NOTE: `/etc/qmanager/log_level` is retired. It was read by six init scripts and written by nothing. `install.sh` carries a hand-made value over into `quecmanager.logging.level` once, then deletes the file; the init scripts read the UCI key.

## Architecture

```
 shell writers: qlog_*, append_event, hist_event      qmanager_atd (Rust): common/log.rs
   printf >> journal/spool   (0 forks)                  same spool line while logd is alive
                  \                                       /
                   v                                     v
        /var/run/qmanager/journal/spool        (tmpfs, O_APPEND, one record per line)
                              |
              inotify wake, rename -> spool.work, 100 ms grace, parse
                              v
                       qmanager_logd
        seq + clock anchor, repeat-collapse, rate limit, RAM ring
        text mirror, events mirror, flash day files, kmsg reader
                              |
              /var/run/qmanager_logd.sock  <-  qlog (stat | logq | evq)
                              ^
        CGIs: logs.sh, syslog.sh, fetch_events.sh, history/events.sh, log_debug.sh (lease file only)
```

**Why a separate process.** Flash I/O, parsing and queries must never share a process with the AT lane, and `poller-on-broker.md` forbids event logic inside the broker. The role reuses the broker crate's `common/log.rs`, `safefs`, `json` and `proto` (libc-only, musl static), exactly like `qcmd`, `qsms` and `qmi`. The broker only appends one line to a file: it holds no socket and no lock for logging, so a logd bug cannot stall `qcmd`.

**Why a spool file, not a socket.** A shell cannot write a Unix socket without forking a client (about 5 ms, the cost of one `date`). `printf >> file` is a builtin. A FIFO was rejected: opening one with no reader blocks the writer forever. This is the `ext.spool` precedent from [`history.md`](history.md): rename, read one grace later, so a writer mid-`printf` always lands.

**argv0 roles.** `main.rs` dispatches on the invoked name. `qmanager_logd` with no arguments, `-d` or `--daemon` is the daemon; `--version` prints `qmanager_logd <ver> proto=1`; anything else is refused with usage (exit 2), so a stray `qmanager_logd stat` never starts a second daemon. `qlog` is always a client. `at_logd_link` and `at_qlog_link` (`at_engine.sh`) create the symlinks atomically; `init.d/qmanager_logd` re-asserts both at every start.

**Socket protocol** (same framing as the broker): request `<VERB> <nbytes>\n` + `k=v` pairs joined by NUL (0 bytes for `STAT`), one request per connection, body cap 4 KB. Reply `RES <0|1> <nbytes>\n<json>` or `ERR <code>\n` (`unknown_verb`, `bad_request`, `too_large`), reply cap 1 MB. `qlog` prints the JSON on stdout: exit 0 on success, 1 when logd answered a failure (`RES 0`, for example `invalid_param`) or an `ERR`, **3 with nothing on stdout when logd is unreachable**, which is the signal every CGI uses to fall back to its legacy path. Exit 2 is usage.

## Records

### Spool line (writer to logd)

Tab-separated, LF-terminated, the message is always the last field (tabs inside it are kept):

```
L<TAB><mono><TAB><LEVEL><TAB><component><TAB><pid><TAB><message>
E<TAB><mono><TAB><type><TAB><severity><TAB><code><TAB><fields><TAB><message>
```

| Field | Rule |
|---|---|
| `mono` | First field of `/proc/uptime` verbatim (`12345.67`), read with the `read` builtin. Unparsable: logd uses its ingest time. A caller may pass an event's **own** mono (History does for crash onsets and `device_reboot`) |
| `LEVEL` | `DEBUG`, `INFO`, `WARN`, `ERROR`; anything else becomes INFO |
| `type` | `[a-z0-9_]{1,48}`, otherwise the line is dropped and counted (`bad_lines`) |
| `severity` | `info`, `warning`, `error`; anything else becomes `info`. `code` may be empty |
| `fields` | Empty or `k=v;k=v` (`k` is `[a-z0-9_]{1,32}`, `v` holds no `;`, tab or newline); a malformed pair is skipped |
| message | The writer collapses newlines with one `tr` fork, only on that edge (detected with a `case`). logd also strips `\r` and control bytes below 0x20 except tab |
| line cap | 4096 bytes; longer is cut and ends `…[truncated]`. A last line without LF is accepted if it parses |

**Writer gate.** A writer uses the spool only when `journal/alive` exists (`[ -e ]`, a builtin); otherwise it takes the legacy path (a direct append to `/tmp/qmanager.log` or the events file). **Why:** logd removes `alive` on stop and the init script drops it before the daemon exits, so lines written in the gap are not queued for a reader that is gone. If logd is killed without cleanup, procd respawns it in about 5 s and it drains `spool.work` then `spool` before announcing `alive`.

`append_event TYPE MESSAGE [SEVERITY] [CODE] [FIELDS]`: the 5th argument is `k=v;k=v` and reaches **logd only**; the legacy row has no fields. For a Cellular History type the writer adds `radio=lte|nr` itself (`_ev_radio_field`), because logd cannot see the live radio. The type's `cat` comes from the compiled registry (`registry.rs`: `cellular`, `connection`, `system`, `config`, `security`, `lan`, `alerts`; unknown types are kept as `other`).

### Journal row (RAM ring and flash)

```json
{"s":1842,"b":7,"m":12345.67,"t":1794199490,"k":"L","lv":"WARN","c":"poller","p":7600,"msg":"..."}
{"s":1843,"b":7,"m":12350.02,"t":1794199494,"k":"E","type":"band_change","sev":"info","cat":"cellular","code":"","f":{"from":"B3","to":"B7"},"msg":"..."}
{"s":1844,"b":7,"m":12351.10,"t":1794199495,"k":"K","pri":3,"msg":"remoteproc-mss: fatal error ..."}
```

`s` is the global sequence (monotonic across restarts and reboots), `b` the boot index, `m` mono seconds, `t` wall epoch seconds or `null` while the clock is untrusted. `code` and `f` are omitted when empty. Kinds: `L` log line, `E` event, `K` kernel record. Readers drop torn lines (a row must start with `{"s":` and end with `}`).

After an **unclean** stop (SIGKILL, power cut) logd restarts with `seq` advanced by 10 000 (`UNCLEAN_SEQ_GAP`): rows given numbers after the last flush were lost, but a client may have seen those numbers. Cursors therefore stay valid; `head_seq` simply jumps.

## Clock rules

Port of [`history.md`](history.md) §5. The modem boots at 1970 and steps its wall clock on NITZ/NTP and after a baseband SSR, so wall time is **derived, never taken from the writer**.

- `t = wall_now - (mono_now - m)` while the clock is trusted.
- Trusted = wall >= 1700000000 **and** wall >= newest-record wall - 120 **and** (uptime >= 300 s **or** a step was already seen this boot). The newest-record floor at start is `state.last_wall`.
- A drift of `wall - (mono + offset)` beyond 120 s re-anchors.
- Rows taken before trust keep `t:null` in RAM and are back-dated when trust arrives. If they must be flushed first, they go to the newest existing day file (else `epochday(state.last_wall)`, else `log-0.jsonl` / `ev-0.jsonl`).
- **Ordering is always by `s`**, never by wall time. History's reader works on `t`, so rows still `t:null` are not served to it until back-dated.

The Logs UI shows a time for a `t:null` row of the running boot as `now - (mono distance)`. A previous boot's boundaries come from the boot index (`boots[].first` / `last`, epoch seconds, `null` when unknown).

## Boots

`state` holds `seq`, `boot`, `boot_id` (`/proc/sys/kernel/random/boot_id`), `last_wall`. A new `boot_id` at start increments `b`; a restart of logd inside one boot keeps it. The boot index is rebuilt from flash: `qlog logq` returns `boots[]` (`boot`, `first_seq`, `last_seq`, `first`, `last`) for every boot that has rows on flash, so the "Previous boot" view exists only as long as its day files do (see retention).

`boot=` takes `this` (default), `prev` (the newest boot before this one) or a number. `this_boot` in the reply names the running boot.

## Flush and the flash budget

Rows are in the RAM ring, and queryable, the moment they are ingested. Flash is written in batches: append to the day file, `fdatasync` **that file only** (BusyBox has only the global `sync`; the Rust side uses per-file syncs).

| Trigger | Rule |
|---|---|
| Urgent | An ERROR line, or an event of severity `warning` or `error`: flush within 2 s. While urgent rows keep coming (one within the last hour) the next urgent flush waits a gap counted from the last flush of any kind: 120 s, doubling each time it held a row back, up to 10 min; the gap resets after 1 h without urgent rows |
| Periodic | 10 min after the first pending row (INFO included), and on TERM |
| No-op | A flush with no new persisted rows writes and syncs nothing; otherwise it syncs only the day files it appended to |
| State file | Rewritten on every flush but synced (file and directory) only at start, on TERM, and from the periodic flush at most once per 4 h. A power cut that loses it is just a new boot: start rebuilds `seq` and `boot` from the flash rows plus the unclean gap |
| Free space | Skipped while `/usrdata` has under 8 MB free (`statvfs`) |
| Levels | Logs at or above `persist_level` (default INFO) are persisted; all events are |

**What this costs.** STAT `fsyncs` counts every sync issued, directory syncs included. Worst case is about 148 flushes a day (one per 10 min plus the 2 s / 120 / 240 / 480 s ramp) times at most 2 day files, plus 6 state syncs from the 4 h cadence and the start/TERM ones: about **310 syncs a day** when both files are written every 10 min all day; a normal day is **160 to 230**. At today's volume (about 60 log lines an hour) the journal writes on the order of 55 to 130 KB a day. **What a power cut loses:** at most 10 min of INFO, and under a sustained storm at most 10 min of ERROR lines and warning/error events (the first one is on flash within 2 s).

**Why not sync every row.** The flash is UBIFS; the earlier design measured 520 fsyncs a day when every row burst flushed, which was over the gate. The backoff, the 10 min INFO batch and the 4 h state sync are what brought it under.

## Retention, day caps and the rate limit

| What | Rule |
|---|---|
| Log files | 7 days **and 4 MB total** (oldest day file goes first, never today's) |
| Event files | 31 days **and 8 MB total**, 2000 events a day |
| Log day cap | Past 1 MB in one day file, only WARN/ERROR and `K` rows are kept, up to 256 KB more. The first row dropped that way each day logs one WARN `daily log cap reached; keeping warnings, errors and kernel lines only` |
| Event day cap | Past 2 MB, or 2000 events, only keep-list types and `error` events are kept (256 KB reserve for the byte cap). Keep-list (`registry.rs` `kept_past_cap`): `signal_lost`, `signal_restored`, `internet_lost`, `internet_restored`, `sim_failover`, `data_call_dropped`, `data_call_restored`, `device_reboot`, `modem_crash`, `modem_recovered`, `thermal_throttled`, `thermal_recovered` |
| Cap drops | STAT `drops.cap` counts every one |
| Repeat-collapse | An identical (component, level, message with digits stripped) line repeating within 60 s is stored once, followed by `... repeated N times in 60 s` when the run ends (`drops.collapse`) |
| Rate limit | 100 lines/s with a burst of 500, per component. Past it lines are dropped and counted; once the storm has been quiet for 10 s one WARN row `rate limit: dropped N lines in D s` is written. A storm still dropping when a timed flush or TERM comes is reported then, with ` (still dropping)` |
| Text mirror | 256 KB x 3 files, rotated by logd |

> ⚠️ WARNING: The 4 MB and 8 MB limits are **totals across all day files**, not per day (the 1 MB log and 2 MB event day caps above are unchanged), and retention deletes whole oldest files to meet them. **Why:** a day at its cap plus reserve is about 1.25 MB of logs, so 4 MB holds several full days and one storm day never deletes the days before it; the first design's 1 MB total did exactly that. A chatty day still shortens how many boots "Previous boot" can reach. A single day that hits the cap keeps only warnings, errors and kernel lines for the rest of that day, so the lines before an unplanned reboot are INFO-poor on such a day. The validation reboot test lost its marker exactly this way (see Gates).

## Query verbs

`qlog stat` prints counters (`STAT`): `version`, `proto`, `pid`, `boot`, `head_seq`, `counts` (per level and `events`), `ring` (`rows`, `bytes`, `oldest_seq`), `drops` (`rate`, `collapse`, `bad_lines`, `level`, `cap`), `flushes`, `fsyncs`, `flush_skips`, `flush_errors`, `rows_flushed`, `bytes_written_today`, `last_flush_mono`, `clock` (`trusted`, `offset`), `debug_lease`, `debug_lease_expiry`, `level`, `persist_level`, `forward_syslog`, `syslog_forwarded`, `boots`, `kmsg` (`open`, `read`, `kept`, `overruns`, `seq`, `ssr_this_boot`).

Both query verbs return the newest `limit` matches, oldest first. The RAM ring holds every row above its lowest `s`; older rows come from flash. EVQ reads event day files newest day first and skips a whole older day when its last `s` (read from the file's last 8 KB, `Journal::last_s`) is below the lowest row already picked, so a page of recent events does not scan 31 days of files. **Why:** the 30 d connection History cost was dominated by reading every event file.

### `qlog logq` (LOGQ)

| Param | Meaning |
|---|---|
| `min_level` (alias `level`) | `DEBUG`, `INFO`, `WARN`, `ERROR`: a floor, not an exact match |
| `component` | exact name; `all` or empty = none |
| `search` | case-insensitive substring over the message (and an event's type) |
| `boot` | `this` (default), `prev`, or a boot number |
| `after`, `before` | journal `seq` bounds (exclusive) |
| `limit` (alias `lines`) | 1..500, default 200 |
| `kind` | `L`, `E`, `K` or a comma list; default is `L,E` (the transcript) |
| `source` | `journal` (default) or `kernel` (= `kind=K`) |
| `tag` | kernel filter tag (`ssr`, `remoteproc`, `oom`, `thermal`, `panic`, `watchdog`, `bug`, `eth`) |
| `fmt` | `json` (default) or `mono`: one uptime second per line, no JSON (what History's SSR onset reads) |

Reply: the legacy `logs.sh` shape (`entries[]` with `timestamp`, `level`, `component`, `pid`, `message`; `total`, `stats`, `available_components`) plus `seq` and `t` per entry, `counts` (per level), `latest_problem`, `boot`, `this_boot`, `head_seq`, `has_more`, `boots[]`. Events appear as INFO rows of component `events` (`EVENT [type] message`), as the legacy writer logged them. For the **running boot**, flash is read only when the ring cannot fill the page (the 30 ms budget); `counts` and `available_components` then cover the ring and `has_more` says older rows exist. Other boots always read flash. An invalid param is `RES 0` with `{"success":false,"error":"invalid_param","detail":...}` (exit 1).

### `qlog evq` (EVQ)

| Param | Meaning |
|---|---|
| `types` | comma list of event types (`[a-z0-9_]`, at most 48 chars each) |
| `cat` | `cellular`, `connection`, `system`, `config`, `security`, `lan`, `alerts`, `other` |
| `after`, `before` | `seq` bounds |
| `since`, `until` | wall epoch seconds (rows with `t:null` never match a time filter) |
| `limit` | 1..2000, default 50 |
| `fmt` | `json` (default): the legacy `NetworkEvent` array plus `seq`, `cat`, `f`, `boot`, `t`. `hist`: History's `{"k":"e","t":...,"type":...,"severity":...,"radio":...,"message":...}` rows, one per line, only rows with a trusted `t`, `radio` from the writer's `radio=` field else the registry's prefix rule for the Cellular types |

`boot=` is not an EVQ parameter: events span boots.

## Kernel capture

logd reads `/dev/kmsg` (a stream with its own sequence numbers; no fork) and keeps a filtered set as `K` rows in the log day files, so the System/Kernel tab has history the 64 KB syslog ring (about 9 s on the RM551E, flooded by firmware `qms` output) cannot give. Capability line `kmsg=1`. After a logd restart it resumes at the last kept kernel sequence, so nothing is duplicated.

| Tag | Kept when the message has |
|---|---|
| `ssr` | `remoteproc` with `fatal error` or `crash detected`; or `subsys-restart` / `subsystem restart` |
| `remoteproc` | `remoteproc` with `is now up`, `is now off`, `stopped`, `recover`, `booting fw`, `powering up` |
| `oom` | `invoked oom-killer`, `out of memory`, `oom-kill:` |
| `thermal` | `thermal` with `trip`, `critical`, `emergency`, `shutdown`, `overheat` |
| `panic` | `Kernel panic` |
| `watchdog` | `watchdog` with `bark`, `bite`, `lockup` |
| `bug` | `BUG:`, `Oops`, `Internal error:`, `Unable to handle kernel` |
| `eth` | `link is up|down` / `link up|down` from `eth*`, `stmmac`, `r8125`, `r8169` |

Derived events: `oom_kill` (warning, `proc`, `pid`) from `Killed process <pid> (<name>)`; `eth_link_up` (info, `iface`, `speed`, `duplex`) and `eth_link_down` (warning, `iface`). An SSR is a `K` row only: History's `modem_crash` still comes from the QMI state. `history_series_system.sh` reads the SSR onset with `qlog logq kind=K tag=ssr search=... limit=1 fmt=mono` when the capability has `kmsg=1`, falling back to the `dmesg | grep` it used before. `syslog.sh source=kernel&boot=prev|<n>` serves a past boot's kept set ([`../reference/logs.md`](../reference/logs.md)).

## Debug lease

`system/log_debug.sh` writes `/var/run/qmanager/journal/debug` (mono expiry, `uptime + 1800`) through `qm_atomic_write`, after checking the journal dir is a real root-owned directory. While it exists logd keeps DEBUG rows and every shell `qlog_debug` writes (one `[ -e ]`, no fork), so long-lived daemons pick it up without a restart. logd removes the file on expiry; an unparsable or empty file counts as first-seen + 1800 s. The expiry is monotonic on purpose: a wall-clock step cannot extend or cut it. Stopping early is `{"enable":false}`. The page owns the lease; see [`../reference/logs.md`](../reference/logs.md).

The level floor otherwise comes from UCI: `quecmanager.logging.level` is the minimum written (logd gets it as `QLOGD_LEVEL`, shell writers as `QLOG_LEVEL`), `persist_level` the minimum kept on flash, `forward_syslog=1` copies ERROR to syslog from inside logd with `libc::syslog` (no fork).

> ⚠️ WARNING: Editing `quecmanager.logging` does nothing until `/etc/init.d/qmanager_logd reload` (a restart). The init script has no procd config trigger on purpose: many CGIs commit the `quecmanager` package and a restart per commit would be noise. Shell daemons read `quecmanager.logging.level` into `QLOG_LEVEL` at their own start.

## Fallback when logd is down

Nothing blocks and nothing is lost to the shell writers: `alive` is absent, so `qlog.sh` and `append_event` take today's legacy paths (direct `/tmp/qmanager.log` append with its `wc -c` rotation check, `jq` event append under `flock` on `/var/run/qmanager/events.lock` fd 6, plus the History tap). The CGIs test the capability file (`logq=1`, `evq=1`, `kmsg=1`, read with the `read` builtin), and any parameter that fails validation, `qlog` exit 3 or any other non-zero exit takes the legacy path: `logs.sh` parses the text file, `fetch_events.sh` serves the events file, `history/events.sh` reads the day files, `log_debug.sh` answers `available:false`. Events recorded while logd was down live in the legacy stores; the History reader merges both.

**Spool backstop.** The poller checks `journal/spool` once a minute (one `wc -c`) and truncates it above 1 MB with one WARN `logd spool over 1 MB and unread (N bytes); truncated`. **Why:** a killed logd leaves `alive` behind for up to 5 s and a hung one forever; without a bound the tmpfs file would grow.

### Clear (`LCLR`, `qlog clear`)

`LCLR` (no body; capability `lclr=1`) drops every `L` row from the RAM ring and deletes the log day files, then stores one INFO row `logs cleared`. It answers `{"success":true,"rows_cleared":N,"files_removed":M}`. Events (ring and `ev-*` files), the current boot's `K` rows in RAM and `kmsg_seq` are kept, so kmsg is not imported again after a restart. Kernel rows of earlier boots lived in the log day files and go with them, so a previous boot's System/Kernel tab is empty after a clear.

`POST system/logs.sh {"action":"clear"}` calls `qlog clear` when `lclr=1` is advertised, then still truncates the text mirror (`/tmp/qmanager.log` and rotations). `qlog` exit 3 (logd unreachable) falls back to the mirror-only legacy clear; any other non-zero exit answers `clear_failed` and logs an ERROR. With logd alive, the single "logs cleared" row comes from logd, so the CGI does not write its own "Clearing all log files" lines.

## Lifecycle

| Step | Behaviour |
|---|---|
| `install.sh` (fresh and update) | Links `qmanager_logd` and `qlog` (`at_logd_link`, `at_qlog_link`), seeds `quecmanager.logging` (level from the old `/etc/qmanager/log_level` if present), `mkdir -p /usrdata/qmanager/journal` (`0755`), enables and starts `qmanager_logd` **before** the broker and the main service. The init scripts' unified `QLOG_LEVEL` comes from UCI |
| Start/stop order | `START=97` (before `qmanager_atd` 98 and the poller 99), `STOP=12` (after both). Stop removes `alive` first, then the daemon flushes on TERM (`clean=1`), then `service_stopped` waits up to 5 s for the pid and removes the socket and capability file. `spool` and `spool.work` stay: the next start drains them |
| Respawn | `procd_set_param respawn 3600 5 5` |
| `uninstall.sh` | Stops and removes the init script, the `qmanager_logd` and `qlog` links, `/var/run/qmanager/journal`, the socket and capability files, `broker.seen`, `data_cid.last`; removes `/usrdata/qmanager/journal` (flash data) and the config dir with `/etc/qmanager/last_imei` and `last_version` |
| ipk | Same files via `install.sh --configure` / `uninstall.sh --deconfigure` ([`ipk-packaging.md`](ipk-packaging.md)) |
| `qmanager_debug_report` | Includes `qlog stat` and a listing of the journal dir |

> ℹ️ NOTE: The lockstep checklist for any future change: init.d, both symlinks, UCI seed, the flash mkdir, the `/var/run/qmanager/journal` cleanup in stop and uninstall, the flash removal in uninstall, the ipk manifest.

## Runtime files

| Path | Owner | Purpose |
|---|---|---|
| `/var/run/qmanager/events.lock` | `append_event` legacy path | fd 6 `flock` around the `jq` append + 50-row trim (poller, watchcat, profile apply, config restore and three CGIs all append). Root-only run dir, never a predictable `/tmp` path. Absent dir: the legacy append runs unlocked |
| `/var/run/qmanager/broker.seen` | poller `detect_broker_restart` | Marker whose mtime is the last look at `/var/run/qmanager_atd.proto`; a newer capability file is a restart. No marker = first sighting, silent. Checked once a minute |
| `/var/run/qmanager/data_cid.last` | `_ondemand_dataplane_events` | Last data CID, written only on change, so `data_cid_changed` has a baseline |
| `/etc/qmanager/last_imei` | `ev_identity_check` | Durable baseline for `imei_changed` (full IMEI on disk, only the last four digits in events) |
| `/etc/qmanager/last_version` | `ev_identity_check` | Durable baseline for `software_updated` |
| `/usrdata/qmanager/journal` | logd | Flash day files and `state` |

## New event types

Detectors stay in shell (the poller, CGIs and daemons); only storage moves to logd. The type list for the UI is in `lib/event-message.ts` (localised from `type` + fields, `message` is the fallback).

| Page | Types |
|---|---|
| Cellular | `apn_changed` (also on deactivate), `band_lock_changed`, `tower_lock_changed`, `band_failover`, `tower_failover`, `sim_switched`, `registration_changed`, `imei_changed`, `rat_priority_changed`, `fplmn_cleared`, `scenario_switched` |
| Connection | `data_call_dropped`, `data_call_restored`, `wan_address_changed`, `data_cid_changed`, `dns_changed`, `ttl_mtu_changed`, `dns_failing`, `dns_recovered`, `site_down`, `site_up` |
| LAN / kernel | `eth_link_up`, `eth_link_down`, `oom_kill` |
| System | `broker_restarted`, `software_updated`, `clock_stepped`, `storage_low`; `device_reboot`, `modem_crash`, `modem_recovered` now also reach the journal |
| Security / alerts | `login_failed`, `login_locked`, `password_changed`, `alert_send_failed` |

Detector invariants that are not obvious from the code:

- **No observation is not an event.** `registration_changed` ignores an empty carrier name; `wan_address_changed` and `data_cid_changed` ignore an empty old or new value (first sighting, no bearer); `site_down` / `site_up` treat a sweep where **no** site answered as no observation (`internet_lost` covers the link) and need two failed sweeps in a row for down; the first sweep only sets the baseline.
- **Debounce.** `data_call_dropped` needs three fresh QMI samples with no WDS mux after the call was seen up and is silent while the QMI lane is not `up` and registered (SSR and airplane mode belong to `modem_crash`). `dns_failing` needs three failed lookups after a good one.
- **Never in the event.** Login events carry no IP; `alert_send_failed` carries the channel and trigger, never the recipient; `imei_changed` carries only the last four digits.
- **No event from boot apply scripts.** `ttl_mtu_changed` fires from the CGIs, never from the boot re-apply.
- **Not built:** `airplane_mode` (the poller already emits it), `qmi_lane_*` (duplicates `modem_crash`), `clock_synced` (every boot), `vpn_*`, `daemon_restarted`, `watchdog_auto_disabled`, `speedtest_completed`.

## Invariants

1. **Shell writers never fork for a log line or an event** (no `date`, `jq`, `wc`, `tail`, `mv`, `logger`): `read` from `/proc/uptime` and `printf >>`. The one fork is `tr` on a message with a newline.
2. **Ordering is by `s`, never by wall time.** A `t` can be back-dated or re-anchored.
3. **A writer tests `alive`, not the directory alone.** A stale spool without a reader would grow; the backstop bounds the failure case.
4. **logd must never be required.** Every consumer has a path that works without it, behind the capability file.
5. **Per-file `fdatasync`, never a global `sync`**, and a flush with nothing new does no I/O.
6. **The detectors stay in shell.** The Rust side stores, stamps, caps and queries; it does not decide what an event is (except the kernel filter, which has no shell equivalent).
7. **The ring is a cache, not a store.** It is not reloaded at restart; rows older than its lowest `s` are read from flash. Its size is bounded in rows and bytes (2560 rows or 480 KB) because a 4096-row ring measured 1.67 MB RSS against the 1.5 MB gate.
8. **Day files are only appended; `state` is replaced atomically** (`write_atomic`). Every day file is opened `O_APPEND|O_CREAT|O_NOFOLLOW` and must be our own regular file with one link, so a planted symlink or hardlink in the journal dir is refused.
9. **Tests must not touch the live spool.** `tools/history-test/run-local.sh` sets `QLOGD_RUN_DIR` to a path that never exists; running the legacy mode on a device with logd alive otherwise routes writes to the real spool and leaks test events into the live journal.

## Gates and measurements

Device: RM551E test modem. Plan targets in §4 of the plan. Final build `5f3e0b68` (binary 819,080 B, md5 `4a2e2ccdeea17f78ca31ae3ceddfc1a9`), measured in Rounds 2 to 4 (2026-11-11). Rows that cite the earlier build `e4239b84` were not repeated because their code path did not change.

| Gate | Target | Measured | Build | Status |
|---|---|---|---|---|
| Idle CPU | <= 0.2 % of one core | 0 ticks in 120 s (0.000 %) at a full ring | `e4239b84` | met |
| Storm CPU | <= 3 % at 100 lines/s for 60 s, no loss below the ring bound | 0.57 % core (35 ticks / 61 s), 0 rate drops, head_seq +6003; storm at 300/s for 20 s: 0.99 %, 3405 dropped, one WARN row about 9 s after the end. (First build `ab28bd79`: 1.87 % and per-second drop rows, fixed by the burst/quiet rule) | `e4239b84` | met |
| RSS | <= 1.5 MB | 1676 kB (HWM 1684 kB) at 4096 rows / 520 KB: **failed**; ring cut to 2560 rows / 480 KB. Final build: idle 848 kB; full ring (2560 rows) after a 100/s x30 s storm 1308 kB, VmHWM 1340 kB, 0.51 % core | `e4239b84`, fix `a52f55e7`; re-measured on `5f3e0b68` | met |
| Shell write cost | 0 forks per line or event | control loop 2, `qlog_info` x200 = 3, `append_event` x30 = 1 (noise level) | `e4239b84` | met |
| `logs.sh` request | <= 30 ms at a full ring | 0.02 to 0.03 s wall for `lines=500&include_rotated=1` x5 (baseline 0.16 s); `qlog logq limit=500` 0.00 to 0.01 s | `e4239b84` | met |
| Poller | no regression (active <= +0.1 pt), parity zero-diff | 3.73 / 3.70 % core vs baseline 4.17 to 4.27 % (poller pinned by pid); Round 2: 3.88 / 3.93 % on a link-down window (ping retries, about 10 forks/s, not logd) | `e4239b84`, Round 2 | CPU met; the poller-parity scripts were not run for this change |
| History tests | 71/71 and system 51/51, unchanged | on device (BusyBox, `run-local.sh`, no `QLOGD_RUN_DIR` workaround): legacy 86/86 and 51/51, journal-test 30/30, logd mode 86/86 and 55/55; the live journal was untouched (head_seq +1 organic, per-type event counts identical) | Round 2 (`f27c857c`) | met |
| History CGI cost | no regression | 30 d, limit 100. First build: connection 0.48 to 0.50 s vs legacy 0.08 s. Final build: connection **0.18 to 0.19 s** (378 events vs legacy 265), cellular 0.07 to 0.08 s (legacy 0.06), system 0.07 s (legacy 0.04). Fixes: single-awk reader (`8e532796`), EVQ newest-day-first (`1f013812`) | `5f3e0b68` | accepted deviation: connection stays above the ~0.1 s target because the journal carries about 40 % more connection events than legacy |
| Flash | <= 300 syncs a day, <= 1 MB a day | First build: 15 fsyncs in 6 flushes (2.5/flush), 520 a day extrapolated: **failed**. After the flush fixes, measured only on quiet link-down windows: 6 fsyncs in 3 flushes over 33.9 min (Round 1); 5 to 6 fsyncs, 2 to 3 flushes over 31.2 min (Round 2, the one flush was a test WARN). Design arithmetic: worst case about 310 a day, normal 160 to 230 (estimated, not measured under a busy link or over 24 h) | `e4239b84`, Round 2 | accepted: met on a quiet window, busy-link figure is arithmetic |
| Binary | <= 800 kB (target) | 819,080 B stripped static aarch64 (815,728 B before the retention and `lclr` changes); ceiling raised to **850 kB** and accepted for 0.8.0 | `5f3e0b68` | accepted over target |
| Fallback | logd stopped: legacy paths, nothing hangs | `alive`, socket, proto removed; `qlog_info` goes to `/tmp/qmanager.log` in shell format; logs/syslog/history/fetch_events answer in 0.02 to 0.24 s; `log_debug` `available:false`; start restores | `e4239b84` | met |
| Crash recovery | respawn and drain | `kill -9`: respawn in 5.06 s, `alive` kept, gap lines logged, seq resumes (+~10 000), ring lost and flash kept | `ab28bd79` | met |
| Spool backstop | bounded | 1.2 MB spool made while stopped: truncated within 25 s with the WARN | `ab28bd79` | met |
| Debug lease | on/off/expiry | GET/POST OK, file = uptime + 1800, DEBUG rows kept while leased, expiry removes the file (level back to INFO), `invalid_body` OK | `e4239b84` | met |
| Kernel capture | K rows, no duplicates | injected `<4>qm-validator-test: remoteproc-test stopped` -> K row (tag `remoteproc`, WARN); logd restart added no duplicate; `boot=prev` kernel returned the earlier K row; `boots[]` listed 2 boots | `e4239b84` | met |
| Previous boot survives a reboot | marker line visible after reboot | First attempt failed: the validation storm had exhausted the 1 MB log day cap (day file 1,091,794 B) so the marker never reached flash; an isolated instance showed SIGTERM flushes and sets `clean=1`. Fixed by the WARN/ERROR/kernel reserve (`a24b057c`) and the 4 MB total (`1f013812`). Round 4: a WARN marker was persisted, `clean=1` written, and after the reboot `qlog logq boot=prev` and `logs.sh boot=prev` returned the marker and "journal stopping"; `boots` listed 1 to 3; logd up at about 45 s uptime | `a24b057c`, `1f013812`; Round 4 on `5f3e0b68` | met |
| `device_reboot` for the new boot | recorded | Round 2: boot 2 recorded at its boot epoch, `cause=unexpected off=286` (a plain `reboot` is classed unexpected). Round 4: boot 3 recorded with `t` = the clock offset once the clock was trusted at about 300 s uptime | Rounds 2 and 4 | met |
| AT path | `qcmd` OK before/after | `ATI` OK around every restart and both reboots | `e4239b84`, Rounds 2 to 4 | met |
| Day cap persistence | WARN, ERROR and `K` rows survive a capped day | With the day capped: the cap WARN, a ping WARN, a test WARN and a `remoteproc` K row reached flash at the 10 min flush; INFO rows were dropped from flash (3038 cap drops) but stayed in the ring | Round 2 (`f27c857c`) | met |
| Retention | several full days kept | Restart left the journal dir's file set identical (three `ev-*`, one `log-*`, `state`); no day file deleted | `5f3e0b68` | met |
| Clear | logs and earlier-boot kernel rows go; events and kmsg state stay | `POST logs.sh {"action":"clear"}`: log day file removed, `ev-*` files byte-identical, one "logs cleared" row, kmsg seq unchanged and no re-import after a logd restart; `syslog.sh source=kernel&boot=prev` empty afterwards (expected) | Round 4 on `5f3e0b68` | met |
| `broker_restarted` | one event per restart, silent on first sighting | exactly one event within 75 s of the second broker restart; none on first sighting | `ab28bd79` | met |

## Gotchas

- **CRLF** in any of the shell files = zero output. `.claude/check-crlf.sh` before every deploy.
- **BusyBox `pidof` in `measure.sh`:** `tools/poller-parity/measure.sh` takes the first pid `pidof qmanager_poller` returns, which can be a short-lived poller subshell (ticks 0, invalid run). Pin the run to the poller itself: the pid whose `PPID` is 1 (`awk '$4==1'` over `/proc/*/stat`, or `ps` and check the parent). The 2026-11-10 baseline and the final run both pinned the pid by hand.
- **`time` and `date +%N`** do not behave on the device: use `time -p` and `/proc/uptime` for timings.
- **`/tmp/qmanager.log` format is unchanged** on purpose: `qmanager_logread`, `qmanager_debug_report` and SSH greps keep working. Events show in it as `INFO  [events:<logd pid>] EVENT [type] message`.
- **Deploy with `sync`.** The binary is replaced atomically (`mv`), not overwritten; an unsynced copy plus a power-off zeroed core files once ([`../../dependencies/README.md`](../../dependencies/README.md) for the build).
