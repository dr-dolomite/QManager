# QMI Phase 2: live tiers (consumers of the Phase 1 lane)

Status: **APPROVED 2026-10-22** with the recommended D1–D5 (skip CA gap-fill, no live cell during scans, defer step 6, dashboard 1 Hz, step 7 optional); test-modem deploys incl. the broker binary swap approved, never reboot. Branch `claude/qmi-phase2` (development-home tip with Phase 1 merged). Inputs: [Phase 1 plan](2026-10-22-qmi-phase1-broker-architecture.md) §2 / §2b (§2b rules already decided, carried into step 1), [`qmi-lane.md`](../features/qmi-lane.md), [`adaptive-polling.md`](../features/adaptive-polling.md), [`antenna-alignment.md`](../features/antenna-alignment.md), [`safe-tmp.md`](../reference/safe-tmp.md).

## 0. Goal and the three tiers

| Tier | Cadence | What | Transport |
|---|---|---|---|
| **Real-time** | antenna page 200 ms (5 Hz); dashboard 1 s | LTE serving signal (RSRP/RSRQ/RSSI at 0.1 dB), PCI, EARFCN, band, bandwidth, LTE CA summary, registered, qmi_state | Static file served by uhttpd from tmpfs, written by the broker sampler only while an authenticated lease exists |
| **Normal** | 2 s | Everything else in `status.json`. NR, SINR and per-antenna values stay AT. | Unchanged `fetch_data.sh` |
| **Background** | poller tiers | `qmi_merge.sh` gap-fill keeps LTE serving values ≤ ~2 s old in idle/deep tiers and on busy cycles | `qmi.env` sidecar, no forks |

**Device facts behind the design** (checked live 2026-10-22):
- uhttpd `2023-06-25-34a8a74d-2` runs as root with `-n 3` (3 concurrent CGIs device-wide), `-N 100`, `-k 20`, `-t 60`. Fast CGI polling, SSE and long-poll CGIs are rejected; websockets / a separate port are retired.
- **uhttpd follows a `/www` symlink into `/tmp`** (bench: `/www/qmbench -> /tmp/qmbench` served `live.json` 200 `application/json`).
- **Directory listing is ON** (no `-D`): `GET /qmbench/` returns "Index of". A capability URL would leak through it, so the live dir must always hold an empty `index.html` (rule L4).
- `/var -> /tmp`; `/var/run/qmanager` is root `0700`. BusyBox has `flock`, `od`, `hexdump`, `mktemp`, `realpath`, `stat`. `qm_generate_token` (openssl sha256 over urandom) exists. Session cookies are `SameSite=Strict` (closes cross-site GET/CSRF on the lease CGI).

## 1. Live channel design (step 2 implements it)

**L1. Trust boundary: no client number reaches the broker.**
- The lease CGI accepts only `tier=aim|watch` (shell `case`).
- It writes `/var/run/qmanager/qmi_live_<tier>` with one line: uptime seconds (`/proc/uptime` integer part = CLOCK_BOOTTIME seconds the sampler uses), via `$$`-temp + `mv -f` (allowed only inside the root-only run dir, per safe-tmp.md).
- Broker maps tier → compiled period: `aim` 200 ms, `watch` 1000 ms, none 2 s. 200 ms floor (`MIN_PERIOD`) kept.
- Broker parses the stamp digits-only (no leading zero, ≤ 10 digits, not in the future on the boot clock, age ≤ 10 s); opens `O_NOFOLLOW`, fstat regular file owned by euid. Anything else = no lease. No wall clock → NTP/NITZ steps irrelevant.

**L2. Multiple tabs/users.** One stamp file per tier (no read-modify-write of a shared rate). Effective period = fastest fresh tier. All authenticated tabs share one token per lease episode (single-admin device; content is non-identifying).

**L3. Token (capability URL).**
- `/var/run/qmanager/qmi_live.token`, exactly 64 lowercase hex.
- CGI: `flock -w 1` on `/var/run/qmanager/qmi_live.lock`, write stamp, read token; if absent/invalid mint with `qm_generate_token`, write atomically. Returns `{"success":true,"available":true,"url":"/qmlive/<token>.json","period_ms":N,"renew_s":5,"ttl_s":10}`.
- Expiry: when no stamp is fresh, the broker try-locks (`libc::flock` non-blocking; retry next slice), re-checks under the lock, deletes token, public file and its `.new`, clears its ring. Next lease mints a new token.
- Broker validates the token (64 hex) before building a path. Optional: logout deletes the token under the lock.

**L4. Public dir.** `/var/run/qmanager/live` (changed from `/tmp/qmanager_live` after security review: a web-root link must not point into world-writable `/tmp`), made with `safefs::ensure_own_dir(_, 0o755)` and verified before every publish. `/www/qmlive` → symlink to it. Always contains an empty `index.html` (validation: `GET /qmlive/` returns an empty body). Hygiene on start, token change and expiry: delete everything except `index.html` and the current `<token>.json`. Writes via `safefs::write_atomic`.

**L5. File format** (~2 KB, compact JSON):
```
{"v":1,"run":<daemon start boot_ms>,"seq":N,"period_ms":200,"qmi_state":"up|down|unavailable","ssr_count":0,"scan":false,
 "samples":[{"seq":N,"t":<boot_ms>,"reg":true,"rsrp":-955,"rsrq":-85,"rssi":-580,"pci":295,"earfcn":150,"band":"B1","bw":20,
            "ca":[{"band":"B3","earfcn":1275,"pci":12,"bw":15,"active":true}]}, ... up to 16]}
```
- Signals are integers ×10 (no floats); `null` unless registered.
- **Never** contains cell ID, TAC, eNB/sector, MCC/MNC, operator, IMSI or other IDs (unit test asserts absence).
- Scan gate: while the long flag is up, `"scan":true` and serving fields in new samples are `null` (mid-scan QMI serving EARFCN follows scanned carriers).
- `run` changes on daemon restart → client resets its ring.

**L6. Capability.** Broker 0.4.0; proto file gains `live=1` (wire unchanged, still proto 3). Lease CGI answers `available:false` unless `/usr/bin/qmi` is executable and the proto file has `qmi=1` and `live=1`. A rolled-back broker degrades the UI to the 2 s tier (no 404 loop).

**L7. Retire Phase 1's `/tmp/qmanager_qmi_live` mtime lease** (world-writable `/tmp`, unused). Stop/uninstall keep removing the old path. `qmi.env` and `qmanager_qmi.json` keep being written every sample.

## 2. Build order (each item its own commit)

Legend: **[BE]** = BusyBox static audit + `.claude/check-crlf.sh` + on-device validation. **[FE]** = `bunx tsc --noEmit`, lint on touched files, `bun test` where a store exists.

### Step 1 [BE]: poller `qmi_merge.sh` gap-fill + new status keys (Opus)
1. New `scripts/usr/lib/qmanager/qmi_merge.sh` (sourced `[ -f ] && .`; `parse_at.sh` byte-for-byte untouched):
   - `qmi_load`: `-nt` gate against `/var/run/qmanager/qmi.stamp` (ondemand pattern: stamp backdated 1 s, forced re-read every 15 calls); sources via `cq_env_source /var/run/qmanager/qmi.env`; zero forks.
   - `qmi_overlay_apply` (right before `write_cache`): saves `lte_rsrp/lte_rsrq/lte_rssi` into `_qmo_*`, fills from `qmi_lte_*` only when ALL hold: no `+QENG:` reply this cycle (not AT-due, or rc 3); `qmi_state=up`; `_MONO_TOP - qmi_mono` in 0..5; `qmi_registered=1`; `qmi_lte_pci/earfcn` equal `lte_pci/earfcn` (or AT has no serving cell); not the scan/SIM-switch early-return path. Sets `lte_source=qmi`, else `at`.
   - `qmi_overlay_restore` (after `write_cache`): restores AT values, so every AT consumer (`events.sh`, signal history, busy logic, `dump_globals`) only sees AT samples (§2b rule 4, made structural).
2. Poller wiring: `qmi_load` + `qmi_overlay_apply` before the final `write_cache` in `poll_cycle`, `qmi_overlay_restore` after. The early-return `write_cache` gets no overlay (D2). Fallback stubs: `command -v qmi_load >/dev/null || qmi_load() { return 1; }`.
3. New status keys in both composers (`_wc_compose_pf`, `write_cache_jq`): `lte.source` (`at|qmi`), `device.qmi_read_mono` (int, 0 = never), `device.qmi_state` (`""|up|down|unavailable`), `device.qmi_ssr_count` (int). `network.ca_source` deferred (D1). Optional fields in `types/modem-status.ts`.
4. Parity tooling: `dump_globals.sh` learns `qmi_`/`_qmo_`; `sidecar_parity.sh` covers `qmi.env` (valid, truncated, stray line, older than stamp) + no fork; `status_parity.sh` adds the keys incl. hostile values; `measure.sh` gates unchanged.

### Step 2a [BE]: broker live sampler, 0.4.0 (Opus)
`daemon/qmi_snapshot.rs` (+ `daemon/live.rs` if > ~300 lines): stamp reader (L1), tier → period, 16-sample ring, seq + run, identifier-free live JSON renderer (L5), token read/validation, dir hygiene + `index.html` + expiry deletion under `flock` (L3/L4), scan gate, sampler slice `min(period, 250 ms)`, `live=1` capability, version bump, rebuilt `dependencies/qmanager_atd`. Invariants: no unwrap/expect/indexing on runtime data, 128 KiB stacks, write failure logged once.

### Step 2b [BE]: lease CGI (Sonnet High builds, Opus reviews)
New `scripts/www/cgi-bin/quecmanager/cellular/live_signal.sh`: auth via `cgi_base.sh`; POST `?tier=aim|watch` from `QUERY_STRING` (no body → no `dd` fork); `printf` response, no jq; errors `bad_tier`, `lease_failed`, or `available:false`. ~3 forks per renewal (`flock`, `mv`, `openssl` only on mint). Optional: `auth/logout.sh` drops the token under the lock.

### Step 2c [BE]: lifecycle lockstep (Sonnet; Haiku validator audit)
- `at_engine.sh at_live_link`: `/www/qmlive` → `/tmp/qmanager_live`; replace if wrong, never write through a real dir, idempotent.
- `init.d/qmanager_atd`: start re-asserts the link; stop removes `/tmp/qmanager_live` (rm -rf), `qmi_live_{aim,watch}`, `qmi_live.token`, `qmi_live.lock`, and the old `/tmp/qmanager_qmi_live`. `qmi.stamp` cleaned in the `qmanager` stop path (poller owns it).
- `install.sh` (fresh + OTA): `at_live_link` **after** `install_frontend` (its `/www/*` wipe removes the link).
- `uninstall.sh`: remove link, dir and run-dir files above.
- No UCI. Check no static-export route is named `qmlive`. Dev: commented `/qmlive/:path*` rewrite next to the commented `cgi-bin` one in `next.config.ts`.

### Step 2d [BE]: on-device gate
Fill §4 and run step 2 validation **before any frontend work**. If a threshold fails, stop and re-plan.

### Step 3 [FE]: live store + hook (Sonnet High; Opus reviews)
- `lib/live-signal-store.ts`: pure module, injected fetch/timers/visibility/now (pattern: `modem-status-store.ts`), with `lib/live-signal-store.test.ts`. Shared singleton; tier = fastest subscriber (`aim` beats `watch`).
  - Renew via `authFetch` on the lease CGI at subscribe, every 5 s, and on becoming visible.
  - Poll with a non-overlapping `setTimeout` chain at `period_ms`, `fetch(url, {cache:"no-store", credentials:"omit"})` (static file; uhttpd keep-alive reuses the connection; do not use `keepalive:true`).
  - Merge: dedupe by `seq` into a 150-sample client ring (30 s at 5 Hz); changed `run` resets.
  - 404: re-lease once, then back off 1/2/5 s; after 3 failures `unavailable` until visibility change/remount.
  - Hidden tab stops polling and renewal (broker lease lapses ≤ 10 s).
  - Idle demotion: `aim` → `watch` after 10 min without pointer/keyboard input; input restores `aim`.
- `hooks/use-live-signal.ts` (`{tier}`) → `{state, latest, samples, receivedAtMs}`; states `connecting` / `live` (new seq within 3× period; browser clock read in effects, never in render) / `stale` (no new seq, `qmi_state`≠up, `reg:false`, or `scan:true`) / `paused` (hidden) / `unavailable`.

### Step 4 [FE]: antenna alignment uses live LTE RSRP (Impeccable craft)
- `live-aim.tsx` gains a live serving-cell RSRP lead: big tabular numeral at 0.1 dB, ink + bar from `signal-quality-display.ts`, 30 s lightweight SVG polyline sparkline (not recharts) with session-peak tick and delta to peak.
- Honest distinction: the lead is labelled serving cell across all receive chains (LTE anchor in NSA), with Fact-Is-Info `Badge variant="info"` "Live" only while `state==="live"`. Composite score, SINR leg and Receive Chains stay per-port 2 s with a quiet "Updates every 2 s"; port 1 RSRP is not serving RSRP and copy must not imply it. Missing reading = empty track; stale/paused show last value muted with a status chip (distinct glyph). `unavailable` renders exactly as today.
- Positions recorder stays on the 2 s snapshot. Motion only via `lib/motion.ts`; reduced motion = no tweening. Copy in all five catalogs; no debug copy.

### Step 5 [FE]: dashboard live LTE at 1 Hz (Impeccable craft)
In `signal-status-card.tsx` / `signal-rows.ts`, LTE RSRP/RSRQ/RSSI come from `useLiveSignal({tier:"watch"})` only while `live` and the sample's PCI/EARFCN equal `status.json` `lte.pci`/`lte.earfcn` (mismatch = handover in progress → 2 s values). SINR, NR, CA stay 2 s. No toasts, no layout shift.

### Step 6 [BE]: `radio_details` network type — **recommend deferring** (D3)
`ondemand_radio.sh` uses the fresh QENG RAT to gate `*_mimo_layers`, which crashes the firmware in the wrong RAT. QMI can't yet tell SA reliably (SA untested; NSA shows `rats:["lte"]`). If wanted now: QMI only as a second veto (read MIMO only when QENG RAT and fresh QMI registration agree).

### Step 7 [FE]: cell-scanner serving-cell reference — **optional** (D5)
Small "Your serving cell" strip from `useLiveSignal({tier:"watch"})` while idle; freezes on `scan:true` with "Paused while scanning" (last pre-scan value). Not live during a scan.

### Step 8: docs + release note (Sonnet; docs-writer)
New `docs/features/live-signal.md` (L1–L7, format, states, invariants); update `qmi-lane.md`, `adaptive-polling.md` (invariant 13, overlay rule), `at-broker.md` (`live=1`, 0.4.0), `safe-tmp.md`, `antenna-alignment.md`, CLAUDE.md routing, `docs/features/README.md`; `RELEASE_NOTE.md`: "Real-time signal on Antenna Alignment and the dashboard".

## 3. Model tiering

| Work | Model |
|---|---|
| Orchestration, plan stops, judging reports, final validation | Opus |
| Step 1 overlay, step 2a sampler/lease/token, review of 2b and 3 | Opus |
| Routine builders: 2b, 2c, 3, 6/7, docs | Sonnet High |
| Recon, sweeps, validator audits (BusyBox, lockstep, CRLF, i18n, debug-copy grep) | Haiku |
| UI steps 4, 5, 7 | Impeccable craft (builder Sonnet High, critique Opus) |

## 4. Benchmark results (static file vs CGI polling)

**Quick benchmark (2026-10-22, RM551E, ~870 B JSON rewritten every 200 ms, 60 s at 5 Hz from the PC over keepalive; test files removed afterwards):**

| Method | p50 / p95 ms | Marginal CPU (uhttpd + CGI children) | Errors |
|---|---|---|---|
| Static file | 49.7 / 53.0 | ~0.25 % of one core (uhttpd 0.37 %, no forks) | 0 |
| Minimal CGI (`cat`) | 49–65 / 66 | ~4–6 % of one core (+5–8 forks/s) | 0 |
| CGI sourcing `cgi_base.sh` (auth skipped) | 65 / 71 | ~9 % of one core | 0 |

- **Static wins on CPU by ~20×**, which matters more with several tabs; real authenticated CGIs would cost another ~5–10 ms and 3–5 forks per request (estimated).
- **Contention:** 2 clients at 5 Hz (static or CGI) left an unauthenticated probe CGI unchanged (p50 ~65 ms, no 503s). A 6-client new-connection flood still gave no 503s but a ~1 s p95 tail (accept pressure).
- **Keepalive latency floor ~40 ms** on reused connections for every request type (on-device curl: static 40.6 ms; fresh connection 1.7 ms). Likely Nagle + delayed ACK with uhttpd writing headers and body separately (unconfirmed). Harmless for a 200 ms cadence, but the "static GET p95 ≤ 30 ms" gate below is replaced by **≤ 80 ms**; investigating the floor is optional (step 2d).
- **Caching:** uhttpd sends `ETag` (inode-size-mtime) + `Last-Modified`, no `Cache-Control`; ETag changes on every atomic rename. Client must use `cache:"no-store"` (or `?t=`). uhttpd follows a `/www` symlink into `/tmp` (confirmed).

Full gate measurements below are taken in step 2d.

**Step 2d device gate (2026-10-22, RM551E, broker 0.4.0 `00d20766…` from a9a4372e, init.d 43cf2d94, lease CGI 948fbcf8).** Method: PC clients (.NET HttpClient, keepalive, LAN) that behave like a tab: renew the lease every 5 s through the real authenticated CGI, poll the static file at the tier rate, merge samples by `(run, seq)`. A second PC client GETs authenticated `at_cmd/fetch_data.sh` every 2 s throughout. On device, `/proc/<pid>/stat` utime+stime (+cutime+cstime for uhttpd's reaped CGI children) and `/proc/stat` over 100 s windows. CPU is % of one core; "system" is % of all 4 cores (one-core equivalent in brackets). Baseline and 1-client HTTP are averages of four windows across 10-min runs; HTTPS and 3-client are one 100 s window in a 130 s run.

| Scenario | uhttpd CPU (self / CGI children) | broker CPU | system CPU Δ | other-CGI 503s / timeouts | `fetch_data.sh` p95 Δ | delivered rate (lost) | Pass? |
|---|---|---|---|---|---|---|---|
| Baseline (no live) | 3.46 (0.11 / 3.34, the 2 s probe) | 0.73 | 0 (4.99 % abs) | 0 / 295 | 0 (p95 128.6, p50 74.2 ms) | — | — |
| Static 5 Hz, 1 client (HTTP), 10 min | 5.09 (0.61 / 4.48): Δ self +0.50, Δ children +1.14 (renewals) | 1.91 (Δ +1.17; `qmi-sampler` thread 1.37) | +1.25 pp (+5.0 one-core) | 0 / 295 | −0.8 ms | 4.76 Hz (36 lost, see below) | **fail** (broker; lost) |
| Static 5 Hz, 1 client (HTTPS) | 5.14 (0.84 / 4.30): Δ self +0.73 | 1.90 | +0.61 pp (+2.4) | 0 / 65 | −22 ms (short run) | 4.76 Hz (0) | **fail** (broker) |
| Static 2×5 Hz + 1×1 Hz | 7.71 (1.26 / 6.45): Δ self +1.15, Δ children +3.11 | 1.86 | +1.61 pp (+6.4) | 0 / 65 | −16 ms (short run) | 4.78 / 4.79 / 4.79 Hz (0) | **fail** (broker) |
| 1 h soak, 5 Hz, 1 client | 4.51–5.18 | 1.47–1.93 | +0.4 to +1.4 pp (one 12.8 pp window from unrelated load) | 2 / 1800 (untimed; max 3.09 s) | −0.5 ms (p95 128.1) | 4.73 Hz (98 lost) | **fail** (2 SSRs) |
| CGI polling 5 Hz, 1 client (reference) | not re-run (optional): quick benchmark above, ~4–9 % of one core | | | | | | expected fail |

**Per threshold:**
- uhttpd ≤ 1.5 %: **pass** for the uhttpd process itself (0.61 % abs, Δ +0.50; 3 clients Δ +1.15). The lease renewals are CGI children and add ~1.1 % per tab (≈55 ms CPU per renewal at `renew_s` 5); counted in, 1 client is Δ +1.63 %, which the budget did not include.
- Broker sampler ≤ 1.0 %: **FAIL.** Δ +1.17 % (absolute 1.90 %, stable across all runs and the soak); per-thread, `qmi-sampler` alone is 1.37 % at 5 Hz, ≈ 2.9 ms CPU per sample, with no fsync in `write_atomic` (no strace/perf on device to break it down further).
- System Δ ≤ 3 % (3 clients ≤ 4 %): **pass** if read as % of all cores (+1.25 / +1.61 pp); **fail** if read as one core (+5.0 / +6.4 %). The one-core reading matches how uhttpd + broker budgets sum (2.5 ≤ 3), so treat as unresolved.
- Zero 503s/timeouts on other CGIs during 10 min of aim: **pass** (0 / 295 in both 10-min runs, both builds). The 1 h soak had 2 `fetch_data.sh` failures (untimed, max 3.09 s), most likely in the two SSR windows.
- `fetch_data.sh` p95 Δ ≤ +20 ms: **pass** (−0.8 ms over 10 min; a short 3-min baseline read 87.7 ms, so only the 10-min pair is comparable).
- Static GET p95 ≤ 80 ms: **pass** (p50 6.6–7.2, p95 8.3–8.9 ms HTTP and HTTPS; the ~40 ms keepalive floor seen in the quick benchmark did not reproduce from these clients).
- Delivered ≥ 4.5 Hz: **pass** (4.73–4.79 Hz; the aim period is 208–212 ms, not 200, because the sleep follows the sample). Zero lost: **fail** in 2 of 6 PC runs. Server seq is contiguous; every loss is a client request stalling longer than the 16-sample ring (~3.4 s): one 10 s request timeout in each of two runs (the 10-min run on this build, untimed, and 15:03 in the soak; no device-side trace, the log ring had wrapped; the 10-min run on the earlier b74f1eee build had 0 errors and 0 lost) and two "connection forcibly closed" errors that coincide with the two SSRs.
- Poller `measure.sh`: **pass.** 5.96 % with aim leased vs 5.73 % same-session baseline (+0.23 pp; +0.40 vs this morning's 5.56 %); period 2.01 s (1.93–2.23).
- 1 h soak: **FAIL as written.** 2 `remoteproc-mss` SSRs (crash #5 at uptime 26397 s, #6 at 29427 s), `qmi_ssr_count` 0 → 2. Both are `nr_rx_ctl_agc.c:7563 RXCTL_IUSS: RFG 0 rx 0 state is wrong`, the same NR RX AGC fault as crashes #1–#4 earlier in this boot, which happened with no live lease (uptime 1047, 2415, 8455, 20446 s; intervals 1368 / 6040 / 11991 / 5951 s, then 3030 s during the soak). Attribution to 5 Hz QMI reads is neither shown nor excluded by 1 h. The broker rode both SSRs (no restart, `qmi_state` back to `up`, live file kept publishing). fd 12–13, RSS 524–612 kB, threads 10: flat.

**Functional checks (all pass):** proto `proto=3 version=0.4.0 qmi=1 live=1`; `/www/qmlive` → `/var/run/qmanager/live` (root 0755, empty `index.html`) under the 0700 run dir; `GET /qmlive/` 200 with an empty body (HTTP and HTTPS); `/qmlive/../cgi-bin/` 403; wrong token 404; unauthenticated lease 401 and no stamp written; aim lease → file 40–190 ms after the CGI returns (5 trials); aim ≈ 4.77 Hz, watch-only 1004–1012 ms, aim+watch 203–216 ms; expiry: token and file gone 10.08 s and 10.54 s after the last renewal (integer-second stamps, so worst case is ~11.2 s), then `qmi.env` back to every 2 s; scan flag → `"scan":true` with every serving field `null`, recovers on the next sample; `kill -9` → procd respawn in ~5 s, same token, new `run`, seq restarts; keys are `v run seq period_ms qmi_state ssr_count scan` + per sample `seq t reg rsrp rsrq rssi pci earfcn band bw ca` (no cell id / TAC / MCC / MNC / operator; CA list was empty on this cell, so CA keys are covered by unit tests only); `tools/atd-parity`: 50 cases, only the 8 expected live cases (31–34, 37–40) differ from both the 0.2.0 and 0.3.0 runs; init.d `stop` (43cf2d94) → broker gone, `live/`, `qmi.env`, stamps, token, lock, `/www/qmlive`, proto and `/tmp/qmanager_qmi.json` absent and still absent 6 s later; `start` → link and `live/index.html` back; `qmanager` stop removes `qmi.stamp`; rollback to 0.3.0 → lease answers `{"success":true,"available":false}` with no stamp written.

**Notes for the next steps:** a lease minted cold returns before the first file exists, so a client that fetches immediately gets one 404 (seen in 5 of 6 PC runs): the store should wait one period before its first fetch, or not count that 404. With a rolled-back 0.3.0 the new init.d still creates `/www/qmlive` (dangling, harmless 404). uhttpd here runs `-n 3` (3 concurrent CGIs), and each tab's renewal takes a slot every 5 s.

**Acceptance thresholds** (all must hold):
- Static 5 Hz, 1 client: uhttpd ≤ 1.5 %, broker sampler ≤ 1.0 %, system Δ ≤ 3 % (3 clients: ≤ 4 %).
- Zero 503s/timeouts on other CGIs during 10 min of `aim`; `fetch_data.sh` p95 Δ ≤ +20 ms.
- Static GET p95 ≤ 80 ms on LAN (keepalive floor ~40 ms, see above); delivered rate ≥ 4.5 Hz, zero lost samples after ring merge.
- Poller `measure.sh` active ≤ 10 % and within +0.5 pp of the 4.9 % baseline; period 2.0 ± 0.2 s.
- 1 h soak at 5 Hz: no `remoteproc-mss` SSR in `dmesg`, `qmi_ssr_count` unchanged, broker fd/RSS/threads flat.

### 4b. Gate outcome and re-plan (PROPOSED, awaiting OK)

Every functional check passed; three thresholds failed and one is ambiguous (results above). Proposed response:

| Threshold | Result | Diagnosis | Proposal |
|---|---|---|---|
| Broker ≤ 1.0 % | +1.17 % (sampler 2.9 ms/sample) | Each 5 Hz sample writes three files: live JSON, `qmi.env`, `qmanager_qmi.json` | **R1.** Write `qmi.env` + `qmanager_qmi.json` at most every 2 s (the poller only needs ≤ 2 s; `qmi.stamp` gate unchanged); only the live JSON goes at the live rate. Schedule samples against a fixed deadline (fixes the 210 ms drift). Re-measure; keep the 1.0 % gate. |
| Zero lost samples | 36 / 98 lost in 2 of 6 runs | Server seq is contiguous; losses are client stalls > 3.4 s (16-sample ring): two 10 s keepalive timeouts, two connection resets at SSRs | **R2.** Ring 16 → 32 (~6.5 s at 5 Hz, ~4 KB file). The store's new 2 s poll abort already cuts the 10 s stalls. Gate becomes: no loss outside SSR / link-drop windows. |
| 1 h soak, no SSR | 2 SSRs (`nr_rx_ctl_agc.c` RFG fault) | Same signature as 4 SSRs earlier this boot with no lease (gaps 1368–11991 s); 1 h can't tell. Broker rode through both, resources flat | **R3.** Not a blocker for building the UI; run a longer A/B soak (3 h lease vs 3 h no lease) before merge. If SSR rate rises with the lease, fall back to `aim` at 2–2.5 Hz (one constant). |
| System Δ ≤ 3 % | +1.25 pp of 4 cores (+5.0 % of one core) | Lease renewals cost ~55 ms CPU each (≈ 1.1 % per tab at `renew_s` 5) | **R4.** Read the gate as the sum of components (uhttpd + CGI + broker) ≤ 3 % of one core after R1; if still over, renew every 7 s with TTL 15 s. |

## 5. Validation per step

**Step 1 (on device):** `parse_at.sh` diff empty and `parity.sh` 216 fixtures PASS; `status_parity.sh all|live` 200/200 with new keys; `sidecar_parity.sh` qmi.env accept/reject + no fork; `measure.sh` gates. Live: deep tier flips `lte.source=qmi` on non-AT cycles with `mono - device.qmi_read_mono` ≤ 3; `lte.source=at` + frozen during a scan; no merge with broker stopped / `qmi_state=down` / unregistered / PCI-EARFCN mismatch; no spurious `events.sh` band/PCI/`ca_change` over 30 min; forced jq composer emits the same keys; `qmanager_tower_failover` reads fresh `.lte.rsrp` in deep.

**Step 2:** `cargo test --release` (± `--features poll`) with new tests: stamp parsing (leading zero, future, garbage, symlink, foreign uid), tier → period + aim beats watch, token validation/path safety, ring/seq/run reset, expiry deletes under lock, hygiene, scan gate, identifier keys absent, env contract unchanged (38 names). On device: lease → file within 300 ms; `GET /qmlive/` empty; wrong token 404; unauthenticated lease 401; expiry deletes within 10.5 s and cadence returns to 2 s; aim+watch = 200 ms, watch = 1 s; `kill -9` respawn republishes with new `run`; 0.3.0 broker → `available:false`; §4 gates; install/OTA/uninstall leave no strays; Phase 1 parity suite (`tools/atd-parity`) byte-identical.

**Steps 3–5, 7:** `bun test lib/live-signal-store.test.ts` (dedupe, run reset, 404 re-lease/backoff, hidden stops both timers, idle demotion, stale); tsc, lint, `bun run icons:check`, i18n in all five catalogs, debug-copy grep. Browser on device: ~5 req/s on the antenna page, 1/s on the dashboard; hidden tab → 0 and lease lapses; wall-clock step changes nothing. Impeccable critique of console and dashboard card.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Capability token leaks via uhttpd listing | Empty `index.html` kept + verified every publish; `GET /qmlive/` check; token rotates per lease episode |
| Location data exposed unauthenticated | Field allow-list renderer; test asserts cell ID/TAC/MCC/MNC/operator absent; full `qmanager_qmi.json` never under `/www` |
| Frontend install wipe deletes `/www/qmlive` | `at_live_link` after `install_frontend` and on every `qmanager_atd` start |
| Future uhttpd stops following symlinks | Client 404 → `unavailable`, 2 s tier still works; fallback design: tmpfs mount at `/www/qmlive` (not built) |
| 5 Hz QMI reads destabilise the baseband | Phase 0 ran 10 Hz cleanly; 1 h soak gate; idle demotion; 200 ms floor |
| Merge mixes AT/QMI state or retunes events | Overlay apply/restore around `write_cache` only; identity + registration + freshness gates; never on the scan path |
| Mid-scan QMI serving rows are scanned carriers | Sampler scan gate; no merge on early-return path |
| CGI slot pressure from renewals | One renewal per tab per 5 s (~30–60 ms), measured in §4 |
| CGI/broker lock contention | `flock -w 1` in CGI; broker try-lock only; dedicated lock, not the modem lock |
| Rollback mismatch (new UI, old broker) | `live=1` check → `available:false` |
| QMI RSRQ/RSSI differ from AT (90 % / 95 % within tolerance) | Labelled live serving values; `lte.source` exposes origin; SINR never from QMI |

## 7. Rollback
Each step is a separate revertable commit. Reinstalling the previous release works: 0.3.0 ignores stamps and never writes `/tmp/qmanager_live`; the old install wipe removes the link; an old poller ignores `qmi.env`. Broker/link absent → UI drops to 2 s via `available:false` or 404 → `unavailable`. The step 1 overlay can be disabled per device by removing `/usr/lib/qmanager/qmi_merge.sh` (guarded source → stubs → AT-only).

## 8. Decisions needed (recommendation first)
- **D1. CA gap-fill: skip in Phase 2; no `network.ca_source`.** `t2_carrier_components` carries per-carrier RSRP/RSRQ/SINR and the NR SCC that QMI CA can't supply; rebuilding it would null per-carrier signal and drop NR in NSA. LTE serving gap-fill still applies.
- **D2. No merge and no live serving cell during scan / SIM-switch suppression** (deviates from the §2b table because of the mid-scan EARFCN gotcha).
- **D3. Step 6: defer** (keep the QENG crash gate); alternative: QMI veto only.
- **D4. Dashboard `watch` rate: 1 Hz** (alternative 2 Hz; one constant).
- **D5. Step 7: optional** (frozen-during-scan reference strip, or drop).

## 9. Not in scope / needs separate approval
- NAS Config Signal Info v2 (`0x006C`, config write) — being evaluated in a separate session; if it's a GO, live SINR/NR becomes a follow-up.
- NAS `0x0003` indication registration (push sampling); live NR/SINR/per-antenna.
- Websocket, SSE, long-poll CGIs or a separate port; uhttpd config changes (`no_dirlists`, `max_requests`).
- Live channel on the public pre-auth splash; Prometheus live metrics; recorder scoring from live data.
- Removing `QENG`/`QCAINFO` from the poller; replacing the `radio_details` QENG RAT gate (needs SA validation); the parked `POLL` verb; five-stop signal quality.
