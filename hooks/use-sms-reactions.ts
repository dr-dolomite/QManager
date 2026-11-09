"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  EMPTY_REACTIONS,
  forgetReactions,
  parseReactions,
  serializeReactions,
  toggleReaction,
  type ReactionMap,
  type SmsReactionKind,
} from "@/lib/sms-reactions";
import type { SmsMessage } from "@/types/sms";
import { smsFingerprint } from "@/hooks/use-sms-read-state";

// =============================================================================
// useSmsReactions — client-side reactions and pins for SMS messages
// =============================================================================
// The modem has no concept of either, so like read state they live in this
// browser's localStorage, keyed by the message fingerprint. Trade-off (accepted,
// same as `use-sms-read-state.ts`): per-browser, resets if storage is cleared.
//
// A module-level store read through `useSyncExternalStore` rather than a state
// hook per consumer: the conversation body, the reaction picker and the pinned
// strip all read it, and a second tab's change arrives through the `storage`
// event. Nothing here sets state from an effect.
// =============================================================================

const STORAGE_KEY = "qmanager.sms.reactions.v1";

let cache: ReactionMap | null = null;
const listeners = new Set<() => void>();

function readStore(): ReactionMap {
  if (cache) return cache;
  if (typeof window === "undefined") return EMPTY_REACTIONS;
  try {
    cache = parseReactions(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    cache = EMPTY_REACTIONS;
  }
  return cache;
}

function commit(next: ReactionMap) {
  cache = next;
  try {
    if (next.size === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, serializeReactions(next));
  } catch {
    // Quota exceeded or storage disabled: reactions are best-effort, the
    // in-memory copy still serves this tab.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const NO_KINDS: readonly SmsReactionKind[] = [];

export interface UseSmsReactionsReturn {
  /** The message's reactions in canonical order. Stable empty array when none. */
  reactionsOf: (msg: SmsMessage) => readonly SmsReactionKind[];
  /** Epoch ms the message was pinned, or undefined while it is not. */
  pinnedAtOf: (msg: SmsMessage) => number | undefined;
  /** Flip one reaction. Returns true when it is ON afterwards. */
  toggle: (msg: SmsMessage, kind: SmsReactionKind) => boolean;
  /** Forget everything about a message (it was deleted). */
  forget: (msg: SmsMessage) => void;
}

export function useSmsReactions(): UseSmsReactionsReturn {
  const map = useSyncExternalStore(subscribe, readStore, () => EMPTY_REACTIONS);

  const reactionsOf = useCallback(
    (msg: SmsMessage) => map.get(smsFingerprint(msg))?.r ?? NO_KINDS,
    [map],
  );

  const pinnedAtOf = useCallback(
    (msg: SmsMessage) => map.get(smsFingerprint(msg))?.p,
    [map],
  );

  const toggle = useCallback((msg: SmsMessage, kind: SmsReactionKind) => {
    const { map: next, on } = toggleReaction(
      readStore(),
      smsFingerprint(msg),
      kind,
      Date.now(),
    );
    commit(next);
    return on;
  }, []);

  const forget = useCallback((msg: SmsMessage) => {
    const current = readStore();
    const next = forgetReactions(current, smsFingerprint(msg));
    if (next !== current) commit(next);
  }, []);

  return useMemo(
    () => ({ reactionsOf, pinnedAtOf, toggle, forget }),
    [reactionsOf, pinnedAtOf, toggle, forget],
  );
}
