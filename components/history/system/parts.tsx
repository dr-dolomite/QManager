"use client";

import { CardHeader } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { HEADER_SHAPE } from "./shapes";

// Small pieces the cards and the page states share.

export function CardHeaderSkeleton() {
  return (
    <CardHeader className="gap-1 px-0">
      <div className={cn("flex flex-col", HEADER_SHAPE.GAP)}>
        <Skeleton className={cn(HEADER_SHAPE.TITLE, "rounded-inline")} />
        <Skeleton className={cn(HEADER_SHAPE.DESCRIPTION, "rounded-inline")} />
      </div>
    </CardHeader>
  );
}

const NOTICE_DISC = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  success: "bg-success text-success-foreground",
} as const;

/** An in-card empty state: a disc, a title and one line. */
export function Notice({
  glyph,
  tone = "neutral",
  title,
  description,
  className,
}: {
  glyph: MaterialSymbolName;
  tone?: keyof typeof NOTICE_DISC;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <Empty className={cn("gap-3 p-6", className)}>
      <EmptyHeader>
        <span
          className={cn(
            "mb-1 grid size-11 flex-none place-items-center rounded-pill",
            NOTICE_DISC[tone],
          )}
        >
          <MaterialSymbol name={glyph} size={22} filled />
        </span>
        <EmptyTitle className="text-[0.9375rem] font-semibold">{title}</EmptyTitle>
        <EmptyDescription className="text-on-surface-variant text-[0.8125rem]">
          {description}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
