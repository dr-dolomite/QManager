"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { authFetch } from "@/lib/auth-fetch";
import {
  createLiveSignalStore,
  INITIAL_LIVE_SNAPSHOT,
  type LiveFileResult,
  type LiveSignalSubscription,
} from "@/lib/live-signal-store";
import type {
  LiveFile,
  LiveLeaseResult,
  LiveSignalSnapshot,
  LiveTier,
} from "@/types/live-signal";

// =============================================================================
// useLiveSignal: real-time serving-cell signal from the broker's live file
// =============================================================================
// All mounted instances share ONE lease and ONE poll (lib/live-signal-store.ts).
// The tier is the fastest instance's (`aim` beats `watch`). Polling, renewal
// and failures are silent: no toasts, `unavailable` is just a state.
//
//   const { state, latest, samples, receivedAtMs } = useLiveSignal({ tier: "aim" });
//
// States: connecting | live | stale | paused (tab hidden) | unavailable.
// =============================================================================

const LEASE_ENDPOINT = "/cgi-bin/quecmanager/cellular/live_signal.sh";
const LIVE_URL_PREFIX = "/qmlive/";

interface LeaseEnvelope {
  success?: boolean;
  available?: boolean;
  url?: string;
  period_ms?: number;
  renew_s?: number;
  error?: string;
}

async function lease(tier: LiveTier): Promise<LiveLeaseResult> {
  const response = await authFetch(`${LEASE_ENDPOINT}?tier=${tier}`, {
    method: "POST",
  });
  if (!response.ok) return { kind: "error" };
  let body: LeaseEnvelope;
  try {
    body = (await response.json()) as LeaseEnvelope;
  } catch {
    return { kind: "error" };
  }
  if (body.success !== true) return { kind: "error", code: body.error };
  if (body.available !== true) return { kind: "unavailable" };
  if (
    typeof body.url !== "string" ||
    !body.url.startsWith(LIVE_URL_PREFIX) ||
    typeof body.period_ms !== "number" ||
    typeof body.renew_s !== "number"
  ) {
    return { kind: "error", code: "bad_lease" };
  }
  return {
    kind: "ok",
    url: body.url,
    periodMs: body.period_ms,
    renewS: body.renew_s,
  };
}

async function fetchFile(
  url: string,
  signal: AbortSignal,
): Promise<LiveFileResult> {
  // Static file behind a capability url: no cookies, never cached.
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    signal,
  });
  if (!response.ok) return { status: response.status, file: null };
  try {
    const body: unknown = await response.json();
    const valid =
      typeof body === "object" &&
      body !== null &&
      (body as { v?: unknown }).v === 1 &&
      Array.isArray((body as { samples?: unknown }).samples);
    return { status: response.status, file: valid ? (body as LiveFile) : null };
  } catch {
    return { status: response.status, file: null };
  }
}

const noopUnsubscribe = () => {};

const liveSignalStore = createLiveSignalStore({
  lease,
  fetchFile,
  // Clock reads happen in store timers and responses, never during render.
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  isVisible: () =>
    typeof document === "undefined" || document.visibilityState === "visible",
  onVisibilityChange: (cb) => {
    if (typeof document === "undefined") return noopUnsubscribe;
    const handler = () => cb(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
  onInput: (cb) => {
    if (typeof window === "undefined") return noopUnsubscribe;
    const events = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
    for (const name of events) {
      window.addEventListener(name, cb, { passive: true });
    }
    return () => {
      for (const name of events) window.removeEventListener(name, cb);
    };
  },
});

export interface UseLiveSignalOptions {
  /** `aim` = 200 ms (alignment), `watch` = 1 s. */
  tier: LiveTier;
  /** Whether to hold a lease (default: true). */
  enabled?: boolean;
}

export type UseLiveSignalReturn = Pick<
  LiveSignalSnapshot,
  "state" | "latest" | "samples" | "receivedAtMs"
>;

const getServerSnapshot = () => INITIAL_LIVE_SNAPSHOT;

export function useLiveSignal({
  tier,
  enabled = true,
}: UseLiveSignalOptions): UseLiveSignalReturn {
  const snapshot = useSyncExternalStore(
    liveSignalStore.listen,
    liveSignalStore.getSnapshot,
    getServerSnapshot,
  );

  // One subscription per `enabled`: a tier change must not reset the ring.
  const subscriptionRef = useRef<LiveSignalSubscription | null>(null);
  const tierRef = useRef(tier);
  useEffect(() => {
    tierRef.current = tier;
    subscriptionRef.current?.setTier(tier);
  }, [tier]);

  useEffect(() => {
    if (!enabled) return;
    const subscription = liveSignalStore.subscribe(tierRef.current);
    subscriptionRef.current = subscription;
    return () => {
      subscription.unsubscribe();
      if (subscriptionRef.current === subscription) {
        subscriptionRef.current = null;
      }
    };
  }, [enabled]);

  return {
    state: snapshot.state,
    latest: snapshot.latest,
    samples: snapshot.samples,
    receivedAtMs: snapshot.receivedAtMs,
  };
}
