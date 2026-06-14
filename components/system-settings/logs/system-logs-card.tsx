"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";
import { useTranslation, Trans } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { motion } from "motion/react";
import { transitionBase } from "@/lib/motion";

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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCcwIcon,
  Loader2,
  Clock,
  SearchIcon,
  Trash2Icon,
  LogsIcon,
  CopyIcon,
  FilterXIcon,
  OctagonAlertIcon,
  TriangleAlertIcon,
  InfoIcon,
  BugIcon,
} from "lucide-react";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/logs.sh";

interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  pid: string;
  message: string;
}

interface LogStats {
  current_size_kb: number;
  current_lines: number;
  rotated_files: number;
}

interface LogsResponse {
  success: boolean;
  entries: LogEntry[];
  total: number;
  stats: LogStats;
  available_components: string[];
  error?: string;
  detail?: string;
}

// Level → calm outline badge, per the project status-badge contract:
// variant="outline" + bg-{role}/15 text-{role} border-{role}/30 + size-3 icon.
// (DESIGN.md / ServiceStatusBadge — solid variants are forbidden in feature surfaces.)
const LEVEL_STYLES: Record<
  string,
  { cls: string; Icon: typeof InfoIcon }
> = {
  ERROR: {
    cls: "border-destructive/30 bg-destructive/15 text-destructive",
    Icon: OctagonAlertIcon,
  },
  WARN: {
    cls: "border-warning/30 bg-warning/15 text-warning",
    Icon: TriangleAlertIcon,
  },
  INFO: {
    cls: "border-info/30 bg-info/15 text-info",
    Icon: InfoIcon,
  },
  DEBUG: {
    cls: "border-muted-foreground/30 bg-muted/50 text-muted-foreground",
    Icon: BugIcon,
  },
};

const LevelBadge = ({ level }: { level: string }) => {
  const style = LEVEL_STYLES[level] ?? LEVEL_STYLES.DEBUG;
  const { cls, Icon } = style;
  return (
    <Badge variant="outline" className={cls}>
      <Icon className="size-3" />
      {level}
    </Badge>
  );
};

const SystemLogsCard = () => {
  const { t } = useTranslation("system-settings");

  // Data state
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [availableComponents, setAvailableComponents] = useState<string[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);

  // Filter state
  const [level, setLevel] = useState<string>("all");
  const [component, setComponent] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");
  const [lines, setLines] = useState<string>("100");
  const [includeRotated, setIncludeRotated] = useState(false);

  // UI state
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  // Refs
  const mountedRef = useRef(true);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const filtersActive =
    level !== "all" ||
    component !== "all" ||
    search.trim() !== "" ||
    includeRotated;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Cleanup search timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch logs from backend
  // ---------------------------------------------------------------------------
  const fetchLogs = useCallback(
    async (silent = false) => {
      if (!silent) setIsFetching(true);

      try {
        const params = new URLSearchParams();
        params.set("lines", lines);
        if (level !== "all") params.set("level", level);
        if (component !== "all") params.set("component", component);
        if (search.trim()) params.set("search", search.trim());
        if (includeRotated) params.set("include_rotated", "1");

        const resp = await authFetch(`${CGI_ENDPOINT}?${params.toString()}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data: LogsResponse = await resp.json();
        if (!mountedRef.current) return;

        if (data.success) {
          setEntries(data.entries);
          setTotalEntries(data.total);
          setStats(data.stats);
          setAvailableComponents(data.available_components);
          setLastFetched(new Date());
          setError(false);
        } else {
          throw new Error(data.detail || data.error || "request failed");
        }
      } catch {
        if (!mountedRef.current) return;
        // Keep any stale rows on a silent refresh failure; only surface the
        // dedicated error state when we have nothing to show.
        setError(true);
        if (!silent) toast.error(t("system_logs.toast_load_failed"));
      } finally {
        if (mountedRef.current) {
          setIsInitialLoading(false);
          if (!silent) setIsFetching(false);
        }
      }
    },
    [level, component, search, lines, includeRotated, t]
  );

  // Initial fetch + re-fetch on filter change
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh every 10s (silent)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLogs(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // ---------------------------------------------------------------------------
  // Search debounce
  // ---------------------------------------------------------------------------
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setSearch(value);
    }, 400);
  };

  const handleClearFilters = () => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    setLevel("all");
    setComponent("all");
    setSearch("");
    setSearchInput("");
    setIncludeRotated(false);
  };

  const handleCopy = async () => {
    if (!entries.length || !navigator.clipboard) {
      toast.error(t("system_logs.toast_copy_failed"));
      return;
    }
    const text = entries
      .map(
        (e) =>
          `${e.timestamp} [${e.level}] ${e.component}${
            e.pid ? `(${e.pid})` : ""
          }: ${e.message}`
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        t("system_logs.toast_copied", { count: entries.length })
      );
    } catch {
      toast.error(t("system_logs.toast_copy_failed"));
    }
  };

  // ---------------------------------------------------------------------------
  // Clear logs
  // ---------------------------------------------------------------------------
  const handleClearLogs = async () => {
    setIsClearing(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (data.success) {
        toast.success(t("system_logs.toast_cleared"));
        setShowClearDialog(false);
        await fetchLogs(true);
      } else {
        toast.error(data.detail || t("system_logs.toast_clear_failed"));
      }
    } catch {
      if (mountedRef.current) {
        toast.error(t("system_logs.toast_clear_failed"));
      }
    } finally {
      if (mountedRef.current) {
        setIsClearing(false);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // First-load skeleton (only before the very first fetch settles — filter
  // changes and refreshes keep the toolbar mounted and load inside the table).
  // ---------------------------------------------------------------------------
  if (isInitialLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("system_logs.card_title")}</CardTitle>
          <CardDescription>{t("system_logs.card_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid gap-2">
              <div className="grid grid-cols-2 @md/card:flex gap-2">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9 col-span-2 @md/card:flex-1" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-9" />
              </div>
            </div>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("system_logs.card_title")}</CardTitle>
          <CardDescription>{t("system_logs.card_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Toolbar */}
          <div className="grid gap-2 mb-4">
            {/* Row 1: Filters */}
            <div className="grid grid-cols-2 @md/card:flex @md/card:flex-wrap items-center gap-2">
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger>
                  <SelectValue placeholder={t("system_logs.filter_all_levels")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("system_logs.filter_all_levels")}</SelectItem>
                  <SelectItem value="DEBUG">DEBUG</SelectItem>
                  <SelectItem value="INFO">INFO</SelectItem>
                  <SelectItem value="WARN">WARN</SelectItem>
                  <SelectItem value="ERROR">ERROR</SelectItem>
                </SelectContent>
              </Select>

              <Select value={component} onValueChange={setComponent}>
                <SelectTrigger>
                  <SelectValue placeholder={t("system_logs.filter_all_components")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("system_logs.filter_all_components")}</SelectItem>
                  {availableComponents.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative col-span-2 @md/card:flex-1 @md/card:min-w-48">
                <label htmlFor="log-search" className="sr-only">
                  {t("system_logs.filter_search_label")}
                </label>
                <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  id="log-search"
                  placeholder={t("system_logs.filter_search_placeholder")}
                  value={searchInput}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            {/* Row 2: Options + Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={lines} onValueChange={setLines}>
                <SelectTrigger className="w-auto min-w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                  <SelectItem value="500">500</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2">
                <Switch
                  id="include-rotated"
                  checked={includeRotated}
                  onCheckedChange={setIncludeRotated}
                />
                <label
                  htmlFor="include-rotated"
                  className="text-sm text-muted-foreground whitespace-nowrap"
                >
                  {t("system_logs.filter_include_archived")}
                </label>
              </div>

              {filtersActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="text-muted-foreground"
                >
                  <FilterXIcon className="size-4 mr-1" />
                  {t("system_logs.actions_clear_filters")}
                </Button>
              )}

              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("system_logs.actions_copy_aria")}
                  onClick={handleCopy}
                  disabled={!entries.length}
                >
                  <CopyIcon className="size-4" />
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("system_logs.actions_refresh_aria")}
                  onClick={() => fetchLogs()}
                  disabled={isFetching}
                >
                  {isFetching ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCcwIcon className="size-4" />
                  )}
                </Button>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowClearDialog(true)}
                >
                  <Trash2Icon className="size-4 mr-1" />
                  {t("system_logs.actions_clear")}
                </Button>
              </div>
            </div>
          </div>

          {/* Log table — fades in once on first appearance, then stays put so
              filter changes and silent refreshes never replay the motion. */}
          <motion.div
            className="rounded-md border"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={transitionBase}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">{t("system_logs.table_col_timestamp")}</TableHead>
                  <TableHead className="w-24">{t("system_logs.table_col_level")}</TableHead>
                  <TableHead className="w-32 hidden @md/card:table-cell">
                    {t("system_logs.table_col_component")}
                  </TableHead>
                  <TableHead>{t("system_logs.table_col_message")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody
                className={
                  isFetching ? "opacity-60 transition-opacity" : "transition-opacity"
                }
              >
                {entries.length === 0 && error ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      <div className="flex flex-col items-center gap-3">
                        <OctagonAlertIcon className="h-8 w-8 text-destructive" />
                        <p className="text-sm text-muted-foreground">
                          {t("system_logs.error_message")}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fetchLogs()}
                          disabled={isFetching}
                        >
                          {isFetching ? (
                            <Loader2 className="size-4 animate-spin mr-1" />
                          ) : (
                            <RefreshCcwIcon className="size-4 mr-1" />
                          )}
                          {t("system_logs.error_retry")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      <div className="flex flex-col items-center gap-3">
                        <LogsIcon className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          {filtersActive
                            ? t("system_logs.table_empty_filtered")
                            : t("system_logs.table_empty")}
                        </p>
                        {filtersActive && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleClearFilters}
                          >
                            <FilterXIcon className="size-4 mr-1" />
                            {t("system_logs.actions_clear_filters")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((entry, index) => (
                    <TableRow key={`${entry.timestamp}-${index}`}>
                      <TableCell className="tabular-nums text-xs whitespace-nowrap text-muted-foreground">
                        {entry.timestamp}
                      </TableCell>
                      <TableCell>
                        <LevelBadge level={entry.level} />
                      </TableCell>
                      <TableCell className="hidden @md/card:table-cell">
                        <button
                          type="button"
                          onClick={() => setComponent(entry.component)}
                          title={t("system_logs.table_col_component")}
                          className="text-xs bg-muted px-1.5 py-0.5 rounded hover:bg-accent transition-colors max-w-32 truncate"
                        >
                          {entry.component}
                        </button>
                      </TableCell>
                      <TableCell className="wrap-break-word text-sm">
                        {entry.message}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </motion.div>
        </CardContent>
        <CardFooter className="flex justify-between items-center">
          <div className="text-xs text-muted-foreground">
            <Trans
              i18nKey="system_logs.footer_showing"
              ns="system-settings"
              values={{ count: entries.length, total: totalEntries }}
              components={{ strong: <strong /> }}
            />
            {stats && (
              <span className="ml-2">
                {t("system_logs.footer_stats", {
                  count: stats.rotated_files,
                  kb: stats.current_size_kb,
                  rotated: stats.rotated_files,
                })}
              </span>
            )}
          </div>
          {lastFetched && (
            <div className="flex items-center text-xs text-muted-foreground">
              <Clock className="h-3 w-3 mr-1" />
              {t("system_logs.footer_last_updated", {
                time: lastFetched.toLocaleTimeString(),
              })}
            </div>
          )}
        </CardFooter>
      </Card>

      {/* Clear confirmation dialog */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("system_logs.clear_dialog_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("system_logs.clear_dialog_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isClearing}
              onClick={handleClearLogs}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isClearing ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-1" />
                  {t("system_logs.clear_dialog_clearing")}
                </>
              ) : (
                t("system_logs.clear_dialog_clear_all")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default SystemLogsCard;
