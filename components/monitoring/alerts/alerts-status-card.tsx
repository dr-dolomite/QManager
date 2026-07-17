"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2Icon,
  MinusCircleIcon,
  TriangleAlertIcon,
  PackageXIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ALERT_EVENT_ORDER,
  ALERT_CHANNEL_ORDER,
  type AlertsState,
  type AlertChannel,
  type AlertEventKey,
} from "@/types/alerts";
import { CHANNEL_META, EVENT_META, maskPhone, maskEmail } from "./constants";

type Tone = "success" | "warning" | "muted";

const TONE_RING: Record<Tone, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  muted: "bg-muted/50 text-muted-foreground border-muted-foreground/25",
};

const TONE_TILE: Record<Tone, string> = {
  success: "border-success/25 bg-success/5",
  warning: "border-warning/25 bg-warning/5",
  muted: "border-border bg-muted/20",
};

const TONE_BADGE: Record<Tone, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  muted: "bg-muted/50 text-muted-foreground border-muted-foreground/30",
};

interface Readiness {
  tone: Tone;
  icon: React.ReactNode;
  labelKey: string;
  /** Masked recipient or a short hint about what's missing. */
  detail: string;
}

function readinessFor(
  channel: AlertChannel,
  state: AlertsState,
  t: (k: string) => string,
): Readiness {
  if (channel === "sms") {
    const c = state.channels.sms;
    if (!c.enabled)
      return {
        tone: "muted",
        icon: <MinusCircleIcon className="size-3" />,
        labelKey: "alerts.readiness_off",
        detail: t("alerts.readiness_off_hint"),
      };
    if (!c.configured)
      return {
        tone: "warning",
        icon: <TriangleAlertIcon className="size-3" />,
        labelKey: "alerts.readiness_needs_setup",
        detail: t("alerts.readiness_sms_no_recipient"),
      };
    return {
      tone: "success",
      icon: <CheckCircle2Icon className="size-3" />,
      labelKey: "alerts.readiness_ready",
      detail: maskPhone(c.recipient_phone),
    };
  }
  const c = state.channels.email;
  if (!c.enabled)
    return {
      tone: "muted",
      icon: <MinusCircleIcon className="size-3" />,
      labelKey: "alerts.readiness_off",
      detail: t("alerts.readiness_off_hint"),
    };
  if (!c.msmtp_installed)
    return {
      tone: "warning",
      icon: <PackageXIcon className="size-3" />,
      labelKey: "alerts.readiness_mailer_missing",
      detail: t("alerts.readiness_mailer_missing_hint"),
    };
  if (!c.configured)
    return {
      tone: "warning",
      icon: <TriangleAlertIcon className="size-3" />,
      labelKey: "alerts.readiness_needs_setup",
      detail: t("alerts.readiness_email_incomplete"),
    };
  return {
    tone: "success",
    icon: <CheckCircle2Icon className="size-3" />,
    labelKey: "alerts.readiness_ready",
    detail: maskEmail(c.recipient_email),
  };
}

export function AlertsStatusCard({ state }: { state: AlertsState }) {
  const { t } = useTranslation("monitoring");

  // What actually fires per event, from SAVED truth: routed ∩ capable ∩ enabled.
  const firesFor = (event: AlertEventKey): AlertChannel[] =>
    ALERT_CHANNEL_ORDER.filter(
      (ch) =>
        (state.capabilities[event]?.[ch] ?? false) &&
        (state.routing.events[event]?.[ch] ?? false) &&
        state.channels[ch].enabled,
    );

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("alerts.status_title")}</CardTitle>
        <CardDescription>{t("alerts.status_description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* Channel readiness tiles */}
        <div className="grid gap-3 @md/card:grid-cols-2">
          {ALERT_CHANNEL_ORDER.map((ch) => {
            const r = readinessFor(ch, state, t);
            const Icon = CHANNEL_META[ch].icon;
            return (
              <div
                key={ch}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3.5",
                  TONE_TILE[r.tone],
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full border",
                    TONE_RING[r.tone],
                  )}
                  aria-hidden
                >
                  <Icon className="size-5" />
                </span>
                <div className="grid min-w-0 gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {t(`alerts.channel_${CHANNEL_META[ch].labelKey}_name`)}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn("gap-1", TONE_BADGE[r.tone])}
                    >
                      {r.icon}
                      {t(r.labelKey)}
                    </Badge>
                  </div>
                  <span
                    className={cn(
                      "truncate text-xs",
                      r.tone === "success"
                        ? "text-muted-foreground font-mono"
                        : "text-muted-foreground",
                    )}
                  >
                    {r.detail}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Routing summary — what fires where, from saved state. */}
        <div className="border-t pt-5">
          <span className="text-muted-foreground text-xs font-medium">
            {t("alerts.status_routing_summary_label")}
          </span>
          <dl className="mt-3 grid gap-3">
            {ALERT_EVENT_ORDER.map((ev) => {
              const fires = firesFor(ev);
              const EventIcon = EVENT_META[ev].icon;
              return (
                <div
                  key={ev}
                  className="flex items-center justify-between gap-3"
                >
                  <dt className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
                    <EventIcon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">
                      {t(`alerts.event_${EVENT_META[ev].key}_name`)}
                    </span>
                  </dt>
                  <dd className="flex shrink-0 items-center gap-1.5">
                    {fires.length === 0 ? (
                      <span className="text-muted-foreground/70 text-xs">
                        {t("alerts.status_not_alerting")}
                      </span>
                    ) : (
                      fires.map((ch) => {
                        const Icon = CHANNEL_META[ch].icon;
                        return (
                          <Badge
                            key={ch}
                            variant="outline"
                            className="border-primary/30 bg-primary/10 text-primary gap-1"
                          >
                            <Icon className="size-3" />
                            {t(
                              `alerts.channel_${CHANNEL_META[ch].labelKey}_short`,
                            )}
                          </Badge>
                        );
                      })
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}
