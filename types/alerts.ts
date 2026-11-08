// =============================================================================
// Centralized Alerts — shared type contract
// =============================================================================
// One page, one CGI (`/cgi-bin/quecmanager/monitoring/alerts.sh`), one hook.
// The model is a trigger × channel routing matrix with a SEPARATE capability
// layer: some (event, channel) pairs are physically impossible (email can't be
// sent while the internet is down), and the backend is the single source of
// truth for that. The UI RENDERS capability from the API; it never hard-codes
// which cells are possible.
// =============================================================================

export type AlertChannel = "sms" | "email";

/** The trigger events a channel can be routed to. Extensible by design — new
 *  events are an additive key here + a backend capability entry + i18n. */
export type AlertEventKey =
  | "connection_lost"
  | "connection_restored"
  | "reboot"
  | "thermal_throttling";

/** Events an older backend never sends. Absent from the capability table means
 *  the device predates the event, so the UI hides it instead of claiming it
 *  cannot send. */
export const OPTIONAL_ALERT_EVENTS: readonly AlertEventKey[] = [
  "thermal_throttling",
];

// ─── Channel transport state (identity + master enable) ──────────────────────

export interface SmsChannelState {
  enabled: boolean;
  recipient_phone: string;
  threshold_minutes: number;
  /** True when the channel has everything it needs to send. */
  configured: boolean;
}

export interface EmailChannelState {
  enabled: boolean;
  sender_email: string;
  recipient_email: string;
  /** Whether an app password is stored. The password itself is never returned. */
  app_password_set: boolean;
  threshold_minutes: number;
  /** Whether the msmtp mailer binary is present on the device. */
  msmtp_installed: boolean;
  configured: boolean;
}

export interface AlertChannels {
  sms: SmsChannelState;
  email: EmailChannelState;
}

// ─── Routing matrix (user preference) ────────────────────────────────────────

/** For each event, whether it is routed to each channel. */
export type AlertRouting = {
  events: Partial<Record<AlertEventKey, Record<AlertChannel, boolean>>>;
};

// ─── Capability matrix (physical possibility) ────────────────────────────────

export interface AlertCapabilityCell {
  sms: boolean;
  email: boolean;
  /** i18n key explaining why a channel is incapable, if it is. */
  sms_reason?: string;
  email_reason?: string;
}

export type AlertCapabilities = Partial<Record<AlertEventKey, AlertCapabilityCell>>;

// ─── Reboot history (read-only telemetry) ────────────────────────────────────

/** How a recorded reboot was classified. `unplanned` is inferred as the
 *  absence of any intentional-reboot breadcrumb — there is no positive
 *  hardware signal for it on the device. */
export type RebootCause = "watchdog" | "user" | "unplanned";

export interface RebootHistoryEntry {
  /** Unix epoch seconds of the reboot, as recorded on the device. */
  epoch: number;
  cause: RebootCause;
}

// ─── Full GET payload ────────────────────────────────────────────────────────

export interface AlertsState {
  channels: AlertChannels;
  routing: AlertRouting;
  capabilities: AlertCapabilities;
  /** Most-recent reboots (newest first), independent of alert routing. */
  reboots: RebootHistoryEntry[];
}

// ─── Save payload ────────────────────────────────────────────────────────────

export interface AlertsSavePayload {
  action: "save_settings";
  sms: {
    enabled: boolean;
    recipient_phone: string;
    threshold_minutes: number;
  };
  email: {
    enabled: boolean;
    sender_email: string;
    recipient_email: string;
    /** Only sent when the user typed a new password. */
    app_password?: string;
    threshold_minutes: number;
  };
  routing: AlertRouting;
}

// ─── Merged activity log ─────────────────────────────────────────────────────

export interface AlertLogEntry {
  /** Pre-formatted timestamp string, displayed as-is (as the legacy logs did). */
  timestamp: string;
  /** A trigger key (an `AlertEventKey` or "test"). Rows logged before the keys
   *  carry free English text, which renders as logged. */
  trigger: string;
  status: "sent" | "failed";
  recipient: string;
  channel: AlertChannel;
}

// ─── Save / test / uninstall outcome ─────────────────────────────────────────

/** A mutation's outcome. `error` is already translated (resolveErrorMessage) and
 *  `code` is the CGI error slug; both null on success. Read them from the
 *  returned result, never from hook state after the await (stale closure). */
export interface AlertsMutationResult {
  ok: boolean;
  error: string | null;
  code: string | null;
}

// ─── Ordered event list for rendering the matrix ─────────────────────────────

export const ALERT_EVENT_ORDER: AlertEventKey[] = [
  "connection_lost",
  "connection_restored",
  "reboot",
  "thermal_throttling",
];

export const ALERT_CHANNEL_ORDER: AlertChannel[] = ["sms", "email"];
