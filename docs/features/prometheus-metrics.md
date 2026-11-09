# Prometheus Metrics

Lets a Prometheus server scrape the modem's signal, carrier aggregation, connectivity and device health over HTTP with a bearer token. It is opt-in and off by default, and adds no daemon, binary or port: one shell CGI runs one `jq` pass over the poller's `status.json` snapshot. A per-scrape "Scrape freshness" setting decides whether scrapes may hold the adaptive poller at a faster cadence. The token auth lives in a shared library, `api_auth.sh`, so a future machine-facing endpoint reuses it instead of re-implementing it.

Plan and decision log: [`../plans/prometheus-metrics.md`](../plans/prometheus-metrics.md) (the shipped behaviour below wins where they differ). Ledger row B3.7.

## Quick Reference

| Item | Value |
|---|---|
| Page | `/monitoring/prometheus` (`app/monitoring/prometheus/page.tsx`, `components/monitoring/prometheus/{prometheus,prometheus-card,scrape-config}.tsx` + `shapes.ts`); sidebar entry is a sub-item of Connection Quality (beside Network Events), the route is unchanged |
| Hook / types | `hooks/use-prometheus-metrics.ts`, `types/prometheus-metrics.ts` |
| Scrape CGI | `GET /cgi-bin/quecmanager/metrics/prometheus.sh` (bearer token, no session cookie) |
| Settings CGI | `GET/POST /cgi-bin/quecmanager/monitoring/prometheus.sh` (session cookie via `cgi_base.sh`) |
| Auth library | `/usr/lib/qmanager/api_auth.sh` (see [Machine API auth](#machine-api-auth-api_authsh)) |
| UCI | `quecmanager.metrics.{enabled,freshness,token}` (type `metrics`) |
| Scrape file | `/var/run/qmanager/metrics_scrape` = `"<freshness> <uptime_s>"` (poller input) |
| Auth-fail stamp | `/var/run/qmanager/api_authfail_metrics.stamp` |
| Poller constants | `METRICS_SCRAPE_FILE`, `METRICS_LEASE_TTL=120` in `qmanager_poller` |
| Snapshot source | `/tmp/qmanager_status.json` |
| New `.device` fields | `serving_read_mono`, `ca_read_mono` |
| Backup section | `metrics` (`enabled` + `freshness` only; never the token) |
| New error code | `token_generation_failed` (`errors.json`, all five locales) |
| Reboot required | No. No `init.d` change, no reload flag |

## UI

Three elements on `/monitoring/prometheus`, under the page header:

- **Scrape status band** (`scrape-status.tsx`, full width, always mounted): "Last scrape N s ago" (info), "No scrapes yet" (muted) or "Endpoint off" (muted), plus a `Holding faster polling` info chip while a scrape is holding the poller. It reads the saved state, never the draft.
- **Settings card** (`prometheus-card.tsx`; Card-Foot Apply Rule: Discard and Save in `CardFoot`):
  - **Metrics endpoint**: Off / On `SegmentedField`.
  - **Scrape freshness**: Adaptive / Balanced / Real-time, with a consequence line per mode. `Adaptive polling is off, so readings are always live` shows when `quecmanager.poller.enabled=0`.
  - **Bearer token** (only while saved-enabled with a token): masked field with show/hide, Copy, and Regenerate (no ellipsis; it opens an `AlertDialog` because the old token stops working at once).
- **Scrape config card** (`scrape-config.tsx`), paired with the settings card on a wide page (`PAGE_PAIR`, `@5xl/main:grid-cols-2`, equal heights; the code block absorbs the slack). Uses the shadcn-derived `components/ui/code-block.tsx` with `hooks/use-highlighted-code.tsx` and `lib/highlighter.ts` (shiki, YAML only, one `css-variables` theme mapped onto design tokens by the `CodeBlock` root). The block is a `prometheus.yml` view of a `scrape_configs` job built from the page's own host, defaulting to `scheme: https` with `tls_config.insecure_skip_verify: true` (the modem's certificate is self-signed; plain `http` over Tailscale is fine), `metrics_path` from `endpoint_path`, and the token as `authorization.credentials`. Header actions: reveal (shared with the token field through one page-level `revealed` state), wrap lines, copy (via `lib/clipboard.ts`, the clipboard always gets the real token). While the endpoint is off the card shows an empty tile and the highlighter chunk never loads.

The token, config and status describe what is live, not the draft. The card shows the endpoint path and scrape config on purpose: it is a sanctioned exception to No Debug-Build Copy (the surface exists to integrate a tool, like the AT Terminal). That text appears only in the snippet block; prose never names UCI, files, daemons or scripts. The hook re-reads the settings every 15 s while the tab is visible (silent: a failed re-read keeps the last good view). Mutators return `{ success, message? }` with the reason already run through `resolveErrorMessage`; the card toasts from that result.

## CGI Contracts

### Scrape: `GET metrics/prometheus.sh`

Request: `Authorization: Bearer <64 lowercase hex>`. The script does not source `cgi_base.sh` (its headers are JSON + CORS and its auth is the cookie path, and sourcing it forks). It sources `api_auth.sh` behind an `[ -f ]` guard and, if `qm_api_auth` is missing, prints the same 403 bytes and exits (fail closed).

| Case | Response |
|---|---|
| Method is not GET | `405`, `Allow: GET`, `text/plain` body `Method Not Allowed` |
| Disabled, setup required, missing / malformed / wrong token, invalid stored token, lib missing | `403 Forbidden`, `text/plain`, `Cache-Control: no-store`, body `Forbidden` (byte-identical for every reason) |
| Authenticated | `200`, `Content-Type: text/plain; version=0.0.4; charset=utf-8`, `Cache-Control: no-store` |

No CORS headers: this is not a browser API. Order of work after auth: read `freshness` (`qm_api_opt`; invalid reads as `adaptive`), read `/proc/uptime` with a builtin, write the scrape file, run one `jq` program over `status.json`. The scrape never touches `/tmp/qmanager_ui_active`, so a scrape does not look like an open browser. If `jq` fails, the fallback body is a single `qmanager_snapshot_up 0`.

Measured on the RM551E: 200 median ~88 ms (p95 ~91 ms), 403 ~22 ms. The 403 path exits before `jq`.

### Settings: `GET monitoring/prometheus.sh`

```json
{
  "success": true,
  "settings": { "enabled": false, "freshness": "adaptive", "token": "" },
  "endpoint_path": "/cgi-bin/quecmanager/metrics/prometheus.sh",
  "https_port": 443,
  "last_scrape": { "age_seconds": 12, "mode": "realtime" },
  "holding": true,
  "poller": { "adaptive_enabled": true, "tier": "active" }
}
```

- `settings.token` is returned to the authenticated owner only (`cgi_headers` sends `no-store`); it is `""` when none exists or the stored value is not 64 lowercase hex. It reaches `jq` on stdin via the `printf` builtin, never argv.
- `last_scrape` is `null` when the scrape file is absent, not `qm_trusted_file`, malformed, has an unknown mode, or its uptime is in the future.
- `holding` = enabled AND file mode `balanced`/`realtime` AND `age_seconds <= 120` (same TTL as the poller).
- `poller.adaptive_enabled` is `quecmanager.poller.enabled != 0`; `poller.tier` is `.device.poller_tier` or `null`.
- `https_port` is the port the scrape-config snippet targets: `wp_conf_https` from `web_port.sh` (custom web ports, [`web-port.md`](web-port.md)) when that lib is installed (sourced behind `[ -f ]`), otherwise the port of the first `uhttpd.main.listen_https` entry, otherwise `443`.

### Settings: `POST monitoring/prometheus.sh`

| Body | Effect |
|---|---|
| `{"action":"save","enabled":true,"freshness":"balanced"}` | Validates both fields. If enabling with no valid token, generates one FIRST. Then one `uci batch` (stdin) sets `enabled` + `freshness`, commits, and syncs the scrape file (disabling removes it; otherwise the mode is rewritten keeping the uptime, so a mode change reaches the poller within one cycle). Returns the GET body. |
| `{"action":"regenerate_token"}` | Allowed only while enabled; otherwise `invalid_value`. Returns the GET body with the new token. |

Errors (`cgi_error`, translated through `errors.json`): `invalid_json`, `missing_action`, `unknown_action`, `invalid_value` (`detail` = `enabled` or `freshness`), `token_generation_failed` (new), `save_failed` (UCI write or commit failed, including the token write), `method_not_allowed`. Nothing is logged with the token.

## UCI Schema

```
quecmanager.metrics=metrics
quecmanager.metrics.enabled='0'          # 0|1
quecmanager.metrics.freshness='adaptive' # adaptive|balanced|realtime
quecmanager.metrics.token='<64 hex>'     # never seeded; generated on first enable / regenerate
```

Readers treat a missing section or key, or an invalid value, as the default (`enabled=0`, `freshness=adaptive`). A token that is not exactly 64 lowercase hex is treated as no token (fail closed). A designed-but-not-built `include_cell_identity` option is described under [Data classification](#data-classification).

## Data Classification

Default: **excluded**. The scrape CGI is a strict allowlist, a named set of `jq` families. It is never a generic flattener, so a new snapshot field is never exported by accident. **Adding a field is a security change.**

| Class | Fields |
|---|---|
| **Exposed** | `modem_reachable`, `mono` / `timestamp` (age only), `system_state`; `network.{type,carrier,service_status,cfun,total_bandwidth_mhz}` and `carrier_components[].{type,technology,band,earfcn,bandwidth_mhz,pci,rsrp,rsrq,rssi,sinr}`; `lte.{state,band,earfcn,pci,rsrp,rsrq,rssi,sinr}`, `nr.{state,band,arfcn,pci,rsrp,rsrq,sinr,scs}`; `signal_per_antenna.*` (sentinels dropped); `connectivity.{internet_available,status,latency_ms,avg_latency_ms,jitter_ms,packet_loss_pct,dns_lookup_ms}`; `device.{temperature,cpu_usage,memory_used_mb,memory_total_mb,uptime_seconds,conn_uptime_seconds,poller_tier,model,firmware,manufacturer,qmanager_version,serving_read_mono,ca_read_mono}`; `watchcat.{enabled,failure_count,total_recoveries}`; `sim.status` |
| **Never** | `device.{imei,imsi,iccid,phone_number,ippt_*}`; `network.{wan_ipv4,wan_ipv6,apn,primary_dns*,secondary_dns*,sim_slot,ca_active,ca_count,nr_ca_active,nr_ca_count}`; `connectivity.{ping_target,dns_resolver,last_family,latency_history,thresholds,profile}`; `sim_swap.*` (user-entered profile names), `sim_failover.*`, `errors`; band-support strings (`supported_*`, `hw_*`, `lte_category`, `mimo`, `bandwidth_details`, `build_date`); `watchcat.last_recovery_time` |
| **Opt-in, designed, NOT built** | `lte` / `nr` `.{cell_id,enodeb_id,sector_id,tac,ta}`. Would be a `qmanager_serving_cell_identity_info{...}` family behind `quecmanager.metrics.include_cell_identity=1`, with a visible consequence line ("Prometheus can work out roughly where the modem is"). Cell ID + TAC + timing advance locate a device to a sector and distance; PCI, EARFCN/ARFCN, band and carrier name do not, and the per-carrier series need them as labels. Nothing in v1 reads or emits these fields. |

**Why identifiers are "never", not opt-in:** Prometheus keeps data for long periods and is often federated to cloud services. Subscriber and equipment identifiers are not telemetry and no dashboard needs them.

## Metric Catalog

Every family is typed `gauge`. Info and stateset families carry value `1` (or `1`/`0` per state). A missing reading emits no sample (never `NaN`); a family with no samples is omitted entirely, HELP and TYPE included. Labels with an empty or null value are dropped, and so is a label whose value is not a string or number (an object or array never becomes label text); label values are control-stripped, `\` and `"` escaped, and capped at 64 characters; duplicate label sets within a family collapse to one sample.

**State labels are closed sets** (`enum` in the jq program): `system_state`, `network_type`, `service_status`, the LTE/NR serving `state`, `connectivity_status` and `sim_status` emit only values from a fixed list matching what the poller writes; anything else reads `other`. **Why:** a future poller change that put free text or an identifier into one of those fields would otherwise be exported silently. A legitimate new state value shows as `other` until it is added to the list (update the list in `metrics/prometheus.sh` together with the poller). Per-carrier series are limited the same way: a carrier component counts only when its technology is LTE or NR, `role` is `pcc`/`scc`/`other`, and `pci`/`earfcn` labels must be numeric (otherwise dropped). `carrier` and `band` stay free text by nature and rely on `lbl` escaping.

**Staleness gate:** the snapshot age is `uptime - .mono` (monotonic; falls back to wall-clock `timestamp` when `.mono` is absent or invalid). The snapshot is fresh when it parses as an object and is at most 30 s old (the watchdog's `STATUS_STALE_THRESHOLD`). When it is missing or stale, the response contains only the three "always" families below, so frozen numbers are never served as live.

### Always emitted

| Metric | Labels | Unit / meaning |
|---|---|---|
| `qmanager_snapshot_up` | none | `1` if the snapshot exists, parses and is fresh, else `0` |
| `qmanager_snapshot_age_seconds` | none | seconds since the poller wrote the snapshot (omitted when unknowable) |
| `qmanager_build_info` | `version`, `model`, `manufacturer`, `firmware` | value `1` |

### Emitted only while the snapshot is fresh

| Metric | Labels | Unit / meaning |
|---|---|---|
| `qmanager_serving_cell_age_seconds` | none | seconds since the last `AT+QENG` reply carrying `+QENG:` lines (from `.device.serving_read_mono`) |
| `qmanager_carrier_components_age_seconds` | none | seconds since the last carrier read, from QMI or `AT+QCAINFO` (from `.device.ca_read_mono`) |
| `qmanager_poller_tier` | `tier` = `active`/`idle`/`deep` | stateset, `1` for the current tier |
| `qmanager_scrape_freshness` | `mode` = `adaptive`/`balanced`/`realtime` | stateset, `1` for the configured mode |
| `qmanager_modem_reachable` | none | `1`/`0` |
| `qmanager_system_state` | `state` | info, `1` |
| `qmanager_modem_cfun` | none | `AT+CFUN` level |
| `qmanager_network_info` | `network_type`, `carrier`, `service_status` | info, `1` |
| `qmanager_total_bandwidth_hertz` | none | Hz (MHz x 1e6) |
| `qmanager_carrier_components` | `rat` = `lte`/`nr` | count of aggregated carriers |
| `qmanager_carrier_rsrp_dbm`, `_rsrq_db`, `_rssi_dbm`, `_sinr_db` | `rat`, `role`, `band`, `pci`, `earfcn` | per carrier |
| `qmanager_carrier_bandwidth_hertz` | `rat`, `role`, `band`, `pci`, `earfcn` | per carrier, Hz |
| `qmanager_serving_rsrp_dbm`, `_rsrq_db`, `_sinr_db` | `rat` = `lte`/`nr` | serving cell |
| `qmanager_serving_rssi_dbm` | `rat` = `lte` | LTE only |
| `qmanager_serving_cell_info` | LTE: `rat`, `state`, `band`, `pci`, `earfcn`; NR: `rat`, `state`, `band`, `pci`, `arfcn`, `scs_khz` | info, `1` |
| `qmanager_antenna_rsrp_dbm`, `_rsrq_db`, `_sinr_db` | `rat`, `port` = `prx`/`drx`/`rx2`/`rx3` | per antenna port; unmeasured sentinels dropped |
| `qmanager_internet_up` | none | `1`/`0` |
| `qmanager_connectivity_status` | `status` | info, `1` |
| `qmanager_ping_rtt_seconds`, `_ping_rtt_avg_seconds`, `_ping_jitter_seconds` | none | seconds (ms / 1000) |
| `qmanager_ping_loss_ratio` | none | 0 to 1 |
| `qmanager_dns_lookup_seconds` | none | seconds |
| `qmanager_temperature_celsius` | none | modem temperature |
| `qmanager_cpu_usage_ratio` | none | 0 to 1 |
| `qmanager_memory_used_bytes`, `qmanager_memory_total_bytes` | none | bytes (MB x 1048576) |
| `qmanager_system_uptime_seconds`, `qmanager_connection_uptime_seconds` | none | seconds |
| `qmanager_watchdog_enabled` | none | `1`/`0` |
| `qmanager_watchdog_failure_count` | none | consecutive failures |
| `qmanager_watchdog_recoveries` | none | recoveries; resets with the watchdog's state |
| `qmanager_sim_status` | `status` | info, `1` |

Antenna sentinels dropped (the same values `normalizeSignalValue` treats as unmeasured, see [`antenna-alignment.md`](antenna-alignment.md)): RSRP `-140` and `-32768`; RSRQ `-32768`; SINR `-20` and `-32768`.

**Why the age gauges exist (D4):** without them every radio gauge looks fresh while the deep tier freezes CA data for hours. Both `.device` fields are written by the poller (`_SERVING_READ_MONO` set after a `poll_serving_cell` reply that contains `+QENG:`; `_CA_READ_MONO` after a successful `parse_ca_info` or a QMI carrier build, which uses the sidecar's `qmi_mono`), `0` = never. A zero or future value yields no sample, so the gauge is omitted rather than reading as huge. The serving-cell age can grow even in the active and idle tiers: the RM551E sometimes answers `AT+QENG="servingcell"` with no `+QENG:` line (logged as `parse_serving_cell: no +QENG: lines in response`), and a busy broker turn keeps the last values. Seen on 2026-10-19 as a 59 s serving age against a 29 s CA age in the idle tier; that gap is the gauge doing its job.

## Scrape-Freshness Hold

Every **authenticated** scrape, in any mode, writes `/var/run/qmanager/metrics_scrape` = `"<freshness> <uptime_s>\n"`. The same file feeds the poller's hold and the card's "Last scrape" fact. Uptime (monotonic) is used instead of epoch so the age is immune to NITZ/ntpd clock steps. The file lives on tmpfs and dies with a reboot, exactly as the uptime clock resets.

The poller's tier selection (`poll_cycle`) reads it as a third input after the force flags and the UI heartbeat. The mechanism, invariants and edge cases are documented as [Invariant 11 in adaptive-polling.md](adaptive-polling.md#11-prometheus-scrape-hold-rewrites-the-effective-age-never-the-ladder). In short:

- It rewrites the effective heartbeat age; the tier ladder, AT-due modulo and full-refresh logic are untouched.
- `realtime` pins `active` (data read every 2 s, like an open dashboard); `balanced` caps the age at `idle_threshold`, so the poller is never deeper than `idle`.
- It can only raise the cadence, never lower it, and expires 120 s after the last scrape (`METRICS_LEASE_TTL`). Prometheus must therefore scrape at least once a minute for the hold to persist; the card hint says so.
- Only an authenticated scrape renews it, so an unauthenticated flood cannot pin the poller.

> ℹ️ NOTE: `adaptive` (the default) still writes the file, so the card can show "Last scrape" and the exporter can report `qmanager_scrape_freshness`, but the poller ignores it.

## Machine API auth (api_auth.sh)

`/usr/lib/qmanager/api_auth.sh` is the bearer-token auth for machine-facing CGI endpoints. Its header comment is the contract. Sourcing it forks nothing. It sources `safe_tmp.sh`, `cgi_auth.sh` and `qlog.sh` behind `[ -f ]` guards (a bare `.` of a missing file aborts BusyBox ash); a missing helper makes `qm_api_auth` deny, never allow. A caller must also guard its own `.` of `api_auth.sh` and fail closed when `qm_api_auth` is not defined (see `metrics/prometheus.sh`).

### Scopes

A scope is one UCI section `quecmanager.<scope>` of type `<scope>`:

| Option | Rule |
|---|---|
| `enabled` | `'1'` accepts requests; anything else denies |
| `token` | exactly 64 lowercase hex; anything else reads as no token |
| other | scope-specific, read through `qm_api_opt` |

- Scope name: `[A-Za-z0-9_]{1,32}`; anything else fails closed.
- One section and **one token per scope, never shared** across scopes: a leaked metrics token must not authorise a future send API.
- The secret option **must be named `token`**: the debug-report redactor (`*token*` glob) and the health-check bundle redactor (`token` in the `sed` pattern) key on the name. A secret under another name would leak into diagnostics.
- The token stays out of config backup (a shared `.qmbackup` must not be able to scrape or drive anyone's modem). A scope's backup section carries `enabled` and settings only; restore of an enabled scope with no token generates one.

### Functions

| Function | Args | Returns / sets |
|---|---|---|
| `qm_api_auth <scope> [https]` | scope name; optional `https` | On success returns `0` with `QM_API_SCOPE=<scope>` and `QM_API_CFG` set (minus the token line). On failure writes the uniform 403 via `qm_api_deny` and **exits the script** (it does not return). With `https`, a request without `HTTPS=on` (plain HTTP) is denied as well; metrics does not pass it (read-only telemetry, and `http` over Tailscale is a supported setup), but any scope that acts must. |
| `qm_api_opt <option>` | option name | Sets `QM_API_VAL` from the same `uci show` read (empty when absent). Returns `1` and sets nothing when called before a successful `qm_api_auth`, with an invalid option name, or with `token` (so `QM_API_VAL` never holds the token). Values are uci-quoted text up to the first `'`, so callers must enumerate / validate what they get. |
| `qm_api_deny` | none | Prints `Status: 403 Forbidden`, `Content-Type: text/plain; charset=utf-8`, `Cache-Control: no-store`, blank line, `Forbidden`. A caller that cannot load the lib prints these same bytes. |
| `qm_api_token_generate <scope>` | scope name | `0` ok; `1` invalid scope; `2` generation failed (no `qm_generate_token`, or its output is not 64 hex); `3` UCI write or commit failed. Writes `set quecmanager.<scope>=<scope>` + the token through `uci batch` on stdin, then `uci commit quecmanager`. |

Variables: `QM_API_SCOPE` (the authenticated scope), `QM_API_CFG` (the scope's `uci -q show` lines with the token line removed, cleared on denial), `QM_API_VAL` (last `qm_api_opt` result). Tunables: `QM_API_AUTHFAIL_INTERVAL=60`, `QM_API_RUN_DIR=/var/run/qmanager`.

`qm_api_auth` accepts only `Bearer <64 lowercase hex>` (scheme word `Bearer` or `bearer`) and denies when the scope is disabled, the stored token is invalid, the presentation is malformed, or setup is required (no password set yet).

### Invariants

- **Exactly one timing-safe compare per request**, on every path. A disabled scope, an invalid stored token or a malformed presentation compares two different fixed dummies, so the work is the same and the dummies can never match each other. **Why:** the response time must not reveal whether the scope is enabled or whether the stored token exists.
- **One uniform 403** for every denial (disabled, setup required, missing, malformed, wrong). **Why:** a probe cannot learn whether the feature is on.
- **Header out of the environment before the first fork.** `qm_api_auth` moves `HTTP_AUTHORIZATION` into a local and unsets it before `uci` runs. **Why:** forked children inherit the environment, and `/proc/<pid>/environ` would carry the token.
- **Enable = generate the token first.** Generate with `qm_api_token_generate`, then set `enabled=1`. **Why:** the scrape endpoint reads UCI per request, so `enabled=1` without a valid token would be a window where a scope is "on" with nothing to compare.
- **Fail closed if the lib is missing**, with the same 403 bytes.
- **Only a clean one-line-per-option read is trusted.** `_qm_api_sanitize` denies when any line of the `uci show` output is not the scope's own, or when a value spans lines: after removing uci's `'\''` escapes, a complete line has an even number of `'` (`_qm_api_line_closed`). **Why:** options are parsed by first match, so a free-text option value carrying a newline could inject a `quecmanager.<scope>.enabled=`/`token=` line that shadows the real one. Verified on-device with three newline forms (all denied) and a value containing `'` (allowed).
- **The stored token does not outlive the compare.** The token line is dropped from `QM_API_CFG`, and the locals holding it are cleared, so a later `set`/`set -x`/debug dump in a caller cannot print it.
- **Never log, echo or put the token or Authorization header on argv.** The token reaches `uci` on stdin through the `printf` builtin. The failed-auth log line carries `REMOTE_ADDR` only.
- **Auth-fail logging is rate limited.** A denial on an *enabled* scope logs at most one `qlog_warn` per 60 s per scope, tracked by `/var/run/qmanager/api_authfail_<scope>.stamp` (one line of uptime seconds, written with a `$$` temp and `mv`). A denial on a disabled scope never logs, so the log cannot reveal that the scope exists. The stamp is read on the uptime clock, so a wall-clock step cannot mute or flood it. No throttling or lockout of failed tokens: 256-bit tokens make brute force moot, and a lockout would let any LAN host lock out the real scraper (uhttpd `-n 3` already bounds concurrency).

### Adding a scope

1. Pick a `[A-Za-z0-9_]{1,32}` name; call `qm_api_auth <scope>` first in the CGI, before any fork.
2. Read scope options with `qm_api_opt`, then validate them (allowlist, never trust the raw value).
3. Settings CGI: on enable, `qm_api_token_generate <scope>` before writing `enabled=1`; map return `2` to `token_generation_failed` and `3` to `save_failed`.
4. Seed `enabled='0'` in `install.sh` (preserve user choice on upgrade); never seed a token. Add a config-backup section that omits the token and generates one on restore of an enabled scope.

### Future: SMS send API (not built)

Not part of v1; recorded here so a later design starts from the right constraints. An endpoint that lets a script send an SMS through the modem must:

- use its **own scope**, `sms_api` (own `enabled`, own token, never the metrics token);
- send only to a **recipient allowlist** configured in the UI, so the caller supplies just the message body and cannot pick a number;
- enforce **per-hour and per-day rate limits**;
- cap the **message length** so it can never become a multi-part message;
- record **every send in the existing sent log** (see [`sms.md`](sms.md) for `sms_sent.sh` and the sent log), so API sends appear in the Cellular SMS conversation view;
- surface **`modem_busy` to the caller** (a retryable error), never drop the message silently.

The independent security review of `api_auth.sh` (2026-10-19) adds what a send scope must not inherit from the read-only metrics setup:

- **Require TLS:** call `qm_api_auth sms_api https`, so a token never crosses the LAN in cleartext.
- **Bound the damage of a leaked token:** the rate limits above, plus an audit record of every accepted call (metadata only). Rejected attempts alone are logged at most once a minute, which is not an abuse ceiling.
- **Don't keep a re-servable plaintext token for a write scope:** store only `sha256(token)`, compare hashes, show the token once at generation, and never return it on GET.
- **Authenticate before reading the body, and cap `CONTENT_LENGTH`** (`cgi_read_post` reads without a bound).
- **Bearer only on that endpoint:** never also accept the session cookie, whose POST path has no CSRF check.
- **Never pass phone numbers or message text through `qm_api_opt`** (values are cut at the first `'`); read and validate them on their own.

## Lifecycle

| Stage | Behaviour |
|---|---|
| Install / upgrade | `seed_uci_defaults` creates `quecmanager.metrics` with `enabled='0'` and `freshness='adaptive'` only when absent (idempotent, preserves user choice). The token is **never seeded**. `api_auth.sh` ships with the rest of `usr/lib/qmanager` (flat copy), the CGIs with the CGI tree. |
| Enable | The settings CGI generates the token, then writes `enabled`/`freshness`. |
| Disable | `enabled=0` and the scrape file is removed; the token stays (re-enabling reuses it). |
| Config backup | `metrics` section: `enabled` + `freshness` only. See [`config-backup-restore.md`](config-backup-restore.md). |
| Uninstall | Covered by existing steps: `uci delete quecmanager` removes the section and token, `rm -rf /var/run/qmanager` removes the scrape file and auth-fail stamps. No `/tmp` file to add. |
| `init.d` | None. The scrape file stays valid across a poller restart because it is keyed on uptime. |
| System Health Check | No entry (v1): nothing can drift except UCI, and a new check touches the runner, `shapes.ts` counts and five catalogs for little value. |

## Security Model

| Threat | Mitigation |
|---|---|
| LAN attacker scrapes or probes | Opt-in, off by default; 256-bit bearer; one uniform 403; strict allowlist (above) |
| Disabled-state probing | Same 403 bytes and same compare work whether the feature is off, on, or the token is wrong |
| Token timing | One `qm_timing_safe_compare` on every path, including disabled |
| Token leakage: argv / env | `uci batch` on stdin; compare through the `printf` builtin; `HTTP_AUTHORIZATION` unset before the first fork |
| Token leakage: logs | Header and token never logged; failed-auth log is `REMOTE_ADDR` only, 1 per 60 s per scope |
| Token leakage: backups and diagnostics | Excluded from the `metrics` backup section; the option is named `token`, which both the debug-report and health-check redactors match |
| Token leakage: UI | Returned only to the cookie-authenticated owner, `no-store`, masked until revealed |
| Token in transit | The snippet defaults to HTTPS (self-signed, `insecure_skip_verify`) on the device's configured HTTPS port; Tailscale/NetBird are encrypted. Passive sniffing is stopped; an active LAN MITM is out of scope (that attacker can already take the admin session cookie, usually sent over plain HTTP). The endpoint still accepts plain HTTP by design (see `[https]` above). Follow-up: certificate pinning, below |
| UCI value injection | Free-text option values with newlines are denied by `_qm_api_sanitize` (fail closed); state labels are closed sets; non-scalar label values are dropped |
| Label / exposition injection | `carrier` comes from COPS and a rogue cell can influence it. The `lbl` filter drops control characters, escapes `\` and `"`, caps at 64 chars, using only `explode`/`implode`/`split`/`join` (device `jq` has no regex). Numbers are type-checked; the jq program writes every family, shell never interpolates a value into the body |
| Scrape flood | The unauthenticated path exits before `jq`; only authenticated scrapes renew the hold, so a flood cannot pin the poller. uhttpd `-n 3` still bounds concurrency (slot contention, same as `public/overview.sh`) |
| Scrape-file planting | Lives in the root-only run dir; the poller parses defensively (allowlisted mode, digits only, no leading zero, at most 10 digits, not in the future); worst case raises the cadence for at most 120 s |
| WAN exposure | fw4 `wan` input is REJECT, and uhttpd `-R` rejects public-to-RFC1918 (not public IPv6). Never enable the vendor's WAN TCP-input rules; the token is the only remaining gate |

## Follow-ups (not built)

- **Certificate pinning for the scrape config.** `ca_file` alone does not work today: the device certificate is a per-device ECDSA P-256 cert with `CN=OpenWrt` and no SAN, and Prometheus (Go) refuses CN-only certificates for hostname verification. Pinning needs a regenerated certificate with a SAN (the modem's IP and hostname), which touches uhttpd, so it belongs with the custom web ports work ([`web-port.md`](web-port.md)). That change should offer the certificate as a download, emit `ca_file` plus `server_name` in the snippet, and keep `insecure_skip_verify` only as a fallback.
- **Cell-identity opt-in** (`include_cell_identity`, see Data classification): designed, not built.
- **CSRF hardening for all settings CGIs** (repo-wide, not specific to this feature): a same-site, different-port origin could send a blind `text/plain` POST to any settings CGI, because `cgi_base` checks neither `Origin` nor `Sec-Fetch-Site`. It cannot read responses (no `Allow-Credentials`; cookie is `SameSite=Strict; HttpOnly`). A `Sec-Fetch-Site`/`Origin` check on POST in `cgi_base` would close it everywhere.
- **`/etc/uhttpd.crt` is mode 0666 on the test device** (the key is 0600): any local user could replace the certificate. Outside this feature; worth fixing in the installer or the web-port work.

## Gotchas

- **Prometheus shows `403` for "off", "no token yet" and "wrong token" alike.** That is deliberate; resolve it from the card (enabled, token copied). A `405` means the scraper is using POST.
- **The scrape CGI does not use `cgi_base.sh`.** Do not add it: it forks, sends JSON + CORS headers, and its auth is the cookie path. A new response header or field is a deliberate change to both this doc and the allowlist.
- **`jq` on the device has no regex** (`test`/`match`/`sub`/`gsub` fail at runtime). Use `explode`/`implode`/`split`/`join`/`tonumber?`.
- **`// empty` on a boolean drops `false`.** The program uses an explicit `b01` helper (`true` -> `1`, `false` -> `0`).
- **A `$$` temp + `mv` is acceptable here only because the directory is root-only** (`/var/run` is root 0755, and `qm_run_dir` makes `/var/run/qmanager` root-owned). It saves the `mktemp` fork on the scrape path. Do not copy the pattern into `/tmp`. See [`../reference/safe-tmp.md`](../reference/safe-tmp.md).
- **Hold needs a scrape at least once a minute.** The TTL is 120 s on the uptime clock; a slower scrape interval lets the poller drop back to its normal tier between scrapes.
- **Real-time is a sustained active tier.** It is the same cadence as an open dashboard; the Active tier no longer carries the data-plane reads ([Invariant 6](adaptive-polling.md)), but it is still a new 24/7 usage pattern. Default is Adaptive.
- **Regenerating the token invalidates the old one immediately** and a scraper gets 403 until the new token is pasted. The dialog says so.
- **Restore of an enabled `metrics` section onto a device with no token generates a new token**; the scraper config must be updated.
- **Leading zeros:** every digits-only value read in the poller or CGI is checked for a leading zero (or stripped) before `$(( ))`; `$((08))` aborts ash.
- **Antenna sentinels** are dropped, not exported as numbers, so `avg()` over ports is not skewed by `-32768`.

## Files

| File | Role |
|---|---|
| `scripts/usr/lib/qmanager/api_auth.sh` | Shared bearer auth (contract above) |
| `scripts/www/cgi-bin/quecmanager/metrics/prometheus.sh` | Scrape endpoint |
| `scripts/www/cgi-bin/quecmanager/monitoring/prometheus.sh` | Settings GET/POST |
| `scripts/usr/bin/qmanager_poller` | Scrape hold, `.device.{serving_read_mono,ca_read_mono}` |
| `scripts/usr/lib/qmanager/config_backup_sections.sh`, `scripts/usr/bin/qmanager_config_restore` | `metrics` backup section |
| `scripts/install.sh` | UCI seed |
| `hooks/use-prometheus-metrics.ts`, `types/prometheus-metrics.ts`, `components/monitoring/prometheus/*`, `app/monitoring/prometheus/page.tsx` | UI |
