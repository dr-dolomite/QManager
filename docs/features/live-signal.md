# Live Signal (real-time LTE serving signal)

While an authenticated page asks for it, the broker (`qmanager_atd` 0.5.0) samples the LTE serving cell over QMI at 1 Hz and publishes a small identifier-free JSON file that `uhttpd` serves as a plain static file. The Antenna Alignment console (`aim`) and the dashboard (`watch`) both read it at 1 s (5 Hz `aim` is parked, see [Cadence decision](#cadence-decision-2026-10-23)); everything else stays on the 2 s `status.json` path. The lane exists so a person turning an antenna sees RSRP move as they turn it, without CGI polling (a CGI costs about 20x the CPU of a static file and `uhttpd` runs only 3 concurrent CGIs).

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
| Capability | `/var/run/qmanager_atd.proto` has `qmi=1` and `live=1` (broker 0.4.0+, wire still proto 3) |
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
{"success":true,"available":true,"url":"/qmlive/<64hex>.json","period_ms":1000,"renew_s":5,"ttl_s":10}
```

`period_ms` is 1000 for both tiers (it was 200 for `aim` while 5 Hz was live). The CGI is `printf`-only (no `jq`), reads no body and costs about 3 forks per renewal.

## Rules (L1-L7)

- **L1. No client number reaches the broker.** The CGI accepts only `tier=aim|watch` (a shell `case` on `QUERY_STRING`; anything else is `bad_tier`). The stamp holds `/proc/uptime`'s integer part, the same `CLOCK_BOOTTIME` second the broker reads, so wall-clock steps (NTP/NITZ after an SSR) cannot hold a lease up. The broker accepts a stamp only if it is a regular file owned by its euid, opened `O_NOFOLLOW`, digits only (no leading zero, at most 10), not in the future and at most 10 s old. Tier maps to a compiled period: `aim` 1 s, `watch` 1 s, none 2 s, with a 1 s floor (`MIN_PERIOD`). `aim` keeps its own stamp and stays the faster-or-equal tier so 5 Hz can return by changing `AIM_PERIOD` and `MIN_PERIOD` in `live.rs` and the CGI's `period_ms`.
- **L2. Many tabs.** One stamp per tier (no shared read-modify-write). The effective period is the fastest fresh tier, so `aim` beats `watch`. All authenticated tabs share one token per lease episode (single-admin device; the content is non-identifying).
- **L3. Token = capability URL.** Exactly 64 lowercase hex, minted by the CGI (`qm_generate_token`) under the lock when absent or invalid, written atomically with a `$$` temp + `mv -f` (allowed only inside the root-only run dir, see [`safe-tmp.md`](../reference/safe-tmp.md)). The token **rotates per lease episode**: on expiry the broker try-locks the lock file (busy: retry next slice), re-checks the stamps under the lock, deletes the token, the public file and its `.new`, and clears its ring. The broker validates the token (64 hex) before it builds any path from it.
- **L4. Public dir.** `/var/run/qmanager/live`, made a real `0755` directory by `safefs::ensure_own_dir` and verified before every publish. It always holds an **empty `index.html`**. Hygiene on start, on a token change and on expiry deletes everything except `index.html` and the current `<token>.json`. Files are written with `safefs::write_atomic`.
- **L5. File format** (about 4-5 KB at a full 32-sample ring, compact JSON, below).
- **L6. Capability.** The CGI answers `available:false` unless `/usr/bin/qmi` is executable and the proto file has `qmi=1` **and** `live=1`. A rolled-back broker never writes `live=1`, so the UI falls back to the 2 s tier instead of looping on 404.
- **L7. Phase 1's `/tmp/qmanager_qmi_live` mtime lease is retired.** The broker ignores it (world-writable `/tmp`, wall-clock based). `init.d` stop and `uninstall.sh` still remove the old path so an upgrade leaves nothing behind.

## File format

```json
{"v":1,"run":812345,"seq":4711,"period_ms":1000,"qmi_state":"up","ssr_count":0,"scan":false,
 "samples":[{"seq":4711,"t":812999,"reg":true,"rsrp":-955,"rsrq":-85,"rssi":-580,"sinr":264,
             "nr_rsrp":-890,"nr_rsrq":-110,"nr_sinr":250,"pci":295,"earfcn":150,"band":"B1","bw":20,
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
| `samples[]` | Up to 32, oldest first. `t` is boot-clock ms (not comparable to the browser clock). Signals are integers x10 (`-955` = -95.5 dB), no floats; signals (`rsrp`/`rsrq`/`rssi`) are `null` unless registered; `pci`/`earfcn`/`band`/`bw` can still name the last camped cell while `reg:false` (the client treats `reg:false` as stale); every serving field is `null` while `scan` is true. `ca` lists SCCs only. |
| `samples[].sinr`, `nr_rsrp`, `nr_rsrq`, `nr_sinr` | Added in 0.5.0, same x10 integers, placed after `rssi`. LTE SINR and NR (NSA) values from NAS Signal Info. `null` in the same cases as `rsrp` (unregistered or scan), and `nr_*` is `null` when there is no NR reading. |

**SINR and NR (0.5.0).** The broker holds the modem's signal config live, so Signal Info stays current while the broker runs ([`qmi-lane.md`](qmi-lane.md#signal-config-hold-nas-0x006c-broker-050)). `nr_rsrp` is the **mean of the NR RX chains**, the quantity `AT+QRSRP` reports. It is not QENG's strongest-chain value, so do not compare the two as the same number. Older brokers (before 0.5.0) omit these keys. `types/live-signal.ts` marks them optional, and `sampleDb()` returns them as `sinr`, `nrRsrp`, `nrRsrq` and `nrSinr`, with a missing key as `null`.

**The file never contains** cell ID, TAC, eNodeB/sector, MCC/MNC, operator, IMSI or any other identifier; a unit test asserts their absence. **Why:** the URL is unauthenticated (anyone who knows the token can fetch it), so the renderer is an allow-list. The full bundle stays in `/tmp/qmanager_qmi.json`, never under `/www`.

**Scan gate.** Mid-scan the QMI serving EARFCN follows the scanned carriers, so a sample taken while the long flag is up carries `scan:true` and null serving fields instead of a scanned cell's power.

## Broker cadence (R1/R2)

Landed with this phase (0.4.0) after the device gate (plan section 4b), measured at the then-current 5 Hz `aim`:

- **Samples run on a fixed deadline grid** (`next_deadline`), so `aim` delivers 5.0 Hz instead of drifting to ~4.75 Hz.
- **`qmi.env` and `qmanager_qmi.json` are written every 2 s** whatever the tier (`sidecar_due`, with a 100 ms scheduling slack so jitter on the 200 ms grid cannot push a write to 2.2 s), and at once when `qmi_state` or the SSR count changes and on the first sample. Only the live file follows the lease rate. With no lease they are written every 2 s sample, as before. **Why:** three file writes per 200 ms sample cost the sampler 1.37 % of a core; the poller only needs the sidecar at most a few seconds old.
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
- **Client ring** is 150 samples (150 s at 1 Hz; sized for 30 s at the parked 5 Hz), deduped by `seq`; only a changed `run` resets it.
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

Each build step is a separate revertable commit. Reinstalling the previous release works: 0.3.0 ignores stamps and never writes `live=1`, so the lease CGI answers `available:false` and the UI stays on 2 s; the old install wipe removes the link; an old poller ignores `qmi.env`. A rolled-back 0.3.0 with the new `init.d` still creates `/www/qmlive` (dangling, harmless 404). If the broker or link is absent the UI drops to `unavailable` and renders as before. For 0.5.0 the previous release is 0.4.1: it ignores the new sample keys and `qmi_sig_config`, and the UI never read them. A rollback does not undo the modem's signal config; it clears at the next SSR or reboot. The poller overlay is disabled per device by removing `/usr/lib/qmanager/qmi_merge.sh`.

## Gotchas

- A lease minted cold returns before the first file exists; a client that fetches immediately gets one 404. The store waits out the publish grace instead of counting it.
- `uhttpd` runs `-n 3` (3 concurrent CGIs device-wide) and every open tab spends a slot for about 55 ms every 5 s. Do not add per-tick CGI calls.
- `uhttpd` follows a `/www` symlink into the run dir today. A future `uhttpd` that stops following links turns the feed into 404 -> `unavailable` (the 2 s tier keeps working); the fallback design would be a tmpfs mount at `/www/qmlive`, not built.
- Signal values are integers x10; the dashboard rounds to whole dB only at display (`wholeDb`), the antenna lead keeps 0.1 dB.
- RSRQ/RSSI from QMI differ slightly from AT (90 % / 95 % within tolerance). LTE SINR and NR values come from QMI only since 0.5.0; their agreement with AT is not measured on the device yet. Per-antenna values never come from QMI.
- **The dashboard and Antenna Alignment do not read the new fields yet.** Both still show AT SINR and NR. Live LTE SINR on the dashboard waits for an on-device QMI-vs-AT comparison.

## Device gate (2026-10-22, RM551E, broker 0.4.0)

Every functional check passed: capability line `proto=3 version=0.4.0 qmi=1 live=1`; `GET /qmlive/` 200 with an empty body (HTTP and HTTPS); `/qmlive/../cgi-bin/` 403; wrong token 404; unauthenticated lease 401 with no stamp written; file 40-190 ms after a lease; `aim` about 4.77 Hz, `watch` 1.0 s, `aim`+`watch` 203-216 ms; token and file gone 10.1-10.5 s after the last renewal; `scan:true` with null serving fields; `kill -9` respawn republishes with a new `run`; `tools/atd-parity` differs from 0.2.0/0.3.0 only in the 8 expected live cases; rollback to 0.3.0 answers `available:false`. Poller `measure.sh` 5.96 % with `aim` leased vs 5.73 % baseline; `fetch_data.sh` p95 unchanged; static GET p95 8-9 ms; zero 503s on other CGIs in two 10 min runs.

Thresholds that failed on the first build, and the response (plan section 4b, approved R1-R4):

| Threshold | First build | Response | Re-measure after R1/R2 |
|---|---|---|---|
| Broker <= 1.0 % | +1.17 % (three file writes per sample) | R1: sidecars every 2 s, fixed-deadline pacing | **Pass**, +0.80 % (sampler thread 1.37 -> 0.87 %) |
| Zero lost samples | 36 / 98 lost in 2 of 6 runs (client stalls beyond the 16-sample ring, two resets at SSRs) | R2: ring 32 plus the 2 s poll abort; gate = no loss outside SSR / link-drop windows | **Pass**, 5.00 Hz, 0 lost (3024 unique samples in 10 min) |
| 1 h soak without SSR | 2 `remoteproc-mss` SSRs (`nr_rx_ctl_agc.c` RFG fault), the same signature as 4 earlier SSRs that boot with no lease | R3: not a UI blocker; longer A/B soak before merge | Not re-run |
| System delta <= 3 % | +1.25 pp of 4 cores (+5.0 % of one core) | R4: read as the sum of uhttpd + CGI + broker <= 3 % of one core after R1 | **Pass**, 2.55 % of one core (uhttpd self 0.54 + CGI children 1.21 + broker 0.80); `renew_s` unchanged |

The re-measure ran on the RM551E, broker 0.4.0, 10 min at 5 Hz with one client, plus the 2 s authenticated `fetch_data.sh` probe. Static GET p50 6.9 / p95 8.5 ms; `fetch_data.sh` p95 moved +0.2 ms against the same-session baseline; zero errors on other CGIs.

**Sidecars under a lease (2026-10-23, RM551E, broker 0.4.0, `aim` leased):** `qmi.env` and `qmanager_qmi.json` are rewritten together every 2 s (mtimes stepped +2 s on every sample over 6 s), and the poller's status shows `lte.source=qmi` with `mono - device.qmi_read_mono = 2` on every one of five 2 s samples.

## Config signal hold (0.5.0, device gate 2026-10-23)

Host-tested (245 crate tests, 259 with `--features poll`) and deployed to the RM551E (boot `0aa7bf6b`, uptime 6.0 h at deploy, 5 SSRs before it). The sampler reads Signal Info as part of the bundle and the broker holds the NAS signal config; see [`qmi-lane.md`](qmi-lane.md#signal-config-hold-nas-0x006c-broker-050).

- **Capability:** `/var/run/qmanager_atd.proto` reads `proto=3 version=0.5.0 qmi=1 live=1`, the same four lines as 0.4.1.
- **Apply:** `qmi nas signal config applied` logged at broker start; `qmi_sig_config` in `/tmp/qmanager_qmi.json` reads `held`; `qcmd AT` still answers.
- **Signal Info is live:** 40 reads at 2 s, `qmi signal` vs `AT+QENG`. Under 0.4.1 (config not held) NR RSRP sat at -86.0 dBm for all 40 reads while AT moved -79 to -81. Under 0.5.0 NR RSRP changed on 24 of 39 steps (-82 to -84). It reads 1-3 dB below QENG because it is the chain mean. LTE SINR moves in both (27 and 26 changes), as the research found.
- **LTE SINR vs AT:** QMI 20.8-25.6 dB vs QENG 20-22 dB in the same window, about 2-4 dB higher. This is why the dashboard does not overlay live SINR yet; it needs a longer comparison first.
- **Live file:** under a `watch` lease the file runs at `period_ms:1000` with `sinr`, `nr_rsrp`, `nr_rsrq`, `nr_sinr` filled (e.g. `sinr:246, nr_rsrp:-820, nr_rsrq:-110, nr_sinr:315`) and no identifier keys; it was removed once the lease lapsed.
- **CPU:** 0.40 % of one core with no lease (0.4.1: 0.43 %) and 0.55 % under an `aim` lease (0.4.1: 0.57 %); RSS 592 kB (0.4.1: 528 kB), 10 threads, 12 fds.
- **Re-apply after SSR:** passed. SSR #6 (uptime 23794 s, 41 min after the deploy, the usual `nr_rx_ctl_agc.c:7563` RFG fault) took every QMI service down; the broker logged `qmi ssr detected (episode 1)`, the services came back, it logged `qmi nas signal config applied` again, `qmi_sig_config` read `held` with `qmi_ssr_count:1`, and NR RSRP kept moving.
- **SSR watch (open):** count SSRs per hour for 24 h against the history (5 SSRs in the 6.0 h of 0.4.1 on this boot, crashes #3 to #5 clustered at 2.8 h). If the rate rises, roll back to 0.4.1. The count runs in the dev-only watcher [`tools/ssr-watch/`](../../tools/ssr-watch/README.md), installed 2026-10-23 at uptime 24086 s: it survives reboots and keeps the 0.4.1 rollback binary on flash at `/usrdata/ssr_watch/qmanager_atd.041`. It records SSR #6 only as history (`event=start ssr_boot=6`), so add it to the 0.5.0 count by hand.

## Cadence decision (2026-10-23)

Live signal runs at **1 Hz in both tiers**, Antenna Alignment included ("it's already real time enough"). 5 Hz `aim` is **parked, not removed**: the two tiers, both stamps and the `tier=aim|watch` contract stay, so restoring it means changing `AIM_PERIOD` and `MIN_PERIOD` back to 200 ms in `native/qmanager_atd/src/daemon/live.rs` and the CGI's `aim` `period_ms` back to 200 (broker 0.4.1 -> next version). The frontend follows the lease's `period_ms`, so it needs no change either way.

Evidence (RM551E, one boot `0aa7bf6b`, the same `remoteproc-mss` / `nr_rx_ctl_agc.c` RFG fault signature throughout):

| Window | Lease | Duration | SSRs |
|---|---|---|---|
| Boot to 09:20:53 PHT (uptime 0-7456) | none (no tab) | ~124 min | 0 |
| Phase A, 09:20:53-10:23:00 | `aim` 5 Hz | 62 min | **5** (uptime 8241, 8302, 9992, 10141, 10168) |
| Phase B, 10:23:15-11:23:15 | none | 60 min | 0 |

Earlier unleased baseline on this unit: 4 SSRs in one boot with no lease (gaps 1368/6040/11991/5951 s), so SSRs do happen without our reads. The broker survived all five phase A SSRs with flat RSS, threads and fds. This **suggests a rate effect, it does not prove one**: SSRs on this unit cluster, and one hour per arm is short.

No further soak was run: the user skipped phase C (a 1 h 1 Hz lease) and took 1 Hz on this evidence, so 1 Hz is not soak-proven on its own.

**Device gate, broker 0.4.1 (2026-10-23, RM551E, boot `0aa7bf6b`, tarball sha256 `ea12dafb…`).** Lifecycle runs in order:

1. **OTA path** (`install.sh --skip-packages --no-reboot` over 0.4.0, what `qmanager_update` runs): capability `proto=3 version=0.4.1 qmi=1 live=1`; `/www/qmlive` link kept; the stale `qmi_live_watch` stamp and the lock removed by the broker stop; sidecars republished.
2. **Uninstall** (`uninstall.sh --force --keep-config --no-reboot`): `/www/qmlive`, `/var/run/qmanager` (live dir, stamps, token, lock, `qmi.env`, `qmi.stamp`), `/tmp/qmanager_qmi.json`, the retired `/tmp/qmanager_qmi_live`, `qmi_merge.sh`, `live_signal.sh`, the broker and the `qcmd` / `qmi` links all gone; no QManager process left; `/etc/qmanager` kept.
3. **Fresh install** (`install.sh --no-reboot`, packages included): link recreated, broker 0.4.1 up, sidecars publishing, no stamps. A second OTA-path run after restoring the user's UCI file left it byte-identical.

Lease at 1 Hz: the CGI answers `period_ms:1000` for `aim`; the file advanced exactly 1 `seq` per second (2 -> 12 over 11 s) with `period_ms:1000`; status `lte.source=qmi`, age 1 s; the token and file were gone about 10 s after the last renewal and the URL then 404s. Broker CPU 0.43 % of one core with no lease vs 0.57 % under an `aim` lease (+0.14 %, against +0.80 % at 5 Hz); RSS 528 kB, 10 threads, 12 fds; no new SSR.

Browser check (desktop app browser, same build): Antenna Alignment shows the live lead (Serving RSRP, peak and delta) and polls `/qmlive/` every 1.0 s (10 gaps of 0.73-1.02 s); the dashboard polls every 1.01-1.03 s with `watch` renewals about every 5 s and shows whole-dB LTE values; closing the tab let the lease lapse 11 s after the last renewal, leaving only `index.html`. Antenna Alignment leased `watch` until the first pointer/keyboard input, then `aim` (see the idle-demotion follow-up); at 1 Hz both tiers have the same period, so nothing visible changes.

**Follow-up (only matters if 5 Hz returns):** on a freshly loaded Antenna Alignment tab with no input, the store leased `watch` and renewed 4 times in 10 s instead of `aim` every 5 s; one synthetic input switched it to `aim`. Check the idle-demotion / mount ordering in `lib/live-signal-store.ts` before un-parking 5 Hz.

Plan reference: [`docs/plans/2026-10-22-qmi-phase2-live-tiers.md`](../plans/2026-10-22-qmi-phase2-live-tiers.md) section 4b.
