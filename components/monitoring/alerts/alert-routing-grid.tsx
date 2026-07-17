"use client";

import { useTranslation } from "react-i18next";
import { MinusCircleIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  ALERT_EVENT_ORDER,
  ALERT_CHANNEL_ORDER,
  type AlertCapabilities,
} from "@/types/alerts";
import { EVENT_META, CHANNEL_META } from "./constants";
import { InfoTip } from "./info-tip";
import type { AlertsForm } from "./use-alerts-form";

// -----------------------------------------------------------------------------
// AlertRoutingGrid — the trigger × channel matrix.
// Rows are events, columns are channels. A capable cell is a Switch; an
// INCAPABLE cell (e.g. email during an outage) is never a dead toggle — it
// renders an explained "Unavailable" chip so color is always paired with an
// icon + text (WCAG 2.2). Capability is read from the backend, never hard-coded.
// -----------------------------------------------------------------------------
export function AlertRoutingGrid({
  form,
  capabilities,
}: {
  form: AlertsForm;
  capabilities: AlertCapabilities;
}) {
  const { t } = useTranslation("monitoring");

  const channelEnabled: Record<string, boolean> = {
    sms: form.smsEnabled,
    email: form.emailEnabled,
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0">
        <caption className="sr-only">{t("alerts.routing_table_caption")}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-full p-0" />
            {ALERT_CHANNEL_ORDER.map((ch) => {
              const Icon = CHANNEL_META[ch].icon;
              return (
                <th
                  key={ch}
                  scope="col"
                  className="text-muted-foreground w-20 px-1 pb-3 text-center align-bottom text-xs font-medium"
                >
                  <span className="inline-flex flex-col items-center gap-1">
                    <Icon className="size-4" aria-hidden />
                    {t(`alerts.channel_${CHANNEL_META[ch].labelKey}_short`)}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ALERT_EVENT_ORDER.map((ev, rowIdx) => {
            const EventIcon = EVENT_META[ev].icon;
            const isLast = rowIdx === ALERT_EVENT_ORDER.length - 1;
            return (
              <tr key={ev} className="group">
                <th
                  scope="row"
                  className={cn(
                    "py-3.5 pr-3 text-left align-middle font-normal",
                    !isLast && "border-b",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className="text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center"
                      aria-hidden
                    >
                      <EventIcon className="size-4" />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="text-sm font-medium">
                        {t(`alerts.event_${EVENT_META[ev].key}_name`)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {t(`alerts.event_${EVENT_META[ev].key}_desc`)}
                      </span>
                    </span>
                  </div>
                </th>

                {ALERT_CHANNEL_ORDER.map((ch) => {
                  const cell = capabilities[ev]?.[ch] ?? false;
                  const reasonKey =
                    ch === "email"
                      ? capabilities[ev]?.email_reason
                      : capabilities[ev]?.sms_reason;
                  const masterOff = !channelEnabled[ch];
                  return (
                    <td
                      key={ch}
                      className={cn(
                        "px-1 py-3.5 text-center align-middle",
                        !isLast && "border-b",
                      )}
                    >
                      {cell ? (
                        <span className="inline-flex items-center justify-center">
                          <Switch
                            checked={form.getRoute(ev, ch)}
                            onCheckedChange={(v) => form.setRoute(ev, ch, v)}
                            disabled={masterOff}
                            aria-label={t("alerts.routing_switch_aria", {
                              event: t(`alerts.event_${EVENT_META[ev].key}_name`),
                              channel: t(
                                `alerts.channel_${CHANNEL_META[ch].labelKey}_name`,
                              ),
                            })}
                          />
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center gap-1">
                          <span className="text-muted-foreground/70 inline-flex items-center gap-1 text-xs">
                            <MinusCircleIcon className="size-3.5" aria-hidden />
                            <span className="hidden @xs/card:inline">
                              {t("alerts.routing_unavailable")}
                            </span>
                          </span>
                          <InfoTip
                            text={t(
                              `alerts.reason_${reasonKey ?? "not_supported"}`,
                            )}
                            aria={t("alerts.routing_unavailable_more_info_aria", {
                              event: t(`alerts.event_${EVENT_META[ev].key}_name`),
                              channel: t(
                                `alerts.channel_${CHANNEL_META[ch].labelKey}_name`,
                              ),
                            })}
                          />
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {(!form.smsEnabled || !form.emailEnabled) && (
        <p className="text-muted-foreground mt-3 text-xs">
          {t("alerts.routing_channel_off_hint")}
        </p>
      )}
    </div>
  );
}
