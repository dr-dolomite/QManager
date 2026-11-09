# History (generic time-series store) and Cellular History

> **Status: PROPOSED, awaiting approval (2026-11-09).** Nothing below is built yet. Once approved, this file is the canon for every History page.

QManager keeps a small, flash-friendly history of things the poller already knows, rolled up into fixed 30-minute buckets and kept for 31 days. A History page asks one generic CGI for a series and a range and gets back merged buckets plus the series' events. **Cellular History** (`/history/cellular`) is the first series. Data usage, latency and connection quality, and thermals are expected to follow; each is a new *provider* file, not a change to the core.

## Quick Reference

| Item | Value |
|---|---|
| Page | `/history/cellular` (sidebar group **History**) |
| Core lib (sourced by the poller) | `scripts/usr/lib/qmanager/history.sh` (`hist_init`, `hist_tick`, `hist_event`, `hist_flush`) |
| Providers | `scripts/usr/lib/qmanager/history.d/<series>.sh` (first: `cellular.sh`) |
| Read lib (sourced by CGIs) | `scripts/usr/lib/qmanager/history_read.sh` (awk merge, range math) |
| CGIs | `GET history/series.sh?series=&range=`, `GET history/events.sh?series=&range=&types=&limit=&offset=` |
| Flash store | `/usrdata/qmanager/history/<series>/d<DAY>.jsonl` (`DAY` = UTC epoch day, `t / 86400`), append-only |
| RAM state | `/var/run/qmanager/history/` (`clock.env`, `<series>.open`, `<series>.queue`, `<series>.pending`, `<series>.state`) |
| Sample period | 10 s (every 5th 2 s poller cycle, the `TIER1_5_EVERY` grain) in every tier |
| Base bucket | 1800 s, aligned to UTC epoch multiples |
| Ranges | `24h` = 48 × 30 min, `7d` = 56 × 3 h, `30d` = 60 × 12 h (all merged from base buckets at read time) |
| Retention | 31 days by day file; 2 MB per series; flush skipped under 8 MB free |
| Flash flush | every closed bucket (≤ 1 per 30 min, all series in one pass, one global `sync` pair) and on TERM |
| AT cost | **none**: no new AT command, no lock, no `qcmd` |
| Frontend | `types/history.ts`, `hooks/use-history.ts` (`useHistorySeries`, `useHistoryEvents`), `components/history/**` |

---

## 1. Data model

### Series identity

A **series** is one history stream with a fixed id matching `[a-z][a-z0-9_]{0,23}` (it is used in shell variable names, file names and the CGI allow-list). Its descriptor, declared by its provider:

| Field | Meaning | Cellular |
|---|---|---|
| `states` | Mutually exclusive states the series is in at each sample. Time is accumulated per state. Optional (a pure-metric series declares none). | `nr lte down off` |
| `fault` | The subset of `states` that counts as an outage (availability, outage count, last outage). | `down` |
| `metrics` | Integer metrics sampled each tick. Each keeps `n`, `sum`, `min`, `max` per bucket. | `lte_rsrp lte_rsrq lte_sinr lte_rssi nr_rsrp nr_rsrq nr_sinr` |
| `events` | Event types (from `events.sh`) recorded into this series. | `signal_lost signal_restored nr_anchor pci_change scc_pci_change band_change ca_change` |

There is no `nr_rssi`: the modem reports no NR RSSI (`status.json` `.nr` has none, and QENG's NR row carries no RSSI), so the RSSI chart is LTE-only by data, not by a UI rule.

### State definitions (cellular)

Resolved by the provider from the poller's globals as `status.json` reports them this cycle (after the QMI overlay, see §2):

| State | Rule (first match wins) |
|---|---|
| `off` | `t1_cfun` is `0` or `4` (radio off by the user, airplane mode). Not an outage; drawn as "no data". |
| `down` | `modem_reachable` is not `true`, or `service_status` is `no_service`/`limited`/empty, or neither leg is connected |
| `nr` | `nr_state = connected` (5G NSA anchor up, or SA) |
| `lte` | `lte_state = connected` |

"No data" is **never stored**. It is the part of a bucket no sample covered: `nodata = bucket_len - (nr + lte + down + off)`, computed at read time. A poller that is stopped, a modem that is rebooting or off, and the time before install all read as no data. **No service is `down`, a stored state; no data is the absence of samples.** They are never confused.

### Sample

Each 10 s tick a provider sets one state and zero or more metric values. A value that is empty, non-integer, or belongs to a leg that is not connected is **no reading** (it adds nothing, not a zero). Signal values pass the same range filter as the QMI lane (RSRP −150..0, RSRQ −40..0, RSSI −130..0, SINR −30..50); out of range is no reading.

The sample's duration is `dt = mono_now - mono_prev`, clamped to `3 × period` (30 s). A longer gap (poller stalled, restarted, rebooted) contributes only the clamp, so the rest becomes no data. `dt` is measured on `/proc/uptime`, never the wall clock.

### Row schema (flash and RAM, one JSON object per line)

Bucket row (`k:"b"`), a *partial aggregate* of one base bucket:

```json
{"k":"b","t":1794187800,"st":{"nr":1200,"lte":540,"down":20,"off":0},"x":1,"m":{"lte_rsrp":[180,-17820,-104,-95],"nr_rsrp":[120,-9840,-88,-79]}}
```

- `t` bucket start (UTC epoch, multiple of 1800). `st` seconds per state. `x` number of entries into a `fault` state in this bucket. `m.<metric>` = `[n, sum, min, max]` (integers; avg is `sum / n` at read time). A metric with `n = 0` is omitted.

Event row (`k:"e"`), the same shape as `NetworkEvent` in `types/modem-status.ts` plus `radio`:

```json
{"k":"e","t":1794187659,"type":"ca_change","severity":"info","radio":"lte","message":"LTE CA activated: B1 + B41, 35 MHz (2 carriers)"}
```

**Rows are mergeable.** Several bucket rows with the same `t` are summed (`st`, `x`, `n`, `sum`) and min/max-ed at read time. This one rule absorbs a poller restart mid-bucket, the partial bucket flushed on TERM before a reboot, and a backward clock step that revisits an older bucket. There is no rewrite-in-place anywhere.

### Registering a new series (no core change)

Add `scripts/usr/lib/qmanager/history.d/<id>.sh`:

```sh
HIST_SERIES="$HIST_SERIES thermal"          # register the id
HIST_thermal_STATES="normal throttled"
HIST_thermal_FAULT="throttled"
HIST_thermal_METRICS="soc_c modem_c"
HIST_thermal_EVENTS="thermal_throttled thermal_recovered"
hist_thermal_sample() {                      # builtins only, no forks
    _HS="normal"; [ "$thermal_throttled" = "1" ] && _HS="throttled"
    _HV_soc_c="$thermal_soc"; _HV_modem_c="$thermal_modem"
}
```

The core dot-sources every file in `history.d/` (each guarded with `[ -f ]`, BusyBox aborts on a missing dot-source), calls `hist_<id>_sample` each tick, and the CGIs accept any id whose provider file exists. The page, its i18n and the series' presentation (state colours, metric domains) are the feature's own.

## 2. Collection: a poller hook, not a daemon

The collector is a library sourced by `qmanager_poller`, following the Data Used precedent (`du_init` / `du_tick` / `du_flush`).

**Why not a daemon.** Every value the cellular series needs is already a shell global in the poller (AT parse plus the QMI overlay). A separate daemon would have to read `status.json` each sample, which means a `jq` fork (≈10 ms, plus parsing) every 10 s, and it would sample a file that can be up to one cycle old. Future series (thermal, Data Used, ping/DNS sidecars) are also already loaded in the poller. A poller that is not running correctly produces no data, which is exactly what "no data" means.

**Call sites** (one line each, guarded by `command -v`; a missing lib defines no-op stubs as `data_used.sh` does):

| Where | Call |
|---|---|
| `main()`, after `du_init` | `hist_init` |
| main loop path, **after `write_cache` and before `qmi_overlay_restore`** | `hist_tick` |
| scan / SIM-switch early return, after its `write_cache` | `hist_tick` |
| `append_event` (`events.sh`), after the row is written | `hist_event "$etype" "$message" "$severity"` |
| `trap` | `trap 'du_flush; hist_flush; exit 0' TERM INT` |

Placing `hist_tick` inside the overlay window means history records **exactly what `status.json` says that cycle** (QMI LTE signal when the overlay applied, AT otherwise), while `events.sh` and every other AT consumer keep seeing AT samples (qmi-lane Invariant: never feed QMI values to `events.sh`).

**Adaptive tiers.** The tick runs in every tier, but the inputs differ: in Active everything is ≤ 2 s old; in Idle the AT values are ≤ 15 s old; in Deep, LTE RSRP/RSRQ/RSSI still refresh every 2 s from QMI, while NR values and the AT-derived state refresh every 60 s (`AT+QENG` only). A 10 s sample of a 60 s-old value repeats it, which weights the bucket average correctly. **The history never asks the poller to stay Active and never adds an AT read.** Effect on outage resolution in Deep: a drop is seen when `modem_reachable` or `service_status` change, i.e. within one deep AT interval (≤ 60 s, plus `SC_FAIL_LIMIT`). That is accepted for 30-minute buckets; the doc of record for "how fast is a drop detected" stays `connection-quality.md` (data path) and this table (radio path).

**Hot-path rules (B5.29).** Per cycle: one counter test. Per tick (10 s): the provider and the accumulator use builtins only (`eval` on fixed names, `$(( ))`, `case`), **zero forks**. Every 3rd tick (30 s): the open-bucket mirror is rewritten through `qm_atomic_write` (one `mv`). On bucket close: one `printf >>` to the RAM queue (no fork). On flush: see §4. `status.json` and its composers are untouched, so `tools/poller-parity/` is unaffected.

## 3. Rollup tiers and retention

| Tier | Holds | Where | Bound |
|---|---|---|---|
| Raw | the samples of the open bucket, as running `n/sum/min/max` + state seconds (not individual samples) | poller memory, mirrored to `<series>.open` every 30 s | one bucket |
| Pre-trust raw | individual samples taken while the clock is untrusted (§5), with their `mono` | `<series>.pending` (RAM) | 360 lines (1 h at 10 s); oldest dropped beyond that |
| Base | 30-minute bucket rows | RAM queue until flushed, then `d<DAY>.jsonl` on flash | 31 days |
| Read tiers | 30 min, 3 h, 12 h | computed by the CGI by merging 1, 6 or 24 base rows | none stored |

All three UI ranges are exact multiples of 30 min, so **no coarse tier is stored**: one base tier and a read-time merge give 24 h/7 d/30 d with no second rollup to keep consistent. 30 days × 48 rows × ~300 B ≈ 430 KB per series. A future range beyond 31 days (90 d, 1 y) adds a stored 12 h tier rolled up from closed base days by the same mergeable-row rule; it is not built now.

**Hard caps.** Day files older than 31 days are deleted after each flush (by file name, no date maths). While a series directory exceeds 2 MB the oldest day file is deleted (never today's). A flush is skipped while `/usrdata` has under 8 MB free (the queue keeps up to 96 rows, then drops the oldest). Events are capped at 2000 rows per day file (after that only `fault`-related types, `signal_lost`/`signal_restored`, are kept that day), so a CA-churn storm cannot fill the store. The pending file is capped at 360 lines, the queue at 96 rows.

## 4. Storage and persistence

| Data | Medium | Why |
|---|---|---|
| Open bucket, queue, pending, clock anchor | `/var/run/qmanager/history/` (tmpfs, dir `0700` root via `qm_run_dir`) | changes every 10 s; survives a poller restart, not a reboot |
| Closed buckets and events | `/usrdata/qmanager/history/<series>/` (UBIFS, dir `0755`) | must survive reboots |
| Last outage and the oldest row (`since`) | `<series>.state` in RAM, rebuilt at `hist_init` from the newest/oldest day file | cheap to recompute once per poller start |

**Flush.** When any series closes a bucket, `hist_flush` appends every queued row of every series to its day file(s) with `printf >>`, then runs **one `sync`** (global on BusyBox) and truncates the queues. It also runs from the TERM trap (procd stop, planned reboot) with the open bucket written as a partial row, which §1's merge rule absorbs. Worst case on an unplanned reboot or AP hang: the open bucket (≤ 30 min) and its events are lost and read as no data.

**Flash-wear budget.** One append pass per 30 min per device (all series together): 48 small appends per series per day plus 48 global syncs/day, i.e. well under 1 MB/day of UBIFS writes for the cellular series (each append costs at most a page plus metadata). Data Used already syncs every 5 min; this adds less than that.

**Why append + `sync`, not `qm_durable_write`, for day files.** Rewriting a whole day file through a temp file every 30 min would rewrite up to ~15 KB per flush for no gain, and the lost-update window is the same. Append-only files with a `sync` after the write cannot lose earlier rows; a power cut can at worst leave a torn last line, which the reader filters with an anchored `grep -E` row pattern (the Sites precedent) before `awk`. RAM files (`.open`, `clock.env`) use `qm_atomic_write`. Any small state file on flash added later uses `qm_durable_write`. **Never `cp`/`mv` onto flash without a `sync`** (2026-10-19: an unsynced deploy plus a hang zeroed eight files).

## 5. Untrusted clock

The RM551E has no usable RTC: the kernel boots at 1970, `sysfixtime` sets it to the newest `/etc` mtime (often stale), and `time_daemon` (NITZ) or `sysntpd` step it later; an SSR can step it back about 80 s and forward again. The collector therefore stamps everything on the monotonic clock and maps to wall time through an **anchor**:

- `offset = wall - mono`, taken at a trusted moment and kept in `clock.env` (`hist_offset`, `hist_trusted`, `hist_boot`). A bucket key is `floor((mono + offset) / 1800) * 1800`.
- **Trusted** means all of: wall ≥ 1700000000 (`HIST_SANE_EPOCH`, same as Data Used); wall ≥ the newest stored bucket end minus 120 s (a clock behind our own newest record is stale); and either uptime ≥ 300 s (`QM_TIMER_SETTLE_SECS`, the scheduled-jobs guard) or a step has already been seen this boot.
- **Before trust,** samples go to `<series>.pending` with their `mono`, and events are stamped with `mono` only. At the first trusted tick one `awk` pass back-dates them with the new offset (`mono` is continuous since boot, so a sample taken at 1970 + 40 s lands at its real time), merges them into rows and queues them. Rows that would land before the newest stored bucket are dropped and counted in the log. **Nothing is ever recorded into 1970.** If trust never comes (no SIM, no NTP), the pending file rolls at 1 h and the page shows no data for that time.
- **Steps.** Each tick compares `wall` with `mono + offset`. A drift within ±120 s is ignored (the NITZ wobble around an SSR never touches the buckets). A larger drift re-anchors: the open accumulator is closed into its current key and a new one starts under the new offset. Forward steps leave the skipped span as no data; backward steps revisit older keys, which the merge rule sums. Merged coverage above the bucket length is clamped by scaling the states down proportionally at read time, so a bucket never reports more than 30 minutes.
- **Reboots.** `boot_id` changes, `mono` restarts: the open mirror from the old boot is discarded (its partial row was flushed by the TERM trap if the stop was planned), and the time until the first sample of the new boot is no data.
- **The CGI** computes "now" as `mono + offset` from `clock.env`, not `date`, so the newest bucket matches the collector. With no trusted anchor it answers `clock_trusted:false` and no buckets.

## 6. CGI contract (`history/` namespace)

Both endpoints are authenticated GETs (`cgi_base.sh`), read-only, and use the standard `{success:false, error, detail}` envelope. Error codes (added to `errors.json` in all five catalogs): `invalid_series`, `invalid_range`, `invalid_param`.

### `GET history/series.sh?series=cellular&range=24h|7d|30d`

| Range | `bucket_sec` | Buckets |
|---|---|---|
| `24h` | 1800 | 48 |
| `7d` | 10800 | 56 |
| `30d` | 43200 | 60 |

Buckets are aligned to UTC multiples of `bucket_sec`; the last one contains now and is partial (`len` < `bucket_sec`). Every bucket is present even with no data.

```json
{
  "success": true,
  "series": "cellular",
  "range": "24h",
  "bucket_sec": 1800,
  "now": 1794189410,
  "clock_trusted": true,
  "since": 1793580000,
  "states": ["nr", "lte", "down", "off"],
  "fault": ["down"],
  "metrics": ["lte_rsrp", "lte_rsrq", "lte_sinr", "lte_rssi", "nr_rsrp", "nr_rsrq", "nr_sinr"],
  "current": { "state": "nr", "since": 1794180000 },
  "last_fault": { "start": 1794100000, "end": 1794100140 },
  "buckets": [
    { "t": 1794103200, "len": 1800, "st": { "nr": 1200, "lte": 540, "down": 20, "off": 0 }, "x": 1,
      "m": { "lte_rsrp": { "n": 180, "avg": -99.0, "min": -104, "max": -95 } } }
  ]
}
```

- `since` = start of the oldest stored row (`null` with none); `current.since` = when the current state run began (this boot's samples only; a reboot or a no-data gap ends a run). `last_fault` is the newest completed fault run (`null` if none in 31 days).
- `st` is clamped to `len`; `nodata = len - sum(st)`. `m` omits metrics with no reading; `avg` has one decimal.
- Sources: day files covering the range, then the RAM queue, then the open mirror, all merged by the same `awk` program in `history_read.sh`.

### `GET history/events.sh?series=cellular&range=24h&types=band_change,ca_change&limit=5&offset=0`

Newest first. `types` (optional) is a comma list checked against the series' `events`; `limit` 1..100 (default 25); `offset` ≥ 0.

```json
{
  "success": true, "series": "cellular", "range": "24h", "total": 132,
  "counts": { "band_change": 12, "ca_change": 101, "nr_anchor": 9, "pci_change": 8, "scc_pci_change": 0, "signal_lost": 1, "signal_restored": 1 },
  "events": [ { "timestamp": 1794187659, "type": "ca_change", "severity": "info", "radio": "lte", "message": "LTE CA activated: B1 + B41, 35 MHz (2 carriers)" } ]
}
```

`counts` is over the range ignoring `types`, so the filter menu can show counts and hide empty types. `radio` is `lte`, `nr` or `null`, set at record time (message prefix `LTE`/`NR`, `nr_anchor` = `nr`, `signal_*` = the leg at that moment, else `null`).

## 7. Frontend contract

- `types/history.ts`: `HistoryRange`, `HistoryBucket<S, M>`, `HistorySeriesResponse<S, M>`, `HistoryEventsResponse`, and `CellularState` / `CellularMetric` aliases. Exported constants `HISTORY_RANGES` (bucket counts and sizes) mirror the table above.
- `hooks/use-history.ts`: `useHistorySeries<S, M>(series, range)` and `useHistoryEvents(series, range, { types, page, pageSize })`. Both return `{ data, isLoading, error, refresh }`, refetch every 30 s through `startVisibleInterval` (`lib/visible-interval.ts`, so a hidden tab stops polling and refetches on show), refetch at once on a range or page change, and keep the previous data while a new range loads (no skeleton flash on a range switch).
- A new History page = a provider file + its page under `app/history/<id>/` + `components/history/<id>/**`. Shared, series-agnostic pieces live in `components/history/` (range control, state strip, bucket-axis ticks, metric chart, shared cursor context, events table shell).
- The page shows `clock_trusted:false` and `since:null` as the empty "Collecting" state.

## 8. Lifecycle lockstep

| Step | `install.sh` (fresh + Software Update) | `uninstall.sh` | ipk |
|---|---|---|---|
| Files | `history.sh`, `history_read.sh`, `history.d/*.sh` go with the lib tree; `history/*.sh` with the CGI tree (`install_tree`) | removed with the trees | listed in the package manifest by the existing tree globs (`scripts-dev/ipk/`) |
| Store | `install_backend` makes `/usrdata/qmanager/history` (`mkdir -p`, `chown root:root`, `chmod 0755`; no `install` applet) | `--purge` removes `/usrdata/qmanager/history`; `--keep-config` keeps it | `QM_INSTALL_ENTRY=ipk_preinst` path runs the same `install_backend` step |
| Runtime | none (the poller restart creates `/var/run/qmanager/history` via `qm_run_dir`) | `remove_runtime_state` already removes `/var/run/qmanager` | same |
| Daemon | none new; the existing poller restart picks the hook up | n/a | n/a |
| Poller stop | init.d `stop_service()` leaves `history/` alone (a poller restart must resume the open bucket) | n/a | n/a |

Not in config backup (history is data, not settings). An update keeps the store; the schema is versioned by the row kind (`k`) and unknown keys are ignored by the reader, so an older reader tolerates newer rows.

## 9. Risks, validation and rollback

| Risk | Mitigation |
|---|---|
| Poller hot-path regression | builtins-only tick; measure with `tools/poller-parity/measure.sh` before/after (gate: Active CPU +≤ 0.3 pt, period 2.0 ± 0.2 s) |
| Clock step corrupts history | anchor + ±120 s tolerance + mergeable rows; replay test with `QM_TEST_*`-style hooks (`HIST_TEST_WALL`, `HIST_TEST_MONO`) in a scratch dir |
| Flash wear / fill | one append pass per 30 min, 31 d / 2 MB / 8 MB-free caps, event storm cap |
| Torn rows after power cut | anchored `grep -E` row filter before `awk` |
| A broken provider kills the poller | providers are dot-sourced with `[ -f ]` guards and called through `command -v`; a provider that sets no state contributes no sample |
| CGI cost on 30 d | one `cat` of ≤ 31 small files into one `awk`; target < 300 ms on device |

**Validation plan.** Static: `.claude/check-crlf.sh`, `sh -n`, BusyBox/POSIX audit (no bashisms, one var per `local`, no jq regex, guarded dot-sources, numeric guards). Dev test `tools/history-test/history-test.sh` run on the device under its BusyBox: accumulate, close, merge, back-date, step ±, reboot, caps. On device: deploy + `sync`, poller CPU measure, a forced bucket close via test hooks, CGI shape for each range, a poller restart mid-bucket, a reboot (user OK required), and an observed outage if one occurs (or `AT+CFUN=4` → `off`, only with the user's OK).

**Rollback.** Remove the four call sites (or install the previous poller and `events.sh`): with the lib absent the stubs are no-ops. The store is inert data; delete `/usrdata/qmanager/history` to reclaim it. The frontend route can ship or roll back independently (the CGI errors become the page's error state).
