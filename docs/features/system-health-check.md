# System Health Check

An on-demand, read-only sweep of every QManager subsystem on the device (50 checks in 7 groups), plus a redacted `.tar.gz` support bundle. Ported from the RM520N fork in ledger row B3.4 (2026-10-16). The runner was rewritten from bash/systemd/sudo to BusyBox ash, and it probes this target's real stack: the Rust AT broker, procd services, fw4/nft and the poller and ping caches.

**UI:** System Settings → System Health Check (`/system-settings/system-health-check`). The page is a diagnostics surface, so it may name paths, daemons and AT commands (No Debug-Build Copy exemption).

## Components

| Piece | Path | Role |
|---|---|---|
| Runner | `/usr/bin/qmanager_health_check` | One-shot job, `qmanager_health_check <job_id>` or `--clear`. Not a daemon: no init.d, no procd instance |
| CGIs | `system/health-check/{run,status,clear,download}.sh` | Start, read, clear and download. Contracts in `docs/API-REFERENCE.md` |
| Hook | `hooks/use-system-health-check.ts` | Polls `status.sh` every 500 ms while a run is live |
| Types | `types/system-health-check.ts` | `HealthCheckJob`, `HealthCheckTest`, `TestCategory`, `RunResponse` |
| UI | `components/system-settings/system-health-check/**` | Page header, status band, Needs attention, All checks, then the Debug Report card. `shapes.ts` holds geometry, tones and the per-category check counts |
| Copy | `public/locales/*/system-settings.json` → `health_check` | Folded into the existing namespace (`keyPrefix: "health_check"`). A new namespace would make every published language pack fail the install worker's required-namespace check |

## Debug Report card

`DiagnosticsCard` (`components/system-settings/diagnostics/diagnostics-card.tsx`, titled "Debug Report") renders as a full-width card after All Checks, in **every** page state (loading, empty, error, loaded). It moved here from the `/system-settings` index. It does not depend on a check run: it has its own hook and CGI (`useDiagnostics`, `system/diagnostics.sh`; see [diagnostics.md](diagnostics.md)), so a failed or never-run health check must not hide it. It is the capture path when the health check itself cannot reach the device.

## Runtime files

| File | Meaning |
|---|---|
| `/tmp/qmanager_health_check.json` | Live status (`job_id`, `status`, `pid`, `summary`, `tests[]`, `tarball_*`, `error`). Read-modify-write under `qmanager_health_check.lock`, atomic tmp+mv |
| `/tmp/qmanager_health_check.run.lock` | Held (`flock -n`) for the whole run. A second runner exits 3. A 0-byte leftover is harmless and is reused |
| `/tmp/qmanager_health_check_<job>/tests/<id>.txt` | Raw evidence per check. `status.sh?test_id=` serves the last 4 KB |
| `/tmp/qmanager_health_check_<job>.tar.gz` | The support bundle. Only the newest job dir and tarball are kept; anything older than 60 min is pruned at start |
| `/tmp/qmanager_health_check.log` | Runner stdout/stderr |

`uninstall.sh` `remove_runtime_state()` removes all of these. `install.sh` needs nothing extra: `install_dir_flat` copies the runner and `install_tree` creates the new CGI subdirectory.

## Invariants

- **Read-only toward user state.** No UCI writes, no AT set commands, no service restarts, no reboot. AT checks are queries only (`AT`, `AT+CGMI`, `AT+CGMM`, `AT+CGSN`, `AT+CFUN?`, `AT+CPIN?`, `AT+CPMS?`).
- **Never read the SMS inbox.** The RM520N runner ran `sms_tool recv` (history; QManager's SMS transport is now `qsms`), and on this modem every listing marks unread messages read (`AT+CMGL=4`). SMS health is `AT+CPMS?` instead.
- **The poller is never paused.** The source stopped it to beat lock contention. The broker queues requests, and stopping the poller would blank the dashboard and blind the watchdog.
- **The modem lock is never waited on.** `sms.lock` makes up to 5 `flock -n` tries 1 s apart, so it never queues ahead of the broker. The binary catalog checks `bin.qsms` (replacing `bin.sms_tool`) with the same logic as `bin.qcmd`: pass if the link points at `qmanager_atd` and the binary is executable. BusyBox `flock` here has no `-w`.
- **No lock fd reaches a child.** Lock fds are closed on child commands, so an orphaned `qcmd` or `timeout` can never keep a lock (the FD-9 bug class from `qcmd`).
- **Every external command is bounded** with `timeout` (ping 10 s, nslookup 5 s, logread and dmesg). A full run takes about 8–11 s.
- **The `net.ping` target is Connection Quality's slot 1.** The runner reads it through the platform adapter (`qm_platform_cqwd.sh`, `cfg_get_list connection_quality targets`, first line), so the check follows what the ping daemon actually probes first. An IPv4 literal or hostname is pinged as is; an IPv6 literal, an empty list, a leading `-` or any other character falls back to `8.8.8.8`, and so does a missing adapter. The check's label carries the resolved target (`Ping reaches <target>`).
- **Durations come from `/proc/uptime`.** `date +%N` is unsupported on this BusyBox.
- **Freshness uses the monotonic `mono` field** (falling back to mtime), because the wall clock steps on NITZ/ntpd. Poller cache: pass under 30 s, warn under 180 s (`write_cache` runs every 2 s in every tier). Ping cache: pass up to `max(3 × interval_sec, 15)` s, warn under 180 s.
- **`svc.thermal` reads the poller cache, never the modem.** It skips when `/tmp/qmanager_status.json` is missing or 30 s or older (`_cache_age`: `mono` field, mtime fallback), or when `.thermal` is `null`; it warns while `.thermal.throttling` is true (naming the parts) and passes otherwise, with the headroom when known. It is not feature-gated. Details: [`thermal-throttling.md`](thermal-throttling.md#health-check-svcthermal).
- **Feature-gated checks skip when the feature is off.** Watchcat (`quecmanager.watchcat.enabled`), tower failover (`/etc/qmanager/tower_lock.json` `failover.enabled` with an LTE or NR-SA lock), Traffic Engine (`video_optimizer` or `traffic_masquerade` enabled), SMS forwarding, Tailscale (installed). A present binary for a disabled feature still passes.
- **The catalog lives in two places.** The runner seeds every check as `pending`; `CATEGORY_TEST_COUNT` in `shapes.ts` restates the per-category counts for the empty state, and the locale `tests.<id>` keys translate each label (the runner's English label is the fallback). Add or remove a check in all three. The Services group has 10 checks (`CATEGORY_TEST_COUNT.services`), including `svc.thermal` (locale key `tests.svc.thermal`).

## Redaction (bundle)

Never collected: `auth.json`, session or cookie files, Tailscale state. Masked or replaced before tarring: IMEI (first 9 digits + `xxxxxx`), ICCID (first 6 + `x`), JSON values of password, token, secret, key and auth-like keys, phone numbers and email addresses in alert and forwarding configs, secret-like `option` lines in `uci export quecmanager`, `tskey-*`, Cookie and Authorization headers. `cfg.uci` records only a line count and `cfg.json` only file names, because `status.sh?test_id=` serves raw output to the UI.

Validated 2026-10-16 on the RM551E by extracting a live bundle: no IMEI, auth hash, 15–20 digit run, email address, phone number or secret value survived. ICCID, IMSI and phone masking could not be exercised live (no SIM was seated) and were tested on synthetic values only.

## Frontend notes

- After a POST the status file can still hold the previous job for a few milliseconds. The hook waits for the started `job_id` (up to 10 polls) before it adopts a read, so a stale `complete` cannot stop polling.
- Start and Clear failures toast only (`resolveErrorMessage` on the returned code). `error` stays reserved for "the status read failed", which is what flips the page to its unreachable state.
- Error codes: `job_running`, `runner_missing`, `clear_failed`, `bundle_not_found`, `invalid_job_id`, `invalid_test_id`, `no_run`.
