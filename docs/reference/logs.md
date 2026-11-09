# Logs (`/monitoring/history/logs`)

> **Applies to:** RM520N-class modems (RM520N / RM551E / RM500Q) running QManager
> Family: `components/history/logs/**` · namespace `public/locales/*/history.json`, `logs.*` subtree (header actions, toasts and the clear dialog reuse `system-settings.json` `logs.page.*` / `logs.toast.*` / `logs.clear_dialog.*`)

The Logs page is the one place to read what QManager and the modem wrote to their logs. It is
the last page under **History** in the sidebar (Cellular, Connection, System Health, Network
Events, Logs). One card holds two tabs: **QManager** is the app's own diagnostic transcript, the
file every QManager shell script writes through `qlog.sh`; **System** is the modem's system log
(`logread`) or its kernel ring (`dmesg`). The QManager tab matters because the device has **no
journal to fall back on**: `journald` is masked to `/dev/null` on both modems, so
`/tmp/qmanager.log` is the only durable record of what a CGI script, a daemon or the poller did.

History (2026-11): the page used to be a System Settings surface (`components/system-settings/logs/**`:
status band, transcript card, 52px rows, search / component / archived filters), and System
Health carried a separate two-tab Logs card. The two were unified onto the System Health card's
design and moved here; System Health no longer shows logs. The old family is gone (its last
helpers, `filterByLevel`, `parseLogTimestamp`, `isNearRotation` and `visibleLogText`, now live in
`components/history/logs/derive.ts`), its unused `system-settings.json` `logs.*` strings were
pruned, and the old `/system-settings/logs` route redirects here. The backend was not touched.

---

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `app/monitoring/history/logs/page.tsx` (renders `LogsPage`) |
| Page | `components/history/logs/logs-page.tsx` (header actions, tabs, filters, states, clear dialog) |
| Summary tiles | `components/history/logs/logs-summary.tsx` (QManager tab only; copy in `system-settings.json` `logs.band.*` and `history.json` `logs.summary.*`) |
| Footer | `components/history/logs/logs-pagination.tsx` (range, rows per page, page count, first/prev/next/last) |
| Rows | `components/history/logs/logs-list.tsx` (`LogList`, `LogRowsSkeleton`) |
| Derivations | `components/history/logs/derive.ts` (`qmanagerLines`, `deviceLines`, `groupByDay`, `paginate`, `logLinesText`, `filterByLevel`, `parseLogTimestamp`, `isNearRotation`, `visibleLogText`; tests in `derive.test.ts`) |
| Geometry | `components/history/logs/shapes.ts` (`LOGS`, `PAGE_SIZES`) |
| Hooks | `hooks/use-system-logs.ts` (QManager), `hooks/use-device-syslog.ts` (System / Kernel) |
| Types | `types/system-logs.ts`, `types/device-syslog.ts` |
| CGI endpoint | `GET`/`POST` `/cgi-bin/quecmanager/system/logs.sh` |
| Producer library | `scripts/usr/lib/qmanager/qlog.sh` (sourced by every QManager shell script) |
| Log file | `/tmp/qmanager.log` — **RAM disk**, seeded `root:root 0666` by `qmanager_setup` |
| Rotated files | `/tmp/qmanager.log.1`, `/tmp/qmanager.log.2` (`MAX_ROTATED=2`) |
| Rotation trigger | `QLOG_MAX_SIZE_KB`, default **256 KB** |
| Default write threshold | `QLOG_LEVEL`, default **INFO** — so `DEBUG` lines are usually never written |
| Poll cadence | `POLL_INTERVAL_MS = 10_000` (`hooks/use-system-logs.ts`) |
| Line budgets | `LINE_BUDGETS = ["50", "100", "200", "500"]` |
| Page sizes | `PAGE_SIZES = [10, 20, 50, 100]`, default **10** (`shapes.ts`) |
| Icon family | **Material Symbols** (a History page; `Banner` and `sonner` stay lucide) |

---

## Data path

```
qlog_info "..."          -> [TS] LEVEL [component:PID] Message   (qlog.sh, appends)
_qlog_rotate()           -> mv to .1/.2 at >= QLOG_MAX_SIZE_KB   (chmod 666 re-asserted)
logs.sh  parse_logs()    -> single awk pass -> NDJSON            (oldest first)
logs.sh                  -> jq -s wrap -> {entries, total, stats, available_components}
useSystemLogs()          -> unfiltered-by-level window, 10s poll
filterByLevel()          -> exact-level filter, CLIENT side
[...].reverse()          -> newest first
qmanagerLines()          -> newest first, stable key per row
paginate()               -> one page (10 rows by default)
groupByDay()             -> Today / Yesterday / a dated heading, per page
```

The line format `qlog.sh` writes, and the only format `logs.sh` can parse, is:

```
[2026-09-06 01:02:03] INFO  [poller:1234] Cycle complete
```

`available_components` is taken only from the `[component:PID]` block in field position, using an anchored `sed`. The old unanchored `[...:` match also picked up the timestamp and bracketed message text (ledger B5.8). `total` is the entry count from `jq length`. `wc -l` on the unterminated NDJSON was one short.

A line that does not start with `[` is skipped outright, and a line whose level word is not
one of the four is dropped by the awk pass. That is why `LogLevel` is a **closed union** in
`types/system-logs.ts`: widening it on the client would be a lie until the backend widens too.

> ℹ️ NOTE: `qlog.sh` also copies lines to syslog via `logger` when `QLOG_TO_SYSLOG=1`
> (the default), but only at or above `QLOG_SYSLOG_LEVEL` (default `WARN`; set `INFO` or
> `DEBUG` in a script's environment to widen it). INFO and DEBUG lines live only in the file:
> no `logger` fork for routine lines, and they cannot push kernel lines out of the
> `logread | tail -300` that the debug report and health check capture (on the RM551E the
> 64 KB syslog ring holds well under a minute, flooded by the firmware's `qms` debug output).
> Daemons pick up the new default on their next restart. This page never reads syslog, only the file.

---

## The backend contract (frozen)

`scripts/www/cgi-bin/quecmanager/system/logs.sh` was **not edited** by the re-authoring. Treat
the shapes below as fixed; the client bends around them.

### GET parameters

| Param | Default | Meaning | Sent by the UI? |
| ----- | ------- | ------- | --------------- |
| `lines` | `100` | Max entries returned. Non-numeric input is coerced back to `100`. | Yes — the line-budget `Select` |
| `level` | *(none)* | **Minimum severity**, not an exact match. See below. | **No — deliberately dropped** |
| `component` | *(none)* | Exact match on the component name. | Yes, when not `all` |
| `search` | *(none)* | Case-insensitive substring over the **entire raw line**. | Yes, after a 400 ms debounce |
| `include_rotated` | `0` | `1` also reads `.2` then `.1`, oldest first. | Yes — the "Include archived" switch |

`lines` is a **tail**: the awk pass accumulates every matching entry and then emits only the
last `max_lines` of them, so what you get is the newest slice of whatever survived the other
filters.

### GET response

```json
{
  "success": true,
  "entries": [
    {
      "timestamp": "2026-09-06 01:02:03",
      "level": "INFO",
      "component": "poller",
      "pid": "1234",
      "message": "Cycle complete"
    }
  ],
  "total": 0,
  "stats": { "current_size_kb": 42, "current_lines": 1180, "rotated_files": 1 },
  "available_components": ["poller", "qcmd", "cgi_logs"]
}
```

Every key is always present. `pid` may be the empty string (a log line with no `:PID` in its
component block) but is **never absent** — the awk `printf` always emits the field. `entries`
is ordered **oldest first**; the UI reverses it.

### POST actions

| Body | Effect |
| ---- | ------ |
| `{"action":"clear"}` | Truncates `/tmp/qmanager.log` in place and `rm -f`s both rotated files. Returns `cgi_success`. |
| `{"action":"status"}` | Returns `stats` only. **Unused by this UI.** |

The clear path truncates through the existing inode (`: > "$LOG_FILE"`) rather than recreating
it, which is what preserves the `0666` seed — see `tmp-file-ownership.md`
for why that mode is load-bearing for a file both root daemons and `www-data` CGI append to.

### Rotation and volatility

`/tmp` is a RAM disk. **The log is empty after every reboot** — there is no persistence, by
design, because the flash is UBIFS and a chatty log would wear it. `_qlog_rotate()` moves the
current file to `.1` (shifting `.1` to `.2`) once `wc -c` divided by 1024 reaches
`QLOG_MAX_SIZE_KB`, then re-asserts mode `666` on the fresh file. Nothing is compressed.

That volatility is the single most useful fact a first-time reader is missing, so the page
description and the empty state both say it in plain English rather than leaving it to this doc.

---

## Things a reader will otherwise get wrong

### 1. `total` is dead. Never read it.

`logs.sh` computes it as `wc -l` over **the very NDJSON string it then serializes into
`entries`**, after the `lines` truncation has already happened. The two can never disagree, so
the old UI's "Showing 60 of 60" was tautological in every possible state — it looked like a
window into a larger log and was not.

It is worse than merely redundant. Command substitution strips the trailing newline, so a
non-empty window has `N` lines but only `N - 1` newline characters:

```sh
entries=$(parse_logs ...)               # trailing newline stripped here
entry_count=$(printf '%s' "$entries" | wc -l)   # counts newlines -> N - 1
```

**`total === entries.length - 1` for any non-empty window** (and `0` when empty). It is kept in
the payload and typed in `LogsResponse`, with a doc comment saying so, purely so nobody
re-derives it and thinks they found something. The page's footer counts the rows it actually
holds after the level filter (`rows.length`), never `total`.

### 2. The backend's `level` is a severity FLOOR, so the client filters instead

In the awk pass, `level` sets `min_level` and every entry with `lvl[level] < min_level` is
dropped. Picking `WARN` therefore also returned every `ERROR`. That is a reasonable thing for a
log reader to offer and the wrong thing for a rail of mutually-exclusive chips to be built on.

The hook **does not send `level` at all**. It fetches one window filtered only by
`component` / `search` / `lines` / `include_rotated`, and `filterByLevel()` applies an exact
match in the view, so picking **Warning** shows warnings only.

> ⚠️ WARNING: `lines` bounds the fetched window **before** client-side level filtering. On a
> device with `QLOG_LEVEL=DEBUG` set, a 100-line budget can be almost entirely `DEBUG` noise,
> and selecting **Error** will then show fewer errors than the log actually holds. This is a
> deliberate trade — an exact level filter, in exchange for a window the user must widen
> themselves. **Widening the line budget is the user's lever**, and it is why the budget
> `Select` sits on the same row as the level filter rather than being hidden.

### 3. The row key is an identity, not a position

`qmanagerLines()` and `deviceLines()` in `components/history/logs/derive.ts` key each row on
its content (`timestamp|component|pid|message`, or the syslog / kernel equivalent) plus an
ordinal for exact duplicates, never on its index. An index key changes for every row whenever a
poll adds a line at the top, which remounts the whole list.

---

## The page

- **Tabs and filters.** QManager: a level `SegmentedField` (All / Error / Warning / Info /
  Debug, exact match, client side) and a line budget (`LINE_BUDGETS` 50/100/200/500, default
  100, server side). System: a System / Kernel `SegmentedField` and a line budget
  (`DEVICE_LOG_LINES` 100/200/500, default 100). Only the tab in view polls; the other hook is
  paused.
- **Summary tiles (QManager tab only).** Three System Health-style tiles above the card, in
  `LOGS_SUMMARY.GRID` (stacked, three across from `@3xl/main`). **Severity**: errors, else
  warnings, else Clean, counted over the fetched window (not the level filter). **Latest problem**:
  the newest ERROR or WARN line in the window, as its clock time (plus the date when it is from an
  earlier day than the newest line), with `component: message` as the caption (full text on hover);
  "None" when the window has neither. It shows clock time, not an age, because the stamp is the
  modem's local time and the browser's clock may differ. **Log file**: `stats.current_size_kb`,
  lines and archived files; the disc turns warning at `ROTATION_WARN_KB` (80 % of the 256 KB
  rotation default, a client-side mirror of `QLOG_MAX_SIZE_KB` with no wire representation).
  Every state of a tile has its own glyph; the disc is the only colour.
- **Rows.** Time (24-hour, `tabular-nums`), a filled level `Badge` with one glyph per level,
  the component or process as a `Tag`, and the raw line in mono. Kernel rows are time and
  message only. Syslog priorities fold onto the same four levels (`toneOfSyslog`); a line with no
  parsed priority shows no chip rather than an invented one. Day headings are computed per page.
- **Paging.** `paginate(rows, pageIndex, pageSize)` clamps a stale index onto the last page (a
  clear or a shorter window) and reads an empty list as page 1 of 1. A tab, level, source,
  line-budget or page-size change returns to page 1; a 10 s poll does not, so new lines push
  older ones down the pages. On a narrow card the rows-per-page picker and the first/last jumps
  fold away. The previous and last arrows are `chevron_right` and `first_page` mirrored
  (`-scale-x-100`), so the icon subset did not grow.
- **Header actions** act on the tab in view. Refresh: a user read (`toast.error` on failure
  only, QManager tab). Copy: every filtered line of the tab, not just the page (QManager via
  `visibleLogText`, System via `logLinesText`), `copyText` + one toast. Clear log: QManager tab
  only, behind an `AlertDialog` that also pauses the QManager poll; `toast.success` /
  `toast.error` at the terminal moment.
- **States.** Loading (skeleton mirroring the row shape, `sr-only` status), error with nothing
  to show (`Notice` + Try again), empty, empty at a level (with "Show all levels"), loaded. A
  failed background poll with rows on screen keeps the rows and shows the "Not refreshing"
  warning chip in the footer.
- `availableComponents`, search and `includeRotated` are still on `useSystemLogs()` but the
  page does not surface them.

---

## Gotchas in the frozen backend

These are read from `logs.sh` and `qlog.sh`, not observed on a device. None of them were
introduced or fixed by the re-authoring; they are the shape the client has to live with.

### `available_components` is polluted with timestamp fragments

`get_components()` extracts names with:

```sh
grep -h -o '\[[^:]*:' $sources | sed 's/\[//;s/:$//' | sort -u
```

On a line like `[2026-09-06 01:02:03] INFO  [poller:1234] ...` the **first** bracket that
matches is the timestamp's, because `2026-09-06 01` contains no colon. `grep -o` emits it,
resumes after it, and then correctly finds `[poller:`. So the list comes back as real component
names **plus one `YYYY-MM-DD HH` fragment per distinct hour present in the sources**.

The component `Select` renders `available_components` verbatim, so those fragments appear as
selectable options. Picking one filters on an exact component match that nothing will ever
satisfy, producing an empty-filtered state. Toggling "Include archived" widens the sources and
therefore lengthens the pollution.

Fixing it means anchoring the pattern past the timestamp block in `logs.sh` — a backend change,
out of scope for the frontend pass, and recorded here so the next person does not assume the
client is mangling the list.

### `stats` describes the current log only

`get_stats()` reads `/tmp/qmanager.log` and counts how many rotated files exist. It never counts
lines inside them. With "Include archived" on, the transcript can legitimately show **more**
lines than `stats.current_lines`, so the card description can read "Showing 400 lines. The live
log holds 180." That is honest — the two numbers measure different things — but it surprises
people, and `current_lines` must not be repurposed as a total.

### `DEBUG` is usually absent entirely

`QLOG_LEVEL` defaults to `INFO`, and `_qlog_write` returns early below that threshold. On a
stock device **no `DEBUG` line is ever written**, so the Debug rail chip reads `0` and is not
broken. It only populates on a device that exports `QLOG_LEVEL=DEBUG` for a component.

### `search` matches the whole raw line

The awk pass lowercases and searches `$0`, not the parsed message. Searching `error` also
matches the level word, and searching `2026-09-06` matches every line from that day. Useful, and
not what the placeholder copy implies.

### Minor residue

- `parse_logs`'s awk carries a three-argument `match(rest, /.../, _)` whose result is never
  read; the level actually comes from the `split()` on the next line. Vestigial.
- The `{"action":"status"}` POST branch has no client. It predates `stats` being folded into
  the GET response.

---

## Device logs (`system/syslog.sh`)

A second, separate read: the modem's own logs, not QManager's transcript. Read-only, no locks,
no clear action. Contract in `types/device-syslog.ts`; hook `hooks/use-device-syslog.ts`
(`useDeviceSyslog(source, lines, { paused })` returns `{ data, isLoading, error, refresh }`,
10 s visible-only poll, previous data kept across a param change, `AbortController` drops stale
responses).

- **Params.** `source=system|kernel` (default `system`; anything else is `invalid_param`) and
  `lines`, a number clamped to 50..500 (default 200; non-numeric is `invalid_param`). GET only.
- **Sources.** `system` is one `logread` run (the `logd -S 64` ring); `kernel` is one `dmesg`
  run. One `awk` pass counts every line (`total`, before the limit), keeps the last `lines` in a
  circular buffer and prints the whole JSON document, **newest first**. No `jq` is involved.
- **System entries.** `t` is `mktime()` of the line's own stamp (local time, which is what
  `logread` stamps with; device BusyBox awk has `mktime`), `null` when it cannot be computed.
  `ts` is the stamp as logged (`Mon Nov  9 11:25:58 2026`). `facility`/`level` split
  `user.notice`; `warn` becomes `warning`, an unknown level is `null`. `proc`/`pid` come from the
  `proc[pid]: ` tag; a line may carry a proc without a pid (`QCMAP:`, `qm_ping:`), a pid without
  a proc (`[12006]:`), or neither (the whole text is `msg`). A line with no parseable stamp
  (continuation) is kept with `t: null`, `ts: ""`.
- **Kernel entries.** `up` is the kernel stamp in seconds since boot; the caller field
  (`[ T4474]`, `[    C0]`) is stripped from `msg`. Wall time is `now - uptime + up`.
- **Escaping.** Built char by char in awk (no `sub`/`gsub` replacement strings, whose backslash
  rules differ between awks): `\` and `"` escaped, tab becomes a space, other control
  characters are dropped.

---

## Known debt

- **No request cancellation.** `fetchLogs` has no `AbortController`. Rapid filter changes can
  leave two reads in flight, and the later `setState` wins by arrival order rather than by
  request order. In practice the 400 ms search debounce plus a fast local CGI makes this hard
  to hit, but it is a real race.
- **`available_components` pollution** (above) is a backend fix nobody has taken.

---

## Related

- [`toast-confirmation.md`](./toast-confirmation.md) - the confirmation rule the Clear and Copy
  toasts follow
- [`icon-system.md`](./icon-system.md) - the route-scoped lucide/Material boundary
- [`tailwind-prose-hazard.md`](./tailwind-prose-hazard.md) - why this doc describes bracketed
  utility spellings in words instead of quoting them
