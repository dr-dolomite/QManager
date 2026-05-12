"use client";

import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSet,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Trash2Icon, DownloadIcon } from "lucide-react";

// Types

interface RetentionSettings {
  buffer_size_mb: number;
  buffer_age_days: number;
}

interface BufferStats {
  pending_count: number;
  pending_size_bytes: number;
  oldest_age_sec: number | null;
}

interface CellMapperRetentionCardProps {
  settings: RetentionSettings | null;
  bufferStats: BufferStats | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (partial: Record<string, unknown>) => Promise<boolean>;
  onPurge: () => Promise<boolean>;
  onExport: () => Promise<void>;
}

// Helpers

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatTimeAgo(sec: number): string {
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// Card outer

export function CellMapperRetentionCard({
  settings,
  bufferStats,
  isLoading,
  isSaving,
  onSave,
  onPurge,
  onExport,
}: CellMapperRetentionCardProps) {
  const { t } = useTranslation("monitoring");

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("cellmapper.retention_title")}</CardTitle>
          <CardDescription>{t("cellmapper.retention_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-8 w-32 mt-2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const formKey = settings
    ? `${settings.buffer_size_mb}-${settings.buffer_age_days}`
    : "empty";

  return (
    <RetentionForm
      key={formKey}
      settings={settings}
      bufferStats={bufferStats}
      isSaving={isSaving}
      onSave={onSave}
      onPurge={onPurge}
      onExport={onExport}
    />
  );
}

// Form inner

function RetentionForm({
  settings,
  bufferStats,
  isSaving,
  onSave,
  onPurge,
  onExport,
}: Omit<CellMapperRetentionCardProps, "isLoading">) {
  const { t } = useTranslation("monitoring");
  const { saved, markSaved } = useSaveFlash();

  const [bufferSizeMb, setBufferSizeMb] = useState(
    String(settings?.buffer_size_mb ?? 50),
  );
  const [bufferAgeDays, setBufferAgeDays] = useState(
    String(settings?.buffer_age_days ?? 7),
  );
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  const isDirty = useMemo(() => {
    if (!settings) return false;
    return (
      bufferSizeMb !== String(settings.buffer_size_mb) ||
      bufferAgeDays !== String(settings.buffer_age_days)
    );
  }, [settings, bufferSizeMb, bufferAgeDays]);

  const canSave = isDirty && !isSaving;

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSave) return;
      const success = await onSave({
        buffer_size_mb: parseInt(bufferSizeMb, 10),
        buffer_age_days: parseInt(bufferAgeDays, 10),
      });
      if (success) {
        markSaved();
        toast.success(t("cellmapper.toast_save_success"));
      } else {
        toast.error(t("cellmapper.toast_save_error"));
      }
    },
    [canSave, onSave, bufferSizeMb, bufferAgeDays, markSaved, t],
  );

  const handlePurge = useCallback(async () => {
    setIsPurging(true);
    try {
      const ok = await onPurge();
      if (ok) toast.success(t("cellmapper.toast_purge_success"));
      else toast.error(t("cellmapper.toast_save_error"));
    } finally {
      setIsPurging(false);
      setPurgeOpen(false);
    }
  }, [onPurge, t]);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("cellmapper.retention_title")}</CardTitle>
        <CardDescription>{t("cellmapper.retention_description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSave}>
          <FieldSet>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="buffer-size">
                  {t("cellmapper.retention_size_label")}
                </FieldLabel>
                <Select value={bufferSizeMb} onValueChange={setBufferSizeMb}>
                  <SelectTrigger id="buffer-size" className="max-w-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[5, 10, 25, 50, 100, 250, 500].map((mb) => (
                      <SelectItem key={mb} value={String(mb)}>
                        {t("cellmapper.retention_size_option", { size: mb })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {t("cellmapper.retention_size_description")}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="buffer-age">
                  {t("cellmapper.retention_age_label")}
                </FieldLabel>
                <Select value={bufferAgeDays} onValueChange={setBufferAgeDays}>
                  <SelectTrigger id="buffer-age" className="max-w-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 3, 7, 14, 30].map((days) => (
                      <SelectItem key={days} value={String(days)}>
                        {t("cellmapper.retention_age_option", { days })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {t("cellmapper.retention_age_description")}
                </FieldDescription>
              </Field>

              <div className="flex items-center gap-2 pt-2">
                <SaveButton
                  type="submit"
                  isSaving={isSaving}
                  saved={saved}
                  className="w-fit"
                  disabled={!canSave}
                />
              </div>
            </FieldGroup>
          </FieldSet>
        </form>

        <Separator className="my-4" />

        <div className="grid gap-2">
          <p className="text-sm font-semibold text-muted-foreground">
            {t("cellmapper.retention_stats_title")}
          </p>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t("cellmapper.retention_stats_pending")}
              </span>
              <span className="text-sm font-medium">
                {bufferStats != null
                  ? t("cellmapper.retention_stats_pending_value", {
                      count: bufferStats.pending_count,
                    })
                  : "—"}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t("cellmapper.retention_stats_size")}
              </span>
              <span className="text-sm font-medium">
                {bufferStats != null
                  ? formatBytes(bufferStats.pending_size_bytes)
                  : "—"}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t("cellmapper.retention_stats_oldest")}
              </span>
              <span className="text-sm font-medium">
                {bufferStats?.oldest_age_sec != null
                  ? formatTimeAgo(bufferStats.oldest_age_sec)
                  : "—"}
              </span>
            </div>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="grid gap-1.5 mb-4">
          <p className="text-sm font-semibold text-muted-foreground">
            {t("cellmapper.retention_rotation_title")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("cellmapper.retention_rotation_info", { size: bufferSizeMb, days: bufferAgeDays })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                disabled={(bufferStats?.pending_count ?? 0) === 0}
              >
                <Trash2Icon className="h-4 w-4 mr-1" />
                {t("cellmapper.retention_btn_purge")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("cellmapper.purge_title")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("cellmapper.purge_desc", {
                    count: bufferStats?.pending_count ?? 0,
                    size: formatBytes(bufferStats?.pending_size_bytes ?? 0),
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cellmapper.consent_cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handlePurge} disabled={isPurging}>
                  {isPurging ? (
                    <Loader2 className="size-4 animate-spin mr-1" />
                  ) : null}
                  {t("cellmapper.purge_confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button variant="outline" size="sm" onClick={onExport}>
            <DownloadIcon className="h-4 w-4 mr-1" />
            {t("cellmapper.retention_btn_export")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
