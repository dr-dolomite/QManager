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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DownloadIcon,
  Trash2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";

// Types

interface LogEntry {
  id: number;
  uploaded_at: number;
  batch_id: string;
  point_count: number;
  endpoint: string;
  size_bytes: number;
  latency_ms: number;
  status: string;
  error_msg: string | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

// Constants

const LOG_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/log.sh";
const CLEAR_LOG_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/clear-log.sh";
const EXPORT_ENDPOINT = "/cgi-bin/quecmanager/cellmapper/export.sh";

// Helpers

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Component

const CellMapperLogComponent = () => {
  const { t } = useTranslation("monitoring");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchLog = useCallback(async (page = 1) => {
    setIsLoading(true);
    try {
      const resp = await authFetch(`${LOG_ENDPOINT}?page=${page}&limit=20`);
      const data = await resp.json();
      if (data.success) {
        setEntries(data.entries);
        setPagination(data.pagination);
      }
    } catch {
      /* noop */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const handleClear = async () => {
    try {
      const resp = await authFetch(CLEAR_LOG_ENDPOINT, { method: "POST" });
      const data = await resp.json();
      if (data.success) {
        toast.success(t("cellmapper.toast_log_cleared"));
        fetchLog();
      }
    } catch {
      toast.error(t("cellmapper.toast_log_clear_error"));
    }
  };

  const handleExport = async () => {
    try {
      const resp = await authFetch(EXPORT_ENDPOINT);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cellmapper-log-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("cellmapper.toast_export_success"));
    } catch {
      /* noop */
    }
  };

  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString();

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{t("cellmapper.log_title")}</h1>
        <p className="text-muted-foreground">{t("cellmapper.log_description")}</p>
      </div>

      <Card className="@container/card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("cellmapper.log_title")}</CardTitle>
              {pagination.total > 0 && (
                <CardDescription>
                  {t("cellmapper.log_showing", {
                    shown: entries.length,
                    total: pagination.total,
                  })}
                </CardDescription>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                <DownloadIcon className="h-4 w-4 mr-1" />
                {t("cellmapper.log_btn_export")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
                className="text-destructive"
              >
                <Trash2Icon className="h-4 w-4 mr-1" />
                {t("cellmapper.log_btn_clear")}
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
              {t("cellmapper.log_empty")}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-3 font-medium text-muted-foreground">
                        {t("cellmapper.log_col_time")}
                      </th>
                      <th className="py-2 pr-3 font-medium text-muted-foreground">
                        {t("cellmapper.log_col_status")}
                      </th>
                      <th className="py-2 pr-3 font-medium text-muted-foreground text-right">
                        {t("cellmapper.log_col_points")}
                      </th>
                      <th className="py-2 pr-3 font-medium text-muted-foreground">
                        {t("cellmapper.log_col_endpoint")}
                      </th>
                      <th className="py-2 pr-3 font-medium text-muted-foreground text-right">
                        {t("cellmapper.log_col_size")}
                      </th>
                      <th className="py-2 font-medium text-muted-foreground text-right">
                        {t("cellmapper.log_col_latency")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-mono text-xs">
                          {formatTime(entry.uploaded_at)}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge
                            variant="outline"
                            className={
                              entry.status === "ok"
                                ? "bg-success/15 text-success border-success/30"
                                : "bg-destructive/15 text-destructive border-destructive/30"
                            }
                          >
                            {entry.status === "ok"
                              ? t("cellmapper.log_status_ok")
                              : t("cellmapper.log_status_error")}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {entry.point_count}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {entry.endpoint}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatBytes(entry.size_bytes)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {entry.latency_ms > 0
                            ? `${entry.latency_ms} ms`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {pagination.pages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={pagination.page <= 1}
                    onClick={() => fetchLog(pagination.page - 1)}
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
                    onClick={() => fetchLog(pagination.page + 1)}
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

export default CellMapperLogComponent;
