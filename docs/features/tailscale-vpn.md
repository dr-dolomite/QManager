# Tailscale VPN

QManager provides a first-class Tailscale integration that installs, connects, and manages the Tailscale daemon entirely from the monitoring UI. Because the modem runs OpenWRT/BusyBox with constrained overlay storage, the feature supports two install variants — an official static-tarball build and a lightweight opkg package — each with its own lifecycle. The CGI is a thin control layer over `tailscale`/`tailscaled`; it does not own Tailscale's config beyond the UCI boot-enable flag and the install-method marker.

---

## Quick Reference

| Item | Value |
|---|---|
| CGI script | `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh` |
| Install path | `/www/cgi-bin/quecmanager/vpn/tailscale.sh` |
| Endpoint | `GET/POST /cgi-bin/quecmanager/vpn/tailscale.sh` |
| Install marker | `/etc/tailscale/.qm_install_method` (`official` or `tiny`) |
| Tailscale state | `/etc/tailscale/tailscaled.state` |
| Install progress | `/tmp/qmanager_tailscale_install.json` |
| Install PID | `/tmp/qmanager_tailscale_install.pid` |
| Auth URL cache | `/tmp/qmanager_tailscale_auth_url` |
| `tailscale up` PID | `/tmp/qmanager_tailscale_up_pid` |
| `tailscale up` output | `/tmp/qmanager_tailscale_up_output` |
| Migration lock | `/var/lock/qmanager_tailscale_migrate.lock` |
| UCI key (boot enable) | `tailscale.settings.service_enabled` (`0`/`1`) |
| init.d script | `/etc/init.d/tailscale` (written by official installer; opkg-owned for tiny) |
| Reboot? | No |
| Hook | `hooks/use-tailscale.ts` |
| Frontend component | `components/monitoring/tailscale/tailscale-connection-card.tsx` |
| i18n namespace | `tailscale.*` (`monitoring.json` — EN seeded; other locales need backfill) |

---

## Endpoint Contract

### GET `/cgi-bin/quecmanager/vpn/tailscale.sh`

Returns a tiered response depending on install and daemon state.

**Tier 1 — Not installed:**

```json
{
  "success": true,
  "installed": false,
  "install_hint": "opkg update && opkg install tailscale-tiny",
  "install_variants": ["official", "tiny"],
  "other_vpn_installed": false,
  "other_vpn_name": "NetBird"
}
```

**Tier 2 — Installed, daemon not running:**

```json
{
  "success": true,
  "installed": true,
  "daemon_running": false,
  "enabled_on_boot": false,
  "version": "1.98.4",
  "install_variant": "official",
  "other_vpn_installed": false,
  "other_vpn_name": "NetBird"
}
```

**Tier 3 — Daemon running (full status):**

```json
{
  "success": true,
  "installed": true,
  "daemon_running": true,
  "enabled_on_boot": true,
  "version": "1.98.4",
  "install_variant": "official",
  "backend_state": "Running",
  "exit_node_advertised": false,
  "auth_url": "",
  "self": {
    "hostname": "rm551e",
    "dns_name": "rm551e.tail1234.ts.net.",
    "tailscale_ips": ["100.x.y.z"],
    "online": true,
    "os": "linux",
    "relay": "sfo"
  },
  "tailnet": {
    "name": "example.com",
    "magic_dns_suffix": "tail1234.ts.net",
    "magic_dns_enabled": true
  },
  "peers": [
    {
      "hostname": "laptop",
      "dns_name": "laptop.tail1234.ts.net.",
      "tailscale_ips": ["100.a.b.c"],
      "os": "windows",
      "online": true,
      "last_seen": "",
      "relay": "sfo",
      "exit_node": false
    }
  ],
  "health": [],
  "other_vpn_installed": false,
  "other_vpn_name": "NetBird"
}
```

- `install_variant` — `"official"` (tarball), `"tiny"` (opkg), or `"opkg"` (pre-marker legacy detection). The marker file `/etc/tailscale/.qm_install_method` is authoritative; opkg detection is the fallback for installs that predate the marker.
- `exit_node_advertised` — derived from `.Self.ExitNodeOption` in `tailscale status --json`. `true` means `--advertise-exit-node` is set on the local prefs.
- `backend_state` — raw string from Tailscale's `BackendState` field (`"Running"`, `"NeedsLogin"`, `"Stopped"`, etc.).
- `health` — array of Tailscale health-warning strings. IP-forwarding warnings appear here when exit-node advertising is enabled but the kernel hasn't forwarded.
- `auth_url` — populated from the `tailscale up --json` output stream while authenticating; persisted to `/tmp/qmanager_tailscale_auth_url` and returned until `BackendState == Running`.

### POST `/cgi-bin/quecmanager/vpn/tailscale.sh`

All POST bodies are JSON. All actions check `check_migration_lock()` first — if `/var/lock/qmanager_tailscale_migrate.lock` exists the action is refused with `migration_in_progress`.

#### action: `install`

Spawns the installer in a background subshell. Returns immediately; poll `install_status` for progress.

**Request:**

```json
{ "action": "install", "variant": "official" }
```

- `variant` — `"official"` or `"tiny"`. Absent → defaults to `"tiny"` (backward compatibility with older clients). Invalid → `invalid_variant`.

**Response on spawn:**

```json
{ "success": true }
```

**Error codes:**

| Code | Meaning |
|---|---|
| `invalid_variant` | `variant` present but not `"official"` or `"tiny"` |
| `other_vpn_installed` | NetBird is installed — must uninstall it first |
| `already_running` | Install subshell already in progress |
| `already_installed` | Tailscale binaries already present |

**Install progress** (`install_status` poll target — `/tmp/qmanager_tailscale_install.json`):

```json
{ "success": true, "status": "running", "message": "Downloading Tailscale 1.98.4..." }
```

Terminal (success):

```json
{ "success": true, "status": "complete", "message": "Tailscale 1.98.4 installed successfully", "variant": "official" }
```

Terminal (failure):

```json
{ "success": false, "status": "error", "message": "Not enough space in /tmp", "detail": "Need ~100MB free to download Tailscale" }
```

`status` values: `"idle"` (file absent), `"running"`, `"complete"`, `"error"`.

#### action: `install_status`

Returns the contents of `/tmp/qmanager_tailscale_install.json` (or `{"success":true,"status":"idle"}` if the file is absent). No additional fields.

#### action: `connect`

Ensures the daemon is running, then launches `tailscale up --accept-dns=false --json` as an orphaned background job. Polls the output file for up to 10 seconds. Returns the auth URL if one appears, or confirms already-authenticated.

**Response (auth URL available):**

```json
{ "success": true, "auth_url": "https://login.tailscale.com/a/..." }
```

**Response (already authenticated):**

```json
{ "success": true, "already_authenticated": true }
```

**Error codes:**

| Code | Meaning |
|---|---|
| `daemon_start_failed` | Daemon could not be started within 5s |
| `auth_timeout` | No auth URL appeared within 10s |

#### action: `disconnect`

Runs `tailscale down`. Device stays registered in the tailnet.

#### action: `logout`

Runs `tailscale logout`. Device is removed from the tailnet.

#### action: `start_service`

Starts `tailscaled` via init.d (or direct `tailscaled` invocation as fallback).

**Error codes:** `already_running`, `start_failed`.

#### action: `stop_service`

Stops `tailscaled`. Kills any in-flight `tailscale up` process first.

#### action: `set_boot_enabled`

Toggles the `tailscale.settings.service_enabled` UCI flag and calls `/etc/init.d/tailscale enable|disable`.

**Request:**

```json
{ "action": "set_boot_enabled", "enabled": true }
```

**Error codes:** `missing_field`, `no_init_script`, `invalid_value`.

#### action: `set_exit_node`

Enables or disables exit-node advertising on the local node. Only works when Tailscale is connected (`BackendState == "Running"`).

**Request:**

```json
{ "action": "set_exit_node", "enabled": true }
```

Applies `tailscale set --advertise-exit-node=<bool>`. Uses `tailscale set`, NOT `tailscale up` — `tailscale up` resets every preference that is not explicitly passed, which would clobber `--accept-dns=false` and any other live prefs.

**Error codes:**

| Code | Meaning |
|---|---|
| `missing_field` | `enabled` absent |
| `invalid_value` | `enabled` not a boolean |
| `not_connected` | Daemon not running, or `BackendState != "Running"` |
| `set_failed` | `tailscale set` exited non-zero |

> ℹ️ NOTE: Advertising an exit node does not make peers route through it immediately. The user must also approve the node in the Tailscale admin console. IP-forwarding warnings from the kernel appear in the `health` array of the GET response until the kernel is configured.

#### action: `uninstall`

Stops and removes Tailscale. Method-aware: the official (tarball) path removes binaries, the heredoc-written init.d script, rc.d symlinks, the UCI section, and `/etc/config/tailscale`. The opkg path does a smart 6-package removal.

**Error codes:** `uninstall_failed` (binary still present after removal).

---

## Install Variants

### Official (static tarball)

1. Resolves latest stable version from `https://pkgs.tailscale.com/stable/?mode=json` — reads `.Tarballs.arm64` and `.Version` using plain jq key access (no regex; device jq has no Oniguruma).
2. Guards `/tmp` for ≥ 100 MB free (`df -k`, integer arithmetic).
3. `curl`-downloads the arm64 tarball to `/tmp/qm_tailscale_dl.tgz`.
4. Extracts with `tar -xzf`; falls back to `gzip -dc | tar -x` if the BusyBox `tar` applet lacks `-z`.
5. Guards `/overlay` for ≥ 80 MB free before copying binaries.
6. Copies `tailscale` and `tailscaled` to `/usr/bin/`.
7. Writes `/etc/init.d/tailscale` via heredoc (`write_ts_initd`).
8. Writes marker: `printf 'official\n' > /etc/tailscale/.qm_install_method`.
9. Seeds `tailscale.settings.service_enabled = 0` via `seed_ts_uci_settings` (idempotent).
10. Cleans up `/tmp` artifacts.

The procd init script is written by heredoc from the CGI — it is **never** shipped as a static file under `scripts/etc/init.d/` (see Invariant #3 below).

### Tiny (opkg)

1. `opkg update`.
2. `opkg install tailscale-tiny`.
3. Seeds `tailscale.settings.service_enabled` (defensive — package may already ship the section).
4. Writes marker: `tiny`.

---

## Key Invariants

### 1. `tailscale up` must be double-forked

`tailscale up` is run with:

```sh
( tailscale up --accept-dns=false --json </dev/null >"$TS_UP_OUTPUT" 2>&1 &
  echo $! > "$TS_UP_PID_FILE"
)
```

A simple `( cmd ) &` without stdin redirection keeps the process in the CGI's process group. When uhttpd closes the HTTP connection it sends SIGHUP/SIGPIPE to the group, killing `tailscale up` before it can push post-auth prefs to `tailscaled`. The result is the device appears "registered but disconnected" in the admin console until the user stops/starts the service and re-authenticates. The double-fork (inner `&` + `</dev/null`) orphans the process to init, guaranteeing it survives the CGI exiting.

### 2. `--accept-routes` and `--advertise-routes` are permanently banned

`tailscale up --accept-routes` causes the device to accept every route advertised by every peer in the tailnet. On this hardware, accepting routes disconnects the device from the network entirely and requires a **physical reboot** to recover — there is no software way back. The flag is banned by design and is never passed, even as an opt-in. `--advertise-routes` is similarly banned; use `set_exit_node` for controlled exit-node advertising.

### 3. The init.d script must never be shipped as a static file

The official tarball ships no init.d script. The CGI writes `/etc/init.d/tailscale` via heredoc (`write_ts_initd`). This file must NOT be placed under `scripts/etc/init.d/tailscale` in the repo.

**Why:** `scripts/install.sh` force-copies every file under `scripts/etc/init.d/` to the device on every install and OTA upgrade. If a static `scripts/etc/init.d/tailscale` existed, it would be copied unconditionally — clobbering the opkg-owned `/etc/init.d/tailscale` of a tiny install and breaking its daemon management. Keeping the init script in the heredoc ensures it is only written on the official variant path.

### 4. `uci delete` + `uci commit` does NOT remove the config file

On this device, `uci -q delete tailscale && uci -q commit tailscale` removes the in-memory section and flushes it, but `/etc/config/tailscale` persists on disk. On the next `uci get tailscale.*`, UCI re-reads the file and the section is back — it resurrects. The uninstall path (both `tailscale.sh` and `uninstall.sh`) therefore always follows the UCI delete with an explicit `rm -f /etc/config/tailscale`.

This quirk is a known OpenWRT/UCI behavior and is not specific to Tailscale. See also [`docs/reference/busybox-shell-quirks.md`](../reference/busybox-shell-quirks.md) for the full BusyBox/deploy quirk catalog.

### 5. Marker file is the authoritative install-method detector

`get_install_variant()` reads `/etc/tailscale/.qm_install_method` first. If the file is absent (pre-marker installs), it falls back to `opkg list-installed | grep tailscale-tiny`. This fallback reports `"opkg"` (not `"tiny"`) for any other opkg-managed tailscale, distinguishing legacy luci-wrapper installs from the current tiny package.

### 6. Migration lock guards concurrent operations

`/var/lock/qmanager_tailscale_migrate.lock` is set by `migrate_tailscale_packages` in `install.sh` while an opkg package migration is running. All mutating POST actions check this lock and return `migration_in_progress` if held. The lock file uses `set -C` (noclobber) for atomic creation and is `trap`-cleaned on EXIT/INT/TERM.

### 7. `migrate_tailscale_packages` skips official installs entirely

`install.sh`'s `migrate_tailscale_packages` reads the marker file early and returns immediately if the value is `official`. An official tarball install has no opkg entry — trying to `opkg remove` it would fail or do nothing, and the migration logic is irrelevant.

### 8. Boot-enable UCI key is the authoritative flag

`tailscale.settings.service_enabled` is seeded on both install paths for symmetry. `get_boot_enabled()` reads it first; the `/etc/init.d/tailscale enabled` check is the fallback only when the UCI section is absent. Writing both (UCI + `init.d enable/disable`) keeps them in sync.

---

## Apply Flow — Official Install

```
POST { action:"install", variant:"official" }
  ↓
check_migration_lock → refuse if locked
check other_vpn_installed (NetBird) → refuse if present
is_installed → refuse if already installed
  ↓
Spawn background subshell (orphaned, no stdout):
  1. df -k /tmp  → guard ≥100MB
  2. curl pkgs.tailscale.com/stable/?mode=json → resolve tarball filename + version
     (plain jq key access — no regex)
  3. curl download arm64 tarball → /tmp/qm_tailscale_dl.tgz
  4. tar -xzf (gzip -dc | tar -x fallback)
  5. df -k /overlay → guard ≥80MB
  6. cp tailscale tailscaled → /usr/bin/; chmod 755
  7. write_ts_initd → /etc/init.d/tailscale (heredoc, chmod 755)
  8. printf 'official\n' → /etc/tailscale/.qm_install_method
  9. seed_ts_uci_settings (idempotent)
  10. rm -rf /tmp/qm_tailscale_dl.tgz /tmp/qm_tailscale_extract
  ↓
Each phase writes {"success":true,"status":"running","message":"..."} to
  /tmp/qmanager_tailscale_install.json
Terminal: {"success":true,"status":"complete","variant":"official",...}
         or {"success":false,"status":"error",...}
  ↓
Frontend polls POST { action:"install_status" } every ~2s until status ∈ {complete,error}
```

---

## Apply Flow — Exit Node

```
POST { action:"set_exit_node", enabled: true }
  ↓
check_migration_lock
is_installed → not_installed if false
is_daemon_running → not_connected if false
tailscale status --json → BackendState must be "Running" → not_connected otherwise
  ↓
tailscale set --advertise-exit-node=true
  → set_failed on non-zero exit
  ↓
{ "success": true }
```

---

## Uninstall Flow

```
POST { action:"uninstall" }
  ↓
check_migration_lock
is_daemon_running → stop daemon (init.d stop or killall tailscaled)
/etc/init.d/tailscale disable  (if init script present)
  ↓
get_install_variant == "official" ?
  YES:
    rm /usr/bin/tailscale /usr/bin/tailscaled /etc/init.d/tailscale
    rm /etc/rc.d/*tailscale
    uci delete tailscale; uci commit tailscale
    rm -f /etc/config/tailscale    ← explicit: uci delete alone does not remove the file
    rm -rf /etc/tailscale /var/lib/tailscale
  NO (opkg path):
    enumerate installed from {tailscale,tailscaled,tailscale-tiny,
      luci-app-tailscale,luci-app-tailscale-community,
      luci-app-tailscale-community-tiny}
    opkg remove <present packages>
  ↓
hash -r (flush command cache)
verify no binary at /usr/bin/tailscale, /usr/sbin/tailscale, /usr/sbin/tailscaled
  → uninstall_failed if any remain
  ↓
{ "success": true }
```

---

## Lifecycle Scripts

### `scripts/install.sh`

- `migrate_tailscale_firewall_zone()` — removes the legacy fw4 tailscale zone unconditionally (idempotent; skipped when `quecmanager.tailscale_workarounds.enabled=1`).
- `migrate_tailscale_packages()` — migrates legacy opkg tailscale packages to `tailscale-tiny`. Reads the marker file first; returns immediately (no-op) when marker = `official`. Lock-protected (`/var/lock/qmanager_tailscale_migrate.lock`, noclobber + EXIT trap). Preserves node identity by copying `tailscaled.state` before removing legacy packages.

### `scripts/uninstall.sh`

`remove_backend()` has an official-variant branch: reads the marker, stops and disables the service, removes binaries + init.d + rc.d + UCI section + `/etc/config/tailscale` + `/etc/tailscale/` + `/var/lib/tailscale/`.

---

## Frontend Files

| File | Purpose |
|---|---|
| `hooks/use-tailscale.ts` | Fetch + action hook. Adaptive polling: 10 s normal, 3 s during auth wait. Exports `runInstall(variant)`, `setExitNodeAdvertised(enabled)`, `isTogglingExitNode`. |
| `components/monitoring/tailscale/tailscale-connection-card.tsx` | Connection card. Not-installed state: `RadioGroup` variant picker (two bordered rows, default Official) + manual `CopyableCommand` shown only when Tiny is selected. Installed states: variant shown as plain muted text in `CardDescription`. Connected state: "Advertise as exit node" `Switch` row. |
| `components/monitoring/tailscale/tailscale-peers-card.tsx` | Peer list. |
| `components/monitoring/tailscale/tailscale.tsx` | Page root; assembles cards. |
| `components/ui/radio-group.tsx` | shadcn `RadioGroup` wrapper (added for the variant picker — was previously missing). |

---

## i18n

Namespace: `monitoring.json` key prefix `tailscale.*`.

New keys added in this release (EN only; **other locales need backfill**):

| Key | Usage |
|---|---|
| `tailscale.choose_variant_label` | Label above the variant `RadioGroup` |
| `tailscale.variant_official_title` | Official variant radio label |
| `tailscale.variant_official_description` | Official variant description |
| `tailscale.variant_official_short` | Short label (badge/muted text in installed state) |
| `tailscale.variant_tiny_title` | Tiny variant radio label |
| `tailscale.variant_tiny_description` | Tiny variant description |
| `tailscale.variant_tiny_short` | Short label (badge/muted text in installed state) |
| `tailscale.exit_node_label` | "Advertise as exit node" switch label |
| `tailscale.exit_node_description` | Description below the switch |

> ⚠️ WARNING: `zh-CN`, `zh-TW`, `it`, and `id` locales do not have these 9 keys. The UI falls back to the EN string, but a full i18n sweep is needed before the next stable release.

---

## Gotchas

- **`tailscale up` orphan requirement.** If `tailscale up` is not double-forked (`</dev/null` + inner `&`), uhttpd kills it when the HTTP connection closes, leaving the device in a "registered but disconnected" state requiring a stop/start + re-auth cycle.
- **`--accept-routes` is destructive.** Never pass it. There is no software recovery path on this hardware — only a physical reboot restores network connectivity.
- **`tailscale set` vs `tailscale up` for pref changes.** `tailscale up` resets every preference not explicitly passed. Use `tailscale set` for targeted preference changes like exit-node advertising, so `--accept-dns=false` and other live prefs are preserved.
- **UCI delete leaves the config file.** `uci delete tailscale && uci commit tailscale` removes the section from uci's in-memory map but the `/etc/config/tailscale` file persists. The next `uci get` re-reads it and the section reappears. Always follow UCI delete with `rm -f /etc/config/tailscale` during uninstall.
- **No static init.d file in the repo.** `scripts/install.sh` force-copies all files under `scripts/etc/init.d/` on every install. A static `tailscale` init script would clobber the opkg-owned one on tiny installs. The official variant writes it via heredoc only.
- **Device jq has no regex.** Version resolution from `pkgs.tailscale.com` uses plain key access (`.Tarballs.arm64`, `.Version`) — no `test()`, `match()`, or `sub()`. See [`docs/reference/busybox-shell-quirks.md`](../reference/busybox-shell-quirks.md).
- **Exit-node advertising requires admin console approval.** Setting `--advertise-exit-node=true` does not make peers route through the device. The node must be approved in the Tailscale admin console. IP-forwarding warnings surface in the `health` array until the kernel is configured.
- **`timeout` command may be absent.** `tailscale status --json` calls are guarded with `command -v timeout` and fall back to direct calls when `timeout` is not in the path.
