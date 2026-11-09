"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { filterByLevel } from "@/components/system-settings/logs/derive";
import { useDeviceSyslog } from "@/hooks/use-device-syslog";
import { useSystemLogs } from "@/hooks/use-system-logs";
import { cn } from "@/lib/utils";
import {
  DEVICE_LOG_LINES,
  type DeviceLogLines,
  type DeviceLogSource,
} from "@/types/device-syslog";
import type { LevelFilter } from "@/types/system-logs";

import {
  groupByDay,
  kernelWallSec,
  qmanagerLines,
  toneOfSyslog,
  type LogLineView,
} from "./logs-derive";
import { LogList, LogRowsSkeleton } from "./logs-list";
import { CardHeaderSkeleton, Notice } from "./parts";
import { HISTORY_CARD, LOGS } from "./shapes";

// =============================================================================
// Logs card: what QManager and the modem wrote to their logs, newest first
// =============================================================================
// Two tabs. QManager shows the app's own transcript (the same feed as System
// settings > Logs, level-filtered here); System shows the modem's system log or
// its kernel ring. Only the tab in view polls: the other hook is paused, so the
// hidden feed costs the modem nothing. Read-only, so no toast and no Apply.
// =============================================================================

type LogsTab = "qmanager" | "system";

const LEVEL_OPTIONS: readonly LevelFilter[] = ["all", "ERROR", "WARN", "INFO", "DEBUG"];
const LEVEL_KEY: Record<LevelFilter, string> = {
  all: "all",
  ERROR: "error",
  WARN: "warn",
  INFO: "info",
  DEBUG: "debug",
};

const TAB_TRIGGER =
  "h-8 flex-none rounded-pill border-transparent px-3.5 text-[0.84375rem] text-on-surface-variant data-[state=active]:bg-surface-container-high data-[state=active]:text-on-surface data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-surface-container-high dark:data-[state=active]:text-on-surface";

const renderCheckGlyph = (className: string) => (
  <MaterialSymbol name="check" filled size={SEGMENTED.GLYPH} aria-hidden="true" className={className} />
);

export function LogsCardSkeleton() {
  return (
    <Card className={HISTORY_CARD}>
      <CardHeaderSkeleton />
      <div className={LOGS.TOOLBAR}>
        <Skeleton className="h-9 w-48 rounded-pill" />
        <Skeleton className="h-[2.625rem] w-72 max-w-full rounded-pill" />
      </div>
      <LogRowsSkeleton />
    </Card>
  );
}

export function LogsCard() {
  const { t } = useTranslation("history");
  const [tab, setTab] = React.useState<LogsTab>("qmanager");
  const [source, setSource] = React.useState<DeviceLogSource>("system");
  const [lines, setLines] = React.useState<DeviceLogLines>(DEVICE_LOG_LINES[0]);

  // Only the tab in view polls.
  const qm = useSystemLogs({ paused: tab !== "qmanager" });
  const sys = useDeviceSyslog(source, lines, { paused: tab !== "system" });

  // ── QManager ────────────────────────────────────────────────────────────
  const qmRows = React.useMemo(
    () => qmanagerLines(filterByLevel(qm.entries, qm.level), LOGS.MAX_ROWS),
    [qm.entries, qm.level],
  );
  const qmGroups = React.useMemo(() => groupByDay(qmRows), [qmRows]);

  // ── System / kernel ─────────────────────────────────────────────────────
  // A source switch keeps the previous response until the next lands; only a
  // response that matches the chosen source is drawn.
  const device = sys.data && sys.data.source === source ? sys.data : null;
  const sysRows = React.useMemo<LogLineView[]>(() => {
    if (!device) return [];
    const seen = new Map<string, number>();
    const unique = (base: string) => {
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return n === 0 ? base : `${base}#${n}`;
    };
    if (device.source === "kernel") {
      return device.entries.map((e) => {
        const sec = kernelWallSec(e, device.now, device.uptime);
        return {
          key: unique(`${e.up}|${e.msg}`),
          sec,
          rawTime: "",
          tone: null,
          tag: null,
          message: e.msg,
        };
      });
    }
    return device.entries.map((e) => ({
      key: unique(`${e.t ?? e.ts}|${e.proc}|${e.pid}|${e.msg}`),
      sec: e.t,
      rawTime: e.ts,
      tone: toneOfSyslog(e.level),
      tag: e.proc,
      message: e.msg,
    }));
  }, [device]);
  const sysGroups = React.useMemo(() => groupByDay(sysRows), [sysRows]);

  // ── Controls ────────────────────────────────────────────────────────────
  const levelOptions = LEVEL_OPTIONS.map((value) => ({
    value,
    label: t(`system.logs.level.${LEVEL_KEY[value]}`),
  }));
  const sourceOptions = (["system", "kernel"] as const).map((value) => ({
    value,
    label: t(`system.logs.source.${value}`),
  }));

  const qmLoading = qm.isLoading;
  const qmFailed = qm.error !== null && qm.entries.length === 0;
  const sysLoading = !device && sys.error === null;
  const sysFailed = !device && sys.error !== null;

  return (
    <Card className={HISTORY_CARD} aria-label={t("system.logs.title")}>
      <CardHeader className="gap-1 px-0">
        <CardTitle as="h2" className="min-w-0 text-lg leading-tight">
          {t("system.logs.title")}
        </CardTitle>
        <CardDescription className="text-on-surface-variant text-sm">
          {t("system.logs.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0">
        <Tabs value={tab} onValueChange={(v) => setTab(v as LogsTab)} className="gap-4">
          <div className={LOGS.TOOLBAR}>
            <TabsList className="h-auto gap-1 bg-transparent p-0">
              <TabsTrigger value="qmanager" className={TAB_TRIGGER}>
                {t("system.logs.tabs.qmanager")}
              </TabsTrigger>
              <TabsTrigger value="system" className={TAB_TRIGGER}>
                {t("system.logs.tabs.system")}
              </TabsTrigger>
            </TabsList>

            {tab === "qmanager" ? (
              <>
                <SegmentedField
                  value={qm.level}
                  onValueChange={qm.setLevel}
                  options={levelOptions}
                  ariaLabel={t("system.logs.level_label")}
                  glyph={renderCheckGlyph}
                  className="@2xl/card:ml-1"
                />
                <Button variant="tonal-neutral" size="sm" asChild className="@2xl/card:ml-auto">
                  <Link href="/monitoring/history/logs">
                    {t("system.logs.open_full")}
                    <MaterialSymbol name="open_in_new" size={18} aria-hidden="true" />
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <SegmentedField
                  value={source}
                  onValueChange={setSource}
                  options={sourceOptions}
                  ariaLabel={t("system.logs.source_label")}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                  className="@2xl/card:ml-1"
                />
                <Select
                  value={String(lines)}
                  onValueChange={(v) => setLines(Number(v) as DeviceLogLines)}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={t("system.logs.lines_label")}
                    className="ml-auto tabular-nums"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-tile">
                    {DEVICE_LOG_LINES.map((n) => (
                      <SelectItem key={n} value={String(n)} className="tabular-nums">
                        {t("system.logs.lines_option", { value: n })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          <TabsContent value="qmanager" className="flex flex-col gap-4">
            {qmLoading ? (
              <>
                <span className="sr-only" role="status">
                  {t("system.logs.loading_sr")}
                </span>
                <LogRowsSkeleton />
              </>
            ) : qmFailed ? (
              <Notice
                glyph="cloud_off"
                tone="destructive"
                className={LOGS.STATE_H}
                title={t("system.logs.error.title")}
                description={t("system.logs.error.description")}
                action={
                  <Button variant="tonal-neutral" size="sm" onClick={() => void qm.refresh()}>
                    {t("system.states.retry")}
                  </Button>
                }
              />
            ) : qmRows.length === 0 ? (
              <Notice
                glyph="event_note"
                className={LOGS.STATE_H}
                title={t(
                  qm.level === "all" ? "system.logs.empty.title" : "system.logs.empty_level.title",
                )}
                description={t(
                  qm.level === "all"
                    ? "system.logs.empty.description"
                    : "system.logs.empty_level.description",
                )}
                action={
                  qm.level === "all" ? undefined : (
                    <Button variant="tonal-neutral" size="sm" onClick={() => qm.setLevel("all")}>
                      {t("system.logs.show_all")}
                    </Button>
                  )
                }
              />
            ) : (
              <>
                <LogList
                  groups={qmGroups}
                  plain={false}
                  nowSec={qm.lastReadAtSec ?? qmRows[0].sec ?? 0}
                  label={t("system.logs.tabs.qmanager")}
                />
                <LogsFoot shown={qmRows.length} total={qm.entries.length} stale={qm.error !== null} />
              </>
            )}
          </TabsContent>

          <TabsContent value="system" className="flex flex-col gap-4">
            {sysLoading ? (
              <>
                <span className="sr-only" role="status">
                  {t("system.logs.loading_sr")}
                </span>
                <LogRowsSkeleton plain={source === "kernel"} />
              </>
            ) : sysFailed ? (
              <Notice
                glyph="cloud_off"
                tone="destructive"
                className={LOGS.STATE_H}
                title={t("system.logs.error.title")}
                description={t("system.logs.error.description")}
                action={
                  <Button variant="tonal-neutral" size="sm" onClick={() => sys.refresh()}>
                    {t("system.states.retry")}
                  </Button>
                }
              />
            ) : !device || sysRows.length === 0 ? (
              <Notice
                glyph="event_note"
                className={LOGS.STATE_H}
                title={t("system.logs.empty.title")}
                description={t("system.logs.empty.description")}
              />
            ) : (
              <>
                <LogList
                  groups={sysGroups}
                  plain={source === "kernel"}
                  nowSec={device.now}
                  label={t(`system.logs.source.${source}`)}
                />
                <LogsFoot
                  shown={sysRows.length}
                  total={Math.max(device.total, sysRows.length)}
                  stale={sys.error !== null}
                />
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function LogsFoot({ shown, total, stale }: { shown: number; total: number; stale: boolean }) {
  const { t } = useTranslation("history");
  return (
    <div className={cn(LOGS.FOOT)}>
      <span className="tabular-nums">{t("system.logs.showing", { shown, total })}</span>
      {stale ? (
        <Badge variant="warning">
          <MaterialSymbol name="sync_problem" size={12} filled aria-hidden="true" />
          {t("system.logs.stale")}
        </Badge>
      ) : null}
    </div>
  );
}
