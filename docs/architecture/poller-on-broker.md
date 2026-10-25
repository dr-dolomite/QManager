# Poller on the AT broker: architecture and roadmap

**Status:** phases A, B and C built, deployed and measured (see
[Status (2026-10-19)](#status-2026-10-19)); phase D wiring not built. Written
2026-10-19 (Opus 5.5 High planning pass); the sections below are the plan as
approved, not rewritten.
**Ledger:** refines and supersedes the phase list of row **B5.29** in
[`docs/rm520n-port-ledger.md`](../rm520n-port-ledger.md). The B5.29 targets
stay as the gates.
**Scope:** `qmanager_poller` and its libraries, `qmanager_atd` / `qcmd`, the
status cache contract. Size: **large** (AT path, init.d, daemon lifecycle).

Related canon: [`at-broker.md`](../features/at-broker.md),
[`adaptive-polling.md`](../features/adaptive-polling.md),
[`connection-quality.md`](../features/connection-quality.md),
[`connection-watchdog.md`](../features/connection-watchdog.md),
[`ondemand-radio-details.md`](../features/ondemand-radio-details.md),
[`alerts.md`](../features/alerts.md), [`sms.md`](../features/sms.md),
[`safe-tmp.md`](../reference/safe-tmp.md), and the B5.29 branch
`claude/happy-antonelli-6c2e7a` (`tools/poller-parity/`).

## Status (2026-10-19)

**Phases A, B and C are deployed on the RM551E and measured. Phase D wiring
was not built (decided 2026-10-19).** A+B+C already meet the active gate, and
D would save about 1-2 % in the active tier only. The Rust parsers and the env
writer (`native/qmanager_atd/src/poll/`) were kept parked behind the off-by-default
`poll` cargo feature and then **removed on 2026-10-25** (still in git history; see
`docs/features/at-broker.md`). The `POLL`
verb, the `qcmd --poll` client, the poller fallback and the `poll_legacy`
marker of Section 14 were not built; Sections 4, 5 and the Phase D text
describe a design that is not in the product. Proto number 3 is now the QMI lane
(broker 0.3.0, see `docs/features/qmi-lane.md`); number 4 stays unassigned. The 12 h soak on this build passed (2026-10-19 10:22 to 2026-10-20
01:30 PHT; see the Soak entry in Section 14 notes and the ledger row B5.29).

Measured after A+B+C (poller CPU including children, one core):

| Tier | CPU | System forks/s | `status.json` period | `.mono` age max |
|---|---|---|---|---|
| Active | 4.92 % | ~11.5 (about 23 per cycle) | 2.00 s (1.92-2.22) | 2 s |
| Deep | 2.62 % | 7.3 | 2.00 s | 2 s |
| Baseline before B5.29 (Section 2.2) | active 39 %, idle 22-25 % | 183 / 74-87 | 3.7 s | 4 s |

Idle was not re-measured after C. Gates met: active at most 10 %, period 2.0 s
plus or minus 0.2, `.mono` age under 3 s.

Fault injections (Section 8):

| Fault | Result | Gate |
|---|---|---|
| Lock held 15 s (`flock` on `/var/lock/qmanager.lock`) | `.mono` age max 5 s, longest period 4.42 s | under 6 s, at most 4.5 s |
| Natural baseband SSR inside that window | within the same gates; the wall clock stepped back about 80 s and forward again, so log times around an SSR are out of order | |
| Broker `kill -9` | procd respawned it in 5.2 s, period max 2.21 s, `.mono` age max 2 s; `qcmd` ran in-process while the socket was dead | |

Deviations from the plan:

- **The poller passes the cap by environment variable, not `-t`.** It runs
  `QCMD_WAIT_MS=2500 qcmd <cmd>` per call. An older `qcmd` ignores an unknown
  variable, but would send `-t` to the modem as an AT command. As a result the
  `/var/run/qmanager_atd.proto` gate of Section 5.6 is not needed by the
  poller; the file exists and now carries `proto=3` / `qmi=1` for the QMI lane; a
  `POLL` verb (would be proto 4) is not planned.
- **A per-cycle busy latch was added** after the lock-hold test. The cap bounds
  one read, so with the lock held for 15 s each of the four reads waited 2.5 s
  and a cycle took 12 s. Now the first busy read of a cycle sets a latch and
  the cycle's remaining reads return rc 3 (not run), which keeps the existing
  serving-cell and `QCAINFO` busy semantics. After the fix the longest period
  was 4.42 s.
- **The safety net composes the same cycle with jq** instead of keeping the
  previous file when `jq empty` fails; the previous file is kept only when a
  composer fails to write.

## Contents

1. [ELI5: the end state](#1-eli5-the-end-state)
2. [Current state](#2-current-state)
3. [Options for the hot loop](#3-options-for-the-hot-loop)
4. [Target architecture](#4-target-architecture)
5. [Broker protocol additions](#5-broker-protocol-additions)
6. [status.json ownership map and consumers](#6-statusjson-ownership-map-and-consumers)
7. [URCs and change-driven polling](#7-urcs-and-change-driven-polling)
8. [Failure isolation](#8-failure-isolation)
9. [Scheduling policy inside the broker](#9-scheduling-policy-inside-the-broker)
10. [Memory and binary-size budget](#10-memory-and-binary-size-budget)
11. [What not to merge](#11-what-not-to-merge)
12. [Per-core use](#12-per-core-use)
13. [Durability](#13-durability)
14. [Phased roadmap](#14-phased-roadmap)
15. [Decisions for the user](#15-decisions-for-the-user)
16. [Evidence log](#16-evidence-log)

---

## 1. ELI5: the end state

The poller is a clerk who, every 2 seconds, asks the modem how the signal is,
writes the answers on a whiteboard (`status.json`), and keeps an eye on
whether the internet is up. Today the clerk is slow because for every answer
he hires dozens of temporary helpers (forks) to cut the answer into pieces,
and each hire costs a few milliseconds. He also sometimes queues behind a
customer who is stuck at the counter, and then the whiteboard stops updating.

In the end state:

- The **broker** (the one person allowed to talk to the modem) gets a new
  service: "here is my shopping list for this round". It asks the modem all
  of the list's questions in one go, with nobody cutting in between, and hands
  the raw answers back.
- The clerk's own **reader** (the `qcmd` program, same code as the broker)
  turns those answers into a tidy list of `name='value'` lines, and the clerk
  reads that list in one gulp. No helpers.
- The clerk writes the whiteboard himself, without the expensive `jq` helper.
- The clerk never waits more than about 2.5 seconds for the broker. If the
  broker is busy or stuck, he writes the board anyway with the last good radio
  values and a "modem not answering" note, so the watchdog and the web page
  always see a fresh board.
- What the board says, and when, stays exactly the same.

Result, estimated: the poller drops from about a third of a CPU core to a few
percent, the board really updates every 2 seconds, and a stuck modem command
can no longer freeze the board.

---

## 2. Current state

### 2.1 Diagram (development-home, v0.1.32-draft)

```
                  browser / integrations
                         │  GET every ~2 s (useModemStatus), 15 s (watchdog indicator)
                         ▼
   uhttpd ── at_cmd/fetch_data.sh ──┐ writes /tmp/qmanager_ui_active (heartbeat)
            public/overview.sh  ────┤ cat / jq status.json
            cellular/radio_details.sh ── qcmd (CGCONTRDP, QMAP, TA, MIMO) ──┐
            other CGIs (AT Terminal, band lock, scans, SMS via qsms) ───────┤
                                                                            ▼
  ┌──────────────── qmanager_poller (BusyBox sh, one process) ───────────┐  │
  │ every cycle (all tiers):                                             │  │
  │   update_proc_metrics · read_ping_data (conn_state jq) ·             │  │
  │   read_dns_data (jq) · detect_data_connection_events (events.sh) ·   │  │
  │   alert_engine_check · tier decision · write_cache (jq -n, 124 args) │  │
  │ AT-due cycles: qcmd QENG │ QCAINFO │ CFUN? │ QRSRP;QRSRQ;QSINR       │  │
  │   (+ COPS;QUIMSLOT;CNUM;CPIN every 15 active cycles)                 │  │
  │   each reply → parse_at.sh (cut/grep/awk/sed pipelines)              │  │
  └───────┬─────────────────────────────────────────────┬───────────────┘  │
          │ fork+exec qcmd per AT call                   │ writes           │
          ▼                                              ▼                  │
  qmanager_atd (Rust, 1 thread, FIFO accept loop) ◀──────────────────────────┘
     │ flock /var/lock/qmanager.lock, one exchange at a time
     ▼
  /dev/smd11 (glink AT channel, blocking fd)       /tmp/qmanager_status.json
                                                    ├─ watchcat (.mono, .connectivity)
  qmanager_ping (sh) → ping.json, ping_history,     ├─ tower_failover (.lte/.nr.rsrp)
                       dns.json                     ├─ band_failover, health check,
  qmanager_sites (sh) → sites cache                 │  config backup, about, IPPT…
                                                    └─ frontend (16 consumers)
```

### 2.2 Measured cost (RM551E, poller md5 `2567d7ec…`, 2026-10-19)

From the overnight baseline monitor (`/usrdata/b529_mon/mon.log`, 60 s
windows every 5 min) and spot measurements taken read-only in this pass:

| Metric | Active (6/6 samples) | Idle-dominated windows | Source |
|---|---|---|---|
| Poller CPU (with children) | **39 %** of one core | **22–25 %** | mon.log |
| System forks/s | 183 | 74–87 | mon.log |
| Forks per cycle (system-wide upper bound) | 684 | 193–240 | mon.log `fpc` |
| status.json period | 3.73 s (3.35–4.12) | 2.6–2.8 s avg, max 3.9 | mon.log |
| `.mono` age max | 4 s | 4 s | mon.log |
| Broker | 288 kB RSS, 1 thread, ~0.1 % | | `/proc`, at-broker.md |

Unit costs measured on the device in this pass (20-run loops):

| Operation | Cost |
|---|---|
| fork+exec of any small binary (`/bin/true`) | **~5 ms** |
| `$(printf … \| cut …)` | ~5 ms |
| one `jq` over status.json (5.5 kB) | **~15 ms** |
| `qcmd AT` end to end (client exec + broker + modem) | **~4.5 ms** |
| `$(qcmd 'AT+QENG="servingcell"')` | ~5 ms |

`top` at the same moment: 10 % usr, **25 % sys**. Fork/exec and page-fault
work is kernel time, so most of the poller's cost shows up as `sys`.

### 2.3 Where the forks go (hand count, `qmanager_poller` 1825 lines)

| Function | Forks, no-AT path (every cycle) | Forks, active AT cycle | Main culprits |
|---|---|---|---|
| `update_proc_metrics` | 18 | – | `$(echo\|awk)`, `$(grep\|awk)`, `$(cat\|cut\|cut)` |
| `read_ping_data` + `conn_state_read` | ~3 | – | jq on ping.json, awk over the ping ring |
| `read_dns_data` | 2 | – | jq |
| `detect_data_connection_events` | 2 | – | `echo\|awk` float compare |
| tier decision | 5 | – | `$(cat\|tr)`, `$(date)` |
| `update_conn_uptime` | 2 | – | `date` |
| `write_cache` | 8 (+38 when the on-demand cache exists) | – | `date`, `mono_now` (4), `jq -n`, `mv`; `load_ondemand_cache` jq + 12 `printf\|sed` |
| main `sleep` | 1 | – | |
| `poll_serving_cell` + `parse_serving_cell` | – | ~64 (LTE/SA), ~102 (EN-DC) | 25+ `$(printf\|cut)`, `_hex_to_dec` |
| `QCAINFO` + `parse_ca_info` | – | **~185** | per-line sed/tr/cut chains, tmp files, `jq -Rs` |
| per-antenna + `append_signal_history` | – | ~101 (EN-DC ~161) | `_antenna_line_to_json` 21 forks/line |
| `CFUN?` | – | 10 | 6-stage pipeline |
| `detect_scc_pci_changes` | – | ~32 | fires most cycles: it compares the carrier string, which includes RSRP |
| Tier 1.5 (watchcat state, temperature), Tier 2 identity | – | ~100 per 5 / 15 cycles | `printf\|cut`, per-zone `cat` |
| `qlog` per INFO line | ~7 each | | level subshells, `date`, `wc -c`, `logger` |

Totals: about **42 forks on every cycle** with no AT at all, plus about **415
on an active AT cycle** (about 490 counting `qcmd`'s own). At ~3.5 ms per
fork on average that is ~0.3 s of CPU per idle cycle and ~1.5 s per active
cycle, which with a 3.7 s period matches the measured 39 %.

### 2.4 What B5.29 Phase 1 already proved

Phase 1 (shell-only single-pass parsers, fork-free local path, fixed-clock
cycle, no `SIP_DELAY`) is built on `claude/happy-antonelli-6c2e7a` at
`cd1ec5dc`. Its first windows on 2026-10-18 (internet down at the time):
**active 11.5 %, 1.99 s period; idle 4.6 %, 2.00 s**. The 12-hour numbers
were lost (scheduled 04:00 reboot wiped `/tmp`, then a reinstall), and the
redeploy at 06:45 ended in an AP hang and 0-byte files (Section 13). So the
shell alone gets close to the active target but not to the idle one. The
remaining idle floor is mostly the three `jq` runs per cycle (~45 ms, about
2.3 % of a core) plus residual forks.

### 2.5 Defects found while mapping (fix regardless of the end state)

| # | Defect | Effect | Fix in phase |
|---|---|---|---|
| D1 | `write_cache` runs `jq … > tmp` then `mv` unguarded | a jq failure (for example a non-numeric `--argjson`) **replaces status.json with a 0-byte file** | A |
| D2 | **The poller blocks behind any stuck broker request.** Live, this pass: three non-AT strings sent through `qcmd` by mistake each hit the broker's 20 s deadline; the poller's `QENG` queued 16 s and `QCAINFO` 20 s, and the monitor logged `mono_age_max=40`, `status_period max=39.78` (watchdog limit 30 s) | watchdog treats quality as "no signal"; UI shows stale | B |
| D3 | `qcmd` forwards any string, including non-AT text, to the modem, which then never terminates (20 s deadline, channel resync) | one typo in a caller costs 20 s of modem time for everyone | B (decision 3) |
| D4 | `cycle_count` does not advance on the scan / SIM-switch early return | `cycle % 5` ping-history cadence runs every cycle or never during a scan | A |
| D5 | Idle cadence is `cycle % 7` (15/2 in integer math), so 14 s, not the configured 15 s / 30 s grain | small drift from the documented contract | A (document, or round) |
| D6 | Tier age uses wall clock (`date` vs heartbeat epoch) | a NITZ/ntpd step can flip tiers for a cycle | A: ignore negative or >1 day ages |
| D7 | `detect_scc_pci_changes` keys on the whole carrier string (includes RSRP) | ~32 forks on most active cycles for nothing | A |
| D8 | `last_successful_poll` always equals `timestamp`, even when the modem is unreachable | misleading field | keep (contract), document |

---

## 3. Options for the hot loop

| | (a) Phase 1 shell only | (b) Shell clock + broker `POLL` batch | (c) Broker writes the AT part of status.json | (d) Full Rust poller |
|---|---|---|---|---|
| Who runs the clock and tiers | shell | shell | shell for the rest; broker for AT cadence (needs tier signal) | Rust |
| Who parses AT | shell (`parse_at.sh`, single-pass) | Rust, **in the `qcmd` client process** | Rust in the daemon | Rust |
| Who writes status.json | shell (jq, or printf after Phase C) | shell (printf) | two writers or a merge step | Rust |
| Events, alerts, reconcilers | shell | shell | shell | Rust port of events.sh (32 kB), alert_engine/routing (34 kB), conn_state (shared with watchcat), history, IPPT, SIM db |
| Est. active CPU | 9–12 % (measured 11.5 % before Phase C) | **2–5 %** | 2–4 % | ~1 % |
| Est. idle/deep CPU | 2–3 % after Phase C, 4.6 % before | **1–2 %** | 1–2 % | <1 % |
| Forks per active cycle | ~20–40 | **~4** (`qcmd`, `date`, `sleep`, `mv`) | ~3 | 0 |
| Latency (period, mono age) | 2.0 s if nothing stalls; stalls up to 20 s per stuck request (D2) unless B lands | 2.0 s; AT wait capped at 2.5 s | 2.0 s; shell never waits on AT | 2.0 s |
| Risk | low; parity proven by harness | medium: new verb, Rust parsers need bug-for-bug parity | high: two writers of one contract, AT cadence logic duplicated in Rust, broker liveness now gates the heartbeat | very high: months of porting, all of it parity-sensitive; one panic takes the whole status path |
| Schedule (build + soak) | done; redeploy + 1 soak | +1–2 weeks after A–C | +2–3 weeks | +6–10 weeks |
| Reversibility | instant (file restore) | instant: poller falls back to Phase-A shell parsers per cycle; broker binary restore | hard: contract split must be unwound | hard |

### Recommendation

**End state: (b), with two refinements.**

1. **Parse in the client, exchange in the daemon.** The daemon only runs a
   closed, named list of read-only AT steps under one lock hold and returns
   the raw replies. The short-lived `qcmd --poll` process (same binary) parses
   them and writes an eval-safe env file. A parser bug or panic then kills
   one client process, never the broker that every CGI depends on, and the
   daemon's new code stays tiny.
2. **The shell keeps the clock, the tiers and sole ownership of
   status.json**, but composes it without `jq` (Phase C), because after the
   AT work moves out, `jq` is the largest remaining per-cycle cost in every
   tier.

Why not (c): it saves at most two forks per cycle over (b) but couples the
watchdog heartbeat to broker liveness. Today a broker crash and a poller crash
are independent; under (c) a broker problem freezes the AT path *and* the
whiteboard together, which is exactly what the watchdog exists to notice.
Why not (d): the remaining cost after (b) is a handful of forks, and porting
the event and alert logic risks every downstream contract for about one
percent of a core. Reconsider (d) only if (b) misses the gates, and then as a
separate binary (`qmanager_polld`), never inside the broker.

Order: **A → B → C → D**, each shippable and parity-gated on its own; E
(change signals) is optional and data-gated. See Section 14.

---

## 4. Target architecture

```
  CGIs ─ heartbeat ─▶ /tmp/qmanager_ui_active
                                  │
  ┌───────────── qmanager_poller (sh) ───────────────────────────────────┐
  │ clock: fixed 2 s (sleep = 2 s − elapsed), tier from heartbeat + flags│
  │ every cycle: proc metrics (read builtins) · . ping.env/dns.env       │
  │   (sidecars) · events.sh · alert engine · write status.json (printf, │
  │   tmp + mv) · canary jq validation every 30 cycles                   │
  │ AT-due: qcmd --poll <steps> --cap 2500 --out $RUN/poll.env           │
  │         && . $RUN/poll.env   (one fork, zero parsing in shell)       │
  └───────────┬───────────────────────────────────────────────────────────┘
              │ exec
              ▼
  qcmd --poll  (client process, Rust)
     │ 1. long flag? → write qm_poll_rc=scan_in_progress, exit 1 (no connect)
     │ 2. socket: POLL request (named steps, cap)        ┌──────────────────┐
     │ 3. waits ≤ cap; on cap: drop socket, rc busy      │ fallback: run the │
     │ 4. parse raw replies (poll/parse.rs, panic-free)       │ same Session in-  │
     │ 5. write poll.env.<pid> → rename (O_NOFOLLOW)     │ process if never  │
     ▼                                                   │ delivered         │
  qmanager_atd (daemon, unchanged loop)                  └──────────────────┘
     POLL: one lock hold (exec::Session), closed step table,
           per-step deadline 3 s, batch deadline = sent + cap,
           returns [(step, status, raw)] — no parsing, no state
     │
     ▼ /dev/smd11

  qmanager_ping (sh) → ping.json + ping.env sidecar (additive)
  ondemand_radio.sh  → ondemand.json + ondemand.env sidecar (additive)
```

Responsibilities after D:

| Concern | Owner | Notes |
|---|---|---|
| Cycle clock, tiers, force flags, SIM-switch quiesce | poller (sh) | unchanged semantics |
| Which AT steps run per tier | poller (sh) | passes step names; Invariants 6/7 enforced twice: the shell picks, the broker's closed table cannot express the forbidden commands |
| AT strings, exchange, lock, deadlines | broker daemon | new `POLL` verb only |
| Parsing AT replies | `qcmd --poll` client (Rust `poll/parse.rs`) | bug-for-bug parity with `parse_at.sh` |
| status.json write, `.mono`, `.timestamp`, `poller_tier` | poller (sh) | sole writer |
| Events, alerts, reconcilers, histories | poller (sh) | unchanged |
| `parse_at.sh` | stays | other callers (`radio_details.sh`, `apn_mgr.sh`, `ondemand_radio.sh`, `qmanager_profile_apply`) and the poller's fallback path |

---

## 5. Broker protocol additions

All additions are new request kinds or new client flags. The frozen `qcmd`
raw / `-j` output contract (about 50 callers) does not change.

### 5.1 `POLL` request (client → daemon)

```
POLL <nbytes> <sent_ms>\n
v=1 cap=<ms> steps=<step>[,<step>…]\n
```

- `sent_ms` is `CLOCK_MONOTONIC` ms, as in `REQ`, so queue time counts.
- `cap` is the total budget from `sent_ms` (default 2500, max 4000).
- `steps` comes from a **closed table** compiled into the binary. Unknown
  step, duplicate step, more than 8 steps, or `v` not 1: refused
  (`ERR command_failed`, logged `refused POLL: …`). Initial table (read-only
  queries only, exactly today's poller set):

| Step | AT sent | Today's parser | Tiers |
|---|---|---|---|
| `qeng` | `AT+QENG="servingcell"` | `parse_serving_cell` | all AT-due (deep = this only) |
| `ca` | `AT+QCAINFO` | `parse_ca_info` | active, idle |
| `cfun` | `AT+CFUN?` | inline | active, idle |
| `sig` | `AT+QRSRP;+QRSRQ;+QSINR` | `parse_qrsrp/qrsrq/qsinr` | active, idle |
| `ident` | `AT+COPS?;+QUIMSLOT?;+CNUM;+CPIN?` | `parse_carrier/sim_slot/sim_status` + CNUM | active, every 15 cycles / forced |
| `simid` | `AT+CIMI;+QCCID` | inline | forced refresh only |

  A crate unit test asserts that no table entry contains `CGCONTRDP`,
  `QMAP`, `QNWCFG`, `CPMS`, `CMGF`, `CFUN=` or any `=` write form
  (Invariant 6, and "poll steps never change modem state").

### 5.2 Daemon behaviour for `POLL`

- Same gates as an AT request: SO_PEERCRED uid 0, long-flag fast reject
  (`scan_in_progress`), queue time counted against the 5 s lock budget,
  `peer_gone` skip.
- One lock acquisition for the whole batch (`exec::Session`, already used by
  SMS). Steps run in the requested order.
- Per step: deadline `min(3 s, batch deadline − now)`. Before each step: if
  the batch deadline has passed or the peer is gone, the rest are `skipped`.
- After a step timeout or channel reset, the remaining steps are `skipped`
  (the channel is dirty; the next request resyncs as today).
- AT `ERROR` / `+CME ERROR` is a normal reply (`status=ok`, raw kept), as in
  the raw contract, so the client can apply today's ERROR rules.
- Logging: one DEBUG line per batch (`POLL qeng,ca,cfun,sig: 4/4 in 38ms`),
  INFO only on failure. Replies are not logged (CNUM carries the phone number).

### 5.3 `POLL` reply (daemon → client)

```
PRS <nsteps>\n
<step> <status> <nbytes>\n<raw bytes>      (repeated nsteps times)
```

`status` is one of `ok`, `timeout`, `not_ready`, `failed`, `skipped`.
`ERR <code>\n` for whole-request failures (`modem_busy`, `scan_in_progress`,
`command_failed`). The client verifies every `nbytes`; a short or malformed
reply is `command_failed` and nothing is written.

### 5.4 Client: `qcmd --poll`

```
qcmd --poll qeng,ca,cfun,sig [--cap 2500] --out /var/run/qmanager/poll.env
```

- Mode comes from argv[0] `qcmd` plus the `--poll` flag (never invoke as
  `qmanager_atd`, which starts a daemon).
- Before connecting: long flag present → write the env with
  `qm_poll_rc='scan_in_progress'`, exit 1 (mirrors the shell early return).
- Waits for the reply at most until `sent + cap + 250 ms`, then closes the
  socket and exits 1 with `qm_poll_rc='modem_busy'` written. It never triggers
  the frozen-broker restart (that stays with the 340 s rule for ordinary
  calls; a long SMS send can legitimately hold the broker for minutes).
- In-process fallback exactly as for `REQ`: only if the request never reached
  the daemon (no socket, `ECONNREFUSED`, failed write). It runs the same
  `Session` under the same lock.
- Parses each `ok` step with `poll/parse.rs` and writes the env file
  (`poll.env.<pid>`, then `rename(2)`; `safefs` `O_NOFOLLOW`; directory
  `/var/run/qmanager` from `safe_tmp.sh`). Exit 0 **only** after a
  successful rename. A write error is rc 1 (unlike the raw mode, which
  ignores stdout errors).
- `--parse-only <step> < rawfile` (dev/test): parse a captured reply and print
  the env to stdout without touching the modem. This is what the parity
  harness drives on the device.

### 5.5 Env file format (eval safety)

```
qm_poll_v='1'
qm_poll_rc='ok'
qm_poll_ms='38'
qm_step_qeng='ok'
network_type='LTE'
lte_state='connected'
lte_rsrp='-95'
…
t2_carrier='Smart'
t2_carrier_j='"Smart"'
qm_poll_end='1'
```

- **Names** come from a fixed allowlist compiled into the binary: the exact
  globals `parse_at.sh` sets today (`lte_*`, `nr_*`, `t1_cfun`, `t2_*`,
  `sig_*`, `network_type`, `service_status`, `boot_phone_number`,
  `boot_imsi`, `boot_iccid`) plus the `qm_` meta names and `*_j` variants.
  A name not on the list cannot be emitted (unit test).
- **Values** are always single-quoted; `'` becomes `'\''`; NUL is dropped. In
  POSIX sh nothing inside single quotes expands, so modem text such as
  `$(id)`, backticks or `;` (the hostile fixtures) is inert.
- `*_j` variants carry a ready JSON literal (string escaped, or `null`) for
  every free-text value, so the shell composer never escapes modem text.
- Not-requested steps emit nothing, so last-known values hold (Invariant 7:
  deep keeps the CA fields). A requested step that failed emits exactly what
  today's shell path would set for that failure (for example the CA reset
  block when QCAINFO returns ERROR), so `parity.sh` can compare.
- The poller sources the file only when `qcmd` returned 0, guarded
  `[ -f "$POLL_ENV" ] && . "$POLL_ENV"`, then checks `qm_poll_v` and
  `qm_poll_end`. A half-written file is never sourced (it is never renamed
  into place), which matters because a BusyBox syntax error in a dot-sourced
  file aborts the whole poller.

### 5.6 Versioning and compatibility

- The daemon writes `/var/run/qmanager_atd.proto` (`proto=2`, crate version;
  `O_NOFOLLOW`, replaced at every start; proto 1 = today's `REQ`/`SMS`). The
  poller reads it with a builtin `read` at start and every 300 cycles, and
  uses `-t` / `--poll` only when `proto>=2`; otherwise it stays on the Phase A
  shell path. A `qcmd --version` probe is deliberately **not** used for this:
  today's binary would forward `--version` to the modem as a command and
  stall every caller for 20 s (D3). `qcmd --version` still exists for
  humans once the new binary is installed.
- Old daemon + new client (upgrade window): `POLL` is refused by the old
  daemon's request parser (`command_failed`, never executed). The poller then
  falls back to the shell path for that cycle and re-probes `--version` every
  300 cycles. `install.sh` already stops the broker before replacing the
  binary and restarts it, so the window is seconds.
- New daemon + old poller: nothing changes; `REQ` is untouched.
- No other caller changes.

### 5.7 Optional: `WAIT` (Phase E only)

`WAIT <nbytes> <sent_ms>\nv=1 timeout=<ms> since=<seq>\n` parks the client
until a change event (Section 7) or the timeout, then returns `CHG <seq>
<mask>`. It would replace the cycle's `sleep` in idle and deep. It needs the
daemon loop to multiplex parked clients with `poll()`, which it does not do
today; that is why it is optional and last.

---

## 6. status.json ownership map and consumers

### 6.1 Field → producer, before and after

The **writer is the poller in every phase**. What changes is who parses the
AT reply and how the poller reads its inputs.

| Field group | Source | Parsed by, today | Parsed by, after D | Read by the poller via, after C/D |
|---|---|---|---|---|
| `timestamp`, `last_successful_poll` | `date +%s` | poller | poller | 1 `date` fork per cycle (kept: step-safe) |
| `mono` | `/proc/uptime` | `mono_now` (4 forks) | poller (`read` builtin, Phase A) | builtin |
| `system_state`, `modem_reachable`, `errors` | poller logic | poller | poller (from `qm_step_*`) | builtin |
| `network.type`, `lte.*`, `nr.*` (except `ta`) | `AT+QENG="servingcell"` | `parse_serving_cell` | `poll/parse.rs` (`qeng`) | `poll.env` |
| `network.ca_*`, `total_bandwidth_mhz`, `bandwidth_details`, `carrier_components` | `AT+QCAINFO` | `parse_ca_info` | `poll/parse.rs` (`ca`) | `poll.env` |
| `network.cfun` | `AT+CFUN?` | inline | `poll/parse.rs` (`cfun`) | `poll.env` |
| `signal_per_antenna` | `AT+QRSRP;+QRSRQ;+QSINR` | `parse_q*` | `poll/parse.rs` (`sig`) | `poll.env` |
| `network.carrier`, `sim_slot`, `device.phone_number`, SIM status | `COPS;QUIMSLOT;CNUM;CPIN` | `parse_carrier/sim_slot/sim_status` | `poll/parse.rs` (`ident`) | `poll.env` |
| `device.imsi`, `iccid` (refresh) | `CIMI;QCCID` | inline | `poll/parse.rs` (`simid`) | `poll.env` |
| `network.service_status` | derived | `determine_service_status` | unchanged (shell) | builtin |
| `device.firmware/model/imei/lte_category/…`, `ippt_*`, `supported_*_bands` | boot AT | `collect_boot_data` | unchanged (boot only, shell) | once |
| `network.apn/wan_*/dns*`, `lte.ta`, `nr.ta`, `device.mimo` | on-demand cache | `load_ondemand_cache` (jq + 12 sed) | unchanged writer `ondemand_radio.sh` | `ondemand.env` sidecar, re-read on `-nt` |
| `device.temperature` | sysfs | `parse_temperature` | unchanged (shell, builtins) | builtin |
| `device.cpu_usage/memory_*/uptime_seconds` | `/proc` | `update_proc_metrics` (18 forks) | unchanged (shell, builtins) | builtin |
| `connectivity.*` | ping daemon + ring + UCI + dns.json | `read_ping_data`, `conn_state_read`, `read_dns_data` (jq, awk) | unchanged logic | `ping.env` / `dns.env` sidecars (additive writes in `qmanager_ping`); `conn_state_read` stays for watchcat |
| `watchcat`, `sim_failover`, `sim_swap` | local files | jq per file | unchanged | `-nt` gated, one read |
| `device.poller_tier` | tier logic | poller | poller | builtin |

### 6.2 Consumers and how each migrates

The schema, key names, types and the semantics of every field stay the same,
so **no consumer changes**. Each is listed with what the gate checks.

| Consumer | Reads | Migration / gate |
|---|---|---|
| Frontend via `at_cmd/fetch_data.sh` (`useModemStatus`, 16 components; `lib/modem-status-store.ts` 10 s staleness on `.timestamp`) | whole file | none; status parity (`jq -S` minus time fields) |
| `public/overview.sh` (public allowlist) | `.timestamp`, `.modem_reachable`, `.network.*`, `.lte/.nr` scalars, `.device.temperature`, `.device.uptime_seconds` | none |
| `qmanager_watchcat` `read_quality` | `.timestamp`, `.mono`, `.connectivity.avg_latency_ms`, `.packet_loss_pct` | none; gate: `.mono` age < 3 s in every tier, < 6 s under fault injection |
| `qmanager_tower_failover` | `.modem_reachable`, `.lte.rsrp`, `.nr.rsrp` | none; deep keeps `qeng` (Invariant 7) |
| `qmanager_band_failover` | `.device.supported_*_bands` | none |
| `qmanager_health_check` (`cfg.poller_fresh`: `.mono` + `.device.poller_tier`; redaction; bundle copy) | as listed | none. Optional additive check is decision 8 (it would change the 49-check catalog, `shapes.ts` and five locale catalogs) |
| `system/adaptive_polling.sh` | `.device.poller_tier` | none |
| `device/about.sh`, `cellular/imei.sh`, `network/ip_passthrough.sh`, `config-backup/collect.sh`, `config_backup_sections.sh` | `.device.*`, `.network.wan_*` | none |
| `use-watchdog-indicator.ts` | `.watchcat.*` | none |
| `qmanager_debug_report`, `tools/debug_poller_at.sh` | whole file | none; add `poll.env` to the debug bundle (redact CNUM) |
| Heartbeat `/tmp/qmanager_ui_active` | poller | write becomes atomic (Phase A, already built) |
| `/tmp/qmanager_force_tier2`, `_refresh_policy_band`, `_sim_switch_active`, `_poller_reload`, `_quality_reload` | poller | unchanged semantics |
| `/tmp/qmanager_ondemand.json` (`stale:true` fallback in `radio_details.sh`) | `radio_details.sh`, poller | unchanged; the `.env` sidecar is additive and written in the same function |
| B5.29 Invariants 1 / 6 / 7 | | 1: `write_cache` + ping read every cycle in every tier (kept); 6: forbidden commands not expressible in the step table; 7: deep = `qeng` only, CA last-known |

New runtime files (all under `/var/run/qmanager`, root 0700, tmpfs):
`poll.env`, `ping.env`, `dns.env`, `ondemand.env`, the `-nt` stamps.
`init.d/qmanager` `stop_service` removes them; `uninstall.sh` already removes
`/var/run/qmanager`.

---

## 7. URCs and change-driven polling

### 7.1 What the device does today (read-only queries, 2026-10-19)

| Query | Value | Meaning |
|---|---|---|
| `AT+QURCCFG="urcport"` | `"usbat"` | URCs go to the **USB AT port**, which `port-bridge at_mdm0 at_usb0` forwards to an attached host. Options: `usbat`, `usbmodem`, `uart1`, `all`. Saved to NV automatically. |
| `AT+QINDCFG` | `all`=1, `csq`=0, `act`=0, `smsincoming`=1 | `+QIND` mostly off |
| `AT+CREG? / CEREG? / C5GREG? / CGREG?` | n = 0 everywhere | no registration URCs at all |
| `AT+CNMI?` | `2,1,0,0,0` | `+CMTI` enabled, delivered to the URC port (usbat) |
| `AT+CMER?` | all 0 | |

So `/dev/smd11` receives essentially no URCs today. The broker's pre-send
drain (logged at DEBUG) exists for stray lines, not as a data source.

### 7.2 Can the broker read URCs on smd11 without disturbing commands?

Mechanically yes: the daemon would `poll()` the smd11 fd (kept blocking)
alongside the listener when idle, read complete lines, and classify them;
inside an exchange it already separates trailing bytes after a terminator.
Two blockers make it **not a foundation for this design**:

1. **Routing is unproven.** Whether `urcport="all"` includes the AP-side
   glink channels is undocumented (the RM500Q manual defines "all" by the
   three external ports; on the BG96 `all` is not even supported). Testing it
   needs an NV write (`AT+QURCCFG="urcport","all"`, revertible) and a user
   OK. It would also start sending URCs to `usbmodem` for an attached host.
2. **Second readers.** Manual `atcmd` / `sdxpinn` sessions open smd11
   without the lock; an idle-time reader in the broker would steal their
   reply bytes. Acceptable for a hint, not for a source of truth.

`/dev/at_mdm0` (the AP-side end of the usbat route) is owned by
`port-bridge` while Host AT ports are On (the default), so it is only
available with `quecmanager.ports.host_at=0`. Not general either.

### 7.3 Which URCs could replace which queries (if routing works)

| Today's query | Candidate URC | Replaces? |
|---|---|---|
| registration / serving-cell change (part of `QENG`) | `AT+CEREG=2`, `AT+C5GREG=2` (volatile, re-issue at boot): `+CEREG: <stat>,<tac>,<ci>,<AcT>` on status **and cell** change | a *wake* signal only; RSRP/SINR/bands still need `QENG` |
| RAT change | `+QIND: "act",…` (`AT+QINDCFG="act",1`) | hint; documented values have no NR label |
| signal | `+QIND: "csq",<rssi>,<ber>` | no: CSQ RSSI only, no RSRP/RSRQ/SINR, unknown rate |
| CA change (`QCAINFO`) | none documented | no |
| SIM present (`CPIN?`) | `AT+QSIMSTAT=1` → `+QSIMSTAT`, `+CPIN:` on change | partly; needs SIM-detect hardware; a QUIMSLOT software switch probably does not fire it |
| CFUN | none (only boot `+CFUN: 1`) | no; keep polling or the `cfun_dirty` flag from writers |
| data session | `AT+CGEREP=2,1` → `+CGEV: PDN ACT/DEACT, ME DETACH` | hint for `ev_link_state`, which is ping-driven anyway |
| new SMS | `+CMTI` (already enabled) | could wake `qmanager_sms_forward`; out of scope here |

### 7.4 Recommendation: change signals without AT writes first

Treat every change signal as a **hint that pulls the next AT read earlier,
never as data**, and keep the timer as the floor in every tier, so
correctness never depends on URC delivery. The cheapest, no-write sources
are not AT at all:

- **netlink** (`AF_NETLINK`, `RTMGRP_LINK | RTMGRP_IPV4_IFADDR | RTMGRP_IPV6_IFADDR`)
  on `rmnet_data*`: data-path up/down and address changes, no fork, ~150 lines
  of libc code.
- **remoteproc state**: `/sys/class/remoteproc/remoteproc0/state`
  (`4080000.remoteproc-mss`, `running`; `recovery enabled`) shows an SSR
  without parsing dmesg.

These would feed `WAIT` (Section 5.7) in Phase E. Idle and deep then become
"sleep until the timer or a change", which helps only if a consumer needs
sub-cadence freshness while nobody watches. Today none does: link and alert
state come from the ping daemon, and tower failover tolerates one deep
interval. **So Phase E is optional and should wait for a concrete consumer.**
The URC routing probe (decision 5) is listed for completeness; the
recommendation is not to run it now.

---

## 8. Failure isolation

The rule: **the shell loop never waits on the modem for more than the poll
cap (2.5 s), and `write_cache` runs every cycle no matter what the broker
does.** Restart chain: procd respawns both the poller (`respawn 3600 5 5`)
and the broker; the broker is restarted by its own clients only through the
existing 340 s frozen-broker rule; nothing restarts anything else.

| Failure | What happens to AT | What the poller writes | Who recovers | Gate / test |
|---|---|---|---|---|
| **Broker panic** (`panic=abort`) mid-batch | client sees EOF → `command_failed`, not re-run | last-known radio values, `system_state` per today's QENG-failure rules after the cycle | procd respawns `qmanager_atd` (~5 s); next cycle uses the socket again, or in-process fallback if the socket is still missing | `kill -9` broker during active tier: mono age < 3 s, no poller restart |
| **Parser panic** (bad modem text) | the batch already returned | `qcmd --poll` client aborts (rc 134); env not renamed, not sourced → degraded cycle | nothing to restart: the daemon never parses. Parsers are written panic-free (`clippy::unwrap_used`, `indexing_slicing` denied in `poll/parse.rs`) and fuzzed on the host | hostile fixtures + fuzz corpus |
| **Stuck request ahead in the queue** (D2: interactive command with no terminator, 20 s deadline) | poll client gives up at cap, drops socket; daemon skips it (`peer_gone`) | stale radio + `modem_busy` in `errors` for that cycle; heartbeat fresh | the stuck exchange times out, channel resyncs | lock-hold injection (`flock /var/lock/qmanager.lock sleep 15`): mono age < 6 s throughout |
| **smd11 glink hang** (historic `atcli` 300 s) | reads are `poll()`-bounded; per-step deadline 3 s in `POLL`; writes/opens bounded 5 s on helper threads; channel marked dirty | as above; after 3 consecutive failed `qeng` steps `modem_reachable=false` (today's rule) | broker reopens + `AT`→`OK` resync; a wedged write abandons the fd (existing invariant) | crate fake-device tests; device: not injectable safely |
| **Baseband SSR** (`ssr_hold`) | exchanges fail fast (`ENETRESET`/`EBUSY` → `not_ready`); an open can block ≤ 5 s → cap | degraded cycles for ~10–25 s | glink + broker reopen; watchcat's `ssr_hold` gate is independent (dmesg / remoteproc) | natural SSRs during soaks: poller pid unchanged, mono age < 6 s |
| **Long scan** (`/tmp/qmanager_long_running`) | client sees the flag before connecting → `scan_in_progress` | today's early return (`system_state: scan_in_progress`), `write_cache` still runs; fix D4 | flag cleared by the broker after the scan | touch-free: run a real cell scan only with user OK; unit test for the client gate |
| **Cell-scan singleton** (`/tmp/qmanager_scan.lock`, `other_scan_running`) | not the poller's lock; only the long flag matters | unchanged | | |
| **SMS session** (list ~0.25 s; multipart send up to 60 s per part; CPMS select/restore) | `POLL` queues behind the session; CPMS is selected and restored inside one lock hold, so no poll step can land between them; poll steps never touch CPMS (table test) | short ops: none visible; long sends: `modem_busy` cycles, heartbeat fresh | session ends | SMS inbox fetch during active tier: no `modem_busy` in the poller for `list` |
| **SIM switch** (`/tmp/qmanager_sim_switch_active`) | shell skips `--poll` (unchanged early return) | `scan_in_progress` state | flag trap-cleared by producer, 60 s bound | unchanged |
| **Poller (sh) dies** | n/a | status.json goes stale | procd respawn; watchcat's 30 s rule notices | existing |
| **tmpfs full / write error** | client rc 1 (no rename) | `write_cache` writes `tmp` then `mv` **only if the write succeeded** (fix D1); old file kept | | unit + manual test |
| **Upgrade skew** (old daemon, new client) | `POLL` refused | shell path fallback for that cycle | `install.sh` restarts the broker | upgrade test from v0.1.32 |
| **Clock step** (NITZ/ntpd on SSR) | none | `.mono` unaffected; tier age guard (D6) | | existing mono contract |

Degraded output is today's: radio fields hold last-known values, `errors`
carries the code, `modem_reachable` follows the existing QENG-failure rule.
No new status values are introduced (that would be a schema change).

---

## 9. Scheduling policy inside the broker

The modem answers one command at a time, so "fairness" means bounding how
long anyone can be held up, not running things in parallel.

1. **FIFO stays.** The daemon serves connections in accept order, one at a
   time. No priority queue: the single-threaded loop cannot reorder what it
   has not accepted, and accepting everything up front to sort it would
   change the queue-time and `peer_gone` behaviour every caller relies on.
2. **Poll is the only droppable class.** Interactive and daemon callers
   (AT Terminal, band lock, profile apply, cell scan, SMS, watchcat,
   tower/band failover) keep today's budgets. A poll request gives up at its
   cap and is skipped if dequeued after that. This is the whole preemption
   story: a queued poll yields to everyone by expiring.
3. **A batch is one lock hold, bounded.** Typical active batch
   (`qeng,ca,cfun,sig`): 4 exchanges at ~5–10 ms, so an interactive request
   arriving mid-batch waits ~40 ms at most typically and the cap (2.5 s) at
   worst. No mid-batch yield in v1; reconsider only if measured queue time
   for interactive callers under poll load exceeds 250 ms p95.
4. **No preemption inside a command.** An AT command cannot be aborted once
   sent; deadlines and resync are the only tools (existing).
5. **Long commands win by flag.** Scans set the long flag; polls (and every
   short command) fast-reject from the client side without connecting.
6. **Lock budget and queue-time accounting are unchanged.** A poll's queue
   time counts against its 5 s lock budget like any short request; in
   practice the cap (2.5 s) is reached first.
7. **Starvation of polls** by sustained interactive load is acceptable: the
   heartbeat does not depend on AT, and the cycles report `modem_busy`.
8. **Measurement hook:** the daemon keeps per-class counters (requests,
   queue-ms p50/p95, busy, skipped) and logs one INFO summary every 15 min
   (rate-limited, no command text). This answers the open B5.29 question
   "broker queue time under SMS, Sites or radio-details load".

---

## 10. Memory and binary-size budget

- **Stay libc-only.** No `tokio` (one thread, `poll()` is enough), no `serde`
  (the client emits shell assignments; the daemon emits framed bytes). If a
  later phase needs to read JSON, a hand-rolled reader of the few needed
  fields beats ~100–200 kB of `serde_json`.
- Today: 521,200 bytes stripped static, RSS 280 kB (HWM 332 kB), 1 thread.
- Estimated additions: `poll/parse.rs` (QENG/QCAINFO/antenna/CFUN/ident parsers
  plus the env writer) ~40–80 kB; `POLL` in the daemon ~5 kB; netlink (E)
  ~10 kB.
- **Ceilings (gates):** binary ≤ **640 kB**; daemon RSS ≤ **512 kB**
  steady, HWM ≤ 1 MB; client `qcmd --poll` peak RSS ≤ 1 MB. `build.sh`
  fails if the binary exceeds the ceiling.
- Dev-only crates (`proptest` or a fuzz target) live under
  `[dev-dependencies]` and never reach the device binary.

---

## 11. What not to merge

### 11.1 Boot one-shots: confirmed, do not merge

Evidence:
- After boot only four QManager processes are resident on the test modem:
  `qmanager_atd`, `qmanager_ping`, `qmanager_poller`, `qmanager_sites`
  (`modem_ps`, 2026-10-19). `eth_link`, `imei_check`,
  `mtu`, `ttl`, `sms_storage`, `vpn_zone` and `netbird_zone` are non-procd
  `start()` scripts that run once and exit (their headers say so); their
  steady-state cost is zero.
- `qmanager_tower_failover` runs only while a tower lock is active and exits
  after acting; it is a consumer of status.json, not a poller task.
- Ordering: the broker is `START=98` before everything at 99; `vpn_zone` /
  `netbird_zone` change fw4 zones and must run at boot and firewall reload,
  not on a 2 s clock; `imei_check` deliberately sleeps 20 s for modem
  readiness. Folding them into the poller would add their sleeps and
  failure modes to the heartbeat path.

On-demand workers (cell scanner, profile apply, update, health check, config
restore, language install) are minute-scale exclusive operations with their
own lock files; in the hot loop they would block the heartbeat. **Do not
merge.**

One adjacent follow-up (not in this row): the poller's own boot block runs
`auto_apply_profile` and `reconcile_active_apn_slot_at_boot` before the first
`write_cache`, so a slow reconcile delays the first status.json after boot.
Writing a first status.json before the reconcilers is a small, separate fix.

### 11.2 `qmanager_ping` and `qmanager_sites`

Keep them **separate shell daemons**. At ~1 % and ~0.15 % of a core they are
not where the cost is, and separate processes are what keep a ping problem
from freezing the radio status and vice versa. Phase C adds one additive
`ping.env` / `dns.env` sidecar write to `qmanager_ping` so the poller stops
running `jq` on its output. A later Rust ICMP prober is possible (separate
binary, not inside the broker: different failure domain) but not justified
by today's numbers.

---

## 12. Per-core use

Agreed: **threads and CPU affinity buy nothing here.** The modem channel is
serial and I/O-bound (~5 ms per round trip including the client), the broker
already runs on any of the 4 cores (`Cpus_allowed 0-3`), and the measured
cost is fork/exec work in the poller (25 % `sys` in `top`). The levers are
fewer forks and fewer interpreted pipelines. The broker keeps its short-lived
bounded helper threads for writes and opens (a safety mechanism, not
parallelism). No `nice` or affinity changes are proposed.

---

## 13. Durability

On 2026-10-19 a dev deploy `cp`'d 8 files over the live install, restarted
the poller, the AP hung within ~30 s, and after the power cycle UBIFS showed
all 8 files as 0 bytes (data never written back; dirty-expire is 30 s). The
cause of that hang is unknown (the same files ran 8 h the night before; the
RM551E has a known AP hang with the hardware watchdog disabled), but the
data loss is entirely preventable.

Rules for this work and recommended for the repo:

1. **Deploys** (dev and production): write each file as `<dest>.new` in the
   same directory, `sync`, `mv` over the target, `sync` again. Verify with
   `sync; echo 3 > /proc/sys/vm/drop_caches; md5sum <dest>` so the check reads
   the flash, not the page cache. A dev script `tools/poller-parity/deploy.sh`
   does this for the B5.29 file set and records md5s before and after.
2. **`install.sh` and the OTA update path:** add `sync` after the file copy
   stage and before services restart, and once more before any deferred
   reboot. (Recommend as a separate small change; see decision 7.)
3. **`modem_write` MCP tool** (`tools/modem-mcp/`): write to a temp name,
   `sync`, rename, so dev deploys through the bridge are crash-safe too.
4. **Persistent files written by daemons** (`/etc/qmanager/crash.log` via
   `record_planned_reboot`, known-SIMs data, UCI commits): use
   `qm_atomic_write` plus `sync`. A Haiku sweep in Phase A lists every
   persistent write under `/etc/qmanager`, `/etc/config` and `/usrdata`.
   The broker and the poller write only tmpfs on the hot path (`/tmp`,
   `/var/run`), so nothing hot needs `sync`.
5. **Backups** for rollback live in `/usrdata/qmanager_bak_b529/<phase>/`,
   written with the same temp + `sync` + `mv` pattern and an md5 manifest.

---

## 14. Phased roadmap

Gates that apply at the end (B5.29): active ≤ 10 % of a core; idle/deep
~2 %; ≤ 40 forks per cycle; status period 2.0 s ± 0.2 in every tier; `.mono`
age < 3 s; no rise in baseband SSR rate; zero-diff parse parity over the
LTE / NSA / SA / no-service / CFUN 0 / SIM-absent fixtures under BusyBox.

Common to every phase:
- Work in a worktree reset onto `development-home`; one commit per phase.
- Before deploying: back up the replaced files to
  `/usrdata/qmanager_bak_b529/<phase>/` with md5s; deploy with `deploy.sh`
  (Section 13). Restart only the touched service (`/etc/init.d/qmanager
  restart`, `/etc/init.d/qmanager_atd restart`); never a reboot.
- Measure with `tools/poller-parity/measure.sh` per tier (active: dashboard
  open; idle: closed 21 s–5 min; deep: all tabs closed > 5 min, which first
  needs the once-a-minute heartbeat toucher found: `hb_age_max=58–59` in
  every baseline window), then `overnight_monitor.sh` for 12 h with
  `MON_DIR=/usrdata/b529_mon` and the autostart wrapper so a reboot does not
  lose the log. Note: the 04:00 scheduled reboot resets the SSR counter; the
  monitor's `ssr_new` must be summed across boots.
- Static audit for every shell change (CRLF via `.claude/check-crlf.sh`,
  `sh -n` on the device, bashisms, single-var `local`, `jq` without regex,
  guarded dot-sources, numeric guards); `cargo test` and `cargo clippy` for
  Rust; frontend untouched (no `tsc` needed unless a phase touches it).
- Stop after 2 failed validation rounds and ask the user.
- Rollback: restore from `/usrdata/qmanager_bak_b529/<phase>/` with
  `deploy.sh --restore` (temp + `sync` + `mv`), restart the service, revert
  the commit.
- Lifecycle lockstep: no phase adds a daemon, an init script or a UCI key.
  Every changed file is already copied by `install.sh`'s tree copy and the
  bundled-binary step (the update path runs `install.sh`). New runtime files
  live in `/var/run/qmanager` (removed by `uninstall.sh`) and are cleaned in
  `init.d/qmanager` / `init.d/qmanager_atd` `stop_service`.
  `tools/poller-parity/` stays dev-only: `build.sh` excludes it, confirmed
  with a tarball listing in each phase.

**Build team** (set by the user): Opus 5.5 medium orchestrates (plans each
wave, judges reports with its own reads, holds approval stops, does short
sensitive pieces itself); Sonnet 5.5 High builds routine pieces; Opus 5.5
medium for parity verdicts, eval safety, the watchdog freshness contract and
every broker change; Haiku 5.5 for recon, measurement and sweeps. Plans are
written by Opus 5.5 High. Orchestrate only where it saves tokens.

### Phase A: ship the shell hot path (B5.29 Phases 0 + 1, already built)

**ELI5:** the clerk learns to read answers in one go and stops oversleeping.
Nothing about what he asks the modem changes.

- **Files:** as on `claude/happy-antonelli-6c2e7a` (`qmanager_poller`,
  `parse_at.sh`, `events.sh`, `ondemand_radio.sh`, `qlog.sh`,
  `init.d/qmanager`, `at_cmd/fetch_data.sh`, `public/overview.sh`,
  `tools/poller-parity/**`), plus: D1 guarded `mv`, D4 `cycle_count` on the
  early return, D6 tier-age guard, D7 PCI compare on band/PCI only,
  `tools/poller-parity/deploy.sh`, the persistent-write sweep (report only).
- **Gates:** parity zero-diff (206 fixtures + tap replay) on the device;
  period 2.0 s ± 0.2 in every tier; active ≤ 15 % (interim; the final 10 %
  gate moves to C/D); idle ≤ 5 %; mono age < 3 s; no poller restarts.
- **Soak:** 12 h overnight + one ≥ 2 h active window (dashboard open) for the
  SSR comparison, because the true 2 s cycle raises active AT cadence from
  ~3.7 s to 2 s.
- **Rollback:** `/usrdata/qmanager_bak_b529/A/`.
- **Team:** orchestrator (Opus 5.5 medium) does D1/D4/D6/D7 and the deploy
  script; validator (Sonnet 5.5 High) audits; Haiku 5.5 runs the
  measurements and the persistent-write sweep.

### Phase B: bound the poller's wait on the broker

**ELI5:** the clerk stops waiting behind a stuck customer: after 2.5 s he
writes the board anyway and comes back next round.

- **Files:** `native/qmanager_atd/src/{main.rs,common/proto.rs,at/exec.rs}` (client
  `-t <ms>` wait cap for `REQ`, `--version`, the `.proto` capability file,
  optional non-AT refusal), `scripts/etc/init.d/qmanager_atd` (remove the
  `.proto` file on stop), `dependencies/qmanager_atd`, `qmanager_poller`
  (`qcmd -t 2500` on its AT calls when supported), `uninstall.sh` (remove
  the `.proto` file), `docs/features/at-broker.md`.
- **Behaviour:** `qcmd -t <ms>` gives up after `ms` since send, closes the
  socket (the daemon skips it if still queued; if already running, the
  reply is discarded), rc 1 `modem_busy`. Without `-t`, behaviour is
  byte-for-byte today's. Non-AT refusal (decision 3): a command not starting
  with `AT`/`at` is `command_failed` at once, never sent.
- **Gates:** existing parity suite 31/31 (raw and `-j`, daemon and
  in-process); crate tests for the cap; on device, lock-hold injection
  (`flock /var/lock/qmanager.lock sleep 15`, a write needing the user's OK)
  keeps `.mono` age < 6 s and the period ≤ 4.5 s during the hold.
- **Soak:** 12 h; `at_ms` and `log_busy` unchanged from Phase A.
- **Rollback:** previous binary in `/usrdata/qmanager_bak_b529/B/`, then
  `/etc/init.d/qmanager_atd restart`. An old binary would send `-t` to the
  modem as a command, so the poller passes `-t` only when
  `/var/run/qmanager_atd.proto` says the running broker supports it
  (Section 5.6); rolling back the binary alone is then safe, because the old
  daemon never writes that file and `init.d/qmanager_atd` removes it on stop.
- **Team:** Opus 5.5 medium (broker piece); orchestrator wires the poller;
  validator.

### Phase C: jq-free local path and composition

**ELI5:** the clerk writes the whiteboard with his own pen instead of calling
the expensive `jq` printer, and other workers leave him notes he can read at
a glance.

- **Files:** `qmanager_poller` (`write_cache` via `printf` with a builtin
  `_json_str` escaper using `${v//…}` (verified on the device's ash), `-nt`
  gated reads of watchcat/SIM state, epoch kept from one `date` per cycle),
  `qmanager_ping` (additive `ping.env` and `dns.env` sidecars written
  `tmp`+`mv` in `/var/run/qmanager`), `ondemand_radio.sh`
  (`ondemand.env` sidecar in `_ondemand_write_cache`), `conn_state.sh`
  (additive sidecar reader; `conn_state_read` unchanged for watchcat),
  `init.d/qmanager` (cleanup), `docs/features/{adaptive-polling,
  connection-quality,ondemand-radio-details}.md`.
- **Safety net:** every 30 cycles the poller validates status.json with one
  `jq empty`; on failure it logs, keeps the previous file, and switches to
  the jq composer for 10 minutes. Number fields go through a builtin numeric
  guard (`null` for non-numeric), which also removes D1's root cause.
- **Gates:** status parity: 200 snapshot pairs (old composer vs new, same
  globals via the tap) equal under `jq -S` minus time fields, including key
  order of arrays and number formatting; no-AT forks per cycle ≤ 6; idle and
  deep ≤ 2.5 %; active ≤ 10 %.
- **Soak:** 12 h + a deep-only window (all tabs closed).
- **Rollback:** `/usrdata/qmanager_bak_b529/C/` (poller, ping, libs).
- **Team:** Sonnet 5.5 High builds the composer and sidecars; Opus 5.5 medium
  reviews the watchdog freshness contract and the escaper; Haiku measures.

### Phase D: `POLL` verb and Rust parsers

**ELI5:** the clerk hands the broker one shopping list per round; the broker
asks all the questions in one go, and the clerk's reader turns the answers
into a tidy list he reads in one gulp.

- **Files:** `native/qmanager_atd/src/{main.rs,common/proto.rs,at/exec.rs}` (`POLL`,
  `PRS`, step table, counters), new `poll/parse.rs` and `poll/envout.rs`,
  `Cargo.toml` (dev-deps only), `dependencies/qmanager_atd`, `build.sh` (size
  ceiling), `qmanager_poller` (`poll_cycle` AT block → one `qcmd --poll`,
  fallback to the Phase A path when `proto<2` or on refusal),
  `tools/poller-parity/` (`expected/` globals generated on the device from the
  old shell parsers; `parity.sh --rust` drives `qcmd --parse-only`),
  `docs/features/{at-broker,adaptive-polling}.md`.
- **Parity:** host `cargo test` over the 206-fixture corpus against expected
  globals produced by the shell parsers on the device (bug-for-bug, decision
  4); on device, tap replay through `qcmd --parse-only`; then status parity as
  in C; hostile fixtures plus `sh -n` on every generated env file.
- **Gates (final B5.29):** active ≤ 10 % (expected 2–5 %); idle/deep ~2 %;
  forks per active cycle ≤ 40 (expected ~4); period 2.0 ± 0.2; mono age < 3 s;
  binary ≤ 640 kB; daemon RSS ≤ 512 kB; fault injections from Section 8
  (broker `kill -9`, lock hold, natural SSR) pass; no rise in SSR rate over
  12 h active-heavy + overnight idle/deep compared with Phase A.
- **Rollback:** binary + poller from `/usrdata/qmanager_bak_b529/D/`; or
  leave the binary and set the poller's fallback (a `/etc/qmanager/poll_legacy`
  marker, read once at start) to return to the shell parsers without a
  redeploy.
- **Team:** Opus 5.5 medium for `POLL`, `poll/parse.rs` eval-safety and the env
  allowlist; Sonnet 5.5 High for test scaffolding and the poller wiring;
  orchestrator owns the parity verdict; validator for the device leg.

### Phase E (optional): change signals and `WAIT`

**ELI5:** instead of checking a clock, the clerk naps until either the clock
rings or the building's alarm says something changed.

- **Precondition:** a consumer that needs sub-cadence freshness while idle.
- **Files:** broker event loop (`poll()` over listener + netlink + parked
  `WAIT` clients), netlink and remoteproc readers, poller `sleep` → `qcmd
  --wait` in idle/deep.
- **Not included:** URC routing changes (decision 5).
- **Gates:** the timer floor still fires (no missed writes); same CPU/forks;
  netlink event → `qeng` read within one cycle.

### Phase F (not planned): Rust poller

Only if D misses the gates. Separate binary, shell events/alerts kept until
each has its own parity harness.

### Expected numbers per phase (estimates unless marked measured)

| After | Active CPU | Idle CPU | Forks / active cycle | Period | Stall bound |
|---|---|---|---|---|---|
| today (measured) | 39 % | 22–25 % | ~450 (684 system) | 3.7 s | 20 s per stuck request (40 s seen) |
| A (first windows measured) | 11.5 % | 4.6 % | ~20–40 | 1.99 s | same as today |
| B | ~11 % | ~4.5 % | same | 2.0 s | 2.5 s |
| C | 8–10 % | 1.5–2.5 % | ~15–25 | 2.0 s | 2.5 s |
| D | 2–5 % | 1–2 % | ~4 | 2.0 s | 2.5 s |

### Schedule

A: 1–2 days plus a 12 h soak (code exists). B: 2 days plus soak. C: 3 days
plus soak. D: 4–6 days plus a 24 h soak. Total about 3 weeks of calendar time,
most of it soaking. C and D touch different parts of `qmanager_poller`
(composition vs AT block); they can be built in parallel worktrees but must
merge in order C then D.

### Docs to update when each phase lands

`docs/features/adaptive-polling.md` (true 2 s cycle, numbers, invariants,
parity harness as a required gate), `docs/features/at-broker.md` (B, D),
`docs/features/connection-quality.md` and `ondemand-radio-details.md` (C),
routing rows in `CLAUDE.md` and `docs/features/README.md`, ledger B5.29,
`RELEASE_NOTE.md` Improvements ("The background poller uses far less CPU, and
the dashboard refreshes every 2 seconds as intended").

---

## 15. Decisions for the user

Each with the recommendation first.

1. **End state.** Recommend **(b) with parse-in-client and a jq-free shell
   composer**, reached through A → B → C → D. Alternatives: stop after C
   (shell only, likely meets the CPU gates but keeps all parsing in ash), or
   (c)/(d) (rejected above).
2. **Phase A now.** Recommend redeploying the existing Phase 1 build with the
   durable deploy script and the four small defect fixes, then a 12 h soak.
   Writes to the test modem: file deploys and poller restarts, no reboot.
3. **Refuse non-AT input in `qcmd`.** Recommend **yes**: anything not starting
   with `AT`/`at` returns `command_failed` immediately instead of costing 20 s
   of modem time for every caller (D3). It changes the frozen contract only
   for inputs that never worked.
4. **Parser parity policy for Rust.** Recommend **bug-for-bug** first (every
   QUIRKS.md entry reproduced, so the switch is provably zero-diff), then fix
   real bugs (trailing-CR SCS, `B` band with empty value, …) in a follow-up
   row, one fixture flip and sign-off each.
5. **URC routing probe** (`AT+QURCCFG="urcport","all"`, NV write, also feeds
   the host's USB ports). Recommend **not now**; Phase E uses netlink and
   remoteproc, which need no AT writes.
6. **CFUN read cadence** (from B5.29 Phase 2). Recommend moving `cfun` to the
   `ident` cadence (every 15 active cycles) plus immediately after a `qeng`
   no-service result or a `cfun_dirty` flag from the CFUN writers, in Phase
   D where the step list is declared. Alternative: keep it per cycle (costs
   one exchange, ~5 ms, but nothing measurable in CPU after D).
7. **`sync` in `install.sh`, the update path and `modem_write`.** Recommend
   **yes, as its own small change now**, independent of B5.29.
8. **Health check.** Recommend **no new check** in this row; the existing
   `cfg.poller_fresh` covers the contract. A "poll path" check would change
   the 49-check catalog and five locale catalogs.
9. **Idle/deep write skip** (B5.29 Phase 2 item 6). Recommend **skip**: after
   C the write is a few ms of builtins.
10. **Phase E.** Recommend **defer** until a consumer needs it.

---

## 16. Evidence log

Read-only unless noted, RM551E-GL `RM551EGL00AAR02A01M8G_01.001.01.001`.

- 2026-10-19 07:44–08:20: `/usrdata/b529_mon/mon.log` baseline windows
  (Section 2.2), poller md5 `2567d7ecbc8fca8f10a4615150380965`, broker md5
  `d87eee12907fdc70bb54d000a8a9da69` (521,200 bytes), UCI
  `quecmanager.poller` active_grace 20, idle_interval 30, idle_threshold
  300, deep 120; watchcat `enabled=0`.
- 2026-10-19 ~08:19: **unintended write.** A timing loop in this pass ran
  `qcmd --bogus`, which the client forwarded to the modem as a command. Three
  ran before the call was killed; each hit the 20 s deadline and the channel
  resynced (`Command killed by deadline: --bogus`). Effect: the poller's
  `QENG` and `QCAINFO` and a radio-details `CGCONTRDP;+QMAP="WWAN"` got
  `modem_busy` after 16–20 s in the queue; the next monitor window recorded
  `mono_age_max=40`. No modem setting changed; `qcmd AT` answered `OK`
  afterwards with the same broker pid. This is the D2/D3 evidence.
- URC configuration queries (Section 7.1); `AT+QURCCFG=?`, `AT+QINDCFG=?`.
- `/dev` AT nodes, `port-bridge` instances, broker fds (lock, socket, smd11
  only), RSS 280 kB / HWM 332 kB / 1 thread.
- `/sys/class/remoteproc/remoteproc0`: `4080000.remoteproc-mss running enabled`.
- Unit costs (Section 2.2), BusyBox v1.36.1: `sleep`, `date`, `cat` are
  applets (fork); `printf`, `test` builtins; `${v//a/b}` and `${v:1:2}`
  supported; `read -t` rejects fractions.
- Resident QManager processes: atd, ping, poller, sites.
- External: RG50xQ/RM5xxQ AT manual v1.1.1 (URC commands), Quectel forum
  threads on `urcport "all"` behaviour; the RM520N/RM551E manuals were not
  available, so Section 7.3 is "documented for RM500Q, unverified here".

### Measurements and fault tests after A+B+C (2026-10-19, RM551E)

Measurement is read-only except where a fault injection is named; no reboot.

- **Active tier**, `tools/poller-parity/measure.sh`, 60 s window: poller CPU
  (with children) 4.92 % of one core, about 11.5 system forks/s (about 23 per
  cycle), `status.json` period 2.00 s (1.92-2.22), `.mono` age max 2 s.
  Baseline before B5.29: 39 %, 183 forks/s, period 3.73 s, `.mono` age 4 s.
- **Deep tier**: 2.62 %, 7.3 forks/s, period 2.00 s, `.mono` age max 2 s.
  Baseline idle was 22-25 % at 74-87 forks/s. Idle was not re-measured.
- **Status parity** (Phase C): 200 of 200 live snapshot pairs equal between the
  jq composer and the printf composer fed the same globals.
- **Lock hold** (fault injection): `flock` on `/var/lock/qmanager.lock` held
  15 s. With the read cap alone one cycle took 12 s (each of four reads waited
  2.5 s). With the per-cycle busy latch (commit `34c94bd4`): `.mono` age max
  5 s, longest period 4.42 s (gates under 6 s and at most 4.5 s).
- **Natural baseband SSR** inside the same window (firmware fatal error in
  `nr_rx_ctl_agc.c`): the poller stayed within the gates. The NITZ clock step
  moved the wall clock back about 80 s and forward again, so `qmanager.log`
  timestamps around the SSR are out of order. `.mono` is unaffected.
- **Broker `kill -9`** (fault injection): procd respawned `qmanager_atd` in
  5.2 s, period max 2.21 s, `.mono` age max 2 s. While the socket was dead
  `qcmd` ran the exchange in-process.
- **12 h soak** on this build started 2026-10-19 10:23 under the reboot-proof `soakd.sh` (procd service `b529_soak`; log, state and summary on `/usrdata/b529_mon`). A first start at 10:08 was void: a full v0.1.32-draft reinstall at 10:16 put the pre-B5.29 poller and broker back, and the build was redeployed with `deploy.sh`. Result: passed. 144 windows over 15.1 h across 8 reboots; active 4.87 % CPU (max 6.73), idle 3.31 %, deep 2.41 %; period 2.00 to 2.02 s, no window outside 1.8 to 2.2 s or above 4.5 s (max 4.40); `.mono` age 3 s in 13 steady windows (sampling grain) and 4 to 7 s in 5 windows (SSR cluster, redeploy); 27 baseband SSRs, 25 in one 65-minute cluster, poller and broker pids unchanged through it. Raw log `tools/poller-parity/results/b529-soak-2026-10-19.log`.
- **Phase D parsers**: host parity tests exist in the crate; the code is
  compiled into the binary but not called by the daemon or the poller.
