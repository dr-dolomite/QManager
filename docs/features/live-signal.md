# Live Signal (real-time LTE serving signal)

While an authenticated page asks for it, the broker (`qmanager_atd` 0.4.0) samples the LTE serving cell over QMI at up to 5 Hz and publishes a small identifier-free JSON file that `uhttpd` serves as a plain static file. The Antenna Alignment console reads it at 200 ms (`aim`), the dashboard at 1 s (`watch`); everything else stays on the 2 s `status.json` path. The lane exists so a person turning an antenna sees RSRP move as they turn it, without CGI polling (a CGI costs about 20x the CPU of a static file and `uhttpd` runs only 3 concurrent CGIs).

Design and the device gate: [`../plans/2026-10-22-qmi-phase2-live-tiers.md`](../plans/2026-10-22-qmi-phase2-live-tiers.md) (rules L1-L7 below are its section 1). The QMI lane itself: [`qmi-lane.md`](qmi-lane.md). Broker process model: [`at-broker.md`](at-broker.md). The poller's gap-fill overlay: [`adaptive-polling.md`](adaptive-polling.md#13-the-qmi-overlay-wraps-the-final-write_cache-only). UI consumer: [`antenna-alignment.md`](antenna-alignment.md#live-lead-qmi-phase-2).

## Quick Reference

| Item | Value |
|---|---|
| Lease CGI | `POST /cgi-bin/quecmanager/cellular/live_signal.sh?tier=aim\|watch` (`scripts/www/cgi-bin/quecmanager/cellular/live_signal.sh`) |
| Lease stamps | `/var/run/qmanager/qmi_live_aim`, `qmi_live_watch` (one line: `/proc/uptime` integer seconds) |
| Token | `/var/run/qmanager/qmi_live.token` (64 lowercase hex) |
| Lock | `/var/run/qmanager/qmi_live.lock` (CGI `flock -n` loop, broker try-lock) |
| Public dir | `/var/run/qmanager/live` (root `0755`, always holds an empty `index.html`) |
| Web link | `/www/qmlive` -> `/var/run/qmanager/live` (`at_live_link` in `at_engine.sh`) |
| Capability URL | `/qmlive/<token>.json` |
| Broker code | `native/qmanager_atd/src/daemon/live.rs` (lease, token, ring, renderer), `daemon/qmi_snapshot.rs` (sampler, cadence) |
| Capability | `/var/run/qmanager_atd.proto` has `qmi=1` and `live=1` (broker 0.4.0, wire still proto 3) |
| Frontend | `lib/live-signal-store.ts` (shared store), `hooks/use-live-signal.ts`, `types/live-signal.ts` |
| Consumers | `components/cellular/antenna-alignment/{use-live-lead.ts,live-aim.tsx,live-sparkline.tsx}`, `components/dashboard/signal-rows.ts` (`useLiveLteOverlay`) |
| Lease CGI errors | `bad_tier`, `lease_failed`; `{"success":true,"available":false}` when the broker cannot serve it |

## Flow

1. The page POSTs the lease CGI (at subscribe, every 5 s, and on becoming visible). The CGI writes the tier's stamp and returns the capability URL.
2. The broker's sampler sees a fresh stamp, switches to that tier's period and, on each sample, appends to a 32-sample ring and rewrites `<token>.json`.
3. The page polls `GET /qmlive/<token>.json` at `period_ms` and merges samples by `seq`.
4. The page stops renewing; about 10 s later no stamp is fresh and the broker deletes the token and the file, then drops back to 2 s.

Lease response:

```json
{"success":true,"available":true,"url":"/qmlive/<64hex>.json","period_ms":200,"renew_s":5,"ttl_s":10}
```

`period_ms` is 200 for `aim`, 1000 for `watch`. The CGI is `printf`-only (no `jq`), reads no body and costs about 3 forks per renewal.

## Rules (L1-L7)

- **L1. No client number reaches the broker.** The CGI accepts only `tier=aim|watch` (a shell `case` on `QUERY_STRING`; anything else is `bad_tier`). The stamp holds `/proc/uptime`'s integer part, the same `CLOCK_BOOTTIME` second the broker reads, so wall-clock steps (NTP/NITZ after an SSR) cannot hold a lease up. The broker accepts a stamp only if it is a regular file owned by its euid, opened `O_NOFOLLOW`, digits only (no leading zero, at most 10), not in the future and at most 10 s old. Tier maps to a compiled period: `aim` 200 ms, `watch` 1 s, none 2 s. The 200 ms floor (`MIN_PERIOD`) stays.
- **L2. Many tabs.** One stamp per tier (no shared read-modify-write). The effective period is the fastest fresh tier, so `aim` beats `watch`. All authenticated tabs share one token per lease episode (single-admin device; the content is non-identifying).
- **L3. Token = capability URL.** Exactly 64 lowercase hex, minted by the CGI (`qm_generate_token`) under the lock when absent or invalid, written atomically with a `$$` temp + `mv -f` (allowed only inside the root-only run dir, see [`safe-tmp.md`](../reference/safe-tmp.md)). The token **rotates per lease episode**: on expiry the broker try-locks the lock file (busy: retry next slice), re-checks the stamps under the lock, deletes the token, the public file and its `.new`, and clears its ring. The broker validates the token (64 hex) before it builds any path from it.
- **L4. Public dir.** `/var/run/qmanager/live`, made a real `0755` directory by `safefs::ensure_own_dir` and verified before every publish. It always holds an **empty `index.html`**. Hygiene on start, on a token change and on expiry deletes everything except `index.html` and the current `<token>.json`. Files are written with `safefs::write_atomic`.
- **L5. File format** (about 4 KB at a full ring, compact JSON, below).
- **L6. Capability.** The CGI answers `available:false` unless `/usr/bin/qmi` is executable and the proto file has `qmi=1` **and** `live=1`. A rolled-back broker never writes `live=1`, so the UI falls back to the 2 s tier instead of looping on 404.
- **L7. Phase 1's `/tmp/qmanager_qmi_live` mtime lease is retired.** The broker ignores it (world-writable `/tmp`, wall-clock based). `init.d` stop and `uninstall.sh` still remove the old path so an upgrade leaves nothing behind.

## File format

```json
{"v":1,"run":812345,"seq":4711,"period_ms":200,"qmi_state":"up","ssr_count":0,"scan":false,
 "samples":[{"seq":4711,"t":812999,"reg":true,"rsrp":-955,"rsrq":-85,"rssi":-580,
             "pci":295,"earfcn":150,"band":"B1","bw":20,
             "ca":[{"band":"B3","earfcn":1275,"pci":12,"bw":15,"active":true}]}]}
```

| Field | Meaning |
|---|---|
| `v` | Format version, `1`. |
| `run` | Daemon start in boot-clock ms. A changed value means the broker restarted: the client resets its ring. |
| `seq` | Newest sample's sequence. Grows for the whole daemon run, across lease episodes. |
| `period_ms` | Cadence the broker is currently sampling at. |
| `qmi_state` | `up`, `down` (SSR window, modem not ready) or `unavailable` (no QRTR/NAS). A failed read pushes no sample. |
| `ssr_count` | The daemon's SSR episode counter. |
| `scan` | `true` while the long/scan flag is up. |
| `samples[]` | Up to 32, oldest first. `t` is boot-clock ms (not comparable to the browser clock). Signals are integers x10 (`-955` = -95.5 dB), no floats; every serving field is `null` unless registered and while `scan` is true. `ca` lists SCCs only. |

**The file never contains** cell ID, TAC, eNodeB/sector, MCC/MNC, operator, IMSI or any other identifier; a unit test asserts their absence. **Why:** the URL is unauthenticated (anyone who knows the token can fetch it), so the renderer is an allow-list. The full bundle stays in `/tmp/qmanager_qmi.json`, never under `/www`.

**Scan gate.** Mid-scan the QMI serving EARFCN follows the scanned carriers, so a sample taken while the long flag is up carries `scan:true` and null serving fields instead of a scanned cell's power.

## Broker cadence (R1/R2)

Landed with this phase (0.4.0) after the device gate (plan section 4b):

- **Samples run on a fixed deadline grid** (`next_deadline`), so `aim` delivers 5.0 Hz instead of drifting to ~4.75 Hz.
- **`qmi.env` and `qmanager_qmi.json` are written at most every 2 s** whatever the tier (`sidecar_due`), and at once when `qmi_state` or the SSR count changes and on the first sample. Only the live file follows the lease rate. **Why:** three file writes per 200 ms sample cost the sampler 1.37 % of a core; the poller only needs the sidecar at most a few seconds old.
- **Ring 16 -> 32** (about 6.4 s at 5 Hz) so a client request stalled for a few seconds still merges without loss.
- The sampler re-checks the stamps every `min(period, 250 ms)`. Expiry is therefore at most about 11 s after the last renewal (whole-second stamps plus the 10 s TTL); measured 10.1-10.5 s.
- **Re-read the boot clock before the expiry re-check.** A renewal can land between the slice's check and the lock, stamped with a later second than the slice's clock value; compared against that stale value it reads as "in the future" (not fresh) and would be deleted.

## Frontend store and states

`lib/live-signal-store.ts` is a pure module (fetch, timers, visibility, input and `now` injected; pattern of `modem-status-store.ts`) with one shared lease and one poll loop for every `useLiveSignal()` consumer; `lib/live-signal-store.test.ts` covers it.

| State | When |
|---|---|
| `connecting` | Before the first sample. A fresh url may 404 for 2 periods + 500 ms (the broker has not published yet); that 404 is not counted as a failure. |
| `live` | A new `seq` arrived within 3 periods and the file says `qmi_state=up`, registered, `scan:false`. |
| `stale` | No new `seq`, `qmi_state` not `up`, `reg:false` or `scan:true`. The last value stays. |
| `paused` | The tab is hidden. |
| `unavailable` | Lease said `available:false`, or the failure ladder was exhausted. |

- **Tier = fastest subscriber.** `setTier` changes the subscriber's tier without a reset or a new subscription.
- **Polling** is a non-overlapping `setTimeout` chain at `period_ms` with `fetch(url, {cache:"no-store", credentials:"omit"})`. `uhttpd` sends an ETag that changes on every atomic rename and no `Cache-Control`, so `no-store` is mandatory. Do not use `keepalive:true`.
- **2 s poll abort** (`max(2 s, 4 periods)`): a stalled request is aborted and counted as a failure, so the 10 s keep-alive stalls seen on the gate cannot open a gap larger than the ring.
- **Failure ladder:** a failed poll (404 past the grace, network, bad body) or a lease error re-leases at once, then backs off 1 / 2 / 5 s (`LIVE_RETRY_DELAYS_MS` = 0/1/2/5 s); one more failure and the store is `unavailable` until the tab becomes visible again or the consumer remounts.
- **Hidden tab stops polling and renewal**; the broker's lease lapses within about 11 s.
- **Idle demotion:** `aim` becomes `watch` after 10 min without pointer/keyboard/wheel input; the next input restores `aim`.
- **Client ring** is 150 samples (30 s at 5 Hz), deduped by `seq`; only a changed `run` resets it.
- The page clock is read in effects/timers, never in render.

## Lifecycle

- **`init.d/qmanager_atd` start** re-asserts `/www/qmlive` (`at_live_link`: replaces a wrong link, never writes through a real directory, idempotent).
- **`service_stopped`** (runs after procd has killed the broker) waits up to about 5 s for the pid to exit, then removes `qmi.env`, `qmanager_qmi.json`, the old `/tmp/qmanager_qmi_live`, the `/www/qmlive` link, `/var/run/qmanager/live`, any `/tmp/qmanager_live` an earlier build left, the two stamps (+ CGI temps), the token and the lock. **Why after the kill:** the live broker keeps rewriting the env and can recreate `live/index.html` until it is gone.
- **`init.d/qmanager`** stop removes `qmi.stamp` (the poller owns it).
- **`install.sh`** runs `at_live_link` after `install_frontend` on a fresh install because the frontend's `/www/*` wipe removes the link. For a frontend-only/OTA path it re-runs the link in a **subshell**: sourcing the previous release's `at_engine.sh` into the installer shell would set `_AT_ENGINE_LOADED` and shadow the new library.
- **`uninstall.sh`** removes the link, the public dir, the stamps, token, lock and `qmi.stamp`.
- No UCI. No static-export route may be named `qmlive`. `next.config.ts` carries a commented `/qmlive/:path*` rewrite beside the commented `cgi-bin` one for `next dev`.

## Invariants

- **The public dir lives under the root-only run dir, never `/tmp`.** A web-root symlink into world-writable `/tmp` would let a local user plant the target. See [`safe-tmp.md`](../reference/safe-tmp.md).
- **`index.html` stays empty and present.** `uhttpd` directory listing is on (no `-D`); without it `GET /qmlive/` would list the token. Verified on every publish.
- **Never add an identifier to the file.** Allow-list renderer only.
- **No client number reaches the broker.** Do not add a rate/period parameter to the CGI.
- **The lock is `flock -n` in a retry loop.** BusyBox `flock` has no `-w`. The CGI tries up to 10 times, 0.1 s apart (`lease_failed` after about 1 s). The broker only try-locks.
- **Probe the lock file with `true >>`, not `:`.** A failing redirect on the special builtin `:` aborts an ash script; `true` survives and the CGI can report `lease_failed`. The lock fd is opened with `exec 9>>` only after the probe.
- **Stamps are uptime integers.** A wall-clock stamp would let an NTP step hold the lease up or drop it.
- **Keep the sidecar value set.** `qmi_merge.sh` accepts only `[A-Za-z0-9_='-]` in the env; the broker must keep every `qmi.env` value inside it (see [`adaptive-polling.md`](adaptive-polling.md#13-the-qmi-overlay-wraps-the-final-write_cache-only)).
- **The lead is the serving cell across all chains, not port 1.** Copy and layout must never imply the live RSRP is Main/PRX.

## Rollback

Each build step is a separate revertable commit. Reinstalling the previous release works: 0.3.0 ignores stamps and never writes `live=1`, so the lease CGI answers `available:false` and the UI stays on 2 s; the old install wipe removes the link; an old poller ignores `qmi.env`. A rolled-back 0.3.0 with the new `init.d` still creates `/www/qmlive` (dangling, harmless 404). If the broker or link is absent the UI drops to `unavailable` and renders as before. The poller overlay is disabled per device by removing `/usr/lib/qmanager/qmi_merge.sh`.

## Gotchas

- A lease minted cold returns before the first file exists; a client that fetches immediately gets one 404. The store waits out the publish grace instead of counting it.
- `uhttpd` runs `-n 3` (3 concurrent CGIs device-wide) and every open tab spends a slot for about 55 ms every 5 s. Do not add per-tick CGI calls.
- `uhttpd` follows a `/www` symlink into the run dir today. A future `uhttpd` that stops following links turns the feed into 404 -> `unavailable` (the 2 s tier keeps working); the fallback design would be a tmpfs mount at `/www/qmlive`, not built.
- Signal values are integers x10; the dashboard rounds to whole dB only at display (`wholeDb`), the antenna lead keeps 0.1 dB.
- RSRQ/RSSI from QMI differ slightly from AT (90 % / 95 % within tolerance); SINR, NR and per-antenna values never come from QMI.

## Device gate (2026-10-22, RM551E, broker 0.4.0)

Every functional check passed: capability line `proto=3 version=0.4.0 qmi=1 live=1`; `GET /qmlive/` 200 with an empty body (HTTP and HTTPS); `/qmlive/../cgi-bin/` 403; wrong token 404; unauthenticated lease 401 with no stamp written; file 40-190 ms after a lease; `aim` about 4.77 Hz, `watch` 1.0 s, `aim`+`watch` 203-216 ms; token and file gone 10.1-10.5 s after the last renewal; `scan:true` with null serving fields; `kill -9` respawn republishes with a new `run`; `tools/atd-parity` differs from 0.2.0/0.3.0 only in the 8 expected live cases; rollback to 0.3.0 answers `available:false`. Poller `measure.sh` 5.96 % with `aim` leased vs 5.73 % baseline; `fetch_data.sh` p95 unchanged; static GET p95 8-9 ms; zero 503s on other CGIs in two 10 min runs.

Thresholds that failed on the first build, and the response (plan section 4b, approved R1-R4):

| Threshold | Result | Response |
|---|---|---|
| Broker <= 1.0 % | +1.17 % (three file writes per sample) | R1: sidecars at most every 2 s, fixed-deadline pacing (landed) |
| Zero lost samples | 36 / 98 lost in 2 of 6 runs (client stalls beyond the 16-sample ring, two resets at SSRs) | R2: ring 32 plus the 2 s poll abort (landed); gate = no loss outside SSR / link-drop windows |
| 1 h soak without SSR | 2 `remoteproc-mss` SSRs (`nr_rx_ctl_agc.c` RFG fault), the same signature as 4 earlier SSRs that boot with no lease | R3: not a UI blocker; longer A/B soak before merge |
| System delta <= 3 % | +1.25 pp of 4 cores (+5.0 % of one core) | R4: read as the sum of uhttpd + CGI + broker <= 3 % of one core after R1; if still over, renew every 7 s with TTL 15 s |

**Open before merge:** the 3 h A/B soak (lease vs no lease) for SSR rate; if the rate rises with the lease, drop `aim` to 2-2.5 Hz (one constant in `live.rs`). The post-R1/R2 re-measurement of broker CPU and lost samples is not recorded in the plan yet.
