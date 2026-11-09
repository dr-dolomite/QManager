"use client";

import { useTranslation } from "react-i18next";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MetricBar } from "@/components/ui/metric-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { StorageArea, SystemHistory } from "@/types/system-history";

import { storageReadings, type StorageReading } from "./derive";
import { CardHeaderSkeleton, Notice } from "./parts";
import { HISTORY_CARD, STORAGE } from "./shapes";

// =============================================================================
// Storage card: how full each storage area is now
// =============================================================================
// Three areas (System, App data, Temporary files), each a name and percent over
// an 8 px meter and a caption. A thin tick marks where the area stood at the
// start of the range, so a slow leak shows as a gap between the fill and the
// tick. The fill is primary until 80 %, warning from 80 %, destructive from
// 90 % (the shared MetricBar thresholds). Hovering or focusing a meter lists
// now, the start of the range and what is free.
// =============================================================================

const WARN_AT = 80;
const DANGER_AT = 90;
/** A change smaller than this (MiB) reads as "no change". */
const FLAT_MIB = 0.05;
const KIB_PER_MIB = 1024;

const PCT_INK = {
  primary: "text-on-surface",
  warning: "text-warning-on-surface",
  destructive: "text-destructive-on-surface",
} as const;

function toneOf(pct: number): keyof typeof PCT_INK {
  return pct >= DANGER_AT ? "destructive" : pct >= WARN_AT ? "warning" : "primary";
}

function AreaRow({
  reading,
  index,
  range,
}: {
  reading: StorageReading;
  index: number;
  range: SystemHistory["range"];
}) {
  const { t, i18n } = useTranslation("history");
  const mib = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const fmt = (kib: number) => mib.format(kib / KIB_PER_MIB);

  const pct = (reading.usedKiB / reading.sizeKiB) * 100;
  const tone = toneOf(pct);
  const name = t(`system.storage.areas.${reading.area satisfies StorageArea}`);
  const rangeName = t(`system.range.${range}`);

  const deltaMib =
    reading.startKiB === null ? 0 : (reading.usedKiB - reading.startKiB) / KIB_PER_MIB;
  const flat = Math.abs(deltaMib) < FLAT_MIB;
  const showTick = reading.startKiB !== null && !flat;
  const startAgo = t(`shared.range_ago.${range}`);
  const free = fmt(Math.max(0, reading.sizeKiB - reading.usedKiB));

  const ofText = t("system.storage.of", {
    used: fmt(reading.usedKiB),
    total: fmt(reading.sizeKiB),
  });

  return (
    <div>
      <div className={STORAGE.TOP}>
        <span className="text-on-surface text-sm font-medium">{name}</span>
        <span className={cn("text-[0.9375rem] font-semibold tabular-nums", PCT_INK[tone])}>
          {Math.round(pct)}%
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={STORAGE.METER}
            tabIndex={0}
            role="img"
            aria-label={`${name}: ${ofText}, ${Math.round(pct)}%`}
          >
            <MetricBar value={pct} warnAt={WARN_AT} dangerAt={DANGER_AT} index={index} />
            {showTick && reading.startKiB !== null ? (
              <span
                className={STORAGE.TICK}
                style={{ left: `${(reading.startKiB / reading.sizeKiB) * 100}%` }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent variant="info" side="top" className="min-w-44">
          <div className="text-on-surface mb-1 text-xs font-semibold">{name}</div>
          <dl className="text-on-surface-variant grid gap-0.5 text-xs tabular-nums">
            <TipRow label={t("system.storage.now")} value={`${fmt(reading.usedKiB)} MB`} />
            {reading.startKiB !== null ? (
              <TipRow label={startAgo} value={`${fmt(reading.startKiB)} MB`} />
            ) : null}
            <TipRow label={t("system.storage.free")} value={`${free} MB`} />
          </dl>
        </TooltipContent>
      </Tooltip>
      <div className={STORAGE.BOTTOM}>
        <span>{ofText}</span>
        <span>
          {reading.startKiB === null || flat ? (
            t("system.storage.unchanged", { range: rangeName })
          ) : (
            <>
              <span className="text-on-surface font-medium">
                {t(deltaMib > 0 ? "system.storage.grew" : "system.storage.shrank", {
                  amount: mib.format(Math.abs(deltaMib)),
                })}
              </span>{" "}
              {t("system.storage.in_range", { range: rangeName })}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function TipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt>{label}</dt>
      <dd className="text-on-surface font-semibold">{value}</dd>
    </div>
  );
}

export function StorageCard({ history }: { history: SystemHistory }) {
  const { t } = useTranslation("history");
  const readings = storageReadings(history.buckets);
  const anyTick = readings.some(
    (r) => r.startKiB !== null && Math.abs(r.usedKiB - r.startKiB) / KIB_PER_MIB >= FLAT_MIB,
  );

  return (
    <Card className={HISTORY_CARD} aria-label={t("system.storage.title")}>
      <CardHeader className="gap-1 px-0">
        <CardTitle as="h2" className="min-w-0 text-lg leading-tight">
          {t("system.storage.title")}
        </CardTitle>
        <CardDescription className="text-on-surface-variant text-sm">
          {t("system.storage.description")}
        </CardDescription>
        {anyTick ? (
          <CardAction className="text-on-surface-variant flex items-center gap-1.5 text-xs">
            <span className="bg-on-surface-variant h-3 w-0.5 rounded-inline" aria-hidden="true" />
            {t(`shared.range_ago.${history.range}`)}
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="px-0">
        {readings.length === 0 ? (
          <Notice
            glyph="storage"
            title={t("system.storage.empty.title")}
            description={t("system.storage.empty.description")}
          />
        ) : (
          <div className={STORAGE.LIST}>
            {readings.map((r, i) => (
              <AreaRow key={r.area} reading={r} index={i} range={history.range} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function StorageCardSkeleton() {
  return (
    <Card className={HISTORY_CARD} aria-hidden="true">
      <CardHeaderSkeleton />
      <CardContent className="px-0">
        <div className={STORAGE.LIST}>
          {Array.from({ length: STORAGE.AREAS }, (_, i) => (
            <div key={i}>
              <div className={STORAGE.TOP}>
                <Skeleton className={cn(STORAGE.NAME_SK, "rounded-inline")} />
                <Skeleton className={cn(STORAGE.PCT_SK, "rounded-inline")} />
              </div>
              <div className="my-2">
                <Skeleton className={cn(STORAGE.METER_SK, "rounded-pill")} />
              </div>
              <div className={STORAGE.BOTTOM}>
                <Skeleton className={cn(STORAGE.CAPTION_SK, "rounded-inline")} />
                <Skeleton className={cn(STORAGE.DELTA_SK, "rounded-inline")} />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
