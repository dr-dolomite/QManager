# History ranges: 5 Minutes, 1 Hour, Day, 15 Days, Month

Scope: Cellular, Connection and System Health History pages (and the Sites card, which follows the Connection page range).

## Ranges

| Tab | id | Buckets | Source |
|---|---|---|---|
| **5 Minutes** (default) | `5m` | 30 × 10 s | new RAM sample ring |
| **1 Hour** | `1h` | 60 × 1 min | new RAM sample ring |
| **Day** | `24h` | 48 × 30 min | flash (unchanged) |
| **15 Days** | `15d` | 60 × 6 h | flash, read-time merge of 12 base rows |
| **Month** | `30d` | 60 × 12 h | flash (unchanged) |

**7 Days drops out of the tabs** (not in your list). The CGIs keep accepting `7d` so nothing old breaks.

## Why a new store

Today the smallest stored unit is a 30-minute bucket, so a 5-minute or 1-hour view has nothing to draw. The poller already samples every 10 s; it just folds each sample into the 30-minute accumulator and throws it away.

**New tier:** each trusted 10 s sample is also appended as one row to `/var/run/qmanager/history/<series>.fine` (tmpfs, RAM only, never flash):
`{"k":"f","t":<wall>,"dt":<sec>,"s":"<state>","x":0|1,"m":{"metric":v,...}}`
- Hot path: string build with builtins + one `printf >>` (no fork). Trim with `tail -n 360` once the file passes ~420 lines: one fork per series about every 10 minutes. Ring ≈ 1 h + margin, ~70 KB per series.
- Not written before the clock is trusted; lost on reboot. Both read as "no data", same as the open 30-min bucket today. No flash wear change.

## Reader

- `history_read.sh` `hr_range`: add `5m` (B=10, N=30), `1h` (B=60, N=60), `15d` (B=21600, N=60); flag `HR_FINE=1` for 5m/1h.
- `history/series.sh`: for fine ranges a second awk reads `.fine` rows and **spreads each sample over the interval it covers** `(t-dt, t]` across buckets (state seconds split by overlap, metric counted in each overlapped bucket). This avoids the zig-zag "no data" bars that a 10 s sample jittering against 10 s bucket edges would cause. Output shape unchanged (`{t,len,st,x,m}`), so pages need no new parsing.
- `history/events.sh`: just accepts the new ranges (window filter already range-driven).
- `monitoring/sites.sh`: add `5m` (10 s buckets) and `15d` (6 h buckets); `1h` gets 60 s buckets instead of raw rows. Sites sweep every 5 min by default, so the 5-minute view shows at most one sweep: honest, not padded.

## Frontend

- `types/history.ts`: `HistoryRange = "5m" | "1h" | "24h" | "15d" | "30d"`, specs + order; `types/sites.ts` likewise.
- `axis.ts`: ticks for 5m (every minute), 1h (every 15 min), 15d (every 3 days, date).
- Three pages default to `"5m"`. `use-history.ts` polls every 10 s on 5m/1h (30 s otherwise).
- Range-specific code paths (System derive, storage card's hourly sample, cellular/connection derive "since" head, Sites derive) checked for 24h/7d/30d assumptions.
- i18n: `range.*` and `shared.range_ago.*` labels in all five catalogs (en, zh-CN, zh-TW, it, id): "5 minutes / 1 hour / Day / 15 days / Month". Range control stays one row (`breakpoint="never"`) — five pills; verify it fits at narrow widths, else allow the Select fallback.
- `derive.test.ts` fixtures updated for the new specs.

## Build order (orchestrated)

Worktree off `development-home` (the shared checkout has another session's uncommitted route moves).
1. Me: backend (`history.sh` fine ring, `history_read.sh`, `series.sh`, `events.sh`, `sites.sh`) + `tools/history-test` cases.
2. In parallel, a Sonnet builder: types, axis, hooks, pages, i18n, tests.
3. Validate: CRLF + POSIX audit, `history-test.sh` on device, deploy to the modem (+ `sync`), CGI shape for all five ranges, poller CPU check; `bunx tsc --noEmit`, lint, vitest; look at the pages in the browser.
4. Docs: `history.md` (tiers table, ranges, fine ring), `sites-monitor.md`, `RELEASE_NOTE.md`.

## Risks / rollback

- Poller hot path: string build per series per tick; measured against the current CPU baseline before shipping.
- tmpfs: ~200 KB total for three series.
- Rollback: revert the commits; `.fine` files are tmpfs and vanish on reboot.
