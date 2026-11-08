// Alerts — presentation metadata only. Capability truth arrives from the API;
// nothing here may encode which (event, channel) pairs are possible.

import {
  MailIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  ThermometerSunIcon,
  WifiIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";
import type { AlertChannel, AlertEventKey } from "@/types/alerts";

export const CHANNEL_GLYPH: Record<AlertChannel, LucideIcon> = {
  sms: MessageSquareIcon,
  email: MailIcon,
};

export const EVENT_GLYPH: Record<AlertEventKey, LucideIcon> = {
  connection_lost: WifiOffIcon,
  connection_restored: WifiIcon,
  reboot: RotateCcwIcon,
  thermal_throttling: ThermometerSunIcon,
};

export const channelNameKey = (channel: AlertChannel) =>
  `alerts.channels.name.${channel}`;

export const eventNameKey = (event: AlertEventKey) =>
  `alerts.coverage.event.${event}.name`;

/** The engine's trigger keys, so a log row can name the event instead of the key. */
export function isEventKey(value: string): value is AlertEventKey {
  return Object.prototype.hasOwnProperty.call(EVENT_GLYPH, value);
}

/** The i18n key naming a logged trigger, or null when the row predates trigger
 *  keys and carries free text, which then renders as logged. */
export function triggerLabelKey(trigger: string): string | null {
  if (trigger === "test") return "alerts.activity.trigger.test";
  if (isEventKey(trigger)) return eventNameKey(trigger);
  return null;
}

const KNOWN_REASONS = new Set(["email_needs_internet", "not_supported"]);

/** An unrecognised reason key falls back rather than printing a raw token. */
export const reasonKey = (reason?: string) =>
  `alerts.coverage.reason.${reason && KNOWN_REASONS.has(reason) ? reason : "not_supported"}`;
