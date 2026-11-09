"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDuration, formatWhen } from "@/components/history/format";
import { useHistoryCursor } from "@/components/history/history-cursor";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { useHistoryEvents } from "@/hooks/use-history";
import { presentEvent } from "@/lib/event-presentation";
import { cn } from "@/lib/utils";
import {
  CELLULAR_EVENT_TYPES,
  type CellularEventType,
  type HistoryEvent,
  type HistoryRange,
} from "@/types/history";

import { eventGlyph } from "./events-glyphs";
import { PageSizeMenu, TypeFilterMenu } from "./events-menus";
import { HEADER_SHAPE, HISTORY_CARD } from "./shapes";
import {
  CARD_DESC,
  CARD_HEADER,
  CARD_TITLE,
  DEFAULT_PAGE_SIZE,
  EVENTS,
  HEADER_ACTIONS,
} from "./signal-shapes";

const { WIDE_ONLY, NARROW_ONLY } = EVENTS;

const HEAD_CELL = cn(EVENTS.HEAD_H, "text-on-surface-variant px-3 text-xs font-medium");

interface DiscProps {
  className: string;
  glyph: MaterialSymbolName;
  size?: number;
}

function Disc({ className, glyph, size = 17 }: DiscProps) {
  return (
    <span className={cn(EVENTS.DISC, className)}>
      <MaterialSymbol name={glyph} size={size} filled />
    </span>
  );
}

function RadioTag({ radio }: { radio: HistoryEvent["radio"] }) {
  if (radio === "nr") return <Tag variant="nr">5G NR</Tag>;
  if (radio === "lte") return <Tag variant="lte">LTE</Tag>;
  return null;
}

/** Column header row, shared by the loaded table and its skeleton. */
function EventsHead() {
  const { t } = useTranslation("history");
  return (
    <TableHeader>
      <TableRow className="border-border border-t hover:bg-transparent">
        <TableHead className={cn(HEAD_CELL, "pl-6")}>{t("cellular.events.col_event")}</TableHead>
        <TableHead
          className={cn(HEAD_CELL, EVENTS.COL_RADIO, EVENTS.RADIO_HEAD)}
        >
          {t("cellular.events.col_radio")}
        </TableHead>
        <TableHead className={cn(HEAD_CELL, EVENTS.COL_TIME, "pr-6 text-right", WIDE_ONLY)}>
          {t("cellular.events.col_time")}
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

interface EventRowProps {
  event: HistoryEvent;
  nowSec: number;
  onHover: (timestamp: number | null) => void;
}

function EventRow({ event, nowSec, onHover }: EventRowProps) {
  const { t, i18n } = useTranslation("history");
  const when = formatWhen(event.timestamp, nowSec, t, i18n.language);
  const type = event.type as CellularEventType;
  const view = presentEvent(event, false, false, "card");
  // Paired outage onsets say how it ended: null = still ongoing.
  let fact: string | null = null;
  if (event.type === "signal_lost" && event.end !== undefined) {
    fact =
      event.end === null
        ? t("cellular.events.ongoing")
        : t("cellular.events.restored_after", {
            duration: formatDuration(Math.max(0, event.end - event.timestamp), t),
          });
  }

  return (
    <TableRow
      className={cn(EVENTS.ROW_H, "border-border hover:bg-surface-container")}
      onPointerEnter={() => onHover(event.timestamp)}
      onPointerLeave={() => onHover(null)}
    >
      <TableCell className="max-w-0 pl-6">
        <div className="flex min-w-0 items-center gap-3">
          <Disc className={view.discClass} glyph={eventGlyph(type, view.tone)} />
          <div className="min-w-0">
            <div className="text-on-surface truncate text-sm font-medium" title={event.message}>
              {event.message}
            </div>
            <div className={cn("text-on-surface-variant text-xs tabular-nums", NARROW_ONLY)}>
              {fact ? `${when} (${fact})` : when}
            </div>
            {fact ? (
              <div className="text-on-surface-variant hidden truncate text-xs @[34rem]/card:block">
                {fact}
              </div>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell className={EVENTS.RADIO_CELL}>
        <div className={EVENTS.RADIO_ALIGN}>
          <RadioTag radio={event.radio} />
        </div>
      </TableCell>
      <TableCell
        className={cn(
          "text-on-surface-variant pr-6 text-right text-[0.8125rem] tabular-nums",
          WIDE_ONLY,
        )}
      >
        {when}
      </TableCell>
    </TableRow>
  );
}

function EventsSkeletonRows() {
  return (
    <TableBody>
      {Array.from({ length: EVENTS.SKELETON_ROWS }).map((_, i) => (
        <TableRow key={i} className={cn(EVENTS.ROW_H, "border-border hover:bg-transparent")}>
          <TableCell className="pl-6">
            <div className="flex items-center gap-3">
              <Skeleton className="size-[30px] flex-none rounded-full" />
              <Skeleton className="h-3.5 w-48 max-w-full rounded-inline" />
            </div>
          </TableCell>
          <TableCell className={EVENTS.RADIO_CELL}>
            <div className={EVENTS.RADIO_ALIGN}>
              <Skeleton className="h-[1.375rem] w-12 rounded-pill" />
            </div>
          </TableCell>
          <TableCell className={cn("pr-6", WIDE_ONLY)}>
            <Skeleton className="ml-auto h-3.5 w-28 rounded-inline" />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}

interface NoticeProps {
  glyph: MaterialSymbolName;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

/** Empty and no-match states: a neutral disc, a title, one line, an optional way out. */
function EventsNotice({ glyph, title, description, action }: NoticeProps) {
  return (
    <Empty className={cn(EVENTS.EMPTY_H, "gap-3 p-6")}>
      <EmptyHeader>
        <Disc
          className="bg-surface-container-high text-on-surface-variant mb-1 size-11"
          glyph={glyph}
          size={22}
        />
        <EmptyTitle className="text-[0.9375rem] font-semibold">{title}</EmptyTitle>
        <EmptyDescription className="text-on-surface-variant text-[0.8125rem]">
          {description}
        </EmptyDescription>
      </EmptyHeader>
      {action ? (
        <EmptyContent>
          <Button variant="tonal-neutral" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

function EventsError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation("history");
  return (
    <Empty
      role="alert"
      className="bg-destructive-container text-on-destructive-container min-h-[17.5rem] gap-3 rounded-card p-8"
    >
      <EmptyHeader>
        <Disc
          className="bg-destructive text-destructive-foreground mb-2 size-14"
          glyph="cloud_off"
          size={28}
        />
        <EmptyTitle className="text-xl font-semibold">{t("cellular.events.error_title")}</EmptyTitle>
        <EmptyDescription className="text-on-destructive-container text-sm">
          {t("cellular.events.error_description")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="destructive" onClick={onRetry}>
          <MaterialSymbol name="refresh" size={18} />
          {t("cellular.events.retry")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

interface PagerProps {
  page: number;
  pages: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

function Pager({ page, pages, pageSize, onPage, onPageSize }: PagerProps) {
  const { t } = useTranslation("history");
  const atStart = page <= 0;
  const atEnd = page >= pages - 1;
  const edge = "@max-[34rem]/card:hidden";
  return (
    <div className="text-on-surface-variant flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
      <div className="flex items-center gap-2.5">
        <span>{t("cellular.events.rows_per_page")}</span>
        <PageSizeMenu value={pageSize} onChange={onPageSize} />
      </div>
      <span className="text-on-surface font-medium whitespace-nowrap tabular-nums">
        {t("cellular.events.page_of", { page: page + 1, pages })}
      </span>
      <div className="flex gap-1.5">
        <Button
          variant="tonal-neutral"
          size="icon-sm"
          className={edge}
          aria-label={t("cellular.events.first_page")}
          disabled={atStart}
          onClick={() => onPage(0)}
        >
          <MaterialSymbol name="first_page" size={18} />
        </Button>
        <Button
          variant="tonal-neutral"
          size="icon-sm"
          aria-label={t("cellular.events.prev_page")}
          disabled={atStart}
          onClick={() => onPage(page - 1)}
        >
          <MaterialSymbol name="chevron_right" size={18} className="rotate-180" />
        </Button>
        <Button
          variant="tonal-neutral"
          size="icon-sm"
          aria-label={t("cellular.events.next_page")}
          disabled={atEnd}
          onClick={() => onPage(page + 1)}
        >
          <MaterialSymbol name="chevron_right" size={18} />
        </Button>
        <Button
          variant="tonal-neutral"
          size="icon-sm"
          className={edge}
          aria-label={t("cellular.events.last_page")}
          disabled={atEnd}
          onClick={() => onPage(pages - 1)}
        >
          <MaterialSymbol name="first_page" size={18} className="rotate-180" />
        </Button>
      </div>
    </div>
  );
}

export interface RadioEventsCardProps {
  range: HistoryRange;
  /** Collector's now, epoch seconds, for Today / Yesterday labels. */
  nowSec: number;
}

/**
 * Handovers, band and carrier changes, and signal loss, newest first. Hovering
 * a row marks that moment on the shared cursor so every chart draws a crosshair.
 */
export function RadioEventsCard({ range, nowSec }: RadioEventsCardProps) {
  const { t } = useTranslation("history");
  const cursor = useHistoryCursor();

  // null = every type. A selection is only stored once the user narrows it.
  const [selected, setSelected] = useState<CellularEventType[] | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // A new range is a new question: drop the filter and go back to page one.
  const [prevRange, setPrevRange] = useState(range);
  if (prevRange !== range) {
    setPrevRange(range);
    setSelected(null);
    setPage(0);
  }

  const {
    data,
    isLoading: fetching,
    error,
    refresh,
  } = useHistoryEvents("cellular", range, { types: selected ?? undefined, page, pageSize });
  // The hook keeps the previous page up while the next one loads: only a first
  // load (or a retry after a failure) shows the skeleton.
  const isLoading = fetching && data === null;

  const options = CELLULAR_EVENT_TYPES.flatMap((type) => {
    const count = data?.counts[type] ?? 0;
    return count > 0 ? [{ type, count }] : [];
  });
  const everything = options.reduce((n, o) => n + o.count, 0);
  const effective = selected ?? options.map((o) => o.type);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (data && page > pages - 1) setPage(pages - 1);

  const toggle = (type: CellularEventType) => {
    const next = effective.includes(type)
      ? effective.filter((x) => x !== type)
      : CELLULAR_EVENT_TYPES.filter((x) => x === type || effective.includes(x));
    if (next.length === 0) return;
    const covers = options.every((o) => next.includes(o.type));
    setSelected(covers ? null : next);
    setPage(0);
  };
  const showAll = () => {
    setSelected(null);
    setPage(0);
  };

  const hover = (timestamp: number | null) => {
    if (timestamp !== null) cursor.set(timestamp, "event", "events");
    else if (cursor.ownerId === "events") cursor.set(null);
  };

  const rows = data?.events ?? [];
  const filtered = selected !== null;
  const loaded = !isLoading && !error && data !== null;
  const noEvents = loaded && everything === 0;
  const noMatch = loaded && everything > 0 && total === 0;

  return (
    <Card className={HISTORY_CARD} aria-label={t("cellular.events.title")}>
      <CardHeader className={cn(CARD_HEADER, isLoading && HEADER_SHAPE.GAP)}>
        <CardTitle as="h2" className={CARD_TITLE}>
          {t("cellular.events.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>{t("cellular.events.description")}</CardDescription>
        {loaded && options.length > 1 ? (
          <CardAction className={HEADER_ACTIONS}>
            <TypeFilterMenu
              options={options}
              selected={effective}
              all={!filtered}
              onToggle={toggle}
              onShowAll={showAll}
            />
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="px-0">
        {error ? (
          <EventsError onRetry={refresh} />
        ) : noEvents ? (
          <EventsNotice
            glyph="history"
            title={t("cellular.events.empty_title")}
            description={t("cellular.events.empty_description")}
          />
        ) : noMatch ? (
          <EventsNotice
            glyph="tune"
            title={t("cellular.events.no_match_title")}
            description={t("cellular.events.no_match_description")}
            action={{ label: t("cellular.events.show_all_events"), onClick: showAll }}
          />
        ) : (
          <div className="-mx-6" aria-busy={fetching}>
            <Table className="table-fixed">
              <EventsHead />
              {isLoading ? (
                <EventsSkeletonRows />
              ) : (
                <TableBody>
                  {rows.map((event) => (
                    <EventRow
                      key={`${event.timestamp}-${event.type}-${event.message}`}
                      event={event}
                      nowSec={nowSec}
                      onHover={hover}
                    />
                  ))}
                  {/* Keep the card's height steady on a short last page. */}
                  {pages > 1
                    ? Array.from({ length: Math.max(0, pageSize - rows.length) }).map((_, i) => (
                        <TableRow
                          key={`filler-${i}`}
                          aria-hidden
                          className={cn(
                            EVENTS.ROW_H,
                            "border-border pointer-events-none hover:bg-transparent",
                          )}
                        >
                          <TableCell colSpan={3} />
                        </TableRow>
                      ))
                    : null}
                </TableBody>
              )}
            </Table>
          </div>
        )}
      </CardContent>

      {!error ? (
        <div className="border-border -mx-6 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t px-6 pt-5">
          {isLoading ? (
            <>
              <Skeleton className="h-4 w-20 rounded-inline" />
              <Skeleton className="h-8 w-72 max-w-full rounded-pill" />
            </>
          ) : (
            <>
              <span className="text-on-surface-variant text-sm tabular-nums">
                {t(filtered ? "cellular.events.shown" : "cellular.events.count", { count: total })}
              </span>
              {total > 0 ? (
                <Pager
                  page={Math.min(page, pages - 1)}
                  pages={pages}
                  pageSize={pageSize}
                  onPage={setPage}
                  onPageSize={(size) => {
                    setPageSize(size);
                    setPage(0);
                  }}
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}
