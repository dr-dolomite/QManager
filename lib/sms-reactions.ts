// =============================================================================
// sms-reactions — pure model for per-message reactions and pins
// =============================================================================
// No React, no storage: the hook (`hooks/use-sms-reactions.ts`) owns both. This
// module is the part that can be tested without a browser.
//
// A message carries a SET of reactions (heart, star, memo, pin), ordered
// canonically so the chips never reshuffle depending on click order. `pin` is a
// reaction like the others; what makes it special is that the conversation
// lifts every pinned message into the pinned strip above the thread, newest pin
// first, so the entry also remembers WHEN it was pinned.
//
// Entries are keyed by `smsFingerprint` (`hooks/use-sms-read-state.ts`), the
// only stable message identity the browser has. The map keeps insertion order
// (a plain object would sort integer-looking base-36 keys numerically), and a
// touched entry moves to the end, so the size cap drops the least recently used.
// =============================================================================

export const SMS_REACTION_KINDS = ["heart", "star", "memo", "pin"] as const;

export type SmsReactionKind = (typeof SMS_REACTION_KINDS)[number];

export interface ReactionEntry {
  /** Canonical order, no duplicates, never empty (an empty entry is deleted). */
  readonly r: readonly SmsReactionKind[];
  /** Epoch ms the message was pinned. Present exactly while `r` has `pin`. */
  readonly p?: number;
}

export type ReactionMap = ReadonlyMap<string, ReactionEntry>;

/** Entries kept in storage. Past this the least recently touched go first. */
export const MAX_REACTION_ENTRIES = 500;

export const EMPTY_REACTIONS: ReactionMap = new Map();

function isKind(x: unknown): x is SmsReactionKind {
  return (SMS_REACTION_KINDS as readonly unknown[]).includes(x);
}

function canonical(kinds: Iterable<SmsReactionKind>): SmsReactionKind[] {
  const have = new Set(kinds);
  return SMS_REACTION_KINDS.filter((k) => have.has(k));
}

/**
 * Flip one reaction on one message. Returns the next map (the input is never
 * mutated, so a store can hand it straight to React) and whether the reaction
 * is ON afterwards.
 */
export function toggleReaction(
  map: ReactionMap,
  fingerprint: string,
  kind: SmsReactionKind,
  now: number,
): { map: ReactionMap; on: boolean } {
  const prev = map.get(fingerprint);
  const had = prev?.r.includes(kind) ?? false;
  const kinds = canonical([
    ...(prev?.r ?? []).filter((k) => k !== kind),
    ...(had ? [] : [kind]),
  ]);

  const next = new Map(map);
  next.delete(fingerprint);
  if (kinds.length > 0) {
    const pinnedAt = kinds.includes("pin")
      ? kind === "pin"
        ? now
        : prev?.p
      : undefined;
    next.set(
      fingerprint,
      pinnedAt === undefined ? { r: kinds } : { r: kinds, p: pinnedAt },
    );
  }

  // Past the cap the least recently touched entry goes, but never a pinned
  // one: silently unpinning a message because newer reactions piled up would
  // lose the thing the reader asked to keep.
  while (next.size > MAX_REACTION_ENTRIES) {
    let evicted = false;
    for (const [key, entry] of next) {
      if (entry.r.includes("pin")) continue;
      next.delete(key);
      evicted = true;
      break;
    }
    if (!evicted) break;
  }
  return { map: next, on: !had };
}

/** Drop one message's entry outright (the message itself was deleted). */
export function forgetReactions(
  map: ReactionMap,
  fingerprint: string,
): ReactionMap {
  if (!map.has(fingerprint)) return map;
  const next = new Map(map);
  next.delete(fingerprint);
  return next;
}

export function serializeReactions(map: ReactionMap): string {
  return JSON.stringify([...map.entries()]);
}

/**
 * Read what `serializeReactions` wrote. Anything malformed is skipped rather
 * than rejected as a whole: storage is best-effort and may have been edited,
 * truncated or written by a newer build.
 */
export function parseReactions(raw: string | null): ReactionMap {
  if (!raw) return EMPTY_REACTIONS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_REACTIONS;
  }
  if (!Array.isArray(parsed)) return EMPTY_REACTIONS;

  const out = new Map<string, ReactionEntry>();
  for (const row of parsed) {
    if (!Array.isArray(row) || row.length !== 2) continue;
    const [fp, entry] = row as [unknown, unknown];
    if (typeof fp !== "string" || typeof entry !== "object" || entry === null) {
      continue;
    }
    const { r, p } = entry as { r?: unknown; p?: unknown };
    if (!Array.isArray(r)) continue;
    const kinds = canonical(r.filter(isKind));
    if (kinds.length === 0) continue;
    out.set(
      fp,
      kinds.includes("pin") && typeof p === "number" && Number.isFinite(p)
        ? { r: kinds, p }
        : { r: kinds },
    );
  }
  return out.size === 0 ? EMPTY_REACTIONS : out;
}
