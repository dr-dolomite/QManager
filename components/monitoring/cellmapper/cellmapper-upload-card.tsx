"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UploadIcon,
  Loader2,
  CheckCircle2Icon,
  MinusCircleIcon,
  AlertCircleIcon,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CellMapperUploadCardProps {
  buffer: {
    pending_count: number;
    pending_size_bytes: number;
    oldest_age_sec: number | null;
  } | null;
  lastUpload: {
    timestamp: number;
    batch_size: number;
    status: string;
  } | null;
  uploaderState: "running" | "idle" | "error" | "needs_reauth" | "backoff" | undefined;
  isLoading: boolean;
  isStale: boolean;
  onUploadNow: () => Promise<boolean>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatTimeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Uploader state badge config ─────────────────────────────────────────────

const UPLOADER_BADGE_STYLES: Record<
  "running" | "idle" | "error" | "needs_reauth" | "backoff",
  { variant: "outline"; className: string; icon: React.ReactNode }
> = {
  running: {
    variant: "outline",
    className:
      "bg-success/15 text-success hover:bg-success/20 border-success/30",
    icon: <CheckCircle2Icon className="h-3 w-3" />,
  },
  idle: {
    variant: "outline",
    className:
      "bg-muted/50 text-muted-foreground border-muted-foreground/30",
    icon: <MinusCircleIcon className="h-3 w-3" />,
  },
  error: {
    variant: "outline",
    className:
      "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30",
    icon: <AlertCircleIcon className="h-3 w-3" />,
  },
  needs_reauth: {
    variant: "outline",
    className:
      "bg-warning/15 text-warning hover:bg-warning/20 border-warning/30",
    icon: <AlertCircleIcon className="h-3 w-3" />,
  },
  backoff: {
    variant: "outline",
    className:
      "bg-warning/15 text-warning hover:bg-warning/20 border-warning/30",
    icon: <AlertCircleIcon className="h-3 w-3" />,
  },
};

// Translation key map — avoids dynamic template literal that trips up i18n
// extraction and TypeScript. Keys are confirmed present in monitoring.json.
const UPLOADER_STATE_I18N_KEYS = {
  running: "cellmapper.uploader_state_running",
  idle: "cellmapper.uploader_state_idle",
  error: "cellmapper.uploader_state_error",
  needs_reauth: "cellmapper.uploader_state_needs_reauth",
  backoff: "cellmapper.uploader_state_backoff",
} as const;

// ─── Component ───────────────────────────────────────────────────────────────

export function CellMapperUploadCard({
  buffer,
  lastUpload,
  uploaderState,
  isLoading,
  isStale,
  onUploadNow,
}: CellMapperUploadCardProps) {
  const { t } = useTranslation("monitoring");
  const [isUploading, setIsUploading] = useState(false);

  const handleUploadNow = async () => {
    setIsUploading(true);
    try {
      const ok = await onUploadNow();
      if (ok) toast.success(t("cellmapper.toast_upload_triggered"));
      else toast.error(t("cellmapper.toast_upload_error"));
    } finally {
      setIsUploading(false);
    }
  };

  const isUploadDisabled =
    isUploading ||
    (buffer?.pending_count ?? 0) < 5 ||
    uploaderState === "error" || uploaderState === "needs_reauth";

  const badgeKey = (uploaderState ?? "idle") as keyof typeof UPLOADER_BADGE_STYLES;
  const badgeStyle = UPLOADER_BADGE_STYLES[badgeKey];

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("cellmapper.upload_title")}</CardTitle>
          <CardDescription>{t("cellmapper.upload_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-6 w-28" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Definition list rows ──────────────────────────────────────────────────
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: t("cellmapper.upload_row_pending"),
      value:
        buffer !== null
          ? `${buffer.pending_count.toLocaleString()} pts`
          : "—",
    },
    {
      label: t("cellmapper.upload_row_buffered"),
      value: buffer !== null ? formatBytes(buffer.pending_size_bytes) : "—",
    },
    {
      label: t("cellmapper.upload_row_last"),
      value: lastUpload !== null ? formatTimeAgo(lastUpload.timestamp) : "—",
    },

  ];

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t("cellmapper.upload_title")}</CardTitle>
            <CardDescription>
              {t("cellmapper.upload_description")}
            </CardDescription>
          </div>

          {/* Uploader state badge — animates on state change */}
          <AnimatePresence mode="wait">
            <motion.div
              key={badgeKey}
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.88 }}
              transition={{
                duration: 0.18,
                type: "spring",
                stiffness: 400,
                damping: 24,
              }}
            >
              <Badge
                variant={badgeStyle.variant}
                className={badgeStyle.className}
              >
                {badgeStyle.icon}
                {t(UPLOADER_STATE_I18N_KEYS[badgeKey])}
              </Badge>
            </motion.div>
          </AnimatePresence>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid gap-2">
          {/* Stale indicator */}
          {isStale && (
            <p className="text-xs text-muted-foreground italic">
              {t("cellmapper.upload_stale_warning")}
            </p>
          )}

          {/* Rows — stagger in on mount */}
          <motion.div
            className="grid gap-2"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: {
                transition: {
                  staggerChildren: 0.05,
                  delayChildren: 0.05,
                },
              },
            }}
          >
            {rows.map((row) => (
              <motion.div
                key={row.label}
                variants={{
                  hidden: { opacity: 0, x: -6 },
                  visible: { opacity: 1, x: 0 },
                }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <Separator />
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-sm text-muted-foreground">
                    {row.label}
                  </span>
                  <span className="text-sm font-medium">{row.value}</span>
                </div>
              </motion.div>
            ))}
          </motion.div>

          <Separator />

          {/* Upload Now button */}
          <div className="pt-2">
            <Button size="sm" disabled={isUploadDisabled} onClick={handleUploadNow}>
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("cellmapper.upload_btn_uploading")}
                </>
              ) : (
                <>
                  <UploadIcon className="h-4 w-4" />
                  {t("cellmapper.upload_btn_now")}
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
