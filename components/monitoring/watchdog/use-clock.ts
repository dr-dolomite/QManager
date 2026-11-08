"use client";

import { useSyncExternalStore } from "react";

import { startVisibleInterval } from "@/lib/visible-interval";

// A shared one-second clock for the countdowns on this page (step wait, hold-off,
// baseband hold, failback, "since 14:02"). One interval serves every subscriber
// and runs only while the tab is visible, so a hidden tab costs nothing.
//
// Both readings are taken together in the tick, never during render: the
// monotonic one (`performance.now()`) counts a deadline down between polls, and
// the wall one (`Date.now()`) turns "N seconds from now" into a time of day.

export interface ClockSnapshot {
  /** `performance.now()` at the last tick. */
  perfMs: number;
  /** `Date.now()` at the last tick. */
  epochMs: number;
}

const SERVER_SNAPSHOT: ClockSnapshot = { perfMs: 0, epochMs: 0 };

let snapshot: ClockSnapshot | null = null;
let stop: (() => void) | null = null;
const listeners = new Set<() => void>();

const read = (): ClockSnapshot => ({
  perfMs: performance.now(),
  epochMs: Date.now(),
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    snapshot = read();
    stop = startVisibleInterval(
      () => {
        snapshot = read();
        listeners.forEach((l) => l());
      },
      1000,
      { immediate: false },
    );
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stop) {
      stop();
      stop = null;
    }
  };
}

function getSnapshot(): ClockSnapshot {
  // The first render happens before the first subscription; read once so it is
  // not a 1970 time of day. The value then stays put until the next tick.
  if (snapshot === null) snapshot = read();
  return snapshot;
}

/** The page clock; re-renders its caller once a second while the tab is visible. */
export function useClock(): ClockSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}
