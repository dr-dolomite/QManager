"use client";

import * as React from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { Trans, useTranslation } from "react-i18next";
import {
  GlobeIcon,
  InfoIcon,
  LaptopIcon,
  RefreshCcwIcon,
  TriangleAlertIcon,
  UsersIcon,
  WifiOffIcon,
} from "lucide-react";

import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import { Banner } from "@/components/ui/banner";
import { useTailscale, type TailscaleStatus } from "@/hooks/use-tailscale";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import { ConnectionCard, ConnectionCardSkeleton } from "./connection-card";
import { RebootDialog } from "./danger-card";
import { DeviceCard, DeviceCardSkeleton } from "./device-card";
import { InstallCard, InstallCardSkeleton } from "./install-card";
import { rememberTailscaleInstalled, useLastKnownInstalled } from "./last-known";
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
  type TailscaleView,
} from "./shapes";
import {
  STATUS_GLYPH,
  StatusBand,
  StatusBandSkeleton,
  TileMono,
  type StatusTileProps,
} from "./status-band";

// -----------------------------------------------------------------------------
// Tailscale — the page shell.
// -----------------------------------------------------------------------------
// Seven backend states, three page shapes: installed (band + pair + peers),
// not installed (one install hero), and unreadable (a condition and
// the peers card, which is a separate read and carries its own state).
// -----------------------------------------------------------------------------

/** Every field after `installed` is optional, so the view goes honest rather
 *  than defaulting a tone in. */
function deriveView(status: TailscaleStatus | null): TailscaleView {
  if (!status) return "unknown";
  if (!status.installed) return "notInstalled";
  // An install or update holds the lock and the CGI sent only that fact, so
  // there is no daemon reading to derive a verdict from.
  if (status.busy && status.daemon_running === undefined) return "unknown";
  if (!(status.daemon_running ?? false)) return "serviceStopped";
  const backend = status.backend_state ?? "";
  if (backend === "NeedsLogin" || backend === "NeedsMachineAuth")
    return "needsLogin";
  if (backend === "Running") return "running";
  return "disconnected";
}

const TailscaleComponent = () => {
  const { t } = useTranslation("common");
  const hook = useTailscale();
  const {
    status,
    isLoading,
    error,
    installResult,
    runInstall,
    refresh,
    uninstall,
    isUninstalling,
    isUpdating,
  } = hook;

  const [showReboot, setShowReboot] = React.useState(false);
  const view = deriveView(status);
  const lastKnownInstalled = useLastKnownInstalled();

  // Only a real read is worth remembering; a busy lock still says "installed".
  const installedNow = status?.installed;
  React.useEffect(() => {
    if (installedNow !== undefined) rememberTailscaleInstalled(installedNow);
  }, [installedNow]);

  const reload = React.useCallback(() => {
    // `refresh` is the hook's fetch; a click event must never reach its argument.
    refresh();
  }, [refresh]);

  const dash = t("tailscale.band.dash");

  const tiles = React.useMemo<StatusTileProps[]>(() => {
    if (!status) return [];

    const self = status.self;
    const tailnet = status.tailnet;
    const ips = self?.tailscale_ips ?? [];
    const ipv4 = ips.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
    const peers = status.backend_state === "Running" ? (status.peers ?? []) : [];
    const online = peers.filter((p) => p.online).length;
    const exitNodes = peers.filter((p) => p.exit_node).length;

    return [
      {
        icon: STATUS_GLYPH[view],
        eyebrow: t("tailscale.band.connectionEyebrow"),
        value: t(STATUS_LABEL_KEY[view]),
        caption: status.version
          ? t("tailscale.band.version", { version: status.version })
          : t("tailscale.band.versionUnknown"),
        discTone:
          view === "running"
            ? "good"
            : view === "needsLogin"
              ? "alert"
              : "neutral",
        valueTone: view === "needsLogin" ? "alert" : "neutral",
      },
      {
        icon: LaptopIcon,
        eyebrow: t("tailscale.band.deviceEyebrow"),
        value: ipv4 ?? dash,
        mono: true,
        caption: self?.hostname ? (
          <TileMono>{self.hostname}</TileMono>
        ) : (
          t("tailscale.band.deviceUnknown")
        ),
      },
      {
        icon: GlobeIcon,
        eyebrow: t("tailscale.band.tailnetEyebrow"),
        value: tailnet?.name || dash,
        mono: true,
        // A personal tailnet's MagicDNS suffix IS its name, so printing it
        // twice says nothing. Name the setting instead.
        caption: !tailnet?.magic_dns_enabled ? (
          t("tailscale.band.magicDnsOff")
        ) : tailnet.magic_dns_suffix &&
          tailnet.magic_dns_suffix !== tailnet.name ? (
          <TileMono>{tailnet.magic_dns_suffix}</TileMono>
        ) : (
          t("tailscale.band.magicDnsOn")
        ),
      },
      {
        icon: UsersIcon,
        eyebrow: t("tailscale.band.peersEyebrow"),
        value: `${online} / ${peers.length}`,
        caption:
          exitNodes > 0
            ? t("tailscale.band.exitNodes", { count: exitNodes })
            : t("tailscale.band.noExitNode"),
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

  // Only one VPN may be installed at a time: while NetBird is present this page
  // states why and offers the way out, instead of controls that cannot work.
  const blockedByOtherVpn = !isLoading && !!status?.other_vpn_installed;
  const legacyBuild =
    !blockedByOtherVpn && !!status?.installed && !!status.legacy_build;

  let body: React.ReactNode;
  if (blockedByOtherVpn) {
    body = (
      <motion.div variants={staggerItem}>
        <Banner
          role="degraded"
          title={t("tailscale.mutex.title")}
          description={
            <Trans
              i18nKey="tailscale.mutex.description"
              ns="common"
              values={{ other_vpn: status?.other_vpn_name }}
              components={{
                link: (
                  <Link
                    href="/monitoring/netbird"
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
          tinyAvailable={status?.tiny_available ?? false}
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
            title={t("tailscale.page.unreadableTitle")}
            description={error ?? t("tailscale.page.unreadable")}
            actionLabel={t("tailscale.actions.retry")}
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
              isTogglingExitNode={hook.isTogglingExitNode}
              isTogglingSsh={hook.isTogglingSsh}
              isUninstalling={isUninstalling}
              isUpdating={isUpdating}
              isTogglingNetFixes={hook.isTogglingNetFixes}
              connect={hook.connect}
              disconnect={hook.disconnect}
              logout={hook.logout}
              startService={hook.startService}
              stopService={hook.stopService}
              setBootEnabled={hook.setBootEnabled}
              setExitNodeAdvertised={hook.setExitNodeAdvertised}
              setSshEnabled={hook.setSshEnabled}
              setNetFixes={hook.setNetFixes}
              uninstall={uninstall}
              onUninstalled={() => setShowReboot(true)}
              onRefresh={reload}
              isRefreshing={isLoading}
            />
          ) : (
            <ConnectionCardSkeleton />
          )}
          {status ? (
            <DeviceCard
              view={view}
              status={status}
              isUpdating={isUpdating}
              installResult={installResult}
              runUpdate={hook.runUpdate}
            />
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
          title={t("tailscale.page.title")}
          description={t("tailscale.page.description")}
        />
      </motion.div>

      {/* The older community build cannot be updated in place, so the way
          forward is stated once, at the top, and stays until it is gone. */}
      {legacyBuild ? (
        <motion.div variants={staggerItem}>
          <Banner
            role="in-progress"
            icon={InfoIcon}
            title={t("tailscale.legacy.title")}
            description={t("tailscale.legacy.description")}
          />
        </motion.div>
      ) : null}

      {/* A failed poll with a payload still in hand is a notice above the
          content, never a replacement for it. While an update restarts the
          daemon the poll is expected to fail, and that is not news. */}
      {error && status && !blockedByOtherVpn && !isUpdating ? (
        <motion.div variants={staggerItem}>
          <div role="alert" className={cn(NOTICE, NOTICE_TONE.destructive)}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            <span className={NOTICE_BODY}>
              {t("tailscale.page.stale", { message: error })}
            </span>
          </div>
        </motion.div>
      ) : null}

      {body}

      {/* Owned here: a successful uninstall flips the surface to its
          not-installed shape, which would unmount the card and the dialog. */}
      <RebootDialog open={showReboot} onOpenChange={setShowReboot} />
    </motion.div>
  );
};

export default TailscaleComponent;
