# QManager

[English](./README.en.md) | [Italiano](./README.it.md)

<div align="center">
  <img src="public/qmanager-logo.svg" alt="QManager Logo" width="120" />
  <h3>A modern, custom GUI for Quectel modem management</h3>
  <p>Visualize, configure, and optimize your cellular modem's performance with an intuitive web interface</p>

  ![Version](https://img.shields.io/badge/version-v0.1.35-blue?style=flat-square)
  ![License](https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-green?style=flat-square)
  ![Platform](https://img.shields.io/badge/platform-OpenWRT-orange?style=flat-square)
  ![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square)
  ![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square)

  ---

  ### 🌐 Select Language / Pilih Bahasa

  | Language | Link |
  |----------|------|
  | 🇬🇧 English | [README.en.md](README.en.md) |
  | 🇮🇩 Bahasa Indonesia | [README.id.md](README.id.md) |

</div>

---

> **Note:** QManager is the successor to [SimpleAdmin](https://github.com/dr-dolomite/simpleadmin-mockup), rebuilt from the ground up with a modern tech stack and improved user experience for managing the Quectel RM551E-GL. The RM520N-GL has its own repository, [QManager-RM520N](https://github.com/dr-dolomite/QManager-RM520N).

---

## Features

### Signal & Network Monitoring
- **Live Signal Dashboard** — Real-time RSRP, RSRQ, SINR with per-antenna values (4x4 MIMO) and 30-minute historical charts
- **Network Events** — Automatic detection of band changes, cell handoffs, carrier aggregation changes, and connectivity events
- **Latency Monitoring** — Real-time ping with 24-hour history, jitter, packet loss, and aggregated views (hourly/12h/daily)
- **Traffic Statistics** — Cumulative data usage

### Cellular Configuration
- **Band Locking** — Select and lock specific LTE/NR bands for optimal performance
- **Tower Locking** — Lock to a specific cell tower by PCI, with automatic failover and scheduled changes
- **Frequency Locking** — Lock to exact EARFCN/ARFCN channels
- **APN Management** — Create, edit, delete APN profiles with MNO presets (T-Mobile, AT&T, Verizon, etc.)
- **Custom SIM Profiles** — Save complete configurations (APN + TTL/HL + optional IMEI) and apply with one click
- **Connection Scenarios** — Save and restore full network configuration snapshots
- **Network Priority** — Configure preferred network types and selection modes
- **Cell Scanner** — Active and neighbor cell scanning with signal comparison
- **Frequency Calculator** — EARFCN/ARFCN to frequency conversion tool
- **SMS Center** — Send and receive SMS messages directly from the interface
- **IMEI Settings** — Read, backup, and modify device IMEI
- **IMEI Toolkit** — Generate and validate IMEI values with TAC presets, Luhn checks, and quick copy/lookup tools
- **FPLMN Management** — View and manage the Forbidden PLMN list
- **MBN Configuration** — Select and activate modem broadband configuration files

### Network Settings
- **Ethernet Link Speed** — Control and monitor link speed, duplex, and auto-negotiation
- **TTL/HL Settings** — IPv4 TTL and IPv6 Hop Limit configuration (iptables-based)
- **MTU Configuration** — Dynamic MTU application for rmnet interfaces
- **IP Passthrough** — Direct IP assignment to downstream devices
- **Custom DNS** — DNS server override
- **Video Optimizer** — DPI-based video streaming optimization using nfqws (TCP SNI split + QUIC desync with configurable CDN hostlist)
- **Traffic Masquerade** — SNI spoofing via fake TLS ClientHello to bypass carrier traffic shaping (mutually exclusive with Video Optimizer)

### Reliability & Monitoring

- **Connection Watchdog** — 4-tier auto-recovery: ifup → CFUN toggle → SIM failover → full reboot (with token bucket rate limiting)
- **Email Alerts** — Downtime notifications via Gmail SMTP (msmtp), sent on recovery with duration details
- **SMS Alerts** — Downtime notifications by SMS, sent during active outages once threshold is exceeded
- **WAN Interface Guard** — Automatically disables phantom WAN profiles to prevent netifd CPU-wasting retry loops
- **Tailscale VPN** — One-click installation, authentication, and status monitoring
- **Software Updates** — In-app OTA update checking, download, verification, and installation
- **System Logs** — Centralized log viewer with search

### Interface
- **Dark/Light Mode** — Full theme support with OKLCH perceptual color system
- **Responsive Design** — Works on desktop monitors and tablets in the field
- **Cookie-Based Auth** — Secure session management with rate limiting
- **AT Terminal** — Direct AT command interface for advanced users
- **Initial Setup Wizard** — Guided onboarding for first-time configuration

---

## Quick Install

SSH into your OpenWRT device and run:

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

One-liner convenience (same verified flow):

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

The one-liner wrapper still downloads the latest pre-release tarball, verifies `sha256sum.txt`, and then executes `install.sh`.

To pin a specific release instead of latest pre-release, set `TAG` manually (for example `TAG="v0.1.35"`) and skip the API lookup block.

### Upgrading

From v0.1.7+, go to **Monitoring → Software Update** and use the built-in update flow — download, verify, and install without SSH.

### Changing the Web Port

QManager is served on ports 80 (HTTP) and 443 (HTTPS) by default. LuCI shares the same web server, so it moves with QManager. You can pick other ports in three places:

- **During install:** a fresh SSH install asks `Use different ports? [y/N]`. Press Enter to keep 80 and 443.
- **In the web UI:** the optional **Web Port** step in first-time setup, or **System Settings → Web Port** at any time.
- **Over SSH**, on a device that already runs QManager:

```sh
qmanager_web_port                  # show the current ports
qmanager_web_port set 8080 8443    # move to HTTP 8080 and HTTPS 8443
qmanager_web_port reset            # back to 80 and 443
```

Or set the ports through UCI, then apply them:

```sh
uci set quecmanager.web.http_port=8080
uci set quecmanager.web.https_port=8443
uci commit quecmanager && qmanager_web_port apply
```

After a move, open QManager at `http://<modem-ip>:8080/`. A port already used by another service (such as 22 for SSH) is refused, and if the web server can't start on the new ports, the old ones come back on their own. Uninstalling QManager puts the web server back on 80 and 443.

### Uninstalling

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

One-liner uninstall:

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh --uninstall
```

Use `QMANAGER_TAG="v0.1.35" sh /tmp/qmanager-installer.sh` to pin a specific version with the one-liner wrapper.

---

## Prerequisites

- Quectel RM551E-GL (RM520N-GL users: see [QManager-RM520N](https://github.com/dr-dolomite/QManager-RM520N))
- OpenWRT device with the modem connected
- **Required packages:** `jq`, `curl`, `coreutils-timeout`, `ethtool` (the installer installs any that are missing; `sms-tool` is no longer used and is removed by the installer as a conflict)
- **Optional packages:** `msmtp` (email alerts), `ookla-speedtest` (speed testing)

> Optional packages can be installed from within the app — no manual `opkg` needed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript 5 |
| **Styling** | Tailwind CSS v4, OKLCH colors, Euclid Circular B + Manrope |
| **Components** | shadcn/ui (42+ components), Recharts, React Hook Form + Zod |
| **Backend** | POSIX shell scripts (OpenWRT/BusyBox), CGI endpoints |
| **AT Commands** | `qcmd` client for the `qmanager_atd` Rust AT broker, which owns `/dev/smd11`; read-only data also comes over QMI (QRTR) |
| **Package Manager** | Bun |

---

## Architecture

```
Browser ─── authFetch() ─── CGI Scripts ─── qcmd ─── Modem (AT commands)
                │                  │
                │          Shell Libraries (40)
                │
        reads /tmp/qmanager_status.json
                │
         qmanager_poller
       (tiered polling: 2s/10s/30s)
```

The frontend is a statically-exported Next.js app served from the device. The backend is POSIX shell scripts running on OpenWRT — CGI endpoints for API requests and long-running daemons for data collection.

**Key Data Flow:**

- **Poller daemon** queries the modem via AT commands every 2–30s (3 tiers) and writes a JSON cache file
- **CGI endpoints** (101 scripts) read the cache for GET requests, execute AT commands for POST requests
- **React hooks** (75 custom hooks) poll the CGI layer and provide loading/error/staleness states

See [full documentation](docs/README.md) for architecture details, API reference, and development guides.

---

## Development

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js 18+

### Getting Started

```bash
# Clone the repository
git clone https://github.com/dr-dolomite/qmanager.git
cd qmanager

# Install dependencies
bun install

# Start development server (to proxy API calls to a modem at 192.168.224.1, uncomment the rewrites() block in next.config.ts)
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
# Static export to out/
bun run build

# Full package (frontend + backend tarball + checksum)
bun run package
```

The `package` script builds the frontend, bundles it with backend scripts into a tarball, and generates a SHA-256 checksum — ready for distribution via GitHub Releases.

---

## Project Structure

```
QManager/
├── app/                        # Next.js App Router pages (52 routes)
│   ├── dashboard/              # Home — live signal monitoring
│   ├── cellular/               # Cellular info, SMS, profiles, band/tower/freq locking,
│   │                           #   cell scanner, APN, IMEI, FPLMN, network priority
│   ├── local-network/          # Ethernet, IP passthrough, DNS, TTL, MTU,
│   │                           #   video optimizer, traffic masquerade
│   ├── monitoring/             # Network events, latency, email alerts, watchdog,
│   │                           #   SMS alerts, Tailscale, logs, software updates
│   ├── system-settings/        # System config, AT terminal
│   └── (login, setup, reboot, about-device, support)
├── components/                 # React components (~370 files)
│   ├── ui/                     # shadcn/ui primitives (42+ components)
│   ├── cellular/               # Cellular management UI
│   ├── dashboard/              # Home dashboard cards
│   ├── local-network/          # Network settings UI
│   ├── monitoring/             # Monitoring & alerts UI
│   └── system-settings/        # System configuration UI
├── hooks/                      # Custom React hooks (75 files)
├── types/                      # TypeScript interfaces (38 files)
├── lib/                        # Utilities (auth-fetch, earfcn, csv)
├── constants/                  # Static data (MNO presets, event labels)
├── scripts/                    # Backend shell scripts
│   ├── etc/init.d/             # Init.d services (14)
│   ├── usr/bin/                # Daemons & utilities (27)
│   ├── usr/lib/qmanager/       # Shared libraries (40)
│   ├── www/cgi-bin/            # CGI endpoints (101 scripts)
│   ├── install.sh              # Device installation script
│   └── uninstall.sh            # Clean removal script
└── docs/                       # Documentation
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Documentation Index](docs/README.md) | Overview and links to all docs |
| [Architecture](docs/ARCHITECTURE.md) | System architecture, data flow, polling tiers |
| [Frontend Guide](docs/FRONTEND.md) | Components, hooks, pages, routing |
| [Backend Guide](docs/BACKEND.md) | Shell scripts, daemons, CGI endpoints |
| [API Reference](docs/API-REFERENCE.md) | Complete CGI endpoint reference |
| [Design System](docs/DESIGN-SYSTEM.md) | Colors, typography, UI conventions |
| [Deployment Guide](docs/DEPLOYMENT.md) | Building and deploying to OpenWRT |
| [Translating QManager](docs/i18n/CONTRIBUTING.md) | Add a new language pack or improve existing translations |

---

## Backend Services

QManager runs 14 init.d services on the device:

| Service | Purpose |
|---------|---------|
| `qmanager` | Main poller daemon — tiered AT polling, JSON cache, event detection |
| `qmanager_atd` | AT broker — owns `/dev/smd11`, serialises AT commands for `qcmd`, `qsms` and `qmi` |
| `qmanager_watchcat` | Connection watchdog — 4-tier auto-recovery state machine |
| `qmanager_dpi` | DPI service — nfqws in video optimizer or traffic masquerade mode |
| `qmanager_tower_failover` | Tower failover — restores lock after cell loss |
| `qmanager_eth_link` | Ethernet link speed — applies saved speed/duplex settings |
| `qmanager_ttl` | TTL/HL — applies iptables rules at boot |
| `qmanager_mtu` | MTU — applies interface MTU settings |
| `qmanager_imei_check` | IMEI integrity — verifies IMEI backup on boot |
| `qmanager_netbird_zone` | NetBird — boot-time self-heal of the firewall zone for `wt0` |
| `qmanager_sites` | Sites monitor — times TCP handshakes to configured sites |
| `qmanager_sms_forward` | SMS forwarding daemon — runs only when forwarding is enabled |
| `qmanager_sms_storage` | SMS storage — applies the chosen storage (`AT+CPMS`) at boot |
| `qmanager_tailscale_net` | Tailscale — boot re-assert of reachability rules |

---

## Support the Project

<div align="center">
  <h3>Support QManager's Development</h3>
  <p>Your contribution helps maintain the project and fund continued development, testing on new cellular networks, and hardware costs.</p>
  <br/>
  <a href="https://wise.com/pay/business/blackcatdev?currency=USD" target="_blank">
    <img height="40" src="https://img.shields.io/badge/Donate-Wise-9FE870?style=for-the-badge&logo=wise&logoColor=white" alt="Donate via Wise" />
  </a>
  &nbsp;
  <a href="https://paypal.me/iamrusss" target="_blank">
    <img height="40" src="https://img.shields.io/badge/Donate-PayPal-003087?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate via PayPal" />
  </a>
  <br/><br/>
  <p>You can also <a href="https://github.com/sponsors/dr-dolomite" target="_blank">sponsor on GitHub</a>.</p>
</div>

---

## License

This project is licensed under the [MIT License with Commons Clause](LICENSE).

**You are free to:** use, modify, fork, and share QManager for personal and non-commercial purposes.

**You may not:** sell QManager, bundle it into a commercial product, or offer it as a paid service — including forked versions.

### Commercial Licensing

If you want to use QManager in a commercial product, OEM device, or reseller offering, commercial licenses are available. Contact [DrDolomite](https://github.com/dr-dolomite) directly to discuss terms.

---

<div align="center">
  <p>Built with care by <a href="https://github.com/dr-dolomite">DrDolomite</a></p>
</div>
