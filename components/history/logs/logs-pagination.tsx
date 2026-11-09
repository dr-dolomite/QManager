"use client";

import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { LogPage } from "./derive";
import { LOGS, PAGE_SIZES, type PageSize } from "./shapes";

// =============================================================================
// Logs: the footer
// =============================================================================
// The range in view on the left; rows per page, the page count and first /
// previous / next / last on the right. On a narrow card the rows-per-page
// picker and the first/last jumps fold away, leaving previous and next.
// The previous and last arrows are the next and first glyphs mirrored, which
// keeps the icon subset unchanged.
// =============================================================================

const PAGE_SIZE_ID = "logs-page-size";

function NavButton({
  glyph,
  mirrored = false,
  label,
  disabled,
  onClick,
  className,
}: {
  glyph: MaterialSymbolName;
  mirrored?: boolean;
  label: string;
  disabled: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="tonal-neutral"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      <MaterialSymbol
        name={glyph}
        size={18}
        aria-hidden="true"
        className={cn(mirrored && "-scale-x-100")}
      />
    </Button>
  );
}

export function LogsPagination({
  view,
  total,
  pageSize,
  onPageSizeChange,
  onPageChange,
  stale,
}: {
  view: LogPage;
  total: number;
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
  onPageChange: (page: number) => void;
  stale: boolean;
}) {
  const { t } = useTranslation("history");
  const atFirst = view.page === 0;
  const atLast = view.page >= view.pageCount - 1;

  return (
    <div className={LOGS.FOOT}>
      <div className="flex items-center gap-2">
        <span className="tabular-nums">
          {t("logs.showing", { from: view.from, to: view.to, total })}
        </span>
        {stale ? (
          <Badge variant="warning">
            <MaterialSymbol name="sync_problem" size={12} filled aria-hidden="true" />
            {t("logs.stale")}
          </Badge>
        ) : null}
      </div>

      <div className={LOGS.FOOT_NAV}>
        <div className="hidden items-center gap-2 @2xl/card:flex">
          <Label htmlFor={PAGE_SIZE_ID} className={LOGS.FOOT_LABEL}>
            {t("logs.pagination.rows_per_page")}
          </Label>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onPageSizeChange(Number(v) as PageSize)}
          >
            <SelectTrigger id={PAGE_SIZE_ID} size="sm" className="w-20 tabular-nums">
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top" className="rounded-tile">
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)} className="tabular-nums">
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className={LOGS.FOOT_LABEL} aria-live="polite">
          {t("logs.pagination.page_of", { page: view.page + 1, pages: view.pageCount })}
        </span>

        <div className="flex items-center gap-2">
          <NavButton
            glyph="first_page"
            label={t("logs.pagination.first")}
            disabled={atFirst}
            onClick={() => onPageChange(0)}
            className="hidden @2xl/card:inline-flex"
          />
          <NavButton
            glyph="chevron_right"
            mirrored
            label={t("logs.pagination.previous")}
            disabled={atFirst}
            onClick={() => onPageChange(view.page - 1)}
          />
          <NavButton
            glyph="chevron_right"
            label={t("logs.pagination.next")}
            disabled={atLast}
            onClick={() => onPageChange(view.page + 1)}
          />
          <NavButton
            glyph="first_page"
            mirrored
            label={t("logs.pagination.last")}
            disabled={atLast}
            onClick={() => onPageChange(view.pageCount - 1)}
            className="hidden @2xl/card:inline-flex"
          />
        </div>
      </div>
    </div>
  );
}
