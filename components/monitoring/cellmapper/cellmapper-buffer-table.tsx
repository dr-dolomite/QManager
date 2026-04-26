"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  UploadIcon,
  Trash2Icon,
  DownloadIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BufferEntry {
  id: number;
  captured_at: number;
  size_bytes: number;
  summary: {
    type: string | null;
    MCC: number | null;
    MNC: number | null;
    CID: number | null;
    signal: number | null;
    latitude: number | null;
    longitude: number | null;
  };
}

interface BufferStats {
  total_pending: number;
  total_size_bytes: number;
  oldest_ts: number | null;
  newest_ts: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BUFFER_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/buffer.sh";
const UPLOAD_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/upload.sh";
const PURGE_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/purge.sh";
const EXPORT_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/export.sh";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatTimeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ─── Component ───────────────────────────────────────────────────────────────

const CellMapperBufferComponent = () => {
  const { t } = useTranslation("monitoring");
  const [entries, setEntries] = useState<BufferEntry[]>([]);
  const [stats, setStats] = useState<BufferStats | null>(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isFlushing, setIsFlushing] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  const fetchBuffer = useCallback(async (page = 1) => {
    setIsLoading(true);
    try {
      const resp = await authFetch(`${BUFFER_ENDPOINT}?page=${page}&limit=20`);
      const data = await resp.json();
      if (data.success) {
        setEntries(data.entries);
        setStats(data.stats);
        setPagination(data.pagination);
      }
    } catch {
      /* noop */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBuffer();
  }, [fetchBuffer]);

  const handleFlush = async () => {
    setIsFlushing(true);
    try {
      const resp = await authFetch(UPLOAD_ENDPOINT, { method: "POST" });
      const data = await resp.json();
      if (data.success) {
        toast.success(t("cellmapper.toast_upload_triggered"));
        setTimeout(() => fetchBuffer(), 2000);
      }
    } catch {
      toast.error(t("cellmapper.toast_upload_error"));
    } finally {
      setIsFlushing(false);
    }
  };

  const handlePurge = async () => {
    setIsPurging(true);
    try {
      const resp = await authFetch(PURGE_ENDPOINT, { method: "POST" });
      const data = await resp.json();
      if (data.success) {
        toast.success(t("cellmapper.toast_purge_success"));
        fetchBuffer();
      }
    } catch {
      /* noop */
    } finally {
      setIsPurging(false);
    }
  };

  const handleExport = async () => {
    try {
      const resp = await authFetch(EXPORT_ENDPOINT);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cellmapper-buffer-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* noop */
    }
  };

  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString();

  const summaryLine = stats
    ? t("cellmapper.buffer_summary", {
        count: stats.total_pending,
        size: formatBytes(stats.total_size_bytes),
        oldest: stats.oldest_ts ? formatTimeAgo(stats.oldest_ts) : "—",
      })
    : null;

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">
          {t("cellmapper.buffer_title")}
        </h1>
        <p className="text-muted-foreground">
          {t("cellmapper.buffer_description")}
        </p>
      </div>

      <Card className="@container/card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("cellmapper.buffer_title")}</CardTitle>
              {summaryLine && (
                <CardDescription>{summaryLine}</CardDescription>
              )}
            </div>
            <div className="flex gap-2">
              {/* Flush Now */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleFlush}
                disabled={
                  isFlushing || (stats?.total_pending ?? 0) < 5
                }
              >
                {isFlushing ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <UploadIcon className="h-4 w-4 mr-1" />
                )}
                {t("cellmapper.buffer_btn_flush")}
              </Button>

              {/* Purge Buffer with confirmation */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    disabled={(stats?.total_pending ?? 0) === 0}
                  >
                    <Trash2Icon className="h-4 w-4 mr-1" />
                    {t("cellmapper.buffer_btn_purge")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("cellmapper.purge_title")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("cellmapper.purge_desc", {
                        count: stats?.total_pending ?? 0,
                        size: formatBytes(stats?.total_size_bytes ?? 0),
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {t("cellmapper.consent_cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handlePurge}
                      disabled={isPurging}
                    >
                      {isPurging && (
                        <Loader2 className="size-4 animate-spin mr-1" />
                      )}
                      {t("cellmapper.purge_confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* Export CSV */}
              <Button variant="outline" size="sm" onClick={handleExport}>
                <DownloadIcon className="h-4 w-4 mr-1" />
                {t("cellmapper.buffer_btn_export")}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t("cellmapper.buffer_empty")}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-3 font-medium text-muted-foreground">
                        {t("cellmapper.buffer_col_captured")}
                      </th>
                      <th className="py-2 pr-3 font-medium text-muted-foreground">
                        {t("cellmapper.buffer_col_rat")}
                      </th>
                      <th className="py-2 pr-3 font-medium text-muted-foreground">
                        {t("cellmapper.buffer_col_mcc")}
                      </th>
                      <th className="py-2 pr-3 font-medium text-muted-foreground">
                        {t("cellmapper.buffer_col_mnc")}
                      </th>
                      <th className="py-2 pr-3 font-medium text-muted-foreground">
                        {t("cellmapper.buffer_col_cell")}
                      </th>
                      <th className="py-2 pr-3 font-medium text-muted-foreground text-right">
                        {t("cellmapper.buffer_col_signal")}
                      </th>
                      <th className="py-2 font-medium text-muted-foreground">
                        {t("cellmapper.buffer_col_position")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-mono text-xs">
                          {formatTime(entry.captured_at)}
                        </td>
                        <td className="py-2 pr-3">
                          {entry.summary.type ?? "—"}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {entry.summary.MCC ?? "—"}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {entry.summary.MNC ?? "—"}
                        </td>
                        <td className="py-2 pr-3 tabular-nums font-mono text-xs">
                          {entry.summary.CID ?? "—"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {entry.summary.signal != null
                            ? `${entry.summary.signal} dBm`
                            : "—"}
                        </td>
                        <td className="py-2 font-mono text-xs">
                          {entry.summary.latitude != null &&
                          entry.summary.longitude != null
                            ? `${entry.summary.latitude.toFixed(3)}, ${entry.summary.longitude.toFixed(3)}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pagination.pages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={pagination.page <= 1}
                    onClick={() => fetchBuffer(pagination.page - 1)}
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {pagination.page} / {pagination.pages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={pagination.page >= pagination.pages}
                    onClick={() => fetchBuffer(pagination.page + 1)}
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CellMapperBufferComponent;
