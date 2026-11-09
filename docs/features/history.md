# History (generic time-series store) and Cellular History

> **Status: APPROVED 2026-11-09.** This file is the canon for every History page.

QManager keeps a small, flash-friendly history of things the poller already knows, rolled up into fixed 30-minute buckets and kept for 31 days. A History page asks one generic CGI for a series and a range and gets back merged buckets plus the series' events. **Cellular History** (`/history/cellular`) is the first series; **System Health** (`/history/system-health`, [`system-health-history.md`](system-health-history.md)) is the second (reboots, modem crashes, heat throttling, processor, memory, temperature, storage). Data usage and latency and connection quality are expected to follow; each is a new *provider* file, not a change to the core.

## Quick Reference

| Item | Value |
|---|---|
| Page | `/history/cellular` (sidebar group **History**); second series: System Health `/history/system-health`, see [`system-health-history.md`](system-health-history.md) |
| Core lib (sourced by the poller) | `scripts/usr/lib/qmanager/history.sh` (`hist_init`, `hist_tick`, `hist_event`, `hist_flush`) |
| Providers | `scripts/usr/lib/qmanager/history_series_<series>.sh` (first: `history_series_cellular.sh`; flat, because the installer copies the lib dir flat; `history.sh` dot-sources every one) |
| Read lib (sourced by CGIs) | `scripts/usr/lib/qmanager/history_read.sh` (awk merge, range math) |
| CGIs | `scripts/www/cgi-bin/quecmanager/history/series.sh?series=&range=`, `.../history/events.sh?series=&range=&types=&limit=&offset=` (contract in §6, endpoints in [`../API-REFERENCE.md`](../API-REFERENCE.md#history)) |
| Flash store | `/usrdata/qmanager/history/<series>/d<DAY>.jsonl` (`DAY` = UTC epoch day, `t / 86400`), append-only; plus two small durable marker files per series: `since` (when collecting began, written once) and `last_fault` (`<start> <end>` of the newest completed fault run); plus one store-wide `last_wall` (wall time of the newest sample, written by the TERM flush, §5) |
| RAM state | `/var/run/qmanager/history/` (`clock.env`, `<series>.open`, `<series>.queue`, `<series>.pending`, `<series>.run`, `ext.spool`, `ext.spool.work`) |
| Event pairing | optional `HIST_<id>_PAIRS="onset:recovery ..."` per series; cellular: `signal_lost:signal_restored` (§6) |
| External events | `append_event` in a process without `history.sh` appends to `ext.spool`; the poller replays it (§2) |
| Sample period | 10 s (every 5th 2 s poller cycle, the `TIER1_5_EVERY` grain) in every tier |
| Base bucket | 1800 s, aligned to UTC epoch multiples |
| Ranges | `5m` = 30 × 10 s and `1h` = 60 × 1 min (from the RAM sample ring `<series>.fine`); `24h` = 48 × 30 min, `7d` = 56 × 3 h, `15d` = 60 × 6 h, `30d` = 60 × 12 h (merged from base buckets at read time). UI tabs: 5m (default), 1h, 1D, 1W, 15D, 1M |
| Retention | 31 days by day file; 2 MB per series; flush skipped under 8 MB free |
| Flash flush | every closed bucket (≤ 1 per 30 min, all series in one pass, one global `sync` pair) and on TERM |
| AT cost | **none**: no new AT command, no lock, no `qcmd` |
| Frontend | `types/history.ts`, `hooks/use-history.ts` (`useHistorySeries`, `useHistoryEvents`), `components/history/**`, `app/history/cellular/` |
| Dev test | `tools/history-test/history-test.sh` (runs on the device, §10) |

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
| `events_keep` | Optional. Event types still recorded after a day file reaches the per-day event cap (§3). | `signal_lost signal_restored` |
| `pairs` | Optional. `onset:recovery` event-type pairs; the events CGI adds `end` to onset rows (§6). | `signal_lost:signal_restored` |

There is no `nr_rssi`: the modem reports no NR RSSI (`status.json` `.nr` has none, and QENG's NR row carries no RSSI), so the RSSI chart is LTE-only by data, not by a UI rule.

### State definitions (cellular)

Resolved by the provider from the poller's globals as `status.json` reports them this cycle (after the QMI overlay, see §2):

| State | Rule (first match wins) |
|---|---|
| `off` | `t1_cfun` is `0` or `4` (radio off by the user, airplane mode). Not an outage; drawn as "no data". |
| `down` | the QMI lane reports the baseband down (`_QMI_OK=1`, `_QMI_STATE=down`, read at most `HIST_CL_QMI_MAX_AGE` = 10 s old on the uptime clock), or `modem_reachable` is not `true`, or `service_status` is empty/`unknown`/`sim_error`/`no_service`/`searching`, or neither leg is connected |
| `nr` | `nr_state = connected` (5G NSA anchor up, or SA) |
| `lte` | `lte_state = connected` |

**Why the QMI clause:** outside the Active tier the AT-derived state refreshes every 15 s (Idle) or 60 s (Deep), so a baseband crash (SSR, typically 12 to 20 s on the RM551E) is over before the next AT read and every sample during it still said `nr`. Seen live on 2026-11-09: six SSRs, each a real outage on the Connection series, recorded nothing on Cellular. The QMI sidecar is refreshed every 2 s and says `down` for exactly that window (`qmi-lane.md`). The age guard matters: a broker that dies leaves its last sidecar behind, and a stale `down` must not pin the series at `down`. CFUN 0/4 still wins (`off`). `signal_lost` is unchanged (it is the AT link, "Modem became unreachable"), so an SSR adds `down` time and an outage entry (`x`) but no `signal_lost` row.

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

Restart row (`k:"r"`), one per series on every poller start (`hist_init`), when the store already has data:

```json
{"k":"r","t":1794199490,"boot":1}
```

- `t` = when observation stopped: the trust floor (`last_wall` from the TERM flush, else the newest stored bucket's end, §5); on a same-boot restart, the last saved sample when that is newer (a kill with no TERM flush). It is a stored wall time, so it is queued at once, before the clock is trusted. `boot` = 1 on a new boot, 0 on a same-boot poller restart. Readers that ask for `b` or `e` never see it (`hr_rows` filters by kind); only the events CGI reads it, as a pairing break (§6). The daily event cap does not count it.

**Rows are mergeable.** Several bucket rows with the same `t` are summed (`st`, `x`, `n`, `sum`) and min/max-ed at read time. This one rule absorbs a poller restart mid-bucket, the partial bucket flushed on TERM before a reboot, and a backward clock step that revisits an older bucket. There is no rewrite-in-place anywhere.

### Registering a new series (no core change)

Add `scripts/usr/lib/qmanager/history_series_<id>.sh`:

```sh
HIST_SERIES="$HIST_SERIES thermal"          # register the id
HIST_thermal_STATES="normal throttled"
HIST_thermal_FAULT="throttled"
HIST_thermal_METRICS="soc_c modem_c"
HIST_thermal_EVENTS="thermal_throttled thermal_recovered"
HIST_thermal_EVENTS_KEEP="thermal_throttled thermal_recovered"   # optional: kept past the per-day cap
HIST_thermal_PAIRS="thermal_throttled:thermal_recovered"        # optional: events CGI adds "end" to onsets
HIST_thermal_RESUME=""                                          # optional: onsets a same-boot poller restart keeps (§6)
hist_thermal_sample() {                      # builtins only, no forks
    _HS="normal"; [ "$thermal_throttled" = "1" ] && _HS="throttled"
    _HV_soc_c="$thermal_soc"; _HV_modem_c="$thermal_modem"
}
```

The core dot-sources every `history_series_*.sh` in the lib dir (each guarded with `[ -f ]`, BusyBox aborts on a missing dot-source), calls `hist_<id>_sample` each tick, and the CGIs accept any id whose provider file exists. A provider may also define `hist_<id>_radio TYPE MESSAGE` (sets `_HR` to `lte`, `nr` or empty) to tag event rows with the `radio` field. The page, its i18n and the series' presentation (state colours, metric domains) are the feature's own.

## 2. Collection: a poller hook, not a daemon

The collector is a library sourced by `qmanager_poller`, following the Data Used precedent (`du_init` / `du_tick` / `du_flush`).

**Why not a daemon.** Every value the cellular series needs is already a shell global in the poller (AT parse plus the QMI overlay). A separate daemon would have to read `status.json` each sample, which means a `jq` fork (≈10 ms, plus parsing) every 10 s, and it would sample a file that can be up to one cycle old. Future series (thermal, Data Used, ping/DNS sidecars) are also already loaded in the poller. A poller that is not running correctly produces no data, which is exactly what "no data" means.

**Call sites** (one line each, guarded by `command -v`; a missing lib defines no-op stubs as `data_used.sh` does):

| Where | Call |
|---|---|
| `main()`, after `du_init` | `hist_init` |
| main loop path, **after `write_cache` and before `qmi_overlay_restore`** | `hist_tick` |
| scan / SIM-switch early return, after its `write_cache` | `hist_tick` |
| `append_event` (`events.sh`), after the row is written | `hist_event "$etype" "$message" "$severity"` when `hist_event` exists (the poller); otherwise `_ev_hist_spool` (below) |
| `trap` | `trap 'du_flush; hist_flush; exit 0' TERM INT` |

Placing `hist_tick` inside the overlay window means history records **exactly what `status.json` says that cycle** (QMI LTE signal when the overlay applied, AT otherwise), while `events.sh` and every other AT consumer keep seeing AT samples (qmi-lane Invariant: never feed QMI values to `events.sh`).

### External events (the spool)

`append_event` is also called from processes that never source `history.sh` (the watchcat daemon, CGIs), so `hist_event` is absent there. In that case `_ev_hist_spool` in `events.sh` appends one line `mono|type|severity|message` to `/var/run/qmanager/history/ext.spool`, with `mono` read from `/proc/uptime`. It acts only if that directory already exists (the poller creates it via `qm_run_dir`; a writer never creates it) and drops new lines once 200 are queued, so a stuck poller cannot grow the file.

`hist_tick` handles the spool on every sample tick, in two steps: it first replays `ext.spool.work` (left by the previous tick) line by line through `hist_event TYPE MSG SEV MONO` and deletes it, then renames a non-empty `ext.spool` to `ext.spool.work`. Each series still filters by its own `HIST_<id>_EVENTS`, and the event keeps its own time (the `mono` the writer recorded, mapped through the clock anchor like any event), not the replay time. Lines with a non-numeric `mono` or an invalid type are skipped; an unknown severity becomes `info`.

**Why rename now, read next tick:** a writer that opened `ext.spool` just before the rename may still be mid-`printf`. Reading the renamed file one tick (10 s) later lets that append land first. **Why drop-when-full, not truncate:** writers never rewrite the file, so there is no race with the poller's rename.

> ℹ️ NOTE: the spool lives on tmpfs. Events queued but not yet replayed are lost on reboot, by design (the same bound as the open bucket).

**Adaptive tiers.** The tick runs in every tier, but the inputs differ: in Active everything is ≤ 2 s old; in Idle the AT values are ≤ 15 s old; in Deep, LTE RSRP/RSRQ/RSSI still refresh every 2 s from QMI, while NR values and the AT-derived state refresh every 60 s (`AT+QENG` only). A 10 s sample of a 60 s-old value repeats it, which weights the bucket average correctly. **The history never asks the poller to stay Active and never adds an AT read.** Effect on outage resolution in Deep: a drop is seen when `modem_reachable` or `service_status` change, i.e. within one deep AT interval (≤ 60 s, plus `SC_FAIL_LIMIT`). That is accepted for 30-minute buckets; the doc of record for "how fast is a drop detected" stays `connection-quality.md` (data path) and this table (radio path).

**Hot-path rules (B5.29).** Per cycle: one counter test. Per tick (10 s): the provider and the accumulator use builtins only (`eval` on fixed names, `$(( ))`, `case`), **zero forks**. Every 3rd tick (30 s): the open-bucket mirror is rewritten through `qm_atomic_write` (one `mv`). On bucket close: one `printf >>` to the RAM queue (no fork). On flush: see §4. `status.json` and its composers are untouched, so `tools/poller-parity/` is unaffected.

## 3. Rollup tiers and retention

| Tier | Holds | Where | Bound |
|---|---|---|---|
| Raw | the samples of the open bucket, as running `n/sum/min/max` + state seconds (not individual samples) | poller memory, mirrored to `<series>.open` every 30 s | one bucket |
| Sample ring | every trusted 10 s sample as one row `{"k":"f","t":<wall>,"dt":<s>,"s":"<state>","x":0|1,"m":{"<metric>":<int>}}`, covering `[t - dt, t)`. Feeds the `5m` and `1h` ranges only | `<series>.fine` (RAM, tmpfs) | `HIST_FINE_MAX` 400 rows (~66 min); trimmed to it with one `tail` once 60 rows over. Never on flash, lost on reboot, not written before trust (pre-trust samples are back-dated into base rows only) |
| Pre-trust raw | individual samples taken while the clock is untrusted (§5), with their `mono` | `<series>.pending` (RAM) | 360 lines (1 h at 10 s); oldest dropped beyond that |
| Base | 30-minute bucket rows | RAM queue until flushed, then `d<DAY>.jsonl` on flash | 31 days |
| Read tiers | 30 min, 3 h, 6 h, 12 h | computed by the CGI by merging 1, 6, 12 or 24 base rows | none stored |

The four long ranges are exact multiples of 30 min, so **no coarse tier is stored**: one base tier and a read-time merge give 24 h/7 d/15 d/30 d with no second rollup to keep consistent. The two short ranges cannot come from 30-minute rows, so they read the sample ring instead. **Why a RAM ring and not a finer flash tier:** a 10 s row on flash would mean a flash write every 10 s per series; an hour of RAM is ~70 KB per series and costs one `printf >>` per tick (no fork) plus one `tail` about every 10 minutes. After a reboot the short ranges read as no data until the ring refills, the same bound as the open bucket. 30 days × 48 rows × ~300 B ≈ 430 KB per series. A future range beyond 31 days (90 d, 1 y) adds a stored 12 h tier rolled up from closed base days by the same mergeable-row rule; it is not built now.

**Hard caps.** Day files older than 31 days are deleted after each flush (by file name, no date maths). While a series directory exceeds 2 MB the oldest day file is deleted (never today's). A flush is skipped while `/usrdata` has under 8 MB free (the queue keeps up to 96 rows, then drops the oldest). Events are capped at 2000 rows per day file (after that only `fault`-related types, `signal_lost`/`signal_restored`, are kept that day), so a CA-churn storm cannot fill the store. The pending file is capped at 360 lines, the queue at 96 rows.

## 4. Storage and persistence

| Data | Medium | Why |
|---|---|---|
| Open bucket, queue, pending, run state, clock anchor, external-event spool | `/var/run/qmanager/history/` (tmpfs, dir `0700` root via `qm_run_dir`) | changes every 10 s; survives a poller restart, not a reboot |
| Closed buckets and events | `/usrdata/qmanager/history/<series>/` (UBIFS, dir `0755`) | must survive reboots |
| `since` (when collecting began) and `last_fault` (newest completed fault run) | `<series>/since` and `<series>/last_fault` on flash, written once / once per outage through `qm_durable_write` | rare writes that must survive a reboot right after; the CGI reads them directly (`since` is moved up to the oldest kept row once retention has trimmed past it) |
| `last_wall` (when observation stopped) | `/usrdata/qmanager/history/last_wall`, one line, written by `hist_flush` (the TERM trap) with `printf` before the flush's global `sync`, only while the clock is trusted: the newest sample, or the last poller cycle when newer (events are recorded on every cycle, samples every 5) | read once by `hist_init` as the clock-trust floor (§5) and as the restart row's `t` (§1); one tiny write per poller stop. A torn or old value is ignored |

**Flush.** When any series closes a bucket, `hist_flush` appends every queued row of every series to its day file(s) with `printf >>`, then runs **one `sync`** (global on BusyBox) and truncates the queues. It also runs from the TERM trap (procd stop, planned reboot) with the open bucket written as a partial row, which §1's merge rule absorbs. Worst case on an unplanned reboot or AP hang: the open bucket (≤ 30 min) and its events are lost and read as no data.

**Flash-wear budget.** One append pass per 30 min per device (all series together): 48 small appends per series per day plus 48 global syncs/day, i.e. well under 1 MB/day of UBIFS writes for the cellular series (each append costs at most a page plus metadata). Data Used already syncs every 5 min; this adds less than that.

**Why append + `sync`, not `qm_durable_write`, for day files.** Rewriting a whole day file through a temp file every 30 min would rewrite up to ~15 KB per flush for no gain, and the lost-update window is the same. Append-only files with a `sync` after the write cannot lose earlier rows; a power cut can at worst leave a torn last line, which the reader filters with an anchored `grep -E` row pattern (the Sites precedent) before `awk`. RAM files (`.open`, `clock.env`) use `qm_atomic_write`. Any small state file on flash added later uses `qm_durable_write`. **Never `cp`/`mv` onto flash without a `sync`** (2026-10-19: an unsynced deploy plus a hang zeroed eight files).

## 5. Untrusted clock

The RM551E has no usable RTC: the kernel boots at 1970, `sysfixtime` sets it to the newest `/etc` mtime (often stale), and `time_daemon` (NITZ) or `sysntpd` step it later; an SSR can step it back about 80 s and forward again. The collector therefore stamps everything on the monotonic clock and maps to wall time through an **anchor**:

- `offset = wall - mono`, taken at a trusted moment and kept in `clock.env` (`hist_offset`, `hist_trusted`, `hist_boot`). A bucket key is `floor((mono + offset) / 1800) * 1800`.
- **Trusted** means all of: wall ≥ 1700000000 (`HIST_SANE_EPOCH`, same as Data Used); wall ≥ the newest record minus 120 s (a clock behind our own newest record is stale); and either uptime ≥ 300 s (`QM_TIMER_SETTLE_SECS`, the scheduled-jobs guard) or a step has already been seen this boot.
- **The newest record** (`_hist_tfloor`, set in `hist_init`) is the `last_wall` marker when it is no older than the start of the newest stored bucket, else the newest stored bucket's **end**. **Why:** the TERM flush stores the open bucket as a partial row keyed to its bucket *start*, so that bucket's end can be up to 30 min after the last real sample. Before the marker (until 2026-11-09), every planned reboot left the clock untrusted, and all History pages empty, until the wall clock reached that end: observed live, a reboot at 1794199488 stayed untrusted until uptime ≈ 770 s instead of 300 s. A marker older than the newest bucket belongs to an earlier stop (an unplanned reboot writes none) and is ignored; an unplanned reboot's newest row is a fully closed bucket, whose end is exact.
- **Before trust,** samples go to `<series>.pending` with their `mono`, and events are stamped with `mono` only. At the first trusted tick one `awk` pass back-dates them with the new offset (`mono` is continuous since boot, so a sample taken at 1970 + 40 s lands at its real time), merges them into rows and queues them. Rows that would land before the newest stored bucket are dropped and counted in the log. **Nothing is ever recorded into 1970.** If trust never comes (no SIM, no NTP), the pending file rolls at 1 h and the page shows no data for that time.
- **Steps.** Each tick compares `wall` with `mono + offset`. A drift within ±120 s is ignored (the NITZ wobble around an SSR never touches the buckets). A larger drift re-anchors: the open accumulator is closed into its current key and a new one starts under the new offset. Forward steps leave the skipped span as no data; backward steps revisit older keys, which the merge rule sums. Merged coverage above the bucket length is clamped by scaling the states down proportionally at read time, so a bucket never reports more than 30 minutes.
- **Reboots.** `boot_id` changes, `mono` restarts: the open mirror from the old boot is discarded (its partial row was flushed by the TERM trap if the stop was planned), and the time until the first sample of the new boot is no data.
- **The CGI** computes "now" as `mono + offset` from `clock.env`, not `date`, so the newest bucket matches the collector. With no trusted anchor it answers `clock_trusted:false` and no buckets.

## 6. CGI contract (`history/` namespace)

Both endpoints are authenticated GETs (`cgi_base.sh`), read-only, and use the standard `{success:false, error, detail}` envelope. Error codes (added to `errors.json` in all five catalogs): `invalid_series`, `invalid_range`, `invalid_param`.

### `GET history/series.sh?series=cellular&range=5m|1h|24h|7d|15d|30d`

| Range | `bucket_sec` | Buckets |
|---|---|---|
| `5m` | 10 | 30 |
| `1h` | 60 | 60 |
| `24h` | 1800 | 48 |
| `7d` | 10800 | 56 |
| `15d` | 21600 | 60 |
| `30d` | 43200 | 60 |

`5m` and `1h` read `<series>.fine` (`hr_fine_rows`, flag `HR_FINE` from `hr_range`). Each sample row is **spread over the buckets its interval `[t - dt, t)` overlaps**: state seconds by overlap, each metric counted once in every overlapped bucket, `x` in the bucket that holds `t - 1`. **Why:** samples land every ~10 s but drift against the 10 s grid; keyed by `t` alone, two samples would fall in one bucket and leave its neighbour empty, a zig-zag of "no data" bars. While the collector is alive (`HR_ALIVE`), the newest sample's state is held from its `t` to now (at most 30 s, state seconds only, no metrics), because that sample is up to 10 s old and the last bars would otherwise always read as no data. Output shape is the same as for the other ranges. `events.sh` accepts the same six ranges.

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

- `since` = when collecting began, from the `since` marker file (the first trusted sample, or the oldest back-dated pending sample), moved up to the oldest kept row once retention has trimmed past it; `null` with none. `current.since` = when the current state run began (this boot's samples only; a reboot or a no-data gap ends a run; read from `<series>.run`, `null` while the collector is not alive). `last_fault` is read from the `last_fault` file: the newest completed fault run (`null` if none).
- With `clock_trusted:false` the CGI answers `now:null`, `current:null`, `last_fault:null`, `buckets:[]` and still carries `since` and the descriptor lists.
- `st` is clamped to `len`; `nodata = len - sum(st)`. `m` omits metrics with no reading; `avg` has one decimal.
- Sources: day files covering the range, then the RAM queue, then the open mirror, all merged by the same `awk` program in `history_read.sh`.

### `GET history/events.sh?series=cellular&range=24h&types=band_change,ca_change&limit=5&offset=0`

Newest first. `types` (optional) is a comma list checked against the series' `events`; `limit` 1..100 (default 25); `offset` ≥ 0. With an untrusted clock the answer is `total:0`, `counts:{}`, `events:[]`.

```json
{
  "success": true, "series": "cellular", "range": "24h", "total": 132,
  "counts": { "band_change": 12, "ca_change": 101, "nr_anchor": 9, "pci_change": 8, "scc_pci_change": 0, "signal_lost": 1, "signal_restored": 1 },
  "events": [
    { "timestamp": 1794187659, "type": "ca_change", "severity": "info", "radio": "lte", "message": "LTE CA activated: B1 + B41, 35 MHz (2 carriers)" },
    { "timestamp": 1794100000, "type": "signal_lost", "severity": "warning", "radio": null, "message": "...", "end": 1794100140 }
  ]
}
```

**Pairing (`end`).** A series that declares `HIST_<id>_PAIRS="onset:recovery ..."` gets `"end"` on its onset rows: the `t` of the next matching recovery, unless a **break** comes first, in which case `end` is the break's `t`; `"end": null` while neither exists (ongoing). Breaks:

- **A restart row** (`k:"r"`, §1) at or after the onset. **Why:** the event detectors start fresh after a poller start and adopt the first reading silently, so an onset still open at a stop never gets its recovery; without the break, the next real recovery (hours later) closed it with a fake duration. Observed live 2026-11-09: `internet_lost` at 1794199488, cut by a planned reboot, read **Ongoing** while the page said Online. `end` = when observation stopped: a bounded, honest duration, never a guess at when the outage really ended.
- **A `device_reboot` row of the `system` series**, at `t - off` (when the device went down; unknown `off`: at `t`). For a paired series other than `system`, the CGI reads those rows too (one extra `hr_rows system e`); for `system` they are already in the stream. This covers history written before restart rows existed, with no backfill, and dates an unplanned stop more exactly than a restart row (the alive stamp against the newest bucket's end). The earliest break wins.
- **The next onset of the same type** before any recovery (a missed recovery with no recorded restart): the older onset closes at the newer one.
- **`HIST_<id>_RESUME`** names onset types whose state survives a same-boot poller restart (`system`: `modem_crash`, kept in `system.ssr`, so its recovery still comes). Restart rows with `boot:0` do not break those; a new boot does.

A break at the same second as the onset still applies; a recovery at the same second as a break still pairs. `components/history/system/derive.ts` `closeStaleCrashes` applied the same rules to crash rows on the client and now sees them already closed. Only onset rows carry `end`; every other row omits it (`HistoryEvent.end?: number | null`). Cellular sets `signal_lost:signal_restored`, so a signal-loss row shows its duration. The CGI pairs over the **whole retention window** (31 days, not just the range) *before* the window cut, the type filter and paging, so an outage that began before a 24 h window and ended inside it still resolves, and filtering to `signal_lost` alone still shows each end. `counts` and `total` are computed after pairing.
`counts` is over the range ignoring `types`, so the filter menu can show counts and hide empty types. `radio` is `lte`, `nr` or `null`, set at record time (message prefix `LTE`/`NR`, `nr_anchor` = `nr`, `signal_*` = the leg at that moment, else `null`).

## 7. Frontend contract

- `types/history.ts`: `HistoryRange`, `HistoryBucket<S, M>`, `HistorySeriesResponse<S, M>`, `HistoryEvent` (`end?: number | null`, set on paired onset rows only), `HistoryEventsResponse`, and `CellularState` / `CellularMetric` aliases. Exported constants `HISTORY_RANGES` (bucket counts and sizes) mirror the table above.
- `hooks/use-history.ts`: `useHistorySeries<S, M>(series, range)` and `useHistoryEvents(series, range, { types, page, pageSize })`. Both return `{ data, isLoading, error, refresh }`, refetch every 30 s through `startVisibleInterval` (`lib/visible-interval.ts`, so a hidden tab stops polling and refetches on show), refetch at once on a range, page or type-filter change, and keep the previous data while a new query loads (`isLoading` is true, `data` is not cleared, so no skeleton flash on a range switch).
- **Stale responses.** Each query has an `AbortController`; a response for a query that has since been replaced is dropped.
- **`error`.** Set only when the *current* query has nothing on screen: a failed poll behind an on-screen response keeps that response and retries at the next tick. The message goes through `resolveErrorMessage` (the `errors` namespace); `invalid_series`, `invalid_range` and `invalid_param` have entries in all five catalogs.
- A new History page = a `history_series_<id>.sh` provider + its page under `app/history/<id>/` + `components/history/<id>/**`. Shared, series-agnostic pieces live in `components/history/` (range control, state strip, bucket-axis ticks, metric chart, shared cursor context, events table shell).
- The page shows `clock_trusted:false` and `since:null` as the empty "Collecting" state.
- **Connection strip** (`components/history/cellular/derive.ts`, `bucketKind`): any `down` time or outage entry (`x > 0`) makes the bucket an outage; otherwise the majority radio (`nr` vs `lte`). A bucket reads **no data** when radio coverage (`nr + lte`) is below 50 % of its span, or has none. The span is counted from `since` for the bucket collection began in (the head before `since` is not part of it), so a fresh install's first bucket (up to 12 h on 30d) is not blanked for time that was never collected. `off` and uncollected time both read as no data.

## 8. Lifecycle lockstep

| Step | `install.sh` (fresh + Software Update) | `uninstall.sh` | ipk |
|---|---|---|---|
| Files | `history.sh`, `history_read.sh`, `history_series_*.sh` go with the flat lib copy; `history/*.sh` with the CGI tree (`install_tree`) | removed with the trees | listed in the package manifest by the existing tree globs (`scripts-dev/ipk/`) |
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

Results are in §11.

**Rollback.** Remove the four call sites (or install the previous poller and `events.sh`): with the lib absent the stubs are no-ops. The store is inert data; delete `/usrdata/qmanager/history` to reclaim it. The frontend route can ship or roll back independently (the CGI errors become the page's error state).

## 10. Testing

`tools/history-test/history-test.sh` is the dev test for the collector and the reader. It runs **on the device** under its BusyBox, in a scratch dir under `/tmp`, and touches no live state.

```sh
sh history-test.sh <flat dir>
```

`<flat dir>` holds, flat: `history.sh`, `history_series_cellular.sh`, `history_read.sh`, the two CGIs as `series.sh` and `events.sh`, and optionally `events_lib.sh` (the library `events.sh` from `usr/lib/qmanager`, renamed so it does not collide with the CGI of the same name; it enables the spool-writer cases). The script prints `FAIL: ...` per failure and a pass/fail summary.

| Override | Effect |
|---|---|
| `HIST_STORE` | flash store root (default `/usrdata/qmanager/history`) |
| `HIST_RUN` | RAM state dir (default `/var/run/qmanager/history`) |
| `HIST_UPTIME_FILE` | stands in for `/proc/uptime` (the monotonic clock) |
| `HIST_BOOT_ID_FILE` | stands in for the boot id file |
| `HIST_LIB_DIR` | where `history.sh` looks for providers and the CGIs for `history_read.sh` |
| `HIST_SYNC` | the `sync` command (`true` in the test) |
| `_SKIP_AUTH=1` | lets a CGI run without a session |

## 11. Validation (2026-11-09, RM551E)

| Check | Result |
|---|---|
| On-device test (`history-test.sh`) | 50 passed, 0 failed; 63 of 63 after the 2026-11-09 fixes (QMI `down` cases, `last_wall` trust-floor cases); 71 of 71 with the pairing-break cases |
| Live CGI shape | 24h = 48 buckets, 7d = 56, 30d = 60 |
| 30 d query time | about 60 ms |
| Poller restart mid-bucket | the run resumed (`run_mono` kept) |
| Clock trust | trusted on the first sample |
| `hist_tick` cost | micro-benchmark about 1.5 ms per poller cycle averaged (about 0.08 % of one core at the 2 s period), with the cellular and connection providers loaded |
| Whole-poller CPU | 4.74 % (idle tier 12/12) against a 4.17 % baseline (idle 3 / deep 9). The delta is the tier mix, not history |
| UI (dev server, captured live responses) | 24h/7d/30d switch refetches both endpoints at once; error state and retry verified |
| Reboot survival | passed. Day files, `since` and events survived. The TERM flush stored the open buckets and the last events. After boot the clock stayed untrusted (`hist_trusted=0`, samples in `.pending`) until uptime about 344 s, then re-trusted and back-dated both series. No row is dated before 2023 in the day files or queues. The reboot gap reads as no data, not an outage. The on-device test was rerun after the reboot: 50 passed, 0 failed |
| Poller restart with a third series loaded | `[cellular connection system]` loaded; the cellular run resumed without a gap |

### Live events (2026-11-09, RM551E, watchdog off)

Real events, not simulated: 8 baseband SSRs (broker episodes 2 to 9) (dmesg `4080000.remoteproc-mss: fatal error`, RF `nr_rx_ctl_agc` fault), one `AT+CFUN=4` window (92 s, with the user's OK), two planned reboots (user's OK) and one unplanned hard reset (PMIC `PS_HOLD`, no pstore record, cause unknown).

| Check | Result |
|---|---|
| Connection outages | every SSR produced an `internet_lost` row and, except the last (cut by a reboot, see Open), an `internet_restored` row 10 to 22 s later. `down` seconds and `x` in the right buckets, `last_fault` set, the events CGI sets `end` on each onset. On the page: reachability strip red in the 11:00, 12:00 and 12:30 buckets, Availability 98.59 % with 10 outages (= sum of `x`), Last outage 10 s, Lasted column filled |
| Cellular during SSRs | **gap found and fixed.** Before the fix, the six SSRs recorded nothing on Cellular (state kept `nr`, AT state lags up to 60 s). After the fix (§1, QMI clause), the next two SSRs were recorded as `down` 36 s, `x` 2, `last_fault` 1794199397..1794199417. On the page: Last outage 20 s, Availability 99.64 % with 2 outages |
| `AT+CFUN=4` (92 s) | both series `off` within one 10 s sample, 101 s `off` stored, not counted in `x`. The ping verdict went false about 28 s in, so Connection logs an `internet_lost` row during radio-off (paired, Lasted 1m 27s); the outage count only counts the 14 s still `down` after `CFUN=1` until the ping recovered |
| Clock trust after a planned reboot | **delay found and fixed** (§5, `last_wall`). Reboot 1 (old code): untrusted until uptime ≈ 770 s, all pages "Collecting" meanwhile. Reboot 2 (fixed): trusted at uptime 303 s |
| Rows after reboots | no row dated before 2023; reboot gaps read as no data (bucket coverage 1669 of 1800 and 578 of 688) |
| Untrusted window, page | Cellular and Connection showed "Last outage: None, No outages recorded" while the CGI answered `last_fault:null`; **fixed**, the tile now shows a dash and "Collecting data" until the clock is trusted |
| Onset rows across a reboot | **found and fixed** (§6 Pairing breaks, restart rows §1). `internet_lost` at 1794199488 (an SSR detected in the second the planned reboot was requested) read **Ongoing**, and the next real recovery would have given it an hours-long duration. After the fix the CGI closes it at 1794199488 (`device_reboot` t 1794199512, `off` 24: down in that second, so Lasted 0 s); the crash row at 1794199473 closes at the same break. history-test 71 of 71 (6 new checks fail on the old code), system-test 51 of 51 |

**Open:**

- `signal_lost` has still never been observed live: it fires only when the AT link itself fails, and none did; the SSRs above are recorded as `down` time, not as `signal_lost`.

---

## Connection History

`/history/connection` is the second History page and the home of what used to be the Latency Monitor (retired, see [`../reference/latency-monitor.md`](../reference/latency-monitor.md)). It answers "was the internet up, and how fast was it" over 24 h, 7 d or 30 d: a reachability strip, four metric charts, the per-site Sites card and the connection events. The series is a provider file only; the core, the two CGIs and the shared pieces in §1 to §8 are unchanged.

### Quick Reference

| Item | Value |
|---|---|
| Page | `/history/connection` (sidebar **History** group, sub-row `history_connection`); `app/history/connection/page.tsx` |
| Provider | `scripts/usr/lib/qmanager/history_series_connection.sh` (series id `connection`) |
| States | `up down off` (fault: `down`) |
| Metrics | `lat_ms jit_ms loss_pct dns_ms` (integers, only sampled while `up`) |
| Events | `internet_lost internet_restored high_latency latency_recovered high_packet_loss packet_loss_recovered watchcat_recovery sim_failover` |
| `EVENTS_KEEP` | `internet_lost internet_restored sim_failover` (kept past the per-day event cap) |
| `PAIRS` | `internet_lost:internet_restored high_latency:latency_recovered high_packet_loss:packet_loss_recovered` |
| Page components | `components/history/connection/**` (`connection-history.tsx`, `reachability-card.tsx`, `summary-tiles.tsx`, `metric-charts.tsx`, `connection-events-card.tsx`), pure logic in `derive.ts`, `chart-metrics.ts`, `events-presentation.ts`; data access in `data.ts` (thin wrappers over `useHistorySeries` / `useHistoryEvents`); types in `types.ts` |
| Sites card | `components/history/connection/sites/` (`sites-card.tsx`, `site-detail.tsx`, `manage-sites-dialog.tsx`, `site-mark.tsx`, `condition-block.tsx`, `derive.ts`, `shapes.ts`); depends on `hooks/use-sites.ts` and `monitoring/sites.sh`, see [sites-monitor.md](sites-monitor.md) |
| Limits | `connectivity.thresholds.latency_ms` / `.loss_pct` from `useModemStatus` (30 s poll); fallback **250 ms / 30 %** (`DEFAULT_LIMITS`) |
| Copy | `history` namespace, `connection.*`, all five locales (the Sites strings moved here from `dashboard` `latencyMonitor.*`) |
| AT / probe cost | **none**: reads globals the poller already holds; no new probe, no AT command |

### State rules

Resolved each 10 s tick by `hist_connection_sample` from the poller's globals (first match wins):

| Sample | Rule |
|---|---|
| `off` | `t1_cfun` is `0` or `4`. The radio is off on purpose, so it is **not an outage**. It is drawn as no data. |
| `down` | `conn_internet_available` is `false` (the ping daemon's verdict, `qmanager_ping`). The only fault state. |
| `up` | `conn_internet_available` is `true` |
| no sample | `conn_internet_available` is anything else (`null`: the ping data is missing or stale). The tick takes no sample, so that time reads as no data. |

**Why:** `down` must mean "the ping daemon said so", not "we lost sight of the ping daemon". A stalled prober, a poller restart and a reboot all produce no data, never a fake outage. `off` is separate from `down` so an airplane-mode night does not read as an outage in the availability figure (`availability = up / (up + down)`, `off` and no data are in neither).

### Metric sources and cadence

| Metric | Source global | Notes |
|---|---|---|
| `lat_ms` | `conn_latency` | The **last RTT**, rounded to whole ms (0 to 60000). Bucket avg/min/max come from real RTTs, not a 5-minute average. |
| `jit_ms` | `conn_jitter` | 5-minute window from the poller; `null` while immature = no reading. 0 to 60000. |
| `loss_pct` | `conn_packet_loss` | Integer %, 5-minute window from the poller. 0 to 100. |
| `dns_ms` | `dns_lookup_ms` | The Connection Quality DNS sidecar; `null` after 180 s = no reading ([connection-quality.md](connection-quality.md#dns-lookup-time)). 0 to 60000. |

- **Metrics are sampled only while `up`.** A `down` or `off` tick adds time to its state and no metric value, so a dead link never writes a 0 ms latency.
- **Cadence chain.** `qmanager_ping` probes once per Sensitivity interval; the poller reads the result every 2 s cycle; the history samples every 10 s (§2). A value is therefore repeated between pings, which weights the bucket average by time, as for any other slow input.
- **Loss and jitter lag.** They are 5-minute windows, so a short burst raises the loss figure for up to five minutes after it ends. Read the Reachability strip for when it happened and the loss chart for how much.
- Values pass `_hcn_v` (builtins only): non-numeric, negative, multi-dot or out-of-range input is no reading; `62.4` rounds to `62`. The provider forks nothing and sends no AT command.

### "Slow or lossy" is derived, never stored

The store holds `up`, `down` and `off` seconds plus metrics. "Slow or lossy" exists only in the page (`bucketKind` in `derive.ts`), per bucket, against the **current** limits:

| Reachability colour | Rule (first match wins) |
|---|---|
| Destructive (down) | `x > 0` or any `down` seconds in the bucket |
| `surface-container-high` (no data) | no `up` time (a partly covered bucket is graded on what it saw) |
| Warning (slow or lossy) | bucket average latency above the latency limit, **or** bucket average loss at or above 5 % (`LOSS_SLOW_PCT`) |
| Success (responsive) | otherwise |

**Why:** the limit is a user setting. Storing a verdict would freeze it at the limit of the day; deriving it means changing the limit in Connection Quality recolours the whole history. Any outage wins so a 30-second drop stays visible inside a 12-hour bucket. The summary tile "Slow in N of M periods" counts warning buckets out of the buckets that are not no data.

### Page anatomy

The range control (24h / 7d / 30d) is the only page-level state besides the shared cursor; every card follows it.

1. **Summary tiles** (`summary-tiles.tsx`): Online for, Offline for or Radio off (how long the current state has held, `current.since`), Last outage (`last_fault`), Availability % (floored, so an outage never reads as a perfect 100; 99.99 at most with any down time), Median latency (median of the per-bucket averages) with "Slow in N of M periods" or "Within your limit".
2. **Reachability strip** (`reachability-card.tsx`): one bar per bucket in the colours above, legend of the states present, tooltip with the figures.
3. **Charts** (`metric-charts.tsx`, 2x2): Latency, Packet loss (bars), Jitter, DNS lookup. Dashed limit lines for latency and loss. A bucket that spent half or more of its observed time down plots as a gap (the line breaks) and an outage band marks it. Y top = nice ceiling of `max(p95 of bucket averages x 1.25, floor, limit x 1.2)`, floors 300 ms / 40 % / 20 ms / 60 ms.
4. **Sites card** (below).
5. **Connection events** (`connection-events-card.tsx`): newest first, type filter (Outages, High latency, Packet loss, Watchdog, SIM failover), 5 / 10 / 25 / 50 rows per page (default 5), a **Lasted** column on onset rows.

The strip, charts and events share one cursor (`history-cursor.tsx`): hovering a bar marks that moment on every card. A collector with no trusted clock answers with no buckets; `withBuckets` lays out empty buckets so the cards still draw their collecting state.

### Events: pairing and the external spool

- **Lasted.** `history/events.sh` reads `HIST_connection_PAIRS`. Each onset row (`internet_lost`, `high_latency`, `high_packet_loss`) gets `"end": <epoch>` of the next matching recovery, or of the first break before it (a restart, a device reboot, a newer onset of the same type, §6 Pairing), or `"end": null` when neither exists yet (ongoing). The page shows the duration, or "Ongoing" (destructive ink for an outage). Pairing scans every retained row (31 days), not only the range window, so an onset near the start of the window still finds its recovery. `HIST_cellular_PAIRS="signal_lost:signal_restored"` uses the same mechanism. A core without `PAIRS` returns no `end` and the column shows nothing.
- **Why in the CGI:** pairing in the client fails across pages (the recovery can sit on page 2), so the one place that sees all rows does it.
- **Watchdog and SIM failover rows** (`watchcat_recovery`, `sim_failover`) are written by `qmanager_watchcat`, a separate daemon with no `history.sh`. `events.sh` `append_event` calls `_ev_hist_spool` when `hist_event` is not defined, which appends `mono|type|severity|message` to `/var/run/qmanager/history/ext.spool` (only once the poller has made that directory; capped at 200 lines, new lines are dropped when full). The poller's `hist_tick` ingests the spool (`_hist_spool`, rename then read) through the normal `hist_event` path, using the `mono` the writer recorded. There is still exactly one writer to flash. A watchdog recovery is `info` severity: the watchdog acting is a fact, not a verdict.

### Sites card and alignment

The Sites card follows the page range. `useSites(range: HistoryRange, live: boolean)` requests `monitoring/sites.sh?range=<the page range>`, whose buckets are **10 s / 60 s / 1800 s / 10800 s / 21600 s / 43200 s**, the same UTC-aligned sizes as the History ranges, and anchors its grid on the response's `now` (the modem clock), so a skewed browser clock cannot shift a probe into the wrong 10 s slot. Sites sweep every `interval_sec` (5 min by default), so the short ranges are mostly empty buckets: that is the data, not a fault. The two are aligned **on the server** on purpose: the old 20-minute, 2-hour and 8-hour buckets do not divide into the page's buckets, so client re-binning would smear samples across bars and break the shared cursor. The 24h range no longer returns raw rows. Daemon, store and CGI contract: [sites-monitor.md](sites-monitor.md).

- **Value under each logo.** In Live, the latest live sample (`liveData`; a miss reads "No reply"). Otherwise `siteAverage(series)` over the range: the mean of **answered** samples, each bucket weighted by its `ok` count (not a mean of bucket means). No answered sample but some sampled reads "No reply"; never checked reads "Not checked yet"; anything else is a dash.
- **Tone.** `latencyTone(ms, limit)`: amber above the latency limit, red above twice the limit, green otherwise. A Sites figure is a **TCP connect time** graded against the same single latency limit as the ICMP probe, not a site-specific number.
- **Live values** replaces the old "Now" pill. It is a row in the **Manage** dialog (On/Off, disabled while Monitor is off), part of the dialog draft and applied on Save. It is this viewer's choice, held in the card's state, never sent to the modem (the lease belongs to whoever is watching). On, `useSites` runs a second loop reading `?range=now` every 2 s (`LIVE_POLL_MS`) **only while the tab is visible and the monitor is enabled**; each read renews the daemon's lease ([sites-monitor.md](sites-monitor.md#live-mode-now)). The result lands in `liveData` and never touches `data`; turning Live off clears it. A disabled monitor writes no lease, so Live reads nothing.
- **`dataRange` / `dataNow`.** `dataRange` is the range `data` was read for and lags `range` until the new read lands (the figures dim meanwhile); `dataNow` is the right edge of the detail chart's bucket grid. Every fetch carries a sequence number so a slow 30d read cannot overwrite a newer 24h one.
- **Detail panel.** Clicking a site opens Average, Fastest, Slowest, Answered % and a latency chart over the range with the limit line.
- **Cadence.** Range read: 30 s idle, 3 s while `checking` or a check is pending (a pending check expires after 90 s). No Check now button: a successful Manage save with the monitor on calls `checkNow()` without blocking the dialog, and only a failed check toasts (`connection.toast.check_failed`).
- **Manage dialog.** On/Off, sweep interval, the site list. `normalizeHost` lower-cases and strips scheme, credentials, path, query and port (not `www.`); `hostError` returns `invalid`, `duplicate` or `full` at `MAX_SITES = 32`.
- **Toasts** (`connection.toast.*`): `save_ok` / `save_failed` (dialog), `turn_on_ok` / `turn_on_failed`, `check_failed`. Failure descriptions come from the call's returned `MutationResult` through `resolveErrorMessage`. Polling, range changes and draft edits never toast ([toast-confirmation.md](../reference/toast-confirmation.md)).

> ⚠️ WARNING: the saved sites config is built by `configOf()` in `sites-card.tsx`, which keeps only `kind: "site"` entries. The CGI response can include a `kind: "gateway"` entry that is not part of the config; saving it back would add the gateway as a site. Any new save path (Turn on, the dialog) must go through `configOf`.

**Brand marks.** `site-mark.tsx` is a thin wrapper over the shared `components/ui/brand-mark.tsx` (also used by the SMS sender discs; contract in [sms.md](sms.md#sender-identity-and-logos)). One map, `BRAND_MARKS`, holds domain to glyph and colour; add a brand there and nowhere else. `markFor()` strips a leading `www.` and matches the domain or any subdomain. A `null` colour means on-surface ink (near-black brands, and any hex that fails contrast on either tile; check a new hex on the tile in both themes). `dota2.com` needs its mapped mark because it serves only a 16 px favicon. An unmapped host goes through `lib/logo-store.ts` (Hunter, then the Google s2 favicon, else a monogram); Sites tiles keep the fitted logo, the SMS discs fill the disc.

### Invariants

- **No new probes, no AT.** The series reads globals the poller already holds. Adding a probe for this page would double the load on the modem for data the Connection Quality pipeline already produces.
- **"Slow" is never stored.** Do not add a `slow` state to the provider; the page derives it from the live limits.
- **`off` is not an outage.** CFUN 0/4 is `off`, shown as no data, excluded from availability and from the outage count.
- **A stale or missing ping is no data**, not `down`.
- **The Sites ranges stay aligned.** If you change a History range or bucket size, change the `24h` / `7d` / `30d` buckets in `monitoring/sites.sh` with it.
- **`hooks/use-latency-history.ts` stays.** The dashboard Connection Quality card still reads the in-RAM ping archive; only the Latency Monitor page was retired.

### Retired route

`app/monitoring/latency/page.tsx` is a client-side redirect to `/history/connection` (`router.replace`). QManager is a static export served off the modem, so a server redirect is impossible; a `Suspense`-wrapped client page keeps old bookmarks working. The `latency_monitor` sidebar row is gone.
