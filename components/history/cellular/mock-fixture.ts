// =============================================================================
// TEMPORARY mock fixture for Cellular History (removed in Phase 3)
// =============================================================================
// Shapes exactly like GET history/series.sh and history/events.sh
// (docs/features/history.md §6, types/history.ts), so swapping in
// useHistorySeries / useHistoryEvents is a one-line change per card.
// Deterministic (seeded) so screenshots are stable.
// Scenarios: "normal" | "empty" (new install) | "lte_only" | "error" | "loading".
// =============================================================================

import {
  CELLULAR_EVENT_TYPES,
  HISTORY_RANGES,
  type CellularBucket,
  type CellularEventType,
  type CellularHistory,
  type CellularMetric,
  type HistoryEvent,
  type HistoryEventsResponse,
  type HistoryRange,
} from "@/types/history";

export type MockScenario = "normal" | "empty" | "lte_only" | "error" | "loading";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const METRICS: CellularMetric[] = [
  "lte_rsrp",
  "lte_rsrq",
  "lte_sinr",
  "lte_rssi",
  "nr_rsrp",
  "nr_rsrq",
  "nr_sinr",
];

const BASE: Record<CellularMetric, [number, number]> = {
  lte_rsrp: [-99, 6],
  lte_rsrq: [-10, 2],
  lte_sinr: [18, 6],
  lte_rssi: [-69, 5],
  nr_rsrp: [-84, 7],
  nr_rsrq: [-11, 2],
  nr_sinr: [24, 7],
};

function stat(r: () => number, m: CellularMetric, n: number) {
  const [mid, spread] = BASE[m];
  const avg = Math.round((mid + (r() - 0.5) * spread * 2) * 10) / 10;
  return {
    n,
    avg,
    min: Math.round(avg - r() * spread),
    max: Math.round(avg + r() * spread),
  };
}

export function mockCellularHistory(
  range: HistoryRange,
  scenario: MockScenario = "normal",
  nowSec: number = Math.floor(Date.now() / 1000),
): CellularHistory {
  const { bucketSec, count } = HISTORY_RANGES[range];
  const r = rng(range.length * 7919 + bucketSec);
  const lastStart = Math.floor(nowSec / bucketSec) * bucketSec;
  const firstStart = lastStart - (count - 1) * bucketSec;
  // "empty": collecting began 40 minutes ago.
  const since =
    scenario === "empty" ? nowSec - 2400 : firstStart - 7 * 86400;
  const lteOnly = scenario === "lte_only";

  let lastFault: CellularHistory["last_fault"] = null;
  const buckets: CellularBucket[] = [];
  for (let i = 0; i < count; i++) {
    const t = firstStart + i * bucketSec;
    const len = i === count - 1 ? nowSec - t : bucketSec;
    const end = t + len;
    const b: CellularBucket = { t, len, st: {}, x: 0, m: {} };
    // Covered span: from max(t, since) to end.
    const covStart = Math.max(t, since);
    let covered = Math.max(0, end - covStart);
    // A reboot gap (no data) around 60% of the window.
    if (scenario === "normal" && i === Math.floor(count * 0.6)) {
      covered = Math.round(covered * 0.35);
    }
    if (covered > 0) {
      let down = 0;
      if (scenario !== "empty" && (i === Math.floor(count * 0.3) || i === count - 9)) {
        down = Math.min(covered, Math.round(60 + r() * 240));
        b.x = 1;
        lastFault = { start: t + 300, end: t + 300 + down };
      }
      const radio = covered - down;
      const nrShare = lteOnly ? 0 : 0.55 + r() * 0.4;
      const nr = Math.round(radio * nrShare);
      b.st = { nr, lte: radio - nr, down, off: 0 };
      const n = Math.max(1, Math.round(covered / 10));
      for (const m of METRICS) {
        if (lteOnly && m.startsWith("nr_")) continue;
        b.m[m] = stat(r, m, m.startsWith("nr_") ? Math.max(1, Math.round(n * nrShare)) : n);
      }
    }
    buckets.push(b);
  }

  return {
    success: true,
    series: "cellular",
    range,
    bucket_sec: bucketSec,
    now: nowSec,
    clock_trusted: true,
    since,
    states: ["nr", "lte", "down", "off"],
    fault: ["down"],
    metrics: METRICS,
    current: { state: lteOnly ? "lte" : "nr", since: scenario === "empty" ? since : nowSec - 3 * 3600 - 1260 },
    last_fault: lastFault,
    buckets,
  };
}

const MESSAGES: Record<CellularEventType, [string, HistoryEvent["severity"], HistoryEvent["radio"]][]> = {
  signal_lost: [["Modem became unreachable", "warning", null]],
  signal_restored: [["Modem signal restored — LTE B1 (PCI 295)", "info", "lte"]],
  nr_anchor: [
    ["5G NR anchor acquired (N41, PCI 262)", "info", "nr"],
    ["5G NR anchor lost (was N41)", "warning", "nr"],
  ],
  pci_change: [["LTE PCC cell handoff on B1 (PCI: 295 -> 301)", "info", "lte"]],
  scc_pci_change: [["LTE SCC cell handoff on B41 (PCI: 112 -> 118)", "info", "lte"]],
  band_change: [
    ["LTE band settled on B3 (was B1) (PCI 295)", "info", "lte"],
    ["NR band settled on N78 (was N41) (PCI 262)", "info", "nr"],
  ],
  ca_change: [
    ["LTE CA activated: B1 + B41, 35 MHz (2 carriers)", "info", "lte"],
    ["LTE CA deactivated — single carrier (B1)", "warning", "lte"],
  ],
};

export function mockCellularEvents(
  range: HistoryRange,
  opts: { types?: CellularEventType[]; page?: number; pageSize?: number } = {},
  scenario: MockScenario = "normal",
  nowSec: number = Math.floor(Date.now() / 1000),
): HistoryEventsResponse {
  const { bucketSec, count } = HISTORY_RANGES[range];
  const span = bucketSec * count;
  const r = rng(span);
  const total = scenario === "empty" ? 2 : Math.round(span / 1800);
  const all: HistoryEvent[] = [];
  for (let i = 0; i < total; i++) {
    let type = CELLULAR_EVENT_TYPES[Math.floor(r() * CELLULAR_EVENT_TYPES.length)];
    if (scenario === "lte_only" && type === "nr_anchor") type = "band_change";
    const opts2 = MESSAGES[type].filter(([, , radio]) => scenario !== "lte_only" || radio !== "nr");
    const [message, severity, radio] = opts2[Math.floor(r() * opts2.length)] ?? MESSAGES[type][0];
    all.push({ timestamp: nowSec - Math.floor(r() * Math.min(span, nowSec)), type, severity, radio, message });
  }
  all.sort((a, b) => b.timestamp - a.timestamp);
  const counts: HistoryEventsResponse["counts"] = {};
  for (const e of all) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const filtered = opts.types?.length ? all.filter((e) => opts.types!.includes(e.type as CellularEventType)) : all;
  const pageSize = opts.pageSize ?? 5;
  const page = opts.page ?? 0;
  return {
    success: true,
    series: "cellular",
    range,
    total: filtered.length,
    counts,
    events: filtered.slice(page * pageSize, page * pageSize + pageSize),
  };
}
