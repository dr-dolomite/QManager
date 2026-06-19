"use client";

import { useTranslation } from "react-i18next";
import { useWatchdogSettings } from "@/hooks/use-watchdog-settings";
import type { UseWatchdogSettingsReturn } from "@/hooks/use-watchdog-settings";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchdogForm } from "./use-watchdog-form";
import { WatchdogOverviewCard } from "./watchdog-overview-card";
import { WatchdogTriggersCard } from "./watchdog-triggers-card";
import { WatchdogRecoveryLadder } from "./watchdog-recovery-ladder";

// -----------------------------------------------------------------------------
// Connection Watchdog — page coordinator.
// -----------------------------------------------------------------------------
// The redesign splits the old monolith settings card into three grouped cards
// (Status, Recovery Triggers, Recovery Ladder), the way Custom SIM Profiles is
// composed: a page header over a uniform card grid, each card a self-contained
// settings group. The two triggers (reachability + quality) share one card via
// tabs. Because the backend save is atomic, one `useWatchdogForm` instance owns
// the whole form and every card consumes the slice it renders; the single Save /
// Discard pair lives in the Triggers card footer and commits every change.
const WatchdogComponent = () => {
  const { t } = useTranslation("monitoring");
  const hookData = useWatchdogSettings();

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="mb-2 text-3xl font-bold">{t("watchdog.page_title")}</h1>
        <p className="text-muted-foreground">{t("watchdog.page_description")}</p>
      </div>

      {hookData.isLoading || !hookData.settings ? (
        <PageSkeleton />
      ) : (
        <WatchdogForm
          // Remount on a settings signature so the form re-seeds from fresh
          // server truth after every save / background refetch.
          key={settingsSignature(hookData)}
          hookData={hookData}
        />
      )}
    </div>
  );
};

function settingsSignature(hookData: UseWatchdogSettingsReturn): string {
  const s = hookData.settings;
  if (!s) return "empty";
  return [
    s.enabled,
    s.fail_threshold,
    s.check_interval,
    s.cooldown,
    s.tier1_enabled,
    s.tier2_enabled,
    s.tier3_enabled,
    s.tier4_enabled,
    s.backup_sim_slot,
    s.max_reboots_per_hour,
    s.quality_enabled,
    s.quality_consecutive,
    s.probe_profile,
    s.interval_override,
  ].join("-");
}

function WatchdogForm({ hookData }: { hookData: UseWatchdogSettingsReturn }) {
  const {
    settings,
    qualityThresholds,
    isSaving,
    error,
    saveSettings,
    autoDisabled,
    revertSim,
  } = hookData;

  // settings is guaranteed non-null by the caller's guard.
  const form = useWatchdogForm({
    settings: settings!,
    isSaving,
    error,
    saveSettings,
  });

  return (
    // Default stretch equalizes the two desktop columns. Inside the left column,
    // auto_1fr keeps Overview at natural height and lets the Triggers card grow
    // to the column foot, so when the ladder is the taller column the left side
    // fills to match it (and vice-versa when the watchdog is active). The ladder
    // fills the right column itself.
    <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
      {/* Left column: live status, then the two triggers (tabbed) + the save. */}
      <div className="grid grid-rows-[auto_1fr] gap-4">
        <WatchdogOverviewCard
          form={form}
          autoDisabled={autoDisabled}
          revertSim={revertSim}
        />
        <WatchdogTriggersCard
          form={form}
          qualityThresholds={qualityThresholds}
        />
      </div>

      {/* Right column: the recovery ladder. */}
      <div className="grid gap-4">
        <WatchdogRecoveryLadder form={form} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Page skeleton — mirrors the live grid exactly (same stretch + auto_1fr column
// structure as WatchdogForm) so content replacement is a clean fill with zero
// reflow. Each skeleton card matches the real card's silhouette.
// -----------------------------------------------------------------------------
function PageSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
      <div className="grid grid-rows-[auto_1fr] gap-4">
        <OverviewSkeleton />
        <TriggersSkeleton />
      </div>
      <div className="grid gap-4">
        <LadderSkeleton />
      </div>
    </div>
  );
}

// Overview skeleton: mirrors the card's own internal loading state (lines
// 157-173 of watchdog-overview-card.tsx) — header + switch action, h-16 hero,
// 2/3-col grid of six h-16 stat tiles.
function OverviewSkeleton() {
  return (
    <Card className="@container/card" aria-hidden>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
        <CardAction>
          <Skeleton className="h-5 w-9 rounded-full" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <Skeleton className="h-16 w-full rounded-lg" />
          <div className="grid grid-cols-2 gap-2.5 @sm/card:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Triggers skeleton: tab strip + 2-col field grid + full-width field +
// CardFooter with hint bar and two button bars.
function TriggersSkeleton() {
  return (
    <Card className="@container/card" aria-hidden>
      <CardHeader>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-52" />
      </CardHeader>
      <CardContent className="grid flex-1 content-start gap-4">
        {/* Tab strip */}
        <Skeleton className="h-9 w-full rounded-md" />
        {/* 2-col field grid */}
        <div className="grid grid-cols-1 gap-4 @sm/card:grid-cols-2">
          <div className="grid gap-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
          <div className="grid gap-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </div>
        {/* Full-width field (cooldown) */}
        <div className="grid gap-1.5">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-3 border-t pt-4">
        <Skeleton className="h-3.5 w-24" />
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      </CardFooter>
    </Card>
  );
}

// Ladder skeleton: fills the desktop column (h-full flex-col) like the live
// card so heights match with zero reflow. Leads with the SSR precondition block
// (muted box + switch), then 4 rung silhouettes spaced by the same content-
// driven rhythm (pb-6 between rungs, none on the last). Each rung = size-7 node
// + connector line and a body with name, description, pill, and switch.
function LadderSkeleton() {
  return (
    <Card className="@container/card flex h-full flex-col" aria-hidden>
      <CardHeader>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-60" />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {/* SSR precondition block */}
        <div className="mb-6 rounded-lg border bg-muted/20 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="mt-0.5 h-5 w-9 shrink-0 rounded-full" />
          </div>
        </div>

        <ol>
          {[1, 2, 3, 4].map((n) => (
            <LadderRungSkeleton key={n} isLast={n === 4} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function LadderRungSkeleton({ isLast }: { isLast: boolean }) {
  return (
    <li className={isLast ? "flex gap-3" : "flex gap-3 pb-6"}>
      {/* Left rail */}
      <div className="flex flex-col items-center">
        <Skeleton className="size-7 shrink-0 rounded-full" />
        {!isLast && <Skeleton className="mt-1.5 w-px flex-1" />}
      </div>
      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-5 w-24 rounded" />
          </div>
          {/* Switch placeholder */}
          <Skeleton className="mt-0.5 h-5 w-9 shrink-0 rounded-full" />
        </div>
      </div>
    </li>
  );
}

export default WatchdogComponent;
