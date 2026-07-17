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

// =============================================================================
// useAlertsForm — the single editable form behind the whole Alerts page
// =============================================================================
// Seeded ONCE from server truth (the page remounts this on a settings
// signature after every save / refetch, so no in-render setState is needed and
// the React Compiler lint rules stay satisfied). Owns both channels and the
// routing matrix; a single atomic submit commits everything.
// =============================================================================

// E.164-ish: optional leading +, first digit 1–9, total 7–15 digits.
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const THRESHOLD_MIN = 1;
const THRESHOLD_MAX = 60;

function thresholdInvalid(v: string): boolean {
  const n = Number(v);
  return v.trim() === "" || Number.isNaN(n) || n < THRESHOLD_MIN || n > THRESHOLD_MAX;
}

export type RoutingDraft = Record<AlertEventKey, Record<AlertChannel, boolean>>;

export interface AlertsFormErrors {
  smsPhone?: boolean;
  smsThreshold?: boolean;
  senderEmail?: boolean;
  recipientEmail?: boolean;
  emailThreshold?: boolean;
}

export interface AlertsForm {
  // SMS channel
  smsEnabled: boolean;
  setSmsEnabled: (v: boolean) => void;
  smsPhone: string;
  setSmsPhone: (v: string) => void;
  smsThreshold: string;
  setSmsThreshold: (v: string) => void;

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
  emailThreshold: string;
  setEmailThreshold: (v: string) => void;

  // Routing matrix
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
  const [smsThreshold, setSmsThreshold] = useState(String(sms.threshold_minutes));

  const [emailEnabled, setEmailEnabled] = useState(email.enabled);
  const [senderEmail, setSenderEmail] = useState(email.sender_email);
  const [recipientEmail, setRecipientEmail] = useState(email.recipient_email);
  const [appPassword, setAppPassword] = useState(""); // never pre-filled
  const [emailThreshold, setEmailThreshold] = useState(
    String(email.threshold_minutes),
  );

  const seedRouting = useCallback((): RoutingDraft => {
    const draft = {} as RoutingDraft;
    for (const ev of ALERT_EVENT_ORDER) {
      draft[ev] = {} as Record<AlertChannel, boolean>;
      for (const ch of ALERT_CHANNEL_ORDER) {
        const capable = state.capabilities[ev]?.[ch] ?? false;
        draft[ev][ch] = capable && (state.routing.events[ev]?.[ch] ?? false);
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
      smsThreshold: thresholdInvalid(smsThreshold),
      senderEmail: !!senderEmail && !EMAIL_REGEX.test(senderEmail),
      recipientEmail: !!recipientEmail && !EMAIL_REGEX.test(recipientEmail),
      emailThreshold: thresholdInvalid(emailThreshold),
    }),
    [smsPhone, smsThreshold, senderEmail, recipientEmail, emailThreshold],
  );

  // ── Empty-while-enabled blockers ───────────────────────────────────────────
  const missing = useMemo(
    () => ({
      smsPhone: smsEnabled && smsPhone.trim() === "",
      senderEmail: emailEnabled && senderEmail.trim() === "",
      recipientEmail: emailEnabled && recipientEmail.trim() === "",
      // A new password is required only when none is stored yet.
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

  // Threshold errors only matter when their channel is enabled.
  const hasFormatError =
    (smsEnabled && (errors.smsPhone || errors.smsThreshold)) ||
    (emailEnabled &&
      (errors.senderEmail || errors.recipientEmail || errors.emailThreshold));
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
    smsThreshold !== String(sms.threshold_minutes) ||
    emailEnabled !== email.enabled ||
    senderEmail !== email.sender_email ||
    recipientEmail !== email.recipient_email ||
    emailThreshold !== String(email.threshold_minutes) ||
    appPassword.trim() !== "" ||
    routingDirty;

  // ── Payload / discard ──────────────────────────────────────────────────────
  const buildPayload = useCallback((): AlertsSavePayload => {
    const events = {} as RoutingDraft;
    for (const ev of ALERT_EVENT_ORDER) {
      events[ev] = {} as Record<AlertChannel, boolean>;
      for (const ch of ALERT_CHANNEL_ORDER) {
        const capable = state.capabilities[ev]?.[ch] ?? false;
        events[ev][ch] = capable && (routing[ev]?.[ch] ?? false);
      }
    }
    const payload: AlertsSavePayload = {
      action: "save_settings",
      sms: {
        enabled: smsEnabled,
        recipient_phone: smsPhone.trim(),
        threshold_minutes: parseInt(smsThreshold, 10),
      },
      email: {
        enabled: emailEnabled,
        sender_email: senderEmail.trim(),
        recipient_email: recipientEmail.trim(),
        threshold_minutes: parseInt(emailThreshold, 10),
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
    smsThreshold,
    emailEnabled,
    senderEmail,
    recipientEmail,
    emailThreshold,
    appPassword,
  ]);

  const discard = useCallback(() => {
    setSmsEnabled(sms.enabled);
    setSmsPhone(sms.recipient_phone);
    setSmsThreshold(String(sms.threshold_minutes));
    setEmailEnabled(email.enabled);
    setSenderEmail(email.sender_email);
    setRecipientEmail(email.recipient_email);
    setAppPassword("");
    setEmailThreshold(String(email.threshold_minutes));
    setRouting(seedRouting());
  }, [sms, email, seedRouting]);

  return {
    smsEnabled,
    setSmsEnabled,
    smsPhone,
    setSmsPhone,
    smsThreshold,
    setSmsThreshold,
    emailEnabled,
    setEmailEnabled,
    senderEmail,
    setSenderEmail,
    recipientEmail,
    setRecipientEmail,
    appPassword,
    setAppPassword,
    appPasswordSet: email.app_password_set,
    emailThreshold,
    setEmailThreshold,
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
