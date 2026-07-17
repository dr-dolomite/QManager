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

## Prerequisites

### Development Machine

- [Bun](https://bun.sh/) — Package manager and runtime
- Git
- A text editor that preserves LF line endings (VS Code, Vim, etc.)

### Target Device

- OpenWRT router with:
  - Quectel modem (RM520N-GL, RM551E-GL, RM500Q, or similar)
  - AT command access via serial port (`/dev/smd7` or similar)
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

# Check CGI endpoints are accessible
curl http://localhost/cgi-bin/quecmanager/at_cmd/fetch_data.sh

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
ls -la /dev/smd7  # or /dev/ttyUSB2

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

### Full Update

Combine both frontend and backend steps above, then restart:

```bash
ssh root@192.168.224.1 'reboot'
```
