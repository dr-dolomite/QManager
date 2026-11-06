# Plan: rewrite `qmanager_ping` (best of RM551E + RM520N)

Status: **built and validated on the RM551E, option A** (2026-11-06). Large change: it feeds the watchdog, alerts, poller and dashboard.

## Goal

A new `scripts/usr/bin/qmanager_ping`, written from scratch. It keeps the strengths of both existing daemons and fixes each one's known weaknesses. The output contract that consumers rely on (`/tmp/qmanager_ping.json`, `ping.env`, `streak_*` counts, the history ring) stays in place. The only changes to it are additions, plus one history-format change that is called out below.

## What we keep and what we fix

| Source | Keep | Fix / drop |
|---|---|---|
| RM551E (this repo) | IPv4 → IPv6 literal fallback; `ping.env` / `dns.env` sidecars; 120 s attach warm-up; one continuous latency series; detached DNS sampler; reload flag; PID / trap discipline | Single provider (Cloudflare only); cycle-count debounce plus a flat `sleep` (blackhole time-to-fail is 22–32 s against a promised 6–15 s); no hard deadline on hostname targets; `mv` of the cache even when `jq` failed (line 335); ~9 forks per healthy cycle |
| RM520N | Second provider; hard per-leg deadline; fixed-rate loop; wall-clock (monotonic) debounce; keep-last-good cache write; `last_target` + `fail_elapsed_sec` fields | 4 *sequential* legs (12–13 s worst case, 1.6 s from the stale floor); a DNS-dependent first leg; history truncated on every winner change (wipes loss % and jitter); IPv6 only reachable by accident; 3 forking clock reads per cycle; debounce timed from the end of the first failing cycle (late by one probe) |

## Live facts (RM551E, read-only, 2026-11-06)

- BusyBox 1.36.1 `ping` supports `-W` (wait for the first reply) **and `-w` (hard deadline)**, so literals need no `timeout` fork.
- A blackholed v4 probe costs **2.02 s**; a v6 probe with no route costs **0.02 s** ("Network unreachable"); **three parallel blackholed probes cost 2.0 s in total**; a healthy probe costs ~0.08 s.
- `sleep 0.3` works (fractional sleep). `timeout` and `ping6` applets exist.
- Current bearer is IPv4-only (no v6 default route). Live UCI: `profile=quiet`, `target_ipv4=8.8.8.8` (a user-changed value, so the alternate must avoid duplicating it).

## Design

**Legs.** P4 = `target_ipv4` (default `1.1.1.1`), S4 = the other provider's IPv4 (`8.8.8.8`, or `1.1.1.1` when P4 is already Google), P6 = `target_ipv6`, S6 = the other provider's IPv6 (`2001:4860:4860::8888` / `2606:4700:4700::1111`). There are no hostname legs. DNS health stays with the detached DNS sampler (`dns.json`), so a DNS outage never reads as "internet down", and the latency series never depends on what a resolver returns.

**Cycle.**
1. Probe P4 alone: `ping -c1 -W2 -w3`. A hostname target gets `timeout 4` instead, because `-w` does not cover the lookup. If it answers, the cycle is done. A healthy cycle sends one probe.
2. If P4 fails, start S4, P6 and S6 **in parallel** (background jobs, a per-run temp dir, `wait`). The IPv6 legs are skipped when `/proc/net/ipv6_route` has no default route (read without a fork). The winner is the first leg *in priority order* that answered, so the reported RTT stays deterministic.
3. Worst case is about **4.1 s** (P4 blackhole 2 s + parallel 2 s), against 12–13 s on RM520N. That leaves a large margin under the 15 s stale floor for every profile.

**Debounce (wall-clock).** Clock reads use `/proc/uptime` in centiseconds through the `read` builtin (no fork). The outage start is the *start* of the first failing cycle; recovery is timed the same way. `reachable` flips when the elapsed time ≥ `fail_secs` / `recover_secs`. The honest bound is "within `fail_secs` + one cycle". `streak_success` / `streak_fail` stay plain per-cycle counts, so the watchdog contract is unchanged.

**Loop.** Fixed-rate: sleep `interval − elapsed` in fractional seconds, with a 0.2 s minimum. The period equals the interval whenever the cycle fits inside it.

**Profile table.** It stays `1/6/3, 2/10/6, 5/15/10, 10/30/20` in `conn_state.sh`. With a ≤ 4.1 s failing cycle these numbers can be met (sensitive fires at ~8 s, not ~32 s), so UI copy and UCI don't change.

**Output.** The `ping.json` keys stay as they are. New keys: `last_target`, `fail_elapsed_sec`, `cycle_ms` (the last real cycle period). `ping.json` is written with `printf` (every value is numeric or a validated target charset), so there is no `jq` fork per cycle. The write keeps the last good file when it fails. The `ping.env` sidecar is unchanged, plus `_cq_last_target`.

**History (format change).** Two columns: `<rtt|null> <leg>`, where leg is `p4|s4|p6|s6|-`. Nothing is truncated. The poller computes jitter only between consecutive samples from the same leg, and loss % keeps every null. Every reader moves from `$0` to `$1`: the poller stats awk, `wd_detect.sh`, `fetch_ping_history.sh`, `qmanager_health_check`. Old one-column files still parse, because `$1` of a one-column line is the whole line. `/tmp` is reset at daemon start anyway.

**Watchdog alignment.** `wd_detect.sh` currently estimates outage time as `fail_threshold × interval_sec`. In an outage the real cycle can be longer (sensitive: ~4.1 s against 1 s). It will use `max(interval_sec, cycle_ms/1000)` instead. This is a small, contained change.

**Performance (healthy cycle).** `ping` + one `awk` parse, versus ~9 forks today (`grep`, `grep`, `cut`, `awk`, `awk`, `jq`, `date`…). The failure path adds 3 background pings for ~2 s.

## Files (build order, bottom-up)

1. `scripts/usr/bin/qmanager_ping`: new daemon.
2. `scripts/usr/lib/qmanager/conn_state.sh`: read `last_target` / `cycle_ms` (additive). The table stays.
3. `scripts/usr/bin/qmanager_poller`: history awk on `$1` + same-leg jitter.
4. `scripts/usr/lib/qmanager/wd_detect.sh`: history `$1`; cycle-aware time estimate.
5. `scripts/www/cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh`, `qmanager_health_check`: history `$1`.
6. `tools/poller-parity/sidecar_parity.sh`, `tools/watchdog-harness/*`: update fixtures for the new fields and two-column history.
7. Docs: `docs/features/connection-quality.md` (new invariants: leg order, parallel fan-out, wall-clock debounce, history format), `RELEASE_NOTE.md`.

No UCI schema change, no installer / uninstall change (the defaults live in the daemon) and no frontend change, unless option B below is chosen.

## Open question for you

**Should the alternate targets be editable?**
- **A (recommended):** built-in "other provider" alternates, backend only.
- **B:** new UCI keys `target_ipv4_alt` / `target_ipv6_alt`, a CGI + hook change, two more fields on the Probe Targets card, and `t()` copy in all 5 catalogs. Installer and uninstall stay in lockstep.

## Validation

- Static: CRLF (`.claude/check-crlf.sh`), BusyBox/POSIX/bashism audit, no multi-var `local`, numeric guards, trap discipline for the background-probe temp dir.
- Harnesses: `tools/watchdog-harness/run.sh` all green; `tools/poller-parity/sidecar_parity.sh` green.
- On-device (deploy with `sync`, then verify md5):
  1. Healthy: 1 probe per cycle, period equals the interval, `cycle_ms` sane, dashboard latency/jitter/loss as before.
  2. Primary blackhole: temporarily set `target_ipv4=192.0.2.1` (**live UCI write**). Expect S4 to win, `reachable` to stay true, cycle ~2.1 s, and no history truncation.
  3. Total ICMP outage: a temporary nft rule dropping ICMP output to the internet only, so SSH on the LAN stays up (**live firewall write, removed right after**). Measure time-to-fail against `fail_secs` + one cycle for `quiet` and `sensitive`, and check that the watchdog sees the streak.
  4. Restore UCI (`target_ipv4=8.8.8.8`, `profile=quiet`), remove the rule, run the reload flag.

Approving this plan approves the two temporary live writes in steps 2 and 3, and nothing else.

## Risks and rollback

- History format: a missed `$0` reader would show garbage. Mitigation: `grep -rn qmanager_ping_history` gate before commit.
- Parallel jobs on BusyBox ash: orphans if the daemon is TERM'd mid-fan-out. The trap kills the job pids and removes the temp dir.
- Rollback: `git revert` the merge; on-device, restore the previous `/usr/bin/qmanager_ping` + poller from the backup kept in `/tmp/qm_ping_backup/`, then `/etc/init.d/qmanager restart`.

## Execution

Worktree after approval (`EnterWorktree`, reset onto `development-home`). One commit per file group above. End with branch + status; no auto-merge.
