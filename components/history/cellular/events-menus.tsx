"use client";

import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";
import type { CellularEventType } from "@/types/history";

import { eventTypeGlyph } from "./events-glyphs";
import { PAGE_SIZES } from "./signal-shapes";

const MENU = "rounded-field p-1.5";
const ITEM = "h-9 gap-2.5 rounded-[0.5rem] px-2.5 text-sm";

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 flex-none place-items-center rounded-[5px] border-[1.5px]",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-on-surface-variant",
      )}
    >
      {checked ? <MaterialSymbol name="check" size={14} /> : null}
    </span>
  );
}

export interface TypeFilterMenuProps {
  /** Types with at least one event in the range, with their counts. */
  options: readonly { type: CellularEventType; count: number }[];
  /** Types currently shown. */
  selected: readonly CellularEventType[];
  /** True when every available type is shown. */
  all: boolean;
  onToggle: (type: CellularEventType) => void;
  onShowAll: () => void;
}

/** Multi-select type filter. The last checked type cannot be unchecked. */
export function TypeFilterMenu({ options, selected, all, onToggle, onShowAll }: TypeFilterMenuProps) {
  const { t } = useTranslation("history");
  const label = all
    ? t("cellular.events.filter_all")
    : t("cellular.events.filter_some", { count: selected.length, total: options.length });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="tonal-neutral" size="sm" aria-label={t("cellular.events.filter_aria")}>
          <MaterialSymbol name="tune" size={18} />
          <span className="tabular-nums">{label}</span>
          <MaterialSymbol name="expand_more" size={18} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn(MENU, "min-w-60")}>
        {options.map(({ type, count }) => {
          const checked = selected.includes(type);
          return (
            <DropdownMenuItem
              key={type}
              className={ITEM}
              disabled={checked && selected.length === 1}
              onSelect={(e) => {
                e.preventDefault();
                onToggle(type);
              }}
            >
              <Checkbox checked={checked} />
              <MaterialSymbol name={eventTypeGlyph(type)} size={18} className="text-on-surface-variant" />
              <span className="flex-1">{t(`cellular.events.types.${type}`)}</span>
              <span className="text-on-surface-variant text-xs tabular-nums">{count}</span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={ITEM}
          disabled={all}
          onSelect={(e) => {
            e.preventDefault();
            onShowAll();
          }}
        >
          <MaterialSymbol name="done_all" size={18} className="text-on-surface-variant" />
          {t("cellular.events.show_all")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface PageSizeMenuProps {
  value: number;
  onChange: (size: number) => void;
}

export function PageSizeMenu({ value, onChange }: PageSizeMenuProps) {
  const { t } = useTranslation("history");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="tonal-neutral"
          size="sm"
          aria-label={t("cellular.events.rows_per_page")}
          className="tabular-nums"
        >
          {value}
          <MaterialSymbol name="expand_more" size={18} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn(MENU, "min-w-24")}>
        {PAGE_SIZES.map((n) => (
          <DropdownMenuItem key={n} className={cn(ITEM, "tabular-nums")} onSelect={() => onChange(n)}>
            <span className="grid size-4 flex-none place-items-center">
              {n === value ? <MaterialSymbol name="check" size={16} /> : null}
            </span>
            {n}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
