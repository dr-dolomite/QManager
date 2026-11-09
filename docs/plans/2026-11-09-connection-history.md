# Plan: History > Connection History (replaces the Latency Monitor)

Branch `claude/connection-history-dbd021` (cut from `claude/cellular-history-687ff1`). Canon: `docs/features/history.md` (approved 2026-11-09) and the approved prototype `.claude/prototypes/connection-history.html`. Large change: this plan needs your OK before any code.

## What the live modem says (read-only, 2026-11-09)

- `qmanager_ping` writes every 5 s (sensitivity `relaxed`). The poller reads it each 2 s cycle into globals: `conn_internet_available` (`true`/`false`/`null`), `conn_latency` (last RTT, `"62.0"`), `conn_jitter` (5-min window, `"6.2"`, `null` while immature), `conn_packet_loss` (integer %, 5-min window), `dns_lookup_ms` (integer, every 60 s, `null` after 180 s).
- `connectivity.thresholds` = `{latency_ms:250, loss_pct:30}` (UCI `quality_thresholds`).
- Events on the device today: `internet_lost`/`internet_restored` (4 pairs), no latency/loss/watchdog rows yet. All event types share `/tmp/qmanager_events.json` (50-row ring).
- **Gap 1:** `watchcat_recovery` and `sim_failover` are written by `qmanager_watchcat`, a separate daemon. `hist_event` only runs inside the poller, so these two types would never reach the history store as the core stands.
- **Gap 2:** the events table needs "Lasted" on onset rows (and "Ongoing"). Pairing on the client fails across pages, so it has to happen in the events CGI.

## Backend

1. **Provider `scripts/usr/lib/qmanager/history_series_connection.sh`** (the core loads `history_series_*.sh`, not `history.d/`; the doc will be corrected by the core owner).
   - `STATES="up down off"`, `FAULT="down"`, `METRICS="lat_ms jit_ms loss_pct dns_ms"`, `EVENTS="internet_lost internet_restored high_latency latency_recovered high_packet_loss packet_loss_recovered watchcat_recovery sim_failover"`, `EVENTS_KEEP="internet_lost internet_restored sim_failover"`.
   - Sample (builtins only, no forks): CFUN 0/4 → `off`; `conn_internet_available=true` → `up`, `false` → `down`; `null` (ping missing or stale) → no sample, so it reads as no data. Metrics only while `up`: latency is the last RTT rounded to whole ms (the bucket avg/min/max then come from real RTTs, not a 5-min average); jitter rounded ms; loss integer %; DNS as is. Range guards: latency 0..60000, jitter 0..60000, loss 0..100, DNS 0..60000.
   - "Slow or lossy" is not a stored state: the page derives it per bucket (avg latency > limit, or loss ≥ 5 %), so changing the limit recolours past bars.
2. **Sites CGI bucket alignment** (`monitoring/sites.sh`): **align on the server**, not client re-binning. 24h/7d/30d move from 1200/7200/28800 s buckets to 1800/10800/43200 s (24h stops returning raw rows). The 20-min/2-h/8-h buckets don't divide into the page's buckets, so re-binning would smear samples across bars and break the shared cursor; the daemon's raw 90-day store makes the server change a one-line constant each. Only the retired Latency Monitor used these ranges.
3. **Core requests to the cellular-history session** (it owns the core; I send these and merge its branch when they land):
   - **External events spool:** when `append_event` runs outside the poller (`hist_event` undefined), append `mono|type|severity|message` to a RAM spool under `/var/run/qmanager/history/`. `hist_tick` ingests it fork-free (`[ -s ]` + `while read`) through the normal `hist_event` path. That brings watchdog and SIM failover rows in without a second writer on flash.
   - **Event pairing in `history/events.sh`:** an optional `HIST_<id>_PAIRS="internet_lost:internet_restored high_latency:latency_recovered high_packet_loss:packet_loss_recovered"`. Onset rows gain `"end": <t>` or `"end": null` when no later recovery exists (ongoing). Cellular can use it for `signal_lost:signal_restored`.
   - The sub-row "Connection History" (`/history/connection`) in the History nav group, so we don't both edit the nav.

## Frontend (`app/history/connection/`, `components/history/connection/**`)

Built on the core's shared pieces (`range-control`, `axis`, `format`, `history-cursor`, `use-history`) with Material Symbols, as `/history` uses.
- `connection-history.tsx` page: header with the range `SegmentedField`; states: loading (skeletons from `shapes.ts`), error with Try again, new install ("Collecting since HH:MM"), down now.
- `summary-tiles.tsx`: Online for / Offline for, Last outage, Availability % (+ outage count), Median latency ("Slow in N of M periods" / "Within your limit").
- `reachability-card.tsx`: one bar per bucket (success / warning / destructive / surface-container-high), legend of the states present, axis "<range> ago … Now", bar tooltip.
- `connection-charts.tsx`: 2×2 Latency, Packet loss (bars), Jitter, DNS lookup; single `--primary-on-surface` line, dashed `--chart-threshold` limit line for latency and loss, y top `nice(max(p95×1.25, floor, limit×1.2))`, outage bands, header readout at the cursor.
- `sites-card.tsx` (moved from the Latency Monitor and reworked): follows the page range (range average), Live toggle (the `range=now` 2 s lease, visible tab only), Manage dialog, selected-site detail panel (Average, Fastest, Slowest, Answered %, latency over the range with the limit line). Off / empty / loading / error states kept.
- `events-card.tsx`: the Cellular History table grammar plus Lasted, 5/10/25/50 rows per page, type filter (Outages, High latency, Packet loss, Watchdog, SIM failover); watchdog rows `info`, ongoing outage "Ongoing" in destructive ink.
- Limits come from `useModemStatus().data.connectivity.thresholds` (fallback 250 ms / 30 %).
- Copy in a new `history` namespace block (`connection.*`) in all five catalogs; the Sites strings move with it.

## Retire the Latency Monitor

- `app/monitoring/latency/page.tsx` becomes a client redirect to `/history/connection` (`router.replace`, as the scenarios route does).
- Delete `latency-monitoring.tsx`, `now-card.tsx`, `history-card.tsx`, `use-latency-monitoring.ts`; move what Sites still uses (`manage-sites-dialog`, `site-mark`, `condition-block`, the Sites parts of `derive.ts` / `shapes.ts`) into `components/history/connection/sites/`. `use-latency-history.ts` stays (the dashboard uses it).
- Remove the `latency_monitor` row from `components/app-sidebar.tsx` and `latencyMonitor.*` copy once nothing reads it.
- Docs: retire `docs/reference/latency-monitor.md` into a pointer, update `docs/features/sites-monitor.md`, `docs/FRONTEND.md`, `docs/features/README.md`, `CLAUDE.md` routing, `RELEASE_NOTE.md`; a Connection History section in `docs/features/history.md` (coordinated with the cellular session).

## Build order and delegation

1. Backend, by me: provider + Sites CGI change; static audit; deploy to the modem with `sync`; verify the samples land in `/var/run/qmanager/history/connection.open` and the CGIs answer for `series=connection`. Needs the core deployed on the modem: if the cellular session hasn't deployed it yet, I deploy its committed core along with my provider.
2. Frontend, two Sonnet 5.5 (high) builders on separate file sets: (A) page shell, tiles, Reachability, charts; (B) Sites card move + rework, events card, Latency retirement. I review each report against the prototype and canon.
3. Validate: `bunx tsc --noEmit`, lint on touched files, `bun run icons:check`, i18n parity; page against live data through the dev proxy.
4. Docs, then report branch + `git status` and ask: merge, keep for PR, or discard.

## Risks and rollback

- Poller hot path: the provider is builtins only; the core's CPU gate covers it.
- The two core requests block the Watchdog / SIM failover rows and Lasted; until they land, those columns show what the data allows (no Lasted, no watchdog rows) rather than mock data.
- Rollback: delete the provider file (the core skips a missing series), revert the Sites constants, restore the route.
