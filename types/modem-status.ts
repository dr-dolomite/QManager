// =============================================================================
// modem-status.ts — QManager JSON Data Contract (TypeScript)
// =============================================================================
// This MUST stay in sync with the JSON produced by qmanager_poller.sh.
// Every field maps directly to a React component on the Home dashboard.
//
// See: QManager_Backend_Architecture.docx §6 "JSON Data Contract"
// =============================================================================

// --- Top-Level Status --------------------------------------------------------

export interface ModemStatus {
  /** Unix epoch (seconds) — updated every poll cycle */
  timestamp: number;
  /** Current system state */
  system_state: SystemState;
  /** Whether the modem responded to the last AT command */
  modem_reachable: boolean;
  /** Unix epoch of last successful modem response */
  last_successful_poll: number;
  /** Error codes (empty array = no errors) */
  errors: ErrorCode[];
  /** Network connection info */
  network: NetworkStatus;
  /** LTE (4G) serving cell data */
  lte: LteStatus;
  /** NR (5G) serving cell data */
  nr: NrStatus;
  /** Device hardware and identity info */
  device: DeviceStatus;
  /** Internet connectivity and latency (from ping daemon) */
  connectivity: ConnectivityStatus;
  /** Per-antenna signal values (from AT+QRSRP/QRSRQ/QSINR, Tier 1.5) */
  signal_per_antenna: SignalPerAntenna;
  /** Watchcat state machine data */
  watchcat: WatchcatStatus;
  /** SIM failover state (active when running on backup SIM) */
  sim_failover: SimFailoverStatus;
  /** SIM swap detection (physical SIM card change at boot) */
  sim_swap: SimSwapStatus;
  /**
   * SIM readiness snapshot (optional: a device OTA-upgraded from an older
   * poller does not emit this block, so every consumer must tolerate
   * `undefined` rather than assuming a card is present).
   */
  sim?: SimBlock;
}

/** SIM readiness block published by the poller from AT+CPIN?. */
export interface SimBlock {
  /** Classified readiness state ("unknown" until the first Tier-2 read) */
  status: SimStatus;
}

/**
 * SIM readiness from AT+CPIN? as classified by `parse_at.sh`.
 * These are the exact strings the poller emits; do not add synonyms.
 */
export type SimStatus =
  | "ready"
  | "pin_required"
  | "puk_required"
  | "not_inserted"
  | "error"
  | "unknown";

// --- Enums & Unions ----------------------------------------------------------

export type SystemState =
  | "normal"
  | "degraded"
  | "scan_in_progress"
  | "recovery_in_progress"
  | "initializing";

export type ErrorCode =
  | "modem_timeout"
  | "sim_not_inserted"
  | "command_error"
  | "poller_not_started"
  | "ping_daemon_missing";

export type ServiceStatus =
  | "optimal"
  | "connected"
  | "limited"
  | "no_service"
  | "searching"
  | "sim_error"
  | "unknown";

export type ConnectionState =
  | "connected"
  | "disconnected"
  | "searching"
  | "limited"
  | "inactive"
  | "unknown"
  | "error";

export type NetworkType = "LTE" | "5G-NSA" | "5G-SA" | "";

/** Display label for a {@link NetworkType}. */
export type NetworkTypeLabel = "LTE" | "5G NSA" | "5G SA" | "Unknown";

/**
 * Map an access technology to its display label. Never invents a technology:
 * an empty or unrecognised value returns "Unknown" rather than guessing LTE.
 */
export function networkTypeLabel(type: NetworkType): NetworkTypeLabel {
  switch (type) {
    case "LTE":
      return "LTE";
    case "5G-NSA":
      return "5G NSA";
    case "5G-SA":
      return "5G SA";
    default:
      return "Unknown";
  }
}

// --- Sub-Interfaces ----------------------------------------------------------

export interface NetworkStatus {
  /** Radio functionality level from AT+CFUN? (0=off, 1=normal, 4=RF off) */
  cfun?: number;
  /** Current access technology: LTE, 5G-NSA, 5G-SA */
  type: NetworkType;
  /** Active SIM slot (1 or 2) */
  sim_slot: number;
  /** Registered carrier/operator name */
  carrier: string;
  /** Overall service quality assessment */
  service_status: ServiceStatus;
  /** Whether LTE carrier aggregation is active (LTE SCC lines present in QCAINFO) */
  ca_active: boolean;
  /** Number of LTE secondary carriers (SCC count) */
  ca_count: number;
  /** Whether NR carrier aggregation is active (NR SCC lines present in QCAINFO) */
  nr_ca_active: boolean;
  /** Number of NR secondary carriers (NR SCC count) */
  nr_ca_count: number;
  /** Total aggregated bandwidth in MHz (PCC + all SCCs, from AT+QCAINFO) */
  total_bandwidth_mhz: number;
  /** Per-band bandwidth breakdown for tooltip, e.g. "B3: 15 MHz + N41: 100 MHz" */
  bandwidth_details: string;
  /** Active APN name from AT+CGCONTRDP (first non-IMS profile) */
  apn: string;
  /** WAN IPv4 address from AT+QMAP="WWAN" */
  wan_ipv4: string;
  /** WAN IPv6 address from AT+QMAP="WWAN" (empty string if not assigned) */
  wan_ipv6: string;
  /** Primary DNS server from AT+CGCONTRDP */
  primary_dns: string;
  /** Secondary DNS server from AT+CGCONTRDP */
  secondary_dns: string;
  /** Primary DNS IPv4 address (populated for both single-stack and dual-stack APNs) */
  primary_dns_v4: string;
  /** Primary DNS IPv6 address (empty for single-stack IPv4-only APNs) */
  primary_dns_v6: string;
  /** Secondary DNS IPv4 address (populated for both single-stack and dual-stack APNs) */
  secondary_dns_v4: string;
  /** Secondary DNS IPv6 address (empty for single-stack IPv4-only APNs) */
  secondary_dns_v6: string;
  /** Per-carrier component details from AT+QCAINFO (PCC + all SCCs) */
  carrier_components: CarrierComponent[];
}

/** A single carrier component from AT+QCAINFO (PCC or SCC) */
export interface CarrierComponent {
  /** Carrier type: PCC (primary) or SCC (secondary) */
  type: "PCC" | "SCC";
  /** Radio technology */
  technology: "LTE" | "NR";
  /** Band name in 3GPP notation, e.g. "B3" or "N41" */
  band: string;
  /** E-UTRA/NR ARFCN */
  earfcn: number | null;
  /** Bandwidth in MHz */
  bandwidth_mhz: number;
  /** Physical Cell ID */
  pci: number | null;
  /** Reference Signal Received Power (dBm) */
  rsrp: number | null;
  /** Reference Signal Received Quality (dB) */
  rsrq: number | null;
  /** Received Signal Strength Indication (dBm). LTE only, null for NR. */
  rssi: number | null;
  /** Signal to Interference plus Noise Ratio (dB). NR values are already converted (raw/100). */
  sinr: number | null;
}

export interface LteStatus {
  /** Connection state */
  state: ConnectionState;
  /** Band name in 3GPP notation, e.g. "B3" */
  band: string;
  /** E-UTRA Absolute Radio Frequency Channel Number */
  earfcn: number | null;
  /** Downlink bandwidth in MHz */
  bandwidth: number | null;
  /** Physical Cell ID */
  pci: number | null;
  /** Cell ID (28-bit E-UTRAN Cell Identity) as decimal */
  cell_id: number | null;
  /** eNodeB ID — top 20 bits of Cell ID (cell_id >> 8) */
  enodeb_id: number | null;
  /** Sector ID — bottom 8 bits of Cell ID (cell_id & 0xFF) */
  sector_id: number | null;
  /** Tracking Area Code as decimal */
  tac: number | null;
  /** Reference Signal Received Power (dBm) — always a negative number */
  rsrp: number | null;
  /** Reference Signal Received Quality (dB) — always a negative number */
  rsrq: number | null;
  /** Signal to Interference plus Noise Ratio (dB) */
  sinr: number | null;
  /** Received Signal Strength Indicator (dBm) */
  rssi: number | null;
  /** Timing Advance index (0–1282). Used for cell distance estimation. */
  ta: number | null;
  /**
   * Origin of rsrp/rsrq/rssi in this snapshot: "at" (this or the last AT read)
   * or "qmi" (gap-filled from the broker's QMI sampler between AT reads).
   * Absent on pollers older than QMI Phase 2.
   */
  source?: "at" | "qmi";
}

export interface NrStatus {
  /** Connection state */
  state: ConnectionState;
  /** Band name in 3GPP notation, e.g. "N41" */
  band: string;
  /** NR Absolute Radio Frequency Channel Number */
  arfcn: number | null;
  /** Physical Cell ID */
  pci: number | null;
  /** Cell ID (36-bit NR Cell Identity) as decimal. Only populated in SA mode. */
  cell_id: number | null;
  /** gNodeB ID — top 22 bits of Cell ID (cell_id >> 14). Only populated in SA mode. */
  enodeb_id: number | null;
  /** Sector ID — bottom 14 bits of Cell ID (cell_id & 0x3FFF). Only populated in SA mode. */
  sector_id: number | null;
  /** Tracking Area Code as decimal. Only populated in SA mode. */
  tac: number | null;
  /** Reference Signal Received Power (dBm) */
  rsrp: number | null;
  /** Reference Signal Received Quality (dB) */
  rsrq: number | null;
  /** Signal to Interference plus Noise Ratio (dB) */
  sinr: number | null;
  /** Subcarrier Spacing in kHz (15, 30, 60, 120) */
  scs: number | null;
  /** NR Timing Advance (NTA value). Used for cell distance estimation. */
  ta: number | null;
}

export interface DeviceStatus {
  /** Live adaptive-polling backoff tier the poller is currently running at. */
  poller_tier?: PollerTier;
  /** Uptime seconds of the last successful QMI read (0 = never or no sidecar). */
  qmi_read_mono?: number;
  /** QMI lane state from the broker sidecar ("" = no sidecar). */
  qmi_state?: "" | "up" | "down" | "unavailable";
  /** Baseband SSR episodes the broker has counted since it started. */
  qmi_ssr_count?: number;
  /** Average modem temperature in °C across all available sensors (null if unavailable) */
  temperature: number | null;
  /** CPU usage percentage (0–100), calculated from /proc/stat delta between poll cycles */
  cpu_usage: number;
  /** Used memory in MB */
  memory_used_mb: number;
  /** Total memory in MB */
  memory_total_mb: number;
  /** Device uptime in seconds */
  uptime_seconds: number;
  /** Active connection uptime in seconds */
  conn_uptime_seconds: number;
  /** Firmware version string (from AT+CVERSION) */
  firmware: string;
  /** Firmware build date, e.g. "Jun 25 2025" (from AT+CVERSION) */
  build_date: string;
  /** Modem manufacturer, e.g. "Quectel" (the "Authors:" line of ATI) */
  manufacturer: string;
  /** Modem model name, e.g. "RM551E-GL" (from AT+CGMM) */
  model: string;
  /** Device IMEI (15-digit) */
  imei: string;
  /** SIM IMSI */
  imsi: string;
  /** SIM ICCID */
  iccid: string;
  /** Phone number (MSISDN) */
  phone_number: string;
  /** LTE UE Category, e.g. "20" (from AT+QGETCAPABILITY) */
  lte_category: string;
  /** Active MIMO layers, e.g. "LTE 1x4" or "LTE 1x4 | NR 2x4" (Tier 2, updates with signal conditions) */
  mimo: string;
  /** Hardware-supported LTE bands, colon-delimited (boot-only, from AT+QNWPREFCFG="policy_band") */
  supported_lte_bands: string;
  /** Hardware-supported NSA NR5G bands, colon-delimited (boot-only) */
  supported_nsa_nr5g_bands: string;
  /** Hardware-supported SA NR5G bands, colon-delimited (boot-only) */
  supported_sa_nr5g_bands: string;
  /** Hardware-supported NR-DC bands, colon-delimited (boot-only, from AT+QNWPREFCFG="policy_band") */
  supported_nrdc_nr5g_bands: string;
  /**
   * Full LTE band capability from the static spec-sheet file
   * (/etc/qmanager/supported_bands_hw.env). Superset of supported_lte_bands.
   * Drives the checkbox universe; supported_lte_bands marks the network/SIM-used subset.
   */
  hw_lte_bands: string;
  /** Full NSA NR5G band capability (static spec-sheet file). Superset of supported_nsa_nr5g_bands. */
  hw_nsa_nr5g_bands: string;
  /** Full SA NR5G band capability (static spec-sheet file). Superset of supported_sa_nr5g_bands. */
  hw_sa_nr5g_bands: string;
  /** QManager version string */
  qmanager_version: string;
}

// --- On-Demand Radio Details -------------------------------------------------

/**
 * Radio details fetched ON-DEMAND from the dedicated CGI endpoint
 * (`/cgi-bin/quecmanager/cellular/radio_details.sh`), NOT from the recurring
 * poller. These L1-adjacent reads (MIMO layers, timing advance, CGCONTRDP,
 * QMAP) were taken off the poller as a suspected contributor to RM551E baseband
 * restarts; they are now read only while a page that displays them is open.
 *
 * The poller's status.json STILL carries last-known values for these fields
 * (network.mimo lives in `device.mimo`, TA in `lte.ta`/`nr.ta`, etc.), so
 * consumers prefer the live on-demand value while mounted and fall back to the
 * poller snapshot before the first on-demand fetch returns / when stale.
 *
 * INVARIANT: every string field is ALWAYS present, never JSON null — an empty
 * string `""` means unknown/not-applicable. `lte_ta`/`nr_ta` are numeric
 * STRINGS or `""`. `mimo` is a display label, e.g. "LTE 1x4 | NR 2x4".
 */
export interface RadioDetails {
  /** Active MIMO layers display label, e.g. "LTE 1x4 | NR 2x4" / "LTE 1x4" / "NR 2x4" / "" */
  mimo: string;
  /** LTE Timing Advance index as a numeric string (0–1282), or "" if unavailable. */
  lte_ta: string;
  /** NR Timing Advance (NTA) value as a numeric string, or "" if unavailable. */
  nr_ta: string;
  /** Active APN name (AT+CGCONTRDP), or "" if unavailable. */
  apn: string;
  /** WAN IPv4 address (AT+QMAP), or "" if unassigned. */
  wan_ipv4: string;
  /** WAN IPv6 address (AT+QMAP), or "" if unassigned. */
  wan_ipv6: string;
  /** Primary DNS server (AT+CGCONTRDP), or "" if unavailable. */
  primary_dns: string;
  /** Secondary DNS server (AT+CGCONTRDP), or "" if unavailable. */
  secondary_dns: string;
  /** Primary DNS IPv4 address, or "". */
  primary_dns_v4: string;
  /** Primary DNS IPv6 address (empty for single-stack IPv4-only APNs). */
  primary_dns_v6: string;
  /** Secondary DNS IPv4 address, or "". */
  secondary_dns_v4: string;
  /** Secondary DNS IPv6 address (empty for single-stack IPv4-only APNs). */
  secondary_dns_v6: string;
  /** Unix epoch (seconds) of the last successful on-demand read. 0 = never fetched. */
  updated_at: number;
}

/** Success envelope for the on-demand radio-details endpoint. */
export interface RadioDetailsResponse {
  success: true;
  /** true = modem was unreachable this call; `details` are last-known values. */
  stale: boolean;
  details: RadioDetails;
}

/** Error envelope for the on-demand radio-details endpoint. */
export interface RadioDetailsErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

// --- Utility Types -----------------------------------------------------------

/** A serving-cell / per-carrier metric with a 3GPP reported range. */
export type ServingMetric = "rsrp" | "rsrq" | "sinr" | "rssi";

/**
 * The 3GPP REPORTED range for each metric — the interval a real measurement can
 * physically fall in. Anything outside it is not a bad reading, it is not a
 * reading: an unavailable marker, a raw field in the wrong unit, or a parse
 * that grabbed the wrong CSV column. (`AT+QCAINFO`'s LTE line reports RSSNR as
 * a raw value, so `carrier_components[].sinr` can read 251 where the real SINR
 * is 8 dB.)
 *
 * Ported from the RM520N source with the public splash (ledger U3.4). The
 * source also folds this range into `SignalThresholds` so `getSignalQuality()`
 * refuses out-of-range values itself; here only `normalizeMetricValue()` uses
 * it, and the threshold change lands with the five-stop quality model.
 */
export const METRIC_RANGES: Record<ServingMetric, { min: number; max: number }> = {
  rsrp: { min: -156, max: -31 }, // 36.133 / 38.133 RSRP reporting range
  rsrq: { min: -43, max: 20 }, // 36.133 extended RSRQ range
  sinr: { min: -23, max: 40 }, // 36.133 RS-SINR reporting range
  rssi: { min: -120, max: -25 },
};

/**
 * The single read boundary for a serving-cell / per-carrier value. Returns
 * `null` for anything outside the physical range, so the value, its bar and
 * its quality verdict all resolve through the one "not reported" path instead
 * of disagreeing with each other.
 */
export function normalizeMetricValue(
  value: number | null | undefined,
  metric: ServingMetric,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const { min, max } = METRIC_RANGES[metric];
  return value < min || value > max ? null : value;
}

/** Signal quality thresholds for UI indicators */
export interface SignalThresholds {
  excellent: number;
  good: number;
  fair: number;
  poor: number;
}

/** RSRP thresholds (dBm) — higher (less negative) is better */
export const RSRP_THRESHOLDS: SignalThresholds = {
  excellent: -80,
  good: -100,
  fair: -110,
  poor: -140,
};

/** RSRQ thresholds (dB) — higher (less negative) is better */
export const RSRQ_THRESHOLDS: SignalThresholds = {
  excellent: -5,
  good: -10,
  fair: -15,
  poor: -20,
};

/** SINR thresholds (dB) — higher is better */
export const SINR_THRESHOLDS: SignalThresholds = {
  excellent: 20,
  good: 13,
  fair: 0,
  poor: -20,
};

/**
 * Categorizes a signal value into a quality level based on thresholds.
 * Works for any metric where higher = better.
 */
export function getSignalQuality(
  value: number | null,
  thresholds: SignalThresholds,
): "excellent" | "good" | "fair" | "poor" | "none" {
  if (value === null || value === undefined) return "none";
  if (value >= thresholds.excellent) return "excellent";
  if (value >= thresholds.good) return "good";
  if (value >= thresholds.fair) return "fair";
  return "poor";
}

export type SignalQuality = ReturnType<typeof getSignalQuality>;

const SIGNAL_QUALITY_RANK: Record<SignalQuality, number> = {
  excellent: 4,
  good: 3,
  fair: 2,
  poor: 1,
  none: 0,
};

/**
 * Returns the worst quality across the supplied metrics. "none" entries
 * (missing/null values) are skipped; if every input is "none", returns "none".
 * Used by the public overview "Overall" verdict so a strong RSRP can't mask
 * a poor SINR.
 */
export function worstSignalQuality(...qualities: SignalQuality[]): SignalQuality {
  const known = qualities.filter((q): q is Exclude<SignalQuality, "none"> => q !== "none");
  if (known.length === 0) return "none";
  return known.reduce<SignalQuality>(
    (worst, q) => (SIGNAL_QUALITY_RANK[q] < SIGNAL_QUALITY_RANK[worst] ? q : worst),
    known[0],
  );
}

export type ConnectivityState =
  | "connected"
  | "degraded"
  | "disconnected"
  | "recovery"
  | "unknown";

export interface ConnectivityStatus {
  /** Whether internet is reachable based on ping results. null = ping daemon not running. */
  internet_available: boolean | null;
  /** Derived connectivity status */
  status: ConnectivityState;
  /** Most recent RTT in milliseconds. null if last ping failed. */
  latency_ms: number | null;
  /** Rolling average RTT from history window */
  avg_latency_ms: number | null;
  /** Minimum RTT in history window */
  min_latency_ms: number | null;
  /** Maximum RTT in history window */
  max_latency_ms: number | null;
  /** Average inter-packet RTT variation */
  jitter_ms: number | null;
  /** Percentage of failed pings in history window (0-100) */
  packet_loss_pct: number;
  /** Currently active ping target IP */
  ping_target: string;
  /** Ring buffer of last N RTT values. null entries = failed pings. */
  latency_history: (number | null)[];
  /** Seconds between history samples */
  history_interval_sec: number;
  /** Maximum entries in history array */
  history_size: number;
  /** Whether watchcat recovery is currently active */
  during_recovery: boolean;
  /**
   * Active ping-daemon sensitivity profile (mirrors the saved ping_profile).
   * Optional: present once the daemon emits it; consumers must tolerate
   * undefined for older poller output.
   */
  profile?: PingProfile;
  /**
   * Address family of the last successful ICMP probe: "ipv4" when the primary
   * IPv4 target answered, "ipv6" when the IPv4 leg failed and the IPv6 fallback
   * carried the connection, "none" when both failed. Empty string / undefined
   * on older poller output before the field was emitted.
   */
  last_family?: "ipv4" | "ipv6" | "none" | "";
  /** Carrier-resolver lookup time in ms (10 ms steps). null when the last lookup
      failed or the sample is stale — never a stale number. Absent on an older poller. */
  dns_lookup_ms?: number | null;
  /** Resolver the lookup was timed against. null when unknown. Absent on an older poller. */
  dns_resolver?: string | null;
  /** The configured Connection Quality cuts the poller grades against: `status`
      is "degraded" at loss_pct or above. Absent on an older poller. */
  thresholds?: { latency_ms: number; loss_pct: number };
  /** Length in seconds of the most recently cleared outage this boot. null when
      none has cleared yet. Absent on an older poller. */
  last_outage_s?: number | null;
  /** Seconds since that outage cleared, on the modem's monotonic clock (immune to
      wall-clock steps). null alongside last_outage_s. Absent on an older poller. */
  last_outage_ago_s?: number | null;
  /** WAN address the bearer held when that outage cleared (IPv4 preferred), read
      from the routing table. null when unknown. Absent on an older poller. */
  last_outage_wan_ip?: string | null;
  /** Whether that address differs from the one before the outage. null when either
      side is unknown. Absent on an older poller. */
  last_outage_wan_changed?: boolean | null;
}

// --- Connection Quality Settings ---------------------------------------------

/**
 * Ping-daemon sensitivity profiles. The daemon (`qmanager_ping`) is the source
 * of truth for the profile→interval/threshold table; UCI stores only the name.
 * The UI uses this list purely to render the segmented control and preview
 * per-preset timing before save.
 */
export const PING_PROFILES = ["sensitive", "regular", "relaxed", "quiet"] as const;
export type PingProfile = (typeof PING_PROFILES)[number];

/**
 * Latency / packet-loss tolerance presets for quality thresholds. These
 * thresholds are now SHARED: the poller fires Recent-Activities events off them,
 * and the watchdog (when quality recovery is enabled) recovers off them. `custom`
 * carries a user-entered raw value (latency ms / loss %) instead of a named
 * preset's built-in number — see `QualityThresholdsSettings`.
 */
export const QUALITY_PRESETS = [
  "standard",
  "tolerant",
  "very-tolerant",
  "custom",
] as const;
export type QualityPreset = (typeof QUALITY_PRESETS)[number];

/** The three named presets, without `custom` — for rendering preset metadata. */
export const QUALITY_NAMED_PRESETS = [
  "standard",
  "tolerant",
  "very-tolerant",
] as const;
export type QualityNamedPreset = (typeof QUALITY_NAMED_PRESETS)[number];

/**
 * Saved quality-threshold settings. The nested shape mirrors the GET envelope
 * (`thresholds.latency.preset` / `thresholds.loss.preset`); the save hook
 * flattens it to the flat wire keys the shell CGI parses. When a side's preset
 * is `custom`, its `custom_ms` / `custom_pct` carries the raw value.
 */
export interface QualityThresholdsSettings {
  latency: { preset: QualityPreset; custom_ms?: number | null };
  loss: { preset: QualityPreset; custom_pct?: number | null };
}

// --- Adaptive Polling --------------------------------------------------------

/**
 * Live backoff tier the poller is running at. `active` = full ~2 s rate (UI is
 * being viewed), `idle` = slowed, `deep` = minimal background polling.
 */
export type PollerTier = "active" | "idle" | "deep";

/**
 * UI-aware poller backoff settings. All intervals/thresholds are in seconds.
 * Mirrors the flat wire keys the shell CGI parses on both GET and POST.
 */
export interface AdaptivePollingSettings {
  /** Master switch — when false the poller stays at full rate always. */
  enabled: boolean;
  /** Stay at full rate this long after the UI is closed (seconds). */
  active_grace: number;
  /** How often to poll while idle (seconds). */
  idle_interval: number;
  /** Seconds of idleness before idle becomes deep-idle. */
  idle_threshold: number;
  /** How often to poll while deep-idle (seconds). */
  deep_idle_interval: number;
}

// --- Watchcat State (from /tmp/qmanager_watchcat.json via poller) ------------

export type WatchcatState =
  | "monitor"
  | "suspect"
  | "recovery"
  | "cooldown"
  | "locked"
  | "disabled"
  // Holding the recovery ladder while a recoverable baseband (MPSS) restart
  // self-heals. Passed through verbatim from the daemon by the poller.
  | "ssr_hold"
  // The radio is off (airplane mode / CFUN 0), so the daemon is holding off
  // rather than treating the dead link as an outage.
  | "radio_off";

export interface WatchcatStatus {
  enabled: boolean;
  state: WatchcatState;
  current_tier: number;
  failure_count: number;
  last_recovery_time: number | null;
  last_recovery_tier: number | null;
  total_recoveries: number;
  cooldown_remaining: number;
  reboots_this_hour: number;
  /**
   * Seconds since the daemon last wrote its state. Absent (or null) on older
   * backends and while unknown: treated as live, never as stale.
   */
  age_sec?: number | null;
  /** Age in seconds beyond which `age_sec` means the daemon stopped reporting. */
  stale_after?: number | null;
}

export interface SimFailoverStatus {
  active: boolean;
  original_slot: number | null;
  current_slot: number | null;
  switched_at: number | null;
}

export interface SimSwapStatus {
  detected: boolean;
  matching_profile_id: string | null;
  matching_profile_name: string | null;
}

// --- Per-Antenna Signal Data -------------------------------------------------

/**
 * Metadata for each of the 4 antenna ports (ANT0–ANT3).
 * Shared across antenna-statistics, antenna-alignment, and any future per-port UI.
 */
export const ANTENNA_PORTS = [
  {
    name: "Main",
    rx: "PRX",
    description: "Main transmit/receive antenna (ANT0)",
  },
  {
    name: "Diversity",
    rx: "DRX",
    description: "Diversity / receive antenna (ANT1)",
  },
  { name: "MIMO 3", rx: "RX2", description: "MIMO spatial stream 1 (ANT2)" },
  { name: "MIMO 4", rx: "RX3", description: "MIMO spatial stream 2 (ANT3)" },
] as const;

/**
 * Per-antenna signal values from AT+QRSRP, AT+QRSRQ, AT+QSINR.
 * Each array has 4 elements [ant0, ant1, ant2, ant3].
 *
 * A `null` entry means the poller recognised an inactive port. It does NOT mean
 * every inactive port arrives as null — the poller only translates `-32768`, and
 * the modem has two other ways of saying "not measured" that arrive as plain
 * numbers. Read every value through `normalizeSignalValue()` rather than testing
 * it against null directly; see SIGNAL_SENTINELS below.
 */
export interface SignalPerAntenna {
  lte_rsrp: (number | null)[];
  lte_rsrq: (number | null)[];
  lte_sinr: (number | null)[];
  nr_rsrp: (number | null)[];
  nr_rsrq: (number | null)[];
  nr_sinr: (number | null)[];
}

/** The three per-antenna metrics, used to select a sentinel set. */
export type SignalMetric = "rsrp" | "rsrq" | "sinr";

/**
 * Values that mean "this port did not measure anything", per metric.
 *
 * These are NOT thresholds and they are NOT interchangeable across metrics — the
 * set is deliberately different for each one, because the hazard is that a
 * sentinel sits exactly on that metric's `poor` floor. `getSignalQuality()` then
 * scores it "poor" and `signalToProgress()` returns 0, so an unused antenna
 * renders as a legible, plausible, wrong reading — an empty red bar labelled
 * "-140 dBm" — which is worse than a blank, because it looks like a signal
 * problem the user should go and fix.
 *
 * Verified against 117 live samples on RM520NGLAAR03A03M4G_A0.303, and the
 * same `-140` + null pattern re-confirmed in the RM551E signal history
 * (2026-10-19, QManager port U4.14):
 *
 * - `-32768` is the documented sentinel and is handled by the poller
 *   (`parse_at.sh:20-23`). It occurred ZERO times. It stays here for firmware
 *   that does emit it, but it is not the case that bites.
 * - `-140` (RSRP) is the 3GPP floor, and it lands in the same sample and the
 *   same port index as `null` in that port's RSRQ and SINR — the modem saying
 *   "port off" three ways at once, of which the poller understands one.
 * - `-20` (SINR) appears WITHOUT a corroborating null, so it is the only signal
 *   available that an NR chain is idle. A genuine -20 dB SINR is unusable by
 *   definition (it is the bottom of the scale), so suppressing the real value
 *   costs nothing a user could act on.
 * - `-20` is NOT a sentinel for RSRQ even though it is RSRQ's `poor` floor: the
 *   same capture contains a legitimate `-19` dB RSRQ, so that region of the
 *   range is genuinely reachable by real data. Only `-32768` is suppressed there.
 */
const SIGNAL_SENTINELS: Record<SignalMetric, ReadonlySet<number>> = {
  rsrp: new Set([-140, -32768]),
  rsrq: new Set([-32768]),
  sinr: new Set([-20, -32768]),
};

/**
 * The single read boundary for a per-antenna value. Returns `null` for anything
 * the radio did not actually measure, so downstream quality, progress and
 * "is this port live" logic all agree.
 *
 * Every per-antenna surface goes through this. Two pages reading one field
 * through two different sentinel policies is what let antenna-statistics call a
 * dead chain "poor" while antenna-alignment called the same chain "—".
 */
export function normalizeSignalValue(
  value: number | null | undefined,
  metric: SignalMetric
): number | null {
  if (value === null || value === undefined) return null;
  return SIGNAL_SENTINELS[metric].has(value) ? null : value;
}

/**
 * Whether a given antenna port is reporting anything at all for one radio.
 *
 * Port liveness has to be asked per RAT, not per port: in EN-DC a chain can be
 * carrying LTE while reporting nothing for NR, and the answer "is MIMO 3 live?"
 * is then genuinely different for each leg.
 */
export function isPortReporting(
  signal: SignalPerAntenna | undefined,
  index: number,
  prefix: "lte" | "nr"
): boolean {
  if (!signal) return false;
  return (
    normalizeSignalValue(signal[`${prefix}_rsrp`][index], "rsrp") !== null ||
    normalizeSignalValue(signal[`${prefix}_rsrq`][index], "rsrq") !== null ||
    normalizeSignalValue(signal[`${prefix}_sinr`][index], "sinr") !== null
  );
}

/** Whether a radio has any reporting port at all. */
export function hasAntennaData(
  signal: SignalPerAntenna | undefined,
  prefix: "lte" | "nr"
): boolean {
  if (!signal) return false;
  return ANTENNA_PORTS.some((_, i) => isPortReporting(signal, i, prefix));
}

/**
 * A single entry from the signal history NDJSON file.
 * One line is appended every 2 seconds (Tier 1 interval).
 */
export interface SignalHistoryEntry {
  /** Unix epoch (seconds) */
  ts: number;
  lte_rsrp: (number | null)[];
  lte_rsrq: (number | null)[];
  lte_sinr: (number | null)[];
  nr_rsrp: (number | null)[];
  nr_rsrq: (number | null)[];
  nr_sinr: (number | null)[];
}

/**
 * A single entry from the ping history NDJSON file.
 * One line is appended every 10 seconds (Tier 1.5 interval).
 * Short field names match the backend NDJSON output for minimal transfer size.
 */
export interface PingHistoryEntry {
  /** Unix epoch (seconds) */
  ts: number;
  /** Last RTT in ms, or null if ping failed at that sample */
  lat: number | null;
  /** Rolling average RTT in ms */
  avg: number | null;
  /** Minimum RTT in ms over ping daemon's history window */
  min: number | null;
  /** Maximum RTT in ms over ping daemon's history window */
  max: number | null;
  /** Packet loss percentage (0-100) */
  loss: number;
  /** Jitter in ms, or null if insufficient data */
  jit: number | null;
}

// --- Connectivity Utility Functions ------------------------------------------

/** Latency quality thresholds (ms) — lower is better */
export const LATENCY_THRESHOLDS = {
  excellent: 30,
  good: 60,
  fair: 100,
  poor: Infinity,
} as const;

/**
 * Categorizes a latency value into a quality level.
 * Lower latency = better quality.
 */
export function getLatencyQuality(
  latencyMs: number | null,
): "excellent" | "good" | "fair" | "poor" | "none" {
  if (latencyMs === null || latencyMs === undefined) return "none";
  if (latencyMs <= LATENCY_THRESHOLDS.excellent) return "excellent";
  if (latencyMs <= LATENCY_THRESHOLDS.good) return "good";
  if (latencyMs <= LATENCY_THRESHOLDS.fair) return "fair";
  return "poor";
}

/**
 * Formats a latency value for display.
 * e.g., 34.2 → "34ms", null → "-"
 */
export function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null || latencyMs === undefined) return "-";
  if (latencyMs < 1) return "< 1ms";
  return `${Math.round(latencyMs)}ms`;
}

/**
 * Formats jitter for display.
 * e.g., 4.8 → "4.8ms"
 */
export function formatJitter(jitterMs: number | null): string {
  if (jitterMs === null || jitterMs === undefined) return "-";
  return `${jitterMs.toFixed(1)}ms`;
}

// --- Network Events (Recent Activities) --------------------------------------

/** Event types emitted by the poller's change detection */
export type NetworkEventType =
  | "network_mode" // Network mode changed (LTE → 5G-NSA, etc.)
  | "band_change" // LTE or NR band changed
  | "pci_change" // PCC cell handoff (PCI changed)
  | "scc_pci_change" // SCC cell handoff (secondary carrier PCI changed)
  | "ca_change" // Carrier Aggregation activated/deactivated/count changed
  | "nr_anchor" // 5G NR anchor gained or lost
  | "signal_lost" // Modem became unreachable
  | "signal_restored" // Modem signal restored
  | "internet_lost" // Internet connectivity lost
  | "internet_restored" // Internet connectivity restored
  | "high_latency" // Latency exceeded 90ms threshold
  | "latency_recovered" // Latency returned below threshold
  | "high_packet_loss" // Packet loss exceeded 20% threshold
  | "packet_loss_recovered" // Packet loss returned below threshold
  | "watchcat_recovery" // Watchcat executed a recovery action (Tier 1-4)
  | "sim_failover" // SIM failover event (Tier 3 switch/fallback)
  | "sim_swap_detected" // Physical SIM card swap detected at boot
  | "airplane_mode" // Airplane mode enabled/disabled (CFUN changed)
  | "profile_applied" // Custom SIM Profile applied (complete or partial)
  | "profile_failed" // Custom SIM Profile apply failed (all steps)
  | "profile_deactivated" // Custom SIM Profile deactivated by user
  | "verizon_mpdn_applied" // Verizon MPDN rule set to PDP context 3
  | "verizon_mpdn_reverted" // Verizon MPDN rule reverted to default PDP context 1
  | "config_backup_collected" // Configuration backup collected
  | "config_restore_started" // Configuration restore started
  | "config_restore_section_success" // Single section restored
  | "config_restore_section_failed" // Single section failed after retries
  | "config_restore_section_skipped" // Single section skipped (incompatible or sim_mismatch)
  | "config_restore_completed" // Configuration restore completed
  | "lan_address_changed" // LAN IP address / subnet changed by user
  | "apn_reapplied" // APN profile restored after a SIM profile deactivation
  | "apn_reapply_failed"; // APN profile could not be restored after deactivation

/** Severity level for UI icon coloring */
export type EventSeverity = "info" | "warning" | "error";

/** A single network event from the poller's NDJSON events file */
export interface NetworkEvent {
  /** Unix epoch (seconds) when the event was detected */
  timestamp: number;
  /** Event classification */
  type: NetworkEventType;
  /** Human-readable description of the event */
  message: string;
  /** Severity for UI indicator (info = green, warning = amber) */
  severity: EventSeverity;
}

// --- Formatting Utilities ----------------------------------------------------

/**
 * Formats bytes per second into a human-readable string.
 * e.g., 1562500 → "12.5 Mbps"
 */
export function formatBytesPerSec(bytesPerSec: number): string {
  const bitsPerSec = bytesPerSec * 8;
  if (bitsPerSec >= 1_000_000) {
    return `${(bitsPerSec / 1_000_000).toFixed(1)} Mbps`;
  }
  if (bitsPerSec >= 1_000) {
    return `${(bitsPerSec / 1_000).toFixed(0)} Kbps`;
  }
  return `${bitsPerSec} bps`;
}

/**
 * Formats total bytes into a human-readable string.
 * e.g., 1073741824 → "1.0 GB"
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) {
    return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  }
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }
  if (bytes >= 1_024) {
    return `${(bytes / 1_024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

// --- Cell Distance Calculations (3GPP) --------------------------------------

/**
 * Calculates LTE cell distance from Timing Advance index.
 * Based on 3GPP TS 36.213: NTA = 16 × TA, TS = 1/(2048×15000).
 * Distance = (c × NTA × TS) / 2.
 * @param ta - LTE TA index (0–1282)
 * @returns distance in km, or null if TA is unavailable/invalid
 */
export function calculateLteDistance(ta: number | null): number | null {
  if (ta === null || ta === undefined || ta < 0 || ta > 1282) return null;
  const NTA = 16 * ta;
  const TS = 1 / 30720000; // 1/(2048×15000)
  const SPEED_OF_LIGHT = 3e8;
  return (SPEED_OF_LIGHT * NTA * TS) / 2 / 1000;
}

/**
 * Calculates NR cell distance from NTA value.
 * Based on 3GPP TS 38.213: TC = 1/(480×10³×4096).
 * Distance = (c × NTA × TC) / 2.
 * @param nta - NR NTA value (already NTA, not TA index)
 * @returns distance in km, or null if NTA is unavailable/invalid
 */
export function calculateNrDistance(nta: number | null): number | null {
  if (nta === null || nta === undefined || nta < 0) return null;
  const TC = 1 / (480 * 1000 * 4096);
  const SPEED_OF_LIGHT = 3e8;
  return (SPEED_OF_LIGHT * nta * TC) / 2 / 1000;
}

/**
 * Formats a distance in km to a human-readable string.
 * e.g., 0.156 → "156 m", 1.234 → "1.23 km"
 * When unit is "miles", converts to imperial (feet/miles).
 */
export function formatDistance(
  km: number | null,
  unit?: "km" | "miles",
): string {
  if (km === null) return "-";
  if (unit === "miles") {
    const miles = km * 0.621371;
    if (miles < 0.01) return "< 50 ft";
    if (miles < 1) return `${Math.round(miles * 5280)} ft`;
    return `${miles.toFixed(2)} mi`;
  }
  if (km < 0.01) return "< 10 m";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

/**
 * Formats a temperature for display.
 * Backend always returns Celsius; converts to Fahrenheit when requested.
 */
export function formatTemperature(
  celsius: number | null,
  unit?: "celsius" | "fahrenheit",
): string {
  if (celsius === null) return "-";
  if (unit === "fahrenheit") {
    return `${Math.round((celsius * 9) / 5 + 32)}°F`;
  }
  return `${celsius}°C`;
}

/**
 * Converts a signal value to a 0–100 percentage for progress bars.
 * Maps the value linearly within its quality range.
 */
export function signalToProgress(
  value: number | null,
  thresholds: SignalThresholds,
): number {
  if (value === null || value === undefined) return 0;
  // Map from [poor, excellent] → [0, 100]
  const range = thresholds.excellent - thresholds.poor;
  if (range === 0) return 50;
  const pct = ((value - thresholds.poor) / range) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Formats a Unix timestamp into a relative time string.
 * e.g., (now - 120) → "2m ago", (now - 3700) → "1h ago"
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 0) return "just now";
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// --- Cell ID / TAC Display Utilities -----------------------------------------

/**
 * Formats a nullable number for display, returning "-" for null/undefined.
 * Used for Cell ID, eNodeB ID, Sector ID, TAC, and similar numeric fields.
 */
export function formatNumericField(value: number | null | undefined): string {
  return value != null ? value.toString() : "-";
}

/**
 * Formats seconds into a human-readable uptime string (no seconds shown).
 * e.g., 45910 → "12h 45m", 30 → "0m", 3661 → "1h 1m"
 */
export function formatUptime(seconds: number): string {
  if (seconds <= 0) return "0m";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(" ");
}
