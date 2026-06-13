# Diagnostics & IPA Hardware Offload

QManager's Diagnostics feature lets users (and support staff) generate a single-file plain-text snapshot of the modem's state — kernel logs, system metrics, network interfaces, and sanitized UCI config — then download it directly from the browser. The companion IPA Offload toggle controls whether the Realtek r8125 2.5G NIC uses kernel-bypass hardware offloading at next boot; disabling it is the community-recommended fix for random Ethernet drops observed mainly on AT&T with sdxpinn r01a04 firmware.

## Quick Reference

| Item | Value |
|---|---|
| Diagnostic daemon | `/usr/bin/qmanager_debug_report` |
| Diagnostics CGI | `POST /cgi-bin/quecmanager/system/diagnostics.sh` |
| IPA offload CGI | `GET/POST /cgi-bin/quecmanager/system/ipa_offload.sh` |
| Hook — diagnostics | `hooks/use-diagnostics.ts` |
| Hook — IPA offload | `hooks/use-ipa-offload.ts` |
| Types — diagnostics | `types/diagnostics.ts` |
| Types — IPA offload | `types/ipa-offload.ts` |
| IPA init script | `/etc/init.d/r8125_ioss.init` |
| Artifact path | `/tmp/qmanager_debug_<epoch>.txt` |
| Max artifact size | 307 200 bytes (~300 KB) |
| Reports retained | 3 newest (older pruned automatically) |
| Reboot required | No (diagnostics); Yes — deferred (IPA offload toggle) |

---

## Background and Motivation

This feature was built to diagnose intermittent baseband stalls and Ethernet drops reported on RM551E devices running sdxpinn r01a04. Because the drops are transient, they needed a one-click mechanism to gather all relevant state immediately after an incident, without requiring SSH access or manual log assembly.

The IPA offload toggle exists because the r8125 NIC's IPA (IP Acceleration) hardware offload has been reported to cause random Ethernet disconnects on certain carrier configurations. Disabling it at next boot (without a live module unload) is safe and reversible.

---

## Daemon: `qmanager_debug_report`

Install path: `/usr/bin/qmanager_debug_report` (mode 755)

The daemon is a standalone BusyBox `/bin/sh` script. It collects diagnostics, writes the report to `/tmp/qmanager_debug_<epoch>.txt`, and **prints the artifact path as its last stdout line**. The CGI reads only that last line to locate the file — this is the daemon-CGI contract (see "Daemon–CGI Contract" below).

### Report Sections

The daemon assembles sections in this order:

| Section title | Source |
|---|---|
| `qmanager_version` | `/etc/qmanager/VERSION` |
| `openwrt_release` | `/etc/openwrt_release` |
| `uptime_loadavg` | `/proc/loadavg` |
| `uptime` | `uptime` |
| `memory` | `free` |
| `df_tmp` | `df /tmp` |
| `dmesg_tail_300` | `dmesg \| tail -n 300` |
| `dmesg_driver_grep` | `dmesg \| grep -i -E 'ipa\|ioss\|r8125\|rtl\|ssr\|subsys\|fatal\|smd\|qrtr\|remoteproc\|q6v5\|qcom_q6v5\|watchdog\|wdog\|wdt\|panic\|Oops\|BUG:\|hung\|rcu_sched\|stall\|lockup'` |
| `logread_tail_300` | `logread \| tail -n 300` |
| `ip_link_stats` | `ip -s link` |
| `ip_route` | `ip route` |
| `ifconfig` | `ifconfig` |
| `uci_show_quecmanager_redacted` | `uci show quecmanager` — with secrets masked (see below) |
| `lsmod_offload` | `lsmod \| grep -i -E 'ipa\|ioss\|r8125\|offload'` |
| `r8125_ioss_enabled` | `/etc/init.d/r8125_ioss.init enabled; echo "enabled_rc=$?"` |
| `watchdog_state` | `ubus call system watchdog` + `ls -la /dev/watchdog*` + `cat /sys/class/watchdog/watchdog0/state` |
| `modem_ssr_dumps` | `ls -la /data/vendor/ramdump/` + `ls -la /data/ssr_kpi/` + `ls -la /data/minidump/` |
| `pstore` | `ls -la /sys/fs/pstore/` + `cat /sys/module/pstore/parameters/backend` |
| `qmanager_log_tail_200` | `tail -n 200 /tmp/qmanager.log` |
| runtime JSON files | all `/tmp/qmanager_*.json` (ping_history limited to last 50 lines) |

Each section is wrapped in `===== <title> =====` banners. A failed or empty command still emits its banner with `(no output)` so the report structure is always predictable.

#### `dmesg_driver_grep` — broadened keyword set

The grep pattern was extended beyond the original driver/SSR families (`ipa|ioss|r8125|rtl|ssr|subsys|fatal|smd|qrtr`) to also include app-processor crash and watchdog signatures: `remoteproc|q6v5|qcom_q6v5|watchdog|wdog|wdt|panic|Oops|BUG:|hung|rcu_sched|stall|lockup`.

**Why:** recoverable baseband MPSS SSRs surface in dmesg as `qcom_q6v5_pas ... remoteproc-mss: crash detected ... type fatal error`. A full AP hang produces `BUG:`, `Oops`, `hung_task`, or RCU stall messages instead. The broadened set catches both failure modes in a single section.

#### `watchdog_state`

Calls `ubus call system watchdog`, `ls -la /dev/watchdog*`, and reads `/sys/class/watchdog/watchdog0/state`.

**Why:** on affected RM551E builds the hardware watchdog is disabled in firmware (`ubus` returns `"status":"offline"` and `/dev/watchdog` is absent). When the AP hangs, there is no watchdog to reset it — only a manual power cycle recovers the device. This section makes that firmware gap visible in every capture.

**Dependency:** uses `ubus`, which is an OpenWRT core binary (not an add-on). It is available on all supported builds.

#### `modem_ssr_dumps`

Lists the contents of `/data/vendor/ramdump/`, `/data/ssr_kpi/`, and `/data/minidump/` using `ls -la`.

**Why:** Qualcomm MPSS (baseband Q6) subsystem restarts leave dated `.elf` ramdump files in `/data/vendor/ramdump/` on persistent UBI storage. Because these files survive reboots, counting and timestamping them lets support staff determine how many baseband crashes have occurred across the device's uptime, not just since the most recent boot.

> ⚠️ WARNING: `modem_ssr_dumps` emits **directory listings only — it never `cat`s the `.elf` files**. Ramdump binaries are large; reading them into the report would blow the `MAX_BYTES` cap (307 200 bytes) and inject binary content that the byte sanitizer would mangle. `ls -la` metadata (timestamps + file sizes) is all that is needed to count and date crashes.

#### `pstore`

Lists `/sys/fs/pstore/` and reads `/sys/module/pstore/parameters/backend`.

**Why:** pstore is the kernel mechanism for persisting crash records (oops, panics) across a reboot. On affected RM551E builds, only `pmsg` is wired into ramoops — AP panics are therefore not captured. This section surfaces that firmware gap explicitly: if `backend` shows `ramoops` and the pstore directory is empty after a suspected AP panic, the crash was not recorded.

### Byte Sanitizer

Every section passes through `tr -cd '\11\12\40-\176'` which strips every byte that is not TAB (0x09), LF (0x0A), or printable ASCII (0x20–0x7E). This makes the report safe for embedding verbatim in a `jq --rawfile` JSON envelope and eliminates terminal escape sequences from log lines.

> ℹ️ NOTE: The sanitizer is byte-oriented — it works on raw byte values. It does **not** understand multi-byte UTF-8 sequences and will strip the high bytes of any non-ASCII character. All practical log content is ASCII, so this is intentional rather than a bug.

### Size Cap and Head+Tail Trim

After assembling the full report, the daemon checks its byte count against `MAX_BYTES = 307200` (~300 KB). If the report is larger, it is trimmed: the first 400 lines and last 400 lines are kept, and the middle is replaced with a `[TRIMMED: … middle N lines omitted]` marker. This keeps both the report header (version, system state) and the most-recent log tails, which contain the context most relevant to a fresh incident.

> ⚠️ WARNING: The 400-line head/tail values are hardcoded in the daemon. If you change the section order or add very large sections, verify that the most diagnostic content still falls within the kept bands.

### Self-Prune to Three Reports

After writing the artifact, the daemon lists all `/tmp/qmanager_debug_*.txt` files sorted newest-first and removes every file past the third. The freshly written file is always newest and always survives.

### UCI Redaction

The daemon emits `uci show quecmanager` (not `uci show qmanager` — the UCI config name is `quecmanager`) with secret-bearing option values masked. Redaction is implemented as a pure BusyBox `case`-glob match — device `jq` has no regex, and `sed -E` is not relied on for correctness:

```
*password* | *passwd* | *secret* | *token* | *hash* | *salt* | *cookie*
*_key | *apikey* | *api_key* | *credential*
```

Any option whose name matches one of these globs has its value replaced with `[REDACTED]`. The key itself is still emitted so the section is readable. Everything else passes verbatim.

> ⚠️ WARNING: The glob list is an invariant — if you add a new sensitive UCI option under `quecmanager`, its key name **must** match one of the existing globs or you must extend the list. A key that doesn't match passes through with its value visible. The wrong UCI config name (`qmanager`) would silently produce an empty redaction section — always use `quecmanager`.

### Daemon Invariants Summary

- **Never touches the modem serial port.** No `qcmd`, no AT commands.
- **Never reboots or modifies any config.** Read-only data collection only.
- **qlog is optional.** The daemon guards `source /usr/lib/qmanager/qlog.sh` and stubs all log functions if the library is absent, so it runs in recovery contexts.
- **Last stdout line = artifact path.** All other stdout is informational. The CGI relies on this contract.
- **`modem_ssr_dumps` is listings-only.** The ramdump `.elf` files are never read into the report. See the section note above.
- **Depends on `ubus`.** The `watchdog_state` section calls `ubus call system watchdog`. `ubus` is an OpenWRT core binary present on all supported builds; it is not an optional add-on.

---

## Daemon–CGI Contract

The CGI captures all stdout from the daemon, strips blank lines, and reads the last non-empty line as the artifact path:

```sh
TOOL_OUT=$("$REPORT_TOOL" 2>/dev/null)
ARTIFACT=$(printf '%s\n' "$TOOL_OUT" | sed '/^$/d' | tail -n 1)
```

This means the daemon is free to emit progress or log lines to stdout as long as the artifact path is the absolute final line. Future changes to the daemon must preserve this invariant.

---

## CGI: `diagnostics.sh`

**Endpoint:** `POST /cgi-bin/quecmanager/system/diagnostics.sh`

Auth-gated via `cgi_base.sh` (enforced at source time). Only `POST` is accepted.

### Request

```json
{ "action": "capture" }
```

### Success Response

```json
{
  "success": true,
  "filename": "/tmp/qmanager_debug_1718300000.txt",
  "content": "===== QManager Debug Report =====\n..."
}
```

`filename` is the full path on the device. `content` is the plain-text report embedded as a JSON string via `jq --rawfile`; no base64 encoding. The frontend materializes `content` into a `text/plain` Blob and triggers a `<a download>` to save it locally.

### Error Codes

| Code | Meaning |
|---|---|
| `report_tool_missing` | `/usr/bin/qmanager_debug_report` is absent or not executable |
| `capture_failed` | Daemon ran but produced no artifact (no readable path on last stdout line) |
| `unknown_action` | `action` was not `"capture"` |
| `method_not_allowed` | Request method was not POST |

> ℹ️ NOTE: The `unauthorized` error is emitted by `cgi_base.sh` before the script body runs. It is not enumerated in `diagnostics.sh` itself but is possible on any auth-gated endpoint.

---

## CGI: `ipa_offload.sh`

**Endpoint:** `GET/POST /cgi-bin/quecmanager/system/ipa_offload.sh`

Auth-gated via `cgi_base.sh`. Manages only the boot-time enable state of `/etc/init.d/r8125_ioss.init` — the VENDOR init script for the Realtek 2.5G NIC hardware offload.

### Service Name Invariant

> ⚠️ WARNING: The init script is named **`r8125_ioss.init`**, not `rtl8125_ioss.init`. This matters because the CGI hard-codes the path `/etc/init.d/r8125_ioss.init`. Devices without this init script (SKUs using r8168_ioss or aqc_ioss, or modem builds without the NIC) return `available: false` — any change on those devices is a safe no-op, not a silent failure. Never substitute the community-forum name `rtl8125_ioss` — the `enable`/`disable` calls would target the wrong file.

### GET Response

```json
{ "success": true, "available": true, "enabled": true }
```

`available` is `true` only when `/etc/init.d/r8125_ioss.init` exists as a file. When `available` is `false`, `enabled` is always `false`.

The `enabled` field reflects **boot-enable state** (whether the service is symlinked into `/etc/rc.d/`), not runtime state (whether the module is loaded). After a toggle, the module remains loaded until the next reboot.

### POST Request

```json
{ "action": "enable" }
```

or

```json
{ "action": "disable" }
```

### POST Success Response

```json
{ "success": true, "enabled": true, "pending_reboot_required": true }
```

`pending_reboot_required` is always `true` because the `stop()` function in the VENDOR init script is a no-op — the IPA kernel module cannot be safely unloaded at runtime. The change takes effect only after the next reboot. The frontend hook is pessimistic: after a successful POST it re-fetches the authoritative GET state instead of flipping local state optimistically.

### Armed-on-Reboot Design

The CGI calls `$INIT enable` or `$INIT disable` — standard OpenWRT init.d subcommands that add or remove the `/etc/rc.d/S91r8125_ioss.init` boot symlink. It never calls `start`, `stop`, `insmod`, `rmmod`, or `reboot`. The rationale: forcibly unloading the NIC driver at runtime would drop all Ethernet traffic and kill the HTTP connection that is serving the toggle response.

The frontend uses `requestRebootLater("ipa_offload")` (via `lib/reboot/index.ts`, `RebootSource` member `"ipa_offload"`) to arm the deferred-reboot banner. The user sees the change is pending and can reboot when convenient.

### Error Codes

| Code | Meaning |
|---|---|
| `not_available` | `r8125_ioss.init` is absent — SKU does not have this NIC |
| `invalid_action` | `action` was not `"enable"` or `"disable"` |
| `method_not_allowed` | Request method was not GET or POST |

---

## Frontend Integration

### `useDiagnostics` (hooks/use-diagnostics.ts)

Action-only hook (no mount fetch). `capture()` posts `{"action":"capture"}`, receives `{filename, content}`, and immediately materializes the report as a `text/plain` Blob download via `createObjectURL → <a download> → revokeObjectURL`. This mirrors the config-backup download pattern. The hook exposes a `stage` field: `"idle" | "capturing" | "done" | "error"`.

### `useIpaOffload` (hooks/use-ipa-offload.ts)

Fetches current state on mount. The `setEnabled(bool)` toggle is **pessimistic**: it POSTs the action and then silently re-fetches authoritative state (via `fetchState(true)`) rather than flipping local state. This avoids a stale Switch state when the write partially fails or is gated by `available: false`. The component is responsible for calling `requestRebootLater("ipa_offload")` on success.

---

## qlog.sh Fix: AT-Command Log Mojibake

Related change shipped in this same feature. `scripts/usr/lib/qmanager/qlog.sh` (~line 203) previously collapsed newlines in AT command responses using `tr '\n' '↵'` — the UTF-8 right-arrow character (3 bytes: `\xe2\x86\xb5`). BusyBox `tr` is byte-oriented; it treated each of the 3 bytes as a separate single-byte replacement target, which caused stray `\xe2` bytes to appear in log lines whenever a multi-byte boundary coincided with a newline.

The fix replaces this with:

```sh
truncated=$(printf '%s' "$truncated" | tr '\n' ' ' | tr -d '\r')
```

A plain ASCII space replacement is always byte-safe. Logs captured **before** this fix may contain `\xe2` mojibake in AT-response lines; they are otherwise intact.

---

## Locale Status

The `diagnostics` and `ipa_offload` i18n namespaces in `public/locales/en/system-settings.json` are complete for English. Non-English locales (zh-CN, zh-TW, id, it, and others) do not yet have these keys — they will fall back to English strings until a locale backfill pass is done.
