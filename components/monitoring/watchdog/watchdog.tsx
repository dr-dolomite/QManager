"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RefreshCcwIcon, WifiOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import { useConnectionQuality } from "@/hooks/use-connection-quality";
import { useModemStatus, type UseModemStatusReturn } from "@/hooks/use-modem-status";
import {
  useRecentActivities,
  type UseRecentActivitiesReturn,
} from "@/hooks/use-recent-activities";
import { useWatchdogSettings } from "@/hooks/use-watchdog-settings";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type {
  CqGetResponse,
  UseWatchdogReturn,
  WatchdogGetResponse,
  WatchdogSettingsV2,
} from "@/types/cq-watchdog";

import { FailoverBanner } from "./banners";
import { DetectionCard, DetectionCardSkeleton } from "./detection-card";
import {
  deriveFailback,
  deriveHero,
  derivePhase,
  deriveQualityLimits,
  deriveRungs,
  deriveSensitivityFacts,
  deriveStrip,
  elapsedSince,
  useFormatters,
  useGraceGate,
  useTimeAgo,
  type WatchdogPhase,
} from "./derive";
import { LadderCard, LadderCardSkeleton } from "./ladder-card";
import { RecoveryActivityCard } from "./recovery-activity-card";
import {
  CONDITION,
  CONDITION_TONE,
  HEADER_PILL,
  PAGE_ROOT,
  PAIR,
  PAIR_CELL,
  PILL_GLYPH,
} from "./shapes";
import { StatusCard, StatusCardSkeleton } from "./status-band";
import { useClock } from "./use-clock";
import { useWatchdogForm } from "./use-watchdog-form";

/** Phases in which the link is down and the outage clock is the one that counts. */
const OUTAGE_PHASES: ReadonlySet<WatchdogPhase> = new Set([
  "suspect",
  "recovery",
  "cooldown",
  "holdoff_outage",
]);

/** The watchdog read and the settings both landed: the form can seed. */
function isReady(
  hook: UseWatchdogReturn,
): hook is UseWatchdogReturn & { data: WatchdogGetResponse; settings: WatchdogSettingsV2 } {
  return hook.data !== null && hook.settings !== null;
}

const WatchdogComponent = () => {
  const { t } = useTranslation("monitoring");
  const hook = useWatchdogSettings();
  const modemStatus = useModemStatus({ pollInterval: 5000 });
  const activities = useRecentActivities({ maxEvents: 50 });
  const cq = useConnectionQuality();

  const hookRefresh = hook.refresh;
  const modemRefresh = modemStatus.refresh;
  const activityRefresh = activities.refresh;
  const cqRefresh = cq.refresh;
  const reload = React.useCallback(() => {
    // Never hand a click event to a `refresh`.
    void hookRefresh();
    modemRefresh();
    activityRefresh();
    void cqRefresh();
  }, [hookRefresh, modemRefresh, activityRefresh, cqRefresh]);

  const recentReboots = hook.data?.recent_reboots;

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <MonitoringPageHeader
          title={t("watchdog.page.title")}
          description={t("watchdog.page.description")}
          actions={
            <Button
              type="button"
              variant="ghost"
              onClick={reload}
              disabled={hook.isLoading}
              size="action"
              className={HEADER_PILL}
            >
              <RefreshCcwIcon
                className={cn(PILL_GLYPH, hook.isLoading && "motion-safe:animate-spin")}
              />
              {t("watchdog.page.refresh")}
            </Button>
          }
        />
      </motion.div>

      {isReady(hook) ? (
        <WatchdogSurface
          hook={hook}
          data={hook.data}
          settings={hook.settings}
          modemStatus={modemStatus}
          activities={activities}
          cq={cq.data}
        />
      ) : hook.isLoading ? (
        <>
          <motion.div variants={staggerItem}>
            <StatusCardSkeleton />
          </motion.div>
          <div className={PAIR}>
            <motion.div variants={staggerItem} className={PAIR_CELL}>
              <LadderCardSkeleton />
            </motion.div>
            <motion.div variants={staggerItem} className={PAIR_CELL}>
              <DetectionCardSkeleton />
            </motion.div>
          </div>
          <motion.div variants={staggerItem}>
            <RecoveryActivityCard activities={activities} recentReboots={recentReboots} />
          </motion.div>
        </>
      ) : (
        <>
          {/* Nothing readable came back, so the settings surface reports the
              failure outright. Activity is a separate read. */}
          <motion.div variants={staggerItem}>
            <SettingsUnreadable
              message={hook.error ?? t("watchdog.page.unreadable")}
              onRetry={reload}
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <RecoveryActivityCard activities={activities} recentReboots={recentReboots} />
          </motion.div>
        </>
      )}
    </motion.div>
  );
};

/** One form owns both drafts; one `derivePhase` owns what the device is doing. */
function WatchdogSurface({
  hook,
  data,
  settings,
  modemStatus,
  activities,
  cq,
}: {
  hook: UseWatchdogReturn;
  data: WatchdogGetResponse;
  settings: WatchdogSettingsV2;
  modemStatus: UseModemStatusReturn;
  activities: UseRecentActivitiesReturn;
  cq: CqGetResponse | null;
}) {
  const { t } = useTranslation("monitoring");
  const fmt = useFormatters();
  const timeAgo = useTimeAgo();
  const clock = useClock();
  const [retrying, setRetrying] = React.useState(false);

  const form = useWatchdogForm({
    settings,
    isSaving: hook.isSaving,
    saveSettings: hook.saveSettings,
  });

  const { status, effective } = data;
  const simDual = data.sim_dual_capable;
  const watchcat = modemStatus.data?.watchcat ?? null;
  const pastGrace = useGraceGate(hook.receivedAt, settings.enabled);

  const phase = derivePhase({
    settingsEnabled: settings.enabled,
    autoDisabled: data.auto_disabled,
    status,
    watchcat,
    pastGrace,
  });

  // The hero and the ladder report SAVED truth, never the half-edited form.
  const hero = deriveHero({
    phase,
    status,
    settings,
    effective,
    simDual,
    receivedAt: hook.receivedAt,
    clock,
    fmt,
    timeAgo,
  });
  const strip = deriveStrip(modemStatus.data?.connectivity ?? null, phase);
  const rungs = deriveRungs({ phase, status, simDual, receivedAt: hook.receivedAt, clock, fmt });
  const failback = deriveFailback({ status, receivedAt: hook.receivedAt, clock, fmt });

  const facts = deriveSensitivityFacts(cq, settings, effective);
  const limits = deriveQualityLimits(cq, effective);

  const elapsed = elapsedSince(hook.receivedAt, clock);
  const offlineSecs =
    status && OUTAGE_PHASES.has(phase) && status.offline_secs > 0
      ? status.offline_secs + Math.floor(elapsed)
      : null;
  const carrierSecs =
    status && status.carrier_single_secs > 0
      ? status.carrier_single_secs + Math.floor(elapsed)
      : 0;
  const reporting = status !== null && phase !== "off" && phase !== "starting" && phase !== "not_running" && phase !== "auto_disabled";

  const retryFailback = hook.retryFailback;
  const handleRetryFailback = React.useCallback(async () => {
    setRetrying(true);
    const result = await retryFailback();
    setRetrying(false);
    if (result.ok) toast.success(t("watchdog.ladder.failback.retryOk"));
    else toast.error(result.message ?? t("watchdog.ladder.failback.retryFail"));
  }, [retryFailback, t]);

  const failover = data.sim_failover;

  return (
    <>
      {failover.active ? (
        <motion.div variants={staggerItem}>
          <FailoverBanner
            failover={failover}
            since={
              failover.switched_at != null
                ? timeAgo(failover.switched_at)
                : t("watchdog.failover.recently")
            }
            revertSim={hook.revertSim}
          />
        </motion.div>
      ) : null}

      <motion.div variants={staggerItem}>
        <StatusCard view={hero} strip={strip} />
      </motion.div>

      <div className={PAIR}>
        <motion.div variants={staggerItem} className={PAIR_CELL}>
          <LadderCard
            form={form}
            rungs={rungs}
            failback={failback}
            simDual={simDual}
            onRetryFailback={handleRetryFailback}
            retrying={retrying}
          />
        </motion.div>
        <motion.div variants={staggerItem} className={PAIR_CELL}>
          <DetectionCard
            form={form}
            facts={facts}
            limits={limits}
            saved={settings}
            status={status}
            reporting={reporting}
            offlineSecs={offlineSecs}
            carrierSecs={carrierSecs}
          />
        </motion.div>
      </div>

      <motion.div variants={staggerItem}>
        <RecoveryActivityCard
          activities={activities}
          recentReboots={data.recent_reboots}
        />
      </motion.div>
    </>
  );
}

/** The settings read failed. The block IS the state, so it takes the tone. */
function SettingsUnreadable({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation("monitoring");
  const skin = CONDITION_TONE.destructive;
  return (
    <div role="status" className={cn(CONDITION.ROOT, skin.ROOT)}>
      <span aria-hidden className={cn(CONDITION.DISC, skin.DISC)}>
        <WifiOffIcon className={CONDITION.GLYPH} />
      </span>
      <p className={CONDITION.TITLE}>{t("watchdog.page.unreadableTitle")}</p>
      <p className={CONDITION.DESC}>{message}</p>
      <Button
        type="button"
        variant="ghost"
        onClick={onRetry}
        className={cn(CONDITION.ACTION, skin.ACTION)}
      >
        <RefreshCcwIcon className={PILL_GLYPH} />
        {t("watchdog.page.retry")}
      </Button>
    </div>
  );
}

export default WatchdogComponent;
