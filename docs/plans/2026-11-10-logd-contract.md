# qmanager_logd: build contract (shared by every builder)

Companion to `2026-11-10-qmanager-logd-journal.md` (the plan). The plan says *what* and *why*; this file pins the names, paths and formats that the Rust daemon, the shell writers, the lifecycle scripts and the CGIs must agree on. If you need to change anything here, say so in your report; don't diverge silently.

## Paths

| What | Path | Owner | Notes |
|---|---|---|---|
| run dir | `/var/run/qmanager/journal/` | logd creates (0700 root, `safefs::ensure_own_dir`) | tmpfs |
| spool | `journal/spool` | writers append, logd renames | one record per line |
| spool being read | `journal/spool.work` | logd | read after a grace, then unlinked |
| alive marker | `journal/alive` | logd writes its pid after it is ready; removes on clean stop | writers test `[ -e ]` |
| debug lease | `journal/debug` | CGI writes, logd removes on expiry | content: expiry as whole seconds of `/proc/uptime` (mono). Unparsable/empty → expiry = first-seen mono + 1800 |
| query socket | `/var/run/qmanager_logd.sock` | logd | `SO_PEERCRED` uid 0 only |
| capability file | `/var/run/qmanager_logd.proto` | logd writes after bind (atomic), init.d stop removes | `proto=1`, `version=<crate>`, then `logq=1`, `evq=1` (Phase 2), `kmsg=1` (Phase 4) |
| text mirror | `/tmp/qmanager.log` (+ `.1`, `.2`) | logd while alive; legacy writers when not | format unchanged |
| events mirror | `/tmp/qmanager_events.json` | logd while alive; legacy `append_event` when not | NDJSON, newest 50, legacy row shape |
| journal dir | `/usrdata/qmanager/journal/` | install.sh mkdir (0755); logd also creates | UBIFS |
| log day file | `journal/log-<epochday>.jsonl` | logd | epochday = floor(t / 86400) (UTC) |
| event day file | `journal/ev-<epochday>.jsonl` | logd | |
| state | `journal/state` | logd, `write_atomic` + fdatasync of file and dir | `seq=<n>`, `boot=<n>`, `boot_id=<uuid>`, `last_wall=<epoch>` lines |

Every path is overridable by env for tests and on-device trials: `QLOGD_RUN_DIR`, `QLOGD_JOURNAL_DIR`, `QLOGD_SOCK`, `QLOGD_PROTO`, `QLOG_FILE`, `QLOGD_EVENTS_MIRROR`, `QLOGD_UPTIME` (default `/proc/uptime`), `QLOGD_BOOT_ID` (default `/proc/sys/kernel/random/boot_id`).

## Spool line (writer → logd)

Tab-separated, LF-terminated, the message is always the **last** field (tabs inside it are kept):

```
L<TAB><mono><TAB><LEVEL><TAB><component><TAB><pid><TAB><message>
E<TAB><mono><TAB><type><TAB><severity><TAB><code><TAB><fields><TAB><message>
```

- `mono`: first field of `/proc/uptime` verbatim (`12345.67`). Unparsable → logd uses its own ingest mono.
- `LEVEL`: `DEBUG|INFO|WARN|ERROR` (anything else → INFO).
- `type`: `[a-z0-9_]{1,48}`, else the line is dropped and counted (`bad_lines`).
- `severity`: `info|warning|error` (anything else → info). `code` may be empty.
- `fields`: empty or `k=v;k=v` (k `[a-z0-9_]{1,32}`, v has no `;` `\t` `\n`; a malformed pair is skipped).
- A message with a newline was collapsed by the writer (`tr '\n' ' '`). logd also strips `\r` and control chars < 0x20 except tab.
- Line cap 4096 bytes (longer: truncated, `…[truncated]`). A last line without LF is accepted if it parses.

Writer gate (shell and broker): write the spool only when **both** `journal/` is a dir and `journal/alive` exists; otherwise the legacy path (direct `/tmp/qmanager.log` / events file). Shell never forks for this (builtin `[ -e ]`, `read` from `/proc/uptime`, `printf >>`).

## Journal row (JSONL, RAM ring and flash)

```json
{"s":1842,"b":7,"m":12345.67,"t":1794199490,"k":"L","lv":"WARN","c":"poller","p":7600,"msg":"…"}
{"s":1843,"b":7,"m":12350.02,"t":1794199494,"k":"E","type":"band_change","sev":"info","cat":"cellular","code":"","f":{"from":"B3","to":"B7"},"msg":"…"}
{"s":1844,"b":7,"m":12351.10,"t":1794199495,"k":"K","pri":3,"msg":"remoteproc-mss: fatal error …"}
```

`s` global seq (monotonic across restarts and reboots), `b` boot index, `m` mono seconds (2 decimals), `t` wall epoch seconds (integer) or `null` while the clock is untrusted. `code` and `f` are omitted when empty. Readers filter torn lines (a row must start with `{"s":` and end with `}`).

## Clock (port of `docs/features/history.md` §5)

`t = wall_now − (mono_now − m)` while trusted. Trusted = wall ≥ 1700000000 **and** wall ≥ newest-record-wall − 120 **and** (uptime ≥ 300 **or** a step already seen this boot). Newest-record floor at start = `state.last_wall` (written on every flush while trusted). A drift of `wall − (mono + offset)` beyond ±120 s re-anchors. Rows taken before trust keep `t:null` in RAM and are back-dated when trust arrives. Ordering is always by `s`.

## Flush (flash)

Batch in RAM, append to the day file, `fdatasync` that file only (never a global sync). Flush within 2 s of an ERROR line or an event with severity `warning`/`error`, at most one such flush per 120 s (so such a row is on flash within 120 s at worst; it is in the RAM ring and queryable at once), else every 5 min, and on TERM. A flush with no new persisted rows writes and syncs nothing; otherwise it syncs only the day files it appended to. The `state` file is rewritten on every flush but synced (file and directory) only at start, on TERM, and from the 5-min flush at most once per hour (a power cut that loses it is a new boot, and start rebuilds `seq`/`boot` from the flash rows plus the unclean gap). STAT `fsyncs` counts every sync issued, directory syncs included. Skip while `/usrdata` free < 8 MB (`statvfs`). Persist logs ≥ `persist_level` (default INFO), all events. Retention: logs 7 days and 1 MB total, events 31 days and 2 MB total, events 2000/day (past the cap only `signal_lost`/`signal_restored`/`internet_lost`/`internet_restored` and severity `error` are kept). Oldest day file goes first, never today's. Rows still `t:null` when they must be flushed go to the newest existing day file (or `epochday(state.last_wall)`, or day 0 file `…-0.jsonl` if nothing is known); readers order by `s`.

## Runtime config

init.d reads UCI `quecmanager.logging` and passes env to the daemon: `QLOGD_LEVEL` (min level kept, default INFO), `QLOGD_PERSIST_LEVEL` (default INFO), `QLOGD_FORWARD_SYSLOG` (0/1, ERROR to syslog via `libc::syslog`, no fork). Shell writers get `QLOG_LEVEL` as today. A live debug lease makes logd keep DEBUG and makes `qlog_debug` write (shell checks `[ -e journal/debug ]`).

## Socket (Phase 1: STAT; Phase 2: LOGQ, EVQ)

One request per connection, broker framing style: request `<VERB> <nbytes>\n` then nbytes of `k=v` pairs joined by NUL (0 bytes for STAT). Reply `RES <0|1> <nbytes>\n<json>` or `ERR <code>\n`. Body cap 4 KB; reply cap 1 MB. Client role `qlog` (argv0): `qlog stat`, `qlog logq k=v …`, `qlog evq k=v …` prints the JSON on stdout, exit 0; exit 3 with no stdout when logd is unreachable (callers fall back to the legacy path).
