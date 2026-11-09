# Latency Monitor Page (retired)

> **Retired 2026-11-09.** The Latency Monitor (`/monitoring/latency`) was replaced by **History > Connection History** (`/history/connection`). Nothing on this page is current. It is kept as a pointer so old links and ledger rows still resolve.

## What replaced it

| Old card | Now |
|---|---|
| Right now | The summary tiles and the Reachability strip on Connection History |
| History | The Latency, Packet loss, Jitter and DNS lookup charts, with 24 h / 7 d / 30 d ranges kept for 31 days (the old page read the in-RAM ping archive, 1 h / 6 h / 24 h) |
| Sites | The Sites card on Connection History: it follows the page range, has a Live toggle in place of the old Now pill, and opens a per-site detail panel |

## Route and redirect

`app/monitoring/latency/page.tsx` is now a client-side redirect to `/history/connection` (`router.replace`). It has to be client-side because QManager is a static export with no server to send a redirect. The `latency_monitor` sidebar row is gone; Connection History is a sub-row of the History group.

## Removed

`latency-monitoring.tsx`, `now-card.tsx`, `history-card.tsx` and `use-latency-monitoring.ts`. The `latencyMonitor.*` copy in the `dashboard` namespace moved to `history` > `connection.*`. `hooks/use-latency-history.ts` stays: the dashboard Connection Quality card still reads the ping archive through it.

## Where things live now

- Page, series, state rules, the derived "slow or lossy" colour, events and Lasted, and the Sites card (value and tone rules, Live toggle, `useSites(range, live)`, brand marks, the `configOf` warning): [history.md#connection-history](../features/history.md#connection-history)
- The `qmanager_sites` daemon and the `monitoring/sites.sh` contract: [sites-monitor.md](../features/sites-monitor.md)
- The ping pipeline, `connectivity.thresholds` and the limits the page grades against: [connection-quality.md](../features/connection-quality.md)
- Toast rules: [toast-confirmation.md](toast-confirmation.md)
