"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { DUR, EASE_QUICK } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { SmsMessage } from "@/types/sms";

import { dayRelation, formatClock, formatDay } from "./sms-format";
import { ReactionEmoji } from "./sms-reactions";

// =============================================================================
// SmsPinnedStrip — pinned messages, lifted above the thread
// =============================================================================
// A message the reader pinned (the pushpin reaction) is also shown here, so the
// one they need again is never a scroll away. It sits in the header's `surface`
// as one recessed panel in the well's own `surface-container`: the same tonal
// step the message well uses, no divider.
//
// The newest pin is the row you see. Tapping it scrolls the thread to that
// message and flashes it. With more than one pin, a count control opens the rest
// in place; every row has its own unpin.
//
// Conditions have no exit animation (DESIGN.md > The Enter-Only Rule): the strip
// fades in when the first pin lands and is simply gone when the last one leaves.
// =============================================================================

export interface PinnedItem {
  /** The bubble's key, for scrolling the thread to it. */
  key: string;
  message: SmsMessage;
  text: string;
  /** True for a message this device sent. */
  out: boolean;
  epochMs: number;
}

/** Rows visible before the expanded list scrolls. */
const LIST_MAX_HEIGHT = "13rem";

export interface SmsPinnedStripProps {
  /** Newest pin first. The strip renders nothing when this is empty. */
  pins: PinnedItem[];
  /** The thread's resolved title, for received messages. */
  senderTitle: string;
  locale: string;
  onJump: (key: string) => void;
  onUnpin: (message: SmsMessage) => void;
  className?: string;
}

export function SmsPinnedStrip({
  pins,
  senderTitle,
  locale,
  onJump,
  onUnpin,
  className,
}: SmsPinnedStripProps) {
  const { t } = useTranslation("cellular");
  const [expanded, setExpanded] = React.useState(false);
  const listId = React.useId();

  if (pins.length === 0) return null;

  const [latest, ...rest] = pins;
  const open = expanded && rest.length > 0;

  return (
    <motion.section
      aria-label={t("sms.center.pins.label")}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DUR.quick, ease: EASE_QUICK }}
      className={cn(
        "bg-surface flex-none px-3 pb-3 @2xl/pane:px-5",
        className,
      )}
    >
      <div className="bg-surface-container rounded-tile overflow-hidden">
        <PinRow
          pin={latest}
          senderTitle={senderTitle}
          locale={locale}
          onJump={onJump}
          onUnpin={onUnpin}
          trailing={
            rest.length > 0 ? (
              <Button
                type="button"
                variant="tonal-neutral"
                size="xs"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => setExpanded((v) => !v)}
                className="flex-none tabular-nums pointer-coarse:h-11"
              >
                {t("sms.center.pins.count", { count: pins.length })}
                <MaterialSymbol
                  name="expand_more"
                  size={16}
                  className={cn(
                    "transition-transform duration-[var(--duration-quick)] ease-out",
                    open && "rotate-180",
                  )}
                />
              </Button>
            ) : null
          }
        />

        {open ? (
          <motion.ul
            id={listId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: DUR.quick, ease: EASE_QUICK }}
            style={{ maxHeight: LIST_MAX_HEIGHT }}
            className="flex flex-col overflow-y-auto pb-1"
          >
            {rest.map((pin) => (
              <li key={pin.key}>
                <PinRow
                  pin={pin}
                  senderTitle={senderTitle}
                  locale={locale}
                  onJump={onJump}
                  onUnpin={onUnpin}
                />
              </li>
            ))}
          </motion.ul>
        ) : null}
      </div>
    </motion.section>
  );
}

// -----------------------------------------------------------------------------
// One pinned message: jump target on the left, unpin on the right
// -----------------------------------------------------------------------------

function PinRow({
  pin,
  senderTitle,
  locale,
  onJump,
  onUnpin,
  trailing,
}: {
  pin: PinnedItem;
  senderTitle: string;
  locale: string;
  onJump: (key: string) => void;
  onUnpin: (message: SmsMessage) => void;
  trailing?: React.ReactNode;
}) {
  const { t } = useTranslation("cellular");
  // The row's own text names its unpin button (aria-describedby), so a screen
  // reader hears WHICH message "Unpin" acts on.
  const textId = React.useId();

  const rel = dayRelation(pin.epochMs);
  const when =
    rel === "today"
      ? formatClock(pin.epochMs, locale)
      : rel === "yesterday"
        ? t("sms.center.time.yesterday")
        : formatDay(pin.epochMs, locale);

  return (
    <div className="flex items-center gap-1 pr-1.5">
      <button
        type="button"
        onClick={() => onJump(pin.key)}
        className={cn(
          "rounded-tile flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left outline-none",
          "hover:bg-surface-container-high transition-colors duration-[var(--duration-quick)] ease-out",
          "focus-visible:ring-ring focus-visible:ring-offset-surface-container focus-visible:ring-[3px] focus-visible:ring-offset-2",
          "pointer-coarse:min-h-11",
        )}
      >
        <span
          aria-hidden="true"
          className="bg-reaction-pin/20 grid size-7 flex-none place-items-center rounded-full text-[0.9375rem]"
        >
          <ReactionEmoji kind="pin" />
        </span>
        <span id={textId} className="min-w-0 flex-1">
          <span className="text-on-surface-variant flex items-baseline gap-1.5 text-[0.6875rem] leading-4 font-semibold">
            <span className="min-w-0 truncate">
              {pin.out ? t("sms.center.pins.you") : senderTitle}
            </span>
            <span className="flex-none font-normal tabular-nums">{when}</span>
          </span>
          <span className="text-on-surface block truncate text-[0.8125rem] leading-5">
            {pin.text}
          </span>
        </span>
      </button>

      {trailing}

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("sms.center.pins.unpin")}
        aria-describedby={textId}
        onClick={() => onUnpin(pin.message)}
        className="text-on-surface-variant flex-none pointer-coarse:size-11"
      >
        <MaterialSymbol name="close" size={16} />
      </Button>
    </div>
  );
}
