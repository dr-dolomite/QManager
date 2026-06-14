"use client";

import React from "react";
import { motion } from "motion/react";
import { containerVariants, itemVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useConnectionStatus } from "@/lib/reboot/connection";
import NetworkStatusComponent from "./network-status";
import DeviceStatus from "./device-status";
import LTEStatusComponent from "./lte-status";
import NrStatusComponent from "./nr-status";
import SccStatusComponent from "./scc-status";
import { SignalHistoryComponent } from "./signal-history";
import RecentActivitiesComponent from "./recent-activities";
import DeviceMetricsComponent from "./device-metrics";
import LiveLatencyComponent from "./live-latency";


const HomeComponent = () => {
  const { data, isLoading, isStale, error } = useModemStatus();
  const { t } = useTranslation("dashboard");
  // Once a sustained outage escalates to "reconnecting", the global banner
  // (app-layout) becomes the single source of truth for the outage. Suppress
  // this page-level "unable to reach" alert so the two notices don't stack.
  const { reconnecting } = useConnectionStatus();

  const networkType = data?.network?.type ?? "";
  const carrierComponents = data?.network?.carrier_components ?? [];
  const hasScc = carrierComponents.some((c) => c.type === "SCC");

  return (
    <div className="grid grid-cols-1 gap-6 px-4 lg:px-6 @3xl/main:grid-cols-2 @5xl/main:grid-cols-5" aria-live="polite" aria-atomic="false">
      {error && !isLoading && !reconnecting && (
        <div role="alert" className="col-span-full rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("alert.modem_unreachable")}
        </div>
      )}
      <div className="grid gap-4 @3xl/main:col-span-3 @5xl/main:col-span-3 col-span-1">
        <NetworkStatusComponent
          data={data?.network ?? null}
          connectivity={data?.connectivity ?? null}
          modemReachable={data?.modem_reachable ?? false}
          isLoading={isLoading}
          isStale={isStale}
        />
        <motion.div
          className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* SA mode: SCC card on the left */}
          {networkType === "5G-SA" && hasScc && (
            <motion.div variants={itemVariants} className="h-full *:data-[slot=card]:h-full">
              <SccStatusComponent carriers={carrierComponents} />
            </motion.div>
          )}

          {/* LTE PCC — shown in LTE and NSA modes; spans full width when no SCCs */}
          {networkType !== "5G-SA" && (
            <motion.div
              variants={itemVariants}
              className={cn(
                "h-full *:data-[slot=card]:h-full",
                networkType === "LTE" && !hasScc && "@3xl/main:col-span-2",
              )}
            >
              <LTEStatusComponent
                data={data?.lte ?? null}
                isLoading={isLoading}
              />
            </motion.div>
          )}

          {/* NR PCC — shown in SA and NSA modes; spans full width when no SCCs */}
          {networkType !== "LTE" && (
            <motion.div
              variants={itemVariants}
              className={cn(
                "h-full *:data-[slot=card]:h-full",
                networkType === "5G-SA" && !hasScc && "@3xl/main:col-span-2",
              )}
            >
              <NrStatusComponent
                data={data?.nr ?? null}
                isLoading={isLoading}
              />
            </motion.div>
          )}

          {/* LTE mode: SCC card on the right */}
          {networkType === "LTE" && hasScc && (
            <motion.div variants={itemVariants} className="h-full *:data-[slot=card]:h-full">
              <SccStatusComponent carriers={carrierComponents} />
            </motion.div>
          )}
        </motion.div>
      </div>
      <div className="@3xl/main:col-span-2 @5xl/main:col-span-2 col-span-1 h-full *:data-[slot=card]:h-full">
        <DeviceStatus
          data={data?.device ?? null}
          apn={data?.network?.apn ?? null}
          isLoading={isLoading}
        />
      </div>

      <div className="col-span-full">
        <motion.div
          className="grid grid-cols-1 @3xl/main:grid-cols-2 @5xl/main:grid-cols-3 grid-flow-row gap-4"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={itemVariants} className="h-full *:data-[slot=card]:h-full">
            <DeviceMetricsComponent
              deviceData={data?.device ?? null}
              lteData={data?.lte ?? null}
              nrData={data?.nr ?? null}
              isLoading={isLoading}
            />
          </motion.div>
          <motion.div variants={itemVariants} className="h-full *:data-[slot=card]:h-full">
            <LiveLatencyComponent
              connectivity={data?.connectivity ?? null}
              isLoading={isLoading}
            />
          </motion.div>
          <motion.div variants={itemVariants} className="h-full *:data-[slot=card]:h-full">
            <RecentActivitiesComponent />
          </motion.div>
        </motion.div>
      </div>

      <div className="col-span-full">
        <SignalHistoryComponent />
      </div>
    </div>
  );
};

export default HomeComponent;
