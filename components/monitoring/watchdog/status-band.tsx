"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  useFormatters,
  type HeroFigure,
  type HeroView,
  type StripView,
} from "./derive";
import {
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  FIGURE_TONE,
  GLYPH_SPIN,
  HERO_PAD,
  HERO_SHELL,
  SKELETON,
  STATUS,
  STRIP,
} from "./shapes";

/** A reading the device did not report. Never a zero, which is a claim. */
const ABSENT = "—";

function Figure({ figure }: { figure: HeroFigure }) {
  return (
    <div className={STATUS.FIG}>
      <span className={cn(EYEBROW, STATUS.FIG_EYEBROW)}>{figure.eyebrow}</span>
      <span className={cn(STATUS.FIG_VALUE, FIGURE_TONE[figure.tone])}>
        {figure.value === null ? (
          <>
            <span aria-hidden>{ABSENT}</span>
            <span className="sr-only">{figure.valueSr}</span>
          </>
        ) : (
          figure.value
        )}
      </span>
      <span className={STATUS.FIG_CAPTION}>{figure.caption}</span>
    </div>
  );
}

function ProbeStrip({ strip }: { strip: StripView }) {
  const { t } = useTranslation("monitoring");
  const fmt = useFormatters();
  if (strip.kind === "empty") {
    return <div className={STRIP.EMPTY}>{t("watchdog.strip.empty")}</div>;
  }
  return (
    <div className={STRIP.ROOT}>
      <div className={STRIP.HEAD}>
        <span className={STRIP.TITLE}>{t("watchdog.strip.title")}</span>
      </div>
      <div
        role="img"
        aria-label={t("watchdog.strip.aria", {
          total: strip.total,
          missed: strip.missed,
        })}
        className={STRIP.BARS}
      >
        {strip.bars.map((bar, i) => {
          const visual = (
            <span
              aria-hidden
              className={cn(
                STRIP.BAR,
                bar.kind === "ok"
                  ? STRIP.BAR_OK
                  : bar.kind === "miss"
                    ? STRIP.BAR_MISS
                    : STRIP.BAR_NONE,
              )}
              style={bar.kind === "ok" ? { height: `${bar.heightPct}%` } : undefined}
            />
          );
          // Padding slots carry no reading, so they get no tooltip.
          if (bar.kind === "none") {
            return (
              <span key={i} aria-hidden className={STRIP.CELL}>
                {visual}
              </span>
            );
          }
          // Newest bar is last; its age is one interval per slot behind it.
          const behind = strip.bars.length - 1 - i;
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <span aria-hidden className={STRIP.CELL}>
                  {visual}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className={STRIP.TIP}>
                <span className="font-semibold">
                  {bar.kind === "miss"
                    ? t("watchdog.strip.noReply")
                    : t("watchdog.strip.reply", { ms: bar.ms })}
                </span>
                <span className="opacity-70">
                  {" "}
                  {behind === 0
                    ? t("watchdog.strip.now")
                    : t("watchdog.strip.tipAgo", {
                        time: fmt.duration(behind * strip.intervalSec),
                      })}
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className={STRIP.FOOT}>
        <span>{t("watchdog.strip.ago", { minutes: strip.minutes })}</span>
        <span>{t("watchdog.strip.now")}</span>
      </div>
    </div>
  );
}

/** Phase and four figures on two edges, the probe strip under both. */
export function StatusCard({ view, strip }: { view: HeroView; strip: StripView }) {
  const { t } = useTranslation("monitoring");
  const { glyph: Glyph, disc, spin } = view.style;
  return (
    <Card className={HERO_SHELL} aria-label={t("watchdog.hero.aria")} role="region">
      <CardContent className={cn(HERO_PAD, STATUS.BODY)}>
        <div className={STATUS.HEAD}>
          <div className={STATUS.PHASE}>
            <span aria-hidden className={cn(STATUS.DISC, DISC_TRANSITION, DISC_TONE[disc])}>
              <Glyph className={cn(STATUS.GLYPH, spin && GLYPH_SPIN)} />
            </span>
            <div className={STATUS.TEXT}>
              <p className={STATUS.TITLE}>{view.title}</p>
              <p className={view.blurbNumeric ? STATUS.BLURB_NUM : STATUS.BLURB}>
                {view.blurb}
              </p>
            </div>
          </div>
          <div className={STATUS.FIGS}>
            {view.figures.map((figure) => (
              <Figure key={figure.key} figure={figure} />
            ))}
          </div>
        </div>
        <ProbeStrip strip={strip} />
      </CardContent>
    </Card>
  );
}

/** Mirrors the status card from the same constants. */
export function StatusCardSkeleton() {
  return (
    <Card className={HERO_SHELL} aria-hidden>
      <CardContent className={cn(HERO_PAD, STATUS.BODY)}>
        <div className={STATUS.HEAD}>
          <div className={STATUS.PHASE}>
            <Skeleton className={STATUS.DISC} />
            <div className={cn(STATUS.TEXT, "flex-1 gap-2")}>
              <Skeleton className={cn(SKELETON.STATUS_TITLE, "w-32")} />
              <Skeleton className={cn(SKELETON.STATUS_BLURB, "w-64 max-w-full")} />
            </div>
          </div>
          <div className={STATUS.FIGS}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cn(STATUS.FIG, "gap-y-1")}>
                <Skeleton className={cn(SKELETON.FIG_EYEBROW, STATUS.FIG_EYEBROW, "w-20")} />
                <Skeleton className={cn(SKELETON.FIG_VALUE, STATUS.FIG_VALUE, "w-12")} />
                <Skeleton className={cn(SKELETON.LINE, STATUS.FIG_CAPTION, "h-3 w-24")} />
              </div>
            ))}
          </div>
        </div>
        <div className={STRIP.ROOT}>
          <div className={STRIP.HEAD}>
            <Skeleton className={cn(SKELETON.LINE, "h-3.5 w-14")} />
          </div>
          <Skeleton className={SKELETON.STRIP} />
          <div className={STRIP.FOOT}>
            <Skeleton className={cn(SKELETON.LINE, "h-3 w-16")} />
            <Skeleton className={cn(SKELETON.LINE, "h-3 w-8")} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
