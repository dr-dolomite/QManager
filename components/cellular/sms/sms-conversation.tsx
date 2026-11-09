"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Bubble, BubbleContent, BubbleReactions } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMotionReduced } from "@/components/motion-preference";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Tag } from "@/components/ui/tag";
import { copyText } from "@/lib/clipboard";
import { DUR, EASE_QUICK, EASE_STANDARD } from "@/lib/motion";
import { useSmsReactions } from "@/hooks/use-sms-reactions";
import type { SmsReactionKind } from "@/lib/sms-reactions";
import { cn } from "@/lib/utils";
import type { PendingSmsSend } from "@/hooks/use-sms";
import type { SmsMessage } from "@/types/sms";

import { SmsComposer } from "./sms-composer";
import {
  containsSuspiciousLink,
  dayRelation,
  extractOneTimeCode,
  formatClock,
  formatDay,
  isOutbound,
  isServerFailed,
  smsDayKey,
  smsEpochMs,
} from "./sms-format";
import { SmsIdentityDisc } from "./sms-identity-disc";
import { SmsMessageContextMenu } from "./sms-message-menu";
import { SmsPinnedStrip, type PinnedItem } from "./sms-pinned-strip";
import {
  ReactionAddButton,
  ReactionChips,
  REACTION_RING,
  dominantReaction,
} from "./sms-reactions";
import { SmsConversationSkeleton, SmsStatePanel } from "./sms-states";
import type { SmsThreadView } from "./sms-threads";

// =============================================================================
// SmsConversation — the right pane of the two-pane card
// =============================================================================
// One tonal step above the thread list (`surface-container` against the list's
// `surface`), with the header and the composer returning to `surface` so the
// message well reads as recessed. No divider anywhere: the tonal step is the
// separation (DESIGN.md > Tonal-Elevation, No-Hairline-On-Fill).
//
// Outbound messages say **Sent**, never "Delivered". The modem acknowledging a
// submission is not a delivery receipt and this interface does not get to claim
// one.
// =============================================================================

/** The bubble silhouette: 18px all round, 6px on the tail corner. */
const BUBBLE_RADIUS = "rounded-[1.125rem]";
const TAIL_IN = "rounded-bl-[0.375rem]";
const TAIL_OUT = "rounded-br-[0.375rem]";

/**
 * A reacted bubble wears a 2px ring hugging its edge in the reaction's OWN
 * colour (`dominantReaction`: a pin, then heart, star, memo), so the emoji and
 * the highlight say the same thing. It hugs the edge with no offset so the jump
 * flash (a 3px ring with a 2px gap, on the outer bubble) can sit around it
 * without the two merging.
 */

/** How long a pinned-message jump keeps its flash ring. */
const FLASH_MS = 1600;

const NO_REACTIONS: readonly SmsReactionKind[] = [];

/** The provenance marker's type step: 10px, uppercase, wide-tracked. */
const PROVENANCE_TAG =
  "flex-none px-1.5 py-0 text-[0.625rem] font-bold tracking-[0.03em] uppercase";

type Side = "in" | "out";

interface ThreadBubble {
  key: string;
  side: Side;
  text: string;
  epochMs: number;
  /** One-time code offered for copying. Received only. */
  code: string | null;
  /** True when a received body contains a link-shaped substring. */
  hasLink: boolean;
  pending?: PendingSmsSend;
  /** A backend-recorded failed send (`isServerFailed`), not a pending one. */
  serverFailed?: boolean;
  /**
   * The source message, when this bubble is backed by one already stored.
   * Absent for a still-pending optimistic send: the per-message context menu
   * uses this to decide what it can offer.
   */
  message?: SmsMessage;
}

interface ThreadBubbleGroup {
  key: string;
  side: Side;
  dayKey: number;
  epochMs: number;
  bubbles: ThreadBubble[];
  pending?: PendingSmsSend;
  serverFailed?: boolean;
}

/** Stable identity for a stored message, for AnimatePresence keys. */
function messageKey(msg: SmsMessage, epochMs: number): string {
  if (msg.identity) return `srv-${msg.identity}`;
  const idx = msg.indexes?.length ? msg.indexes.join("-") : (msg.index ?? "x");
  return `srv-${idx}-${epochMs}-${msg.content?.length ?? 0}`;
}

/**
 * Widest gap between a client-queued send and its server-recorded failed
 * counterpart that still counts as "the same send" for dedupe purposes. The two
 * clocks are never the same event: `createdAt` is when the browser queued the
 * send, the record's `time` is when the backend wrote the failure. 120s covers
 * the send attempt and ordinary clock skew without being wide enough to fold
 * together two genuinely different sends of the same body (a plausible thing to
 * type twice, e.g. "ok").
 */
const PENDING_SERVER_DEDUPE_WINDOW_MS = 120_000;

/**
 * How close to the bottom (px) still counts as "reading the newest message",
 * so sub-pixel rounding and a stray nudge don't unpin the conversation.
 */
const STICK_TO_BOTTOM_PX = 48;

/**
 * True when `pending` (a `failed` client-side optimistic send) is the same send
 * as one of the backend-recorded failed messages in `messages`: same body,
 * timestamps within the dedupe window. The server copy wins (it survives
 * reload; the client one does not), so the caller skips rendering `pending`
 * when this returns true.
 */
function isPendingDuplicateOfServerFailure(
  pending: PendingSmsSend,
  messages: SmsMessage[],
): boolean {
  if (pending.state !== "failed") return false;
  for (const msg of messages) {
    if (!isServerFailed(msg)) continue;
    if ((msg.content ?? "") !== pending.text) continue;
    const diff = Math.abs(smsEpochMs(msg) - pending.createdAt);
    if (diff <= PENDING_SERVER_DEDUPE_WINDOW_MS) return true;
  }
  return false;
}

function buildGroups(
  messages: SmsMessage[],
  pending: PendingSmsSend[],
): ThreadBubbleGroup[] {
  const groups: ThreadBubbleGroup[] = [];

  const pushBubble = (b: ThreadBubble, ownGroup: boolean, pend?: PendingSmsSend) => {
    const dayKey = smsDayKey(b.epochMs || Date.now());
    const last = groups[groups.length - 1];
    if (
      !ownGroup &&
      last &&
      !last.pending &&
      !last.serverFailed &&
      last.side === b.side &&
      last.dayKey === dayKey
    ) {
      last.bubbles.push(b);
      last.epochMs = b.epochMs || last.epochMs;
      return;
    }
    groups.push({
      key: `g-${b.key}`,
      side: b.side,
      dayKey,
      epochMs: b.epochMs,
      bubbles: [b],
      pending: pend,
      serverFailed: b.serverFailed,
    });
  };

  for (const msg of messages) {
    const epochMs = smsEpochMs(msg);
    const side: Side = isOutbound(msg) ? "out" : "in";
    const serverFailed = isServerFailed(msg);
    pushBubble(
      {
        key: messageKey(msg, epochMs),
        side,
        text: msg.content ?? "",
        epochMs,
        code: side === "in" ? extractOneTimeCode(msg.content ?? "") : null,
        hasLink: side === "in" && containsSuspiciousLink(msg.content ?? ""),
        serverFailed,
        message: msg,
      },
      // A failed send gets its own group for the same reason a pending one
      // does: merging it into a settled group would make one failed message
      // look like the whole group failed.
      serverFailed,
    );
  }

  // Each optimistic send is its own group: it carries its own status line and
  // its own retry affordance, and merging it into a settled group would make
  // one failed message look like the whole group failed.
  //
  // A pending `failed` entry that the backend has already recorded (it now also
  // arrives through `messages`) is skipped here: the server copy above renders
  // it, and showing both would duplicate the same failed send as two bubbles.
  for (const p of pending) {
    if (isPendingDuplicateOfServerFailure(p, messages)) continue;
    pushBubble(
      {
        key: p.clientId,
        side: "out",
        text: p.text,
        epochMs: p.createdAt,
        code: null,
        hasLink: false,
        pending: p,
      },
      true,
      p,
    );
  }

  return groups;
}

export interface SmsConversationProps {
  view: SmsThreadView;
  /** Merged thread history, oldest first. */
  messages: SmsMessage[];
  /** Optimistic sends for THIS thread only. */
  pending: PendingSmsSend[];
  isLoadingThread: boolean;
  /** Back to the thread list. The button only shows at single-pane width. */
  onBack: () => void;
  onSend: (text: string) => void;
  onRetrySend: (clientId: string) => void;
  onDismissSend: (clientId: string) => void;
  onRequestDeleteThread: () => void;
  onMarkRead: () => void;
  /** Per-message context menu actions: see `SmsMessageContextMenu`. */
  onForwardMessage: (message: SmsMessage) => void;
  onMarkMessageUnread: (message: SmsMessage) => void;
  onShowMessageDetails: (message: SmsMessage) => void;
  onDeleteMessage: (message: SmsMessage) => void;
  /** Focus lands here when a thread opens. */
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  className?: string;
}

export function SmsConversation({
  view,
  messages,
  pending,
  isLoadingThread,
  onBack,
  onSend,
  onRetrySend,
  onDismissSend,
  onRequestDeleteThread,
  onMarkRead,
  onForwardMessage,
  onMarkMessageUnread,
  onShowMessageDetails,
  onDeleteMessage,
  headingRef,
  className,
}: SmsConversationProps) {
  const { t, i18n } = useTranslation("cellular");
  const locale = i18n.language;
  const { identity } = view;

  const groups = React.useMemo(
    () => buildGroups(messages, pending),
    [messages, pending],
  );

  const copyAddress = async () => {
    // The RAW stored address: that is the value that is useful to paste into
    // a support ticket or another tool, and the one the modem knows.
    const ok = await copyText(view.addr);
    if (ok) toast.success(t("sms.center.toast.address_copied"));
    else toast.error(t("sms.center.toast.copy_failed"));
  };

  return (
    <div
      className={cn(
        "bg-surface-container @container/pane flex min-h-0 flex-col",
        className,
      )}
    >
      {/* ---- header ------------------------------------------------------ */}
      <div className="bg-surface flex flex-none items-center gap-2.5 py-3 pr-3 pl-3 @2xl/pane:pl-5">
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          aria-label={t("sms.center.actions.back")}
          onClick={onBack}
          className="text-on-surface flex-none @3xl/main:hidden"
        >
          <MaterialSymbol name="arrow_back" size={20} />
        </Button>

        <SmsIdentityDisc
          identity={identity}
          sizeClassName="size-9"
          textClassName="text-[0.8125rem]"
          glyphSize={18}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className={cn(
                "min-w-0 truncate text-[0.9375rem] font-bold tracking-[-0.005em] outline-none",
                identity.kind === "msisdn" && "font-mono tabular-nums",
              )}
            >
              {identity.title}
            </h2>
            {/* Provenance. An outline Tag is identity metadata, never status
                (DESIGN.md > The Two-Form Rule). Only a directory match gets a
                tag, with a DASHED stroke so a name we inferred can never be
                mistaken for one the network actually sent. A network-
                confirmed name is the default expectation and doesn't need
                its own badge. */}
            {identity.source === "directory" ? (
              <Tag variant="neutral" className={cn(PROVENANCE_TAG, "border-dashed")}>
                {t("sms.center.identity.matched")}
              </Tag>
            ) : null}
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("sms.center.actions.copy_address")}
          onClick={copyAddress}
          className="text-on-surface-variant flex-none"
        >
          <MaterialSymbol name="content_copy" size={17} />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("sms.center.actions.thread_options")}
              className="text-on-surface-variant flex-none"
            >
              <MaterialSymbol name="more_vert" size={17} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onMarkRead}>
              <MaterialSymbol name="mark_email_read" size={16} />
              {t("sms.center.actions.mark_read")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRequestDeleteThread}>
              <MaterialSymbol name="delete" size={16} />
              {t("sms.center.actions.delete_thread")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ---- body -------------------------------------------------------- */}
      {/* Held until this thread's detail has landed, even when the list
          already has some of its messages: the body then mounts ONCE with the
          full history and fades in as a whole, instead of drawing a partial
          thread and having the rest arrive afterwards as if they were new.
          The skeleton waits one `quick` step before appearing, so a fast
          fetch shows only the fade and a slow one still shows progress. */}
      {isLoadingThread ? (
        <>
          <span className="sr-only" role="status">
            {t("sms.center.states.loading_thread_sr")}
          </span>
          <motion.div
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: DUR.quick, ease: EASE_QUICK, delay: DUR.quick }}
          >
            <SmsConversationSkeleton />
          </motion.div>
        </>
      ) : groups.length === 0 ? (
        <SmsStatePanel
          icon="sms"
          title={t("sms.center.states.thread_empty.title")}
          description={t("sms.center.states.thread_empty.description")}
        />
      ) : (
        /* Keyed on the raw address so the body, and the "which bubbles have I
           already shown" registry inside it, remounts cleanly per thread. */
        <ConversationBody
          key={view.addr}
          groups={groups}
          locale={locale}
          senderTitle={identity.title}
          hasLogo={Boolean(identity.logoDomain)}
          onRetrySend={onRetrySend}
          onDismissSend={onDismissSend}
          onForwardMessage={onForwardMessage}
          onMarkMessageUnread={onMarkMessageUnread}
          onShowMessageDetails={onShowMessageDetails}
          onDeleteMessage={onDeleteMessage}
        />
      )}

      <SmsComposer destinationLabel={identity.title} onSend={onSend} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Conversation body
// -----------------------------------------------------------------------------
// Owns the scroll position and the entrance rule.
//
// **Only a newly-arrived bubble animates.** The history that is already there
// when a thread opens is drawn flat; a bubble that appears afterwards (a poll
// bringing a new message in, or an optimistic send going out) is the only
// thing that rises. That is what `AnimatePresence initial={false}` means, and
// it is why the whole conversation is FLATTENED into one array of directly
// keyed children: AnimatePresence can only see its own direct children, so a
// nested date divider or group footer would break the tracking it depends on.

type RenderItem =
  | { kind: "divider"; key: string; label: string }
  | {
      kind: "bubble";
      key: string;
      text: string;
      side: Side;
      isLast: boolean;
      pending?: PendingSmsSend;
      serverFailed?: boolean;
      message?: SmsMessage;
      code: string | null;
    }
  | { kind: "code"; key: string; code: string; side: Side }
  | { kind: "link"; key: string }
  | { kind: "footer"; key: string; group: ThreadBubbleGroup };

function ConversationBody({
  groups,
  locale,
  senderTitle,
  hasLogo,
  onRetrySend,
  onDismissSend,
  onForwardMessage,
  onMarkMessageUnread,
  onShowMessageDetails,
  onDeleteMessage,
}: {
  groups: ThreadBubbleGroup[];
  locale: string;
  /** The resolved sender title, for the phishing warning's copy. */
  senderTitle: string;
  /** Whether the thread's identity maps to a brand logo (the disc may show it). */
  hasLogo: boolean;
  onRetrySend: (clientId: string) => void;
  onDismissSend: (clientId: string) => void;
  onForwardMessage: (message: SmsMessage) => void;
  onMarkMessageUnread: (message: SmsMessage) => void;
  onShowMessageDetails: (message: SmsMessage) => void;
  onDeleteMessage: (message: SmsMessage) => void;
}) {
  const { t } = useTranslation("cellular");
  const reduceMotion = useMotionReduced();
  const reactions = useSmsReactions();
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // ---- pins ---------------------------------------------------------------
  // Newest pin first. A pin whose message is not in this thread's merged
  // history simply is not listed; the reaction itself stays in storage.
  const pins = React.useMemo<PinnedItem[]>(() => {
    const found: { at: number; item: PinnedItem }[] = [];
    for (const group of groups) {
      for (const b of group.bubbles) {
        if (!b.message) continue;
        const at = reactions.pinnedAtOf(b.message);
        if (at === undefined) continue;
        found.push({
          at,
          item: {
            key: b.key,
            message: b.message,
            text: b.text,
            out: b.side === "out",
            epochMs: b.epochMs,
          },
        });
      }
    }
    return found.sort((a, b) => b.at - a.at).map((f) => f.item);
  }, [groups, reactions]);
  const hasPins = pins.length > 0;

  /** One confirmation toast per finished reaction; a stable id replaces rather than stacks. */
  const toggleReaction = React.useCallback(
    (message: SmsMessage, kind: SmsReactionKind) => {
      const on = reactions.toggle(message, kind);
      toast.success(
        kind === "pin"
          ? t(on ? "sms.center.toast.message_pinned" : "sms.center.toast.message_unpinned")
          : t(on ? "sms.center.toast.reaction_added" : "sms.center.toast.reaction_removed"),
        { id: "sms-reaction" },
      );
    },
    [reactions, t],
  );

  // ---- jump to a pinned message -------------------------------------------
  const [flashKey, setFlashKey] = React.useState<string | null>(null);
  const flashTimerRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(flashTimerRef.current), []);

  const jumpTo = React.useCallback(
    (key: string) => {
      const scroller = scrollRef.current;
      const el = scroller?.querySelector<HTMLElement>(
        `[data-bubble-key="${CSS.escape(key)}"]`,
      );
      if (!scroller || !el) return;
      // Scrolls the thread only: `scrollIntoView` would also walk the page.
      const box = scroller.getBoundingClientRect();
      const at = el.getBoundingClientRect();
      scroller.scrollTo({
        top: Math.max(
          0,
          scroller.scrollTop + (at.top - box.top) - (box.height - at.height) / 2,
        ),
        behavior: reduceMotion ? "auto" : "smooth",
      });
      // Keyboard and screen-reader users get no flash, so focus follows.
      el.querySelector<HTMLElement>('[tabindex="0"]')?.focus({
        preventScroll: true,
      });
      window.clearTimeout(flashTimerRef.current);
      setFlashKey(key);
      flashTimerRef.current = window.setTimeout(
        () => setFlashKey(null),
        FLASH_MS,
      );
    },
    [reduceMotion],
  );

  const tailKey = groups[groups.length - 1]?.bubbles.at(-1)?.key ?? "";

  // Whether the viewport is resting on the newest message. Starts true so a
  // freshly opened thread pins, and is kept current by the scroll handler.
  const atBottomRef = React.useRef(true);
  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_PX;
  }, []);

  const bubbleCount = groups.reduce((n, g) => n + g.bubbles.length, 0);
  const prevTailRef = React.useRef<string | null>(null);

  // One layout effect owns the scroll correction, so it lands before the
  // browser paints: a `useEffect` here shows a freshly opened thread at the TOP
  // of its history for one frame and then snaps it down.
  //
  // Pin to the newest message when one arrived (new tail) or when the reader
  // was already at the bottom, which also covers the thread detail landing a
  // moment after open and merging extra history in above.
  //
  // `scrollTop` rather than a smooth scroll: a smooth scroll would be a second
  // animation racing the bubble's entrance.
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    const prevTail = prevTailRef.current;
    prevTailRef.current = tailKey;
    if (!el) return;
    if (prevTail === null || prevTail !== tailKey || atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
    }
  }, [tailKey, bubbleCount, hasPins]);

  // Expanding or collapsing the pinned strip resizes the well without any
  // message changing: a reader resting at the bottom stays on the newest one.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const items: RenderItem[] = [];
  groups.forEach((group, index) => {
    const prev = groups[index - 1];
    if (!prev || prev.dayKey !== group.dayKey) {
      const rel = dayRelation(group.dayKey);
      items.push({
        kind: "divider",
        key: `d-${group.dayKey}`,
        label:
          rel === "today"
            ? t("sms.center.time.today")
            : rel === "yesterday"
              ? t("sms.center.time.yesterday")
              : formatDay(group.dayKey, locale),
      });
    }

    group.bubbles.forEach((bubble, i) => {
      items.push({
        kind: "bubble",
        key: bubble.key,
        text: bubble.text,
        side: bubble.side,
        isLast: i === group.bubbles.length - 1,
        pending: bubble.pending,
        serverFailed: bubble.serverFailed,
        message: bubble.message,
        code: bubble.code,
      });
      if (bubble.code) {
        items.push({
          kind: "code",
          key: `c-${bubble.key}`,
          code: bubble.code,
          side: bubble.side,
        });
      }
      if (bubble.hasLink) {
        items.push({ kind: "link", key: `l-${bubble.key}` });
      }
    });

    items.push({ kind: "footer", key: `f-${group.key}`, group });
  });

  // The body fades in on each thread switch (it is keyed per thread, so every
  // switch is a fresh mount). Opacity only: the header and composer swap in
  // place, and the messages settle into them rather than sliding.
  return (
    <>
      <SmsPinnedStrip
        pins={pins}
        senderTitle={senderTitle}
        locale={locale}
        onJump={jumpTo}
        onUnpin={(message) => toggleReaction(message, "pin")}
      />
      <motion.div
        ref={scrollRef}
        onScroll={handleScroll}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: DUR.quick, ease: EASE_QUICK }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4 pb-5 @2xl/pane:px-7"
      >
        {/* `mt-auto` rather than `justify-end` on the scroller: a flex-end scroll
            container clips its own overflow at the START edge, which would make
            the oldest messages unreachable. */}
        <div className="mt-auto flex flex-col gap-0.5">
          <AnimatePresence initial={false}>
            {items.map((item) => {
              if (item.kind === "divider") {
                return (
                  <motion.div
                    key={item.key}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
                    className="bg-surface-container-high text-on-surface-variant rounded-pill my-3 self-center px-2.5 py-1 text-[0.65625rem] font-bold tracking-[0.04em] uppercase"
                  >
                    {item.label}
                  </motion.div>
                );
              }

              if (item.kind === "code") {
                return (
                  <motion.div
                    key={item.key}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
                    className={item.side === "out" ? "self-end" : "self-start"}
                  >
                    <CodeChip code={item.code} />
                  </motion.div>
                );
              }

              if (item.kind === "link") {
                return (
                  <motion.div
                    key={item.key}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
                    className="self-start"
                  >
                    <LinkWarning senderTitle={senderTitle} hasLogo={hasLogo} />
                  </motion.div>
                );
              }

              if (item.kind === "footer") {
                return (
                  <motion.div
                    key={item.key}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: DUR.quick, ease: EASE_QUICK }}
                    className={cn(
                      "mt-1.5 mb-5 flex",
                      item.group.side === "out"
                        ? "justify-end pr-1"
                        : "justify-start pl-1",
                    )}
                  >
                    <GroupFooter
                      group={item.group}
                      locale={locale}
                      onRetrySend={onRetrySend}
                      onDismissSend={onDismissSend}
                    />
                  </motion.div>
                );
              }

              const out = item.side === "out";
              const failed = item.pending?.state === "failed" || item.serverFailed;
              const message = item.message;
              const kinds = message ? reactions.reactionsOf(message) : NO_REACTIONS;
              const highlight = dominantReaction(kinds);
              return (
                // The row is the keyed child AnimatePresence tracks (one keyed
                // item per bubble, the flattening rule above). The bubble is the
                // context-menu trigger, so a right-click in the empty space beside
                // it does nothing; the add-reaction button sits in that space.
                <motion.div
                  key={item.key}
                  data-bubble-key={item.key}
                  className={cn(
                    "group/row flex w-full items-center gap-1.5",
                    out ? "flex-row-reverse" : "flex-row",
                  )}
                  // The one bubble entrance in the system: 6px rise + fade on
                  // `standard`. Transform and opacity only, no overshoot. No
                  // bubble uses `exit`, so presence never has to wait on it.
                  initial={{ opacity: 0, y: 6 }}
                  animate={{
                    opacity: item.pending?.state === "sending" ? 0.6 : 1,
                    y: 0,
                  }}
                  transition={{
                    duration: item.pending ? DUR.quick : DUR.standard,
                    ease: item.pending ? EASE_QUICK : EASE_STANDARD,
                  }}
                >
                  <SmsMessageContextMenu
                    message={message}
                    pending={item.pending}
                    code={item.code}
                    reactions={kinds}
                    onToggleReaction={toggleReaction}
                    onForward={onForwardMessage}
                    onMarkUnread={onMarkMessageUnread}
                    onShowDetails={onShowMessageDetails}
                    onDelete={onDeleteMessage}
                  >
                    <Bubble
                      // Keyboard access to the menu: Shift+F10 / the Menu key
                      // dispatch a native `contextmenu` event at the FOCUSED
                      // element, so the bubble has to be focusable to receive it.
                      tabIndex={0}
                      variant={failed ? "failed" : out ? "outbound" : "inbound"}
                      align={out ? "end" : "start"}
                      data-flash={flashKey === item.key ? "" : undefined}
                      className={cn(
                        // `pan-y`, not `none`: a long-press still has to leave
                        // vertical scroll working while it decides whether this
                        // is a press-and-hold (menu) or a swipe (scroll).
                        "touch-pan-y select-text outline-none @2xl/pane:max-w-[66%]",
                        BUBBLE_RADIUS,
                        "focus-visible:ring-ring focus-visible:ring-offset-surface-container focus-visible:ring-[3px] focus-visible:ring-offset-2",
                        "data-[flash]:ring-reaction-pin data-[flash]:ring-offset-surface-container data-[flash]:ring-[3px] data-[flash]:ring-offset-2",
                        "transition-shadow duration-[var(--duration-standard)] ease-standard",
                        // The chips hang half below the bubble: leave room.
                        kinds.length > 0 && "mb-5",
                      )}
                    >
                      <BubbleContent
                        className={cn(
                          BUBBLE_RADIUS,
                          "px-3.5 py-2.5 text-[0.84375rem] leading-[1.45]",
                          item.isLast && (out ? TAIL_OUT : TAIL_IN),
                          highlight && ["ring-2", REACTION_RING[highlight]],
                          "transition-shadow duration-[var(--duration-standard)] ease-standard",
                        )}
                      >
                        {item.text}
                      </BubbleContent>
                      {message && kinds.length > 0 ? (
                        <BubbleReactions
                          side="bottom"
                          align={out ? "end" : "start"}
                          className="ring-surface-container"
                        >
                          <ReactionChips
                            kinds={kinds}
                            onToggle={(kind) => toggleReaction(message, kind)}
                          />
                        </BubbleReactions>
                      ) : null}
                    </Bubble>
                  </SmsMessageContextMenu>
                  {message ? (
                    <ReactionAddButton
                      active={kinds}
                      onToggle={(kind) => toggleReaction(message, kind)}
                      align={out ? "end" : "start"}
                    />
                  ) : null}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Group footer: the timestamp, and for outbound the send status
// -----------------------------------------------------------------------------

function GroupFooter({
  group,
  locale,
  onRetrySend,
  onDismissSend,
}: {
  group: ThreadBubbleGroup;
  locale: string;
  onRetrySend: (clientId: string) => void;
  onDismissSend: (clientId: string) => void;
}) {
  const { t } = useTranslation("cellular");
  const pending = group.pending;

  if (group.side !== "out") {
    return (
      <span className="text-on-surface-variant text-[0.65625rem] tabular-nums">
        {formatClock(group.epochMs, locale)}
      </span>
    );
  }

  if (pending?.state === "queued" || pending?.state === "sending") {
    return (
      <span
        aria-live="polite"
        className="text-on-surface-variant flex items-center gap-1.5 text-[0.65625rem]"
      >
        <MaterialSymbol
          name="progress_activity"
          size={13}
          className="motion-safe:animate-spin"
        />
        {t("sms.center.send.sending")}
      </span>
    );
  }

  if (pending?.state === "failed" || group.serverFailed) {
    return (
      <span
        aria-live="polite"
        className="flex flex-wrap items-center justify-end gap-1.5 text-[0.65625rem]"
      >
        <MaterialSymbol
          name="cancel"
          size={13}
          className="text-destructive-on-surface"
        />
        <span className="text-destructive-on-surface font-semibold">
          {t("sms.center.send.failed")}
        </span>
        {/*
          Retry/discard are optimistic-send-only affordances: they act on a
          `PendingSmsSend` (`onRetrySend`/`onDismissSend` both take a
          `clientId`). A server-recorded failure has no client id and no local
          queue entry to retry or drop, so it renders read-only: the status
          line without either button. It can still be deleted from the
          bubble's menu.
        */}
        {pending ? (
          <>
            <Button
              type="button"
              variant="tonal-destructive"
              size="xs"
              onClick={() => onRetrySend(pending.clientId)}
            >
              {t("sms.center.send.retry")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onDismissSend(pending.clientId)}
            >
              {t("sms.center.send.discard")}
            </Button>
          </>
        ) : null}
      </span>
    );
  }

  return (
    <span className="text-on-surface-variant flex items-center gap-1.5 text-[0.65625rem] tabular-nums">
      {/* "Sent", never "Delivered": a submission acknowledgement is not a
          delivery receipt, and this interface does not get to claim one. */}
      <MaterialSymbol name="done_all" size={13} />
      {t("sms.center.send.sent_at", {
        time: formatClock(group.epochMs, locale),
      })}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Phishing warning row
// -----------------------------------------------------------------------------
// Attached under any received bubble whose body contains a link-shaped
// substring (`containsSuspiciousLink`, `sms-format.ts`), the same way
// `CodeChip` attaches under a one-time-code bubble. A sender ID is spoofable,
// so a recognised name or logo is never proof of origin. Sent messages never
// get this row; `buildGroups` only sets `hasLink` for `side === "in"`.

function LinkWarning({
  senderTitle,
  hasLogo,
}: {
  senderTitle: string;
  hasLogo: boolean;
}) {
  const { t } = useTranslation("cellular");
  return (
    <div
      role="note"
      className="bg-warning-container text-on-warning-container rounded-tile mt-1.5 flex max-w-[80%] items-start gap-1.5 self-start px-3 py-1.5 text-[0.71875rem] leading-snug font-medium @2xl/pane:max-w-[66%]"
    >
      <MaterialSymbol name="warning" size={14} className="mt-px flex-none" />
      <span>
        {hasLogo
          ? t("sms.center.phishing.with_logo", { name: senderTitle })
          : t("sms.center.phishing.generic")}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// One-time code chip
// -----------------------------------------------------------------------------

function CodeChip({ code }: { code: string }) {
  const { t } = useTranslation("cellular");
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    const ok = await copyText(code);
    if (ok) {
      setCopied(true);
      toast.success(t("sms.center.code.copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(t("sms.center.toast.copy_failed"));
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="border-outline bg-surface text-primary-on-surface rounded-pill focus-visible:ring-ring focus-visible:ring-offset-surface-container mt-1.5 flex h-8 items-center gap-2 self-start border pr-3 pl-3.5 text-[0.78125rem] font-bold outline-none focus-visible:ring-[3px] focus-visible:ring-offset-2 pointer-coarse:h-11"
    >
      <span className="font-mono tracking-[0.08em] tabular-nums">{code}</span>
      <span aria-hidden="true" className="bg-border h-3.5 w-px" />
      <MaterialSymbol name={copied ? "check" : "content_copy"} size={14} />
      <span>
        {copied ? t("sms.center.code.copied") : t("sms.center.code.copy")}
      </span>
    </button>
  );
}
