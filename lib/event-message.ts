import type { TFunction } from "i18next";

import type { NetworkEvent, NetworkEventType } from "@/types/modem-status";

/** What a sentence needs from a row: a live event or a History row. */
export type EventMessageSource = Pick<NetworkEvent, "type" | "message" | "f">;

// =============================================================================
// Localised event sentences
// =============================================================================
// Journal-era events carry structured fields in `f` (string values). For each
// type listed here, the `events` namespace holds `message.<type>`, a sentence
// that interpolates those fields. The sentence is used only when every field it
// needs is present and non-empty; otherwise, and for every type not listed (the
// older types, whose wording lives in the backend), the row keeps the backend's
// `message`. Numeric fields are formatted for the reader's locale first.
// =============================================================================

type FieldKind = "text" | "seconds" | "kb" | "ms";

/** The fields each sentence interpolates, and how each is formatted. */
const SENTENCE_FIELDS: Partial<Record<NetworkEventType, Record<string, FieldKind>>> = {
  apn_changed: { from: "text", to: "text" },
  band_lock_changed: { rat: "text", to: "text" },
  tower_lock_changed: { rat: "text", action: "text" },
  band_failover: { to: "text" },
  tower_failover: { rsrp: "text" },
  sim_switched: { to: "text" },
  rat_priority_changed: { to: "text" },
  fplmn_cleared: {},
  scenario_switched: { to: "text" },
  dns_changed: { to: "text" },
  ttl_mtu_changed: { which: "text", from: "text", to: "text" },
  login_failed: { remaining: "text" },
  login_locked: { retry_after: "seconds" },
  password_changed: {},
  alert_send_failed: { channel: "text" },
  registration_changed: { to: "text" },
  data_call_dropped: {},
  data_call_restored: { down_s: "seconds" },
  dns_failing: { resolver: "text" },
  dns_recovered: { resolver: "text", ms: "ms" },
  broker_restarted: {},
  software_updated: { to: "text" },
  imei_changed: { from: "text", to: "text" },
  site_down: { site: "text" },
  site_up: { site: "text" },
  wan_address_changed: { family: "text", to: "text" },
  data_cid_changed: { from: "text", to: "text" },
  clock_stepped: { step_s: "seconds" },
  storage_low: { free_kb: "kb" },
  oom_kill: { proc: "text" },
  eth_link_up: { iface: "text" },
  eth_link_down: { iface: "text" },
  modem_crash: {},
  modem_recovered: {},
};

const KNOWN_REBOOT_CAUSES = ["unexpected", "update", "scheduled", "user", "watchdog"] as const;

/**
 * The restart cause of a `device_reboot` row: the `cause` field, else the
 * backend's `cause=X off=Y` message. Unplanned is the journal's word for
 * unexpected. Returns null for a cause nobody knows.
 */
export function rebootCause(event: EventMessageSource): string | null {
  let raw = event.f?.cause;
  if (!raw) raw = /(?:^|\s)cause=(\S+)/.exec(event.message)?.[1];
  if (!raw) return null;
  if (raw === "unplanned") raw = "unexpected";
  return raw;
}

/** Seconds the device was off, when the row says so and it is positive. */
function rebootOffSeconds(event: EventMessageSource): number | null {
  const raw = event.f?.off ?? /(?:^|\s)off=(\S+)/.exec(event.message)?.[1];
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

/** "The device restarted ..." without ever showing raw `cause=` text. */
function rebootMessage(event: EventMessageSource, t: TFunction, locale?: string): string {
  const cause = rebootCause(event);
  const known = cause !== null && (KNOWN_REBOOT_CAUSES as readonly string[]).includes(cause);
  const what = t(known ? `message.device_reboot_${cause}` : "message.device_reboot", {
    ns: "events",
    defaultValue: "",
    interpolation: { escapeValue: false },
  });
  if (!what) return event.message;
  const off = rebootOffSeconds(event);
  if (off === null) return what;
  return t("message.device_reboot_off", {
    ns: "events",
    what,
    duration: formatSeconds(off, locale),
    defaultValue: what,
    interpolation: { escapeValue: false },
  });
}

function unit(value: number, unitName: string, locale?: string, digits = 0): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: unitName,
    unitDisplay: "narrow",
    maximumFractionDigits: digits,
  }).format(value);
}

/** "45s", "12m", "3.5h" — one unit, the reader's locale. Sign is dropped. */
function formatSeconds(sec: number, locale?: string): string {
  const s = Math.abs(sec);
  if (s < 90) return unit(Math.round(s), "second", locale);
  if (s < 90 * 60) return unit(Math.round(s / 60), "minute", locale);
  return unit(s / 3600, "hour", locale, 1);
}

function formatKb(kb: number, locale?: string): string {
  if (kb < 1024) return unit(Math.round(kb), "kilobyte", locale);
  return unit(kb / 1024, "megabyte", locale, 1);
}

function formatField(raw: string, kind: FieldKind, locale?: string): string | null {
  if (kind === "text") return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (kind === "seconds") return formatSeconds(n, locale);
  if (kind === "kb") return formatKb(n, locale);
  return unit(Math.round(n), "millisecond", locale);
}

/**
 * The row's sentence: the localised one when the type has a sentence and `f`
 * carries every field it needs, else the backend's message.
 *
 * `t` may be bound to any namespace; the lookup names `events` explicitly.
 */
export function eventMessage(event: EventMessageSource, t: TFunction, locale?: string): string {
  if (event.type === "device_reboot") return rebootMessage(event, t, locale);
  const fields = SENTENCE_FIELDS[event.type];
  if (!fields) return event.message;

  const f = event.f ?? {};
  const values: Record<string, string> = {};
  for (const [name, kind] of Object.entries(fields)) {
    const raw = f[name];
    if (typeof raw !== "string" || raw.trim() === "") return event.message;
    const formatted = formatField(raw.trim(), kind, locale);
    if (formatted === null) return event.message;
    values[name] = formatted;
  }

  // Signed steps read as a direction; the sentence picks it by key.
  let key = `message.${event.type}`;
  if (event.type === "clock_stepped" && Number(f.step_s) < 0) key = "message.clock_stepped_back";

  const sentence = t(key, {
    ns: "events",
    ...values,
    defaultValue: "",
    interpolation: { escapeValue: false },
  });
  return sentence || event.message;
}
