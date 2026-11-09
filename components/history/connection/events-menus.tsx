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

import { EVENT_CATEGORIES, type EventCategoryId } from "./events-presentation";

// The page-size menu is the family's: it is not specific to cellular events.
export { PageSizeMenu } from "../cellular/events-menus";

const MENU = "rounded-field p-1.5";
const ITEM = "h-9 gap-2.5 rounded-[0.5rem] px-2.5 text-sm";

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 flex-none place-items-center rounded-[5px] border-[1.5px]",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-on-surface-variant",
      )}
    >
      {checked ? <MaterialSymbol name="check" size={14} /> : null}
    </span>
  );
}

export interface CategoryFilterMenuProps {
  /** Categories with at least one event in the range, with their counts. */
  options: readonly { id: EventCategoryId; count: number }[];
  /** Categories currently shown. */
  selected: readonly EventCategoryId[];
  /** True when every available category is shown. */
  all: boolean;
  onToggle: (id: EventCategoryId) => void;
  onShowAll: () => void;
}

/** Multi-select category filter. The last checked category cannot be unchecked. */
export function CategoryFilterMenu({
  options,
  selected,
  all,
  onToggle,
  onShowAll,
}: CategoryFilterMenuProps) {
  const { t } = useTranslation("history");
  const label = all
    ? t("connection.events.filter_all")
    : t("connection.events.filter_some", { count: selected.length, total: options.length });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="tonal-neutral" size="sm" aria-label={t("connection.events.filter_aria")}>
          <MaterialSymbol name="tune" size={18} />
          <span className="tabular-nums">{label}</span>
          <MaterialSymbol name="expand_more" size={18} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn(MENU, "min-w-60")}>
        {options.map(({ id, count }) => {
          const checked = selected.includes(id);
          const category = EVENT_CATEGORIES.find((c) => c.id === id);
          return (
            <DropdownMenuItem
              key={id}
              className={ITEM}
              disabled={checked && selected.length === 1}
              onSelect={(e) => {
                e.preventDefault();
                onToggle(id);
              }}
            >
              <Checkbox checked={checked} />
              {category ? (
                <MaterialSymbol
                  name={category.glyph}
                  size={18}
                  className="text-on-surface-variant"
                />
              ) : null}
              <span className="flex-1">{t(`connection.events.categories.${id}`)}</span>
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
          {t("connection.events.show_all")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
