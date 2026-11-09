"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import type { HistoryRange } from "@/types/history";

import type { LiveStatus } from "./derive";
import { systemFixture, type SystemScenario } from "./mock-fixture";
import { SystemHealthView } from "./system-health-view";

// =============================================================================
// System Health: development data switch
// =============================================================================
// While the live collector for the `system` series is not deployed, the page
// renders from the fixture when the URL carries `?mock=<scenario>`. Remove this
// file and `mock-fixture.ts`, then drop the three lines in `system-health.tsx`
// that reference `useMockScenario` / `MockPage`.
// =============================================================================

export type MockScenario = SystemScenario | "loading" | "error";

const SCENARIOS: readonly MockScenario[] = [
  "healthy",
  "modem",
  "hot",
  "storage",
  "fresh",
  "loading",
  "error",
];

/** The scenario named by `?mock=`, or null for the real hooks. Needs a Suspense boundary. */
export function useMockScenario(): MockScenario | null {
  const value = useSearchParams().get("mock");
  return SCENARIOS.find((s) => s === value) ?? null;
}

export function MockPage({ scenario }: { scenario: MockScenario }) {
  const [range, setRange] = React.useState<HistoryRange>("24h");
  // "Try again" on the error scenario recovers into a healthy one.
  const [recovered, setRecovered] = React.useState(false);
  const active: MockScenario = scenario === "error" && recovered ? "healthy" : scenario;
  const data = systemFixtureFor(range, active);

  const status: LiveStatus | null = data
    ? {
        uptimeSec: data.status.uptimeSec,
        memUsedMb: data.status.memUsedMb,
        memTotalMb: data.status.memTotalMb,
        thermal: data.status.thermal,
      }
    : null;

  return (
    <SystemHealthView
      range={range}
      onRangeChange={setRange}
      history={data?.history ?? null}
      events={data?.events ?? null}
      error={active === "error" ? "Mock error" : null}
      onRetry={() => setRecovered(true)}
      status={status}
    />
  );
}

const cache = new Map<string, ReturnType<typeof systemFixture>>();

/** One fixture per range and scenario for the life of the page; none for loading / error. */
function systemFixtureFor(range: HistoryRange, scenario: MockScenario) {
  if (scenario === "loading" || scenario === "error") return null;
  const key = `${range}:${scenario}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = systemFixture(range, scenario);
    cache.set(key, hit);
  }
  return hit;
}
