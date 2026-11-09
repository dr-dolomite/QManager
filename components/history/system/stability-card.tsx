"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { SLOT, withSlot } from "@/components/auth/interpolation-slot";
import { axisTicks } from "@/components/history/axis";
import { formatWhen } from "@/components/history/format";
import { useHistoryCursor } from "@/components/history/history-cursor";
import { useMotionReduced } from "@/components/motion-preference";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { HistoryRange } from "@/types/history";
import type { SystemIncident } from "@/types/system-history";

import { HEADER_SHAPE, HISTORY_CARD, LEGEND_DOT } from "../cellular/shapes";
import {
  CARD_DESC,
  CARD_HEADER,
  CARD_TITLE,
  HEADER_ACTIONS,
} from "../cellular/signal-shapes";
import {
  LANE,
  LANE_TICK_MIN,
  LANE_TICK_WIDE_ONLY,
  NO_DATA_BAND,
  RUN_AFTER_GAP,
  TRACK_RUNNING,
  TIP_TOLERANCE_PX,
} from "./chart-shapes";
import { IncidentRows, TipRow } from "./incident-tip";
import { fraction, nearIncidents, spanPercent } from "./metric-chart";

// =============================================================================
// Stability card — three lanes, one per thing that can go down
// =============================================================================
// Each lane is a 26px track, solid success while the thing ran. A device-off
// period is a gap in the card colour on all three lanes (nothing ran while the
// device was off). On top of that: a crash is a destructive mark, a planned
// restart only the gap, heat throttling a warning span. Marks reach 4px past
// the track and wear a card-colour outline, so they read by shape as well as
// colour. Before collection began a lane shows a hatched "no data" band instead
// of pretending it ran.
//
// Positions are time-proportional from `startSec` to `nowSec`. The lanes share
// the page-wide cursor: hovering one moves a cursor line on every lane (and on
// the charts), and a cursor from another surface draws here too.
// =============================================================================

type LaneId = "device" | "modem" | "heat";

interface Hover {
  id: LaneId;
  /** Pointer time, epoch seconds. */
  t: number;
  /** A few pixels' worth of seconds, for picking nearby incidents. */
  tolSec: number;
}

interface Placed {
  key: string;
  left: number;
  width: number;
}

interface Mark extends Placed {
  tone: "bad" | "warn" | "plan";
  live: boolean;
}

const LEGEND_DOTS = {
  ok: "bg-success",
  bad: "bg-destructive",
  plan: "bg-surface ring-1 ring-inset ring-on-surface-variant",
  warn: "bg-warning",
  nodata: "bg-surface-container-high ring-1 ring-inset ring-border",
} as const;

interface LaneTrackProps {
  id: LaneId;
  ariaLabel: string;
  /** Fraction 0..1 of the lane with no data (from the left). */
  noData: number;
  cuts: readonly Placed[];
  marks: readonly Mark[];
  blink: boolean;
  /** Percent along the lane where the shared cursor sits, or null. */
  cursorPct: number | null;
  tip: React.ReactNode | null;
  onPointer: (id: LaneId, e: React.PointerEvent<HTMLDivElement>) => void;
  onLeave: (e: React.PointerEvent<HTMLDivElement>) => void;
}

function LaneTrack({
  id,
  ariaLabel,
  noData,
  cuts,
  marks,
  blink,
  cursorPct,
  tip,
  onPointer,
  onLeave,
}: LaneTrackProps) {
  const line =
    cursorPct === null ? null : (
      <i
        aria-hidden
        className={LANE.CURSOR}
        style={{ left: `${cursorPct}%` }}
      />
    );

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      data-lane={id}
      className={cn(LANE.TRACK, noData === 0 && TRACK_RUNNING)}
      onPointerMove={(e) => onPointer(id, e)}
      onPointerDown={(e) => onPointer(id, e)}
      onPointerLeave={onLeave}
    >
      {cuts.map((c) => (
        <i
          key={c.key}
          aria-hidden
          className={LANE.CUT}
          style={{ left: `${c.left}%`, width: `${c.width}%` }}
        />
      ))}

      {noData > 0 ? (
        <>
          <i
            aria-hidden
            className={cn(
              "absolute inset-y-0 left-0",
              noData >= 1 ? "rounded-inline" : "rounded-l-inline",
            )}
            style={{
              ...NO_DATA_BAND,
              width: noData >= 1 ? "100%" : `calc(${noData * 100}% + 8px)`,
            }}
          />
          {noData < 1 ? (
            <i
              aria-hidden
              className={RUN_AFTER_GAP}
              style={{ left: `${noData * 100}%` }}
            />
          ) : null}
        </>
      ) : null}

      {marks.map((m) => (
        <i
          key={m.key}
          aria-hidden
          className={cn(
            m.tone === "bad"
              ? LANE.MARK_BAD
              : m.tone === "warn"
                ? LANE.MARK_WARN
                : LANE.MARK_PLAN,
            m.live && blink && "animate-pulse",
          )}
          style={{ left: `${m.left}%`, width: `${m.width}%` }}
        />
      ))}

      {tip ? (
        <Tooltip open>
          <TooltipTrigger asChild>
            {line ?? <i aria-hidden className={LANE.CURSOR} />}
          </TooltipTrigger>
          <TooltipContent
            variant="info"
            side="top"
            sideOffset={12}
            className="min-w-44"
          >
            {tip}
          </TooltipContent>
        </Tooltip>
      ) : (
        line
      )}
    </div>
  );
}

export interface StabilityCardProps {
  incidents: SystemIncident[];
  range: HistoryRange;
  /** Window start, epoch seconds (the oldest bucket's start). */
  startSec: number;
  /** Window end, epoch seconds (the collector's now). */
  nowSec: number;
  /** When collection began; null on a fresh install with nothing stored. */
  since: number | null;
}

export function StabilityCard({
  incidents,
  range,
  startSec,
  nowSec,
  since,
}: StabilityCardProps) {
  const { t, i18n } = useTranslation("history");
  const locale = i18n.language;
  const reduced = useMotionReduced();
  const cursor = useHistoryCursor();
  const lanesRef = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<Hover | null>(null);

  const span = nowSec - startSec;

  const { reboots, modems, heats } = React.useMemo(
    () => ({
      reboots: incidents.filter((i) => i.kind === "reboot"),
      modems: incidents.filter((i) => i.kind === "modem"),
      heats: incidents.filter((i) => i.kind === "heat"),
    }),
    [incidents],
  );

  const noData =
    since === null
      ? 1
      : since > startSec
        ? fraction(since, startSec, nowSec)
        : 0;

  const cuts = React.useMemo<Placed[]>(
    () =>
      reboots.map((r) => ({
        key: `c-${r.start}-${r.end ?? "n"}`,
        ...spanPercent(r.start, r.end, startSec, nowSec),
      })),
    [reboots, startSec, nowSec],
  );

  const deviceMarks = React.useMemo<Mark[]>(
    () =>
      reboots.map((r) => ({
        key: `d-${r.start}`,
        tone: r.kind === "reboot" && r.cause === "unexpected" ? "bad" : "plan",
        live: false,
        ...spanPercent(r.start, r.end, startSec, nowSec),
      })),
    [reboots, startSec, nowSec],
  );
  const modemMarks = React.useMemo<Mark[]>(
    () =>
      modems.map((m) => ({
        key: `m-${m.start}`,
        tone: "bad",
        live: m.end === null,
        ...spanPercent(m.start, m.end, startSec, nowSec),
      })),
    [modems, startSec, nowSec],
  );
  const heatMarks = React.useMemo<Mark[]>(
    () =>
      heats.map((h) => ({
        key: `h-${h.start}`,
        tone: "warn",
        live: h.end === null,
        ...spanPercent(h.start, h.end, startSec, nowSec),
      })),
    [heats, startSec, nowSec],
  );

  const ticks = React.useMemo(
    () => axisTicks(range, startSec, nowSec, locale),
    [range, startSec, nowSec, locale],
  );

  // --- Cursor ------------------------------------------------------------------
  const cursorPct =
    cursor.t !== null && cursor.t >= startSec && cursor.t <= nowSec
      ? fraction(cursor.t, startSec, nowSec) * 100
      : null;

  const onPointer = (id: LaneId, e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || span <= 0) return;
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const at = startSec + f * span;
    setHover({ id, t: at, tolSec: (TIP_TOLERANCE_PX / rect.width) * span });
    cursor.set(at, "strip", id);
  };

  const onLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    // A finger lifting is not leaving: the reading stays until the next tap.
    if (e.pointerType === "touch") return;
    setHover(null);
    cursor.set(null);
  };

  const hoverId = hover?.id ?? null;
  React.useEffect(() => {
    if (hoverId === null) return;
    const dismiss = (e: PointerEvent) => {
      if (lanesRef.current?.contains(e.target as Node)) return;
      setHover(null);
      cursor.set(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
    // `cursor.set` changes identity with every cursor move; only its latest
    // value is needed when a dismissal fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverId]);

  const tipFor = (id: LaneId): React.ReactNode | null => {
    if (!hover || hover.id !== id) return null;
    const near = nearIncidents(incidents, hover.t, hover.tolSec, nowSec);
    const beforeData = since === null || hover.t < since;
    return (
      <>
        <p className="mb-1.5 font-semibold tabular-nums">
          {formatWhen(hover.t, nowSec, t, locale)}
        </p>
        <ul className="flex flex-col gap-0.5">
          {beforeData ? (
            <TipRow tone="nodata" label={t("system.charts.tip.no_data")} />
          ) : near.length > 0 ? (
            <IncidentRows incidents={near} />
          ) : (
            <TipRow tone="ok" label={t("system.charts.tip.running")} />
          )}
        </ul>
      </>
    );
  };

  // --- Counts ------------------------------------------------------------------
  const modemNow = modems.some((m) => m.end === null);
  const heatNow = heats.some((h) => h.end === null);

  const count = (n: number, key: string, none: string) => ({
    node:
      n > 0
        ? withSlot(t(key, { n: SLOT }), <b className={LANE.COUNT_VALUE}>{n}</b>)
        : t(none),
    plain: n > 0 ? t(key, { n }) : t(none),
  });
  const deviceCount = count(
    reboots.length,
    "system.stability.counts.rebooted",
    "system.stability.counts.no_reboots",
  );
  const modemCount = modemNow
    ? {
        plain: t("system.stability.counts.restarting_now"),
        node: (
          <b className="font-semibold text-destructive-on-surface">
            {t("system.stability.counts.restarting_now")}
          </b>
        ),
      }
    : count(
        modems.length,
        "system.stability.counts.restarted",
        "system.stability.counts.no_restarts",
      );
  const heatCount = heatNow
    ? {
        plain: t("system.stability.counts.throttling_now"),
        node: (
          <b className="font-semibold text-warning-on-surface">
            {t("system.stability.counts.throttling_now")}
          </b>
        ),
      }
    : count(
        heats.length,
        "system.stability.counts.throttled",
        "system.stability.counts.never_throttled",
      );

  // --- Legend ------------------------------------------------------------------
  const legend: { key: keyof typeof LEGEND_DOTS; label: string }[] = [
    { key: "ok", label: t("system.stability.legend.running") },
  ];
  if (
    modems.length > 0 ||
    reboots.some((r) => r.kind === "reboot" && r.cause === "unexpected")
  ) {
    legend.push({ key: "bad", label: t("system.stability.legend.crash") });
  }
  if (reboots.some((r) => r.kind === "reboot" && r.cause !== "unexpected")) {
    legend.push({ key: "plan", label: t("system.stability.legend.planned") });
  }
  if (heats.length > 0)
    legend.push({ key: "warn", label: t("system.stability.legend.throttled") });
  if (noData > 0)
    legend.push({ key: "nodata", label: t("system.stability.legend.no_data") });

  const lanes: {
    id: LaneId;
    name: string;
    count: { node: React.ReactNode; plain: string };
    marks: Mark[];
  }[] = [
    {
      id: "device",
      name: t("system.stability.lanes.device"),
      count: deviceCount,
      marks: deviceMarks,
    },
    {
      id: "modem",
      name: t("system.stability.lanes.modem"),
      count: modemCount,
      marks: modemMarks,
    },
    {
      id: "heat",
      name: t("system.stability.lanes.heat"),
      count: heatCount,
      marks: heatMarks,
    },
  ];

  return (
    <Card className={HISTORY_CARD} aria-label={t("system.stability.title")}>
      <CardHeader className={CARD_HEADER}>
        <CardTitle as="h2" className={CARD_TITLE}>
          {t("system.stability.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("system.stability.description")}
        </CardDescription>
        <CardAction className={HEADER_ACTIONS}>
          <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-on-surface-variant">
            {legend.map((l) => (
              <li
                key={l.key}
                className="flex items-center gap-1.5 whitespace-nowrap"
              >
                <span
                  aria-hidden
                  className={cn(LEGEND_DOT, LEGEND_DOTS[l.key])}
                />
                {l.label}
              </li>
            ))}
          </ul>
        </CardAction>
      </CardHeader>

      <div
        ref={lanesRef}
        role="group"
        aria-label={t("system.stability.aria")}
        className={LANE.GRID}
      >
        {lanes.map((l) => (
          <React.Fragment key={l.id}>
            <span className={LANE.NAME}>{l.name}</span>
            <LaneTrack
              id={l.id}
              ariaLabel={`${l.name}: ${l.count.plain}`}
              noData={noData}
              cuts={cuts}
              marks={l.marks}
              blink={!reduced}
              cursorPct={cursorPct}
              tip={tipFor(l.id)}
              onPointer={onPointer}
              onLeave={onLeave}
            />
            <span className={LANE.COUNT}>{l.count.node}</span>
          </React.Fragment>
        ))}

        <span />
        <div className={LANE.AXIS} aria-hidden>
          <span className="absolute top-0 left-0">
            {t(`shared.range_ago.${range}`)}
          </span>
          {ticks
            .filter((k) => k.position >= LANE_TICK_MIN)
            .map((k) => (
              <span
                key={k.t}
                className={cn(
                  "absolute top-0 -translate-x-1/2 whitespace-nowrap",
                  k.position < LANE_TICK_WIDE_ONLY && "@max-xl/card:hidden",
                )}
                style={{ left: `${k.position * 100}%` }}
              >
                {k.label}
              </span>
            ))}
          <span className="absolute top-0 right-0">{t("shared.now")}</span>
        </div>
        <span className="@max-xl/card:hidden" />
      </div>
    </Card>
  );
}

/** Loaded geometry, drawn quiet: title block, legend slot, three lanes, axis row. */
export function StabilityCardSkeleton() {
  return (
    <Card className={HISTORY_CARD} aria-hidden>
      <CardHeader className={cn(CARD_HEADER, HEADER_SHAPE.GAP)}>
        <Skeleton className="h-5 w-24 rounded-inline" />
        <Skeleton className="h-5 w-72 max-w-full rounded-inline" />
        <CardAction className={HEADER_ACTIONS}>
          <Skeleton className="h-4 w-44 rounded-inline" />
        </CardAction>
      </CardHeader>
      <div className={LANE.GRID}>
        {Array.from({ length: 3 }, (_, i) => (
          <React.Fragment key={i}>
            <Skeleton className="h-4 w-12 rounded-inline" />
            <Skeleton className={cn(LANE.TRACK_H, "rounded-inline")} />
            <Skeleton className="h-4 w-24 justify-self-end rounded-inline @max-xl/card:hidden" />
          </React.Fragment>
        ))}
        <span />
        <div className="h-[18px]" />
        <span className="@max-xl/card:hidden" />
      </div>
    </Card>
  );
}
