"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { ContextMenuItem } from "@/components/ui/context-menu";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SMS_REACTION_KINDS, type SmsReactionKind } from "@/lib/sms-reactions";

// =============================================================================
// Reactions — the four emoji a message can carry
// =============================================================================
// Heart, star, memo and pushpin. These ARE emoji, by decision: a reaction is the
// reader's own mark on a message, not an interface glyph, and the system emoji
// font is the one place a user expects it to look like their phone's. Every
// other glyph on this surface stays Material Symbols.
//
// Three pieces share this module so the options can never drift apart:
//   * `ReactionAddButton`: the hover/focus button beside a bubble (desktop),
//     opening a popover picker.
//   * `ReactionMenuRow`: the same four options as the first row of the
//     per-message context menu (right-click, long-press, Shift+F10).
//   * `ReactionChips`: what sits on the bubble once a reaction is set. Each chip
//     is a button that takes its reaction off again.
// =============================================================================

export const SMS_REACTION_EMOJI: Record<SmsReactionKind, string> = {
  heart: "❤️",
  star: "⭐",
  memo: "\u{1F4DD}",
  pin: "\u{1F4CC}",
};

/**
 * Each reaction's highlight is its own emoji's colour (`--reaction-*` in
 * globals.css, authored per theme). Written out as whole class strings so the
 * Tailwind scanner sees every one.
 */
export const REACTION_RING: Record<SmsReactionKind, string> = {
  heart: "ring-reaction-heart",
  star: "ring-reaction-star",
  memo: "ring-reaction-memo",
  pin: "ring-reaction-pin",
};

/** A soft fill in the reaction's colour: the pressed state of its option. */
const REACTION_TINT: Record<SmsReactionKind, string> = {
  heart: "bg-reaction-heart/20",
  star: "bg-reaction-star/20",
  memo: "bg-reaction-memo/20",
  pin: "bg-reaction-pin/20",
};
const REACTION_TINT_FOCUS: Record<SmsReactionKind, string> = {
  heart: "focus:bg-reaction-heart/30",
  star: "focus:bg-reaction-star/30",
  memo: "focus:bg-reaction-memo/30",
  pin: "focus:bg-reaction-pin/30",
};

/**
 * Which reaction colours a message that carries several. The one you would most
 * want to find again wins: a pin, then heart, star, memo.
 */
const HIGHLIGHT_ORDER: readonly SmsReactionKind[] = [
  "pin",
  "heart",
  "star",
  "memo",
];

export function dominantReaction(
  kinds: readonly SmsReactionKind[],
): SmsReactionKind | null {
  return HIGHLIGHT_ORDER.find((k) => kinds.includes(k)) ?? null;
}

/** Shared by the popover picker and the context-menu row: one 40px option. */
const OPTION =
  "rounded-pill grid size-10 flex-none place-items-center text-[1.375rem] leading-none outline-none select-none transition-[background-color,transform] duration-[var(--duration-quick)] ease-out motion-safe:hover:scale-110 pointer-coarse:size-11";

export function ReactionEmoji({
  kind,
  className,
}: {
  kind: SmsReactionKind;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn("leading-none select-none", className)}>
      {SMS_REACTION_EMOJI[kind]}
    </span>
  );
}

/** Translated name of a reaction, for labels and tooltips. */
export function useReactionName() {
  const { t } = useTranslation("cellular");
  return React.useCallback(
    (kind: SmsReactionKind) => t(`sms.center.reactions.names.${kind}`),
    [t],
  );
}

function useOptionLabel() {
  const { t } = useTranslation("cellular");
  const name = useReactionName();
  return React.useCallback(
    (kind: SmsReactionKind, on: boolean) =>
      on
        ? t("sms.center.reactions.remove", { reaction: name(kind) })
        : t("sms.center.reactions.set", { reaction: name(kind) }),
    [t, name],
  );
}

// -----------------------------------------------------------------------------
// Popover picker, opened by the button beside a bubble
// -----------------------------------------------------------------------------

export function ReactionAddButton({
  active,
  onToggle,
  align,
}: {
  active: readonly SmsReactionKind[];
  onToggle: (kind: SmsReactionKind) => void;
  /** Which edge of the trigger the picker lines up with. */
  align: "start" | "end";
}) {
  const { t } = useTranslation("cellular");
  const label = useOptionLabel();
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Hidden at rest and revealed by hover or by focus anywhere in the
            row, so a keyboard user who lands on a bubble finds it. A coarse
            pointer never sees it: long-press opens the context menu, which
            carries the same four options. */}
        <button
          type="button"
          aria-label={t("sms.center.reactions.add")}
          className={cn(
            "text-on-surface-variant rounded-pill grid size-7 flex-none place-items-center opacity-0 outline-none",
            "transition-[opacity,background-color] duration-[var(--duration-quick)] ease-out",
            "hover:bg-surface-container-high focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100",
            "focus-visible:ring-ring focus-visible:ring-offset-surface-container focus-visible:ring-[3px] focus-visible:ring-offset-2",
            "pointer-coarse:hidden",
          )}
        >
          <MaterialSymbol name="add" size={16} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align={align}
        sideOffset={6}
        aria-label={t("sms.center.reactions.group")}
        className="rounded-pill w-auto p-1"
      >
        <div role="group" className="flex items-center gap-0.5">
          {SMS_REACTION_KINDS.map((kind) => {
            const on = active.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                aria-label={label(kind, on)}
                onClick={() => {
                  onToggle(kind);
                  setOpen(false);
                }}
                className={cn(
                  OPTION,
                  "hover:bg-surface-container-high",
                  "focus-visible:ring-ring focus-visible:ring-offset-popover focus-visible:ring-[3px] focus-visible:ring-offset-2",
                  on && REACTION_TINT[kind],
                )}
              >
                <ReactionEmoji kind={kind} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// -----------------------------------------------------------------------------
// The same four options as the first row of the context menu
// -----------------------------------------------------------------------------

export function ReactionMenuRow({
  active,
  onToggle,
}: {
  active: readonly SmsReactionKind[];
  onToggle: (kind: SmsReactionKind) => void;
}) {
  const label = useOptionLabel();
  return (
    <div role="group" className="flex items-center gap-0.5 p-0.5">
      {SMS_REACTION_KINDS.map((kind) => {
        const on = active.includes(kind);
        return (
          <ContextMenuItem
            key={kind}
            aria-label={label(kind, on)}
            onSelect={() => onToggle(kind)}
            className={cn(
              OPTION,
              "p-0 focus:bg-surface-container-high",
              on && cn(REACTION_TINT[kind], REACTION_TINT_FOCUS[kind]),
            )}
          >
            <ReactionEmoji kind={kind} />
          </ContextMenuItem>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Chips on the bubble
// -----------------------------------------------------------------------------

export function ReactionChips({
  kinds,
  onToggle,
}: {
  kinds: readonly SmsReactionKind[];
  onToggle: (kind: SmsReactionKind) => void;
}) {
  const { t } = useTranslation("cellular");
  const name = useReactionName();
  return (
    <>
      {kinds.map((kind) => (
        <button
          key={kind}
          type="button"
          aria-label={t("sms.center.reactions.remove", { reaction: name(kind) })}
          onClick={() => onToggle(kind)}
          className={cn(
            "rounded-pill relative grid h-6 min-w-6 place-items-center px-1 text-[0.8125rem] leading-none outline-none",
            // A wider hit area around the 24px chip. Horizontal only to speak of:
            // the chips hang into the gap above the next bubble, which must keep
            // its own top edge.
            "after:absolute after:-inset-x-1.5 after:-inset-y-0.5 after:content-['']",
            "transition-colors duration-[var(--duration-quick)] ease-out hover:bg-surface-container-high",
            "focus-visible:ring-ring focus-visible:ring-offset-surface-container focus-visible:ring-[3px] focus-visible:ring-offset-2",
          )}
        >
          <ReactionEmoji kind={kind} />
        </button>
      ))}
    </>
  );
}
