"use client";

import { useCallback, useMemo, useState } from "react";
import { useSaveFlash } from "@/components/ui/save-button";
import type {
  AlertsState,
  AlertsSavePayload,
  AlertChannel,
  AlertEventKey,
} from "@/types/alerts";
import { ALERT_EVENT_ORDER, ALERT_CHANNEL_ORDER } from "@/types/alerts";
import { visibleEvents } from "./derive";

// =============================================================================
// useAlertsForm — the single editable form behind the whole Alerts page
// =============================================================================
// Seeded from server truth and re-seeded in place whenever that truth changes,
// via a render-phase sync keyed on a settings signature (NOT a useEffect — the
// React-Compiler lint rules forbid setState-in-effect, and NOT a remount — a
// `key` on the consuming subtree also destroyed the save flash, the active
// channel, the show-secret toggle and every sibling card's state). Owns both
// channels, the routing and the one alert wait; a single atomic submit commits
// everything.
// =============================================================================

// E.164-ish: optional leading +, first digit 1–9, total 7–15 digits.
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The CGI's `threshold_minutes` range (alerts.sh writes it to the shared
// `alert_after_min` and mirrors it into both channel files).
export const THRESHOLD_MIN = 1;
export const THRESHOLD_MAX = 60;

function thresholdInvalid(v: string): boolean {
  if (!/^\d+$/.test(v.trim())) return true;
  const n = Number(v);
  return n < THRESHOLD_MIN || n > THRESHOLD_MAX;
}

/** The one alert wait. The GET reports the same value on both channels. */
function savedWait(state: AlertsState): string {
  return String(state.channels.sms.threshold_minutes);
}

// Value fingerprint of everything the form mirrors. A change here means server
// truth moved and the fields must be re-seeded; an identical signature (e.g. a
// refetch that returned the same values) leaves the user's edits alone.
// NOTE: the app password is represented by its `app_password_set` boolean — the
// value is never sent to the client — so a rotation (set → set) does NOT move
// the signature. Clearing the secret input after a successful save is therefore
// the settings card's job, not this sync's.
function settingsSignature(state: AlertsState): string {
  const { sms, email } = state.channels;
  const routing = ALERT_EVENT_ORDER.flatMap((ev) =>
    ALERT_CHANNEL_ORDER.map((ch) =>
      state.routing.events[ev]?.[ch] ? "1" : "0",
    ),
  ).join("");
  return [
    savedWait(state),
    sms.enabled,
    sms.recipient_phone,
    email.enabled,
    email.sender_email,
    email.recipient_email,
    email.app_password_set,
    email.msmtp_installed,
    routing,
  ].join("|");
}

export type RoutingDraft = Partial<
  Record<AlertEventKey, Record<AlertChannel, boolean>>
>;

export interface AlertsFormErrors {
  smsPhone?: boolean;
  senderEmail?: boolean;
  recipientEmail?: boolean;
  /** The one alert wait, shared by every channel. */
  threshold?: boolean;
}

export interface AlertsForm {
  // SMS channel
  smsEnabled: boolean;
  setSmsEnabled: (v: boolean) => void;
  smsPhone: string;
  setSmsPhone: (v: string) => void;

  /** The one alert wait in minutes, sent as every channel's `threshold_minutes`. */
  threshold: string;
  setThreshold: (v: string) => void;

  // Email channel
  emailEnabled: boolean;
  setEmailEnabled: (v: boolean) => void;
  senderEmail: string;
  setSenderEmail: (v: string) => void;
  recipientEmail: string;
  setRecipientEmail: (v: string) => void;
  appPassword: string;
  setAppPassword: (v: string) => void;
  /** True when the device already has a stored app password (never revealed). */
  appPasswordSet: boolean;

  // Routing
  getRoute: (event: AlertEventKey, channel: AlertChannel) => boolean;
  setRoute: (event: AlertEventKey, channel: AlertChannel, v: boolean) => void;

  // Validation / dirty state
  errors: AlertsFormErrors;
  /** Empty-while-enabled blockers, keyed like errors. */
  missing: {
    smsPhone: boolean;
    senderEmail: boolean;
    recipientEmail: boolean;
    appPassword: boolean;
  };
  isDirty: boolean;
  blocked: boolean;

  // Save lifecycle
  isSaving: boolean;
  saved: boolean;
  markSaved: () => void;
  buildPayload: () => AlertsSavePayload;
  discard: () => void;
}

export function useAlertsForm({
  state,
  isSaving,
}: {
  state: AlertsState;
  isSaving: boolean;
}): AlertsForm {
  const { sms, email } = state.channels;
  const { saved, markSaved } = useSaveFlash();

  // ── Seed once from server truth ────────────────────────────────────────────
  const [smsEnabled, setSmsEnabled] = useState(sms.enabled);
  const [smsPhone, setSmsPhone] = useState(sms.recipient_phone);
  const currentWait = savedWait(state);
  const [threshold, setThreshold] = useState(currentWait);

  const [emailEnabled, setEmailEnabled] = useState(email.enabled);
  const [senderEmail, setSenderEmail] = useState(email.sender_email);
  const [recipientEmail, setRecipientEmail] = useState(email.recipient_email);
  const [appPassword, setAppPassword] = useState(""); // never pre-filled

  const seedRouting = useCallback((): RoutingDraft => {
    const draft: RoutingDraft = {};
    for (const ev of ALERT_EVENT_ORDER) {
      const row = {} as Record<AlertChannel, boolean>;
      draft[ev] = row;
      for (const ch of ALERT_CHANNEL_ORDER) {
        const capable = state.capabilities[ev]?.[ch] ?? false;
        row[ch] = capable && (state.routing.events[ev]?.[ch] ?? false);
      }
    }
    return draft;
  }, [state]);

  const [routing, setRouting] = useState<RoutingDraft>(seedRouting);

  const getRoute = useCallback(
    (event: AlertEventKey, channel: AlertChannel) =>
      routing[event]?.[channel] ?? false,
    [routing],
  );
  const setRoute = useCallback(
    (event: AlertEventKey, channel: AlertChannel, v: boolean) => {
      // Never allow routing on an incapable cell.
      if (!(state.capabilities[event]?.[channel] ?? false)) return;
      setRouting((prev) => ({
        ...prev,
        [event]: { ...prev[event], [channel]: v },
      }));
    },
    [state.capabilities],
  );

  // ── Format validation (only when a value is present) ───────────────────────
  const errors: AlertsFormErrors = useMemo(
    () => ({
      smsPhone: !!smsPhone && !PHONE_REGEX.test(smsPhone),
      senderEmail: !!senderEmail && !EMAIL_REGEX.test(senderEmail),
      recipientEmail: !!recipientEmail && !EMAIL_REGEX.test(recipientEmail),
      threshold: thresholdInvalid(threshold),
    }),
    [smsPhone, senderEmail, recipientEmail, threshold],
  );

  // ── Empty-while-enabled blockers ───────────────────────────────────────────
  const missing = useMemo(
    () => ({
      smsPhone: smsEnabled && smsPhone.trim() === "",
      senderEmail: emailEnabled && senderEmail.trim() === "",
      recipientEmail: emailEnabled && recipientEmail.trim() === "",
      // A new secret is required only when none is stored yet.
      appPassword:
        emailEnabled && !email.app_password_set && appPassword.trim() === "",
    }),
    [
      smsEnabled,
      smsPhone,
      emailEnabled,
      senderEmail,
      recipientEmail,
      appPassword,
      email.app_password_set,
    ],
  );

  // Format errors matter only on an enabled channel; the shared wait always does.
  const hasFormatError =
    errors.threshold ||
    (smsEnabled && errors.smsPhone) ||
    (emailEnabled && (errors.senderEmail || errors.recipientEmail));
  const hasMissing =
    missing.smsPhone ||
    missing.senderEmail ||
    missing.recipientEmail ||
    missing.appPassword;
  const blocked = !!hasFormatError || hasMissing;

  // ── Dirty check vs seeded server truth ─────────────────────────────────────
  const routingDirty = useMemo(() => {
    for (const ev of ALERT_EVENT_ORDER) {
      for (const ch of ALERT_CHANNEL_ORDER) {
        const capable = state.capabilities[ev]?.[ch] ?? false;
        const server = capable && (state.routing.events[ev]?.[ch] ?? false);
        if ((routing[ev]?.[ch] ?? false) !== server) return true;
      }
    }
    return false;
  }, [routing, state]);

  const isDirty =
    smsEnabled !== sms.enabled ||
    smsPhone !== sms.recipient_phone ||
    threshold !== currentWait ||
    emailEnabled !== email.enabled ||
    senderEmail !== email.sender_email ||
    recipientEmail !== email.recipient_email ||
    appPassword.trim() !== "" ||
    routingDirty;

  // ── Payload / discard ──────────────────────────────────────────────────────
  const buildPayload = useCallback((): AlertsSavePayload => {
    // Only events the device advertised go out, so an older backend never
    // receives a key it does not know.
    const events: RoutingDraft = {};
    for (const ev of visibleEvents(state.capabilities)) {
      const row = {} as Record<AlertChannel, boolean>;
      events[ev] = row;
      for (const ch of ALERT_CHANNEL_ORDER) {
        const capable = state.capabilities[ev]?.[ch] ?? false;
        row[ch] = capable && (routing[ev]?.[ch] ?? false);
      }
    }
    // The one wait goes out as both channels' value, so neither can drift.
    const wait = parseInt(threshold, 10);
    const payload: AlertsSavePayload = {
      action: "save_settings",
      sms: {
        enabled: smsEnabled,
        recipient_phone: smsPhone.trim(),
        threshold_minutes: wait,
      },
      email: {
        enabled: emailEnabled,
        sender_email: senderEmail.trim(),
        recipient_email: recipientEmail.trim(),
        threshold_minutes: wait,
      },
      routing: { events },
    };
    if (appPassword.trim() !== "") payload.email.app_password = appPassword;
    return payload;
  }, [
    state.capabilities,
    routing,
    smsEnabled,
    smsPhone,
    threshold,
    emailEnabled,
    senderEmail,
    recipientEmail,
    appPassword,
  ]);

  const discard = useCallback(() => {
    setSmsEnabled(sms.enabled);
    setSmsPhone(sms.recipient_phone);
    setThreshold(currentWait);
    setEmailEnabled(email.enabled);
    setSenderEmail(email.sender_email);
    setRecipientEmail(email.recipient_email);
    setAppPassword("");
    setRouting(seedRouting());
  }, [sms, email, currentWait, seedRouting]);

  // ── Re-seed on server-truth change (render-phase, React-Compiler safe) ──────
  // `discard` is the already-correct re-seed path (pure setState, no async, no
  // toast), so reuse it rather than maintaining a parallel seeding path.
  const signature = settingsSignature(state);
  const [prevSignature, setPrevSignature] = useState(signature);
  if (signature !== prevSignature) {
    setPrevSignature(signature);
    discard();
  }

  return {
    smsEnabled,
    setSmsEnabled,
    smsPhone,
    setSmsPhone,
    threshold,
    setThreshold,
    emailEnabled,
    setEmailEnabled,
    senderEmail,
    setSenderEmail,
    recipientEmail,
    setRecipientEmail,
    appPassword,
    setAppPassword,
    appPasswordSet: email.app_password_set,
    getRoute,
    setRoute,
    errors,
    missing,
    isDirty,
    blocked,
    isSaving,
    saved,
    markSaved,
    buildPayload,
    discard,
  };
}

/** Which channels hold a field error. The shared wait belongs to no channel. */
export function blockedChannelMap(
  form: AlertsForm,
): Record<AlertChannel, boolean> {
  const { errors, missing } = form;
  return {
    sms: (form.smsEnabled && !!errors.smsPhone) || missing.smsPhone,
    email:
      (form.emailEnabled && (!!errors.senderEmail || !!errors.recipientEmail)) ||
      missing.senderEmail ||
      missing.recipientEmail ||
      missing.appPassword,
  };
}
