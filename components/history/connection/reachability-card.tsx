"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { axisTicks } from "@/components/history/axis";
import { formatClock, formatDuration, formatSpan } from "@/components/history/format";
import { useHistoryCursor } from "@/components/history/history-cursor";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { HISTORY_RANGES } from "@/types/history";

import { bucketDurations, bucketIndexAt, bucketKind, collectingSince, type StripKind } from "./derive";
import { HEADER_SHAPE, HISTORY_CARD, LEGEND_DOT, STRIP_SHAPE } from "./shapes";
import { LOSS_SLOW_PCT, type ConnectionHistory, type ConnectionLimits } from "./types";

// =============================================================================
// Reachability card: one rounded bar per bucket, coloured by how the link did
// =============================================================================
// Down is the destructive fill, slow or lossy the warning fill, responsive the
// success fill, and no data (also the radio-off state) the neutral high surface.
// The colour is the reading; the legend names it with a dot beside the word and
// the tooltip gives the figures, so colour is never the only channel.
//
// The strip shares one cursor with the charts and the events table: hovering a
// bar marks that moment everywhere, and a moment marked elsewhere dims the other
// bars here. Hover is resolved on the row, not per bar, so the gaps between bars
// never flicker the tooltip.
// =============================================================================

const FILL: Record<StripKind, string> = {
  up: "bg-success",
  slow: "bg-warning",
  down: "bg-destructive",
  nodata: "bg-surface-container-high",
};

const DOT: Record<StripKind, string> = {
  ...FILL,
  nodata: "bg-surface-container-high ring-1 ring-inset ring-border",
};

const LEGEND_ORDER: StripKind[] = ["up", "slow", "down", "nodata"];

interface TipRow {
  key: string;
  dot: StripKind;
  label: string;
  value: string;
}

export function ReachabilityCard({
  history,
  limits,
}: {
  history: ConnectionHistory;
  limits: ConnectionLimits;
}) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;
  const cursor = useHistoryCursor();
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  const [kbIdx, setKbIdx] = React.useState<number | null>(null);

  const { buckets, now, range } = history;
  const spec = HISTORY_RANGES[range];

  const kinds = React.useMemo(() => buckets.map((b) => bucketKind(b, limits)), [buckets, limits]);
  const present = React.useMemo(() => new Set(kinds), [kinds]);

  // The window the bars span: first bucket start to the end of the last bucket.
  const startSec = buckets[0]?.t ?? now - spec.bucketSec * spec.count;
  const endSec = startSec + spec.bucketSec * spec.count;
  const ticks = React.useMemo(
    () => (history.clock_trusted ? axisTicks(range, startSec, endSec, locale) : []),
    [history.clock_trusted, range, startSec, endSec, locale],
  );

  const sinceSec = collectingSince(history);
  const noHistory = history.since === null || !history.clock_trusted;
  // Where the "collecting" note sits: centred over the leading no-data stretch.
  const leadFraction = noHistory
    ? 1
    : sinceSec === null
      ? 0
      : (sinceSec - startSec) / (endSec - startSec);
  const collectingLabel = noHistory
    ? t("connection.reachability.collecting_plain")
    : sinceSec !== null
      ? t("connection.reachability.collecting", { time: formatClock(sinceSec, locale) })
      : null;

  const activeIdx = hoverIdx ?? kbIdx;
  // A cursor from any surface dims the other bars; the hit bar stays full.
  const markedIdx = cursor.t === null ? null : bucketIndexAt(buckets, cursor.t);

  const mark = (idx: number | null) => {
    if (idx === null) {
      cursor.set(null);
      return;
    }
    cursor.set(buckets[idx].t + spec.bucketSec / 2, "strip", "reachability");
  };

  const indexFromPointer = (e: React.PointerEvent<HTMLDivElement>): number | null => {
    const el = rowRef.current;
    if (!el || buckets.length === 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const f = (e.clientX - rect.left) / rect.width;
    return Math.min(buckets.length - 1, Math.max(0, Math.floor(f * buckets.length)));
  };

  const onPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const idx = indexFromPointer(e);
    setHoverIdx(idx);
    mark(idx);
  };

  const onLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    // A finger lifting is not leaving: the bar stays read until the next tap.
    if (e.pointerType === "touch") return;
    setHoverIdx(null);
    mark(null);
  };

  // A touch reading is dismissed by tapping anywhere outside the row.
  React.useEffect(() => {
    if (hoverIdx === null) return;
    const dismiss = (e: PointerEvent) => {
      if (rowRef.current?.contains(e.target as Node)) return;
      setHoverIdx(null);
      cursor.set(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
    // `cursor.set` changes identity with every cursor move; only its latest
    // value is needed when a dismissal fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverIdx]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (buckets.length === 0) return;
    const last = buckets.length - 1;
    const from = kbIdx ?? last + 1;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = Math.max(0, from - 1);
    else if (e.key === "ArrowRight") next = Math.min(last, from + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") {
      setKbIdx(null);
      mark(null);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    setKbIdx(next);
    mark(next);
  };

  const onBlur = () => {
    setKbIdx(null);
    if (hoverIdx === null) mark(null);
  };

  const windowLabel = (idx: number) => {
    const b = buckets[idx];
    return formatSpan(b.t, b.t + b.len, now, t, locale);
  };

  const tipRows = (idx: number): TipRow[] => {
    const b = buckets[idx];
    const d = bucketDurations(b);
    const rows: TipRow[] = [];
    const latency = b.m.lat_ms?.avg;
    const loss = b.m.loss_pct?.avg;
    if (latency !== undefined) {
      rows.push({
        key: "latency",
        dot: latency > limits.latencyMs ? "slow" : "up",
        label: t("connection.reachability.tooltip.latency"),
        value: `${Math.round(latency)} ms`,
      });
    }
    if (loss !== undefined) {
      rows.push({
        key: "loss",
        dot: loss >= LOSS_SLOW_PCT ? "slow" : "up",
        label: t("connection.reachability.tooltip.loss"),
        value: `${loss < 10 ? loss.toFixed(1) : Math.round(loss)}%`,
      });
    }
    if (d.down > 0) {
      rows.push({
        key: "down",
        dot: "down",
        label: t("connection.reachability.tooltip.down"),
        value: formatDuration(d.down, t),
      });
    }
    if (d.nodata > 0) {
      rows.push({
        key: "nodata",
        dot: "nodata",
        label: t("connection.reachability.tooltip.nodata"),
        value: formatDuration(d.nodata, t),
      });
    }
    return rows;
  };

  const announce =
    kbIdx === null
      ? ""
      : `${windowLabel(kbIdx)}: ${tipRows(kbIdx)
          .map((r) => `${r.label} ${r.value}`)
          .join(", ")}`;

  return (
    <Card className={HISTORY_CARD}>
      <CardHeader className="gap-1 px-0">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className={cn("flex min-w-0 flex-col", HEADER_SHAPE.GAP)}>
            <CardTitle as="h2" className="text-xl font-semibold">
              {t("connection.reachability.title")}
            </CardTitle>
            <CardDescription>{t("connection.reachability.description")}</CardDescription>
          </div>
          <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 pt-1 text-xs text-on-surface-variant">
            {LEGEND_ORDER.filter((k) => present.has(k)).map((k) => (
              <li key={k} className="flex items-center gap-1.5 whitespace-nowrap">
                <span className={cn(LEGEND_DOT, DOT[k])} aria-hidden="true" />
                {t(`connection.reachability.legend.${k}`)}
              </li>
            ))}
          </ul>
        </div>
      </CardHeader>

      <div>
        <div className="relative">
          <div
            ref={rowRef}
            role="group"
            tabIndex={0}
            aria-label={t("connection.reachability.aria")}
            className={cn(
              STRIP_SHAPE.BARS,
              "touch-pan-y rounded-inline outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            )}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={onLeave}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
          >
            {buckets.map((b, i) => {
              const dimmed = markedIdx !== null && markedIdx !== i;
              return (
                <Tooltip key={b.t} open={activeIdx === i}>
                  <TooltipTrigger asChild>
                    <div
                      aria-hidden="true"
                      className={cn(
                        STRIP_SHAPE.BAR,
                        FILL[kinds[i]],
                        "transition-opacity duration-[var(--duration-quick)] ease-[var(--ease-quick)]",
                        dimmed && "opacity-35",
                      )}
                    />
                  </TooltipTrigger>
                  <TooltipContent variant="info" side="top" sideOffset={10} className="min-w-44">
                    <p className="mb-1.5 font-semibold tabular-nums">{windowLabel(i)}</p>
                    <ul className="flex flex-col gap-0.5">
                      {tipRows(i).map((r) => (
                        <li key={r.key} className="flex items-center gap-2 text-on-surface-variant">
                          <span className={cn(LEGEND_DOT, DOT[r.dot])} aria-hidden="true" />
                          {r.label}
                          <span className="ml-auto pl-3 font-semibold text-popover-foreground tabular-nums">
                            {r.value}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          {collectingLabel && leadFraction > 0.25 ? (
            <span
              className="pointer-events-none absolute inset-y-0 flex items-center justify-center px-2 text-xs font-medium text-on-surface-variant"
              style={{ left: 0, width: `${leadFraction * 100}%` }}
            >
              <span className="max-w-full truncate rounded-pill bg-surface px-3 py-1">
                {collectingLabel}
              </span>
            </span>
          ) : null}
        </div>

        <div className={STRIP_SHAPE.AXIS} aria-hidden="true">
          <span className="absolute left-0 top-0">{t(`shared.range_ago.${range}`)}</span>
          {ticks.map((tick) => (
            <span
              key={tick.t}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${tick.position * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
          <span className="absolute right-0 top-0">{t("shared.now")}</span>
        </div>

        <span className="sr-only" aria-live="polite">
          {announce}
        </span>
      </div>
    </Card>
  );
}

export function ReachabilityCardSkeleton({ count }: { count: number }) {
  return (
    <Card className={HISTORY_CARD}>
      <CardHeader className="gap-1 px-0">
        <div className={cn("flex flex-col", HEADER_SHAPE.GAP)}>
          <Skeleton className={cn(HEADER_SHAPE.TITLE, "rounded-inline")} />
          <Skeleton className={cn(HEADER_SHAPE.DESCRIPTION, "rounded-inline")} />
        </div>
      </CardHeader>
      <div>
        <div className={STRIP_SHAPE.BARS}>
          {Array.from({ length: count }, (_, i) => (
            <Skeleton key={i} className={cn(STRIP_SHAPE.BAR, "h-full")} />
          ))}
        </div>
        <div className={cn("mt-2", STRIP_SHAPE.AXIS_HEIGHT)} />
      </div>
    </Card>
  );
}
