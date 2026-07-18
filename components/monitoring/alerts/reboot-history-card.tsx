"use client";

import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PowerOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RebootHistoryEntry } from "@/types/alerts";
import { REBOOT_CAUSE_META, REBOOT_TONE_BADGE } from "./constants";

const MotionRow = motion.create("li");

// -----------------------------------------------------------------------------
// Recent Reboots — read-only device telemetry.
// -----------------------------------------------------------------------------
// Sibling to the Activity Log: same status-first card shape, but sourced from
// the alerts GET `reboots` array rather than a poll hook. Every recorded reboot
// is shown with its classified cause regardless of whether the reboot ALERT is
// routed on — the history is the durable value; the alert is opt-in on top.
// -----------------------------------------------------------------------------
export function RebootHistoryCard({
  reboots,
}: {
  reboots: RebootHistoryEntry[];
}) {
  const { t, i18n } = useTranslation("monitoring");

  const header = (
    <CardHeader>
      <CardTitle>{t("alerts.reboot_history_title")}</CardTitle>
      <CardDescription>{t("alerts.reboot_history_description")}</CardDescription>
    </CardHeader>
  );

  if (reboots.length === 0) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent>
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <PowerOffIcon className="text-muted-foreground size-8" aria-hidden />
            <p className="text-muted-foreground text-sm">
              {t("alerts.reboot_history_empty")}
            </p>
            <p className="text-muted-foreground/70 text-xs">
              {t("alerts.reboot_history_empty_hint")}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      {header}
      <CardContent>
        <ul
          className="max-h-[22rem] divide-y overflow-auto rounded-md border"
          aria-label={t("alerts.reboot_history_title")}
        >
          {reboots.map((entry, index) => {
            const meta =
              REBOOT_CAUSE_META[entry.cause] ?? REBOOT_CAUSE_META.unplanned;
            const CauseIcon = meta.icon;
            const when = new Date(entry.epoch * 1000);
            const valid = Number.isFinite(entry.epoch) && entry.epoch > 0;
            return (
              <MotionRow
                key={`${entry.epoch}-${index}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  duration: 0.2,
                  delay: Math.min(index * 0.03, 0.3),
                  ease: "easeOut",
                }}
              >
                <Badge
                  variant="outline"
                  className={cn("gap-1", REBOOT_TONE_BADGE[meta.tone])}
                >
                  <CauseIcon className="size-3" />
                  {t(`alerts.reboot_cause_${meta.key}`)}
                </Badge>
                <div className="grid justify-items-end gap-0.5 text-right">
                  <span className="text-sm tabular-nums">
                    {valid
                      ? formatRelative(when, i18n.language)
                      : t("alerts.reboot_history_time_unknown")}
                  </span>
                  {valid && (
                    <time
                      dateTime={when.toISOString()}
                      className="text-muted-foreground font-mono text-xs tabular-nums"
                    >
                      {when.toLocaleString(i18n.language, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  )}
                </div>
              </MotionRow>
            );
          })}
        </ul>
      </CardContent>
      <CardFooter className="border-t pt-4">
        <p className="text-muted-foreground text-xs">
          {t("alerts.reboot_history_footer", { count: reboots.length })}
        </p>
      </CardFooter>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Relative time ("2 hours ago") localized via Intl, picking the largest unit.
// Client-only (this is a "use client" surface rendered after fetch), so there
// is no hydration-mismatch risk from reading the current time.
// -----------------------------------------------------------------------------
function formatRelative(when: Date, locale: string): string {
  const seconds = Math.round((when.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  const divisions: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.34524, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];

  let value = abs;
  for (const [step, unit] of divisions) {
    if (value < step) {
      // Preserve the sign (past reboots are negative).
      return rtf.format(seconds < 0 ? -Math.floor(value) : Math.floor(value), unit);
    }
    value = value / step;
  }
  return rtf.format(seconds < 0 ? -Math.floor(value) : Math.floor(value), "year");
}
