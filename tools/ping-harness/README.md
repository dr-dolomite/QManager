# ping-harness

Dev-only harness for `qmanager_ping` (CQ x Watchdog step 1b, rules R7 and R8). Not installed
(`install.sh` never copies `tools/`). It sources the daemon with `QM_PING_NO_MAIN=1`, drives
`load_config` / `probe_cycle` (and, in four scenarios, the real `main` loop) under BusyBox ash
in WSL, and records everything observable. Identical code gives byte-identical output on every
BusyBox version.

## Usage (WSL Ubuntu; jq in `~/bin` or on PATH)

```sh
H="/mnt/d/.../tools/ping-harness"
PH_BB=/usr/bin/busybox /usr/bin/busybox sh "$H/run.sh" list
PH_BB=/usr/bin/busybox /usr/bin/busybox sh "$H/run.sh" run -o /tmp/ph-new           # all scenarios
PH_BB=/usr/bin/busybox /usr/bin/busybox sh "$H/run.sh" run -o /tmp/ph-new 02_early_exit
/usr/bin/busybox sh "$H/run.sh" compare "$H/baseline" /tmp/ph-new                    # IDENTICAL / DIFFERS
```

`PH_BB` must be the absolute path of the BusyBox under test (the fake `ping` / `uci` scripts use
it as their interpreter). The gate is `compare baseline <out>` under **1.29.3**
(`$HOME/bb/busybox-1.29.3-bin`), **1.31.1** (`$HOME/bb/busybox-1.31.1-bin`) and **1.36.1**
(`/usr/bin/busybox`). `PH_KEEP=1` keeps the work dirs (`/dev/shm/ph.*`).

Run from Git Bash with `MSYS_NO_PATHCONV=1 wsl -e sh -c '...'`; the worktree is under
`/mnt/d/Projects/QM PROJECT/QManager/.claude/worktrees/...`.

## How isolation works

- `qmanager_ping`, `qlog.sh`, `safe_tmp.sh`, `qm_platform_cqwd.sh` and `conn_state.sh` are copied
  into a stage dir with a `sed` rewrite of the absolute device paths (`/usr/lib/qmanager/`,
  `/etc/qmanager/`, `/etc/config/`, `/tmp/`, `/var/run/`, `/proc/net/ipv6_route`). The repo
  files are never modified. `/proc/uptime` stays real: the harness runs in real time with short
  delays.
- PATH holds only BusyBox applets, `jq`, a fake `ping` / `ping6` and a fake `uci`.
  - The fake `ping` reads `pingtab` (`<target> <delay_s> <ok:RTT|fail> [<resolved addr>]`), prints
    a BusyBox-style banner and summary, waits the delay and exits. It writes `<target>.start` and
    `<target>.finish` markers, so a ping that was killed (or timed out) shows as "cut short". Like
    the real ping, a SIGTERM ends it and its sleep. `::1` always answers (`detect_ping6`).
  - The fake `uci` serves `uci.db` (`sec.key=value`, `sec.key+=item`) for `get` and `show`, so the
    real adapter (`cfg_get`, `cfg_get_list`) is what the daemon reads through.
  - The route check reads a fake `/proc/net/ipv6_route` (`h_route default|none`).
- Ubuntu's BusyBox 1.36.1 runs applets before searching PATH, which would bypass the fake ping.
  There (`H_PREFER_APPLETS=1`) the fakes are shell functions and `timeout N ping` is a function
  that runs the fake script as a direct child and kills it at the deadline. The 1.29.3 and 1.31.1
  runs use the real `timeout` applet (`-t SECS` on 1.29.3, via `plat_timeout`).
- The detached DNS job is stubbed out (`dns_probe_maybe`); it is not under test.

## Scenario files (`scenarios/NN_name.sh`)

`sc_setup` (before the daemon is sourced) and `sc_run`. Helpers (`lib.sh`): `h_cfg`, `h_cfg_list`,
`h_ping`, `h_route`, `h_no6`, `h_cycle LABEL [MAX_CS [MIN_CS]]` (one `probe_cycle` with result,
slot states, elapsed window as yes/NO, probes cut short, orphan count), `h_main_start`,
`h_wait_ring N`, `h_main_stop`, `h_state_dump` (ping.json, ping.env, slots.json, ring with
volatile fields masked). Timing is asserted as wide windows, never printed raw.

Orphans: `h_orphans` counts leftover fake pings and their sleeps for 0.5 s after each cycle; it
must print `orphans: 0`. Replacing the descendant kill in `_fan_kill` with a plain `kill` of the
leg jobs makes it print 4, so the check has teeth.

| Scenario | What it pins |
|---|---|
| 01_slot1_ok | healthy cycle sends one probe, the rest read standby |
| 02_early_exit | slot 1 fails, slot 2 answers fast, slow slots 3/4 are killed, no orphans |
| 03_higher_answers_first | slot 3 answers before slot 2 finishes; slot 2 still wins, slot 3 keeps its own `ok` |
| 04_lower_fails_higher_wins | slot 2 misses after slot 3 answered; slot 3 wins once slot 2 has finished |
| 05_no_ipv6_route | IPv6 literal slot skipped (not probed), fan-out over the rest |
| 06_slot_promotion | slot 1 skipped (no v6 route), slot 2 promoted to "alone" |
| 07_hostname_timeout | hostname leg ends at `plat_timeout 4`, counted as a miss, fan-out answers |
| 08_all_fail | `last_leg` 0, family none, all probed slots miss |
| 09_invalid_slots | bad slots fall back to their default with a warning |
| 10_targets_missing | no list / short list / cleared list read as defaults |
| 11_hostname_family | `last_family` parsed from the ping banner |
| 12_ping6_unavailable | IPv6 literal slot skipped when `ping -6` / `ping6` is unavailable |
| 13_main_failover | real main: ring `<rtt> 2`, ping.json `last_leg`, slots.json, ping.env `_cq_leg` |
| 14_main_ok_then_down | real main: ring `<rtt> 1` then `null -`, `last_leg` 0 |
| 15_main_attach_warmup | real main: failed cycles stay out of the ring during the attach warm-up |
| 16_sensitivity_table | `load_config` resolves the contract table; old `profile` key fallback; unknown reads relaxed; `interval_override` ignored |
| 17_ring_trim | real main with the ring size forced to 3: the ring passes size + 10 once, then trims back (about 15 s) |

## Output per scenario

`console.log` (the scenario's own output, PIDs masked), `tree.txt` (every file left in the fake
root: qlog, ping.json, ping.env, slots.json, ring), `exit.code`.
