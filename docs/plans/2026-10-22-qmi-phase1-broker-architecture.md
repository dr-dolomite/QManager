# QMI Phase 1: broker architecture (qmanager_atd 0.3.0)

Status: **PLAN, awaiting approval.** Inputs:
- [Phase 0 results](../research/qmi-phase0-results.md)
- [at-broker.md](../features/at-broker.md)
- `docs/architecture/poller-on-broker.md` (the parked `POLL` design)

## 1. What the broker is today, and why QMI can't simply be bolted on

`qmanager_atd` 0.2.0 is one static multicall binary of about 7.3k lines. Its argv0 decides the role: `qmanager_atd` is the daemon, `qcmd` and `qsms` are clients. The daemon is a **single-threaded serial loop**:

```
listener.incoming() ─► serve(): read request (2 s) ─► uid check ─► peer_gone? ─► Executor.run_after(cmd, waited)
                                                                                 └─ flock /var/lock/qmanager.lock ─► Channel(/dev/smd11)
```

Several frozen invariants depend on that shape:
- **The kernel accept backlog is the queue.** Each request carries `sent_ms`, so time spent queued is charged against the 5 s/10 s lock budget.
- **`peer_gone` drops callers that hung up** while queued.
- **The client's long-flag watch is correct only because one request runs at a time.** A queued short command that sees the flag knows it is still queued.
- **Output, exit codes and error strings are frozen** (about 120 call sites).

**Why bolting QMI on fails.** If QMI requests went through the same loop, they would queue behind a 20 s AT exchange, a 60 s slow command or a 150 s `QSCAN`. The whole point of QMI is lock-free reads that stay live while AT is busy or suppressed, so the loop has to change, not just gain a verb.

The broker is also a monolith in one module namespace:
- `main.rs` holds role dispatch, the daemon, routing and both clients.
- `parse.rs` and `envout.rs` (about 1.3k lines) are dead code for the parked `POLL` verb.

## 2. Target architecture: one process, independent lanes

```
                         ┌──────────── qmanager_atd (daemon) ─────────────┐
 qcmd ─┐                 │  acceptor thread                               │
 qsms ─┼─ unix socket ──►│   └─ per-connection reader (bounded pool, 2 s) │
 qmi  ─┘  0600, uid 0    │        validate + route by verb                │
                         │        ├─ REQ / SMS ─► AT lane (1 worker thread)│
                         │        │    FIFO queue (bounded) → today's     │
                         │        │    Executor/Channel/LockFile, UNCHANGED│
                         │        └─ QMI ───────► QMI lane (no modem lock) │
                         │             service registry ─ NAS/DMS/UIM/WDS/DSD
                         │             one QRTR socket + demux thread each│
                         │             typed codecs → normalised JSON     │
                         │             (later: indications → snapshot)    │
                         └────────────────────────────────────────────────┘
```

### AT lane: behaviour frozen, only hosted differently
- The reader thread decodes and validates exactly as `serve()` does today: uid check, size caps, exact-length body. It then pushes a job (`stream`, `cmd`, `sent_ms`) onto a FIFO.
- **One worker** pops jobs in order and runs today's code unchanged: `peer_gone` at dequeue, `waited = now − sent_ms`, `Executor.run_after`.
- The queue is the backlog moved in-process: still FIFO, and still one request on the modem at a time. The client-side long-flag watch therefore stays correct.
- **Bounded at 64 jobs**: overflow answers `modem_busy`. Today's equivalent is kernel backlog exhaustion.
- **Proof of behaviour:** the existing tests and the on-device parity suite (31 outputs, raw/`-j`/rc, daemon and fallback) must stay byte-identical.

### QMI lane: new
- **`qmi::transport`:** an `AF_QIPCRTR` datagram socket behind a small `Datagram` trait, so a fake transport can be used in tests.
- **`qmi::registry`:**
  - Looks each service up once.
  - Keeps **one long-lived client socket per service** with a **demux reader thread**. Responses are matched by transaction ID to the waiting request; indications go to subscribers, so the indication path needs no rework later.
  - Per-request timeout of 1 s (Phase 0 p99 was under 5 ms).
- **SSR handling:**
  - `ECONNRESET`/`ENETRESET`, or the service vanishing from the name server, marks the service *down*.
  - Requests answer `modem_not_ready` at once (no 8 s hang like in the soak).
  - A backoff re-lookup (250 ms → 2 s) brings the service back.
  - The lane exposes an SSR counter and timestamp: a free, exact SSR signal for the watchdog later.
- **`qmi::allow`:** the read-only (service, message) allow-list, enforced **in the daemon**, because the socket is the trust boundary. Indication registration (NAS 0x0003) is internal-only and per-client. Nothing that writes modem config is reachable. `Config Signal Info v2` stays out until separately approved.
- **`qmi::codec::{nas,dms,uim,wds,dsd}`:** typed decoders ported from `qmi_probe` and the REA IDL layouts, unit-tested against **TLV fixtures captured in Phase 0**.
- **`qmi::model`:** normalises to QManager's own vocabulary (`"B41"`/`"N41"` like `parse_at.sh`, bandwidth in MHz, dBm integers plus a 0.1 dB field).
  - **Registration gate:** signal is `null` unless serving reports `registered`. This avoids the fork's RSRP-while-searching trap.
  - **Freshness tag:** each field records where it came from, e.g. `signal.source:"cell_location"` (live) vs `"signal_info"` (cached).
- **No modem lock and no long-flag gate:** QMI never touches smd11. Reads keep working during scans, SIM-switch suppression and a held lock. This is the reason for the whole design.
- **Concurrency:** a reader thread handles a QMI request directly through the shared registry. The registry uses a mutex per service socket, which is enough for reads under 1 ms. No async runtime and no new crates: still `libc` only.

### QMI snapshot engine (the poller's and the live UI's source)
- **Sampler thread** in the QMI lane. Every 2 s by default it reads the bundle (serving + cell + CA + RF: 4 requests, about 1.5 ms) and publishes two files atomically (O_NOFOLLOW temp file + rename, like the `.proto` file):
  - **`/tmp/qmanager_qmi.env`**, for the poller. It follows the sidecar contract of `ping.env`/`dns.env`:
    - every name comes from a compiled allow-list and every value is single-quoted;
    - values are integer or empty, never a float or `N/A`, so the poller's `jq --argjson` fallback composer can't break;
    - globals use the `qmi_*` prefix, never the poller's own `lte_*`/`t2_*`;
    - the file ends with `qm_sidecar_end`.
  - **`/tmp/qmanager_qmi.json`**, the same data for CGIs.
  - Both carry:
    - `qmi_mono`: monotonic seconds of the read;
    - `qmi_state`: `up`, `down` or `unavailable`;
    - `qmi_ssr_count`;
    - registration;
    - signal, which stays empty unless registered.
- **Live lease.** A CGI touches `/tmp/qmanager_qmi_live` to raise the rate to 1–5 Hz for at most 10 s past its last renewal. This is the realtime path for the dashboard and antenna aiming; it costs ≤0.5 % CPU at 10 Hz, as measured in Phase 0.
- **Why a sidecar and not `qmi bundle` from the poller:**
  - Sourcing the sidecar adds **zero forks** to the poller: builtin `read`, gated by `-nt` like the other sidecars. A per-cycle `qmi` call would cost about 5 ms and one fork, against the 11.5 forks/s active budget in `tools/poller-parity/measure.sh`.
  - The sampler's cadence is independent of the poller's tiers, so deep tier and AT suppression still get fresh LTE data.
  - It is the place where indications plug in later, without consumer changes.
- **During an SSR** the files keep their last values with `qmi_state=down` and an incremented `qmi_ssr_count`. They are never deleted, so readers never see a missing file.

### Client `qmi` (new argv0, `/usr/bin/qmi` → `qmanager_atd`)
- **Commands:** `qmi <read> [<read>…]` where read ∈ `serving signal cell ca rf ids rev opmode time card slots profiles dsd`, plus `qmi bundle`. `bundle` is the poller-shaped read: serving + cell + CA + RF in one round trip, about 3 ms. Output is one JSON line on stdout; rc 0 ok, 1 failure.
- **Envelope:** `{"v":1,"ok":true,"mono_ms":N,"ssr_count":N,"data":{"serving":{...},...}}`. On failure: `{"v":1,"ok":false,"error":"qmi_unavailable|modem_not_ready|not_supported|bad_args|command_failed"}`.
- **Fallback:** if the broker is unreachable, the client opens QRTR itself. That's safe because QMI needs no lock and is read-only. The same codecs run in process, so there's one behaviour.
- **Why a new name and not `qcmd --qmi`:** an old `qcmd` (a rollback) would send `--qmi` to the modem, and callers detect support by `[ -x /usr/bin/qmi ]` plus the capability file. This follows the `qsms` precedent.

### Wire and capability
- New verb `QMI <nbytes> <sent_ms>\n<NUL-joined args>`, with the same exact-length and uid rules. Reply `RES <0|1> <n>\n<json>` (reused from SMS).
- **Proto 3**, and the capability file gains a `qmi=1` line. Proto 3 was reserved for `POLL`; that is now parked indefinitely, so the docs record 3 = QMI lane, and `POLL` would become 4 if ever built.
- Version 0.3.0.

### Source layout (refactor as pure moves first)

```
src/main.rs                 role dispatch only
src/common/   proto.rs log.rs lock.rs safefs.rs json.rs
src/at/       channel.rs exec.rs classify.rs output.rs
src/sms/      sms.rs pdu.rs
src/qmi/      transport.rs registry.rs allow.rs model.rs codec/{nas,dms,uim,wds,dsd}.rs
src/daemon/   mod.rs (bind, acceptor, router) at_lane.rs qmi_lane.rs
src/client/   transport.rs (try_broker_raw, await_reply, frozen restart) qcmd.rs qsms.rs qmi.rs
```

`parse.rs`, `parse/ca.rs` and `envout.rs` (dead, parked `POLL`) move to `src/poll/` behind a cargo feature that is off by default. They are not deleted, so `tools/poller-parity/rx_rust.sh` can still build them on demand.

`Logger` becomes thread-safe: one `Mutex` around write and rotate. Today it is only ever called from one thread.

## 2b. How the poller integrates

This is designed now so that the broker's outputs fit the poller. It is built in Phase 2. The source is a full map of `qmanager_poller` and `parse_at.sh`, plus the parked `docs/architecture/poller-on-broker.md`.

**What the poller is today.**
- A 2 s cycle. Adaptive tiers decide when AT is due:
  - active: every cycle;
  - idle: every 7th cycle, about 14 s;
  - deep: every 30th, 60 s.
- An AT-due cycle runs, in order:
  - `QENG servingcell`;
  - `QCAINFO` (not in deep);
  - `CFUN?`;
  - per-antenna `QRSRP;QRSRQ;QSINR` (not in deep);
  - the active-only Tier 2 reads.
- After that it runs `determine_service_status` and `events.sh`. `write_cache` composes `status.json`, by printf with a jq fallback.
- While a scan or SIM switch runs, the poller returns early with **every radio field frozen**.

**What QMI can and can't take over.**
- `parse_serving_cell` owns every `lte_*`/`nr_*` field and the mode. In NSA it is still the only source of NR PCI/band/RSRP/RSRQ/SINR/SCS, of `lte_sinr`, and of the NSA/SA/LTE discrimination.
- `QCAINFO` is the only source of per-carrier SINR and the NR SCC.

So on this firmware **QMI cannot remove QENG or QCAINFO from AT-due cycles**. Its value to the poller is filling the gaps where AT is absent, which is where the user-visible staleness is:

| Gap today | With QMI |
|---|---|
| Idle and deep tiers: radio fields up to 14 s or 60 s old; CA frozen in deep; tower failover reads 60 s-old RSRP | LTE identity, signal and CA are at most 2 s old in every tier |
| Scan or SIM-switch suppression: all radio fields frozen | LTE stays live through the scan |
| `QENG` busy streak (rc 3) | LTE stays live |
| Browser open, active tier | AT stays authoritative, so status.json is unchanged |

**Integration rules, fixed now:**
1. **`parse_at.sh` stays byte-for-byte untouched**, which keeps it under the 216-fixture parity gate. A new `scripts/usr/lib/qmanager/qmi_merge.sh` (guarded `[ -f ] && .`) provides two functions:
   - `qmi_load`: validate, then source the sidecar into `qmi_*` globals, gated by `-nt`;
   - `qmi_merge`.
2. **Precedence:** an AT reply from *this* cycle always wins for every field it owns. `qmi_merge` fills LTE fields only on cycles where `QENG` didn't run or answered rc 3, and fills CA only when `QCAINFO` didn't run. It runs only after the AT parse and the CA reconciliation, so it never fights `parse_serving_cell`'s reset. On those cycles the poller keeps today's last-known NR values and `lte_sinr`.
3. **Fill conditions:** QMI fills only when `qmi_state=up`, its mono is under 5 s old, its registration says registered, **and** its LTE PCI and EARFCN match the last AT-known serving cell, or AT has no serving cell. A cell change between AT reads is not merged in; it waits for the next AT read. This avoids a mixed LTE/NR state across a handover.
4. **Semantics stay AT's:**
   - `modem_reachable` and `errors` still mean AT reachability;
   - `serving_read_mono` and `ca_read_mono` still mean the last AT read;
   - **`events.sh` is still fed only from AT samples.** Its settle and churn counters count samples, so a faster QMI cadence would silently retune `ca_change`.
5. **New status.json keys,** added to both composers and covered by `status_parity.sh`:
   - `lte.source` and `network.ca_source` (`"at"` or `"qmi"`);
   - `device.qmi_read_mono`, `device.qmi_state`, `device.qmi_ssr_count`.
6. **Parity tooling:** `dump_globals.sh` learns the `qmi_` prefix, `sidecar_parity.sh` covers `qmi.env` (asserting no fork), and `measure.sh` gates stay as they are: active ≤10 % CPU, period 2.0 ± 0.2 s.
7. **The parked POLL design stays parked.** The QMI lane makes it even less worth building, because QMI already gives the cheap freshness POLL was chasing. Its Rust parsers move behind the off-by-default `poll` feature (§2).

**Who gains:**
- **Tower failover:** fresh `lte.rsrp` in deep, with no format change.
- **The dashboard after a closed tab:** it reopens on fresh LTE values.
- **The cell-scanner page:** the serving cell stays live during a scan.
- **Prometheus:** gets ages per source.

## 3. Build order (each step is its own commit)

1. **Pure module move.** No logic change. `cargo test` stays green with the same test count. Model: Opus.
2. **Thread-safe `Logger`, plus acceptor/reader/AT-lane split.** Only the hosting changes. Add tests:
   - FIFO order is kept;
   - a queued job's `waited` still counts against the budget;
   - `peer_gone` is honoured at dequeue;
   - a full queue answers `modem_busy`;
   - a QMI request answers while a fake AT job holds the lane.

   Model: Opus, the sensitive piece.
3. **`qmi::transport` + `registry` + `allow`,** with a fake `Datagram` covering:
   - txn demux;
   - timeout;
   - SSR (reset → down → re-lookup);
   - an allow-list refusal.

   Model: Opus.
4. **Codecs and model,** ported from `qmi_probe` with Phase 0 fixtures (pull a few raw TLV dumps per message, in both LTE-only and NSA CA layouts). Model: Sonnet High.
5. **`qmi` client and the `QMI` verb,** proto 3, capability file, in-process fallback. Model: Sonnet High.
5b. **Snapshot sampler.**
   - `qmanager_qmi.env` and `.json` writers, following the sidecar contract in §2b and the env allow-list.
   - The live lease.
   - Fixture tests prove the env file passes the poller's validate-then-source rule.

   Model: Sonnet High; Opus reviews.
6. **Lifecycle in lockstep.** Model: Sonnet; validator audit by Haiku.
   - `at_engine.sh at_qmi_link`;
   - `init.d` re-asserts it;
   - `install.sh` links it;
   - `uninstall.sh` removes the link and its `.qmi.*` temp links;
   - also clean the forgotten `/var/run/qmanager_atd.restart`;
   - rebuild `dependencies/qmanager_atd`.
7. **Docs.**
   - `at-broker.md`: the lanes, proto 3, the new invariants.
   - New `docs/features/qmi-lane.md`: allow-list, field coverage table, freshness rules, SSR semantics.
   - Feature routing in CLAUDE.md and the features README.

**No consumer changes in Phase 1.** The poller, CGIs and UI stay on AT; the sidecars exist, but nothing reads them yet.

Phase 2 adopts them in order, each step behind a sidecar or capability check:
1. `qmi_merge.sh` gap-fill in the poller (§2b), plus the new status keys.
2. The live-lease CGI and the dashboard/antenna realtime view.
3. `radio_details.sh` reads its network-type check from the sidecar instead of `QENG`.
4. The cell-scanner live serving cell.

**Lifecycle for the sidecars.** Uninstall and the stop path remove `/tmp/qmanager_qmi.env`, `/tmp/qmanager_qmi.json` and `/tmp/qmanager_qmi_live`.

## 4. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Threading regresses the frozen AT contract | Step 1 is moves only. Step 2 keeps one AT worker and the same `Executor`. The full parity suite and lock-contention tests run on device before and after (busy at ~5 s, queued-caller skip, scan_in_progress at 10 ms). |
| QRTR socket leak or a demux thread wedged across an SSR | The demux thread exits on reset and the registry rebuilds the client. Watch the fd count before and after a forced service loss (simulated with the fake) and across a real SSR if one occurs during the soak. |
| A long-lived QMI client disturbs netmgrd/QCMAP | Phase 0 ran 900 cycles plus a 1000-request burst alongside them with no effect. The soak re-checks their PIDs and `logread`. |
| Memory and threads on the A53 | Thread stacks are set to 128 KiB. The reader pool is capped at 16. Target: RSS growth ≤ 1 MB, idle CPU unchanged. |
| A rollback to 0.2.0 leaves a dangling `/usr/bin/qmi` | Phase 2 callers test `-x` and the `qmi=1` capability, and uninstall/reinstall re-asserts or removes the link. |

## 5. Validation (done means all of these)
- `cargo test`: all existing tests plus the new ones.
- On device:
  - the parity suite is byte-identical (daemon and fallback);
  - the lock-contention and long-command checks from at-broker.md pass;
  - `qmi bundle` returns in ≤ 10 ms during a held modem lock and during a real `AT+QSCAN` (the headline check);
  - the in-process fallback works with the daemon stopped;
  - a 30-minute soak with `qmi bundle` every 2 s next to the poller: no AT regressions in `qmanager.log`, fd and RSS flat, and the parity tool still ≥ the Phase 0 numbers.
- **Lifecycle:** install, OTA re-install and uninstall leave no strays.

## 6. Rollback
Reinstall the previous release: 0.2.0 ignores `/usr/bin/qmi`, and nothing in Phase 1 consumes it. Each build step is a separate commit on the branch, so any one of them can be reverted.
