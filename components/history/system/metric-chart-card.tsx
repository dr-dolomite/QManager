"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";

import { axisTicks } from "@/components/history/axis";
import {
  formatClock,
  formatSince,
  formatWhen,
} from "@/components/history/format";
import { useHistoryCursor } from "@/components/history/history-cursor";
import { Chip, buildThrottleLabel } from "@/components/dashboard/status-rail";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChartSeriesMotion } from "@/hooks/use-chart-motion";
import { cn } from "@/lib/utils";
import type { HistoryRange } from "@/types/history";
import type { ThermalPart } from "@/types/modem-status";
import type { SystemHistory, SystemIncident } from "@/types/system-history";

import { HEADER_SHAPE, HISTORY_CARD } from "../cellular/shapes";
import {
  CARD_DESC,
  CARD_HEADER,
  CARD_TITLE,
  CHART,
  HEADER_ACTIONS,
} from "../cellular/signal-shapes";
import {
  AREA_WASH,
  NOTCH_CLIP,
  PLOT,
  PLOT_AXIS_W,
  TIP_TOLERANCE_PX,
} from "./chart-shapes";
import { IncidentRows, TipRow } from "./incident-tip";
import {
  METRIC_SPECS,
  buildMetricPoints,
  countReadings,
  deviceOffAt,
  fraction,
  heatReadoutTone,
  inWindow,
  isCrash,
  latestMetricPoint,
  nearIncidents,
  pointIndexAt,
  spanPercent,
  type MetricKind,
  type MetricPoint,
  type MetricSpec,
} from "./metric-chart";

// =============================================================================
// Metric chart card — processor, memory, temperature
// =============================================================================
// One plot per card on a fixed y scale (so the three read side by side). The
// series is the primary ink; processor and memory wash the area under it with
// that same ink (Area-Fill Rule), temperature stays a bare line with a dashed
// guide at the throttle point.
//
// Behind the series: a muted band wherever the device was off, a faint rule and
// a small notch at the top edge for each crash (planned restarts get only the
// off band), and on the temperature card a warning wash over throttled spans.
// Those layers and the shared cursor are plain DOM over/under the recharts plot,
// which is memoised: handing recharts new children replays its draw-in.
// =============================================================================

/** Fewer buckets with a reading than this and the plot says it is still collecting. */
const MIN_READING_BUCKETS = 3;

const CHART_CONFIG = {
  v: { label: "", color: "var(--primary-on-surface)" },
} satisfies ChartConfig;

interface DotProps {
  key?: string;
  cx?: number;
  cy?: number;
  index?: number;
}

/** A reading with no neighbour on either side has no line to belong to, so the break would hide it. */
function isolatedDot(points: readonly MetricPoint[]) {
  return function IsolatedDot({ key, cx, cy, index }: DotProps) {
    if (cx === undefined || cy === undefined || index === undefined)
      return <g key={key} />;
    if (points[index]?.v === null) return <g key={key} />;
    const prev = index > 0 && points[index - 1].v !== null;
    const next = index < points.length - 1 && points[index + 1].v !== null;
    if (prev || next) return <g key={key} />;
    return <circle key={key} cx={cx} cy={cy} r={2.5} fill="var(--color-v)" />;
  };
}

interface PlotProps {
  spec: MetricSpec;
  points: MetricPoint[];
  gradId: string;
  xDomain: [number, number];
  tickValues: number[];
  tickLabels: Map<number, string>;
  endLabel: string;
}

const MetricPlot = React.memo(function MetricPlot({
  spec,
  points,
  gradId,
  xDomain,
  tickValues,
  tickLabels,
  endLabel,
}: PlotProps) {
  const seriesMotion = useChartSeriesMotion();
  const endSec = xDomain[1];
  const dot = React.useMemo(() => isolatedDot(points), [points]);

  const renderXTick = React.useCallback(
    (props: {
      x?: number;
      y?: number;
      payload?: { value: number };
    }): React.ReactElement<SVGElement> => {
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

  const symbol = spec.unit === "%" ? "%" : "°";

  return (
    <ChartContainer
      config={CHART_CONFIG}
      className={cn(CHART.FILL, CHART.TICK_INK)}
    >
      <ComposedChart data={points} margin={CHART.MARGIN}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-v)"
              stopOpacity={AREA_WASH.TOP}
            />
            <stop
              offset="100%"
              stopColor="var(--color-v)"
              stopOpacity={AREA_WASH.BOTTOM}
            />
          </linearGradient>
        </defs>
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
          tickFormatter={(v: number) => `${v}${symbol}`}
          interval={0}
          width={PLOT_AXIS_W}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          allowDataOverflow
        />
        {spec.area ? (
          <Area
            dataKey="v"
            type="monotone"
            baseValue={spec.domain[0]}
            stroke="var(--color-v)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#${gradId})`}
            connectNulls={false}
            dot={dot}
            activeDot={false}
            {...seriesMotion}
          />
        ) : (
          <Line
            dataKey="v"
            type="monotone"
            stroke="var(--color-v)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            connectNulls={false}
            dot={dot}
            activeDot={false}
            {...seriesMotion}
          />
        )}
      </ComposedChart>
    </ChartContainer>
  );
});

/** The plot rectangle inside the chart box: mirrors the margins and axes, so a percentage of it is a percentage of the plot. */
function PlotBox({
  children,
  interactive,
  ...rest
}: React.ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      {...rest}
      className={cn(
        "absolute",
        interactive ? "touch-pan-y" : "pointer-events-none",
        rest.className,
      )}
      style={{
        left: PLOT_AXIS_W + CHART.MARGIN.left,
        right: CHART.MARGIN.right,
        top: CHART.MARGIN.top,
        bottom: CHART.X_AXIS_H + CHART.MARGIN.bottom,
      }}
    >
      {children}
    </div>
  );
}

interface Hover {
  /** Pointer time, epoch seconds. */
  t: number;
  tolSec: number;
}

export interface MetricChartCardProps {
  kind: MetricKind;
  history: SystemHistory;
  incidents: SystemIncident[];
  range: HistoryRange;
  /** Throttle trip in °C, or null when unknown. */
  tripC: number | null;
  /** Parts being throttled right now, or null when not throttling. */
  throttleParts: ThermalPart[] | null;
  /** Total memory in MB, or null when unknown. */
  memTotalMb: number | null;
}

export function MetricChartCard({
  kind,
  history,
  incidents,
  range,
  tripC,
  throttleParts,
  memTotalMb,
}: MetricChartCardProps) {
  const spec = METRIC_SPECS[kind];
  const { t, i18n } = useTranslation("history");
  const { t: tDash } = useTranslation("dashboard");
  const locale = i18n.language;
  const cursor = useHistoryCursor();
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<Hover | null>(null);
  const gradId = `metric-wash-${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const points = React.useMemo(
    () => buildMetricPoints(history, spec),
    [history, spec],
  );
  const startSec = points[0]?.start ?? history.now;
  const endSec = points[points.length - 1]?.end ?? history.now;
  const xDomain = React.useMemo<[number, number]>(
    () => [startSec, endSec],
    [startSec, endSec],
  );

  const tickLabels = React.useMemo(() => {
    const map = new Map<number, string>();
    for (const k of axisTicks(range, startSec, endSec, locale)) {
      if (k.position < 0.88) map.set(k.t, k.label);
    }
    return map;
  }, [range, startSec, endSec, locale]);
  const tickValues = React.useMemo(
    () => [...tickLabels.keys(), endSec],
    [tickLabels, endSec],
  );

  // --- Layers behind the series -------------------------------------------------
  const layers = React.useMemo(() => {
    const [lo, hi] = spec.domain;
    const off = incidents
      .filter((i) => i.kind === "reboot" && inWindow(i, startSec, endSec))
      .map((i) => ({
        key: `o-${i.start}`,
        ...spanPercent(i.start, i.end, startSec, endSec),
      }));
    const heat =
      kind === "temp"
        ? incidents
            .filter((i) => i.kind === "heat" && inWindow(i, startSec, endSec))
            .map((i) => ({
              key: `h-${i.start}`,
              ...spanPercent(i.start, i.end, startSec, endSec),
            }))
        : [];
    const crashes = incidents
      .filter((i) => isCrash(i) && i.start >= startSec && i.start <= endSec)
      .map((i) => ({
        key: `x-${i.kind}-${i.start}`,
        pct: fraction(i.start, startSec, endSec) * 100,
      }));
    const tripPct =
      kind === "temp" && tripC !== null && tripC >= lo && tripC <= hi
        ? (1 - (tripC - lo) / (hi - lo)) * 100
        : null;
    return { off, heat, crashes, tripPct };
  }, [incidents, kind, spec, startSec, endSec, tripC]);

  // --- Cursor -------------------------------------------------------------------
  const cursorIndex = cursor.t === null ? -1 : pointIndexAt(points, cursor.t);
  const cursorPoint = cursorIndex >= 0 ? points[cursorIndex] : null;
  const shown = cursorPoint ?? latestMetricPoint(points);

  const onPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const span = endSec - startSec;
    if (rect.width <= 0 || span <= 0) return;
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const at = startSec + f * span;
    setHover({ t: at, tolSec: (TIP_TOLERANCE_PX / rect.width) * span });
    cursor.set(at, "chart", kind);
  };

  const onLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    // A finger lifting is not leaving: the reading stays until the next tap.
    if (e.pointerType === "touch") return;
    setHover(null);
    cursor.set(null);
  };

  const hovering = hover !== null;
  React.useEffect(() => {
    if (!hovering) return;
    const dismiss = (e: PointerEvent) => {
      if (overlayRef.current?.contains(e.target as Node)) return;
      setHover(null);
      cursor.set(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
    // `cursor.set` changes identity with every cursor move; only its latest
    // value is needed when a dismissal fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovering]);

  // --- Copy ---------------------------------------------------------------------
  const title = t(`system.charts.${kind}.title`);
  const description =
    kind === "mem"
      ? memTotalMb !== null
        ? t("system.charts.mem.description", { total: Math.round(memTotalMb) })
        : t("system.charts.mem.description_unknown")
      : t(`system.charts.${kind}.description`);

  const value = shown?.raw ?? null;
  const readout = value === null ? "—" : String(Math.round(value));
  const tone = kind === "temp" ? heatReadoutTone(value, tripC) : null;

  const sparse = countReadings(points) < MIN_READING_BUCKETS;
  const sinceSec = history.since;

  const y = (v: number) =>
    (1 - (v - spec.domain[0]) / (spec.domain[1] - spec.domain[0])) * 100;
  const crossX = cursorPoint
    ? fraction(cursorPoint.t, startSec, endSec) * 100
    : null;

  const crosshair =
    cursorPoint && crossX !== null ? (
      <i
        aria-hidden
        className={PLOT.CROSSHAIR}
        style={{ left: `${crossX}%` }}
      />
    ) : null;

  const tipBody = (() => {
    if (!hover) return null;
    const idx = pointIndexAt(points, hover.t);
    const p = idx >= 0 ? points[idx] : null;
    if (!p) return null;
    const near = nearIncidents(incidents, hover.t, hover.tolSec, history.now);
    const noReading = p.raw === null;
    const beforeData = sinceSec === null || hover.t < sinceSec;
    const mb = p.mb !== null ? Math.round(p.mb) : null;
    const reading = noReading
      ? null
      : kind === "mem"
        ? mb !== null
          ? t("system.charts.tip.mem_value", {
              pct: Math.round(p.raw ?? 0),
              mb,
            })
          : `${Math.round(p.raw ?? 0)}%`
        : `${Math.round(p.raw ?? 0)} ${spec.unit}`;
    return (
      <>
        <p className="mb-1.5 font-semibold tabular-nums">
          {formatWhen(p.start, history.now, t, locale)} {"–"}{" "}
          {formatClock(p.end, locale)}
        </p>
        <ul className="flex flex-col gap-0.5">
          {reading !== null ? (
            <TipRow tone="line" label={title} value={reading} />
          ) : (
            <TipRow
              tone="nodata"
              label={t(
                beforeData || !deviceOffAt(incidents, hover.t)
                  ? "system.charts.tip.no_data"
                  : "system.charts.tip.device_off",
              )}
            />
          )}
          <IncidentRows incidents={near} />
        </ul>
      </>
    );
  })();

  return (
    <Card className={cn(HISTORY_CARD, "h-full")} aria-label={title}>
      <CardHeader className={CARD_HEADER}>
        <CardTitle as="h2" className={CARD_TITLE}>
          {title}
        </CardTitle>
        <CardDescription className={CARD_DESC}>{description}</CardDescription>
        <CardAction className={HEADER_ACTIONS}>
          {kind === "temp" && throttleParts !== null ? (
            <Chip
              tone="warning"
              swapKey={buildThrottleLabel(throttleParts, tDash)}
            >
              <MaterialSymbol
                name="thermostat"
                size={15}
                filled
                className="shrink-0"
              />
              {buildThrottleLabel(throttleParts, tDash)}
            </Chip>
          ) : null}
          <div className="flex items-baseline gap-1 whitespace-nowrap">
            <b
              className={cn(
                "min-w-[3ch] text-right text-xl leading-none font-semibold tabular-nums",
                tone === "destructive" && "text-destructive-on-surface",
                tone === "warning" && "text-warning-on-surface",
              )}
            >
              {readout}
            </b>
            <span className="text-xs text-on-surface-variant">{spec.unit}</span>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="px-0">
        <div
          className={CHART.AREA}
          role="img"
          aria-label={t("system.charts.chart_aria", { metric: title })}
        >
          <PlotBox>
            {layers.off.map((b) => (
              <i
                key={b.key}
                className={PLOT.OFF_BAND}
                style={{ left: `${b.left}%`, width: `${b.width}%` }}
              />
            ))}
            {layers.heat.map((b) => (
              <i
                key={b.key}
                className={PLOT.HEAT_BAND}
                style={{ left: `${b.left}%`, width: `${b.width}%` }}
              />
            ))}
            {layers.tripPct !== null && tripC !== null ? (
              <>
                <svg
                  aria-hidden
                  className="absolute inset-x-0 h-px w-full overflow-visible"
                  style={{ top: `${layers.tripPct}%` }}
                >
                  <line
                    x1="0"
                    x2="100%"
                    y1="0.5"
                    y2="0.5"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    className="stroke-on-surface-variant opacity-70"
                  />
                </svg>
                <span
                  className={PLOT.TRIP_LABEL}
                  style={{ top: `${layers.tripPct}%` }}
                >
                  {t("system.charts.throttles_at", { trip: Math.round(tripC) })}
                </span>
              </>
            ) : null}
            {layers.crashes.map((c) => (
              <React.Fragment key={c.key}>
                <i className={PLOT.CRASH_RULE} style={{ left: `${c.pct}%` }} />
                <i
                  className={PLOT.CRASH_NOTCH}
                  style={{ left: `${c.pct}%`, clipPath: NOTCH_CLIP }}
                />
              </React.Fragment>
            ))}
          </PlotBox>

          <MetricPlot
            spec={spec}
            points={points}
            gradId={gradId}
            xDomain={xDomain}
            tickValues={tickValues}
            tickLabels={tickLabels}
            endLabel={t("shared.now")}
          />

          <PlotBox
            interactive
            ref={overlayRef}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={onLeave}
          >
            {hover && tipBody ? (
              <Tooltip open>
                <TooltipTrigger asChild>
                  {crosshair ?? (
                    <i
                      aria-hidden
                      className={PLOT.CROSSHAIR}
                      style={{ left: 0 }}
                    />
                  )}
                </TooltipTrigger>
                <TooltipContent
                  variant="info"
                  side="top"
                  sideOffset={12}
                  className="min-w-44"
                >
                  {tipBody}
                </TooltipContent>
              </Tooltip>
            ) : (
              crosshair
            )}
            {cursorPoint && cursorPoint.v !== null && crossX !== null ? (
              <i
                aria-hidden
                className={PLOT.DOT}
                style={{ left: `${crossX}%`, top: `${y(cursorPoint.v)}%` }}
              />
            ) : null}
          </PlotBox>

          {sparse ? (
            <p className={CHART.COLLECTING} role="status">
              {sinceSec !== null
                ? t("system.charts.collecting_since", {
                    time: formatSince(sinceSec, history.now, t, locale),
                  })
                : t("system.charts.collecting")}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Loaded geometry, drawn quiet: title block, readout, gridlines, axis row. */
export function MetricChartCardSkeleton({ kind }: { kind: MetricKind }) {
  const spec = METRIC_SPECS[kind];
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
            style={{ bottom: CHART.X_AXIS_H, paddingLeft: PLOT_AXIS_W }}
          >
            {spec.ticks.map((tick) => (
              <Skeleton key={tick} className="h-px w-full rounded-none" />
            ))}
          </div>
          <Skeleton
            className="absolute bottom-0 h-3 rounded-inline"
            style={{ left: PLOT_AXIS_W, right: 0 }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
