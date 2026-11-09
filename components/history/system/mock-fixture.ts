import {
  HISTORY_RANGES,
  type HistoryEvent,
  type HistoryEventsResponse,
  type HistoryRange,
} from "@/types/history";
import type { NetworkEventType, ThermalPart, ThermalStatus } from "@/types/modem-status";
import type {
  RebootCause,
  SystemBucket,
  SystemHistory,
  SystemMetric,
  SystemState,
} from "@/types/system-history";

// =============================================================================
// System Health: development fixture
// =============================================================================
// A fixed 30-day story (the approved prototype's), shaped as the real
// `history/series.sh` + `history/events.sh` responses, so the page and its
// charts can be built and reviewed before the live collector for the `system`
// series is deployed. Each range shows its slice of the same story: bucket
// rows per HISTORY_RANGES (the last one partial), `st` seconds that fall short
// wherever the device was off, hourly storage readings that most buckets lack,
// and raw event rows in the exact formats `types/system-history.ts` documents.
//
// Delete with `dev-mock.tsx` once the collector ships; nothing outside the dev
// switch imports this except Stability / chart cards during development.
// =============================================================================

export type SystemScenario = "healthy" | "modem" | "hot" | "storage" | "fresh";

export interface SystemFixtureStatus {
  uptimeSec: number;
  memUsedMb: number;
  memTotalMb: number;
  thermal: ThermalStatus;
}

export interface SystemFixture {
  history: SystemHistory;
  events: HistoryEventsResponse;
  status: SystemFixtureStatus;
}

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;
const MEM_TOTAL_MB = 597;
const TRIP_C = 110;

// The story is told in wall-clock terms (Nov 9, 14:40 being "now") and replayed
// as offsets from the real now, so "Today" and "Yesterday" stay true.
const REF = new Date(2026, 10, 9, 14, 40).getTime() / 1000;
const ago = (month: number, day: number, hour: number, min: number) =>
  REF - new Date(2026, month, day, hour, min).getTime() / 1000;

interface RebootSpan {
  /** Offline start. */
  start: number;
  /** Back up. */
  back: number;
  cause: RebootCause;
}
interface ModemSpan {
  start: number;
  end: number | null;
}
interface HeatSpan {
  start: number;
  end: number | null;
  peak: number;
  parts: ThermalPart[];
}

// [ago start, off seconds, cause]
const REBOOTS: [number, number, RebootCause][] = [
  [ago(10, 9, 13, 16), 95, "update"],
  [ago(10, 8, 3, 0), 82, "scheduled"],
  [ago(10, 4, 17, 23), 372, "unexpected"],
  [ago(10, 1, 3, 0), 80, "scheduled"],
  [ago(9, 29, 10, 2), 90, "user"],
  [ago(9, 25, 3, 0), 81, "scheduled"],
  [ago(9, 20, 2, 14), 160, "unexpected"],
  [ago(9, 18, 3, 0), 79, "scheduled"],
];
// [ago start, seconds until recovered]
const MODEMS: [number, number][] = [
  [ago(10, 8, 21, 42), 38],
  [ago(10, 6, 4, 12), 52],
  [ago(10, 6, 4, 31), 41],
  [ago(10, 1, 11, 5), 35],
  [ago(9, 24, 23, 50), 61],
  [ago(9, 24, 23, 58), 44],
  [ago(9, 24, 0, 20), 40],
  [ago(9, 15, 8, 0), 33],
];
// [ago start, ago end, peak °C, parts]
const HEATS: [number, number, number, ThermalPart[]][] = [
  [ago(10, 9, 11, 20), ago(10, 9, 11, 44), 111, ["nr"]],
  [ago(10, 5, 14, 20), ago(10, 5, 15, 5), 112, ["nr", "lte"]],
  [ago(9, 27, 13, 50), ago(9, 27, 14, 10), 110, ["nr"]],
  [ago(9, 22, 15, 0), ago(9, 22, 15, 12), 110, ["cpu"]],
];

const PART_NAME: Record<ThermalPart, string> = {
  lte: "LTE",
  nr: "5G",
  mmwave: "mmWave",
  modem: "Modem",
  cpu: "CPU",
  ethernet: "Ethernet",
};

// --- deterministic noise ------------------------------------------------------

function rngOf(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashOf(s: string): number {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Smooth 1-D noise in [-1, 1] over x in [0, 1], at four scales. */
function noiseOf(seed: number): (x: number) => number {
  const r = rngOf(seed);
  const scales = [5, 22, 90, 520];
  const weights = [0.5, 0.28, 0.14, 0.08];
  const knots = scales.map((s) => Array.from({ length: s + 2 }, () => r() * 2 - 1));
  return (x) =>
    scales.reduce((acc, s, i) => {
      const p = x * s;
      const j = Math.floor(p);
      const f = p - j;
      const c = (1 - Math.cos(f * Math.PI)) / 2;
      return acc + weights[i] * (knots[i][j] * (1 - c) + knots[i][j + 1] * c);
    }, 0);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const NOISE = {
  cpu: noiseOf(hashOf("cpu") + 7),
  mem: noiseOf(hashOf("mem") + 7),
  tmp: noiseOf(hashOf("tmp") + 7),
};

/** A repeatable jitter in [0, 1) per minute of the timeline. */
function jitter(t: number, salt: number): number {
  return rngOf(hashOf(`${Math.floor(t / MIN)}:${salt}`))();
}

// --- the story ----------------------------------------------------------------

interface Story {
  now: number;
  reboots: RebootSpan[];
  modems: ModemSpan[];
  heats: HeatSpan[];
  /** No data before this moment (a new install); null = full history. */
  freshFrom: number | null;
  /** When the device last came up. */
  bootedAt: number;
  storage: Record<"sys" | "app" | "tmp", StorageModel>;
}

interface StorageModel {
  sizeMiB: number;
  usedMiB: number;
  /** Used MiB 1, 7 and 30 days ago. */
  before: [number, number, number];
}

function buildStory(now: number, scenario: SystemScenario): Story {
  const fresh = scenario === "fresh";
  const reboots: RebootSpan[] = fresh
    ? []
    : REBOOTS.map(([a, off, cause]) => ({
        start: now - a,
        back: now - a + off,
        cause,
      }));
  const modems: ModemSpan[] = fresh
    ? []
    : MODEMS.map(([a, rec]) => ({ start: now - a, end: now - a + rec }));
  const heats: HeatSpan[] = fresh
    ? []
    : HEATS.map(([a, b, peak, parts]) => ({ start: now - a, end: now - b, peak, parts }));
  if (scenario === "modem") modems.push({ start: now - 25, end: null });
  if (scenario === "hot") {
    heats.push({ start: now - 18 * MIN, end: null, peak: 111, parts: ["nr"] });
  }

  const lastBack = reboots.reduce((m, r) => Math.max(m, r.back), -Infinity);
  const bootedAt = fresh ? now - 130 * MIN : Number.isFinite(lastBack) ? lastBack : now - 30 * DAY;

  const storage: Story["storage"] = {
    sys: { sizeMiB: 97.5, usedMiB: 61.9, before: [61.4, 61.4, 58.8] },
    app: { sizeMiB: 264.2, usedMiB: 16.6, before: [16.3, 14.5, 7.6] },
    tmp: { sizeMiB: 298.3, usedMiB: 2.4, before: [2.1, 2.0, 2.2] },
  };
  if (scenario === "storage") {
    storage.sys = { sizeMiB: 97.5, usedMiB: 91.6, before: [91.2, 64.5, 61.0] };
  }
  if (fresh) {
    for (const k of ["sys", "app", "tmp"] as const) {
      storage[k].before = [storage[k].usedMiB, storage[k].usedMiB, storage[k].usedMiB];
    }
  }
  return {
    now,
    reboots,
    modems,
    heats,
    freshFrom: fresh ? now - 38 * MIN : null,
    bootedAt,
    storage,
  };
}

function isOffline(s: Story, t: number): boolean {
  if (s.freshFrom !== null && t < s.freshFrom) return true;
  return s.reboots.some((r) => t >= r.start && t < r.back);
}

function lastBootBefore(s: Story, t: number): number {
  let b = s.freshFrom !== null ? s.bootedAt : -Infinity;
  for (const r of s.reboots) if (r.back <= t && r.back > b) b = r.back;
  return b;
}

/** One reading of the three live metrics, null while the device was off. */
function sampleAt(s: Story, t: number): { cpu: number; mem: number; temp: number } | null {
  if (isOffline(s, t)) return null;
  const x = clamp((t - (s.now - 30 * DAY)) / (30 * DAY), 0, 1);
  const d = new Date(t * 1000);
  const hr = d.getHours() + d.getMinutes() / 60;
  const sinceBoot = t - lastBootBefore(s, t);
  const boot = sinceBoot < 40 * MIN ? Math.exp(-sinceBoot / (5 * MIN)) : 0;

  const heat = s.heats.find((h) => t >= h.start && t <= (h.end ?? s.now));
  let bell = 0;
  if (heat) {
    const f = (t - heat.start) / Math.max(1, (heat.end ?? s.now) - heat.start);
    bell = heat.end === null ? Math.min(1, f * 1.5) : Math.sin(Math.PI * f);
  }
  const nearModem = s.modems.some((m) => t >= m.start && t < m.start + 6 * MIN);

  const cpu = clamp(
    11 +
      5 * NOISE.cpu(x) +
      6 * Math.max(0, Math.sin(((hr - 14) / 24) * 2 * Math.PI)) +
      74 * boot +
      46 * bell +
      (nearModem ? 24 : 0) +
      (jitter(t, 1) - 0.5) * 5,
    3,
    99,
  );
  const daysUp = Math.min(12, sinceBoot / DAY);
  const mem = clamp(
    40 + 0.42 * daysUp + 1.6 * NOISE.mem(x) + (jitter(t, 2) - 0.5) * 0.7 - 8 * boot,
    20,
    95,
  );
  const ambient =
    41 +
    (3.5 + 2.5 * NOISE.mem(x * 0.7)) * Math.sin(((hr - 9) / 24) * 2 * Math.PI) +
    0.06 * cpu +
    4 * NOISE.tmp(x) +
    (jitter(t, 3) - 0.5) * 0.8;
  const temp = heat ? ambient + (heat.peak - ambient) * bell : ambient;
  return { cpu, mem, temp };
}

/** Used MiB at `t`, interpolated through the 1 / 7 / 30 day marks. */
function storageUsedAt(m: StorageModel, now: number, t: number): number {
  const days = clamp((now - t) / DAY, 0, 30);
  const pts: [number, number][] = [
    [0, m.usedMiB],
    [1, m.before[0]],
    [7, m.before[1]],
    [30, m.before[2]],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    const [d0, v0] = pts[i];
    const [d1, v1] = pts[i + 1];
    if (days <= d1) return v0 + ((v1 - v0) * (days - d0)) / (d1 - d0);
  }
  return m.before[2];
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

// --- the responses ------------------------------------------------------------

function buildBuckets(s: Story, range: HistoryRange): SystemBucket[] {
  const { bucketSec, count } = HISTORY_RANGES[range];
  const newest = Math.floor(s.now / bucketSec) * bucketSec;
  const out: SystemBucket[] = [];

  for (let i = 0; i < count; i++) {
    const t = newest - (count - 1 - i) * bucketSec;
    const len = i === count - 1 ? Math.max(1, s.now - t) : bucketSec;
    const end = t + len;

    // Seconds with no data: a new install before its first row, device-off spans.
    let off = s.freshFrom !== null ? overlap(t, end, -Infinity, s.freshFrom) : 0;
    for (const r of s.reboots) off += overlap(t, end, r.start, r.back);
    let throttled = 0;
    for (const h of s.heats) throttled += overlap(t, end, h.start, h.end ?? s.now);
    const normal = Math.max(0, len - off - throttled);
    const st: SystemBucket["st"] = {};
    if (normal > 0) st.normal = Math.round(normal);
    if (throttled > 0) st.throttled = Math.round(throttled);

    // Metrics: five-minute readings across the bucket.
    const step = Math.min(5 * MIN, len);
    const cpu: number[] = [];
    const mem: number[] = [];
    const temp: number[] = [];
    for (let k = 0; t + (k + 0.5) * step <= end + 0.001 && k < Math.ceil(len / step); k++) {
      const v = sampleAt(s, t + (k + 0.5) * step);
      if (!v) continue;
      cpu.push(v.cpu);
      mem.push(v.mem);
      temp.push(Math.round(v.temp));
    }

    const m: SystemBucket["m"] = {};
    const stat = (xs: number[], digits: number) => {
      const f = 10 ** digits;
      const r = (v: number) => Math.round(v * f) / f;
      return {
        n: xs.length,
        avg: r(xs.reduce((a, b) => a + b, 0) / xs.length),
        min: r(Math.min(...xs)),
        max: r(Math.max(...xs)),
      };
    };
    if (cpu.length > 0) {
      m.cpu = stat(cpu, 1);
      m.mem_pct = stat(mem, 1);
      m.mem_mb = stat(
        mem.map((p) => (p / 100) * MEM_TOTAL_MB),
        1,
      );
      m.temp_c = stat(temp, 1);
    }

    // Storage: once an hour, plus a reading a minute ago in the newest bucket.
    const marks: number[] = [];
    for (let h = Math.ceil(t / HOUR) * HOUR; h < end; h += HOUR) marks.push(h);
    if (i === count - 1) marks.push(s.now - MIN);
    const valid = marks.filter((x) => !isOffline(s, x) && x >= t && x <= end);
    if (valid.length > 0) {
      const put = (used: SystemMetric, size: SystemMetric, model: StorageModel) => {
        m[used] = stat(
          valid.map((x) => Math.round(storageUsedAt(model, s.now, x) * 1024)),
          0,
        );
        m[size] = stat(
          valid.map(() => Math.round(model.sizeMiB * 1024)),
          0,
        );
      };
      put("st_sys_used", "st_sys_size", s.storage.sys);
      put("st_app_used", "st_app_size", s.storage.app);
      put("st_tmp_used", "st_tmp_size", s.storage.tmp);
    }

    out.push({ t, len, st, x: 0, m });
  }
  return out;
}

function buildEvents(s: Story, range: HistoryRange, rangeStart: number): HistoryEventsResponse {
  const rows: HistoryEvent[] = [];
  const add = (
    timestamp: number,
    type: NetworkEventType,
    severity: HistoryEvent["severity"],
    message: string,
    end?: number | null,
  ) => {
    if (timestamp < rangeStart || timestamp > s.now) return;
    rows.push({
      timestamp,
      type,
      severity,
      radio: null,
      message,
      ...(end !== undefined ? { end } : {}),
    });
  };

  for (const r of s.reboots) {
    add(
      r.back,
      "device_reboot",
      r.cause === "unexpected" ? "error" : "info",
      `cause=${r.cause} off=${Math.round(r.back - r.start)}`,
    );
  }
  for (const m of s.modems) {
    add(m.start, "modem_crash", "error", "Modem crashed", m.end);
    if (m.end !== null) add(m.end, "modem_recovered", "info", "Modem recovered");
  }
  for (const h of s.heats) {
    const names = h.parts.map((p) => PART_NAME[p]).join(", ");
    add(
      h.start,
      "thermal_throttled",
      "warning",
      names ? `Thermal throttling started (${names})` : "Thermal throttling started",
      h.end,
    );
    if (h.end !== null) add(h.end, "thermal_recovered", "info", "Thermal throttling cleared");
  }
  rows.sort((a, b) => b.timestamp - a.timestamp);

  const counts: Partial<Record<NetworkEventType, number>> = {};
  for (const e of rows) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return {
    success: true,
    series: "system",
    range,
    total: rows.length,
    counts,
    events: rows,
  };
}

/**
 * The `system` series for `range` in `scenario`, as the page would receive it,
 * plus the live values the status poll would add. `nowSec` pins the clock for
 * tests; leave it out to replay the story against the real now.
 */
export function systemFixture(
  range: HistoryRange,
  scenario: SystemScenario,
  nowSec?: number,
): SystemFixture {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const story = buildStory(now, scenario);
  const buckets = buildBuckets(story, range);
  const { bucketSec } = HISTORY_RANGES[range];

  const lastReading = (() => {
    for (let t = now - MIN; t > now - HOUR; t -= MIN) {
      const v = sampleAt(story, t);
      if (v) return v;
    }
    return null;
  })();
  const since = story.freshFrom ?? buckets[0].t - 14 * DAY;

  const history: SystemHistory = {
    success: true,
    series: "system",
    range,
    bucket_sec: bucketSec,
    now,
    clock_trusted: true,
    since,
    states: ["normal", "throttled"] satisfies SystemState[],
    fault: ["throttled"] satisfies SystemState[],
    metrics: [
      "cpu",
      "mem_pct",
      "mem_mb",
      "temp_c",
      "st_sys_used",
      "st_sys_size",
      "st_app_used",
      "st_app_size",
      "st_tmp_used",
      "st_tmp_size",
    ] satisfies SystemMetric[],
    current: { state: story.heats.some((h) => h.end === null) ? "throttled" : "normal", since: now - 30 * MIN },
    last_fault: null,
    buckets,
  };

  const hot = story.heats.find((h) => h.end === null);
  const tempNow = lastReading ? lastReading.temp : 45;
  const status: SystemFixtureStatus = {
    uptimeSec: Math.max(0, Math.round(now - story.bootedAt)),
    memUsedMb: Math.round(((lastReading?.mem ?? 40) / 100) * MEM_TOTAL_MB),
    memTotalMb: MEM_TOTAL_MB,
    thermal: {
      throttling: hot !== undefined,
      parts: hot ? hot.parts : [],
      active: [],
      cold_protection: false,
      headroom_c: Math.max(0, Math.round(TRIP_C - tempNow)),
      trip_c: TRIP_C,
      trip_part: "cpu",
    },
  };

  return { history, events: buildEvents(story, range, buckets[0].t), status };
}
