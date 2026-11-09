"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { eventMessage, type EventMessageSource } from "@/lib/event-message";

/** The localised sentence for an event row, falling back to its backend message. */
export function useEventMessage(): (event: EventMessageSource) => string {
  const { t, i18n } = useTranslation("events");
  const locale = i18n.language;
  return useCallback((event: EventMessageSource) => eventMessage(event, t, locale), [t, locale]);
}
