"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type { CategoricalChartState } from "recharts/types/chart/types";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

import { axisTicks } from "@/components/history/axis";
import { formatClock, formatWhen } from "@/components/history/format";
import { useHistoryCursor } from "@/components/history/history-cursor";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useChartSeriesMotion } from "@/hooks/use-chart-motion";
import { cn } from "@/lib/utils";
import type { HistoryRange } from "@/types/history";
import type { SiteEntry } from "@/types/sites";

import {
  chartTop,
  msText,
  pointIndexAt,
  siteStats,
  type SitePoint,
  type UnitLabels,
} from "./derive";
import { DETAIL } from "./shapes";
import { SiteMark } from "./site-mark";

/** The cursor owner id this panel's chart writes, so other surfaces know who is hovering. */
const OWNER_ID = "site";

const CHART_CONFIG = {
  ms: { label: "ms", color: "var(--primary-on-surface)" },
} satisfies ChartConfig;

interface DotProps {
  key?: string;
  cx?: number;
  cy?: number;
  index?: number;
}

/** A reading with no neighbour on either side has no line to belong to, so draw it as a dot. */
function makeIsolatedDot(points: readonly SitePoint[]) {
  return function IsolatedDot({ key, cx, cy, index }: DotProps) {
    if (cx === undefined || cy === undefined || index === undefined) return <g key={key} />;
    if (points[index]?.ms === null) return <g key={key} />;
    const prev = index > 0 && points[index - 1].ms !== null;
    const next = index < points.length - 1 && points[index + 1].ms !== null;
    if (prev || next) return <g key={key} />;
    return <circle key={key} cx={cx} cy={cy} r={2.5} fill="var(--color-ms)" />;
  };
}

interface TooltipExtra {
  units: UnitLabels;
  nowSec: number;
}

function SiteTooltip({
  active,
  payload,
  units,
  nowSec,
}: TooltipProps<ValueType, NameType> & TooltipExtra) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;
  const point = payload?.[0]?.payload as SitePoint | undefined;
  if (!active || !point) return null;

  return (
    <div className={DETAIL.TOOLTIP}>
      <span className={DETAIL.TOOLTIP_TITLE}>
        {formatWhen(point.start, nowSec, t, locale)} {"–"} {formatClock(point.end, locale)}
      </span>
      {point.ms !== null ? (
        <>
          <span className={DETAIL.TOOLTIP_ROW}>
            <i aria-hidden className={cn(DETAIL.DOT, "bg-primary-on-surface")} />
            {t("connection.sites.stat_average")}
            <b className={DETAIL.TOOLTIP_VALUE}>{msText(point.ms, units)}</b>
          </span>
          {point.min !== null && point.max !== null ? (
            <span className={DETAIL.TOOLTIP_ROW}>
              <i aria-hidden className={cn(DETAIL.DOT, "bg-transparent")} />
              {t("connection.sites.tooltip_range")}
              <b className={DETAIL.TOOLTIP_VALUE}>
                {msText(point.min, units)} {"–"} {msText(point.max, units)}
              </b>
            </span>
          ) : null}
        </>
      ) : (
        <span className={DETAIL.TOOLTIP_ROW}>
          <i aria-hidden className={cn(DETAIL.DOT, "bg-surface-container-high border")} />
          {point.n > 0
            ? t("connection.sites.tooltip_no_reply")
            : t("connection.sites.tooltip_no_data")}
        </span>
      )}
      {point.n > 0 ? (
        <span className={DETAIL.TOOLTIP_ROW}>
          <i aria-hidden className={cn(DETAIL.DOT, "bg-transparent")} />
          {t("connection.sites.stat_answered")}
          <b className={DETAIL.TOOLTIP_VALUE}>
            {t("connection.sites.answered_count", { ok: point.ok, n: point.n })}
          </b>
        </span>
      ) : null}
    </div>
  );
}

interface PlotProps {
  points: SitePoint[];
  top: number;
  limitMs: number;
  limitLabel: string;
  xDomain: [number, number];
  tickValues: number[];
  tickLabels: Map<number, string>;
  endLabel: string;
  units: UnitLabels;
  nowSec: number;
  onActive: (index: number) => void;
  onLeave: () => void;
}

/**
 * The recharts plot, memoised on purpose: recharts replays a line's draw-in
 * whenever its chart is handed new children, so every prop here is stable
 * across cursor moves and the shared cursor is drawn outside it (`CursorOverlay`).
 */
const SitePlot = memo(function SitePlot({
  points,
  top,
  limitMs,
  limitLabel,
  xDomain,
  tickValues,
  tickLabels,
  endLabel,
  units,
  nowSec,
  onActive,
  onLeave,
}: PlotProps) {
  const seriesMotion = useChartSeriesMotion();
  const endSec = xDomain[1];
  const dot = useMemo(() => makeIsolatedDot(points), [points]);
  const yTicks = useMemo(() => [0, top / 2, top], [top]);

  const renderXTick = useCallback(
    (props: {
      x?: number;
      y?: number;
      payload?: { value: number };
    }): ReactElement<SVGElement> => {
      const { x, y, payload } = props;
      if (x === undefined || y === undefined || !payload) return <g />;
      const isEnd = payload.value === endSec;
      return (
        <text
          x={x}
          y={y}
          dy="0.71em"
          textAnchor={isEnd ? "end" : "middle"}
          className="fill-on-surface-variant text-[0.6875rem] font-medium tabular-nums"
        >
          {isEnd ? endLabel : tickLabels.get(payload.value)}
        </text>
      );
    },
    [endSec, endLabel, tickLabels],
  );

  const tooltip = useMemo(
    () => <SiteTooltip units={units} nowSec={nowSec} />,
    [units, nowSec],
  );

  const handleMove = useCallback(
    (state: CategoricalChartState) => {
      const i = state.activeTooltipIndex;
      if (typeof i === "number") onActive(i);
    },
    [onActive],
  );

  return (
    <ChartContainer config={CHART_CONFIG} className={cn(DETAIL.CHART_FILL, DETAIL.TICK_INK)}>
      <LineChart
        data={points}
        margin={DETAIL.MARGIN}
        onMouseMove={handleMove}
        onMouseLeave={onLeave}
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="t"
          type="number"
          scale="linear"
          domain={xDomain}
          ticks={tickValues}
          tick={renderXTick}
          interval={0}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          height={DETAIL.X_AXIS_H}
          allowDataOverflow
        />
        <YAxis
          domain={[0, top]}
          ticks={yTicks}
          interval={0}
          width={DETAIL.AXIS_W}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          allowDataOverflow
        />
        <ReferenceLine
          y={limitMs}
          stroke="var(--chart-threshold)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          ifOverflow="hidden"
          label={{
            value: limitLabel,
            position: "insideTopRight",
            className: DETAIL.LIMIT_LABEL,
          }}
        />
        <ChartTooltip cursor={false} isAnimationActive={false} content={tooltip} />
        <Line
          dataKey="ms"
          type="monotone"
          stroke="var(--color-ms)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          connectNulls={false}
          dot={dot}
          activeDot={false}
          {...seriesMotion}
        />
      </LineChart>
    </ChartContainer>
  );
});

interface OverlayProps {
  point: SitePoint;
  top: number;
  xDomain: [number, number];
}

/**
 * Crosshair and dot at the shared cursor, drawn as DOM over the plot rather
 * than as recharts children (which would replay the line animation on every
 * pointer move). The inset mirrors the plot's margins and axes.
 */
function CursorOverlay({ point, top, xDomain }: OverlayProps) {
  const x = ((point.t - xDomain[0]) / (xDomain[1] - xDomain[0])) * 100;
  const y = point.ms === null ? null : (1 - Math.min(point.ms, top) / top) * 100;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: DETAIL.AXIS_W + DETAIL.MARGIN.left,
        right: DETAIL.MARGIN.right,
        top: DETAIL.MARGIN.top,
        bottom: DETAIL.X_AXIS_H + DETAIL.MARGIN.bottom,
      }}
    >
      <div
        className="bg-on-surface-variant absolute inset-y-0 w-px -translate-x-1/2 opacity-60"
        style={{ left: `${x}%` }}
      />
      {y !== null ? (
        <i
          className="border-surface-container bg-primary-on-surface absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{ left: `${x}%`, top: `${y}%` }}
        />
      ) : null}
    </div>
  );
}

export interface SiteDetailProps {
  site: SiteEntry;
  range: HistoryRange;
  points: SitePoint[];
  nowSec: number;
  limitMs: number;
  units: UnitLabels;
  onClose: () => void;
}

/** The selected site: range statistics and its latency on the page's bucket grid. */
export function SiteDetail({
  site,
  range,
  points,
  nowSec,
  limitMs,
  units,
  onClose,
}: SiteDetailProps) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;
  const cursor = useHistoryCursor();

  // Handlers read the live cursor through a ref so their identity never
  // changes; a changing handler would re-render the memoised plot.
  const cursorRef = useRef(cursor);
  useEffect(() => {
    cursorRef.current = cursor;
  });

  const stats = useMemo(() => siteStats(site.series), [site.series]);
  const top = useMemo(() => chartTop(points, limitMs), [points, limitMs]);
  const startSec = points[0]?.start ?? nowSec;
  const endSec = points[points.length - 1]?.end ?? nowSec;
  const xDomain = useMemo<[number, number]>(() => [startSec, endSec], [startSec, endSec]);

  const tickLabels = useMemo(() => {
    const map = new Map<number, string>();
    for (const k of axisTicks(range, startSec, endSec, locale)) {
      if (k.position < 0.88) map.set(k.t, k.label);
    }
    return map;
  }, [range, startSec, endSec, locale]);
  const tickValues = useMemo(() => [...tickLabels.keys(), endSec], [tickLabels, endSec]);

  const handleActive = useCallback(
    (index: number) => {
      const p = points[index];
      if (!p) return;
      const c = cursorRef.current;
      if (c.t === p.t && c.ownerId === OWNER_ID) return;
      c.set(p.t, "chart", OWNER_ID);
    },
    [points],
  );
  const handleLeave = useCallback(() => {
    const c = cursorRef.current;
    if (c.ownerId === OWNER_ID) c.set(null);
  }, []);

  const cursorIndex = cursor.t === null ? -1 : pointIndexAt(points, cursor.t);
  const cursorPoint = cursorIndex >= 0 ? points[cursorIndex] : null;
  const hasReadings = points.some((p) => p.ms !== null);

  const figure = (ms: number | null) => (ms === null ? units.dash : msText(ms, units));
  const limitLabel = t("connection.sites.limit", { value: msText(limitMs, units) });

  return (
    <div className={DETAIL.ROOT}>
      <div className={DETAIL.HEAD}>
        <SiteMark host={site.host} label={site.label} size="panel" />
        <h3 className={DETAIL.NAME} title={site.host}>
          {site.label}
        </h3>
        <dl className={DETAIL.STATS}>
          <div className={DETAIL.STAT}>
            <dt>{t("connection.sites.stat_average")}</dt>
            <dd className={DETAIL.STAT_VALUE}>{figure(stats.average)}</dd>
          </div>
          <div className={DETAIL.STAT}>
            <dt>{t("connection.sites.stat_fastest")}</dt>
            <dd className={DETAIL.STAT_VALUE}>{figure(stats.fastest)}</dd>
          </div>
          <div className={DETAIL.STAT}>
            <dt>{t("connection.sites.stat_slowest")}</dt>
            <dd className={DETAIL.STAT_VALUE}>{figure(stats.slowest)}</dd>
          </div>
          <div className={DETAIL.STAT}>
            <dt>{t("connection.sites.stat_answered")}</dt>
            <dd className={DETAIL.STAT_VALUE}>
              {stats.answeredPct === null ? units.dash : `${stats.answeredPct.toFixed(1)}%`}
            </dd>
          </div>
        </dl>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={DETAIL.CLOSE}
          aria-label={t("connection.sites.close")}
          onClick={onClose}
        >
          <MaterialSymbol name="close" size={18} />
        </Button>
      </div>

      <div
        className={DETAIL.CHART_AREA}
        role="img"
        aria-label={t("connection.sites.chart_aria", { site: site.label })}
      >
        <SitePlot
          points={points}
          top={top}
          limitMs={limitMs}
          limitLabel={limitLabel}
          xDomain={xDomain}
          tickValues={tickValues}
          tickLabels={tickLabels}
          endLabel={t("shared.now")}
          units={units}
          nowSec={nowSec}
          onActive={handleActive}
          onLeave={handleLeave}
        />
        {cursorPoint ? <CursorOverlay point={cursorPoint} top={top} xDomain={xDomain} /> : null}
        {!hasReadings ? (
          <p className={DETAIL.EMPTY} role="status">
            {t("connection.sites.chart_empty")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
