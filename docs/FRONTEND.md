# QManager Frontend Guide

This document covers the frontend architecture, component patterns, hooks, routing, and development conventions.

---

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 16.0.7 | App Router, static export (`output: "export"`) |
| React | 19.2.1 | Component framework |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | v4 | Utility-first styling |
| shadcn/ui | Latest | Headless UI components (Radix UI) |
| Recharts | 2.15.4 | Signal and latency charting |
| React Hook Form | ^7.71.2 | Form state management |
| Zod | ^4.3.6 | Schema validation |
| Motion | ^12.38.0 | Animations |
| @dnd-kit | 6.3/10.0 | Drag-and-drop (sortable lists) |
| @tanstack/react-table | 8.21.3 | Data tables |
| Lucide React | ^1.8.0 | Icons |
| next-themes | 0.4.6 | Dark/light mode |
| sonner | 2.0.7 | Toast notifications |

---

## Directory Structure

```
app/                            # Next.js App Router
├── layout.tsx                  # Root layout (fonts, ThemeProvider, Toaster)
├── page.tsx                    # Redirect → /dashboard
├── globals.css                 # Tailwind + OKLCH theme variables
├── fonts/                      # Vendored Rethink Sans, JetBrains Mono, Material Symbols subset
├── login/page.tsx              # Authentication page (thin wrapper around LoginComponent)
├── setup/page.tsx              # First-time password setup
├── reboot/page.tsx             # Reboot page
├── dashboard/                  # Home dashboard
├── cellular/                   # Cellular management
│   ├── page.tsx                # Cellular info hub
│   ├── settings/               # APN, IMEI, network priority, FPLMN
│   ├── cell-locking/           # Band, frequency, tower locking
│   ├── cell-scanner/           # Cell scanner, neighbour scanner, frequency calculator
│   ├── antenna-alignment/      # Antenna alignment
│   ├── antenna-statistics/     # Antenna statistics
│   ├── custom-profiles/        # SIM profiles + connection scenarios
│   └── sms/                    # SMS inbox/send, forwarding/
├── local-network/              # Network settings
│   ├── page.tsx                # Redirect stub to /local-network/ethernet
│   ├── ethernet/               # Ethernet status + link speed
│   ├── ttl-settings/           # TTL/HL and MTU (one page)
│   ├── ip-passthrough/         # IP passthrough
│   ├── custom-dns/             # DNS settings
│   ├── traffic-engine/         # Traffic Engine (DPI settings: Video Optimizer / Traffic Masquerade)
│   └── dpi-masking/            # Redirect stub to /local-network/traffic-engine
├── history/                    # History (generic time-series pages, docs/features/history.md)
│   ├── cellular/               # Cellular History
│   └── connection/             # Connection History (reachability, charts, Sites, events)
├── monitoring/                 # Monitoring & alerts
│   ├── page.tsx                # Redirect stub to /monitoring/events
│   ├── connection-quality/     # Ping profile + quality thresholds
│   ├── events/                 # Network events
│   ├── latency/                # Redirect stub to /history/connection (retired Latency Monitor)
│   ├── alerts/                 # Centralized SMS + email connection alerts
│   ├── watchdog/               # Watchdog settings
│   ├── prometheus/             # Prometheus metrics endpoint (token, scrape freshness, scrape config)
│   ├── tailscale/              # Tailscale VPN
│   └── netbird/                # NetBird VPN
├── system-settings/            # System settings & scheduled ops; subpages: adaptive-polling, at-terminal, config-backup, connection-quality (redirect), device-access, hardware, languages, logs, software-update, system-health-check
├── about-device/               # Device information
└── support/                    # Support & links

components/
├── ui/                         # shadcn/ui primitives (61 components)
├── app-layout.tsx              # Main layout (sidebar + breadcrumbs)
├── app-sidebar.tsx             # Navigation sidebar
├── theme-provider.tsx          # next-themes wrapper
├── nav-menu.tsx                # Sidebar group wrapper + sliding .nav-indicator pill
├── nav-section.tsx             # Single nav-group implementation (Material glyphs, sub-rows, status pill)
├── nav-user.tsx                # User menu (change password, theme, reboot, logout)
├── donate-dialog.tsx           # GitHub Sponsors / GCash donation dialog
├── pre-auth-type.ts            # Shared type scale for the pre-auth cards (`/` and `/login/`); type-only
├── auth/                       # Login card (login-component, login-device-name, login-language-picker), interpolation-slot (SLOT / withSlot), setup form
├── cellular/                   # Cellular components (100 files)
├── dashboard/                  # Dashboard cards
├── local-network/              # Network components
├── history/                    # History components (shared pieces; cellular/, connection/ incl. connection/sites/)
├── monitoring/                 # Monitoring components
├── system-settings/            # System settings & scheduled ops
├── about-device/               # About page components
└── support/                    # Support page components

hooks/                          # Custom React hooks (76 files, incl. tests)
types/                          # TypeScript interfaces (38 files)
lib/                            # Utility functions
constants/                      # Static configuration data
```

---

## Routing & Pages

### Route Map

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | Home (`app/page.tsx`) | Public Overview splash by default (re-authored in ledger U3.4, see [`reference/overview-splash.md`](reference/overview-splash.md)); confirms a live session via `auth/check.sh` before forwarding to `/dashboard` — never trusts the `qm_logged_in` indicator cookie alone (see gotcha below) |
| `/login` | LoginComponent | Authentication (login or first-time setup): hostname title, progressive lockout banner with a refresh-safe countdown, attempts-left copy, recovery disclosure, offline banner, corner language/theme cluster, no footer (`login-chrome.tsx` was removed in U3.3) |
| `/dashboard` | HomeComponent | Real-time signal, traffic, device status |
| `/cellular` | CellularInformation | Cellular info cards |
| `/cellular/settings` | CellularSettings | Mode, roaming, AMBR settings |
| `/cellular/settings/apn-management` | APNSettings | APN profile CRUD |
| `/cellular/settings/imei-settings` | IMEISettings | IMEI read/write/backup + toolkit |
| `/cellular/settings/network-priority` | NetworkPriority | LTE/NR mode preferences |
| `/cellular/settings/fplmn-settings` | FPLMNSettings | Forbidden network cleanup |
| `/cellular/cell-locking` | BandLocking | LTE/NR band selection |
| `/cellular/cell-locking/tower-locking` | TowerLocking | PCI-based tower lock |
| `/cellular/cell-locking/frequency-locking` | FrequencyLocking | EARFCN/ARFCN lock |
| `/cellular/cell-scanner` | CellScanner | Active cell scanning |
| `/cellular/cell-scanner/neighbourcell-scanner` | NeighbourScanner | Neighbor cells |
| `/cellular/cell-scanner/frequency-calculator` | FrequencyCalculator | EARFCN ↔ freq |
| `/cellular/custom-profiles` | CustomProfile | SIM profiles + Connection Scenarios on one page: in-force hero, Today ribbon, saved profiles, scenarios card, wizard dialog; `?action=create` / `?action=create-scenario` deep links |
| `/cellular/custom-profiles/connection-scenarios` | (redirect) | Client-side redirect to `/cellular/custom-profiles` (`?action=create` becomes `?action=create-scenario`) |
| `/cellular/sms` | SMS | SMS inbox/send |
| `/local-network` | (redirect) | Client-side redirect to `/local-network/ethernet` |
| `/local-network/ethernet` | EthernetStatus | Ethernet link status and speed |
| `/local-network/ttl-settings` | TTLandMTUSettings | IPv4 TTL / IPv6 HL and MTU (one page; there is no `/local-network/mtu` route) |
| `/local-network/ip-passthrough` | IPPassthrough | IP passthrough mode |
| `/local-network/custom-dns` | CustomDNS | DNS override |
| `/local-network/traffic-engine` | TrafficEngine | Traffic Engine (hosts the DPI settings: Video Optimizer / Traffic Masquerade) |
| `/local-network/dpi-masking` | (redirect) | Redirect to `/local-network/traffic-engine` |
| `/monitoring` | (redirect) | Client-side redirect to `/monitoring/events` |
| `/monitoring/events` | NetworkEvents | Event log |
| `/monitoring/connection-quality` | ConnectionQuality | Ping profile + quality thresholds |
| `/monitoring/latency` | (redirect) | Client-side redirect to `/history/connection` (retired Latency Monitor; see `docs/reference/latency-monitor.md`) |
| `/monitoring/alerts` | Alerts | Centralized SMS + email connection alerts (routing matrix + capability, readiness status, merged log) |
| `/monitoring/watchdog` | Watchdog | Connection health |
| `/monitoring/prometheus` | Prometheus | Prometheus scrape endpoint settings (enable, scrape freshness, bearer token, scrape config); see `docs/features/prometheus-metrics.md` |
| `/monitoring/tailscale` | Tailscale | VPN status |
| `/monitoring/netbird` | (see page file) | NetBird VPN status |
| `/history/cellular` | CellularHistory | Cellular History (signal, state and radio events over 24 h / 7 d / 30 d); see `docs/features/history.md` |
| `/history/connection` | ConnectionHistory | Connection History: summary tiles, Reachability strip, Latency / Packet loss / Jitter / DNS charts, Sites card (per-site latency, Live values in Manage, detail panel), connection events; see `docs/features/history.md#connection-history` |
| `/system-settings` | SystemSettings | System preferences, scheduled ops |
| `/system-settings/connection-quality` | (redirect) | Client-side redirect to `/monitoring/connection-quality` |
| `/system-settings/logs` | SystemLogs | Log viewer |
| `/system-settings/config-backup` | (see page file) | Configuration backup and restore |
| `/system-settings/software-update` | (see page file) | Software update |
| `/system-settings/at-terminal` | (see page file) | AT terminal |
| `/system-settings/adaptive-polling` | (see page file) | Adaptive polling settings |
| `/system-settings/languages` | (see page file) | Language packs |
| `/system-settings/hardware` | (see page file) | Hardware |
| `/system-settings/device-access` | (see page file) | Device access |
| `/system-settings/system-health-check` | (see page file) | System health check |
| `/cellular/antenna-alignment` | (see page file) | Antenna alignment |
| `/cellular/antenna-statistics` | (see page file) | Antenna statistics |
| `/cellular/sms/forwarding` | (see page file) | SMS forwarding |
| `/setup` | (see page file) | First-time password setup |
| `/reboot` | (see page file) | Reboot |
| `/about-device` | AboutDevice | Device info |
| `/support` | Support | Project info & links |

### Layout Structure

```
RootLayout (app/layout.tsx)
├── ThemeProvider (dark/light mode)
├── Toaster (sonner notifications)
└── Page Content
    ├── /login → LoginPage (no sidebar)
    ├── / → Home / public Overview splash (no sidebar; pre-login surface)
    └── /* → AppLayout
         ├── AppSidebar (navigation)
         ├── Breadcrumbs (resolved from the nav tree, `lib/nav-tree.ts`)
         └── Page Content
```

> ℹ️ NOTE: The pre-auth routes `/` and `/login/` draw their glyphs from Material Symbols (`LoginLanguagePicker`, `ModeToggle`, `TonalBanner` and the splash in `components/public/overview-card.tsx` plus `components/public/overview/*`, including its LuCI link), never lucide, so each stays on one icon set. The splash's reading order, `resolveBodyMode` states and public endpoints: [`reference/overview-splash.md`](reference/overview-splash.md). Their type comes from `components/pre-auth-type.ts`. Slotted copy on the login card (`login.locked_countdown`, `login.recovery.option_reset_command`) is rendered through `components/auth/interpolation-slot.tsx`. Lockout behaviour and the `check.sh` read-only rule: [`reference/auth-rate-limiting.md`](reference/auth-rate-limiting.md).

---

## Custom Hooks

### Polling Hooks

These hooks automatically fetch data at a configurable interval:

#### `useModemStatus(options?)`

The primary polling hook — fetches the cached modem status JSON.

```typescript
const { data, isLoading, isStale, error, refresh } = useModemStatus({
  pollInterval: 2000,  // default: 2000ms
  enabled: true,       // default: true
});
```

- **Endpoint**: `GET /cgi-bin/quecmanager/at_cmd/fetch_data.sh`
- **Returns**: `ModemStatus | null` (null before first fetch)
- **Staleness**: Data marked stale if timestamp > 10 seconds old
- **Error handling**: Preserves last good data on error, sets `isStale: true`
- **One shared poll** (B5.28, `lib/modem-status-store.ts`): every mounted instance subscribes to one module-level loop that runs at the fastest subscriber's `pollInterval` (so the dashboard's tier-aligned interval keeps its phase). Each instance still receives results at its own interval (within half a base tick), so the 15 s sidebar watchdog indicator re-renders about every 15 s as before. Mounting, an interval change and `refresh()` fetch at once for that instance; requests never overlap. The store holds no snapshot, so each instance keeps its own last data on error.

#### `useSignalHistory(options?)`

Fetches per-antenna signal history for charting.

- **Endpoint**: `GET /cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh`
- **Returns**: `SignalHistoryEntry[]`

#### `useLatencyHistory(options?)`

Fetches ping history for latency charts.

- **Endpoint**: `GET /cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh`
- **Returns**: `PingHistoryEntry[]`
- **Consumers**: the dashboard Connection Quality card (the Latency Monitor page that also read it is retired)

#### `useSites(range, live)`

Polls the Sites monitor for the Sites card on Connection History. `range` is a `HistoryRange` (`24h` | `7d` | `30d`); `live` turns on the 2 s live loop.

- **Endpoint**: `GET/POST /cgi-bin/quecmanager/monitoring/sites.sh`
- **Returns**: `data` (`SitesResponse` for `dataRange`), `dataRange`, `dataNow`, `liveData` (the live sweep, `null` while Live is off), `isLoading`, `error`, `checkPending`, `refresh()`, `checkNow()` and `save()` returning `MutationResult` (`types/mutation-result.ts`: `ok`, `code`, `error`)
- **Cadence**: the range read every 30 s idle, 3 s while a sweep runs; with `live` on, a second `range=now` loop every 2 s while the tab is visible and the monitor is on

### One-Shot Hooks (Fetch + Save)

These hooks fetch settings on mount and provide a `saveSettings()` function:

```typescript
// General pattern
const { settings, isLoading, isSaving, error, saveSettings, refresh } = useFeatureSettings();

// Save changes
const result = await saveSettings({ field: "value" });
if (result.success) { /* toast success */ }
```

| Hook | CGI Endpoint | Types File |
|------|-------------|------------|
| `useCellularSettings` | `/cellular/settings.sh` | `cellular-settings.ts` |
| `useApnSettings` | `/cellular/apn.sh` | `apn-settings.ts` |
| `useMbnSettings` | `/cellular/mbn.sh` | `mbn-settings.ts` |
| `useImeiSettings` | `/cellular/imei.sh` | `imei-settings.ts` |
| `useBandLocking` | `/bands/lock.sh` | `band-locking.ts` |
| `useFrequencyLocking` | `/frequency/lock.sh` | `frequency-locking.ts` |
| `useTowerLocking` | `/tower/lock.sh` | `tower-locking.ts` |
| `useTtlSettings` | `/network/ttl.sh` | — |
| `useMtuSettings` | `/network/mtu.sh` | — |
| `useDnsSettings` | `/network/dns.sh` | — |
| `useIpPassthrough` | `/network/ip_passthrough.sh` | `ip-passthrough.ts` |
| `useAlerts` | `/monitoring/alerts.sh` | `alerts.ts` |
| `useAlertsLog` | `/monitoring/alerts.sh` (`action: "get_log"`) | `alerts.ts` |
| `useWatchdogSettings` | `/monitoring/watchdog.sh` | In hook file |
| `usePrometheusMetrics` | `/monitoring/prometheus.sh` | `prometheus-metrics.ts` |
| `useSystemSettings` | `/system/settings.sh` | `system-settings.ts` |
| `useTailscale` | `/vpn/tailscale.sh` | — |

### Async Process Hooks

For long-running operations that run in the background:

| Hook | Start Endpoint | Status Endpoint |
|------|---------------|-----------------|
| `useProfileApply` | `POST /profiles/apply.sh` | `GET /profiles/apply_status.sh` |
| `useCellScanner` | `POST /at_cmd/cell_scan_start.sh` | `GET /at_cmd/cell_scan_status.sh` |
| `useNeighbourScanner` | `POST /at_cmd/neighbour_scan_start.sh` | `GET /at_cmd/neighbour_scan_status.sh` |
| `useSpeedtest` | `POST /at_cmd/speedtest_start.sh` | `GET /at_cmd/speedtest_status.sh` |
| `useConfigBackup` | `GET /system/config-backup/collect.sh` | (none — encrypts and downloads in browser) |
| `useConfigRestore` | `POST /system/config-backup/apply.sh` | `GET /system/config-backup/apply_status.sh` |

**Configuration Backup specifics:**

- `useConfigBackup` is a 4-stage pipeline: `idle → collecting → encrypting → downloading → done` (or `error`). It calls `collect.sh` for plaintext sections JSON, runs WebCrypto AES-256-GCM in the browser via `lib/config-backup/crypto.ts`, builds the envelope via `lib/config-backup/format.ts`, and triggers a blob download. The passphrase never leaves the browser.
- `useConfigRestore` is a `useReducer`-driven state machine with 10 UI states (`idle`, `reading`, `password_required`, `password_incorrect`, `model_warning`, `ready`, `applying`, `success`, `partial_success`, `failed`). Polling at 500ms only runs in the `applying` state and stops on `done`/`cancelled`. Wrong passphrase decrypt failures map to `password_incorrect` (not `failed`) so the user can retry without re-uploading.
- Both hooks share `lib/config-backup/{crypto,format,sections}.ts` and `types/config-backup.ts`. Pure-TS modules have `*.test.ts` files run via `bun test` (the project's first Bun test setup; `tsconfig.json` excludes `**/*.test.ts` so `bun tsc --noEmit` doesn't choke on `bun:test` imports).
- `lib/reboot/pending.ts` exports `usePendingReboot()` plus `setPendingReboot`/`clearPendingReboot`/`readPendingReboot` helpers, backed by a `qmanager_pending_reboot` localStorage key. Used by both the post-restore AlertDialog and the persistent banner on the Configuration Backup page; both routes survive navigation/reload until the user reboots or dismisses.

### Utility Hooks

| Hook | Purpose |
|------|---------|
| `useLogin` | Login page (setup detection + login/setup actions). Returns `lockout` (`active`, `retryAfter`, `attemptsRemaining`) seeded from `auth/check.sh` with `cache: "no-store"`; `error` is the backend code (translated by the page), `detail` is the English fallback. See [`reference/auth-rate-limiting.md`](reference/auth-rate-limiting.md) |
| `isLoggedIn`, `changePassword` (plain functions, not hooks) | Auth helpers in `hooks/use-auth.ts` (the password card uses `useWebPassword`) |
| `useUnitPreferences` | Cached unit preferences (temp/distance) for dashboard display |
| `useIsMobile` | Responsive breakpoint detection |
| `useRecentActivities` | Fetches network events for the dashboard |
| `useCurrentSettings` | Fetches current modem settings for profile creation |
| `useConnectionScenarios` | CRUD for connection scenario templates |
| `useSimProfiles` | CRUD for custom SIM profiles |
| `useAboutDevice` | Fetches device information |
| `useSms` | SMS inbox and send |

---

## Type System

All TypeScript interfaces are in `types/`. The main data contract is `modem-status.ts`.

### Key Types

| File | Primary Types | Used By |
|------|--------------|---------|
| `modem-status.ts` | `ModemStatus`, `LteStatus`, `NrStatus`, `NetworkStatus`, `DeviceStatus`, `ConnectivityStatus`, `WatchcatStatus`, `SignalPerAntenna`, `NetworkEvent`, `PingHistoryEntry`, `SignalHistoryEntry` | Dashboard, monitoring |
| `cellular-settings.ts` | `CellularSettings`, `CellularSettingsPayload` | Cellular settings page |
| `apn-settings.ts` | `APNProfile`, `APNSettings`, `APNSavePayload` | APN management |
| `mbn-settings.ts` | `MBNProfile`, `MBNSettings` | MBN configuration |
| `imei-settings.ts` | `IMEISettings`, `IMEISavePayload` | IMEI management |
| `band-locking.ts` | `BandLockingState`, `BandLockPayload` | Band locking |
| `frequency-locking.ts` | `FrequencyLockState`, `FrequencyLockPayload` | Frequency locking |
| `tower-locking.ts` | `TowerLockState`, `TowerLockPayload`, `TowerSchedule` | Tower locking |
| `sim-profile.ts` | `SimProfile`, `SimProfileSavePayload` | Custom profiles |
| `connection-scenario.ts` | `ConnectionScenario` | Connection scenarios |
| `ip-passthrough.ts` | `IPPassthroughSettings` | IP passthrough |
| `about-device.ts` | `AboutDeviceInfo` | About device page |
| `sms.ts` | `SMSMessage`, `SMSSendPayload` | SMS feature |
| `system-settings.ts` | `SystemSettings`, `ScheduleConfig`, `SystemSettingsResponse`, `TimezoneEntry`, `DAY_LABELS`, `TIMEZONES` | System settings page |
| `speedtest.ts` | `SpeedtestResult`, `SpeedtestStatus` | Speed test |

### Utility Types & Functions (modem-status.ts)

The main types file also exports signal quality utilities:

```typescript
// Signal quality thresholds
RSRP_THRESHOLDS  // dBm: excellent=-80, good=-100, fair=-110, poor=-140
RSRQ_THRESHOLDS  // dB:  excellent=-5,  good=-10,  fair=-15,  poor=-20
SINR_THRESHOLDS  // dB:  excellent=20,  good=13,   fair=0,    poor=-20
LATENCY_THRESHOLDS // ms: excellent=30, good=60,   fair=100,  poor=Inf

// Quality categorization
getSignalQuality(value, thresholds)  → "excellent" | "good" | "fair" | "poor" | "none"
getLatencyQuality(latencyMs)         → same

// Formatting
formatBytesPerSec(bytes)   → "12.5 Mbps"
formatBytes(bytes)         → "1.0 GB"
formatLatency(ms)          → "34ms"
formatJitter(ms)           → "4.8ms"
formatUptime(seconds)      → "1d 12h 45m"
formatTimeAgo(timestamp)   → "2m ago"
formatNumericField(value)  → "12345" or "-"
formatDistance(km, unit?)   → "156 m" or "1.23 km" (or "512 ft" / "1.23 mi" when unit="miles")
formatTemperature(c, unit?) → "45°C" (or "113°F" when unit="fahrenheit")

// Cell distance calculations (3GPP)
calculateLteDistance(ta)   → km (from LTE Timing Advance)
calculateNrDistance(nta)   → km (from NR NTA value)

// Progress bar mapping
signalToProgress(value, thresholds) → 0-100
```

---

## API Communication

### authFetch()

All authenticated API calls use the `authFetch()` wrapper from `lib/auth-fetch.ts`:

```typescript
import { authFetch } from "@/lib/auth-fetch";

const response = await authFetch("/cgi-bin/quecmanager/cellular/settings.sh");
```

It's a thin wrapper around `fetch()` that:
1. Lets the browser auto-send cookies (no manual token injection)
2. Catches 401 responses → clears indicator cookie → redirects to `/login`

> ⚠️ WARNING: **Never call `authFetch()` from a pre-login / public surface.** Its 401 handler is a global side effect (`window.location.href = "/login/"`), so any component that uses it inherits "redirect to login on 401" — correct for authenticated pages, wrong for a page a logged-out visitor is supposed to see. A public component that calls `authFetch()` against an authenticated endpoint will bounce itself to `/login/` the instant the visitor has no session, i.e. almost immediately.
>
> This bit the `/` Overview splash (`components/public/overview-card.tsx`): its `useUnitPreferences()` hook (`hooks/use-system-settings.ts`) called `authFetch()` against `system/settings.sh`, 401ing for every logged-out visitor and redirecting the public landing page to `/login/`. Fixed by switching it to a plain `fetch()` with a graceful celsius/km fallback on non-2xx — cookies still ride along by default (same-origin), so the authenticated dashboard still gets real unit prefs.
>
> Public hooks (`use-public-overview.ts`, `use-device-hostname.ts`, and the unit-preference read in `use-system-settings.ts`, which the splash still uses because the target has no public units endpoint yet, so signed-out visitors see Celsius; ledger B3.6) use plain `fetch()`, never `authFetch()`. The first two also pass `credentials: "omit"` since their endpoints are unauthenticated by design; `useUnitPreferences()` is shared with the logged-in dashboard so it keeps default same-origin credentials, just not the `authFetch` 401 redirect.
>
> The `/` route gate (`app/page.tsx`) has the mirror-image problem covered: it never trusts the `qm_logged_in` indicator cookie by itself to forward to `/dashboard` (a stale/foreign-domain cookie would otherwise trap the visitor in a `/dashboard` → auto-logout → `/login/` bounce) — it confirms via `auth/check.sh` first and falls back to the public splash on anything but an explicit `authenticated: true`.

### Development Proxy

The `rewrites()` block in `next.config.ts` is **commented out** in the repo. For local development against a device, uncomment it. It proxies `/cgi-bin/*` (and `/qmlive/*`, the live-signal files) to the modem at `192.168.224.1`. Comment it out again before `bun run build`:

```typescript
// next.config.ts (uncomment for dev only)
async rewrites() {
  return [
    { source: "/cgi-bin/:path*", destination: "http://192.168.224.1/cgi-bin/:path*", basePath: false },
    { source: "/qmlive/:path*", destination: "http://192.168.224.1/qmlive/:path*", basePath: false },
  ];
}
```

In production, the static export makes direct client-side requests to the device.

---

## Utility Libraries

### `lib/utils.ts`

```typescript
cn(...inputs)  // Tailwind class merging (clsx + tailwind-merge)
```

### `lib/earfcn.ts`

EARFCN ↔ frequency conversion utilities for the frequency calculator.

### `lib/download-csv.ts`

CSV export helper for data tables.

### `constants/mno-presets.ts`

Carrier-specific APN and TTL/HL preset configurations.

### `constants/imei-presets.ts`

IMEI TAC preset catalog used by the IMEI Toolkit generator UI.

### `constants/network-events.ts`

Event type labels, descriptions, and severity mappings for the events UI.

### `lib/imei-utils.ts`

IMEI generation, validation, and structural parsing helpers (Luhn-based).

---

## Component Patterns

### Card Pattern

Most settings pages use a consistent card layout:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Feature Name</CardTitle>
    <CardDescription>Brief explanation</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Form fields or data display */}
  </CardContent>
  <CardFooter>
    <Button onClick={save} disabled={isSaving}>
      {isSaving ? "Saving..." : "Save Changes"}
    </Button>
  </CardFooter>
</Card>
```

### Loading / Error / Empty States

Every data-driven component handles three states:

```tsx
if (isLoading) return <Skeleton />;
if (error) return <Alert variant="destructive">{error}</Alert>;
if (!data) return <Empty icon={Icon} message="No data available" />;
```

### Reboot Dialog Pattern

Features that require a device reboot (MBN, IMEI) use a state-controlled dialog:

```tsx
const [showRebootDialog, setShowRebootDialog] = useState(false);

// Opens AFTER successful save, not before
const handleSave = async () => {
  const result = await saveSettings(payload);
  if (result.success) setShowRebootDialog(true);
};

<Dialog open={showRebootDialog} onOpenChange={setShowRebootDialog}>
  {/* Reboot confirmation content */}
</Dialog>
```

### Self-Contained Cards

Some simple features (Network Priority, FPLMN, Ethernet Status) are self-contained cards that don't use a separate hook or types file. They handle fetch/save/display within the component file itself.

---

## Sidebar Navigation

The sidebar (`app-sidebar.tsx`) defines the full navigation structure:

| Section | Items |
|---------|-------|
| **Main** | Home (Dashboard) |
| **Cellular** | Cellular Info, SMS, Custom Profiles (+ Connection Scenarios), Band Locking (+ Tower, Frequency), Cell Scanner (+ Neighbor, Calculator), Settings (+ APN, Network Priority, IMEI, FPLMN) |
| **Local Network** | Ethernet Status, Traffic Engine, Settings (TTL & MTU, Custom DNS) |
| **Monitoring** | Connection Quality (+ Network Events), Alerts, Watchdog (live "acting" / "settling" pill), Tailscale, NetBird |
| **History** | Cellular History (+ Connection History) |
| **System** | System Settings (+ Logs, Languages, Configuration Backup, Adaptive Polling) |
| **Footer** (unlabelled) | About Device, Support, Donate |
| **User menu** | Change Password, Theme, Animations, Reboot Device, Logout |

The layout is shadcn's sidebar-07 (see DESIGN.md > Components > Navigation). `NavSection` renders every group and `NavMenu` draws one sliding `.nav-indicator` pill per group. A parent with sub-items is a pure expander: its old page is its first sub-row, at the same URL, labelled through `FIRST_SUB_T_KEY` in `lib/nav-tree.ts` and active only on an exact match. Any other sub-row is active on its own route prefix. Collapsed (`collapsible="icon"`, state in the `sidebar_state` cookie), parents open their rows as a flyout. `NAV_GROUPS` (exported from `app-sidebar.tsx`) is the one tree that both the sidebar and the header breadcrumb (`resolveNavCrumbs`) read. Network Events and Ethernet Status sit on `/monitoring/events` and `/local-network/ethernet` so no sub-row prefix-matches its siblings. The old `/system-settings/connection-quality`, `/monitoring` and `/local-network` routes are client-side redirect stubs (static export cannot do server redirects). The sidebar glyphs are Material Symbols; the user-menu action items are lucide.

---

## Build & Configuration

### Scripts

```bash
bun run dev     # Development server with hot reload (API proxy only if the rewrites block is uncommented)
bun run build   # Static export to out/ directory
bun run start   # Serve the built app locally
bun run lint    # ESLint check
```

### Key Config Files

| File | Purpose |
|------|---------|
| `next.config.ts` | Static export, trailing slash, dev API proxy (commented out by default) |
| `tsconfig.json` | Strict mode, `@/*` path alias → `./*` |
| `postcss.config.mjs` | Tailwind CSS v4 PostCSS plugin |
| `eslint.config.mjs` | next/core-web-vitals + next/typescript rules |
| `components.json` | shadcn/ui configuration |
| `app/globals.css` | Tailwind imports + OKLCH theme variables |

### Path Aliases

TypeScript and Next.js are configured with `@/*` → `./*`:

```typescript
import { Button } from "@/components/ui/button";
import { useModemStatus } from "@/hooks/use-modem-status";
import type { ModemStatus } from "@/types/modem-status";
```
