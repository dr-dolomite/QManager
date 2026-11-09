# Plan: History > System Health (`/history/system-health`)

Branch `claude/system-health-f7023d` (fast-forwarded onto `claude/cellular-history-687ff1` @ 4cb536af). Design: the approved prototype (`.claude/prototypes/system-health.html`). Canon: `docs/features/history.md`.

## 1. What the data sources turned out to be (recon, live modem read-only)

| Need | Source | Note |
|---|---|---|
| Processor % | poller `cpu_usage` (every cycle, builtins) | reuse |
| Memory | poller `memory_used_mb` / `memory_total_mb` (MemTotal − MemAvailable) | reuse |
| Temperature | poller `t1_temperature` is the **mean** of the modem zones, not the hottest | **add** `t1_temperature_max` in the same `parse_temperature` loop (no extra reads, no fork); the trip guide only makes sense against the hottest zone |
| Throttling now / parts / `trip_c` | poller `thermal_*` globals; `thermal_throttled` / `thermal_recovered` events already exist | reuse; parts parsed from the event message ("(LTE, 5G)") |
| Storage | nothing in the poller | **new**, one `df -k /real_rootfs /usrdata /tmp` fork per hour (and the first tick); `/firmware` excluded |
| Modem crash (SSR) | the QMI lane's `qmi_ssr_count` (daemon's exact episode counter) and `qmi_state` (`down` during the SSR window), both already loaded by the poller. The watchdog only greps `dmesg` at escalation time and records no recovery, so it is not a usable source | onset = count goes up; recovery = `qmi_state` back to `up`; onset time refined with one `dmesg` grep **only when an SSR happens** |
| Device reboots | `crash.log` (`epoch|reboot|reason`, written by `record_planned_reboot`); `boot_id`. Nothing records the offline time or "update"/"scheduled" today (both write `user`) | **new**: a per-boot reboot event with cause + offline seconds (see §2) |
| Up for / Memory now / throttling chip | `status.json` via the existing `useModemStatus` | no backend work |

## 2. Backend (bottom-up)

**`scripts/usr/lib/qmanager/history_series_system.sh`** (new provider, no core edits; the flat lib copy installs it):

- `HIST_system_STATES="normal throttled"`, `FAULT=""`, `PAIRS="modem_crash:modem_recovered thermal_throttled:thermal_recovered"`.
- `METRICS="cpu mem_pct mem_mb temp_c st_sys_used st_sys_size st_app_used st_app_size st_tmp_used st_tmp_size"` (storage in KB, sampled hourly, so `n` is 0 in most buckets: that is "no reading", by design).
- `EVENTS="device_reboot modem_crash modem_recovered thermal_throttled thermal_recovered"`.
- `hist_system_sample`: builtins only per tick. Extra work only on rare edges: the hourly `df`, one `dmesg` grep per SSR, and once per boot (first trusted tick) the reboot classification:
  - read `crash.log` (≤ 20 rows, `while read`) and a provider stamp `alive` (`epoch boot_id`, rewritten every 5 min with a builtin `printf`, tolerant reader: a torn file = unknown);
  - **planned** if a `crash.log` row lies between the last alive stamp and boot: cause = its reason (`user`, `scheduled`, `update`, `tier4_escalation` → `watchdog`), offline from that row's time to boot;
  - otherwise **unexpected**, offline from the last alive stamp (≤ 5 min uncertainty) to boot;
  - one event `device_reboot`, message `cause=<c> off=<s>`, stamped at boot; a per-boot marker (`boot`) stops a poller restart from recording it twice; the first boot after install records nothing.
- SSR: `modem_crash` at onset, `modem_recovered` when the lane is `up` again (≤ 10 s grain); a lower count (broker restart) re-baselines silently.

**Small edits outside the provider:**
- `parse_at.sh` `parse_temperature`: also set `t1_temperature_max` (same loop, same sentinel skips). `status.json` untouched, so poller parity is unaffected.
- `qmanager_scheduled_reboot` → `record_planned_reboot "scheduled"`; `install.sh` (update/OTA reboot) → `"update"`. `alert_engine.sh` `_ae_classify_reboot` maps `scheduled|update` to `user`, so alerts and Recent Reboots behave exactly as today.
- `types/modem-status.ts`: add `device_reboot`, `modem_crash`, `modem_recovered` to `NetworkEventType` (all its maps are `Partial`, so nothing else changes). These events go only to history, not to the Network Events log.
- **Lifecycle:** files ride the existing lib/bin copies; `alive`/`boot` live in `/usrdata/qmanager/history/system/`, which uninstall `--purge` already removes. No init.d, UCI or daemon change.
- **One design addition:** a watchdog reboot (tier 4) gets its own events row, "Restarted by the connection watchdog" (neutral, `restart_alt`). The prototype had no row for it.

## 3. Frontend (`components/history/system/**`, page `app/history/system-health/page.tsx`)

- Data: `useHistorySeries<SystemState, SystemMetric>("system", range)` + `useHistoryEvents("system", range, {page: 0, pageSize: 100})` (lanes, markers and the events list all come from one event fetch) + `useModemStatus` for the live values (uptime, memory now, throttling now, `trip_c`).
- Pieces: `system-health.tsx` (page, cursor provider, cascade), `derive.ts` (+ test: lanes, reboot gaps, crash/throttle spans, counts, storage start values, peaks), `summary-tiles.tsx` (`TILE_SHAPE`), `stability-card.tsx`, `metric-chart.tsx` (recharts area/line; 0.32 → 0 gradient; crash notches; gap bands; heat bands; trip guide), `storage-card.tsx`, `system-events-card.tsx` (day groups, Show more/fewer), `shapes.ts`, `states.tsx`.
- Reuse `RangeControl`, `axisTicks`, `format.ts`, `HistoryCursorProvider`, `ConditionScreen`. **Export** the dashboard's private `Chip` and `buildThrottleLabel` from `status-rail.tsx`, so the chip is the same one, not a copy.
- Icons: Material Symbols (`/history/**` is already a Material route in `icon-system.md`); run `bun run icons:check`.
- i18n: `history.json` `system.*` in all five catalogs.
- Nav: I ask Cellular History (the owner) for the `history_system` sub-row "System Health" under Cellular History and Connection History.

## 4. Build order and team

1. Backend provider + small edits: **Opus (medium) backend-writer**, because it is the poller hot path.
2. In parallel, against a typed fixture: **ui-builder A** (Sonnet 5.5, high) does the page, derive, tiles, storage, events, states and i18n; **ui-builder B** (Sonnet 5.5, high) does the stability card and the three charts (strings in a partial file that I merge). Both load Impeccable and build from shadcn primitives.
3. I review every report against the code, then swap the fixture for the live hooks.

## 5. Validation

- Static: `.claude/check-crlf.sh`, `sh -n`, BusyBox/POSIX audit (one var per `local`, no jq regex, guarded dot-sources, numeric guards), and a provider unit test added to `tools/history-test/` (SSR edge, reboot classification, the hourly storage sample, a torn `alive` file).
- Frontend: `bunx tsc --noEmit`, eslint on touched files, `bun run icons:check`, `bun run i18n:check`, derive tests.
- **On device (needs your OK; covered by this plan):**
  1. Re-check the device md5s of `history.sh`, `history_read.sh` and `qmanager_poller` against the cellular head.
  2. Back up the originals.
  3. Deploy only `history_series_system.sh`, `parse_at.sh`, `alert_engine.sh` and `qmanager_scheduled_reboot`, with `sync`.
  4. Ask Cellular History before the **one poller restart**.
  5. Check the series and events CGIs for each range, poller CPU against the 4.17 % baseline (`measure.sh`), the first storage sample, and the page in the browser against the device.
- **Not covered, asked separately if you want them:** a reboot test (to see a `device_reboot` row live) and a forced SSR. Any real SSR during the session will be checked; this modem has about one every few hours.

## 6. Risks and rollback

- **Hot path:** forks only on rare edges; measure CPU before and after.
- **Misclassified reboot:** worst case a planned restart reads as unexpected. The message keeps the raw cause.
- **Rollback:** delete `history_series_system.sh` and restart the poller (the core ignores a missing series), and restore the three backed-up files. The `system/` store is inert data.

## 7. Docs

A System Health section in `docs/features/history.md` (provider, events, message formats, the reboot classification), `docs/features/README.md` + `CLAUDE.md` routing, and a `RELEASE_NOTE.md` entry.

## 8. Addendum (2026-11-09, user request mid-build): Logs card with two tabs

The user asked to show the modem's logs on this page: "make a tab for it, one for QManager and one for actual System logs". **Needs the user's OK before building** (new CGI = backend change).

Live evidence (read-only): `logd -S 64` runs, so `logread` holds a 64 KB RAM ring (~550 lines, e.g. `Mon Nov  9 11:25:58 2026 user.notice qms[11579]: ...`); the kernel ring (`dmesg`, ~1600 lines) is separate (no klogd feeding logd); `/var/log` is empty. QManager's own log is `/tmp/qmanager.log` (+ `.1`, `.2`), already served by `GET system/logs.sh` and `hooks/use-system-logs.ts` (doc `docs/reference/logs.md`).

Proposal:
- A **Logs** card at the bottom of `/history/system-health` (after System events), description e.g. "What the modem and QManager wrote to their logs, newest first."; `Tabs` with two triggers: **QManager** and **System**. Logs are a sanctioned "surface that exists to show them", so raw lines may contain paths/daemon names.
- **QManager tab**: reuse `useSystemLogs` (no backend change) and its `derive.ts` helpers; a compact newest-first row list (time, level Badge, component Tag, message) with level filter and a link to the full System Logs page. Material glyphs only (this is a `/history` route; the System Logs page's lucide components are not mounted here).
- **System tab**: new read-only CGI `scripts/www/cgi-bin/quecmanager/system/syslog.sh` (`GET ?lines=100..500&source=system|kernel`): `logread -l N` (or `logread | tail -n N`) parsed by one `awk` into NDJSON `{t, facility, level, proc, pid, msg}`, wrapped `{success, source, entries, total}`; `source=kernel` reads `dmesg | tail -n N` (`{uptime_s, msg}`); clamp N; no writes, no clear action. Hook `hooks/use-device-syslog.ts` (10 s visible poll like `use-system-logs`), types `types/device-syslog.ts`. In the tab, a small segmented switch "System / Kernel" (open question for the user: keep Kernel, or System only).
- Lifecycle: the CGI rides `install_tree`; nothing to seed or clean. i18n in all five catalogs. Static audit + on-device CGI check.
