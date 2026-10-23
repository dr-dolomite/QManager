import { describe, expect, it } from "bun:test";

import type {
  LiveFile,
  LiveLeaseResult,
  LiveSample,
  LiveTier,
} from "@/types/live-signal";
import {
  createLiveSignalStore,
  LIVE_IDLE_DEMOTE_MS,
  LIVE_RING_SIZE,
  type LiveFileResult,
} from "./live-signal-store";

const sample = (seq: number, over: Partial<LiveSample> = {}): LiveSample => ({
  seq,
  t: seq * 200,
  reg: true,
  rsrp: -955,
  rsrq: -85,
  rssi: -580,
  pci: 295,
  earfcn: 150,
  band: "B1",
  bw: 20,
  ca: null,
  ...over,
});

const file = (
  run: number,
  seqs: number[],
  over: Partial<LiveFile> = {},
): LiveFile => ({
  v: 1,
  run,
  seq: seqs[seqs.length - 1] ?? 0,
  period_ms: 200,
  qmi_state: "up",
  ssr_count: 0,
  scan: false,
  samples: seqs.map((s) => sample(s)),
  ...over,
});

const okLease = (
  url = "/qmlive/a.json",
  periodMs = 200,
): LiveLeaseResult => ({ kind: "ok", url, periodMs, renewS: 5 });

async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function harness() {
  let nowMs = 1_000_000;
  let visible = true;
  const timers = new Map<number, { fn: () => void; at: number }>();
  let nextId = 1;
  const visListeners = new Set<(v: boolean) => void>();
  const inputListeners = new Set<() => void>();

  const leases: LiveTier[] = [];
  const polls: string[] = [];
  let leaseResult: LiveLeaseResult = okLease();
  let leaseGate: Promise<LiveLeaseResult> | null = null;
  let fileGate: Promise<LiveFileResult> | null = null;
  let fileResult: (url: string) => LiveFileResult = () => ({
    status: 200,
    file: file(1, [1]),
  });

  const store = createLiveSignalStore({
    lease: async (tier) => {
      leases.push(tier);
      return leaseGate ?? leaseResult;
    },
    fetchFile: async (url) => {
      polls.push(url);
      return fileGate ?? fileResult(url);
    },
    now: () => nowMs,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: nowMs + ms });
      return id;
    },
    clearTimeout: (h) => {
      timers.delete(h as number);
    },
    isVisible: () => visible,
    onVisibilityChange: (cb) => {
      visListeners.add(cb);
      return () => visListeners.delete(cb);
    },
    onInput: (cb) => {
      inputListeners.add(cb);
      return () => inputListeners.delete(cb);
    },
  });

  /** Advance the fake clock, firing due timers in order. */
  const advance = async (ms: number) => {
    const end = nowMs + ms;
    for (;;) {
      let nextId2: number | null = null;
      let nextAt = Infinity;
      for (const [id, t] of timers) {
        if (t.at <= end && t.at < nextAt) {
          nextAt = t.at;
          nextId2 = id;
        }
      }
      if (nextId2 === null) break;
      const t = timers.get(nextId2)!;
      timers.delete(nextId2);
      nowMs = Math.max(nowMs, t.at);
      t.fn();
      await flush();
    }
    nowMs = end;
  };

  return {
    store,
    leases,
    polls,
    timerCount: () => timers.size,
    holdLease: () => {
      let release!: (r: LiveLeaseResult) => void;
      leaseGate = new Promise((res) => (release = res));
      return (r: LiveLeaseResult) => {
        leaseGate = null;
        release(r);
      };
    },
    holdFile: () => {
      fileGate = new Promise(() => {});
    },
    releaseFileHold: () => {
      fileGate = null;
    },
    setLease: (r: LiveLeaseResult) => (leaseResult = r),
    setFile: (f: (url: string) => LiveFileResult) => (fileResult = f),
    advance,
    setVisible: async (v: boolean) => {
      visible = v;
      for (const l of Array.from(visListeners)) l(v);
      await flush();
    },
    input: async () => {
      for (const l of Array.from(inputListeners)) l();
      await flush();
    },
    inputListenerCount: () => inputListeners.size,
  };
}

describe("live signal store", () => {
  it("leases on subscribe, polls, and dedupes by seq", async () => {
    const h = harness();
    h.setFile(() => ({ status: 200, file: file(1, [1, 2, 3]) }));
    h.store.subscribe("aim");
    await flush();
    expect(h.leases).toEqual(["aim"]);
    expect(h.polls).toEqual(["/qmlive/a.json"]);
    expect(h.store.getSnapshot().samples.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(h.store.getSnapshot().state).toBe("live");

    h.setFile(() => ({ status: 200, file: file(1, [2, 3, 4]) }));
    await h.advance(200);
    expect(h.store.getSnapshot().samples.map((s) => s.seq)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(h.store.getSnapshot().latest?.seq).toBe(4);
  });

  it("renews the lease every renew_s", async () => {
    const h = harness();
    h.store.subscribe("watch");
    await flush();
    await h.advance(5000);
    await h.advance(5000);
    expect(h.leases.length).toBe(3);
  });

  it("caps the ring at 150 samples", async () => {
    const h = harness();
    const seqs = Array.from({ length: 16 }, (_, i) => i + 1);
    h.store.subscribe("aim");
    for (let batch = 0; batch < 12; batch++) {
      const s = seqs.map((x) => x + batch * 16);
      h.setFile(() => ({ status: 200, file: file(1, s) }));
      await h.advance(200);
    }
    await flush();
    expect(h.store.getSnapshot().samples.length).toBe(LIVE_RING_SIZE);
    expect(h.store.getSnapshot().latest?.seq).toBe(192);
  });

  it("resets the ring when run changes", async () => {
    const h = harness();
    h.setFile(() => ({ status: 200, file: file(1, [10, 11]) }));
    h.store.subscribe("aim");
    await flush();
    h.setFile(() => ({ status: 200, file: file(2, [1, 2]) }));
    await h.advance(200);
    expect(h.store.getSnapshot().samples.map((s) => s.seq)).toEqual([1, 2]);
  });

  it("follows a new url from a later lease", async () => {
    const h = harness();
    h.store.subscribe("aim");
    await flush();
    h.setLease(okLease("/qmlive/b.json"));
    await h.advance(5000);
    await h.advance(200);
    expect(h.polls[h.polls.length - 1]).toBe("/qmlive/b.json");
    expect(h.store.getSnapshot().state).not.toBe("unavailable");
  });

  it("re-leases at once on 404, then backs off 1/2/5 s, then unavailable", async () => {
    const h = harness();
    h.store.subscribe("aim");
    await flush();
    h.setFile(() => ({ status: 404, file: null }));
    await h.advance(200); // confirmed url now 404s: a real failure
    // failure 1 -> immediate re-lease (zero-delay timer)
    await h.advance(0);
    expect(h.leases.length).toBe(2);
    await h.advance(999);
    expect(h.leases.length).toBe(2);
    await h.advance(1); // 1 s
    expect(h.leases.length).toBe(3);
    await h.advance(2000);
    expect(h.leases.length).toBe(4);
    await h.advance(5000);
    expect(h.leases.length).toBe(5);
    expect(h.store.getSnapshot().state).toBe("unavailable");
    const pollsAfter = h.polls.length;
    await h.advance(60_000);
    expect(h.polls.length).toBe(pollsAfter);
    expect(h.leases.length).toBe(5);
    expect(h.timerCount()).toBe(1); // only the idle timer
  });

  it("recovers from unavailable when the tab becomes visible again", async () => {
    const h = harness();
    h.store.subscribe("watch");
    await flush();
    h.setFile(() => ({ status: 404, file: null }));
    await h.advance(20_000);
    expect(h.store.getSnapshot().state).toBe("unavailable");
    h.setFile(() => ({ status: 200, file: file(1, [1000]) }));
    await h.setVisible(false);
    await h.setVisible(true);
    expect(h.store.getSnapshot().state).toBe("live");
  });

  it("available:false is unavailable and does not poll", async () => {
    const h = harness();
    h.setLease({ kind: "unavailable" });
    h.store.subscribe("aim");
    await flush();
    expect(h.store.getSnapshot().state).toBe("unavailable");
    await h.advance(30_000);
    expect(h.polls.length).toBe(0);
    expect(h.leases.length).toBe(1);
  });

  it("lease errors back off like a 404", async () => {
    const h = harness();
    h.setLease({ kind: "error", code: "lease_failed" });
    h.store.subscribe("aim");
    await flush();
    await h.advance(0);
    expect(h.leases.length).toBe(2);
    await h.advance(1000 + 2000 + 5000);
    expect(h.store.getSnapshot().state).toBe("unavailable");
  });

  it("hidden tab stops polling and renewal; visible resumes with a lease", async () => {
    const h = harness();
    h.store.subscribe("aim");
    await flush();
    await h.setVisible(false);
    expect(h.store.getSnapshot().state).toBe("paused");
    const leases = h.leases.length;
    const polls = h.polls.length;
    await h.advance(30_000);
    expect(h.leases.length).toBe(leases);
    expect(h.polls.length).toBe(polls);
    await h.setVisible(true);
    expect(h.leases.length).toBe(leases + 1);
    expect(h.polls.length).toBe(polls + 1);
  });

  it("goes stale without new seq, on qmi down, reg false and scan", async () => {
    const h = harness();
    h.setFile(() => ({ status: 200, file: file(1, [1]) }));
    h.store.subscribe("aim");
    await flush();
    expect(h.store.getSnapshot().state).toBe("live");
    // same seq forever: no new samples for > 3 periods
    await h.advance(800);
    expect(h.store.getSnapshot().state).toBe("stale");

    h.setFile(() => ({
      status: 200,
      file: file(1, [2], { qmi_state: "down" }),
    }));
    await h.advance(200);
    expect(h.store.getSnapshot().state).toBe("stale");

    h.setFile(() => ({ status: 200, file: file(1, [3]) }));
    await h.advance(200);
    expect(h.store.getSnapshot().state).toBe("live");

    h.setFile(() => ({ status: 200, file: file(1, [4], { scan: true }) }));
    await h.advance(200);
    expect(h.store.getSnapshot().state).toBe("stale");

    const f = file(1, [5]);
    f.samples = [sample(5, { reg: false, rsrp: null })];
    h.setFile(() => ({ status: 200, file: f }));
    await h.advance(200);
    expect(h.store.getSnapshot().state).toBe("stale");
  });

  it("demotes aim to watch after idle and restores on input", async () => {
    const h = harness();
    h.store.subscribe("aim");
    await flush();
    expect(h.store.leasedTier()).toBe("aim");
    await h.advance(LIVE_IDLE_DEMOTE_MS);
    expect(h.leases[h.leases.length - 1]).toBe("watch");
    await h.input();
    expect(h.leases[h.leases.length - 1]).toBe("aim");
  });

  it("input before the deadline postpones the demotion", async () => {
    const h = harness();
    h.store.subscribe("aim");
    await flush();
    await h.advance(LIVE_IDLE_DEMOTE_MS - 1000);
    await h.input();
    await h.advance(2000);
    expect(h.leases.includes("watch")).toBe(false);
    await h.advance(LIVE_IDLE_DEMOTE_MS);
    expect(h.leases[h.leases.length - 1]).toBe("watch");
  });

  it("aim beats watch with two subscribers; dropping aim re-leases watch", async () => {
    const h = harness();
    const watch = h.store.subscribe("watch");
    await flush();
    expect(h.leases).toEqual(["watch"]);
    const aim = h.store.subscribe("aim");
    await flush();
    expect(h.leases).toEqual(["watch", "aim"]);
    expect(h.store.subscriberCount()).toBe(2);
    aim.unsubscribe();
    await flush();
    expect(h.leases).toEqual(["watch", "aim", "watch"]);
    watch.unsubscribe();
  });

  it("last unsubscribe stops everything and resets", async () => {
    const h = harness();
    const a = h.store.subscribe("aim");
    await flush();
    expect(h.store.getSnapshot().samples.length).toBe(1);
    a.unsubscribe();
    expect(h.timerCount()).toBe(0);
    expect(h.inputListenerCount()).toBe(0);
    expect(h.store.getSnapshot().samples.length).toBe(0);
    const polls = h.polls.length;
    await h.advance(30_000);
    expect(h.polls.length).toBe(polls);
  });

  it("notifies listeners only when the snapshot changes", async () => {
    const h = harness();
    let calls = 0;
    h.store.listen(() => (calls += 1));
    h.store.subscribe("aim");
    await flush();
    const afterFirst = calls;
    expect(afterFirst).toBeGreaterThan(0);
    // identical file, same seq, still live: no notification
    await h.advance(200);
    expect(calls).toBe(afterFirst);
  });

  it("treats a 404 on a fresh url as not published yet", async () => {
    const h = harness();
    let calls = 0;
    h.setFile(() =>
      ++calls === 1
        ? { status: 404, file: null }
        : { status: 200, file: file(1, [1]) },
    );
    h.store.subscribe("aim");
    await flush();
    expect(h.store.getSnapshot().state).toBe("connecting");
    await h.advance(200);
    expect(h.leases.length).toBe(1);
    expect(h.store.getSnapshot().state).toBe("live");
  });

  it("counts 404s after the grace window", async () => {
    const h = harness();
    h.setFile(() => ({ status: 404, file: null }));
    h.store.subscribe("aim");
    await flush();
    await h.advance(2 * 200 + 500 + 200);
    expect(h.leases.length).toBeGreaterThan(1);
  });

  it("a 404 after a 200 is a real failure at once", async () => {
    const h = harness();
    h.store.subscribe("aim");
    await flush();
    h.setFile(() => ({ status: 404, file: null }));
    await h.advance(200);
    await h.advance(0);
    expect(h.leases.length).toBe(2);
  });

  it("a poll that never settles times out into the recovery path", async () => {
    const h = harness();
    h.holdFile();
    h.store.subscribe("aim");
    await flush();
    await h.advance(10_000);
    expect(h.leases.length).toBeGreaterThan(1);
    h.releaseFileHold();
    let n = 0;
    h.setFile(() => ({ status: 200, file: file(1, [++n]) }));
    await h.advance(10_000);
    expect(h.store.getSnapshot().state).toBe("live");
  });

  it("a failure during an in-flight lease leaves no orphan timer", async () => {
    const h = harness();
    const sub = h.store.subscribe("aim");
    await flush();
    const release = h.holdLease();
    await h.advance(5000); // renewal lease is now held open
    h.setFile(() => ({ status: 500, file: null }));
    await h.advance(200); // poll fails while the lease is in flight
    h.setFile(() => ({ status: 200, file: file(1, [9]) }));
    release(okLease());
    await flush();
    sub.unsubscribe();
    const leases = h.leases.length;
    expect(h.timerCount()).toBe(0);
    await h.advance(10_000);
    expect(h.leases.length).toBe(leases);
  });

  it("restarts polling when the url changed under a rejected poll", async () => {
    const h = harness();
    h.store.subscribe("aim");
    await flush();
    let n = 100;
    h.setFile(() => ({ status: 200, file: file(1, [++n]) }));
    h.setLease(okLease("/qmlive/c.json"));
    await h.advance(5000);
    await h.advance(400);
    expect(h.polls.includes("/qmlive/c.json")).toBe(true);
    expect(h.store.getSnapshot().state).toBe("live");
  });

  it("setTier changes the lease without resetting the ring", async () => {
    const h = harness();
    const sub = h.store.subscribe("watch");
    await flush();
    const count = h.store.getSnapshot().samples.length;
    sub.setTier("aim");
    await flush();
    expect(h.leases).toEqual(["watch", "aim"]);
    expect(h.store.getSnapshot().samples.length).toBe(count);
    sub.setTier("watch");
    await flush();
    expect(h.leases[h.leases.length - 1]).toBe("watch");
  });

  it("malformed 200 bodies are failures, not throws", async () => {
    const h = harness();
    h.setFile(() => ({
      status: 200,
      file: { v: 2, run: 1, samples: [] } as unknown as LiveFile,
    }));
    h.store.subscribe("aim");
    await flush();
    await h.advance(0);
    expect(h.store.getSnapshot().state).toBe("connecting");
    h.setFile(() => ({ status: 200, file: "nope" as unknown as LiveFile }));
    await h.advance(1000);
    expect(h.store.getSnapshot().latest).toBeNull();
  });

  it("unsubscribe and resubscribe during an in-flight lease is clean", async () => {
    const h = harness();
    const release = h.holdLease();
    const a = h.store.subscribe("aim");
    await flush();
    a.unsubscribe();
    h.store.subscribe("aim");
    await flush();
    release(okLease());
    await flush();
    expect(h.store.getSnapshot().state).toBe("live");
    expect(h.store.subscriberCount()).toBe(1);
  });

  it("a visibility flip during an in-flight lease ignores the stale result", async () => {
    const h = harness();
    const release = h.holdLease();
    h.store.subscribe("aim");
    await flush();
    await h.setVisible(false);
    release(okLease());
    await flush();
    expect(h.polls.length).toBe(0);
    expect(h.store.getSnapshot().state).toBe("paused");
    await h.advance(10_000);
    expect(h.polls.length).toBe(0);
  });

  it("re-tiering during an in-flight lease leases again afterwards", async () => {
    const h = harness();
    const release = h.holdLease();
    const sub = h.store.subscribe("watch");
    await flush();
    sub.setTier("aim");
    await flush();
    release(okLease());
    await flush();
    expect(h.leases[h.leases.length - 1]).toBe("aim");
  });
});
