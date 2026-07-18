"use client";

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  RefreshCcwIcon,
  Clock,
  BellIcon,
  AlertCircle,
  CheckCircle2Icon,
  XCircleIcon,
  RotateCcwIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlertsLog } from "@/hooks/use-alerts-log";
import type { AlertLogEntry, RebootHistoryEntry } from "@/types/alerts";
import { CHANNEL_META, REBOOT_CAUSE_META, REBOOT_TONE_BADGE } from "./constants";

const MotionTableRow = motion.create(TableRow);

// -----------------------------------------------------------------------------
// Activity — one time-ordered feed of alert deliveries + recorded reboots.
// -----------------------------------------------------------------------------
// Deliveries (sent/failed SMS+email) come from the pollable `useAlertsLog`
// hook; reboots are read-only telemetry passed down from the page's single
// `useAlerts` GET. The two shapes are interleaved by time: a delivery row keeps
// the full channel/status/recipient columns, while a reboot row is an *event*
// row — it fills the columns it owns (timestamp, label, cause) and leaves the
// delivery-only columns as muted em-dashes, so a reader can tell at a glance
// that it is something that happened, not something that was sent.
// -----------------------------------------------------------------------------

type FeedRow =
  | { kind: "delivery"; key: string; time: number; entry: AlertLogEntry }
  | { kind: "reboot"; key: string; time: number; reboot: RebootHistoryEntry };

/** Delivery timestamps are device-local "YYYY-MM-DD HH:MM:SS"; reboots are
 *  epoch seconds. Normalize both to a comparable ms key for one desc sort. */
function deliveryTime(ts: string): number {
  const parsed = Date.parse(ts.replace(" ", "T"));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Render an epoch as the same "YYYY-MM-DD HH:MM:SS" shape delivery rows use,
 *  so the timestamp column stays homogeneous. */
function formatEpoch(epoch: number): string {
  const d = new Date(epoch * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function AlertsLogCard({
  refreshKey,
  reboots,
}: {
  refreshKey?: number;
  reboots: RebootHistoryEntry[];
}) {
  const { t } = useTranslation("monitoring");
  const {
    entries,
    total,
    isLoading,
    isRefreshing,
    error,
    lastFetched,
    refresh,
    silentRefresh,
  } = useAlertsLog();

  useEffect(() => {
    if (refreshKey) silentRefresh();
  }, [refreshKey, silentRefresh]);

  const feed = useMemo<FeedRow[]>(() => {
    const rows: FeedRow[] = [
      ...entries.map((entry, i): FeedRow => ({
        kind: "delivery",
        key: `d-${entry.timestamp}-${entry.channel}-${i}`,
        time: deliveryTime(entry.timestamp),
        entry,
      })),
      ...reboots.map((reboot, i): FeedRow => ({
        kind: "reboot",
        key: `r-${reboot.epoch}-${i}`,
        time: Number.isFinite(reboot.epoch) ? reboot.epoch * 1000 : 0,
        reboot,
      })),
    ];
    return rows.sort((a, b) => b.time - a.time);
  }, [entries, reboots]);

  const header = (
    <CardHeader>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{t("alerts.log_title")}</CardTitle>
          <CardDescription>{t("alerts.log_description")}</CardDescription>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("alerts.log_aria_refresh")}
          disabled={isRefreshing}
          onClick={refresh}
        >
          <RefreshCcwIcon className={cn("size-4", isRefreshing && "animate-spin")} />
        </Button>
      </div>
    </CardHeader>
  );

  if (isLoading) {
    return (
      <Card className="@container/card min-h-0 flex-1">
        {header}
        <CardContent className="flex min-h-0 flex-1 flex-col justify-center">
          <div className="rounded-md border">
            <div className="border-b px-4 py-3">
              <div className="flex gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-14" />
              </div>
            </div>
            <div className="divide-y">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Only hard-block on error when there is genuinely nothing to show. If reboots
  // (from the page GET) are present, the feed is still useful even if the
  // delivery-log fetch failed.
  if (error && feed.length === 0) {
    return (
      <Card className="@container/card min-h-0 flex-1">
        {header}
        <CardContent className="flex min-h-0 flex-1 flex-col justify-center">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>{t("alerts.log_error_title")}</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={refresh}
              >
                <RefreshCcwIcon className="size-3.5" />
                {t("actions.retry", { ns: "common" })}
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card min-h-0 flex-1">
      {header}
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-[12rem] flex-1 overflow-auto rounded-md border">
          <Table>
            <TableHeader className="bg-card sticky top-0 z-10">
              <TableRow>
                <TableHead scope="col" className="whitespace-nowrap">
                  {t("alerts.log_header_timestamp")}
                </TableHead>
                <TableHead scope="col">{t("alerts.log_header_trigger")}</TableHead>
                <TableHead scope="col" className="hidden @sm/card:table-cell">
                  {t("alerts.log_header_channel")}
                </TableHead>
                <TableHead scope="col" className="whitespace-nowrap">
                  {t("alerts.log_header_status")}
                </TableHead>
                <TableHead scope="col" className="hidden @md/card:table-cell">
                  {t("alerts.log_header_recipient")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody aria-live="polite" aria-relevant="additions">
              {feed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <BellIcon className="text-muted-foreground size-8" />
                      <p className="text-muted-foreground text-sm">
                        {t("alerts.log_empty_title")}
                      </p>
                      <div className="grid gap-1">
                        <p className="text-muted-foreground/70 text-xs">
                          {t("alerts.log_empty_hint_1")}
                        </p>
                        <p className="text-muted-foreground/70 text-xs">
                          {t("alerts.log_empty_hint_2")}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                feed.map((row, index) => {
                  const entrance = {
                    initial: { opacity: 0, x: -8 },
                    animate: { opacity: 1, x: 0 },
                    transition: {
                      duration: 0.2,
                      delay: Math.min(index * 0.03, 0.3),
                      ease: "easeOut" as const,
                    },
                  };

                  if (row.kind === "reboot") {
                    const meta =
                      REBOOT_CAUSE_META[row.reboot.cause] ??
                      REBOOT_CAUSE_META.unplanned;
                    const CauseIcon = meta.icon;
                    const valid =
                      Number.isFinite(row.reboot.epoch) && row.reboot.epoch > 0;
                    return (
                      <MotionTableRow
                        key={row.key}
                        className="bg-muted/25"
                        {...entrance}
                      >
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {valid
                            ? formatEpoch(row.reboot.epoch)
                            : t("alerts.log_time_unknown")}
                        </TableCell>
                        <TableCell className="min-w-0 text-sm">
                          <span className="flex items-center gap-1.5">
                            <RotateCcwIcon className="text-muted-foreground size-3.5 shrink-0" />
                            <span className="truncate">
                              {t("alerts.log_reboot_event")}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground/40 hidden @sm/card:table-cell">
                          —
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "gap-1 whitespace-nowrap",
                              REBOOT_TONE_BADGE[meta.tone],
                            )}
                          >
                            <CauseIcon className="size-3" />
                            {t(`alerts.reboot_cause_${meta.key}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground/40 hidden @md/card:table-cell">
                          —
                        </TableCell>
                      </MotionTableRow>
                    );
                  }

                  const { entry } = row;
                  const ChannelIcon =
                    CHANNEL_META[entry.channel]?.icon ?? BellIcon;
                  return (
                    <MotionTableRow key={row.key} {...entrance}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {entry.timestamp}
                      </TableCell>
                      <TableCell className="min-w-0 text-sm">
                        <span className="block truncate">{entry.trigger}</span>
                        <span className="text-muted-foreground block truncate font-mono text-xs @md/card:hidden">
                          {entry.recipient}
                        </span>
                      </TableCell>
                      <TableCell className="hidden @sm/card:table-cell">
                        <Badge
                          variant="outline"
                          className="text-muted-foreground gap-1"
                        >
                          <ChannelIcon className="size-3" />
                          {t(
                            `alerts.channel_${CHANNEL_META[entry.channel]?.labelKey ?? entry.channel}_short`,
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {entry.status === "sent" ? (
                          <Badge
                            variant="outline"
                            className="bg-success/15 text-success hover:bg-success/20 border-success/30 gap-1 whitespace-nowrap"
                          >
                            <CheckCircle2Icon className="size-3" />
                            {t("alerts.log_badge_sent")}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30 gap-1 whitespace-nowrap"
                          >
                            <XCircleIcon className="size-3" />
                            {t("alerts.log_badge_failed")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden @md/card:table-cell text-sm">
                        <span className="block truncate font-mono text-xs">
                          {entry.recipient}
                        </span>
                      </TableCell>
                    </MotionTableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      {feed.length > 0 && (
        <CardFooter className="flex flex-col gap-1 @xs/card:flex-row @xs/card:items-center @xs/card:justify-between">
          <div className="text-muted-foreground text-xs">
            {t("alerts.log_showing_count", {
              count: feed.length,
              shown: feed.length,
              total: total + reboots.length,
            })}
          </div>
          {lastFetched && (
            <div className="text-muted-foreground flex items-center gap-1 text-xs">
              <Clock className="size-3 shrink-0" />
              {t("alerts.log_last_updated", {
                time: lastFetched.toLocaleTimeString(),
              })}
            </div>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
