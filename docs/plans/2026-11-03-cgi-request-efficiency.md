# CGI request efficiency + qlog (plan and ledger)

Date: 2026-11-03. Status: **approved; built 2026-11-05** (frontend tier probes pending). Class: large (auth path shared by all 101 CGIs, AT path via `radio_details.sh`, poller tier input).

## Goal

Cut the cost of the web UI's background requests on the modem: fewer processes per CGI call, fewer CGI calls, fewer AT commands driven by the UI, and less logging overhead, without changing any response contract.

## What the investigation found (code, not yet measured on device)

1. **No dashboard poller pauses in a hidden tab.** `lib/modem-status-store.ts`, `use-signal-history`, `use-recent-activities`, `use-data-used`, `use-radio-details` and `use-auto-logout` have no `document.hidden` handling (only sms, sites, logs, live-signal, public-overview, prometheus, active-profile and adaptive-polling do). A forgotten background tab keeps refreshing `/tmp/qmanager_ui_active`, which holds the poller in the **Active tier (~270 AT commands/min, 4.9 % of a core)** instead of Deep (~1 AT/min, 2.4 %). Nothing in `adaptive-polling.md` says this is intended.
2. **`radio_details.sh` runs a full on-demand AT read on every call** (`AT+QENG`, `CGPADDR;+CGCONTRDP`, two TA reads, a MIMO read) every 7 s per open tab, and sources `parse_at.sh` + `ondemand_radio.sh` (~1,950 lines) each time. Two tabs = two AT sequences per 7 s. `ondemand-radio-details.md` ties these reads to SSR risk, so duplicates are worth removing for stability, not just CPU.
3. **Every authenticated CGI starts ~10 processes before its own work** (`cgi_base.sh` -> `cgi_auth.sh` -> `require_auth`):
   - `qm_get_cookie`: subshell + `awk`
   - `_is_valid_token`: `printf | grep -qE`
   - `qm_owned_by_root` x2: `$(stat -c %u)` each
   - session file `$(cat)`, `$(date +%s)`
   - `qlog_init`: `$(dirname)`
   - `fetch_data.sh` heartbeat: `date` + `mv` on every request
4. **`auth/check.sh`** (every 3 s on every page, via `useAutoLogout` in `app-layout.tsx`) answers constant bodies with `jq -n`.
5. **`fetch_signal_history.sh` / `fetch_events.sh`** start `jq -s` on every call (history every 2 s on the dashboard).
6. **qlog** forks `date` for every emitted line and `logger` for every line too (all levels at or above `QLOG_LEVEL`, default INFO). Filtered levels are free. 525 `qlog_info` sites exist; volume per minute is unknown until measured.
   - Readers: the Logs page and `qmanager_logread` read `/tmp/qmanager.log` only. `qmanager_debug_report` and `qmanager_health_check` also capture `logread | tail -300`, so QManager lines in syslog matter there, but INFO lines can push kernel lines (SSR evidence) out of that 300-line window.
7. **The heartbeat contract is safe to throttle.** The poller tracks the heartbeat *changing* (mono-timed) with a 20 s `active_grace`, so rewriting it at most every 5 s keeps Active.

## Estimates (one visible dashboard tab)

| | Today | After this plan |
|---|---|---|
| CGI calls | ~1.7/s (status 0.5, history 0.5, check 0.33, radio 0.14, events 0.1, data used 0.1) | same while visible; **0 while hidden** |
| Processes per authenticated call | ~10 + the CGI's own | ~4 + the CGI's own |
| CPU per visible tab | ~7-10 % of one core | ~4-5 % |
| Poller tier with only hidden tabs | Active (~270 AT/min) | Deep after ~20 s (~1 AT/min) |
| On-demand AT sequences, N visible tabs | N per 7 s | at most 1 per 5 s |

All of these are estimates from code reading plus the measured ~55 ms lease-CGI call. Phase 0 replaces them with numbers.

## Decisions (recommended defaults; say if you want otherwise)

- **D1 syslog copy:** send only WARN/ERROR to syslog; INFO/DEBUG stay in `/tmp/qmanager.log`. Keeps problems visible in `logread` and debug reports, removes the `logger` fork for routine lines. (Alternatives: keep all, or none.)
- **D2 radio-details freshness window:** 5 s. A request inside the window, or one that cannot take the fetch lock, serves the cache (`stale:false` when fresh).
- **D3 hidden tabs:** pause all ledger-listed pollers while hidden; on becoming visible, fetch immediately. `useAutoLogout` resets its failure counter on resume so a long-hidden tab does not trip the offline redirect.
- **D4 hot-file feed (static status JSON behind a capability token):** deferred. Decide after Phase 0 and the post-build measurement. It moves IMEI/ICCID/IMSI behind a bearer URL and needs a logout-revocation design; the earlier rows get most of the gain without that exposure.

## Ledger

Each row is one atomic commit. Order is build order. Risk: L low, M medium, H high.

| ID | Change | Files | Risk | Validation | Rollback |
|---|---|---|---|---|---|
| P0 | **Baseline** (read-only): ms per call for `fetch_data.sh`, `check.sh`, `radio_details.sh` (50 runs, valid cookie); system forks/s and poller tier with 0, 1 visible, 1 hidden, 3 tabs; qlog lines/min by component and level | none (device probe) | L | numbers recorded in this file | n/a |
| A1 | Pause the shared status store while hidden; immediate fetch on visible | `lib/modem-status-store.ts` (+ `.test.ts`), `hooks/use-modem-status.ts` | M | store tests for hide/show; on device: hide tab -> `poller_tier` reaches idle within ~22 s; show -> active within one cycle | revert commit |
| A2 | Same for signal history, recent activities, data used, radio details | `hooks/use-signal-history.ts`, `use-recent-activities.ts`, `use-data-used.ts`, `use-radio-details.ts` | L | tsc + lint; network panel shows no calls while hidden | revert |
| A3 | `useAutoLogout`: pause while hidden, tick on visible with the failure counter reset | `hooks/use-auto-logout.ts` | M | hide 60 s then show: no false "reconnecting"/offline; reboot flow still redirects | revert |
| B1 | Shell-only cookie parse and token check (same first-match semantics as the awk) | `scripts/usr/lib/qmanager/cgi_auth.sh` | H | on device: valid, missing, wrong, duplicate-name, extra-spaces, `=`-in-value cookies; 401 envelope unchanged; login/logout/check unchanged | revert |
| B2 | `qm_validate_session`: `read` instead of `cat`; one `stat` for dir + file; export the `date` result for reuse | `cgi_auth.sh` (+ `safe_tmp.sh` only if a 2-path helper is added) | H | expired, garbage-body (the 502 regression), symlinked and non-root session files still rejected | revert |
| B3 | `qlog_init`: `${QLOG_FILE%/*}` instead of `dirname`; skip `mkdir` when the dir exists | `scripts/usr/lib/qmanager/qlog.sh` | L | log lines still written by CGIs and daemons | revert |
| B4 | Heartbeat throttle: rewrite `/tmp/qmanager_ui_active` only when the stored epoch is 5 s or more old, reusing the auth `date` | `at_cmd/fetch_data.sh`, `public/overview.sh` | M | poller stays Active with one visible tab (checks `poller_tier` over 2 min); goes idle when hidden | revert |
| B5 | `check.sh`: `printf` constant bodies instead of `jq -n` | `auth/check.sh` | L | byte-compare outputs for the 3 cases | revert |
| B6 | `serve_ndjson_as_array` without `jq -s` (awk join, skips blank lines) | `cgi_base.sh` | M | outputs `jq`-equal for empty, missing, 1-line, many-line, trailing-newline files; frontend history + activities render | revert |
| C1 | `radio_details.sh` freshness gate + `flock -n` so concurrent tabs share one AT read; decide before sourcing `parse_at.sh` | `cellular/radio_details.sh` | H | 2 tabs: one AT sequence per window (broker log); RAT-gate invariant untouched; `stale:true` path on unreachable modem unchanged | revert |
| D1 | qlog syslog level (default WARN) via `QLOG_SYSLOG_LEVEL` | `qlog.sh` | L | INFO line absent from `logread`, WARN present; Logs page unchanged | revert |
| V | Post-build measurement, same probes as P0 | none | L | table below filled; targets: hidden-only tabs -> Deep; per-call ms -30 % or better on `fetch_data.sh` | n/a |
| Docs | `adaptive-polling.md` (hidden tabs, heartbeat throttle), `ondemand-radio-details.md` (gate replaces "every call reads"), `auth-rate-limiting.md` if auth helpers change shape, `logs.md` (syslog level), `RELEASE_NOTE.md` Improvements | docs | L | links resolve | revert |

## Not touched

- No new files, daemons, `/www` links, UCI keys or init.d changes, so `install.sh` / update / uninstall / ipk stay as they are (checked: the rows only edit existing files that `install_tree` already copies).
- No response contract changes; no frontend type changes.
- `data_used.sh` keeps its `jq` (10 s cadence, computes `stale`).
- The qlog `date` fork per line stays (BusyBox ash has no builtin clock formatting).

## Risks

- **Auth regressions lock users out or let them in.** B1/B2 are the highest-risk rows: every edge case above runs on device before commit, and `require_auth` stays fail-closed.
- **Hidden-tab pause changes freshness on return.** The first visible fetch can show data up to one idle interval old; the poller's full refresh on re-entry repairs it within one cycle.
- **C1 changes a documented invariant.** It only removes duplicate reads; the RAT probe still runs first in every fetch that happens.
- **Deploy:** scp flat to `/tmp`, `mv`, then `sync` (unsynced deploys have zeroed files before).

## Workflow

Worktree from `development-home`; commit per row; frontend `bunx tsc --noEmit` + lint on touched files; shell rows through `.claude/check-crlf.sh` + BusyBox audit + on-device run. Ends with branch + status for merge / PR / discard.

## Measurements

| Probe | P0 baseline | V after |
|---|---|---|
| `fetch_data.sh` ms/call (50 runs, valid cookie) | 64 / 66 | 26 / 28 (−58 %) |
| `check.sh` ms/call (50 runs, valid cookie) | 63 / 62 | 22 / 22 (−65 %) |
| `radio_details.sh` ms/call, cache expired (real AT read) | 328 (10 runs) | 300-330 |
| `radio_details.sh` ms/call, served by the gate | n/a (every call read) | 30-60; 10-run loop averaged 74 |
| processes per call, `fetch_data.sh` / `check.sh` (incl. ~3 background) | 16 / 16 | 4 / 3 |
| processes per call, `radio_details.sh` (fetching) | 125 | unchanged when it fetches |
| system forks/s, one open browser tab (old frontend) | 42 | 28-29 (backend rows only) |
| `serve_ndjson_as_array` on signal history, ms/call | 31 | 20 |
| poller tier, one open tab, 2 min | active | active 24/24 samples, heartbeat changed 21 times |
| concurrent `radio_details.sh` x3, cache expired | 3 AT sequences | 1 (other two served in ~50 ms), 3 rounds out of 3 |
| poller tier with 0 tabs / hidden tab only / 3 tabs | not measured: needs browser tab control (see below) | pending frontend deploy |
| qlog lines/min, steady state, 10 min | INFO 3.4 (poller 3.2, sites 0.2), WARN+ 0 | same lines in the file; syslog copy now WARN+ only |

### CPU per call and per tab (measured 2026-11-05)

CPU time (user+sys of the CGI and every child, `/proc/<pid>/stat` cutime+cstime, HZ 100) per call. "Before" ran the exact pre-change files from a sandbox copy with their source paths pointed at the old libraries, so live files were not swapped.

| Endpoint (dashboard cadence) | Before, CPU ms/call | After, CPU ms/call |
|---|---|---|
| `fetch_data.sh` (every 2 s) | 63 | 26 |
| `fetch_signal_history.sh` (every 2 s) | 67 | 29 |
| `check.sh` (every 3 s) | 60 | 20 |
| `radio_details.sh` (every 7 s) | 384 | 362 reading the modem, 40 served by the gate |
| `fetch_events.sh` (every 10 s) | 60 | 26 |
| `data_used.sh` (every 10 s) | 72 | 44 |

Per-tab CPU, of one core (the modem has 4), computed from those costs at the frontend cadences:

| Scenario | Before | After |
|---|---|---|
| 1 visible dashboard tab | 9.2 s/min = 15.3 % | 5.6 s/min = 9.3 % |
| 1 hidden tab | 15.3 % (polled like a visible tab) | 0 % (no requests) |
| 3 visible tabs | 45.9 % | about 20 % (one radio read per 5 s shared) |

A single visible tab still pays a full radio read every 7 s (the 5 s window is shorter than the 7 s poll); the gate pays off from the second tab on. Poller CPU is not in these numbers.

Notes:

- Probes ran on the device with the CGIs invoked directly (`HTTP_COOKIE` set to a throwaway bench session). One real browser tab stayed open throughout, so "background" numbers include its polling. `radio_details.sh` ran 10 times, not 50: each uncached run is a full on-demand AT read, which `ondemand-radio-details.md` ties to SSR risk.
- The syslog ring (`logd -S 64`) holds only ~47 s on this modem: the firmware's `qms` daemon writes ~11 `user.debug` lines/s. QManager INFO lines were already being flushed out within a minute, which supports D1.
- Long-running daemons keep the qlog they sourced at start, so they copy INFO to syslog until their next restart.
