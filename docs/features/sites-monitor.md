# Sites Monitor

The Sites monitor times a TCP handshake to each website in a list, over the cellular link, every few minutes, and keeps up to 90 days of history: the per-site latency view UniFi and WiFiman show. The one-host ICMP verdict in [Connection Quality](connection-quality.md) answers "is there internet?"; this answers "is YouTube slow right now?". It is a separate daemon, `qmanager_sites`, that never touches the AT port and does **not** feed the connectivity verdict, events, the watchdog or alerts.

Ported from the RM520N fork (ledger B3.1; source `3af1cc15`, `c9d162a2`, `8e8806ec`, `33047f70`, plus the untrusted-pid fix from `ba4df3b3`). The UI is the Sites card on **History > Connection History** (`/history/connection`, [history.md](history.md#connection-history); ledger **U4.8** ported it onto the retired Latency Monitor, [latency-monitor.md](../reference/latency-monitor.md)), which consumes the [CGI contract](#cgi-contract--monitoringsitessh) below.

## Quick Reference

| Item | Value |
|------|-------|
| Daemon | `/usr/bin/qmanager_sites` (`scripts/usr/bin/qmanager_sites`), BusyBox ash |
| Service | `/etc/init.d/qmanager_sites`: procd, `START=99`, `respawn 3600 5 5`, `term_timeout 10`. **Not UCI-gated**: always enabled; on/off is `enabled` in `sites.json` |
| CGI | `GET/POST /cgi-bin/quecmanager/monitoring/sites.sh` |
| Config | `/etc/qmanager/sites.json` (written by the CGI; validated again by the daemon). Absent = defaults, **enabled** |
| Latest sweep | `/tmp/qmanager_sites.json` (atomic) |
| Raw samples | `/tmp/qmanager_sites_raw.ndjson` (last 24 h) |
| Rollup cursor | `/tmp/qmanager_sites_flushed` (newest raw `ts` already rolled up) |
| Sweep marker | `/tmp/qmanager_sites_checking` (exists while a sweep runs) |
| PID file | `/tmp/qmanager_sites.pid` (singleton guard) |
| Check-now flag | `/tmp/qmanager_sites_now` (created by the CGI; the daemon only tests and removes it) |
| Live lease | `/tmp/qmanager_sites_live` (one epoch, written by the CGI on each `range=now` GET while enabled; the daemon only reads it) |
| Live samples | `/tmp/qmanager_sites_live.json` (atomic; ~2 s samples while leased; never history) |
| History | `/usrdata/qmanager/sites/YYYY-MM-DD.jsonl`: hourly rows, one file per **UTC** day, append-only; 90 days and 4 MB cap |
| Defaults | 13 sites: `google.com facebook.com tiktok.com youtube.com roblox.com spotify.com x.com cellmapper.net reddit.com github.com discord.com instagram.com messenger.com`; `interval_sec` 300 |
| UCI | none |

## What a sample measures

```sh
curl -s -I -o /dev/null --connect-timeout 5 --max-time 6 \
     -w '%{time_namelookup} %{time_connect}' -- "https://<host>"
```

`ms = (time_connect − time_namelookup) × 1000`, rounded to 0.1 ms: the TCP handshake alone (resolver time is `connectivity.dns_lookup_ms`, [DNS Lookup Time](connection-quality.md#dns-lookup-time)).

- The device's curl (8.7.1 on the RM551E) has no `--connect-only`; a `HEAD` keeps each exchange to a few KB.
- **A sample counts only when curl exits 0.** A host that completes the handshake but fails TLS or does not answer the `HEAD` within 6 s is `ms: null` ("did not respond", not "slow").
- An IPv4-literal host gets `-k` (its certificate cannot match the address). `--` precedes the URL so a host can never be read as a curl option.
- All sites run as parallel background jobs: a 13-site sweep takes about 5 s on the RM551E.

**Gateway entry.** When the default route has a `via` next hop on a LAN-style device, the sweep adds one `kind: "gateway"` entry timed with `ping -c1 -W2`. It is omitted when the route's device is `rmnet*`, `ppp*`, `wwan*` or `usb*`, which is the RM551E's normal case (`default via … dev rmnet_data0`).

## Timing

- **Boot:** the first sweep waits until `/proc/uptime ≥ 60 s` (`BOOT_SETTLE`); if `jq` is unusable, the config load retries every 15 s.
- **Cadence:** the next sweep is `interval_sec` (clamped 60–3600) after the previous one **ended**, on `/proc/uptime`.
- **Check now:** the daemon tests the flag every 5 s while waiting; a flag cuts the wait only once 10 s (`MIN_FLAG_GAP`) have passed since the last sweep ended. A `save` with `enabled: true` raises it too.
- **Disabled:** the daemon keeps running, re-reads the config every 30 s and does not sweep. The config is re-read only at the top of a cycle, so a disable lands after the current wait (up to `interval_sec`); the lease removal below stops live mode at once.
- **Wall-clock gate:** the device boots at 1970. Below epoch `1700000000` a sweep still publishes `/tmp/qmanager_sites.json`, with `checked_at` / `next_check_at` `null`, and **nothing** goes to raw or the rollups. The CGI reads no history below it either.
- **SIGTERM** (procd stop) kills in-flight probe jobs and flushes the pending hour into the rollups when the clock is sane; `term_timeout 10` covers it.

## Live mode ("Now")

While someone has **Live values** on (a row in the Sites card's Manage dialog) in a visible tab, the page reads `?range=now` every 2 s. Each read renews the lease, and the daemon probes every site about every 2 s between sweeps:

| Step | Who | Action |
|------|-----|--------|
| 1 | CGI | each `GET ?range=now` writes the current epoch to `/tmp/qmanager_sites_live`, only when the saved config has `enabled: true`; a failed write is ignored |
| 2 | daemon | in the wait between sweeps, reads the lease (digits only, at most 12, not a symlink) and runs a live tick while it is 0–10 s old; otherwise naps 5 s |
| 3 | daemon | each tick probes all sites in parallel, publishes `/tmp/qmanager_sites_live.json`, then sleeps out the rest of 2 s |
| 4 | CGI | `save` with `enabled: false` removes the lease |

The live probe is plain HTTP on port 80, pinned to the IPv4 the previous tick learned:

```sh
curl -s -I --resolve <host>:80:<cached-ipv4> -o /dev/null --connect-timeout 1.5 --max-time 1.8 \
     -w '%{time_namelookup} %{time_connect} %{remote_ip}' -- "http://<host>/"
```

- Same `ms` formula; any HTTP reply with curl exit 0 counts, including a redirect. Plain HTTP because a TLS `HEAD` is ~8 times the bytes (8.8 KB vs 1.1 KB per site, measured on the fork).
- A host that fails loses its cached IP and resolves fresh next tick; a change of the site list clears the cache. IP literals are never cached.
- Start latency is up to ~6 s (the first renewal usually lands in a 5 s nap); stop is ~10 s after the last renewal. No live ticks run during a sweep, and the gateway entry is never live.
- Live samples go **only** to `/tmp/qmanager_sites_live.json`, never to raw, rollups or `qmanager_sites.json`, so watching Live changes no 1h–90d figure. The CGI ignores the file once it is more than 6 s old.
- Shape: `{ "at": 1760000000, "results": [ { "host": "google.com", "ms": 41.3, "ok": true } ] }`

## Cost

- Sweeps (default 13 sites, 300 s): about 13 × 8.8 KB per sweep, roughly **33 MB/day**. On by default, matching the source (user decision 2026-10-16).
- Live mode: about **25 MB/hour** and one busy core while a browser holds the lease (fork measurement); nothing while nobody watches.

## Retention

| Store | Rule |
|-------|------|
| Raw | Rows older than 24 h are trimmed after every sweep |
| Rollups | Completed hours (raw `ts` below the current hour) are flushed into hourly rows once each, tracked by `_flushed` |
| Age | Day files older than 90 days (by UTC file name) are deleted after each flush |
| Size | While the day files total more than 4 MB, the oldest is deleted; the newest never is |
| Free space | A flush is skipped when the data directory has under 8 MB free |

## On-disk shapes

`/tmp/qmanager_sites.json`:

```json
{ "checked_at": 1760000000, "interval_sec": 300, "next_check_at": 1760000300, "wan": "cellular",
  "results": [ { "host": "google.com", "kind": "site", "ts": 1760000000, "ms": 41.3, "ok": true } ] }
```

Raw row and rollup row, one JSON object per line:

```json
{"ts":1760000000,"host":"google.com","ms":41.3,"ok":true}
{"ts_hour":1759996800,"host":"google.com","n":12,"ok":11,"min":38.2,"avg":44.9,"max":61.0}
```

`n` is samples taken, `ok` samples answered; `min` / `avg` / `max` are over answered samples (`null` when none).

`/etc/qmanager/sites.json`:

```json
{ "enabled": true, "interval_sec": 300, "sites": [ { "host": "youtube.com", "label": "YouTube" } ] }
```

The daemon reads at most 32 sites and drops a host that fails its check (3–253 chars of `[A-Za-z0-9.-]`, at least one dot, no leading/trailing dot or hyphen, no `..`, `.-`, `-.`) or repeats, with no jq regex (the device's jq has none). No `sites` key = defaults; `"sites": []` = no sites.

## CGI contract — `monitoring/sites.sh`

Authenticated (standard `cgi_base.sh`). Every failure is the standard `{success:false, error, detail}` envelope except `invalid_field`, which carries `field` and `reason` instead of `detail`.

### `GET ?range=now|5m|1h|3h|6h|12h|24h|7d|15d|30d|90d`

Default `24h`. Anything else → `{ "success": false, "error": "invalid_range", "detail": "range must be now, 1h, …" }`.

| Range | Bucket | Source |
|-------|--------|--------|
| `now` | — | no history; `series` is `[]`. Renews the live lease and serves the live sample as `latest` |
| `5m` | 10 s | raw, plus rollups for any hour older than the first raw row |
| `1h` | 1 min | as above |
| `3h`, `6h` | each sample | as above |
| `12h` | 10 min | as above |
| `24h` | 30 min | as above |
| `7d` | 3 h | rollups, plus raw rows newer than the rollup cursor |
| `15d` | 6 h | as `7d` |
| `30d` | 12 h | as `7d` |
| `90d` | 1 day | as `7d` |

The `5m`/`1h`/`24h`/`7d`/`15d`/`30d` buckets match the History ranges (`docs/features/history.md`: 10 s, 1 min, 30 min, 3 h, 6 h, 12 h, UTC-aligned), so the Sites card on Connection History lines up bar for bar with the page's other cards. Every GET also returns `now`, the modem clock the response was built at; the card anchors its bucket grid on it.

```json
{
  "success": true,
  "enabled": true,
  "interval_sec": 300,
  "checked_at": 1760000000,
  "next_check_at": 1760000300,
  "checking": false,
  "live_at": null,
  "wans": ["cellular"],
  "summary": { "answered": 12, "total": 13 },
  "sites": [
    { "host": "google.com", "label": "google.com", "kind": "site",
      "latest": { "ts": 1760000000, "ms": 41.3, "ok": true, "wan": "cellular" },
      "series": [ { "ts": 1759998000, "ms": 43.1, "min": 38.2, "max": 61.0, "n": 4, "ok": 4 } ] }
  ]
}
```

- `sites` follows the last sweep's order (gateway first when present), then any configured site that sweep did not include, with `latest: null`. A host the config no longer lists is dropped.
- `kind` is `"site"` or `"gateway"`; a gateway's `label` is `"Gateway"`.
- `series[].ms` is the mean of **answered** samples in the bucket (`null` when none); `n` and `ok` let a chart show loss.
- `checking` is `true` while a sweep runs or a check-now flag is pending. `next_check_at` is `null` while disabled. `checked_at` is `null` before the first sweep and while the clock is unset.
- `live_at` is set only on `range=now`, when the live file is at most 6 s old; each `kind: "site"` entry with a live result then gets it as `latest` (`ts = live_at`). Otherwise every `latest` is the last sweep's. `summary.answered` counts the same `latest` the cells show.
- `wans` and the per-sample `wan` are always `"cellular"` today; they exist so a multi-WAN UI fits later.
- History rows are filtered with a `grep -E` row pattern (torn lines never reach the aggregator) and aggregated by `awk`; one small `jq` pass assembles the response.

### `POST {"action":"check_now"}`

Also accepted as `?action=check_now`. Raises the flag → `{ "success": true }`. Disabled → `{ "success": false, "error": "disabled", "detail": "Sites monitor is turned off" }`. Flag write failure → `flag_failed`.

### `POST {"action":"save","enabled":true,"interval_sec":300,"sites":[{"host":"…","label":"…"}]}`

- `enabled` must be a boolean, `sites` a list of at most 32, and each `host` (lower-cased first) must pass the host check. Failures → `{ "success": false, "error": "invalid_field", "field": "enabled"|"interval_sec"|"sites", "reason": "…" }`.
- `interval_sec` must be a number and is **clamped** to 60–3600, not rejected.
- A `label` keeps printable characters only, is cut to 40 and falls back to the host. Duplicate hosts are dropped.
- After the write, `enabled: true` raises the check-now flag and `enabled: false` removes the live lease.
- Response echoes the saved config: `{ "success": true, "enabled": …, "interval_sec": …, "sites": [ … ] }`. Write failure → `save_failed`. Unknown action → `invalid_action`.

### UI consumer (U4.8)

- The Sites card on `/history/connection` ([history.md](history.md#connection-history)) reads this through `hooks/use-sites.ts`: `useSites(range: HistoryRange, live: boolean)` returns `data`, `dataRange`, `dataNow`, `liveData`, `isLoading`, `error`, `checkPending`, `refresh`, `checkNow` and `save`. The page range (`24h`, `7d` or `30d`) is the CGI `range`; Live values (set in the Manage dialog, not saved to the modem) runs a second loop on `range=now` whose result lands in `liveData` and never replaces `data`. All six error codes are in the five `errors.json` catalogs; toasts resolve the returned `code` through `resolveErrorMessage` (`invalid_field`'s `reason` is the detail fallback).
- Live (`range=now`) polls every 2 s only while the tab is visible **and** `enabled` is true (fork fix `8e8806ec`): a disabled monitor writes no lease, so 2 s polling would spend CGI time for nothing.

## Lifecycle

- **install.sh:** `install_backend` creates `/usrdata/qmanager/sites` (`mkdir -p` + `chown root:root` + `chmod 0755`; the device has **no `install` applet**). `enable_services` enables `qmanager_sites` (not in `UCI_GATED_SERVICES`); `start_services` starts it, because OTA runs `--no-reboot`. `stop_services` and the legacy-script prune glob `qmanager*`.
- **uninstall.sh:** the generic init.d loop stops and removes the service; `remove_runtime_state` removes `/tmp/qmanager_sites*` and leftover probe dirs; `--purge` removes `/usrdata/qmanager/sites` (`sites.json` goes with `/etc/qmanager`).
- **Config Backup** carries `sites.json` as the `sites` section of `config_backup_sections.sh` (ledger B5.4); an absent file collects as `{"default":true}` and apply removes it.

## Port notes (vs the RM520N source)

- **ash, not bash.** BusyBox ash on the aarch64 RM551E has 64-bit arithmetic but no `10#`, `printf -v`, `$'\n'`, `[[ < ]]` or `jobs -p`. Leading zeros are stripped before arithmetic (`strip0`; a leading zero reads as octal), day files compare as `yyyymmdd` integers, newlines come from a `NL` variable, result files are `r100`, `r101`, … so the glob keeps probe order, and the daemon tracks its probe pids itself.
- **Probe jobs drop the daemon's traps** (`trap - EXIT INT TERM`), as B2.2's DNS job does, so a killed probe never runs `cleanup` (PID file) or `on_term` (flush).
- **procd, not systemd.** No `stop_service`: rc.common runs it *before* procd kills the instance, so cleanup there would race a sweep. The daemon removes stale probe dirs (`qmanager_sites.??????`) on start instead.
- **Ownership guards kept.** On the RM551E uhttpd runs CGIs as root and `fs.protected_regular` is 0, so the fork's www-data concerns do not bite; `own_or_rm` and the untrusted-PID check (a PID file the daemon does not own is removed before the singleton check, so a foreign file holding a live PID such as `1` cannot block startup) stay as defence in depth.
- `conn_state.sh` is not used: a sweep while the link is down records real "no answer" rows.

## Verified (RM551E, 2026-10-16)

The SIM was walled off by the carrier during the test (ICMP down, HTTP redirected), so most rows were `null`. Byte-identical deploy plus `sh -n`. One-shot sweep in a sandbox: invalid, leading-dash and `..` hosts skipped, duplicate dropped, interval 5 clamped to 60, LAN self-probe answered 1.4 ms, hourly rollup and cursor written. procd service: 13-site sweep in 5 s; GET `24h` and `now` match the contract; bad range → `invalid_range`; live mode on about 0–6 s after a renewal and `live_at` served; `check_now` swept; save with a bad host → `invalid_field`; save `enabled:false` removed the lease, cleaned the label, deduped and clamped. SIGTERM flushed the pending hour. A `nobody`-owned PID file holding `1` did not block start. SIGKILL mid-sweep: procd respawned it and the stale probe dir and marker were cleared.

## Related

- [connection-quality.md](connection-quality.md): the reachability verdict and DNS lookup time this monitor does not replace
- [history.md](history.md#connection-history): the Sites card and the Connection History page
- [`docs/rm520n-port-ledger.md`](../rm520n-port-ledger.md): B3.1 (this) and U4.8 (the card, since moved)
