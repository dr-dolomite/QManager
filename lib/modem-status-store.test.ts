import { describe, expect, it } from "bun:test";

import type { ModemStatus } from "@/types/modem-status";
import {
  createModemStatusStore,
  type ModemStatusEvent,
} from "./modem-status-store";

/** A fake clock plus interval scheduler the test advances by hand. */
function harness() {
  let nowMs = 1_000_000;
  let fetches = 0;
  let fail = false;
  const intervals = new Map<number, { fn: () => void; ms: number; next: number }>();
  let nextId = 1;
  let hidden = false;
  const visListeners = new Set<() => void>();

  const store = createModemStatusStore({
    fetchStatus: async () => {
      fetches += 1;
      if (fail) throw new Error("HTTP 502: Bad Gateway");
      return { timestamp: Math.floor(nowMs / 1000) } as ModemStatus;
    },
    now: () => nowMs,
    setInterval: (fn, ms) => {
      const id = nextId++;
      intervals.set(id, { fn, ms, next: nowMs + ms });
      return id;
    },
    clearInterval: (id) => {
      intervals.delete(id as number);
    },
    visibility: {
      isHidden: () => hidden,
      onChange: (fn) => {
        visListeners.add(fn);
        return () => visListeners.delete(fn);
      },
    },
  });

  /** Let pending fetch promises settle. */
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  /** Advance the clock in 100 ms steps, firing due intervals and settling fetches. */
  const advance = async (ms: number) => {
    const end = nowMs + ms;
    while (nowMs < end) {
      nowMs += 100;
      for (const iv of Array.from(intervals.values())) {
        if (iv.next <= nowMs) {
          iv.next += iv.ms;
          iv.fn();
        }
      }
      await flush();
    }
  };

  return {
    store,
    flush,
    advance,
    fetches: () => fetches,
    activeIntervals: () => intervals.size,
    setFail: (v: boolean) => {
      fail = v;
    },
    setHidden: (v: boolean) => {
      hidden = v;
      for (const fn of Array.from(visListeners)) fn();
    },
    visibilityListeners: () => visListeners.size,
  };
}

function collector() {
  const events: ModemStatusEvent[] = [];
  return { events, listener: (e: ModemStatusEvent) => events.push(e) };
}

describe("modem status store", () => {
  it("runs one loop for two consumers at the fastest interval", async () => {
    const h = harness();
    const dash = collector();
    const side = collector();
    h.store.subscribe(2000, dash.listener);
    h.store.subscribe(15_000, side.listener);
    await h.flush();

    // Both mounts in the same tick share the one in-flight fetch.
    expect(h.fetches()).toBe(1);
    expect(dash.events.length).toBe(1);
    expect(side.events.length).toBe(1);
    expect(h.activeIntervals()).toBe(1);

    await h.advance(30_000);
    // 15 base ticks, not 15 + 2 from a second loop.
    expect(h.fetches()).toBe(16);
    expect(dash.events.length).toBe(16);
    // The slow consumer keeps its own cadence (every ~15 s).
    expect(side.events.length).toBe(3);
  });

  it("serves a late subscriber at once, then at its own cadence", async () => {
    const h = harness();
    const dash = collector();
    h.store.subscribe(2000, dash.listener);
    await h.flush();
    await h.advance(3000);

    const watchdog = collector();
    h.store.subscribe(5000, watchdog.listener);
    await h.flush();
    expect(watchdog.events.length).toBe(1);

    await h.advance(20_000);
    // Delivered within half a base tick of every 5 s: roughly every 4-6 s.
    expect(watchdog.events.length).toBeGreaterThanOrEqual(4);
    expect(watchdog.events.length).toBeLessThanOrEqual(6);
  });

  it("refresh delivers to the caller regardless of cadence", async () => {
    const h = harness();
    const side = collector();
    const sub = h.store.subscribe(15_000, side.listener);
    await h.flush();
    expect(side.events.length).toBe(1);

    sub.refresh();
    await h.flush();
    expect(side.events.length).toBe(2);
  });

  it("slows down and stops as consumers leave", async () => {
    const h = harness();
    const dash = h.store.subscribe(2000, () => {});
    const side = h.store.subscribe(15_000, () => {});
    await h.flush();

    dash.unsubscribe();
    const before = h.fetches();
    await h.advance(30_000);
    expect(h.fetches() - before).toBe(2);

    side.unsubscribe();
    expect(h.activeIntervals()).toBe(0);
    expect(h.store.subscriberCount()).toBe(0);
  });

  it("reports errors and staleness per landed response", async () => {
    const h = harness();
    const dash = collector();
    h.store.subscribe(2000, dash.listener);
    await h.flush();
    expect(dash.events[0]).toMatchObject({ kind: "data", isStale: false });

    h.setFail(true);
    await h.advance(2000);
    expect(dash.events.at(-1)).toEqual({
      kind: "error",
      message: "HTTP 502: Bad Gateway",
    });
  });

  it("stops polling while hidden and fetches at once when shown", async () => {
    const h = harness();
    const dash = collector();
    const side = collector();
    h.store.subscribe(2000, dash.listener);
    h.store.subscribe(15_000, side.listener);
    await h.flush();
    expect(h.fetches()).toBe(1);

    h.setHidden(true);
    expect(h.activeIntervals()).toBe(0);
    await h.advance(60_000);
    expect(h.fetches()).toBe(1);

    const dashBefore = dash.events.length;
    const sideBefore = side.events.length;
    h.setHidden(false);
    await h.flush();
    expect(h.fetches()).toBe(2);
    // Every subscriber is served on return, whatever its cadence.
    expect(dash.events.length).toBe(dashBefore + 1);
    expect(side.events.length).toBe(sideBefore + 1);
    expect(h.activeIntervals()).toBe(1);

    await h.advance(2000);
    expect(h.fetches()).toBe(3);
  });

  it("defers the first fetch of a background mount until shown", async () => {
    const h = harness();
    h.setHidden(true);
    const dash = collector();
    h.store.subscribe(2000, dash.listener);
    await h.advance(10_000);
    expect(h.fetches()).toBe(0);

    h.setHidden(false);
    await h.flush();
    expect(dash.events.length).toBe(1);
  });

  it("still serves an explicit refresh while hidden", async () => {
    const h = harness();
    const dash = collector();
    const sub = h.store.subscribe(2000, dash.listener);
    await h.flush();
    h.setHidden(true);
    sub.refresh();
    await h.flush();
    expect(h.fetches()).toBe(2);
    expect(dash.events.length).toBe(2);
  });

  it("drops its visibility listener when the last consumer leaves", async () => {
    const h = harness();
    const a = h.store.subscribe(2000, () => {});
    const b = h.store.subscribe(15_000, () => {});
    expect(h.visibilityListeners()).toBe(1);
    a.unsubscribe();
    expect(h.visibilityListeners()).toBe(1);
    b.unsubscribe();
    expect(h.visibilityListeners()).toBe(0);
  });
});
