"use client";

import { Button } from "@/components/ui/button";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

import { CONDITION, CONDITION_TONE, type ConditionTone } from "./shapes";

// A condition REPLACES the surface rather than sitting above it. The block is
// the state, which is why it is one of the sanctioned container uses.
export interface ConditionBlockProps {
  tone: ConditionTone;
  icon: MaterialSymbolName;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: MaterialSymbolName;
  /** `tonal` for an action that changes a setting rather than retrying a read. */
  actionVariant?: "pill" | "tonal";
  /** Disables the action and swaps its glyph for a spinner while it runs. */
  actionBusy?: boolean;
}

export function ConditionBlock({
  tone,
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionIcon,
  actionVariant = "pill",
  actionBusy = false,
}: ConditionBlockProps) {
  const skin = CONDITION_TONE[tone];
  return (
    <div className={cn(CONDITION.ROOT, skin.ROOT)} role="status">
      <span aria-hidden className={cn(CONDITION.DISC, skin.DISC)}>
        <MaterialSymbol name={icon} size={28} />
      </span>
      <span className={CONDITION.TITLE}>{title}</span>
      <p className={CONDITION.DESC}>{description}</p>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant={actionVariant === "tonal" ? "tonal" : "ghost"}
          onClick={onAction}
          disabled={actionBusy}
          className={cn(
            CONDITION.ACTION,
            actionVariant === "pill" && skin.ACTION,
          )}
        >
          {actionBusy ? (
            <MaterialSymbol
              name="progress_activity"
              size={18}
              className="motion-safe:animate-spin"
            />
          ) : actionIcon ? (
            <MaterialSymbol name={actionIcon} size={18} />
          ) : null}
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
