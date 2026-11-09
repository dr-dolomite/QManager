# System Health history (`/history/system-health`)

System Health is the second History page. It shows how the modem itself held up over 24 hours, 7 days or 30 days: when the device restarted and why, when the baseband (modem) crashed and came back, when heat slowed the radio, plus processor, memory, hottest-sensor temperature and storage fill. It is the `system` *series provider* on the generic History store: no change to the core, no new daemon, no AT command. Read [`history.md`](history.md) first; this doc covers only what is specific to the `system` series.

## Quick Reference

| Item | Value |
|---|---|
| Page | `/history/system-health` (sidebar: History > System Health, key `history_system`) |
| Provider | `scripts/usr/lib/qmanager/history_series_system.sh` (dot-sourced by `history.sh` inside the poller) |
| Read path | the generic `history/series.sh?series=system` and `history/events.sh?series=system` (see [`history.md`](history.md) §6; no new CGI for the charts) |
| Flash | `/usrdata/qmanager/history/system/` (`d<DAY>.jsonl`, `since`, plus the provider's own `alive` and `boot` stamps) |
| RAM | `/var/run/qmanager/history/system.{open,queue,pending,run}` (core), `system.ssr` and `system.df` (provider) |
| States | `normal throttled`; `FAULT` is empty (no outage/availability maths on this series) |
| Metrics | `cpu mem_pct mem_mb temp_c st_sys_used st_sys_size st_app_used st_app_size st_tmp_used st_tmp_size` |
| Events | `device_reboot modem_crash modem_recovered thermal_throttled thermal_recovered` |
| Pairs | `modem_crash:modem_recovered thermal_throttled:thermal_recovered` (the events CGI adds `end` to the onset rows) |
| Reboot ledger | `/etc/qmanager/crash.log`, rows `<epoch>\|reboot\|<reason>` |
| Types | `types/system-history.ts` (`SystemState`, `SystemMetric`, `SystemIncident`, `RebootCause`, `parseRebootMessage`, `parseThermalParts`) |
| Frontend | `app/history/system-health/page.tsx`, `components/history/system/**` (`derive.ts` is the pure core), hooks `useHistorySeries<SystemState, SystemMetric>("system", range)`, `useHistoryEvents("system", range, { page: 0, pageSize: 100 })`, `useModemStatus` for live values |
| Dev test | `tools/history-test/system-test.sh` (51 checks, runs on the device or any POSIX sh) |
| AT cost | none |

The page also hosts a **Logs card** (QManager tab and System tab, with a System/Kernel switch) at the bottom. It is not part of the `system` series: it reads the log CGIs directly. Its contract lives in [`../reference/logs.md`](../reference/logs.md).

---

## 1. Invariants

1. **Builtins only per tick.** `hist_system_sample` runs every 10 s inside the poller and uses only shell builtins on the poller's globals (`cpu_usage`, `memory_used_mb`, `memory_total_mb`, `t1_temperature_max`, `thermal_throttling`, `_QMI_SSR`, `_QMI_STATE`). Forks happen on rare edges only: one `df` per hour, one `dmesg | grep | tail` per modem crash. **Why:** this is the poller hot path (B5.29 rule in `history.md` §2).
2. **No new data source, no AT.** CPU, memory and thermal come from the poller; SSR comes from the QMI lane; reboot cause comes from `crash.log`. `status.json` and its composers are untouched, so `tools/poller-parity/` is unaffected.
3. **The modem-crash source is the QMI lane, not the watchdog.** The watchdog only greps `dmesg` at escalation time and records no recovery, so it cannot be used. The provider reads `_QMI_SSR` (the broker's SSR episode counter) and `_QMI_STATE` (`down` during the SSR window), both loaded each cycle by `qmi_load` (`qmi_merge.sh`). Without the lane (`_QMI_OK` not `1`) the provider records no crash events at all. See [`qmi-lane.md`](qmi-lane.md).
4. **`device_reboot` is stamped at the boot instant, not at classification time.** The classification runs on the first *trusted* sample of a boot, but the event is recorded with mono `0` (the moment this boot began), so its `t` is the boot epoch (`_hist_off`). **Why:** the page needs "back online at" to draw the offline span `[t - off, t]`.
5. **`device_reboot`, `modem_crash` and `modem_recovered` go to history only.** They are emitted by the provider through `hist_event` and never through `append_event`, so they do not appear in the Network Events log or in Alerts. `thermal_throttled` / `thermal_recovered` come from `events.sh` `detect_thermal_events` as before (they also reach the Network Events log and the thermal alert).
6. **One `device_reboot` per boot.** The provider's `boot` stamp holds the `boot_id` it last classified. A poller restart in the same boot finds a matching stamp and records nothing. The first boot after install has no stamp: it writes the stamp and records nothing.
7. **Alerts and Recent Reboots are unchanged.** `alert_engine.sh` `_ae_classify_reboot` folds `user`, `scheduled` and `update` into its `user` bucket (and `tier4_escalation` into `watchdog`). Only System Health tells them apart.

## 2. Series descriptor and metrics

| Metric | Unit | Source | Notes |
|---|---|---|---|
| `cpu` | % busy | `cpu_usage` | range 0..100, else no reading |
| `mem_mb` | MiB in use | `memory_used_mb` (MemTotal minus MemAvailable) | |
| `mem_pct` | % in use | `mem_mb * 100 / memory_total_mb` (integer division) | no reading unless both inputs are valid |
| `temp_c` | whole degrees C | `t1_temperature_max` | range -40..150; the **hottest** valid modem zone |
| `st_{sys,app,tmp}_{used,size}` | KiB | `df -k /real_rootfs /usrdata /tmp` | System = rootfs, App data = `/usrdata`, Temporary files = `/tmp`; `/firmware` is excluded |

`temp_c` is not `t1_temperature`. The status poll publishes `t1_temperature`, the **mean** of the zones. History needs the hottest zone because the throttle trip is judged against the hottest one. `parse_temperature` in `parse_at.sh` sets `t1_temperature_max` in the same loop (same type-name allow-list, same sentinel skips, same half-to-even rounding), with no extra reads. It is cleared wherever `t1_temperature` is. It is never written to `status.json`.

**Storage is sampled on the first tick and then every 360th sample (hourly).** In between, the storage metrics hold no reading, so most buckets have `n = 0` for them (omitted from `m`). That is by design: the page takes the newest bucket that has a reading as "now" and the oldest as "start of range" (`storageReadings` in `derive.ts`). A missing mount is a missing reading for that area only. Values are validated by `_hsy_kb` (digits only, no leading zero, at most 10 digits).

> ⚠️ WARNING: BusyBox `df` wraps a long filesystem name onto its own line, with the numbers on the next line. `_hsy_storage` handles both layouts; a parser that assumes one line per mount silently loses `/usrdata`.

`state` is `throttled` while the poller's raw `thermal_throttling` is `1`, else `normal`. The state is **not** debounced; the events are (see Known limits).

## 3. Events

| Type | Severity | Message | `t` | Emitted by |
|---|---|---|---|---|
| `device_reboot` | `info` (planned) / `error` (unexpected) | `cause=<unexpected\|update\|scheduled\|user\|watchdog> off=<seconds\|->` | boot epoch (device back up) | provider, once per boot |
| `modem_crash` | `error` | `Modem crashed` | SSR onset | provider |
| `modem_recovered` | `info` | `Modem recovered` | first sample with the lane `up` | provider |
| `thermal_throttled` | `warning` | `Thermal throttling started (LTE, 5G)` (the parenthesis may be absent) | debounced onset | `events.sh` |
| `thermal_recovered` | `info` | `Thermal throttling ended after <dur>` | debounced recovery | `events.sh` |

All five are in `HIST_system_EVENTS_KEEP`, so they are still recorded after a day file reaches the 2000-row event cap.

`off=-` means the offline time is unknown. The page draws the offline span as `[t - off, t]`, or a zero-length span at `t` when unknown. `parseRebootMessage` defaults a missing or foreign `cause` to `unexpected`.

### Modem crash detection (SSR)

- **Baseline.** The first valid `_QMI_SSR` of a run becomes the baseline. It is mirrored to `/var/run/qmanager/system.ssr` as `<boot_id> <count> <crash_open>` so a poller restart in the same boot keeps both the baseline and an open crash. A baseline from another `boot_id` is ignored.
- **Onset.** A higher count records one `modem_crash` (a jump of 2 is still one crash; a second increase while a crash is open adds nothing). The onset time is refined with one `dmesg | grep -F '4080000.remoteproc-mss: fatal error received' | tail -n 1`: the bracketed seconds-since-boot stamp is used when it is not in the future, within `HIST_SYS_SSR_LOOKBACK` (60 s) of this sample, and not older than the previous sample. Otherwise the onset is this sample's time.
- **Recovery.** `modem_recovered` is recorded on the first sample with `_QMI_STATE = up` while a crash is open (about 10 s grain).
- **Lower count** (broker restart, new boot): re-baselines silently, and closes an open crash with a `modem_recovered`.

> ℹ️ NOTE: `dmesg` runs only on the onset edge, so an SSR storm costs one fork per episode, not per sample.

## 4. Reboot classification

Runs once per boot, on the first sample where the history clock is trusted (`history.md` §5), from `_hsy_reboot`.

**Inputs.** The newest in-window `crash.log` row, and the provider's `alive` stamp (`<wall_epoch> <boot_id>`, rewritten every `HIST_SYS_ALIVE_EVERY` = 30 samples = 5 min with a builtin `printf`). The `alive` stamp is trusted only if it is two clean fields, carries the previous boot's id (equal to the `boot` marker), is at least `HIST_SANE_EPOCH`, and is before this boot's epoch. A torn, foreign or insane stamp means "unknown", never an error.

**Window.** `crash.log` rows are considered when `epoch` is in `[alive - 60 s, boot epoch]`; without a valid stamp, `[boot epoch - 900 s, boot epoch]`. The newest matching row wins. Rows of type other than `reboot`, with an unknown reason, or with a non-numeric epoch are skipped (this includes the `unplanned` rows the alert engine back-fills).

| `crash.log` reason | Written by | `cause` | Page row (en) | Tone / glyph |
|---|---|---|---|---|
| `user` | the reboot CGIs (`cgi_base.sh`), IMEI check, IP passthrough apply, uninstall | `user` | Restarted from QManager | neutral, `restart_alt` |
| `scheduled` | `qmanager_scheduled_reboot` (crond job) | `scheduled` | Scheduled restart | neutral, `event_repeat` |
| `update` | `scripts/install.sh` `reboot_system`, `qmanager_update` `mark_update_reboot` | `update` | Restarted to finish a software update | neutral, `system_update` |
| `tier4_escalation` | `qmanager_watchcat` (Watchdog Tier 4) | `watchdog` | Restarted by the connection watchdog | neutral, `restart_alt` |
| no row in the window | n/a | `unexpected` | Device restarted unexpectedly | destructive, `power_settings_new` |

- **Planned:** `off = boot epoch - row epoch` (from the moment the reboot was requested). Severity `info`.
- **Unexpected:** `off = boot epoch - alive stamp` when the stamp is valid, else `-`. Severity `error`.
- `scheduled` and `update` are new `crash.log` reasons. `record_planned_reboot` (`qlog.sh`) accepts any bare lowercase `[a-z_]` tag, so no ledger format change was needed. `qmanager_update` and `install.sh` can both write an `update` row for one update; the newest wins and the cause is the same.

> ⚠️ WARNING: Do not add a reason to `crash.log` without a matching `case` arm in `_hsy_reboot` (and `_ae_classify_reboot` if Alerts should see it). An unknown reason is skipped and the restart reads as `unexpected`.

**Why a provider-owned `alive` stamp.** Nothing records when the device went offline after an unplanned reboot. The stamp is the last time the poller was alive, so it is the only honest start of the offline span. It is a flash write every 5 minutes of 2 short fields; it uses `printf >` (no fork) and a torn write is tolerated by the reader.

## 5. Frontend

- `derive.ts` is pure and unit-tested (`derive.test.ts`). `deriveIncidents(events, buckets)` turns the raw event rows into `SystemIncident`s (`reboot`, `modem`, `heat`), newest first, so the stability lanes, the chart markers, the summary tiles and the events list all agree. Recovery rows are dropped; an incident that began before the window but reaches into it is kept.
- **Lanes** (Stability card): Device, Modem, Heat. A planned restart is a gap in the track; an unexpected restart and a modem crash are destructive marks; throttling is a warning span. The lanes, charts and events list share one cursor (`HistoryCursorProvider`).
- **Cards:** four summary tiles (Up for, Modem restarts, Processor, Memory; Up for and Memory use the live status poll), Stability, three charts (Processor, Memory, Temperature with a dashed "Throttles at N C" guide from the status poll's `trip_c`), Storage (three meters with a tick for where each area stood at the start of the range; warning from 80 %, destructive from 90 %), System events (grouped by day, five rows then "Show more"), Logs.
- **One event fetch** (`pageSize: 100`) feeds lanes, markers and the list. Reboot, crash and throttle episodes beyond 100 events in a range are not drawn.
- Strings live in `history.json` `system.*` in all five catalogs. Glyphs are Material Symbols (`/history/**` is a Material route).
- `mock-fixture.ts` holds five scenarios (healthy, modem, hot, storage, fresh) in the exact CGI shapes; it is test-only (`derive.test.ts`), the page has no mock switch.

## 6. Known limits

| Limit | Why | Effect |
|---|---|---|
| Unexpected-reboot offline time is accurate to about 5 min | the `alive` stamp is written every 5 min | `off` can be up to 5 min too long; with no valid stamp it is `-` |
| The `device_reboot` event appears about 5 min after the device is back | it is classified on the first trusted sample, and the core trusts the clock at the 300 s settle (`history.md` §5; earlier on a NITZ step) | the event appears late but its `t` (boot epoch) is correct; the charts lag the same way. Until 2026-11-09 this could reach about 28 min after a planned reboot (trust waited for the end of the TERM-flushed bucket); the core's `last_wall` marker removed that |
| A crash followed by a device reboot has no `modem_recovered` row | the modem went down with the device | the events CGI ends the crash at the reboot's offline start (`device_reboot` `t - off`, or the new boot's restart row) and an older unpaired crash at the next crash (`history.md` §6 Pairing); `deriveIncidents` (`closeStaleCrashes`) keeps the same rule as a fallback. A same-boot poller restart does not end a crash (`HIST_system_RESUME="modem_crash"`: the state survives in `system.ssr`); an open `thermal_throttled` ends at it, and a throttle still active after it opens a new row |
| `state` and the thermal events can differ by 1-2 samples | the state uses raw `thermal_throttling`; events use the `events.sh` debounce (2 samples in, 3 out) | a throttle edge in the shaded state strip may not line up exactly with its event |
| No crash events without the QMI lane | the SSR counter comes from the broker | `_QMI_OK` not `1` records nothing while the lane is absent; a crash during that time is seen only if the counter has risen when the lane returns |
| A planned reboot with no breadcrumb reads as unexpected | a reboot path that does not call `record_planned_reboot` | the worst case is a planned restart shown as unexpected; the message keeps the raw cause |
| Storage resolution is hourly | one `df` per hour | most buckets carry no storage reading |

## 7. Lifecycle lockstep

| Step | Handling |
|---|---|
| Files | the provider rides the flat lib copy (`history_series_*.sh`); `parse_at.sh`, `qmanager_scheduled_reboot`, `qmanager_update`, `install.sh` and `alert_engine.sh` ride their existing copies. No new CGI for the series |
| Store | `/usrdata/qmanager/history/system/` is created by the provider (`mkdir -p`); `--purge` already removes `/usrdata/qmanager/history` |
| Daemon / UCI / init.d | none |
| Deploy order | the provider is picked up by a poller restart; with the file absent the core simply ignores the series |
| Config backup | not included (history is data, `history.md` §8) |

**Rollback.** Delete `history_series_system.sh` and restart the poller (the CGIs then answer `invalid_series`, the page shows its error state); restore the previous `parse_at.sh`, `alert_engine.sh`, `qmanager_scheduled_reboot`. The `system/` store is inert data.

## 8. Testing and validation

`tools/history-test/system-test.sh <dir>`: `<dir>` holds `history.sh` and `history_series_system.sh` flat, plus optionally `parse_at.sh` for the `t1_temperature_max` case. `df` and `dmesg` are shell-function stubs, so it touches no live state. Cases: first sample (trusted, metrics, storage, first run records no reboot); steady state (no second `df` until the 361st sample, bad values dropped); SSR (count up = crash with the onset from `dmesg`, `up` = recovered, stale `dmesg` stamp ignored, count down re-baselines, crash open across a poller restart); reboot classification (planned `user`/`scheduled`/`update`/`watchdog`, unexpected with a valid, torn and foreign `alive` stamp, clock untrusted after boot defers classification); `parse_temperature` on a fake sysfs tree.

| Check | Result |
|---|---|
| `system-test.sh` | 51 of 51, on the RM551E and locally |
| Provider cost | about 0.29 ms per sample on the device |
| Whole-poller CPU | within measurement noise |

Frontend: `bunx tsc --noEmit`, eslint on touched files, `bun run icons:check`, `bun run i18n:check`, `derive.test.ts`.

### Live events (2026-11-09, RM551E)

| Event | Recorded | Page |
|---|---|---|
| 7 baseband SSRs after the series started (broker episodes 3 to 9) | 7 `modem_crash`/`modem_recovered` pairs, 12 to 17 s, onset equal to the dmesg `fatal error received` second, `end` set by the events CGI. The one at 12:44:33 had its recovery stamped two seconds before the reboot that followed | "Modem crashed and restarted itself, Back in 15 s"; Modem lane "Restarted 7×", destructive marks |
| Planned reboot 1 (`crash.log` `1794199488\|reboot\|user`) | `device_reboot` `t` 1794199512 (boot epoch), `cause=user off=24`, `info`; arrived late (≈ 13 min) because of the trust delay, fixed since (Known limits) | "Restarted from QManager, Offline for 24s"; a gap in the Device lane from `t - off` |
| Unplanned hard reset (PMIC `PS_HOLD`, no pstore record) | `device_reboot` `t` 1794200293, `cause=unexpected off=7` (from the `alive` stamp 1794200286), `error`. The alert engine back-filled `unplanned` in `crash.log`, which the classifier skips as designed | "Device restarted unexpectedly, Offline for 7s"; destructive mark |
| Planned reboot 2 (with the `last_wall` fix) | `device_reboot` `t` 1794200749, `cause=user off=22`, recorded at uptime 303 s | "Restarted from QManager, Offline for 22s" |

The offline spans are drawn from `t - off` to `t`; at 7 to 24 s they are below one pixel on a 24 h lane, so the lane draws them at its 3 to 4 px minimum width. Not observed live: `scheduled`, `update` and `tier4_escalation` causes, and thermal throttling (the hottest sensor stayed under 60 °C).

Related: [`history.md`](history.md) (core), [`thermal-throttling.md`](thermal-throttling.md) (the thermal events and `trip_c`), [`qmi-lane.md`](qmi-lane.md) (SSR counter), [`alerts.md`](alerts.md) (reboot classification buckets, `crash.log`), [`connection-watchdog.md`](connection-watchdog.md) (Tier 4 reboot), [`scheduled-jobs.md`](scheduled-jobs.md) (scheduled reboot).
