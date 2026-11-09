"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { Notice } from "@/components/history/system/parts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDeviceSyslog } from "@/hooks/use-device-syslog";
import { DEBUG_LEASE_MIN, useLogDebug } from "@/hooks/use-log-debug";
import { LINE_BUDGETS, THIS_BOOT, useSystemLogs, type BootChoice } from "@/hooks/use-system-logs";
import { copyText } from "@/lib/clipboard";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  DEVICE_LOG_LINES,
  type DeviceLogLines,
  type DeviceLogSource,
} from "@/types/device-syslog";
import type { LevelFilter } from "@/types/system-logs";

import {
  deviceLines,
  filterByLevel,
  groupByDay,
  logLinesText,
  modemNowSec,
  paginate,
  qmanagerLines,
  rowClockOffset,
  visibleLogText,
} from "./derive";
import { BootSelect } from "./boot-select";
import { DebugLeaseAction, DebugLeaseBadge, useDebugLeaseToggle } from "./debug-lease-action";
import { LogList, LogRowsSkeleton } from "./logs-list";
import { LogsPagination } from "./logs-pagination";
import { DeviceLogsSummary, LogsSummary, LogsSummarySkeleton } from "./logs-summary";
import { HISTORY_CARD, HISTORY_PAGE, LOGS, PAGE_SIZES, type PageSize } from "./shapes";

// =============================================================================
// History > Logs: what QManager and the modem wrote to their logs, newest first
// =============================================================================
// One card, two tabs. QManager is the app's own transcript (level-filtered on
// the client); System is the modem's system log or its kernel ring. Only the
// tab in view polls, so the hidden feed costs the modem nothing. Both tabs put
// three summary tiles above the card: QManager (severity, latest problem, log
// file) and System (severity, latest problem, then coverage or time since boot).
// Rows are paged (10 by default); a tab, filter or line-budget change returns to
// page 1. The header's Refresh and Copy act on the tab in view; Clear empties QManager's
// own log and is only offered on that tab, beside the 30-minute Debug logging
// action; while that lease runs, an info chip with the time left sits in the
// QManager toolbar. The page owns the lease so a tab switch keeps its state. With the journal backend, a boot selector (This / Previous boot)
// appears under the toolbar once two boots are held; a finished boot is a fixed
// record and is not polled. The kernel source reuses it when its response
// carries boots.
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

export function LogsPage() {
  const { t } = useTranslation("history");
  const { t: ts } = useTranslation("system-settings");

  const [tab, setTab] = React.useState<LogsTab>("qmanager");
  const [source, setSource] = React.useState<DeviceLogSource>("system");
  const [sysLines, setSysLines] = React.useState<DeviceLogLines>(DEVICE_LOG_LINES[0]);
  const [pageSize, setPageSize] = React.useState<PageSize>(PAGE_SIZES[0]);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [clearOpen, setClearOpen] = React.useState(false);
  const [kernelBoot, setKernelBoot] = React.useState<BootChoice>(THIS_BOOT);

  // Only the tab in view polls; the clear dialog suspends the QManager feed.
  const qm = useSystemLogs({ paused: tab !== "qmanager" || clearOpen });
  // The lease lives here, not in the action, so a tab switch keeps its state.
  const debug = useLogDebug();
  const toggleDebug = useDebugLeaseToggle(debug);
  const sys = useDeviceSyslog(source, sysLines, {
    paused: tab !== "system",
    boot: source === "kernel" ? kernelBoot : THIS_BOOT,
  });

  const qmRows = React.useMemo(
    () => qmanagerLines(filterByLevel(qm.entries, qm.level), Number.POSITIVE_INFINITY),
    [qm.entries, qm.level],
  );

  // A source switch keeps the previous response until the next lands; only a
  // response that matches the chosen source is drawn.
  const device = sys.data && sys.data.source === source ? sys.data : null;
  const sysRows = React.useMemo(() => (device ? deviceLines(device) : []), [device]);

  const rows = tab === "qmanager" ? qmRows : sysRows;
  const view = paginate(rows, pageIndex, pageSize);
  const groups = React.useMemo(() => groupByDay(view.rows), [view.rows]);

  // Every control that changes what the list holds goes back to page 1.
  const resetPage = () => setPageIndex(0);
  const changeTab = (next: string) => {
    setTab(next as LogsTab);
    resetPage();
  };
  const changeLevel = (next: LevelFilter) => {
    qm.setLevel(next);
    resetPage();
  };
  const changeSource = (next: DeviceLogSource) => {
    setSource(next);
    // A boot chosen on the kernel log means nothing on the other source.
    setKernelBoot(THIS_BOOT);
    resetPage();
  };
  const changeLines = (next: string) => {
    if (tab === "qmanager") qm.setLines(next);
    else setSysLines(Number(next) as DeviceLogLines);
    resetPage();
  };
  const changeBoot = (next: BootChoice) => {
    if (tab === "qmanager") qm.setBoot(next);
    else setKernelBoot(next);
    resetPage();
  };
  const changePageSize = (next: PageSize) => {
    setPageSize(next);
    resetPage();
  };

  // ── Header actions ──────────────────────────────────────────────────────
  const handleRefresh = async () => {
    if (tab === "system") {
      sys.refresh();
      return;
    }
    const ok = await qm.refresh();
    // The toast belongs to the user's read only; a failed background poll
    // shows the "Not refreshing" chip instead.
    if (!ok) toast.error(ts("logs.toast.refresh_failed"));
  };

  // Copies every line the tab holds under its filter, not just this page.
  const handleCopy = async () => {
    const text =
      tab === "qmanager"
        ? visibleLogText(filterByLevel(qm.entries, qm.level))
        : logLinesText(sysRows);
    if (rows.length === 0 || text === "") {
      toast.error(ts("logs.toast.copy_failed"));
      return;
    }
    const ok = await copyText(text);
    if (ok) toast.success(ts("logs.toast.copied", { count: rows.length }));
    else toast.error(ts("logs.toast.copy_failed"));
  };

  const handleClear = async () => {
    const ok = await qm.clear();
    if (ok) {
      toast.success(ts("logs.toast.cleared"));
      setClearOpen(false);
      // The cleared journal no longer holds the boot that was in view.
      qm.setBoot(THIS_BOOT);
      resetPage();
    } else {
      toast.error(ts("logs.toast.clear_failed"));
    }
  };

  // ── States ──────────────────────────────────────────────────────────────
  const loading = tab === "qmanager" ? qm.isLoading : !device && sys.error === null;
  const failed =
    tab === "qmanager" ? qm.error !== null && qm.entries.length === 0 : !device && sys.error !== null;
  const stale = tab === "qmanager" ? qm.error !== null : sys.error !== null;
  const refreshing = tab === "qmanager" ? qm.isRefreshing : sys.isLoading && device !== null;
  const plain = tab === "system" && source === "kernel";
  const levelNarrowed = tab === "qmanager" && qm.level !== "all";
  // DEBUG lines are only kept while the lease runs, so an empty DEBUG view
  // says why and offers the lease instead of a bare "nothing at this level".
  const debugUnkept = levelNarrowed && qm.level === "DEBUG" && debug.available && !debug.active;

  // The boot selector: QManager's journal, or a journal-backed kernel log.
  const bootView =
    tab === "qmanager"
      ? { boots: qm.boots, thisBoot: qm.thisBoot, value: qm.boot }
      : plain && device?.boots
        ? {
            boots: [...device.boots].sort(
              (a, b) => (b.last_seq ?? b.first_seq ?? 0) - (a.last_seq ?? a.first_seq ?? 0),
            ),
            thisBoot: device.this_boot !== undefined ? String(device.this_boot) : null,
            value: kernelBoot,
          }
        : null;
  const pastBoot = bootView !== null && bootView.value !== THIS_BOOT;

  const levelOptions = LEVEL_OPTIONS.map((value) => ({
    value,
    label: t(`logs.level.${LEVEL_KEY[value]}`),
  }));
  const sourceOptions = (["system", "kernel"] as const).map((value) => ({
    value,
    label: t(`logs.source.${value}`),
  }));
  const lineOptions: readonly string[] =
    tab === "qmanager" ? LINE_BUDGETS : DEVICE_LOG_LINES.map(String);
  const linesValue = tab === "qmanager" ? qm.lines : String(sysLines);

  // Day words and the boot span read on the rows' clock: QManager rows are the
  // modem's local stamps, kernel rows are epochs from the device's own `now`.
  const qmOffset = React.useMemo(() => rowClockOffset(qm.entries), [qm.entries]);
  const qmNow = React.useMemo(
    () => modemNowSec(qm.entries, qm.boots, qmOffset),
    [qm.entries, qm.boots, qmOffset],
  );
  const nowSec =
    tab === "qmanager" ? (qmNow ?? qm.lastReadAtSec ?? 0) : (device?.now ?? 0);

  return (
    <motion.div className={HISTORY_PAGE} variants={staggerContainer} initial="hidden" animate="visible">
      <motion.div variants={staggerItem}>
        <CellularPageHeader
          title={t("logs.page.title")}
          description={t("logs.page.description")}
          actions={
            <>
              <Button
                type="button"
                variant="tonal-neutral"
                size="action"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
              >
                <MaterialSymbol
                  name="refresh"
                  size={LOGS.ACTION_GLYPH}
                  aria-hidden="true"
                  className={cn(refreshing && "motion-safe:animate-spin")}
                />
                {ts("logs.page.refresh")}
              </Button>
              <Button
                type="button"
                variant="tonal-neutral"
                size="action"
                onClick={() => void handleCopy()}
                disabled={rows.length === 0}
              >
                <MaterialSymbol name="content_copy" size={LOGS.ACTION_GLYPH} aria-hidden="true" />
                {ts("logs.page.copy")}
              </Button>
              {tab === "qmanager" ? <DebugLeaseAction debug={debug} onToggle={toggleDebug} /> : null}
              {tab === "qmanager" ? (
                <Button
                  type="button"
                  variant="tonal-destructive"
                  size="action"
                  onClick={() => setClearOpen(true)}
                >
                  <MaterialSymbol name="delete" size={LOGS.ACTION_GLYPH} aria-hidden="true" />
                  {ts("logs.page.clear")}
                </Button>
              ) : null}
            </>
          }
        />
      </motion.div>

      {/* Each tab's tiles describe its own log; the System strip follows the source. */}
      <motion.div variants={staggerItem}>
        {tab === "qmanager" ? (
          <LogsSummary logs={qm} />
        ) : loading ? (
          <LogsSummarySkeleton />
        ) : (
          <DeviceLogsSummary device={device} />
        )}
      </motion.div>

      <motion.div variants={staggerItem}>
        <Card className={HISTORY_CARD} aria-label={t("logs.page.title")}>
          <CardContent className="flex flex-col gap-4 px-0">
            <div className={LOGS.TOOLBAR}>
              <Tabs value={tab} onValueChange={changeTab}>
                <TabsList className="h-auto gap-1 bg-transparent p-0">
                  <TabsTrigger value="qmanager" className={TAB_TRIGGER}>
                    {t("logs.tabs.qmanager")}
                  </TabsTrigger>
                  <TabsTrigger value="system" className={TAB_TRIGGER}>
                    {t("logs.tabs.system")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {tab === "qmanager" ? (
                <SegmentedField
                  value={qm.level}
                  onValueChange={changeLevel}
                  options={levelOptions}
                  ariaLabel={t("logs.level_label")}
                  glyph={renderCheckGlyph}
                  className="@2xl/card:ml-1"
                />
              ) : (
                <SegmentedField
                  value={source}
                  onValueChange={changeSource}
                  options={sourceOptions}
                  ariaLabel={t("logs.source_label")}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                  className="@2xl/card:ml-1"
                />
              )}

              <div className="ml-auto flex items-center gap-3">
                {tab === "qmanager" ? <DebugLeaseBadge debug={debug} /> : null}
                <Select value={linesValue} onValueChange={changeLines}>
                  <SelectTrigger size="sm" aria-label={t("logs.lines_label")} className="tabular-nums">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-tile">
                    {lineOptions.map((n) => (
                      <SelectItem key={n} value={n} className="tabular-nums">
                        {t("logs.lines_option", { value: n })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {bootView && bootView.boots.length >= 2 ? (
              <BootSelect
                boots={bootView.boots}
                thisBoot={bootView.thisBoot}
                value={bootView.value}
                onValueChange={changeBoot}
                nowSec={nowSec}
                offsetSec={tab === "qmanager" ? qmOffset : 0}
              />
            ) : null}

            {loading ? (
              <>
                <span className="sr-only" role="status">
                  {t("logs.loading_sr")}
                </span>
                <LogRowsSkeleton plain={plain} />
              </>
            ) : failed ? (
              <Notice
                glyph="cloud_off"
                tone="destructive"
                className={LOGS.STATE_H}
                title={t("logs.error.title")}
                description={t("logs.error.description")}
                action={
                  <Button variant="tonal-neutral" size="sm" onClick={() => void handleRefresh()}>
                    {t("logs.retry")}
                  </Button>
                }
              />
            ) : rows.length === 0 ? (
              <Notice
                glyph="event_note"
                className={LOGS.STATE_H}
                title={t(levelNarrowed ? "logs.empty_level.title" : "logs.empty.title")}
                description={t(
                  debugUnkept
                    ? "logs.empty_debug.description"
                    : levelNarrowed
                      ? "logs.empty_level.description"
                      : pastBoot
                        ? "logs.empty.description_boot"
                        : "logs.empty.description",
                )}
                action={
                  debugUnkept ? (
                    <Button
                      variant="tonal-neutral"
                      size="sm"
                      disabled={debug.isBusy}
                      onClick={() => void toggleDebug(true)}
                    >
                      {t("logs.empty_debug.action", { minutes: DEBUG_LEASE_MIN })}
                    </Button>
                  ) : levelNarrowed ? (
                    <Button variant="tonal-neutral" size="sm" onClick={() => changeLevel("all")}>
                      {t("logs.show_all")}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <LogList
                  groups={groups}
                  plain={plain}
                  nowSec={nowSec}
                  label={t(tab === "qmanager" ? "logs.tabs.qmanager" : `logs.source.${source}`)}
                />
                <LogsPagination
                  view={view}
                  total={rows.length}
                  pageSize={pageSize}
                  onPageSizeChange={changePageSize}
                  onPageChange={setPageIndex}
                  stale={stale}
                />
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ts("logs.clear_dialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>{ts("logs.clear_dialog.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={qm.isClearing}>
              {ts("logs.clear_dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={qm.isClearing}
              onClick={(event) => {
                event.preventDefault();
                void handleClear();
              }}
            >
              {qm.isClearing ? (
                <MaterialSymbol
                  name="progress_activity"
                  size={LOGS.ACTION_GLYPH}
                  aria-hidden="true"
                  className="motion-safe:animate-spin"
                />
              ) : null}
              {ts(qm.isClearing ? "logs.clear_dialog.clearing" : "logs.clear_dialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

export default LogsPage;
