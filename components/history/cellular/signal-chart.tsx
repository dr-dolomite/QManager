"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
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
import {
  formatDuration,
  formatSince,
  formatSpan,
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
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { useChartSeriesMotion } from "@/hooks/use-chart-motion";
import { cn } from "@/lib/utils";
import type { CellularHistory } from "@/types/history";

import { bucketIndexAt } from "./derive";
import { HEADER_SHAPE, HISTORY_CARD } from "./shapes";
import {
  buildGapBands,
  buildSignalPoints,
  countReadingBuckets,
  formatReading,
  latestPoint,
  type GapBand,
  type SignalMetricSpec,
  type SignalPoint,
} from "./signal-metrics";
import {
  CARD_DESC,
  CARD_HEADER,
  CARD_TITLE,
  CHART,
  HEADER_ACTIONS,
} from "./signal-shapes";

/** Fewer buckets with a reading than this and the plot says it is still collecting. */
const MIN_READING_BUCKETS = 3;

const CHART_CONFIG = {
  lte: { label: "LTE", color: "var(--lte-on-surface)" },
  nr: { label: "5G NR", color: "var(--primary-on-surface)" },
} satisfies ChartConfig;

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
function isolatedDot(series: "lte" | "nr", color: string, points: readonly SignalPoint[]) {
  return function IsolatedDot({ key, cx, cy, index }: DotProps) {
    if (cx === undefined || cy === undefined || index === undefined) return <g key={key} />;
    if (points[index]?.[series] === null) return <g key={key} />;
    const prev = index > 0 && points[index - 1][series] !== null;
    const next = index < points.length - 1 && points[index + 1][series] !== null;
    if (prev || next) return <g key={key} />;
    return <circle key={key} cx={cx} cy={cy} r={2.5} fill={color} />;
  };
}

interface TooltipExtra {
  spec: SignalMetricSpec;
  hasNr: boolean;
  nowSec: number;
}

function SignalTooltip({
  active,
  payload,
  spec,
  hasNr,
  nowSec,
}: TooltipProps<ValueType, NameType> & TooltipExtra) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;
  const point = payload?.[0]?.payload as SignalPoint | undefined;
  if (!active || !point) return null;

  const unit = ` ${spec.unit}`;
  return (
    <div className={CHART.TOOLTIP}>
      <span className={CHART.TOOLTIP_TITLE}>
        {formatSpan(point.start, point.end, nowSec, t, locale)}
      </span>
      {point.lteRaw !== null ? (
        <span className={CHART.TOOLTIP_ROW}>
          <i aria-hidden className={cn(CHART.DOT, "bg-lte-on-surface")} />
          LTE
          <b className={CHART.TOOLTIP_VALUE}>
            {formatReading(point.lteRaw, spec.decimals)}
            {unit}
          </b>
        </span>
      ) : null}
      {hasNr && point.nrRaw !== null ? (
        <span className={CHART.TOOLTIP_ROW}>
          <i aria-hidden className={cn(CHART.DOT, "bg-primary-on-surface")} />
          5G NR
          <b className={CHART.TOOLTIP_VALUE}>
            {formatReading(point.nrRaw, spec.decimals)}
            {unit}
          </b>
        </span>
      ) : null}
      {point.downSec > 0 ? (
        <span className={CHART.TOOLTIP_ROW}>
          <i aria-hidden className={cn(CHART.DOT, "bg-destructive")} />
          {t("cellular.signal.no_service")}
          <b className={CHART.TOOLTIP_VALUE}>{formatDuration(point.downSec, t)}</b>
        </span>
      ) : null}
      {point.state === "nodata" ? (
        <span className={CHART.TOOLTIP_ROW}>
          <i aria-hidden className={cn(CHART.DOT, "bg-surface-container-high border")} />
          {t("cellular.signal.no_data")}
        </span>
      ) : null}
    </div>
  );
}

interface PlotProps {
  spec: SignalMetricSpec;
  points: SignalPoint[];
  bands: GapBand[];
  hasNr: boolean;
  xDomain: [number, number];
  tickValues: number[];
  tickLabels: Map<number, string>;
  endLabel: string;
  nowSec: number;
  onActive: (index: number) => void;
  onLeave: () => void;
}

/**
 * The recharts plot, memoised on purpose. recharts restarts a line's draw-in
 * whenever its chart is handed new children, so every prop here is stable
 * across cursor moves and the shared cursor is drawn outside it (see
 * `CursorOverlay`). Re-rendering this component replays the animation.
 */
const SignalPlot = memo(function SignalPlot({
  spec,
  points,
  bands,
  hasNr,
  xDomain,
  tickValues,
  tickLabels,
  endLabel,
  nowSec,
  onActive,
  onLeave,
}: PlotProps) {
  const seriesMotion = useChartSeriesMotion();
  const endSec = xDomain[1];

  const lteDot = useMemo(() => isolatedDot("lte", "var(--color-lte)", points), [points]);
  const nrDot = useMemo(() => isolatedDot("nr", "var(--color-nr)", points), [points]);

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
    () => <SignalTooltip spec={spec} hasNr={hasNr} nowSec={nowSec} />,
    [spec, hasNr, nowSec],
  );

  const handleMove = useCallback(
    (state: CategoricalChartState) => {
      const i = state.activeTooltipIndex;
      if (typeof i === "number") onActive(i);
    },
    [onActive],
  );

  return (
    <ChartContainer config={CHART_CONFIG} className={cn(CHART.FILL, CHART.TICK_INK)}>
      <LineChart
        data={points}
        margin={CHART.MARGIN}
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
          height={CHART.X_AXIS_H}
          allowDataOverflow
        />
        <YAxis
          domain={spec.domain}
          ticks={spec.ticks}
          tickFormatter={(v: number) => formatReading(v, 0)}
          interval={0}
          width={CHART.AXIS_W}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          allowDataOverflow
        />
        {bands.map((b) => (
          <ReferenceArea
            key={b.x1}
            x1={b.x1}
            x2={b.x2}
            fill="var(--surface-container-high)"
            fillOpacity={0.6}
            stroke="none"
            ifOverflow="hidden"
          />
        ))}
        <ChartTooltip cursor={false} isAnimationActive={false} content={tooltip} />
        <Line
          dataKey="lte"
          type="monotone"
          stroke="var(--color-lte)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          connectNulls={false}
          dot={lteDot}
          activeDot={false}
          {...seriesMotion}
        />
        {hasNr ? (
          <Line
            dataKey="nr"
            type="monotone"
            stroke="var(--color-nr)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            connectNulls={false}
            dot={nrDot}
            activeDot={false}
            {...seriesMotion}
          />
        ) : null}
      </LineChart>
    </ChartContainer>
  );
});

interface OverlayProps {
  spec: SignalMetricSpec;
  point: SignalPoint;
  hasNr: boolean;
  xDomain: [number, number];
}

/**
 * Crosshair and dots at the shared cursor, drawn as DOM over the plot rather
 * than as recharts children (which would replay the line animation on every
 * pointer move). The inset mirrors the plot's margins and axes, so a percentage
 * of this box is a percentage of the plot.
 */
function CursorOverlay({ spec, point, hasNr, xDomain }: OverlayProps) {
  const [y0, y1] = spec.domain;
  const x = ((point.t - xDomain[0]) / (xDomain[1] - xDomain[0])) * 100;
  const y = (v: number) => (1 - (v - y0) / (y1 - y0)) * 100;
  const dot = "border-surface absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: CHART.AXIS_W + CHART.MARGIN.left,
        right: CHART.MARGIN.right,
        top: CHART.MARGIN.top,
        bottom: CHART.X_AXIS_H + CHART.MARGIN.bottom,
      }}
    >
      <div
        className="bg-on-surface-variant absolute inset-y-0 w-px -translate-x-1/2 opacity-60"
        style={{ left: `${x}%` }}
      />
      {point.lte !== null ? (
        <i className={cn(dot, "bg-lte-on-surface")} style={{ left: `${x}%`, top: `${y(point.lte)}%` }} />
      ) : null}
      {hasNr && point.nr !== null ? (
        <i
          className={cn(dot, "bg-primary-on-surface")}
          style={{ left: `${x}%`, top: `${y(point.nr)}%` }}
        />
      ) : null}
    </div>
  );
}

export interface SignalChartProps {
  spec: SignalMetricSpec;
  history: CellularHistory;
  lteOnly: boolean;
}

/** One metric card: header readout (latest or at the shared cursor) and a line plot. */
export function SignalChart({ spec, history, lteOnly }: SignalChartProps) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;
  const cursor = useHistoryCursor();

  // Handlers read the live cursor through a ref so their identity never
  // changes; a changing handler would re-render the memoised plot.
  const cursorRef = useRef(cursor);
  useEffect(() => {
    cursorRef.current = cursor;
  });

  const hasNr = !lteOnly && spec.nr !== null;
  const points = useMemo(
    () => buildSignalPoints(history, spec, lteOnly),
    [history, spec, lteOnly],
  );
  const bands = useMemo(() => buildGapBands(history, points), [history, points]);
  const startSec = points[0]?.start ?? history.now;
  const endSec = points[points.length - 1]?.end ?? history.now;
  const xDomain = useMemo<[number, number]>(() => [startSec, endSec], [startSec, endSec]);

  const tickLabels = useMemo(() => {
    const map = new Map<number, string>();
    for (const k of axisTicks(history.range, startSec, endSec, locale)) {
      if (k.position < 0.88) map.set(k.t, k.label);
    }
    return map;
  }, [history.range, startSec, endSec, locale]);
  const tickValues = useMemo(() => [...tickLabels.keys(), endSec], [tickLabels, endSec]);

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
  const shown = cursorPoint ?? latestPoint(points);

  const sparse = countReadingBuckets(points) < MIN_READING_BUCKETS;
  const sinceSec = history.since ?? history.current?.since ?? null;

  const title = t(`cellular.signal.${spec.id}.title`);

  return (
    <Card className={cn(HISTORY_CARD, "h-full")} aria-label={title}>
      <CardHeader className={CARD_HEADER}>
        <CardTitle as="h2" className={CARD_TITLE}>
          {title}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`cellular.signal.${spec.id}.description`)}
        </CardDescription>
        <CardAction className={HEADER_ACTIONS}>
          <div className={CHART.READOUT}>
            <span className={CHART.READOUT_ITEM}>
              <i aria-hidden className={cn(CHART.DOT, "bg-lte-on-surface")} />
              LTE
              <b className={CHART.READOUT_VALUE}>
                {formatReading(shown?.lteRaw ?? null, spec.decimals)}
              </b>
            </span>
            {hasNr ? (
              <span className={CHART.READOUT_ITEM}>
                <i aria-hidden className={cn(CHART.DOT, "bg-primary-on-surface")} />
                5G
                <b className={CHART.READOUT_VALUE}>
                  {formatReading(shown?.nrRaw ?? null, spec.decimals)}
                </b>
              </span>
            ) : null}
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="px-0">
        <div
          className={CHART.AREA}
          role="img"
          aria-label={t("cellular.signal.chart_aria", { metric: title })}
        >
          <SignalPlot
            spec={spec}
            points={points}
            bands={bands}
            hasNr={hasNr}
            xDomain={xDomain}
            tickValues={tickValues}
            tickLabels={tickLabels}
            endLabel={t("shared.now")}
            nowSec={history.now}
            onActive={handleActive}
            onLeave={handleLeave}
          />
          {cursorPoint ? (
            <CursorOverlay spec={spec} point={cursorPoint} hasNr={hasNr} xDomain={xDomain} />
          ) : null}
          {sparse ? (
            <p className={CHART.COLLECTING} role="status">
              {sinceSec !== null
                ? t("cellular.signal.collecting_since", {
                    time: formatSince(sinceSec, history.now, t, locale),
                  })
                : t("cellular.signal.collecting")}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Loaded geometry, drawn quiet: title block, readout, gridlines, axis row. */
export function SignalChartSkeleton({ spec }: { spec: SignalMetricSpec }) {
  return (
    <Card className={cn(HISTORY_CARD, "h-full")} aria-hidden>
      <CardHeader className={cn(CARD_HEADER, HEADER_SHAPE.GAP)}>
        <Skeleton className="h-5 w-16 rounded-inline" />
        <Skeleton className="h-5 w-48 max-w-full rounded-inline" />
        <CardAction className={HEADER_ACTIONS}>
          <Skeleton className="h-5 w-28 rounded-inline" />
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <div className={CHART.AREA}>
          <div
            className="absolute inset-x-0 top-2 flex flex-col justify-between"
            style={{ bottom: CHART.X_AXIS_H, paddingLeft: CHART.AXIS_W }}
          >
            {spec.ticks.map((tick) => (
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
