"use client";

import * as React from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { Trans, useTranslation } from "react-i18next";
import {
  LaptopIcon,
  RefreshCcwIcon,
  ServerIcon,
  TriangleAlertIcon,
  UsersIcon,
  WifiOffIcon,
} from "lucide-react";

import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import { Banner } from "@/components/ui/banner";
import { useNetBird, type NetBirdStatus } from "@/hooks/use-netbird";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import { ConnectionCard, ConnectionCardSkeleton } from "./connection-card";
import { RebootDialog } from "./danger-card";
import { DeviceCard, DeviceCardSkeleton } from "./device-card";
import { InstallCard, InstallCardSkeleton } from "./install-card";
import { rememberNetbirdInstalled, useLastKnownInstalled } from "./last-known";
import { PeersCard } from "./peers-card";
import {
  COLS,
  CROSSFADE_STACK,
  NOTICE,
  NOTICE_BODY,
  NOTICE_GLYPH,
  NOTICE_TONE,
  PAGE_ROOT,
  STATUS_LABEL_KEY,
  type NetbirdView,
} from "./shapes";
import {
  STATUS_GLYPH,
  StatusBand,
  StatusBandSkeleton,
  TileMono,
  type StatusTileProps,
} from "./status-band";

// -----------------------------------------------------------------------------
// NetBird — the page shell.
// -----------------------------------------------------------------------------
// Five states, four page shapes: another VPN present (one banner), not
// installed (one install hero), unreadable (a condition and the peers card,
// which carries its own state), and installed (band + pair + peers + danger).
// -----------------------------------------------------------------------------

/** Every field after `installed` is optional, so the view goes honest rather
 *  than defaulting a tone in. */
function deriveView(status: NetBirdStatus | null): NetbirdView {
  if (!status) return "unknown";
  if (!status.installed) return "notInstalled";
  if (!(status.daemon_running ?? false)) return "serviceStopped";
  const backend = status.backend_state ?? "";
  if (backend === "Connected") return "connected";
  if (backend === "") return "unknown";
  return "disconnected";
}

const NetBirdComponent = () => {
  const { t } = useTranslation("monitoring");
  const hook = useNetBird();
  const {
    status,
    isLoading,
    error,
    installResult,
    runInstall,
    refresh,
    uninstall,
    isUninstalling,
  } = hook;

  const [showReboot, setShowReboot] = React.useState(false);
  const view = deriveView(status);
  const lastKnownInstalled = useLastKnownInstalled();

  // Only a real read is worth remembering.
  const installedNow = status?.installed;
  React.useEffect(() => {
    if (installedNow !== undefined) rememberNetbirdInstalled(installedNow);
  }, [installedNow]);

  const reload = React.useCallback(() => {
    // `refresh` is the hook's fetch; a click event must never reach its argument.
    refresh();
  }, [refresh]);

  const dash = t("netbird.band.dash");

  const tiles = React.useMemo<StatusTileProps[]>(() => {
    if (!status) return [];

    const connected = view === "connected";
    const management = status.management ?? "";
    const signal = status.signal ?? "";
    const controlOk = management === "Connected" && signal === "Connected";
    const word = (raw: string) =>
      raw === "Connected"
        ? t("netbird.status.connected")
        : raw || t("netbird.status.unknown");
    const online = connected ? (status.peers_connected ?? 0) : 0;
    const total = connected ? (status.peers_total ?? 0) : 0;

    return [
      {
        icon: STATUS_GLYPH[view],
        eyebrow: t("netbird.band.connectionEyebrow"),
        value: t(STATUS_LABEL_KEY[view]),
        caption: status.version
          ? t("netbird.band.version", { version: status.version })
          : t("netbird.band.versionUnknown"),
        discTone: connected ? "good" : "neutral",
      },
      {
        icon: LaptopIcon,
        eyebrow: t("netbird.band.deviceEyebrow"),
        value: status.netbird_ip || dash,
        mono: true,
        caption: status.fqdn ? (
          <TileMono>{status.fqdn}</TileMono>
        ) : (
          t("netbird.band.deviceUnknown")
        ),
      },
      {
        icon: ServerIcon,
        eyebrow: t("netbird.band.controlEyebrow"),
        value: !connected
          ? dash
          : controlOk
            ? t("netbird.status.connected")
            : t("netbird.band.controlIssue"),
        caption: !connected
          ? t("netbird.band.controlIdle")
          : controlOk
            ? t("netbird.band.controlOk")
            : t("netbird.band.controlDetail", {
                management: word(management),
                signal: word(signal),
              }),
        discTone: !connected ? "neutral" : controlOk ? "good" : "alert",
        valueTone: connected && !controlOk ? "alert" : "neutral",
      },
      {
        icon: UsersIcon,
        eyebrow: t("netbird.band.peersEyebrow"),
        value: `${online} / ${total}`,
        caption:
          total > 0
            ? t("netbird.band.peersTotal", { count: total })
            : t("netbird.band.noPeers"),
      },
    ];
  }, [status, view, t, dash]);

  const peersCard = (
    <PeersCard
      status={status}
      isLoading={isLoading}
      error={error}
      onRetry={reload}
    />
  );

  // Only one VPN may be installed at a time: while Tailscale is present this
  // page states why and offers the way out, instead of controls that cannot work.
  const blockedByOtherVpn = !isLoading && !!status?.other_vpn_installed;

  let body: React.ReactNode;
  if (blockedByOtherVpn) {
    body = (
      <motion.div variants={staggerItem}>
        <Banner
          role="degraded"
          title={t("netbird.mutex.title")}
          description={
            <Trans
              i18nKey="netbird.mutex.description"
              ns="monitoring"
              values={{ other_vpn: status?.other_vpn_name }}
              components={{
                link: (
                  <Link
                    href="/monitoring/tailscale"
                    className="font-medium underline underline-offset-2"
                  />
                ),
              }}
            />
          }
        />
      </motion.div>
    );
  } else if (view === "notInstalled") {
    body = (
      <motion.div variants={staggerItem}>
        <InstallCard
          installResult={installResult}
          runInstall={runInstall}
          onRefresh={reload}
          isRefreshing={isLoading}
          installHint={status?.install_hint}
        />
      </motion.div>
    );
  } else if (!status && isLoading && lastKnownInstalled === false) {
    // A modem that had nothing installed last time would otherwise paint the
    // whole installed layout and collapse it into one card.
    body = (
      <motion.div variants={staggerItem}>
        <InstallCardSkeleton />
      </motion.div>
    );
  } else if (!status && !isLoading) {
    // Nothing readable came back at all. The peers card is a separate concern
    // and mounts with its own condition rather than sharing this one.
    body = (
      <>
        <motion.div variants={staggerItem}>
          <ConditionBlock
            tone="destructive"
            icon={WifiOffIcon}
            title={t("netbird.page.unreadableTitle")}
            description={error ?? t("netbird.page.unreadable")}
            actionLabel={t("netbird.actions.retry")}
            actionIcon={RefreshCcwIcon}
            onAction={reload}
          />
        </motion.div>
        <motion.div variants={staggerItem}>{peersCard}</motion.div>
      </>
    );
  } else {
    body = (
      <>
        <motion.div variants={staggerItem} className={CROSSFADE_STACK}>
          {status ? <StatusBand tiles={tiles} /> : <StatusBandSkeleton />}
        </motion.div>

        <motion.div variants={staggerItem} className={COLS}>
          {status ? (
            <ConnectionCard
              view={view}
              status={status}
              isConnecting={hook.isConnecting}
              isDisconnecting={hook.isDisconnecting}
              isTogglingService={hook.isTogglingService}
              isTogglingBoot={hook.isTogglingBoot}
              isUninstalling={isUninstalling}
              connect={hook.connect}
              disconnect={hook.disconnect}
              startService={hook.startService}
              stopService={hook.stopService}
              setBootEnabled={hook.setBootEnabled}
              uninstall={uninstall}
              onUninstalled={() => setShowReboot(true)}
              onRefresh={reload}
              isRefreshing={isLoading}
            />
          ) : (
            <ConnectionCardSkeleton />
          )}
          {status ? (
            <DeviceCard view={view} status={status} />
          ) : (
            <DeviceCardSkeleton />
          )}
        </motion.div>

        <motion.div variants={staggerItem}>{peersCard}</motion.div>
      </>
    );
  }

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <MonitoringPageHeader
          title={t("netbird.page.title")}
          description={t("netbird.page.description")}
        />
      </motion.div>

      {/* A failed poll with a payload still in hand is a notice above the
          content, never a replacement for it. */}
      {error && status && !blockedByOtherVpn ? (
        <motion.div variants={staggerItem}>
          <div role="alert" className={cn(NOTICE, NOTICE_TONE.destructive)}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            <span className={NOTICE_BODY}>
              {t("netbird.page.stale", { message: error })}
            </span>
          </div>
        </motion.div>
      ) : null}

      {body}

      {/* Owned here: a successful uninstall flips the surface to its
          not-installed shape, which would unmount the row and the dialog. */}
      <RebootDialog open={showReboot} onOpenChange={setShowReboot} />
    </motion.div>
  );
};

export default NetBirdComponent;
