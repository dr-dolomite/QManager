"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ConditionScreen } from "@/components/cellular/condition-screen";
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
import { cn } from "@/lib/utils";
import type { HistoryRange } from "@/types/history";

import { useConnectionEvents } from "./data";
import {
  EVENT_CATEGORIES,
  discClass,
  eventGlyph,
  lastedOf,
  typesOf,
  type EventCategoryId,
} from "./events-presentation";
import { CategoryFilterMenu, PageSizeMenu } from "./events-menus";
import {
  CARD_DESC,
  CARD_HEADER,
  CARD_TITLE,
  DEFAULT_PAGE_SIZE,
  EVENTS,
  HEADER_ACTIONS,
  HEADER_SHAPE,
  HISTORY_CARD,
  LASTED,
} from "./shapes";
import type { ConnectionEvent, ConnectionEventType } from "./types";

const { WIDE_ONLY, NARROW_ONLY } = EVENTS;

const HEAD_CELL = cn(EVENTS.HEAD_H, "text-on-surface-variant px-3 text-xs font-medium");

function Disc({
  className,
  glyph,
  size = 17,
}: {
  className: string;
  glyph: MaterialSymbolName;
  size?: number;
}) {
  return (
    <span className={cn(EVENTS.DISC, className)}>
      <MaterialSymbol name={glyph} size={size} filled />
    </span>
  );
}

/** Column header row, shared by the loaded table and its skeleton. */
function EventsHead() {
  const { t } = useTranslation("history");
  return (
    <TableHeader>
      <TableRow className="border-border border-t hover:bg-transparent">
        <TableHead className={cn(HEAD_CELL, "pl-6")}>{t("connection.events.col_event")}</TableHead>
        <TableHead className={cn(HEAD_CELL, LASTED.COL, LASTED.HEAD)}>
          {t("connection.events.col_lasted")}
        </TableHead>
        <TableHead className={cn(HEAD_CELL, EVENTS.COL_TIME, "pr-6 text-right", WIDE_ONLY)}>
          {t("connection.events.col_time")}
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function LastedCell({ event }: { event: ConnectionEvent }) {
  const { t } = useTranslation("history");
  const lasted = lastedOf(event);
  if (lasted.kind === "ongoing") {
    return (
      <span
        className={cn(
          "font-semibold",
          lasted.fault ? "text-destructive-on-surface" : "text-warning-on-surface",
        )}
      >
        {t("connection.events.ongoing")}
      </span>
    );
  }
  if (lasted.kind === "duration") return <>{formatDuration(lasted.sec, t)}</>;
  return null;
}

function EventRow({
  event,
  nowSec,
  onHover,
}: {
  event: ConnectionEvent;
  nowSec: number;
  onHover: (timestamp: number | null) => void;
}) {
  const { i18n, t } = useTranslation("history");
  const when = formatWhen(event.timestamp, nowSec, t, i18n.language);
  const type = event.type as ConnectionEventType;

  return (
    <TableRow
      className={cn(EVENTS.ROW_H, "border-border hover:bg-surface-container")}
      onPointerEnter={() => onHover(event.timestamp)}
      onPointerLeave={() => onHover(null)}
    >
      <TableCell className="max-w-0 pl-6">
        <div className="flex min-w-0 items-center gap-3">
          <Disc className={discClass(event)} glyph={eventGlyph(type)} />
          <div className="min-w-0">
            <div className="text-on-surface truncate text-sm font-medium" title={event.message}>
              {event.message}
            </div>
            <div className={cn("text-on-surface-variant text-xs tabular-nums", NARROW_ONLY)}>
              {when}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell
        className={cn("text-on-surface-variant text-[0.8125rem] tabular-nums", LASTED.CELL)}
      >
        <LastedCell event={event} />
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
          <TableCell className={LASTED.CELL}>
            <Skeleton className="ml-auto h-3.5 w-12 rounded-inline" />
          </TableCell>
          <TableCell className={cn("pr-6", WIDE_ONLY)}>
            <Skeleton className="ml-auto h-3.5 w-28 rounded-inline" />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}

/** Empty and no-match states: a neutral disc, a title, one line, an optional way out. */
function EventsNotice({
  glyph,
  title,
  description,
  action,
}: {
  glyph: MaterialSymbolName;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
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

function Pager({
  page,
  pages,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  pages: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const { t } = useTranslation("history");
  const atStart = page <= 0;
  const atEnd = page >= pages - 1;
  const edge = "@max-[34rem]/card:hidden";
  return (
    <div className="text-on-surface-variant flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
      <div className="flex items-center gap-2.5">
        <span>{t("connection.events.rows_per_page")}</span>
        <PageSizeMenu value={pageSize} onChange={onPageSize} />
      </div>
      <span className="text-on-surface font-medium whitespace-nowrap tabular-nums">
        {t("connection.events.page_of", { page: page + 1, pages })}
      </span>
      <div className="flex gap-1.5">
        <Button
          variant="tonal-neutral"
          size="icon-sm"
          className={edge}
          aria-label={t("connection.events.first_page")}
          disabled={atStart}
          onClick={() => onPage(0)}
        >
          <MaterialSymbol name="first_page" size={18} />
        </Button>
        <Button
          variant="tonal-neutral"
          size="icon-sm"
          aria-label={t("connection.events.prev_page")}
          disabled={atStart}
          onClick={() => onPage(page - 1)}
        >
          <MaterialSymbol name="chevron_right" size={18} className="rotate-180" />
        </Button>
        <Button
          variant="tonal-neutral"
          size="icon-sm"
          aria-label={t("connection.events.next_page")}
          disabled={atEnd}
          onClick={() => onPage(page + 1)}
        >
          <MaterialSymbol name="chevron_right" size={18} />
        </Button>
        <Button
          variant="tonal-neutral"
          size="icon-sm"
          className={edge}
          aria-label={t("connection.events.last_page")}
          disabled={atEnd}
          onClick={() => onPage(pages - 1)}
        >
          <MaterialSymbol name="first_page" size={18} className="rotate-180" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Outages, slow or lossy periods and what recovered them, newest first. Hovering
 * a row marks that moment on the shared cursor so every chart draws a crosshair.
 */
export function ConnectionEventsCard({ range }: { range: HistoryRange }) {
  const { t } = useTranslation("history");
  const cursor = useHistoryCursor();

  // null = every category. A selection is only stored once the user narrows it.
  const [selected, setSelected] = useState<EventCategoryId[] | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // A new range is a new question: drop the filter and go back to page one.
  const [prevRange, setPrevRange] = useState(range);
  if (prevRange !== range) {
    setPrevRange(range);
    setSelected(null);
    setPage(0);
  }

  const { data, nowSec, isLoading, error, refresh } = useConnectionEvents(range, {
    types: selected === null ? undefined : typesOf(selected),
    page,
    pageSize,
  });

  const options = EVENT_CATEGORIES.flatMap((c) => {
    const count = c.types.reduce((n, type) => n + (data?.counts[type] ?? 0), 0);
    return count > 0 ? [{ id: c.id as EventCategoryId, count }] : [];
  });
  const everything = options.reduce((n, o) => n + o.count, 0);
  const effective = selected ?? options.map((o) => o.id);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (data && page > pages - 1) setPage(pages - 1);

  const toggle = (id: EventCategoryId) => {
    const next = effective.includes(id)
      ? effective.filter((x) => x !== id)
      : EVENT_CATEGORIES.map((c) => c.id as EventCategoryId).filter(
          (x) => x === id || effective.includes(x),
        );
    if (next.length === 0) return;
    const covers = options.every((o) => next.includes(o.id));
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
    <Card className={HISTORY_CARD} aria-label={t("connection.events.title")}>
      <CardHeader className={cn(CARD_HEADER, isLoading && HEADER_SHAPE.GAP)}>
        <CardTitle as="h2" className={CARD_TITLE}>
          {t("connection.events.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("connection.events.description")}
        </CardDescription>
        {loaded && options.length > 1 ? (
          <CardAction className={HEADER_ACTIONS}>
            <CategoryFilterMenu
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
          <ConditionScreen
            tone="destructive"
            glyph="cloud_off"
            ariaRole="alert"
            title={t("connection.events.error_title")}
            description={t("connection.events.error_description")}
            onRetry={refresh}
            retryLabel={t("connection.events.retry")}
            className={cn(EVENTS.EMPTY_H, "justify-center rounded-card")}
          />
        ) : noEvents ? (
          <EventsNotice
            glyph="history"
            title={t("connection.events.empty_title")}
            description={t("connection.events.empty_description")}
          />
        ) : noMatch ? (
          <EventsNotice
            glyph="tune"
            title={t("connection.events.no_match_title")}
            description={t("connection.events.no_match_description")}
            action={{ label: t("connection.events.show_all_events"), onClick: showAll }}
          />
        ) : (
          <div className="-mx-6" aria-busy={isLoading}>
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
                {t(filtered ? "connection.events.shown" : "connection.events.count", {
                  count: total,
                })}
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
