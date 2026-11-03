# QManager Deployment Guide

This document covers building, installing, and deploying QManager to an OpenWRT device.

---

## Quick Install (Recommended)

Install directly from the latest GitHub pre-release on the OpenWRT device:

One-liner convenience (same verified flow):

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

Expanded direct flow:

```sh
set -e
REPO="dr-dolomite/QManager"
API="https://api.github.com/repos/${REPO}/releases?per_page=20"

JSON=$(uclient-fetch -qO- "$API" 2>/dev/null || wget -qO- "$API" 2>/dev/null || curl -fsSL "$API")
TAG=$(printf '%s' "$JSON" \
  | tr -d '\n' \
  | sed 's/},{/}\
{/g' \
  | sed -n '/"prerelease":[[:space:]]*true/{s/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p;q}')

[ -n "$TAG" ] || { echo "Failed to resolve latest pre-release tag"; exit 1; }

BASE="https://github.com/${REPO}/releases/download/${TAG}"
cd /tmp
wget -O qmanager.tar.gz "$BASE/qmanager.tar.gz"
wget -O sha256sum.txt "$BASE/sha256sum.txt"
sha256sum -c sha256sum.txt
tar xzf qmanager.tar.gz
sh /tmp/qmanager_install/install.sh
```

To pin a specific release, set `TAG` manually and skip the API lookup block.

The installer will:
- Install required packages (`jq`) and optional packages (`msmtp`, `tailscale`, `ethtool`)
- Backup the original `index.html` before replacing it
- Deploy frontend, backend scripts, CGI endpoints, and init.d services
- Fix any CRLF line endings
- Enable and start all services
- On a fresh interactive install, ask whether to serve QManager on ports other than 80 / 443 (Enter keeps the defaults; the OTA updater never asks, and an earlier choice is kept). Change it later with `qmanager_web_port set <http> <https>` or **System Settings → Device Access**; see [`features/web-port.md`](features/web-port.md)
- Prune any legacy daemons absent from the current release (e.g., `qmanager_wan_guard`, retired in v0.1.24 — the installer stops, disables, and removes the binary, init.d script, and any `/etc/rc.d/` symlinks on upgraded devices)

See `sh install.sh --help` for all options (`--frontend-only`, `--backend-only`, `--skip-packages`, `--uninstall`, etc.)

### Quick Uninstall

One-liner:

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh --uninstall
```

Expanded direct flow:

```sh
set -e
REPO="dr-dolomite/QManager"
API="https://api.github.com/repos/${REPO}/releases?per_page=20"

JSON=$(uclient-fetch -qO- "$API" 2>/dev/null || wget -qO- "$API" 2>/dev/null || curl -fsSL "$API")
TAG=$(printf '%s' "$JSON" \
  | tr -d '\n' \
  | sed 's/},{/}\
{/g' \
  | sed -n '/"prerelease":[[:space:]]*true/{s/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p;q}')

[ -n "$TAG" ] || { echo "Failed to resolve latest pre-release tag"; exit 1; }

BASE="https://github.com/${REPO}/releases/download/${TAG}"
cd /tmp
wget -O qmanager.tar.gz "$BASE/qmanager.tar.gz"
tar xzf qmanager.tar.gz
sh /tmp/qmanager_install/uninstall.sh
```

---

## Package Install (opkg feed)

QManager is also published as the `sdxpinn-qmanager` package in iamromulan's SDXPINN software feed. It installs the same files as the tarball installer, so the app behaves identically; only the owner of the files and the update path differ. Internals, the build and the release flow are in [`features/ipk-packaging.md`](features/ipk-packaging.md).

```sh
opkg update
opkg install sdxpinn-qmanager     # pulls in jq and sdxpinn-patch (>= 3.0) if missing
opkg upgrade sdxpinn-qmanager     # later releases
opkg remove sdxpinn-qmanager      # uninstall
```

The device needs `sdxpinn-patch` (it adds the `sdxpinn` package architecture) and the feed in its opkg config. `Conflicts`/`Replaces` cover `sdxpinn-quecmanager`, `sdxpinn-quecmanager-beta`, `sms-tool`, `socat-at-bridge`, `socat` and `websocat`.

| | Tarball installer | opkg package |
|---|---|---|
| Who copies the files | `install.sh` | opkg; `install.sh --configure` runs afterwards as the postinst |
| Dependencies | `install.sh` installs `jq` and prompts for optional packages | `Depends: sdxpinn-patch (>= 3.0), jq` |
| Updates | Software Update page (GitHub releases), or re-run the installer | `opkg upgrade`; the Software Update page shows a "Package install" state with no check or install controls |
| Web port prompt | Asked on a fresh interactive install | Never asked (opkg may own the terminal); set it later with `qmanager_web_port` |
| Reboot | Installer / OTA reboots | Never reboots; the app shows the deferred-reboot banner afterwards |
| LuCI `index.html` | Backed up to `index.html.old` and replaced | Same, done by the postinst; `opkg remove` puts it back |
| User config | `/etc/qmanager` and UCI kept across updates | Same across `opkg upgrade`. `opkg remove` keeps `/etc/qmanager`, the UCI `quecmanager` settings and the cron jobs, so a reinstall picks them back up |

### The two channels are mutually exclusive

While `/usr/lib/opkg/info/sdxpinn-qmanager.control` exists, `install.sh`, `uninstall.sh`, `qmanager_update`, `qmanager_auto_update` and the Software Update CGI refuse to act, because a tarball install over a package install would leave opkg's file list wrong. To switch to the tarball installer, remove the package first:

```sh
opkg remove sdxpinn-qmanager
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

`install.sh --ignore-package` and `uninstall.sh --ignore-package` bypass the guard for recovery when the package record is left in a broken state. Do not use them as a normal path.

### Building the package

```sh
bun run package:ipk    # next build + build.sh + ipk; writes qmanager-build/sdxpinn-qmanager_<version>_sdxpinn.ipk
bun run ipk            # ipk only, from an existing qmanager-build/qmanager.tar.gz
```

Requires Python 3.8+. The build is deterministic and ends with a structural check. To try a build on a device: `scp` the `.ipk` to `/tmp` and `opkg install /tmp/sdxpinn-qmanager_*.ipk`.

Publishing goes through the feed repo's CI (build and sign on merge); the PR rules and the versioning the feed enforces (always bump, never ship `-draft`/`-testN`) are in [`features/ipk-packaging.md`](features/ipk-packaging.md#releasing-to-the-feed).

---

## Prerequisites

### Development Machine

- [Bun](https://bun.sh/) — Package manager and runtime
- Git
- A text editor that preserves LF line endings (VS Code, Vim, etc.)

### Target Device

- OpenWRT router with:
  - Quectel modem (RM520N-GL, RM551E-GL, RM500Q, or similar)
  - AT command access via the modem's internal AT channel (`/dev/smd11` on the RM551E)
  - uhttpd web server (standard on OpenWRT)
  - BusyBox standard utilities
  - `jq` package installed (`opkg install jq`)
  - `msmtp` package (for email alerts feature) — optional
  - `ethtool` package (for ethernet link speed control) — optional
  - `tailscale` package (for VPN feature) — optional

---

## Building the Frontend

### Development Build

```bash
cd QManager
bun install
bun run dev
```

Opens at `http://localhost:3000`. API requests are proxied to `http://192.168.224.1` (the modem's IP).

To change the proxy target, edit `next.config.ts`:

```typescript
destination: "http://192.168.224.1/cgi-bin/:path*",
// or for Tailscale:
// destination: "http://your-device.ts.net/cgi-bin/:path*",
```

### Production Build

```bash
bun run build
```

To generate release artifacts (`qmanager-build/qmanager.tar.gz` + `qmanager-build/sha256sum.txt`):

```bash
bun run package
```

This produces a static export in the `out/` directory. The output is a complete, self-contained frontend that requires no server-side rendering.

**Important:** The `rewrites()` block in `next.config.ts` is only used in development. In production, the browser makes direct requests to the device's CGI endpoints.

### Build Output

```
out/
├── index.html          # Redirects to /dashboard/
├── dashboard/
│   └── index.html
├── login/
│   └── index.html
├── cellular/
│   ├── index.html
│   ├── settings/
│   ├── cell-locking/
│   ├── cell-scanner/
│   ├── custom-profiles/
│   └── sms/
├── local-network/
│   └── ...
├── monitoring/
│   └── ...
├── _next/
│   ├── static/         # JS bundles, CSS, fonts
│   └── ...
└── ...
```

---

## Deploying to OpenWRT

### Frontend Deployment

Copy the `out/` directory contents to the device's web root:

```bash
# From your development machine
scp -r out/* root@192.168.224.1:/www/
```

Or via SSH:

```bash
ssh root@192.168.224.1
# Clear old frontend files (be careful not to delete cgi-bin/)
rm -rf /www/_next /www/dashboard /www/cellular /www/monitoring /www/local-network
# Copy new files
scp -r out/* root@192.168.224.1:/www/
```

### Backend Deployment

Copy each script directory to its target location on the device:

```bash
# CGI endpoints
scp -r scripts/www/cgi-bin/quecmanager/* root@192.168.224.1:/www/cgi-bin/quecmanager/

# Shared libraries
scp scripts/usr/lib/qmanager/* root@192.168.224.1:/usr/lib/qmanager/

# Daemons and utilities
scp scripts/usr/bin/* root@192.168.224.1:/usr/bin/

# Init.d services
scp scripts/etc/init.d/* root@192.168.224.1:/etc/init.d/
```

### Setting Permissions

```bash
ssh root@192.168.224.1

# Make daemons executable
chmod +x /usr/bin/qcmd
chmod +x /usr/bin/qmanager_*

# Make CGI scripts executable
find /www/cgi-bin/quecmanager -name "*.sh" -exec chmod +x {} \;

# Make init.d scripts executable
chmod +x /etc/init.d/qmanager*

# Libraries should be readable (sourced, not executed)
chmod 644 /usr/lib/qmanager/*.sh

# Create config directory
mkdir -p /etc/qmanager/profiles
```

### Enabling Services

```bash
# Enable and start the main service
/etc/init.d/qmanager enable
/etc/init.d/qmanager start

# Enable boot services
/etc/init.d/qmanager_eth_link enable
/etc/init.d/qmanager_ttl enable
/etc/init.d/qmanager_mtu enable
/etc/init.d/qmanager_imei_check enable
```

### Verifying Installation

```bash
# Check main processes are running
ps | grep qmanager

# Check the poller is producing data
cat /tmp/qmanager_status.json | jq .timestamp

# Check CGI endpoints are accessible (add :<port> if you moved the web port)
curl http://localhost/cgi-bin/quecmanager/at_cmd/fetch_data.sh

# Check which ports the web server is on
qmanager_web_port

# Check logs
cat /tmp/qmanager.log | tail -20
```

---

## Directory Structure on Device

```
/www/
├── index.html              # Frontend entry point
├── _next/                  # Frontend assets (JS, CSS, fonts)
├── dashboard/              # Frontend pages
├── cellular/
├── monitoring/
├── local-network/
├── login/
├── about-device/
├── support/
└── cgi-bin/
    └── quecmanager/        # CGI API endpoints
        ├── auth/
        ├── at_cmd/
        ├── bands/
        ├── cellular/
        ├── device/
        ├── frequency/
        ├── monitoring/
        ├── network/
        ├── profiles/
        ├── scenarios/
        ├── system/
        ├── tower/
        └── vpn/

/usr/bin/
├── qcmd                    # AT command wrapper
├── qmanager_poller         # Main data collector
├── qmanager_ping           # Ping daemon
├── qmanager_watchcat       # Connection watchdog
├── qmanager_profile_apply  # Profile apply daemon
├── qmanager_cell_scanner   # Cell scanner
├── qmanager_neighbour_scanner
├── qmanager_band_failover
├── qmanager_tower_failover
├── qmanager_tower_schedule
├── qmanager_mtu_apply
├── qmanager_imei_check
├── qmanager_reset_password
└── qmanager_logread

/usr/lib/qmanager/
├── cgi_base.sh             # CGI boilerplate
├── cgi_auth.sh             # Session management
├── cgi_at.sh               # AT command helpers
├── qlog.sh                 # Logging library
├── parse_at.sh             # AT response parsers
├── events.sh               # Event detection
├── profile_mgr.sh          # Profile CRUD
├── tower_lock_mgr.sh       # Tower lock management
├── email_alerts.sh         # Email channel transport (downtime detection lives in alert_engine.sh)
└── ethtool_helper.sh       # Ethernet helpers

/etc/init.d/
├── qmanager               # Main service
├── qmanager_eth_link      # Ethernet link speed
├── qmanager_ttl           # TTL/HL rules
├── qmanager_mtu           # MTU daemon
├── qmanager_imei_check    # IMEI backup check
└── qmanager_tower_failover # Tower failover

/etc/qmanager/             # Persistent configuration
├── shadow                 # Password hash
├── profiles/              # Custom SIM profiles
├── tower_lock.json
├── band_lock.json
├── imei_backup.json
├── last_iccid
└── msmtprc                # Email SMTP config

/tmp/                      # Runtime state (lost on reboot)
├── qmanager_status.json
├── qmanager_signal_history.json
├── qmanager_ping_history.json
├── qmanager_events.json
├── qmanager_ping.json
├── qmanager_watchcat.json
├── qmanager_sessions/
└── qmanager.log
```

---

## Line Ending Enforcement

**Critical:** All shell scripts must have LF line endings. CRLF breaks scripts silently on OpenWRT.

### Prevention

The `.gitattributes` file enforces LF:
```
scripts/**/*.sh text eol=lf
scripts/etc/init.d/* text eol=lf
scripts/usr/bin/* text eol=lf
```

### Checking

```bash
# Check for CRLF in scripts
file scripts/usr/bin/* | grep CRLF
file scripts/etc/init.d/* | grep CRLF
find scripts -name "*.sh" -exec file {} \; | grep CRLF
```

### Fixing

```bash
# Convert CRLF to LF
sed -i 's/\r$//' scripts/usr/bin/*
sed -i 's/\r$//' scripts/etc/init.d/*
find scripts -name "*.sh" -exec sed -i 's/\r$//' {} \;
```

---

## Troubleshooting

### CGI Returns Empty Response

1. **Check line endings** — CRLF is the #1 cause of silent CGI failures
2. **Check permissions** — CGI scripts need `chmod +x`
3. **Check syntax** — Run `sh -n /www/cgi-bin/quecmanager/<script>.sh`
4. **Check logs** — `cat /tmp/qmanager.log | tail -50`

### Poller Not Producing Data

```bash
# Check if poller is running
ps | grep qmanager_poller

# Check if modem serial port is accessible
ls -la /dev/smd11  # QManager's AT channel on the RM551E

# Test AT command
qcmd 'AT+QENG="servingcell"'

# Check poller logs
grep "poller" /tmp/qmanager.log
```

### Authentication Issues

```bash
# Reset password (run on device)
/usr/bin/qmanager_reset_password

# Check session directory
ls /tmp/qmanager_sessions/

# Check auth file
ls -la /etc/qmanager/auth.json
```

### Service Won't Start

```bash
# Check init.d script
/etc/init.d/qmanager start
cat /tmp/qmanager.log

# Verify dependencies
which jq        # Required
which qcmd      # Required
which msmtp     # Optional (email only)
which ethtool   # Optional (ethernet only)
```

---

## Updating

### Frontend Only

```bash
bun run build
scp -r out/* root@192.168.224.1:/www/
```

### Backend Only

```bash
# Stop services
ssh root@192.168.224.1 '/etc/init.d/qmanager stop'

# Deploy updated scripts
scp -r scripts/usr/bin/* root@192.168.224.1:/usr/bin/
scp -r scripts/usr/lib/qmanager/* root@192.168.224.1:/usr/lib/qmanager/
scp -r scripts/www/cgi-bin/quecmanager/* root@192.168.224.1:/www/cgi-bin/quecmanager/
scp -r scripts/etc/init.d/* root@192.168.224.1:/etc/init.d/

# Set permissions and restart
ssh root@192.168.224.1 'chmod +x /usr/bin/qmanager_* /usr/bin/qcmd && find /www/cgi-bin/quecmanager -name "*.sh" -exec chmod +x {} \; && /etc/init.d/qmanager start'
```

> ℹ️ NOTE: The manual deploy steps in this section are for development against a tarball-style install. On a package install, update with `opkg upgrade sdxpinn-qmanager` (see [Package Install](#package-install-opkg-feed)).

### Full Update

Combine both frontend and backend steps above, then restart:

```bash
ssh root@192.168.224.1 'reboot'
```
