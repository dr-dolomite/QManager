"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { CellMapperStatus } from "@/hooks/use-cellmapper";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CellMapperInfoStripProps {
  status: CellMapperStatus | null;
  uploadTarget?: "cellmapper" | "custom";
  customUrl?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CellMapperInfoStrip({ status, uploadTarget, customUrl }: CellMapperInfoStripProps) {
  const { t } = useTranslation("monitoring");

  if (!status) return null;

  const endpoint =
    uploadTarget === "custom" && customUrl
      ? customUrl.replace(/^https?:\/\//, "").split("/")[0]
      : "cellmapper.net";

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>
        {t("cellmapper.info_destination", { endpoint })}
      </span>

      <span className="hidden @md/main:inline">·</span>

      <div className="flex items-center gap-3">
        <Link
          href="/monitoring/cellmapper/settings"
          className="hover:text-foreground transition-colors"
        >
          {t("cellmapper.info_link_settings")}
        </Link>
        <Link
          href="/monitoring/cellmapper/log"
          className="hover:text-foreground transition-colors"
        >
          {t("cellmapper.info_link_log")}
        </Link>
        <Link
          href="/monitoring/cellmapper/buffer"
          className="hover:text-foreground transition-colors"
        >
          {t("cellmapper.info_link_buffer")}
        </Link>
      </div>
    </div>
  );
}
