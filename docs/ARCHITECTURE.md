# QManager Architecture

This document describes the overall system architecture, data flow patterns, and key design decisions in QManager.

---

## System Overview

QManager is a two-tier application:

1. **Frontend** — A statically-exported Next.js app served by the OpenWRT device's web server (uhttpd). It runs entirely in the browser.
2. **Backend** — POSIX shell scripts running on the OpenWRT device: CGI endpoints for API requests, long-running daemons for data collection, and init.d services for process management.

```
┌──────────────────────────────────────────────────────────┐
│                      Browser (Client)                     │
│  ┌─────────────────────────────────────────────────────┐ │
│  │            Next.js Static App (React 19)            │ │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │ │
│  │  │Dashboard│ │ Cellular │ │ Network  │ │Monitor │ │ │
│  │  │ Cards   │ │ Settings │ │ Settings │ │& Alerts│ │ │
│  │  └────┬────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │ │
│  │       └──────┬─────┴────────────┴───────────┘      │ │
│  │              │  authFetch() — cookies auto-sent     │ │
│  └──────────────┼──────────────────────────────────────┘ │
└─────────────────┼────────────────────────────────────────┘
                  │ HTTP GET/POST
                  ▼
┌──────────────────────────────────────────────────────────┐
│                 OpenWRT Device (Server)                    │
│  ┌──────────────────────────────────────────────────────┐│
│  │  uhttpd → /www/cgi-bin/quecmanager/*.sh (CGI)       ││
│  │  ┌──────────────────────────────────────────────┐   ││
│  │  │ cgi_base.sh (auth + headers + JSON helpers)  │   ││
│  │  └──────────────────────────────────────────────┘   ││
│  │       │ reads cache      │ AT / QMI requests         ││
│  │       ▼                  ▼                           ││
│  │  /tmp/qmanager_    qcmd · qsms · qmi (symlinks)      ││
│  │  status.json             │ Unix socket               ││
│  │       ▲                  ▼                           ││
│  │       │          qmanager_atd (Rust broker)          ││
│  │       │           ├─ AT lane: FIFO → one worker      ││
│  │       │           │    → flock → /dev/smd11          ││
│  │       │           └─ QMI lane: read-only, no lock    ││
│  │       │                → AF_QIPCRTR (QRTR)           ││
│  │       │ writes every 2s (+ reads qmi.env sidecar)    ││
│  │  ┌──────────────────────────────────────────────┐   ││
│  │  │     qmanager_poller (main data collector)     │   ││
│  │  │     + qmanager_ping  + qmanager_watchcat      │   ││
│  │  └──────────────────────────────────────────────┘   ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### Modem access: the broker and its two lanes

CGI scripts and daemons never open the modem themselves. `qcmd` (AT), `qsms` (SMS, still AT) and `qmi` (read-only QMI) are all symlinks to one Rust broker, `qmanager_atd` (`native/qmanager_atd/`), which is the only process that opens `/dev/smd11`. The broker runs two independent lanes:

- **AT lane:** requests queue in a bounded FIFO and run one at a time on a single worker that holds the modem lock and talks to `/dev/smd11`.
- **QMI lane:** read-only NAS/DMS/UIM/WDS/DSD reads over QRTR (`AF_QIPCRTR`). It never touches `/dev/smd11`, never takes the modem lock and never waits behind an AT job. A sampler in the lane publishes sidecars (`/var/run/qmanager/qmi.env`, `/tmp/qmanager_qmi.json`) that the poller and CGIs read, plus the live signal file.

Details live in the feature docs: [`features/at-broker.md`](features/at-broker.md) (process model, output contract, invariants), [`features/qmi-lane.md`](features/qmi-lane.md) (allow-list, field coverage, sidecars), [`features/live-signal.md`](features/live-signal.md) and [`features/data-used.md`](features/data-used.md).

---

## Data Flow

### Polling Architecture (Backend)

The poller (`/usr/bin/qmanager_poller`, source `scripts/usr/bin/qmanager_poller`) runs a 2s base cycle (`POLL_INTERVAL=2`). Local-only work (`/proc` metrics, ping and DNS reads, alert engine, `write_cache`) runs every cycle. AT work is gated by a UI-aware tier, derived from the heartbeat file `/tmp/qmanager_ui_active` that the status CGIs touch:

| Tier | Interval | Data Collected | Source |
|------|----------|---------------|--------|
| **Tier 1 (Hot)** | Every cycle (2s) while Active; slower when Idle/Deep (see below) | Serving cell, CA info, CFUN state, per-antenna signal (RSRP/RSRQ/SINR); traffic stats and uptime (no AT) | `AT+QENG="servingcell"`, CA from the QMI sidecar (`qmi_ca_build`) else `AT+QCAINFO=1;+QCAINFO;+QCAINFO=0`, `AT+CFUN?`, `AT+QRSRP;+QRSRQ;+QSINR`, `/proc/net/dev` |
| **Tier 1.5 (Housekeeping)** | Every 5 cycles (10s) | Ping history append, watchcat state read, SoC temperature | `/tmp/qmanager_ping_history`, `/tmp/qmanager_watchcat.json`, `/sys/class/thermal` (no AT) |
| **Tier 2 (Warm, Active only)** | Every 15 cycles (30s) | Carrier, SIM slot, phone number, SIM presence | `AT+COPS?;+QUIMSLOT?;+CNUM;+CPIN?` |
| **Boot (Once)** | Startup | Firmware, IMEI, IMSI, ICCID, capabilities, supported bands | `AT+CVERSION`, `AT+CGMM`, `AT+CGSN`, `AT+CIMI`, `AT+QCCID`, `AT+CNUM`, `AT+QGETCAPABILITY`, `AT+QNWPREFCFG="policy_band"` |

The CA read is QMI-first (broker 0.7.0): with a fresh `qmi.env` the poller builds the LTE carriers from QMI and skips `AT+QCAINFO`; in NSA the NR row comes from the last `AT+QCAINFO`, refreshed every 20 s or when QENG's NR cell changes; SA, NR-CA and any failed gate use AT. `device.ca_source` says which (`qmi`/`mixed`/`at`). Boot identity and the LTE band list fall back to QMI only when AT leaves them empty. See [`features/adaptive-polling.md`](features/adaptive-polling.md) Invariant 14.

The Tier 2 DATA-PLANE / L1 group (CGCONTRDP, QMAP WWAN, QNWCFG time-advance and MIMO) is no longer polled. It is fetched on demand by `cellular/radio_details.sh` while its page is open (see `ondemand_radio.sh`).

**Adaptive (UI-aware) backoff.** The heartbeat age decides the tier. Thresholds come from `quecmanager.poller.*` (defaults in brackets):

| Tier | Heartbeat age | AT cadence | What runs on an AT touch |
|------|---------------|------------|--------------------------|
| **Active** | ≤ 20s `[active_grace]` | every cycle (2s) | Full Tier 1 / 1.5 / 2 graduated cadence |
| **Idle** | ≤ 300s `[idle_threshold]` | every 7 cycles (~14s) `[idle_interval=15]` | Full snapshot: serving cell, CA, CFUN, per-antenna, temperature, SIM state. Tier 2 identity reads are skipped (Active only). |
| **Deep** | > 300s | every 30 cycles (60s) `[deep_idle_interval=60]` | Serving cell only. CA, CFUN and per-antenna keep their last-known values. |

A Prometheus scrape holds the tier open (`/var/run/qmanager/metrics_scrape`), and an active scan or SIM switch backs off AT entirely for the cycle.

All tiers write to a single cache file: `/tmp/qmanager_status.json`

**QMI gap-fill.** On cycles where AT did not parse the serving cell (idle/deep between AT touches, or a busy QENG), `qmi_merge.sh` overlays LTE serving signal from the broker's `/var/run/qmanager/qmi.env` sidecar. The overlay is applied only around the final `write_cache`, so AT consumers never see QMI samples. `lte.source` reports which source filled the cache.

### Frontend Polling

The frontend polls the CGI layer (which reads the cache file) at intervals matching the tier system:

```
useModemStatus()  ──── GET /at_cmd/fetch_data.sh ──── reads /tmp/qmanager_status.json
  (every 2s)

useSignalHistory() ── GET /at_cmd/fetch_signal_history.sh ── reads NDJSON file
  (every 2s)

useLatencyHistory() ─ GET /at_cmd/fetch_ping_history.sh ── reads NDJSON file
  (every 30s)
```

### Write Operations

User configuration changes follow a synchronous request/response pattern:

```
User Action → React Component → authFetch() POST → CGI Script
                                                      │
                                              ┌───────┴───────┐
                                              │ Parse POST    │
                                              │ Execute AT cmd│
                                              │ Return JSON   │
                                              └───────────────┘
```

Some operations are asynchronous (profile apply, cell scan):
```
POST /profiles/apply.sh → spawns qmanager_profile_apply daemon
                           ↓
Frontend polls GET /profiles/apply_status.sh every 2s
                           ↓
Daemon writes progress to /tmp/qmanager_profile_state.json
```

---

## Authentication

QManager uses cookie-based session authentication:

| Cookie | Type | Purpose |
|--------|------|---------|
| `qm_session` | HttpOnly, SameSite=Strict | Session token (validated server-side) |
| `qm_logged_in` | JS-readable, SameSite=Strict | Client-side login indicator |

### Flow

1. **First-time setup**: `GET /auth/check.sh` returns `setup_required: true` → user creates password
2. **Login**: `POST /auth/login.sh` → validates password → creates session file in `/tmp/qmanager_sessions/` → sets cookies
3. **Authenticated requests**: Browser auto-sends `qm_session` cookie → `cgi_base.sh` calls `require_auth` → validates session
4. **401 handling**: `authFetch()` catches 401 → clears `qm_logged_in` → redirects to `/login`
5. **Session expiry**: 1 hour; one file per session (no race conditions)

Auth endpoints use `_SKIP_AUTH=1` to bypass the automatic auth check in `cgi_base.sh`.

---

## State Management Patterns

### Frontend Hook Categories

| Pattern | Examples | Behavior |
|---------|----------|----------|
| **Polling Hooks** | `useModemStatus`, `useSignalHistory`, `useLatencyHistory` | Auto-fetch at interval, staleness detection, manual refresh |
| **One-Shot Hooks** | `useCellularSettings`, `useApnSettings`, `useMbnSettings` | Fetch on mount, local cache, explicit `saveSettings()` |
| **Form Hooks** | `useLogin` (`isLoggedIn` helper) | Cookie check, submit actions, rate limit handling |
| **Async Process Hooks** | `useProfileApply`, `useCellScanner`, `useSpeedtest` | Start operation → poll status → completion/error |

### Backend State Files

| File | Owner | Format | Purpose |
|------|-------|--------|---------|
| `/tmp/qmanager_status.json` | poller | JSON | Main modem status cache |
| `/tmp/qmanager_signal_history.json` | poller | NDJSON | Rolling signal history (one row per 2s Tier 1 cycle, ~60 rows) |
| `/tmp/qmanager_ping_history.json` | poller | NDJSON | Ping history (max 8640 lines) |
| `/tmp/qmanager_qmi.json`, `/var/run/qmanager/qmi.env` | `qmanager_atd` (QMI sampler) | JSON / env | QMI lane snapshot for CGIs; `qmi.env` read by the poller gap-fill |
| `/tmp/qmanager_events.json` | `qmanager_logd` (legacy `append_event` when logd is down) | NDJSON | Mirror of the newest 50 Network events; the store is the journal (`/usrdata/qmanager/journal/ev-*.jsonl`) |
| `/tmp/qmanager_ping.json` | ping daemon | JSON | Current ping result |
| `/tmp/qmanager_watchcat.json` | watchcat | JSON | Watchdog state machine |
| `/tmp/qmanager_profile_state.json` | profile_apply | JSON | Profile apply progress |
| `/tmp/qmanager_pci_state.json` | poller (events) | JSON | SCC PCI tracking |
| `/tmp/qmanager_email_log.json` | poller (email) | NDJSON | Email alert log (max 100) |
| `/tmp/qmanager_sms_log.json` | poller (sms) | NDJSON | SMS alert log (max 100) |
| `/tmp/qmanager_sms_reload` | CGI | Empty | Trigger poller SMS alert config reload |
| `/etc/qmanager/` | CGI scripts | Various | Persistent configuration |

---

## Daemon Architecture

### Process Hierarchy

```
init.d/qmanager_atd (procd)
  └── qmanager_atd (Rust AT + QMI broker; sole owner of /dev/smd11)
       └── /usr/bin/qcmd, qsms, qmi are symlinks to it

init.d/qmanager (procd)
  ├── qmanager_ping (ping daemon, runs forever)
  └── qmanager_poller (main loop, runs forever)
       ├── sources: events.sh, email_alerts.sh, sms_alerts.sh, alert_routing.sh, alert_engine.sh,
       │            data_used.sh, qmi_merge.sh, parse_at.sh, ondemand_radio.sh, ...
       └── reads: qmanager_ping.json, qmanager_watchcat.json

init.d/qmanager_watchcat (procd)
  └── qmanager_watchcat (connection watchdog)

init.d/qmanager_sites (procd)        → qmanager_sites
init.d/qmanager_sms_forward (procd)  → qmanager_sms_forward
init.d/qmanager_dpi (procd)          → nfqws (DPI evasion, single instance)

init.d/qmanager_eth_link (non-procd, one-shot)
  └── applies persisted ethernet link speed on boot

init.d/qmanager_sms_storage (non-procd)
  └── qmanager_sms_storage (SMS storage routing daemon)

init.d/qmanager_netbird_zone, init.d/qmanager_tailscale_net (non-procd, one-shot)
  └── boot-time re-assert of NetBird firewall zone / Tailscale network fixes

init.d/qmanager_ttl (non-procd, one-shot)
  └── applies persisted TTL/HL rules on boot

init.d/qmanager_mtu (non-procd)
  └── qmanager_mtu_apply (waits for rmnet_data0, then applies MTU)

init.d/qmanager_imei_check (non-procd, one-shot)
  └── qmanager_imei_check (boot-time IMEI rejection check)

init.d/qmanager_tower_failover (non-procd)
  └── qmanager_tower_failover (tower failover watchdog)

cron (managed by system/settings.sh CGI)
  └── qmanager_scheduled_reboot (reboot at configured time)
```

### Daemon Communication

Daemons communicate through shared files in `/tmp/`:

- **Poller reads** ping daemon output (`qmanager_ping.json`) and watchcat state (`qmanager_watchcat.json`)
- **CGI scripts read** the poller's cache (`qmanager_status.json`) for GET requests
- **CGI scripts write** config files, then touch trigger files (e.g., `/tmp/qmanager_email_reload`, `/tmp/qmanager_sms_reload`) to signal daemons to reload
- **Modem access goes through one socket**: the broker listens on `/var/run/qmanager_atd.sock`, and `qcmd`/`qsms`/`qmi` connect to it. Everything else is file-based.

---

## Event System

Detectors (the poller's `events.sh` library, plus CGIs and daemons that call `append_event`) emit events to `qmanager_logd`, which keeps them 31 days on flash and mirrors the newest 50 to `/tmp/qmanager_events.json` (NDJSON) for the legacy path. Full list, fields and invariants: [`features/journal.md`](features/journal.md).


| Event Type | Trigger | Severity |
|-----------|---------|----------|
| `network_mode` | LTE ↔ 5G-NSA ↔ 5G-SA switch | info/warning |
| `band_change` | LTE or NR band changed | info |
| `pci_change` | PCC cell handoff | info |
| `scc_pci_change` | SCC cell handoff | info |
| `ca_change` | Carrier aggregation activated/deactivated/count changed | info/warning |
| `nr_anchor` | 5G NR anchor gained/lost | info/warning |
| `signal_lost` / `signal_restored` | Modem reachability change | warning/info |
| `internet_lost` / `internet_restored` | Internet connectivity change | warning/info |
| `high_latency` / `latency_recovered` | Latency above threshold (default 250ms, debounced 3 readings) | warning/info |
| `high_packet_loss` / `packet_loss_recovered` | Loss above threshold (default 30%, debounced 3 readings) | warning/info |
| `watchcat_recovery` | Watchdog executed recovery action | warning |
| `sim_failover` | SIM slot switched by watchdog | warning |
| `sim_swap_detected` | Physical SIM card changed at boot | info |
| `apn_changed` / `band_lock_changed` / `tower_lock_changed` | APN saved or reverted, band lock, tower lock applied or cleared (CGI, after the AT call succeeds) | info |
| `band_failover` / `tower_failover` | Failover daemon fired (reset to defaults / lock cleared; `tower_failover` is `error` if a lock could not be cleared) | warning/error |
| `sim_switched` / `rat_priority_changed` / `fplmn_cleared` / `scenario_switched` | User changes from the CGIs (SIM slot after verified switch, RAT order, FPLMN clear, scenario) | info |
| `registration_changed` / `imei_changed` | Carrier name changed (empty name = no observation); IMEI differs from `/etc/qmanager/last_imei` (last 4 digits only) | info/warning |
| `data_call_dropped` / `data_call_restored` | QMI WDS mux empty for 3 fresh samples while registered / back (silent during SSR) | warning/info |
| `wan_address_changed` / `data_cid_changed` | WAN IPv4/IPv6 or data CID changed (empty value = no observation) | info |
| `dns_changed` / `ttl_mtu_changed` | DNS servers, TTL/hop limit or MTU changed from the CGIs (never from boot apply) | info |
| `dns_failing` / `dns_recovered` | 3 failed lookups after a good one / next good lookup | warning/info |
| `site_down` / `site_up` | Site failed 2 sweeps in a row / answered again (a sweep where no site answered is no observation) | warning/info |
| `broker_restarted` / `software_updated` | AT broker capability file newer than `broker.seen`; `/etc/qmanager/last_version` differs | warning/info |
| `clock_stepped` / `storage_low` | History clock step beyond 120 s; low-free latch (first transition) | info/warning |
| `oom_kill` / `eth_link_up` / `eth_link_down` | Kernel records captured by `qmanager_logd` from `/dev/kmsg` | warning/info/warning |
| `login_failed` / `login_locked` / `password_changed` | Login failure (no IP), lockout in effect, admin password changed | warning/warning/info |
| `alert_send_failed` | SMS or email alert could not be sent (channel and trigger, never the recipient) | warning |

Events are suppressed during active watchcat recovery to prevent noise.

---

## Watchdog (Connection Health)

The watchdog daemon (`qmanager_watchcat`) implements a 4-tier escalation recovery:

```
MONITOR ──(failures)──► SUSPECT ──(confirmed)──► RECOVERY ──► COOLDOWN ──► MONITOR
                                                     │                        ▲
                                                     │   (max retries)        │
                                                     └──► LOCKED ─────────────┘
                                                           (manual reset)

Tier 1: ifup wan          (restart interface)
Tier 2: CFUN toggle       (reset modem radio — SKIPPED if tower lock active)
Tier 3: SIM failover      (switch SIM slot using Golden Rule sequence)
Tier 4: Full reboot       (max 3/hour via token bucket, auto-disables permanently)
```

### SIM Swap Procedure (Golden Rule)

Any SIM slot switch must follow this sequence:
```
AT+CFUN=0    → sleep 2s
AT+QUIMSLOT=N → sleep 2s
AT+CFUN=1
```
Abort immediately if `CFUN=0` fails (modem may be in an inconsistent state).

---

## Custom SIM Profiles

Profiles store a complete modem configuration (APN + TTL/HL + optional IMEI) that can be saved and applied as a unit.

### Apply Workflow (4 Steps)

```
Step 1: APN        → AT+CGDCONT (set PDP context)
Step 2: TTL/HL     → Write /etc/firewall.user.ttl + apply iptables
Step 3: MPDN rule  → Verizon PDP3 routing or revert on carrier switch (no reboot)
Step 4: IMEI       → AT+EGMR=1,7,"<IMEI>" + reboot (only if IMEI changed; always last)
```

The apply process runs asynchronously via `qmanager_profile_apply` daemon. The frontend polls `/profiles/apply_status.sh` for progress updates.

---

## Configuration Persistence

| What | Where | Format |
|------|-------|--------|
| SIM profiles | `/etc/qmanager/profiles/<id>.json` | JSON |
| Tower lock config | `/etc/qmanager/tower_lock.json` | JSON |
| IMEI backup config | `/etc/qmanager/imei_backup.json` | JSON |
| SMS alerts config | `/etc/qmanager/sms_alerts.json` | JSON |
| Email alerts config | `/etc/qmanager/email_alerts.json` | JSON |
| Alert routing matrix | `/etc/qmanager/alert_routing.json` | JSON |
| Last SIM ICCID | `/etc/qmanager/last_iccid` | Plain text |
| Email SMTP config | `/etc/qmanager/msmtprc` | msmtp config (chmod 600) |
| TTL/HL rules | `/etc/firewall.user.ttl` | Shell commands (iptables) |
| MTU rules | `/etc/firewall.user.mtu` | Shell commands (ip link) |
| Watchdog config | UCI `quecmanager.watchcat.*` | UCI |
| Ethernet link speed | UCI `quecmanager.eth_link.speed_limit` | UCI |
| PCIe ASPM policy | UCI `quecmanager.eth_link.aspm_policy` (seeded `performance`) | UCI |
| System settings | UCI `quecmanager.settings.*` | UCI |
| Timezone | UCI `system.@system[0].timezone/zonename` | UCI |
| Auth password | `/etc/qmanager/auth.json` | SHA-256 hash + salt |
| Sessions | `/tmp/qmanager_sessions/<token>` | One file per session |
