// =============================================================================
// Alerts — presentation metadata (icons + i18n keys only)
// =============================================================================
// Capability truth lives in the backend and arrives via the API. This file
// carries ONLY how to present each event and channel: which icon, which i18n
// key. It must never encode which (event, channel) pairs are possible.
// =============================================================================

import type { ComponentType } from "react";
import {
  MessageSquareIcon,
  MailIcon,
  WifiOffIcon,
  Wifi as WifiIcon,
  type LucideIcon,
} from "lucide-react";
import type { AlertChannel, AlertEventKey } from "@/types/alerts";

interface ChannelMeta {
  icon: LucideIcon;
  /** i18n key under `alerts.channel_<key>_name` etc. */
  labelKey: string;
}

export const CHANNEL_META: Record<AlertChannel, ChannelMeta> = {
  sms: { icon: MessageSquareIcon, labelKey: "sms" },
  email: { icon: MailIcon, labelKey: "email" },
};

interface EventMeta {
  icon: LucideIcon;
  /** i18n keys under `alerts.event_<key>_name` / `_desc`. */
  key: string;
}

export const EVENT_META: Record<AlertEventKey, EventMeta> = {
  connection_lost: { icon: WifiOffIcon, key: "connection_lost" },
  connection_restored: { icon: WifiIcon, key: "connection_restored" },
};

// ─── Recipient masking (never show the full contact in the glance hero) ──────

/** `+14155551234` → `••• ••• 1234`; keeps the last 4 digits. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length <= 4) return phone;
  return `••• ••• ${digits.slice(-4)}`;
}

/** `you@example.com` → `y•••@example.com`; keeps first char + domain. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 1) return email;
  return `${email[0]}•••${email.slice(at)}`;
}

// Re-export for convenience so consumers import icons from one place.
export type { ComponentType };
