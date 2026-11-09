"use client";

import { useTranslation } from "react-i18next";

import { formatDay } from "@/components/history/format";
import { Badge } from "@/components/ui/badge";
import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";

import {
  formatClockSeconds,
  type DayGroup,
  type LogLineView,
  type LogTone,
} from "./derive";
import { LOGS } from "./shapes";

// =============================================================================
// Logs card: the rows
// =============================================================================
// One row per log line: the time, a filled level chip, the component or process
// as an outline tag, and the raw line in the mono face (it is an opaque string
// you compare, not prose). Four levels, four glyphs, so the chip survives
// grayscale. Day headings stick to the top of the scroller.
// =============================================================================

const LEVEL: Record<
  LogTone,
  { variant: "destructive" | "warning" | "info" | "muted"; glyph: MaterialSymbolName }
> = {
  error: { variant: "destructive", glyph: "error" },
  warn: { variant: "warning", glyph: "warning" },
  info: { variant: "info", glyph: "info" },
  debug: { variant: "muted", glyph: "bug_report" },
};

function LogRow({ row, plain, locale }: { row: LogLineView; plain: boolean; locale: string }) {
  const { t } = useTranslation("history");
  const level = row.tone ? LEVEL[row.tone] : null;

  return (
    <li className={plain ? LOGS.ROW_PLAIN : LOGS.ROW_FULL}>
      <span className={LOGS.TIME}>
        {row.sec !== null ? formatClockSeconds(row.sec, locale) : row.rawTime}
      </span>
      {plain ? null : (
        <div className={LOGS.META}>
          {level && row.tone ? (
            <Badge variant={level.variant} className="justify-self-start">
              <MaterialSymbol name={level.glyph} size={12} filled aria-hidden="true" />
              {t(`logs.level.${row.tone}`)}
            </Badge>
          ) : (
            <span aria-hidden="true" className="hidden @2xl/card:block" />
          )}
          {row.tag ? (
            <Tag variant="neutral" className="min-w-0 max-w-full justify-self-start" title={row.tag}>
              <span className="truncate">{row.tag}</span>
            </Tag>
          ) : (
            <span aria-hidden="true" className="hidden @2xl/card:block" />
          )}
        </div>
      )}
      <span className={plain ? LOGS.MESSAGE_PLAIN : LOGS.MESSAGE}>{row.message}</span>
    </li>
  );
}

/** "Today", "Yesterday", or a dated heading with the weekday ("Fri, Nov 6"). */
function dayHeading(sec: number, nowSec: number, t: ReturnType<typeof useTranslation>["t"], locale: string) {
  const day = formatDay(sec, nowSec, t, locale);
  if (day === t("shared.today") || day === t("shared.yesterday")) return day;
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(sec * 1000);
}

export function LogList({
  groups,
  plain,
  nowSec,
  label,
}: {
  groups: DayGroup[];
  /** Kernel lines carry no level and no process: just time and message. */
  plain: boolean;
  nowSec: number;
  label: string;
}) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;

  return (
    <div className={LOGS.SCROLLER} role="region" aria-label={label} tabIndex={0}>
      {groups.map((g, i) => (
        <section key={`${g.sec ?? "x"}-${i}`}>
          {g.sec !== null ? (
            <h3 className={LOGS.DAY}>{dayHeading(g.sec, nowSec, t, locale)}</h3>
          ) : null}
          <ul>
            {g.rows.map((row) => (
              <LogRow key={row.key} row={row} plain={plain} locale={locale} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The list's loaded shape, line for line, so the handoff does not jump. */
export function LogRowsSkeleton({ plain = false }: { plain?: boolean }) {
  return (
    <div className={LOGS.SCROLLER}>
      {Array.from({ length: LOGS.SKELETON_ROWS }, (_, i) => (
        <div key={i} className={plain ? LOGS.ROW_PLAIN : LOGS.ROW_FULL}>
          <Skeleton className="h-4 w-14 rounded-inline" />
          {plain ? null : (
            <div className={LOGS.META}>
              <Skeleton className="h-5 w-16 rounded-pill" />
              <Skeleton className="h-5 w-20 rounded-pill" />
            </div>
          )}
          <Skeleton
            className={
              plain ? "h-4 w-full rounded-inline" : "col-span-2 h-4 w-full rounded-inline @2xl/card:col-span-1"
            }
          />
        </div>
      ))}
    </div>
  );
}
