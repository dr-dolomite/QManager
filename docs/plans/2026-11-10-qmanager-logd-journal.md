# QManager journal: `qmanager_logd` + unified events (plan)

> **Status: DRAFT 2026-11-10, awaiting approval.** Large change (new daemon, init.d, UCI section, install/uninstall/ipk lockstep). Nothing is built yet.

## 1. What we found (evidence, 2026-11-10, RM551E live + code)

### The write side is cheap. The read side and retention are the problems.

| Measure (live) | Value |
|---|---|
| `/tmp/qmanager.log` volume | 230 lines over 3.8 h (**about 61 lines/h, 5.4 KB/h**), INFO 223, WARN 7, ERROR 0, DEBUG 0 |
| Top writers | poller 98, sites 48 (`sweep: N of N answered`, every 5 min), ping 29, `cgi_system_settings` 19 (`Fetching system settings` on every GET), atd 11, `cgi_live_signal` 9 |
| `date` fork | 5.4 ms per call (builtin `printf` 0.05 ms). At 61 lines/h that is about **0.01 % of one core**: negligible |
| Daemon CPU (30 s sample) | poller 3.3 %, atd 0.6 %, ping 0.5 %, sites 0.07 % of one core (4 cores, load 1.5) |
| **`system/logs.sh` per request** | **0.15 s CPU on today's 20 KB log; 1.95 s on a 1.47 MB copy**. The Logs page polls it every 10 s with `include_rotated=1`, so at the real cap (256 KB × 3 = 768 KB) the page costs **about 10 % of a core while it is open**, more than the whole poller |
| Syslog ring | 64 KiB, holds **about 9 s** of history (Qualcomm `qms` writes about 57 lines/s). `grep -c qm_` = 0. Every `logger` fork QManager makes is wasted |
| Persistence | `/tmp/qmanager.log` and `/tmp/qmanager_events.json` are tmpfs: **gone after every reboot**, exactly when an unplanned reboot or AP hang needs explaining |

So the user's premise ("cut CPU like the broker and poller") holds only in part. **The logger's write path is not a CPU problem today.** The real costs are:

1. **The read side.** `logs.sh` reruns `cat | awk`, `sed | sort -u | jq`, `wc` ×2 and `jq` ×2 over every log file on every 10 s poll. Its cost grows with the file, unbounded by anything but rotation.
2. **Write storms.** Some sites fire every cycle while a condition holds: `qmanager_poller:1865` (`Ping data stale`, WARN, every 2 s, forks `date` + `$(conn_state_why)` + `logger`), `wd_detect.sh:107` (every 10 s), `qmanager_sms_forward:415` / `:140` (every 15 s), `qmanager_tower_failover:135` (every 20 s), `parse_at.sh:347` / `:1355`. Each line costs about 10 to 15 ms and floods the file.
3. **Events.** `append_event` (`events.sh:35`) forks `date`, `jq`, `wc`, then `tail` + `mv` once the 50-row cap is reached (a full rewrite on every event), then `qlog_info` (`date` + `logger`). That is about 6 to 7 forks (about 35 ms) per event. **It is unlocked**: the poller, watchcat, `qmanager_profile_apply`, `qmanager_config_restore` and three CGIs all append and trim the same file, so a trim in one can drop another's line.
4. **Retention.** Nothing survives a reboot except `crash.log` (20 lines) and the History day files.
5. **Fragmentation.** One outage is written to as many as five places: events NDJSON, the qlog `EVENT [...]` line, the History connection row, the alert engine's qlog line, and the SMS/email log. There are also two independent writers and rotators of `/tmp/qmanager.log` (shell `qlog.sh` and the broker's `common/log.rs`), direct `logger` calls in 13 places (init.d scripts, `tower_lock_mgr.sh`, `qmanager_mtu_apply`, `qmanager_sms_storage`), and private log files (`qmanager_update.log`, `qmanager_health_check.log`, `tailscale_install.log`, msmtp).
6. **No runtime control.** `/etc/qmanager/log_level` is read at service start by six init scripts, nothing writes it, and there is no UCI key or UI control. CGIs and one-shot tools always run at INFO.
7. **Missing events.** Many user-visible actions are recorded only as log text, or not at all: APN save, band/tower lock, band/tower failover, user SIM switch, user CFUN/airplane mode, IMEI write, DNS/TTL/MTU, login failure and lockout, software update, broker restart, data-CID change, RAT priority, FPLMN clear.

### What works and must not regress

- History (`history.md`): poller-hosted, builtins-only tick (about 1.5 ms/cycle), mono-clock anchor with trust rules, mergeable rows, pairing breaks, 71/71 tests. **Buckets stay exactly as they are.**
- The broker's lanes, the AT path and its proto 3 (`at-broker.md`). The logger must never be able to stall the AT lane.
- Event detection stays in shell (`poller-on-broker.md:286-288`: a Rust port of detectors "risks every downstream contract"; if Rust is ever used, it goes in a separate binary, never inside the broker). This plan follows that rule: **detectors stay in the poller; only storage, timestamping, persistence and queries move to Rust.**

## 2. Design

### 2.1 Shape: one journal daemon, shell writers that never fork

```
 shell writers (qlog_*, append_event)        qmanager_atd (Rust)
   printf >> spool  (0 forks)                  same spool line (no mutex/rotate)
            \                                    /
             v                                  v
   /var/run/qmanager/journal/spool   (tmpfs, O_APPEND, one line per record)
                          |
                inotify wake, rename -> spool.work, 100 ms grace, parse
                          v
                 qmanager_logd (Rust, same binary as qmanager_atd, argv0 role)
                 - assigns seq, maps mono -> wall (history §5 trust rules)
                 - dedup / repeat-collapse, per-component rate limit
                 - RAM ring (all levels incl. DEBUG)
                 - text mirror /tmp/qmanager.log (same format, same rotation)
                 - flash journal /usrdata/qmanager/journal/ (INFO+ logs, all events)
                 - query socket /var/run/qmanager_logd.sock (LOGQ, EVQ, STAT)
                          |
      qlog client (argv0 symlink)  <-  CGIs: system/logs.sh, fetch_events.sh, history/events.sh
```

**Why a spool file and not a socket:** a shell cannot write to a Unix socket without forking a client (about 5 ms, the same cost as `date`). `printf >> file` is a builtin. This is the `ext.spool` precedent (`history.md` §2), proven on this device: rename then read one grace period later, so a writer mid-`printf` always lands. A FIFO was rejected: opening one with no reader blocks the writer forever if logd is down.

**Why a separate process in the broker's binary:**
- *Not a lane inside `qmanager_atd`:* flash I/O, queries and parsing must never share a process with the AT lane, and the earlier design rule forbids event logic in the broker.
- *Not a new crate:* the binary already has `common/log.rs` (line format, rotation), `safefs` (atomic, O_NOFOLLOW writes), `json`, `proto`, libc-only and musl static. A new argv0 role (`qmanager_logd`, plus client `qlog`) reuses all of it, exactly like `qcmd` / `qsms` / `qmi`. Expected growth about 60 to 90 KB. The stale 640 kB ceiling (already exceeded at 669 kB) is reset to **800 kB**.
- *Not shell:* persistence with per-file `fdatasync` (BusyBox only has global `sync`), an indexed ring, dedup and server-side queries all cost forks or `awk` passes in shell.

### 2.2 Record format

Spool line (tab-separated, the message is always the **last** field, so tabs inside it are safe):

```
L<TAB><mono>  <TAB><LEVEL><TAB><component><TAB><pid><TAB><message>
E<TAB><mono>  <TAB><type> <TAB><severity><TAB><code><TAB><k=v;k=v><TAB><message>
```

- `mono` is the first field of `/proc/uptime` (for example `12345.67`), read with the builtin `read` (`mono_now_set` already does this). The writer never forks for time.
- A message containing a newline (rare: AT replies) is collapsed with one `tr` fork. That fork happens only on that edge, detected with a `case` on a newline variable.
- `k=v` fields (new, optional) carry structured data (`band=B3`, `pci=123`, `from=…`, `to=…`) so the UI can localise events from `type` + fields instead of showing English backend text. `message` stays as the fallback, so old types keep working unchanged.

Journal row (JSONL, in RAM and on flash):

```json
{"s":1842,"b":7,"m":12345.67,"t":1794199490,"k":"L","lv":"WARN","c":"poller","p":7600,"msg":"…"}
{"s":1843,"b":7,"m":12350.02,"t":1794199494,"k":"E","type":"band_change","sev":"info","cat":"cellular","f":{"from":"B3","to":"B7"},"msg":"LTE band changed: B3 → B7"}
```

- `s` is a global sequence number, monotonic across restarts (persisted high-water mark). `b` is the boot index (from `boot_id`). `t` is the wall time, or `null` until the clock is trusted, then back-dated.
- **Wall time is derived, never trusted from the writer.** logd computes `t = realtime_now − (boottime_now − m)` only while the clock is trusted, using the same rules as `history.md` §5: epoch ≥ 1700000000, not behind the newest record by more than 120 s, and uptime ≥ 300 s or a step already seen. Rows recorded before trust get `t` once the anchor is trusted. A step larger than ±120 s re-anchors. **Ordering is by `s` (ingest order), never by wall time**, which fixes today's out-of-order broker and poller lines around an SSR clock step.
- `cat` (category) is looked up from a type registry compiled into logd: `cellular | connection | system | config | security | lan | alerts`. Unknown types are kept with `cat:"other"`.

### 2.3 Storage, retention, flash budget

| Tier | Holds | Where | Bound |
|---|---|---|---|
| RAM ring | every record, DEBUG included | logd memory | 2560 records or 480 KB, whichever comes first (a full 4096-record ring measured 1.67 MB RSS against the 1.5 MB gate). Not reloaded on restart: older rows of the boot are read from the day files |
| Text mirror | the current boot's lines in today's format | `/tmp/qmanager.log` (+ `.1`, `.2`) | 256 KB × 3, written in 1 s batches. Kept so `qmanager_logread`, `qmanager_debug_report` and SSH greps work unchanged |
| Log journal | INFO+ lines | `/usrdata/qmanager/journal/log-<epochday>.jsonl` | 7 days, 1 MB; past 1 MB a day file keeps only WARN/ERROR and kernel lines, up to 256 KB more, and logs one WARN `daily log cap reached; keeping warnings, errors and kernel lines only` |
| Event journal | all events | `/usrdata/qmanager/journal/ev-<epochday>.jsonl` | 31 days, 2 MB, 2000/day (keep-list types past the cap, as in History); past 2 MB a day file keeps only keep-list and `error` events, up to 256 KB more |

**Flush policy:** batch in RAM, then append to the day file + `fdatasync` on that file only, never a global `sync`. Flush:
- within 2 s of any ERROR or any event of severity `warning`/`error`, coalesced to at most one flush per 120 s under a storm (the row is in the RAM ring, and queryable, at once);
- otherwise every 5 min;
- on TERM, as a final flush.

A flush with no new rows writes nothing; otherwise it syncs only the day files it appended to. The state file is rewritten on every flush but synced only at start, on TERM, and at most once per hour from the 5-min flush (2 syncs: file and directory). The target is at most 300 file syncs per day, about the same as Data Used's 5-min sync and below one 4 KiB page per flush at today's volume. An unplanned reboot or AP hang loses at most 5 min of INFO, and at most 120 s of ERROR lines and warning/error events. Flushing is skipped while `/usrdata` has under 8 MB free (the History rule), and torn last lines are filtered by the reader.

**Boots:** every row carries `b`, so the Logs page can show **"This boot / Previous boot"**: the lines that led up to an unplanned reboot finally survive it.

### 2.4 Hygiene: rate limits and noise

- **Repeat-collapse in logd:** an identical (component, level, message with digits stripped) template repeating within 60 s is stored once, followed by `… repeated N times in 60 s` when the run ends. A storm can no longer flood the ring or the flash.
- **Per-component rate limit in logd:** a token bucket of 100 lines/s with a burst of 500, so a sustained 100/s storm loses nothing. Past it, lines are dropped and counted, and the storm leaves one WARN row `rate limit: dropped N lines in D s` once it has been quiet for 10 s. A storm still dropping when a timed flush or TERM comes is reported then, with ` (still dropping)`, so drops never go unrecorded on flash.
- **Edge-only at the writer** for the hot sites listed in §1: `qmanager_poller:1865`, `wd_detect.sh:107`, `qmanager_sms_forward:415/:140`, `qmanager_tower_failover:135`, `parse_at.sh:347/:1355`. Each logs on entering and leaving the condition (with the duration on leave), not every cycle.
- **Demote per-request INFO to DEBUG:** `bands/current.sh:47`, `monitoring/connection_quality.sh:112`, `monitoring/watchdog.sh:180`, `monitoring/alerts.sh:114`, `system/settings.sh` (`Fetching system settings`), `cellular/live_signal.sh:108`. Sites logs its sweep summary at INFO only when the answered count changes.
- **Syslog:** `qlog.sh` stops forking `logger`. logd optionally forwards ERROR to syslog itself, with no fork (UCI `forward_syslog`, default off). Fold the 13 direct `logger` bypasses into `qlog_*`.

### 2.5 Runtime control

UCI `quecmanager.logging` (new section, seeded by `install.sh`):

| Option | Default | Meaning |
|---|---|---|
| `level` | `INFO` | minimum level written to the journal |
| `persist_level` | `INFO` | minimum level kept on flash |
| `forward_syslog` | `0` | logd copies ERROR to syslog |

Plus a **debug lease**: the Logs page offers "Debug logging for 30 minutes". The CGI touches `/var/run/qmanager/journal/debug`, and logd removes it on expiry. `qlog_debug` writes when `QLOG_LEVEL=DEBUG` **or** `[ -e …/debug ]` (one `stat`, no fork), so every long-lived daemon picks it up without a restart. This replaces the never-written `/etc/qmanager/log_level`, which is migrated once and then retired.

### 2.6 Shell API: drop-in, so 157 files need no edits

`qlog.sh` keeps every public name (`qlog_init`, `qlog_debug/info/warn/error`, `qlog_state_change`, `mono_now*`, `record_planned_reboot`). New body:

```sh
_qlog_write() {              # level gate unchanged (builtins)
    ...
    if [ -d "$_QLOG_SPOOL_DIR" ]; then         # cached at qlog_init
        { read -r _ql_m _ql_r < /proc/uptime; } 2>/dev/null
        printf 'L\t%s\t%s\t%s\t%s\t%s\n' "$_ql_m" "$level" "$_QLOG_COMPONENT" "$$" "$message" \
            >> "$_QLOG_SPOOL_DIR/spool" 2>/dev/null && return
    fi
    _qlog_write_legacy "$level" "$message"     # today's code: logd absent -> nothing lost
}
```

`append_event` becomes one `printf >>` to the same spool plus the existing `hist_event` call (unchanged in Phases 1 and 2). The `jq`, `wc`, `tail` and `mv` go away, and so does the race. `append_event` gains an optional 5th argument of `k=v` fields. The broker's `common/log.rs` writes the same `L` line to the spool, falling back to its current direct write.

**Spool safety when logd is dead:** logd removes `journal/alive` on stop. Writers check `[ -e alive ]` (one `stat`) and fall back to the legacy path. If logd is killed without cleanup, procd respawns it in 5 s and it drains what was queued. Backstop: the poller checks the spool size once a minute (one `wc -c` fork per minute) and truncates it above 1 MB.

### 2.7 Query side

`qlog` client role (argv0 symlink), talking to `/var/run/qmanager_logd.sock` with the broker's framing conventions (one request per connection, length-checked, `SO_PEERCRED` uid 0):

| Verb | Filters | Answers |
|---|---|---|
| `LOGQ` | `min_level`, `component`, `search` (case-insensitive substring), `boot` (`this`/`prev`/n), `before`/`after` seq, `limit` ≤ 500 | entries + `available_components` + severity counts + latest problem + stats, **in today's `logs.sh` JSON shape** plus additive fields (`seq`, `boot`, `head_seq`) |
| `EVQ` | `types`, `cat`, `after`/`before` seq, `since`/`until` wall, `limit` | events (today's `NetworkEvent` shape + `seq`, `cat`, `f`) |
| `STAT` | — | counts, sizes, flush stats, drops, version |

CGIs become thin: `system/logs.sh` turns into an auth check plus one `qlog` exec. The expected cost is **about 15 ms instead of 150 ms to 1 s**. The Logs page and the Recent Activities card send `after=<head_seq>` and get back only what is new (usually nothing). Each CGI keeps its legacy code path, behind a check that the `.proto` capability file exists, until the new path has soaked.

### 2.8 Events: one store, then richer history

- **Phase 2:** logd *is* the Network Events store (31 days on flash instead of 50 rows in RAM). `/tmp/qmanager_events.json` is still written, as a mirror of the newest 50 rows, for one release. History keeps getting events through `hist_event` / `ext.spool` (unchanged).
- **Phase 3 (decision point):** `history/events.sh` reads events from `qlog EVQ`, emitted as the same `k:"e"` lines it parses today, so **the validated `awk` pairing stays byte-for-byte**. The poller stops writing `k:"e"` rows and `ext.spool` retires. History day files then hold only buckets and restart rows. Result: one event store, one retention policy, one cap. Gate: `tools/history-test` 71/71 and `system-test` 51/51 against the logd-backed reader.
- **Kernel capture (Phase 4):** logd reads `/dev/kmsg` (a stream, no fork, sequence-numbered). It keeps a small, persisted, filtered set (`remoteproc-mss fatal error`, oom-killer, thermal trip, eth link up/down, watchdog/panic) as `k:"K"` rows, and emits system events from them. This replaces the `dmesg | grep | tail` fork in `history_series_system.sh` and gives the System/Kernel tab real history that the 9 s syslog ring cannot.

**New event catalogue (candidates; you pick in Q4).** Each has a known emit point (`file:line` from recon):

| Page | New events |
|---|---|
| Cellular | `apn_changed` (`cellular/apn.sh:240`), `band_lock_changed` (`bands/lock.sh`), `tower_lock_changed` (`tower/lock.sh:119,139,181`), `band_failover` / `tower_failover` fired + reverted (`qmanager_band_failover:85-153`, `qmanager_tower_failover`), `sim_switched` by user (`cellular/settings.sh:430-467`), `airplane_mode` from user vs inferred, `registration_changed` (operator / roaming, tier-2 COPS), `imei_changed` (`cellular/imei.sh:98`), `rat_priority_changed` (`network_priority.sh:77`), `fplmn_cleared`, `scenario_switched` (`scenarios/activate.sh:80`) |
| Connection | `wan_address_changed` (IPv4/IPv6, QMI WDS), `data_call_dropped` / `restored` (QMI WDS state), `data_cid_changed` (`apn.sh:171`), `dns_changed` (`network/dns.sh:170`), `ttl_mtu_changed`, `dns_failing` / `recovered` (DNS sidecar), `site_down` / `site_up` (Sites), `vpn_up` / `vpn_down` (Tailscale/Netbird), `eth_link_up` / `down` + speed (`qmanager_eth_link`), `speedtest_completed` (result in `f`) |
| System Health | `broker_restarted`, `qmi_lane_down` / `up`, `daemon_restarted` (logd sees a new pid's start line), `oom_kill` (kmsg), `storage_low`, `software_updated` (from → to), `clock_synced` / `clock_stepped`, `login_failed` / `login_locked` (`cgi_auth.sh:482-490`), `password_changed`, `watchdog_auto_disabled`, `alert_send_failed` (SMS/email logs) |

The frontend renders by `type` with i18n keys in all five catalogs and `f` fields interpolated, falling back to `msg`. New types are added to the right `HIST_<id>_EVENTS` lists, and pairs (`site_down:site_up`, `data_call_dropped:restored`, …) to `HIST_<id>_PAIRS`.

## 3. Phases and build order

| Phase | Scope | Size | Who |
|---|---|---|---|
| **0. Quick wins (no new daemon)** | edge-only fixes for the 7 hot sites, the 6 INFO→DEBUG demotions, drop the `logger` fork from `qlog.sh`, `flock` around `append_event`'s append + trim, baseline measurements (`measure.sh` poller, `logs.sh` timing, fork counts) | small; ships alone and helps even if the rest is never built | Sonnet backend-writer, then validator |
| **1. `qmanager_logd` core** | Rust role: spool ingest (inotify + rename/grace), parser, seq, clock anchor, ring, repeat-collapse, text mirror, flash journal + flush policy, `alive`/debug files, `STAT`; broker `log.rs` → spool; `qlog.sh` / `append_event` spool path with legacy fallback; init.d `qmanager_logd` (START=97, before atd), UCI `logging`, install/uninstall/ipk lockstep | large | Opus orchestrates; Sonnet (high) writes the Rust with Opus review of clock + flush; backend-writer does the shell/lifecycle; validator does device checks |
| **2. Query + read side** | `LOGQ`/`EVQ`, `qlog` client, `logs.sh` / `fetch_events.sh` thin, cursors in `use-system-logs.ts` / `use-recent-activities.ts`, Logs page: boot selector + debug lease (Impeccable, canon rules), events mirror file | medium | main session for the UI |
| **3. Events unification + catalogue** | `history/events.sh` reads `EVQ`, retire `k:"e"` + `ext.spool`, structured `f`, the chosen new events + i18n ×5 + history type lists/pairs | medium–large | backend-writer + main session UI |
| **4. Kernel capture** | `/dev/kmsg` reader, filtered persistent rows, kmsg-derived system events, System/Kernel tab history | medium | Sonnet Rust + validator |

Phases 1 → 2 → 3 depend on each other. 0 and 4 stand alone (4 needs only Phase 1).

## 4. Targets and gates

| Gate | Target |
|---|---|
| logd idle CPU | ≤ 0.2 % of one core; wakes only on inotify and the flush timer |
| logd storm | 100 lines/s for 60 s: ≤ 3 % of one core, no record loss below the ring bound |
| logd RSS | ≤ 1.5 MB |
| Shell write cost | 0 forks per line or event (except the newline edge) |
| `logs.sh` request | ≤ 30 ms at a full ring (today 0.15 s at 20 KB, about 1 s at the cap) |
| Poller | `tools/poller-parity/measure.sh`: no regression (active ≤ +0.1 pt), all parity scripts zero-diff |
| History | `history-test` 71/71, `system-test` 51/51 unchanged (Phase 3 with the logd reader) |
| Flash | ≤ 300 file syncs/day, ≤ 1 MB/day written at today's volume |
| Binary | ≤ 800 kB stripped |
| Fallback | logd stopped: every writer falls back to the legacy file, nothing hangs, nothing is lost |

## 5. Risks and rollback

| Risk | Mitigation |
|---|---|
| logd crash or hang | writers never block (an append to a regular file); `alive` check + legacy fallback; procd respawn; poller spool backstop |
| A logd bug affects the AT path | separate process; the broker only appends a line to a file (no socket, no lock) |
| Wrong wall time | the history §5 trust rules reused verbatim, with unit tests ported from `history-test` clock cases; `t:null` until trusted; order by `s` |
| Flash wear / fill | §2.3 budget, per-file `fdatasync`, caps, 8 MB free guard, repeat-collapse |
| Logs page contract | `LOGQ` answers today's JSON shape; new fields are additive; legacy CGI path behind a capability check for one release |
| Events contract | `NetworkEvent` shape kept; `f`/`cat`/`seq` additive; events mirror file for one release |
| Lifecycle drift | one checklist: init.d, symlinks (`qmanager_logd`, `qlog`), UCI seed, `/usrdata/qmanager/journal` mkdir, `/var/run/qmanager/journal` cleanup in stop + uninstall, `--purge`, ipk manifest |

**Rollback:** `/etc/init.d/qmanager_logd disable && stop`. `qlog.sh` and the CGIs then fall back to the legacy paths on their own, and the journal is inert data. Phase 0 rolls back per commit.

## 6. Validation

- **Rust:** unit tests for the spool parser (tabs, torn last line, newline edge), ring eviction, repeat-collapse, clock anchor (cases ported from `history-test`), flush policy, query filters; the `fake` harness pattern from `qmi/`.
- **Shell:** `.claude/check-crlf.sh`, `sh -n`, BusyBox/POSIX audit, `jq` without regex.
- **On device (read-only unless you OK it):** deploy + `sync`; logd idle and storm CPU; poller `measure.sh` before/after; `logs.sh` latency before/after; `kill -9` logd → fallback, then respawn → drain; spool backstop; a planned reboot to check "Previous boot" survival (**your OK needed**); a real SSR when one occurs.

## 7. Questions for you

1. **Process:** separate `qmanager_logd` process inside the broker's binary (recommended), or a lane inside `qmanager_atd`?
2. **Flash:** persist INFO+ logs for 7 days (recommended, about 130 KB/day today), or WARN+ only?
3. **History events move to logd in Phase 3** (one store; History keeps only buckets)? Recommended, behind the history-test gates.
4. **New events:** which rows of the catalogue in §2.8 first? My pick: Cellular `apn_changed`, `band_lock_changed`, `tower_lock_changed`, failover fired/reverted, `sim_switched`; Connection `data_call_dropped/restored`, `wan_address_changed`, `site_down/up`, `eth_link_*`; System `broker_restarted`, `software_updated`, `login_locked`, `oom_kill`, `clock_stepped`.
5. **Phase 0 first** as its own small change while Phase 1 is built? Recommended: it is independent and removes the storms now.
