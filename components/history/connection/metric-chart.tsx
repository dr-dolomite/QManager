"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type { CategoricalChartState } from "recharts/types/chart/types";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

import { axisTicks } from "@/components/history/axis";
import {
  formatClock,
  formatDuration,
  formatSince,
  formatWhen,
} from "@/components/history/format";
import { useHistoryCursor } from "@/components/history/history-cursor";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { useChartBarMotion, useChartSeriesMotion } from "@/hooks/use-chart-motion";
import { cn } from "@/lib/utils";
import { HISTORY_RANGES } from "@/types/history";

import {
  buildChartPoints,
  buildOutageBands,
  chartScale,
  countReadingBuckets,
  formatMetric,
  latestPoint,
  limitFor,
  type ChartPoint,
  type ChartScale,
  type ChartSpec,
} from "./chart-metrics";
import { bucketIndexAt } from "./derive";
import {
  CARD_DESC,
  CARD_HEADER,
  CARD_TITLE,
  CHART,
  HEADER_ACTIONS,
  HEADER_SHAPE,
  HISTORY_CARD,
} from "./shapes";
import type { ConnectionHistory, ConnectionLimits } from "./types";

// =============================================================================
// Metric chart: one card per connection metric
// =============================================================================
// Latency, jitter and DNS lookup are a single primary stroke (no area fill);
// packet loss is one bar per bucket, warning above zero and destructive at or
// above the limit. Latency and loss draw the user's limit as a dashed line. An
// outage is a faint neutral band behind the plot. Colour belongs to the reading:
// the stroke is one hue and only the limit and the loss bars carry a verdict.
// =============================================================================

/** Fewer buckets with a reading than this and the plot says it is still collecting. */
const MIN_READING_BUCKETS = 3;

/** A loss bucket below this is rounding noise, not a bar. */
const MIN_LOSS_BAR = 0.05;

const CHART_CONFIG = {
  value: { label: "Value", color: "var(--primary-on-surface)" },
} satisfies ChartConfig;

const PLOT_INSET: CSSProperties = {
  left: CHART.AXIS_W + CHART.MARGIN.left,
  right: CHART.MARGIN.right,
  top: CHART.MARGIN.top,
  bottom: CHART.X_AXIS_H + CHART.MARGIN.bottom,
};

function withUnit(value: number | null, unit: "ms" | "%"): string {
  const text = formatMetric(value, unit);
  return unit === "%" ? `${text}%` : `${text} ms`;
}

interface DotProps {
  key?: string;
  cx?: number;
  cy?: number;
  index?: number;
}

/**
 * A reading with no neighbour on either side has no line to belong to, so the
 * break would hide it. Everything else draws no dot: the stroke is the data.
 */
function isolatedDot(points: readonly ChartPoint[]) {
  return function IsolatedDot({ key, cx, cy, index }: DotProps) {
    if (cx === undefined || cy === undefined || index === undefined) return <g key={key} />;
    if (points[index]?.v === null) return <g key={key} />;
    const prev = index > 0 && points[index - 1].v !== null;
    const next = index < points.length - 1 && points[index + 1].v !== null;
    if (prev || next) return <g key={key} />;
    return <circle key={key} cx={cx} cy={cy} r={2.5} fill="var(--primary-on-surface)" />;
  };
}

interface TooltipExtra {
  spec: ChartSpec;
  title: string;
  nowSec: number;
}

function MetricTooltip({
  active,
  payload,
  spec,
  title,
  nowSec,
}: TooltipProps<ValueType, NameType> & TooltipExtra) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;
  const point = payload?.[0]?.payload as ChartPoint | undefined;
  if (!active || !point) return null;

  return (
    <div className={CHART.TOOLTIP}>
      <span className={CHART.TOOLTIP_TITLE}>
        {formatWhen(point.start, nowSec, t, locale)} {"–"} {formatClock(point.end, locale)}
      </span>
      {point.raw !== null ? (
        <span className={CHART.TOOLTIP_ROW}>
          <i aria-hidden className={cn(CHART.DOT, "bg-primary-on-surface")} />
          {title}
          <b className={CHART.TOOLTIP_VALUE}>{withUnit(point.raw, spec.unit)}</b>
        </span>
      ) : null}
      {point.peak !== null && point.raw !== null && Math.round(point.peak) > Math.round(point.raw) ? (
        <span className={CHART.TOOLTIP_ROW}>
          <i aria-hidden className={cn(CHART.DOT, "bg-surface-container-high border")} />
          {t("connection.charts.peak")}
          <b className={CHART.TOOLTIP_VALUE}>{withUnit(point.peak, spec.unit)}</b>
        </span>
      ) : null}
      {point.downSec > 0 ? (
        <span className={CHART.TOOLTIP_ROW}>
          <i aria-hidden className={cn(CHART.DOT, "bg-destructive")} />
          {t("connection.charts.down")}
          <b className={CHART.TOOLTIP_VALUE}>{formatDuration(point.downSec, t)}</b>
        </span>
      ) : null}
      {point.state === "nodata" ? (
        <span className={CHART.TOOLTIP_ROW}>
          <i aria-hidden className={cn(CHART.DOT, "bg-surface-container-high border")} />
          {t("connection.charts.no_data")}
        </span>
      ) : null}
    </div>
  );
}

interface PlotProps {
  spec: ChartSpec;
  title: string;
  points: ChartPoint[];
  scale: ChartScale;
  limit: number | null;
  limitLabel: string;
  xDomain: [number, number];
  tickValues: number[];
  tickLabels: Map<number, string>;
  endValue: number;
  endLabel: string;
  nowSec: number;
  onActive: (index: number) => void;
  onLeave: () => void;
}

/**
 * The recharts plot, memoised on purpose. recharts restarts a series' draw-in
 * whenever its chart is handed new children, so every prop here is stable across
 * cursor moves and the shared cursor is drawn outside it (see `CursorOverlay`).
 * Re-rendering this component replays the animation.
 */
const MetricPlot = memo(function MetricPlot({
  spec,
  title,
  points,
  scale,
  limit,
  limitLabel,
  xDomain,
  tickValues,
  tickLabels,
  endValue,
  endLabel,
  nowSec,
  onActive,
  onLeave,
}: PlotProps) {
  const seriesMotion = useChartSeriesMotion();
  const barMotion = useChartBarMotion();
  const bars = spec.kind === "bars";

  const dot = useMemo(() => isolatedDot(points), [points]);

  const renderXTick = useCallback(
    (props: { x?: number; y?: number; payload?: { value: number } }): ReactElement<SVGElement> => {
      const { x, y, payload } = props;
      if (x === undefined || y === undefined || !payload) return <g />;
      const isEnd = payload.value === endValue;
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
    [endValue, endLabel, tickLabels],
  );

  const tooltip = useMemo(
    () => <MetricTooltip spec={spec} title={title} nowSec={nowSec} />,
    [spec, title, nowSec],
  );

  const handleMove = useCallback(
    (state: CategoricalChartState) => {
      const i = state.activeTooltipIndex;
      if (typeof i === "number") onActive(i);
    },
    [onActive],
  );

  const axes: ReactNode[] = [
    <CartesianGrid key="grid" vertical={false} stroke="var(--border)" />,
    bars ? (
      <XAxis
        key="x"
        dataKey="t"
        ticks={tickValues}
        tick={renderXTick}
        interval={0}
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        height={CHART.X_AXIS_H}
      />
    ) : (
      <XAxis
        key="x"
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
        height={CHART.X_AXIS_H}
        allowDataOverflow
      />
    ),
    <YAxis
      key="y"
      domain={[0, scale.top]}
      ticks={scale.ticks}
      tickFormatter={(v: number) => (spec.unit === "%" ? `${v}%` : String(v))}
      interval={0}
      width={CHART.AXIS_W}
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      allowDataOverflow
    />,
    limit !== null ? (
      <ReferenceLine
        key="limit"
        y={limit}
        stroke="var(--chart-threshold)"
        strokeWidth={1.5}
        strokeDasharray="4 4"
        ifOverflow="hidden"
        label={{
          value: limitLabel,
          position: "insideTopRight",
          fill: "var(--chart-threshold)",
          fontSize: 11,
        }}
      />
    ) : null,
    <ChartTooltip key="tip" cursor={false} isAnimationActive={false} content={tooltip} />,
  ];

  return (
    <ChartContainer config={CHART_CONFIG} className={cn(CHART.FILL, CHART.TICK_INK)}>
      {bars ? (
        <BarChart
          data={points}
          margin={CHART.MARGIN}
          barCategoryGap="18%"
          onMouseMove={handleMove}
          onMouseLeave={onLeave}
        >
          {axes}
          <Bar dataKey="v" radius={[3, 3, 0, 0]} minPointSize={2} {...barMotion}>
            {points.map((p) => (
              <Cell
                key={p.start}
                fill={limit !== null && (p.raw ?? 0) >= limit ? "var(--destructive)" : "var(--warning)"}
              />
            ))}
          </Bar>
        </BarChart>
      ) : (
        <LineChart
          data={points}
          margin={CHART.MARGIN}
          onMouseMove={handleMove}
          onMouseLeave={onLeave}
        >
          {axes}
          <Line
            dataKey="v"
            type="monotone"
            stroke="var(--primary-on-surface)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            connectNulls={false}
            dot={dot}
            activeDot={false}
            {...seriesMotion}
          />
        </LineChart>
      )}
    </ChartContainer>
  );
});

/** The plot's own box, so a percentage of it is a percentage of the plot. */
function PlotInset({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden className="pointer-events-none absolute" style={PLOT_INSET}>
      {children}
    </div>
  );
}

/**
 * Crosshair and dot at the shared cursor, drawn as DOM over the plot rather than
 * as recharts children (which would replay the animation on every pointer move).
 */
function CursorOverlay({
  point,
  top,
  showDot,
  xDomain,
}: {
  point: ChartPoint;
  top: number;
  showDot: boolean;
  xDomain: [number, number];
}) {
  const x = ((point.t - xDomain[0]) / (xDomain[1] - xDomain[0])) * 100;
  const y = point.v === null ? null : (1 - point.v / top) * 100;
  return (
    <PlotInset>
      <div
        className="bg-on-surface-variant absolute inset-y-0 w-px -translate-x-1/2 opacity-60"
        style={{ left: `${x}%` }}
      />
      {showDot && y !== null ? (
        <i
          className="border-surface bg-primary-on-surface absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{ left: `${x}%`, top: `${y}%` }}
        />
      ) : null}
    </PlotInset>
  );
}

function readoutTone(spec: ChartSpec, value: number | null, limit: number | null): string {
  if (value === null || limit === null) return "";
  if (spec.id === "loss") {
    if (value >= limit) return "text-destructive-on-surface";
    return value > MIN_LOSS_BAR ? "text-warning-on-surface" : "";
  }
  if (value >= limit * 2) return "text-destructive-on-surface";
  return value > limit ? "text-warning-on-surface" : "";
}

export interface MetricChartProps {
  spec: ChartSpec;
  history: ConnectionHistory;
  limits: ConnectionLimits;
}

/** One metric card: header readout (latest or at the shared cursor) and a plot. */
export function MetricChart({ spec, history, limits }: MetricChartProps) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;
  const cursor = useHistoryCursor();

  // Handlers read the live cursor through a ref so their identity never
  // changes; a changing handler would re-render the memoised plot.
  const cursorRef = useRef(cursor);
  useEffect(() => {
    cursorRef.current = cursor;
  });

  const bars = spec.kind === "bars";
  const limit = limitFor(spec, limits);
  const { bucketSec } = HISTORY_RANGES[history.range];

  const scale = useMemo(() => chartScale(history, spec, limit), [history, spec, limit]);
  const points = useMemo(() => buildChartPoints(history, spec, scale.top), [history, spec, scale.top]);
  // Loss draws a bar only where something was lost.
  const plotPoints = useMemo(
    () =>
      bars ? points.map((p) => (p.v !== null && p.v < MIN_LOSS_BAR ? { ...p, v: null } : p)) : points,
    [bars, points],
  );
  const bands = useMemo(() => buildOutageBands(history), [history]);

  const startSec = history.buckets[0]?.t ?? history.now;
  const endSec = startSec + history.buckets.length * bucketSec;
  const xDomain = useMemo<[number, number]>(() => [startSec, endSec], [startSec, endSec]);

  const { tickValues, tickLabels, endValue } = useMemo(() => {
    const labels = new Map<number, string>();
    // A category axis (bars) only knows its bucket centres, so each label snaps to one.
    const snap = (at: number) =>
      bars
        ? points.reduce((best, p) => (Math.abs(p.t - at) < Math.abs(best - at) ? p.t : best), points[0]?.t ?? at)
        : at;
    if (history.clock_trusted) {
      for (const k of axisTicks(history.range, startSec, endSec, locale)) {
        if (k.position < 0.88) labels.set(snap(k.t), k.label);
      }
    }
    const end = bars && points.length > 0 ? points[points.length - 1].t : endSec;
    return { tickLabels: labels, tickValues: [...labels.keys(), end], endValue: end };
  }, [bars, points, history.clock_trusted, history.range, startSec, endSec, locale]);

  const specId = spec.id;
  const handleActive = useCallback(
    (index: number) => {
      const p = points[index];
      if (!p) return;
      const c = cursorRef.current;
      if (c.t === p.t && c.ownerId === specId) return;
      c.set(p.t, "chart", specId);
    },
    [points, specId],
  );
  const handleLeave = useCallback(() => {
    const c = cursorRef.current;
    if (c.ownerId === specId) c.set(null);
  }, [specId]);

  const cursorIndex = cursor.t === null ? -1 : bucketIndexAt(history.buckets, cursor.t);
  const cursorPoint = cursorIndex >= 0 ? (points[cursorIndex] ?? null) : null;
  // While the link is down there is no current reading to show.
  const downNow = history.current?.state === "down";
  const shown = cursorPoint ?? (downNow ? null : latestPoint(points));
  const shownValue = shown?.raw ?? null;

  const sparse = countReadingBuckets(points) < MIN_READING_BUCKETS;
  const sinceSec = history.since;

  const title = t(`connection.charts.${spec.id}.title`);
  const limitLabel = limit !== null ? t("connection.charts.limit", { value: withUnit(limit, spec.unit) }) : "";

  return (
    <Card className={cn(HISTORY_CARD, "h-full")} aria-label={title}>
      <CardHeader className={CARD_HEADER}>
        <CardTitle as="h2" className={CARD_TITLE}>
          {title}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`connection.charts.${spec.id}.description`)}
        </CardDescription>
        <CardAction className={HEADER_ACTIONS}>
          <div className="flex items-baseline gap-1" aria-live="off">
            <b
              className={cn(
                "text-on-surface min-w-[3ch] text-right text-xl leading-none font-semibold tabular-nums",
                readoutTone(spec, shownValue, limit),
              )}
            >
              {formatMetric(shownValue, spec.unit)}
            </b>
            <span className="text-on-surface-variant text-xs">{spec.unit}</span>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="px-0">
        <div
          className={CHART.AREA}
          role="img"
          aria-label={t("connection.charts.chart_aria", { metric: title })}
        >
          {bands.length > 0 ? (
            <PlotInset>
              {bands.map((b) => (
                <div
                  key={b.from}
                  className="bg-surface-container-high absolute inset-y-0 rounded-[2px] opacity-60"
                  style={{
                    left: `${b.from * 100}%`,
                    width: `max(2px, ${(b.to - b.from) * 100}%)`,
                  }}
                />
              ))}
            </PlotInset>
          ) : null}
          <MetricPlot
            spec={spec}
            title={title}
            points={plotPoints}
            scale={scale}
            limit={limit}
            limitLabel={limitLabel}
            xDomain={xDomain}
            tickValues={tickValues}
            tickLabels={tickLabels}
            endValue={endValue}
            endLabel={t("shared.now")}
            nowSec={history.now}
            onActive={handleActive}
            onLeave={handleLeave}
          />
          {cursorPoint ? (
            <CursorOverlay point={cursorPoint} top={scale.top} showDot={!bars} xDomain={xDomain} />
          ) : null}
          {sparse ? (
            <p className={CHART.COLLECTING} role="status">
              {sinceSec !== null && history.clock_trusted
                ? t("connection.charts.collecting_since", {
                    time: formatSince(sinceSec, history.now, t, locale),
                  })
                : t("connection.charts.collecting")}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Three gridlines, like the loaded axis (0, half, top). */
const SKELETON_GRIDLINES = [0, 1, 2];

/** Loaded geometry, drawn quiet: title block, readout, gridlines, axis row. */
export function MetricChartSkeleton() {
  return (
    <Card className={cn(HISTORY_CARD, "h-full")} aria-hidden>
      <CardHeader className={cn(CARD_HEADER, HEADER_SHAPE.GAP)}>
        <Skeleton className="h-5 w-24 rounded-inline" />
        <Skeleton className="h-5 w-48 max-w-full rounded-inline" />
        <CardAction className={HEADER_ACTIONS}>
          <Skeleton className="h-5 w-16 rounded-inline" />
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <div className={CHART.AREA}>
          <div
            className="absolute inset-x-0 top-2 flex flex-col justify-between"
            style={{ bottom: CHART.X_AXIS_H, paddingLeft: CHART.AXIS_W }}
          >
            {SKELETON_GRIDLINES.map((tick) => (
              <Skeleton key={tick} className="h-px w-full rounded-none" />
            ))}
          </div>
          <Skeleton
            className="absolute bottom-0 h-3 rounded-inline"
            style={{ left: CHART.AXIS_W, right: 0 }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
