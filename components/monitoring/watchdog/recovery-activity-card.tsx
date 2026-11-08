"use client";

import * as React from "react";
import Link from "next/link";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  ChevronRightIcon,
  InboxIcon,
  RefreshCcwIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { UseRecentActivitiesReturn } from "@/hooks/use-recent-activities";
import { FRESH_WINDOW_SEC } from "@/lib/event-presentation";
import { rowCascadeDelay, transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { buildActivityRows, type ActivityRow } from "./activity-model";
import { useClock } from "./use-clock";
import { useFormatters, useTimeAgo } from "./derive";
import {
  ABSOLUTE_INK,
  ACTIVITY_TONE,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  CONDITION_TONE,
  DAY,
  LOG,
  LOG_LINK,
  LOG_STACK,
  PILL_GLYPH,
  ROW,
  SKELETON,
  type ConditionTone,
} from "./shapes";

const DAY_MS = 86_400_000;

const NO_REBOOTS: readonly number[] = [];

/** 80ms per row, capped by `rowCascadeDelay` so a long feed cannot choreograph. */
const rowItem: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...transitionStandard, delay: rowCascadeDelay(index) },
  }),
};

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface RowView {
  row: ActivityRow;
  fresh: boolean;
  timeAgo: string;
  clockTime: string;
}

interface DayGroup {
  key: string;
  label: string;
  rows: RowView[];
}

/**
 * Recovery activity: one row per thing the watchdog did, each with its own tone
 * and glyph, read from the event's code. The newest few; "All events" links to
 * the full log.
 */
export function RecoveryActivityCard({
  activities,
  recentReboots = NO_REBOOTS,
}: {
  activities: UseRecentActivitiesReturn;
  /** Epoch seconds of the watchdog's own restarts, newest first. */
  recentReboots?: readonly number[];
}) {
  const { t, i18n } = useTranslation("monitoring");
  const fmt = useFormatters();
  const { events, isLoading, error, refresh } = activities;
  const { epochMs } = useClock();
  const timeAgo = useTimeAgo();

  const groups = React.useMemo<DayGroup[]>(() => {
    const nowSec = Math.floor(epochMs / 1000);
    const dayLabel = (ms: number): string => {
      if (dayKey(ms) === dayKey(epochMs)) return t("watchdog.activity.day.today");
      if (dayKey(ms) === dayKey(epochMs - DAY_MS)) return t("watchdog.activity.day.yesterday");
      // The app's locale, not the browser's: the two disagree by design here.
      return new Date(ms).toLocaleDateString(i18n.language, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    };

    const out: DayGroup[] = [];
    for (const row of buildActivityRows(events, recentReboots, fmt.t)) {
      const ms = row.timestamp * 1000;
      const view: RowView = {
        row,
        fresh: nowSec - row.timestamp < FRESH_WINDOW_SEC,
        timeAgo: timeAgo(row.timestamp),
        clockTime: new Date(ms).toLocaleTimeString(i18n.language, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      const key = dayKey(ms);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(view);
      else out.push({ key, label: dayLabel(ms), rows: [view] });
    }
    return out;
  }, [events, recentReboots, epochMs, t, fmt.t, i18n.language, timeAgo]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  // One counter across every day block: assuming three rows per group ran the
  // cascade backwards the moment a day held more than three.
  const order = React.useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const g of groups) for (const r of g.rows) map.set(r.row.key, i++);
    return map;
  }, [groups]);
  const unreadable = !isLoading && error !== null && total === 0;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t("watchdog.activity.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("watchdog.activity.description")}
        </CardDescription>
        <CardAction>
          <Button asChild variant="ghost" className={LOG_LINK}>
            <Link href="/monitoring/events">
              {t("watchdog.activity.allEvents")}
              <ChevronRightIcon className={PILL_GLYPH} aria-hidden />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col")}>
        {isLoading ? (
          <div className={LOG_STACK} aria-hidden>
            <div className={LOG}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className={SKELETON.ROW} />
              ))}
            </div>
          </div>
        ) : unreadable ? (
          <ActivityCondition
            tone="destructive"
            glyph={WifiOffIcon}
            title={t("watchdog.activity.error.title")}
            description={error ?? ""}
            actionLabel={t("watchdog.activity.error.retry")}
            onAction={() => void refresh()}
          />
        ) : total === 0 ? (
          <ActivityCondition
            tone="muted"
            glyph={InboxIcon}
            title={t("watchdog.activity.empty.title")}
            description={t("watchdog.activity.empty.description")}
          />
        ) : (
          <div className={LOG_STACK}>
            {groups.map((group) => (
              <div key={group.key} className={LOG}>
                <div className={DAY.ROOT}>
                  <span className={DAY.LABEL}>{group.label}</span>
                  <span aria-hidden className={DAY.RULE} />
                </div>
                {group.rows.map((view) => (
                  <motion.div
                    key={view.row.key}
                    custom={order.get(view.row.key) ?? 0}
                    variants={rowItem}
                    initial="hidden"
                    animate="visible"
                  >
                    <ActivityLine view={view} />
                  </motion.div>
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityLine({ view }: { view: RowView }) {
  const { t } = useTranslation("monitoring");
  const { row, fresh } = view;
  const tone = ACTIVITY_TONE[row.tone];
  const Glyph = row.glyph;
  // A recent row wears the tonal container for its first hour; after that the
  // disc alone keeps the colour, so the list settles as it ages.
  const tonal = fresh && row.tone !== "muted";

  return (
    <div
      className={cn(
        ROW.ROOT,
        ROW.TRANSITION,
        tonal && tone.fill,
      )}
    >
      <span aria-hidden className={cn(ROW.DISC, ROW.TRANSITION, tone.disc)}>
        <Glyph className={ROW.GLYPH} />
      </span>

      <div className={ROW.BODY}>
        <span className="sr-only">{t(`watchdog.activity.sr.${row.tone}`)}</span>
        <span
          className={cn(ROW.MESSAGE, !tonal && "text-on-surface")}
          title={row.title}
        >
          {row.title}
        </span>
        <div className={ROW.META}>
          <span
            className={cn(ROW.DETAIL, tonal ? "opacity-80" : ABSOLUTE_INK)}
            title={row.detail ?? undefined}
          >
            {row.detail ?? row.category}
          </span>
        </div>
      </div>

      <div className={ROW.WHEN}>
        <span className={cn(ROW.RELATIVE, !tonal && "text-on-surface")}>
          {view.timeAgo}
        </span>
        <span className={cn(ROW.ABSOLUTE, tonal ? "opacity-80" : ABSOLUTE_INK)}>
          {view.clockTime}
        </span>
      </div>
    </div>
  );
}

/** The condition IS the state, so it replaces the list rather than emptying it. */
function ActivityCondition({
  tone,
  glyph: Glyph,
  title,
  description,
  actionLabel,
  onAction,
}: {
  tone: ConditionTone;
  glyph: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const skin = CONDITION_TONE[tone];
  return (
    <div role="status" className={cn(CONDITION.ROOT, skin.ROOT)}>
      <span aria-hidden className={cn(CONDITION.DISC, skin.DISC)}>
        <Glyph className={CONDITION.GLYPH} />
      </span>
      <p className={CONDITION.TITLE}>{title}</p>
      <p className={CONDITION.DESC}>{description}</p>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onAction}
          className={cn(CONDITION.ACTION, skin.ACTION)}
        >
          <RefreshCcwIcon className={PILL_GLYPH} />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
