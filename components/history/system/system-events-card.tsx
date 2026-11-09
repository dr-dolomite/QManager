"use client";

import * as React from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import {
  formatClock,
  formatDay,
  formatDuration,
} from "@/components/history/format";
import { useHistoryCursor } from "@/components/history/history-cursor";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";
import type { HistoryRange } from "@/types/history";
import type { RebootCause, SystemIncident } from "@/types/system-history";

import { Notice } from "./parts";
import { EVENTS, HISTORY_CARD } from "./shapes";

// =============================================================================
// System events card: restarts, modem crashes and heat throttling
// =============================================================================
// Newest first, grouped by day. Each row is a filled disc (the tone is a fact
// about the event and never ages out: The Age-Gated Tone Rule), the message, a
// sub-line with the duration, and the clock time at the end. Five rows to start,
// five more per "Show more". Hovering a row marks that moment on the shared
// cursor so the charts above draw a crosshair at it.
// =============================================================================

type DiscTone = "neutral" | "destructive" | "warning";

const DISC: Record<DiscTone, string> = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  destructive: "bg-destructive text-destructive-foreground",
  warning: "bg-warning text-warning-foreground",
};

const SUB_INK = {
  muted: "text-on-surface-variant",
  destructive: "text-destructive-on-surface font-semibold",
  warning: "text-warning-on-surface font-semibold",
} as const;

interface RowView {
  tone: DiscTone;
  glyph: MaterialSymbolName;
  message: string;
  sub: string;
  subInk: keyof typeof SUB_INK;
}

const REBOOT_VIEW: Record<RebootCause, { tone: DiscTone; glyph: MaterialSymbolName }> = {
  unexpected: { tone: "destructive", glyph: "power_settings_new" },
  update: { tone: "neutral", glyph: "system_update" },
  scheduled: { tone: "neutral", glyph: "event_repeat" },
  user: { tone: "neutral", glyph: "restart_alt" },
  watchdog: { tone: "neutral", glyph: "restart_alt" },
};

/** Whole minutes while under an hour ("24m"), else the usual two units. */
function longDuration(sec: number, t: TFunction): string {
  if (sec < 60) return formatDuration(sec, t);
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return t("shared.duration.m", { value: minutes });
  return formatDuration(minutes * 60, t);
}

function present(i: SystemIncident, t: TFunction, tempC: number | null): RowView {
  if (i.kind === "modem") {
    return i.end === null
      ? {
          tone: "destructive",
          glyph: "sync_problem",
          message: t("system.events.modem.ongoing"),
          sub: t("system.events.modem.ongoing_sub"),
          subInk: "destructive",
        }
      : {
          tone: "destructive",
          glyph: "sync_problem",
          message: t("system.events.modem.ended"),
          sub: t("system.events.modem.ended_sub", {
            duration: formatDuration(Math.max(0, i.end - i.start), t),
          }),
          subInk: "muted",
        };
  }

  if (i.kind === "reboot") {
    return {
      ...REBOOT_VIEW[i.cause],
      message: t(`system.events.reboot.${i.cause}`),
      sub:
        i.offSec === null
          ? t("system.events.reboot.off_unknown")
          : t("system.events.reboot.off", { duration: formatDuration(i.offSec, t) }),
      subInk: "muted",
    };
  }

  const parts = i.parts.map((p) => t(`system.parts.${p}`)).join(", ");
  const message = parts
    ? t("system.events.heat.message", { parts })
    : t("system.events.heat.message_unknown");
  if (i.end === null) {
    const temp = tempC ?? i.peakC;
    return {
      tone: "warning",
      glyph: "thermostat",
      message,
      sub:
        temp === null
          ? t("system.events.heat.ongoing")
          : t("system.events.heat.ongoing_temp", { temp: Math.round(temp) }),
      subInk: "warning",
    };
  }
  const duration = longDuration(Math.max(0, i.end - i.start), t);
  return {
    tone: "warning",
    glyph: "thermostat",
    message,
    sub:
      i.peakC === null
        ? duration
        : t("system.events.heat.ended_sub", { duration, temp: Math.round(i.peakC) }),
    subInk: "muted",
  };
}

/** "Today", "Yesterday", or a dated heading with the weekday ("Fri, Nov 6"). */
function dayLabel(sec: number, nowSec: number, t: TFunction, locale: string): string {
  const day = formatDay(sec, nowSec, t, locale);
  if (day === t("shared.today") || day === t("shared.yesterday")) return day;
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(sec * 1000);
}

interface Group {
  day: string;
  items: SystemIncident[];
}

export interface SystemEventsCardProps {
  incidents: SystemIncident[];
  range: HistoryRange;
  /** Collector's now, epoch seconds, for Today / Yesterday labels. */
  nowSec: number;
  /** The stored history reaches back over the whole range. */
  covered: boolean;
  /** Hottest reading in the newest bucket, for a throttling span still going. */
  tempC: number | null;
}

export function SystemEventsCard({
  incidents,
  range,
  nowSec,
  covered,
  tempC,
}: SystemEventsCardProps) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;
  const cursor = useHistoryCursor();

  const [shown, setShown] = React.useState<number>(EVENTS.PAGE);
  // A new range is a new question: back to the first five.
  const [prevRange, setPrevRange] = React.useState(range);
  if (prevRange !== range) {
    setPrevRange(range);
    setShown(EVENTS.PAGE);
  }

  const total = incidents.length;
  const rows = incidents.slice(0, shown);
  const groups: Group[] = [];
  for (const item of rows) {
    const day = dayLabel(item.start, nowSec, t, locale);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }

  const hover = (sec: number | null) => {
    if (sec !== null) cursor.set(sec, "event", "events");
    else if (cursor.ownerId === "events") cursor.set(null);
  };

  const rangeName = t(`system.range.${range}`);

  return (
    <Card className={HISTORY_CARD} aria-label={t("system.events.title")}>
      <CardHeader className="gap-1 px-0">
        <CardTitle as="h2" className="min-w-0 text-lg leading-tight">
          {t("system.events.title")}
        </CardTitle>
        <CardDescription className="text-on-surface-variant text-sm">
          {t("system.events.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0">
        {total === 0 ? (
          covered ? (
            <Notice
              glyph="verified"
              tone="success"
              className={EVENTS.EMPTY_H}
              title={t("system.events.empty.title")}
              description={t("system.events.empty.description", { range: rangeName })}
            />
          ) : (
            <Notice
              glyph="event_note"
              className={EVENTS.EMPTY_H}
              title={t("system.events.new.title")}
              description={t("system.events.new.description")}
            />
          )
        ) : (
          <div className="flex flex-col">
            {groups.map((g) => (
              <section key={g.day} aria-label={g.day}>
                <h3 className={EVENTS.DAY}>{g.day}</h3>
                <ul>
                  {g.items.map((item) => {
                    const view = present(item, t, tempC);
                    return (
                      <li
                        key={`${item.kind}-${item.start}`}
                        className={EVENTS.ROW}
                        onPointerEnter={() => hover(item.start)}
                        onPointerLeave={() => hover(null)}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={cn(EVENTS.DISC, DISC[view.tone])}>
                            <MaterialSymbol name={view.glyph} size={18} filled />
                          </span>
                          <div className="min-w-0">
                            <div className="text-on-surface truncate text-sm font-medium">
                              {view.message}
                            </div>
                            <div className={cn("text-xs tabular-nums", SUB_INK[view.subInk])}>
                              {view.sub}
                            </div>
                          </div>
                        </div>
                        <span className="text-on-surface-variant text-[0.8125rem] tabular-nums">
                          {formatClock(item.start, locale)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardContent>

      {total > EVENTS.PAGE ? (
        <div className={EVENTS.FOOT}>
          <span className="tabular-nums" aria-live="polite">
            {t("system.events.showing", { shown: rows.length, total })}
          </span>
          {rows.length < total ? (
            <Button
              variant="tonal-neutral"
              size="sm"
              onClick={() => setShown((n) => n + EVENTS.PAGE)}
            >
              {t("system.events.more")}
              <MaterialSymbol name="expand_more" size={18} />
            </Button>
          ) : (
            <Button variant="tonal-neutral" size="sm" onClick={() => setShown(EVENTS.PAGE)}>
              {t("system.events.fewer")}
              <MaterialSymbol name="expand_less" size={18} />
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}
