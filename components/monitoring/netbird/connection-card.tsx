"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CheckIcon,
  Loader2Icon,
  RefreshCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import type { NetBirdActionResult, NetBirdStatus } from "@/hooks/use-netbird";
import { cn } from "@/lib/utils";

import { UninstallButton } from "./danger-card";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_ACTIONS,
  CARD_HEAD_TEXT,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD,
  HEAD_TAG,
  NOTICE,
  NOTICE_BODY,
  NOTICE_GLYPH,
  NOTICE_TONE,
  RAIL,
  SKELETON,
  SWITCH_ROW,
  type NetbirdView,
} from "./shapes";

// -----------------------------------------------------------------------------
// Connection — what the link is doing, the boot setting, and the action rail.
// -----------------------------------------------------------------------------

export interface ConnectionCardProps {
  view: NetbirdView;
  status: NetBirdStatus;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isTogglingService: boolean;
  isTogglingBoot: boolean;
  isUninstalling: boolean;
  connect: (setupKey?: string) => Promise<NetBirdActionResult>;
  disconnect: () => Promise<NetBirdActionResult>;
  startService: () => Promise<NetBirdActionResult>;
  stopService: () => Promise<NetBirdActionResult>;
  setBootEnabled: (enabled: boolean) => Promise<NetBirdActionResult>;
  uninstall: () => Promise<NetBirdActionResult>;
  onUninstalled: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

/** The lucide check that SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/** A setting's tonal tile: rest is a surface container, on is a primary one.
 *  The control is an On/Off pill group, never a bare switch. */
function SettingRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const { t } = useTranslation("monitoring");
  return (
    <div
      className={cn(
        SWITCH_ROW.ROOT,
        SWITCH_ROW.TRANSITION,
        checked ? SWITCH_ROW.ON : SWITCH_ROW.REST,
      )}
    >
      <div className={SWITCH_ROW.TEXT}>
        <p className={SWITCH_ROW.TITLE}>{title}</p>
        <p className={SWITCH_ROW.DESC}>{description}</p>
      </div>
      <SegmentedField
        value={checked ? "on" : "off"}
        onValueChange={(next) => onChange(next === "on")}
        ariaLabel={title}
        disabled={disabled}
        breakpoint="never"
        glyph={renderCheckGlyph}
        options={[
          { value: "off", label: t("netbird.connection.off") },
          { value: "on", label: t("netbird.connection.on") },
        ]}
      />
    </div>
  );
}

export function ConnectionCard({
  view,
  status,
  isConnecting,
  isDisconnecting,
  isTogglingService,
  isTogglingBoot,
  isUninstalling,
  connect,
  disconnect,
  startService,
  stopService,
  setBootEnabled,
  uninstall,
  onUninstalled,
  onRefresh,
  isRefreshing,
}: ConnectionCardProps) {
  const { t } = useTranslation("monitoring");
  const [setupKey, setSetupKey] = React.useState("");

  const version = status.version;
  const bootEnabled = status.enabled_on_boot ?? false;
  const errorDetail = status.error_detail;

  const handleBoot = async (checked: boolean) => {
    const result = await setBootEnabled(checked);
    if (result.success) {
      toast.success(
        checked
          ? t("netbird.toast.bootEnabled")
          : t("netbird.toast.bootDisabled"),
      );
    } else {
      toast.error(result.error || t("netbird.toast.bootFailed"));
    }
  };

  const run = async (
    action: () => Promise<NetBirdActionResult>,
    successKey: string,
    errorKey: string,
  ) => {
    const result = await action();
    if (result.success) toast.success(t(successKey));
    else toast.error(result.error || t(errorKey));
  };

  const handleConnect = async () => {
    const key = setupKey.trim();
    const result = await connect(key || undefined);
    if (result.success) {
      setSetupKey("");
      toast.success(t("netbird.toast.connected"));
    } else {
      toast.error(result.error || t("netbird.toast.connectFailed"));
    }
  };

  const busyGlyph = <Loader2Icon className="size-4 motion-safe:animate-spin" />;

  // Uninstall sits at the rail's trailing edge and is offered only while the
  // link is not live, so it is never one click from Disconnect.
  const uninstallButton = (
    <UninstallButton
      className="ml-auto"
      isUninstalling={isUninstalling}
      uninstall={uninstall}
      onUninstalled={onUninstalled}
    />
  );

  const stopButton = (
    <Button
      type="button"
      variant="tonal"
      size="action"
      disabled={isTogglingService}
      onClick={() =>
        run(stopService, "netbird.toast.serviceStopped", "netbird.toast.serviceStopFailed")
      }
    >
      {isTogglingService ? busyGlyph : null}
      {isTogglingService
        ? t("netbird.connection.stopping")
        : t("netbird.connection.stopService")}
    </Button>
  );

  let rail: React.ReactNode;
  if (view === "serviceStopped") {
    rail = (
      <>
        <Button
          type="button"
          size="action"
          disabled={isTogglingService}
          onClick={() =>
            run(startService, "netbird.toast.serviceStarted", "netbird.toast.serviceStartFailed")
          }
        >
          {isTogglingService ? busyGlyph : null}
          {isTogglingService
            ? t("netbird.connection.starting")
            : t("netbird.connection.startService")}
        </Button>
        {uninstallButton}
      </>
    );
  } else if (view === "connected") {
    rail = (
      <>
        <Button
          type="button"
          size="action"
          disabled={isDisconnecting}
          onClick={() =>
            run(disconnect, "netbird.toast.disconnected", "netbird.toast.disconnectFailed")
          }
        >
          {isDisconnecting ? busyGlyph : null}
          {isDisconnecting
            ? t("netbird.connection.disconnecting")
            : t("netbird.connection.disconnect")}
        </Button>
        {stopButton}
      </>
    );
  } else {
    rail = (
      <>
        <Button
          type="button"
          size="action"
          disabled={isConnecting}
          onClick={handleConnect}
        >
          {isConnecting ? busyGlyph : null}
          {isConnecting
            ? t("netbird.connection.connecting")
            : t("netbird.connection.connect")}
        </Button>
        {stopButton}
        {uninstallButton}
      </>
    );
  }

  const showKey = view === "disconnected" || view === "unknown";

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("netbird.connection.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("netbird.connection.description")}
          </CardDescription>
        </div>
        <div className={CARD_HEAD_ACTIONS}>
          {version ? (
            <Tag variant="neutral" className={cn(HEAD_TAG, "font-mono")}>
              {t("netbird.connection.version", { version })}
            </Tag>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label={t("netbird.page.refresh")}
            title={t("netbird.page.refresh")}
          >
            <RefreshCcwIcon
              className={cn(
                "size-4",
                isRefreshing && "motion-safe:animate-spin",
              )}
            />
          </Button>
        </div>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {errorDetail && view !== "connected" ? (
          <div role="alert" className={cn(NOTICE, NOTICE_TONE.warning)}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            <span className={NOTICE_BODY}>{errorDetail}</span>
          </div>
        ) : null}

        <SettingRow
          title={t("netbird.connection.bootTitle")}
          description={t("netbird.connection.bootDescription")}
          checked={bootEnabled}
          disabled={isTogglingBoot}
          onChange={handleBoot}
        />

        {showKey ? (
          <div className={FIELD.ROOT}>
            <label htmlFor="netbird-setup-key" className={FIELD.LABEL}>
              {t("netbird.connection.setupKeyLabel")}
            </label>
            <Input
              id="netbird-setup-key"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("netbird.connection.setupKeyPlaceholder")}
              value={setupKey}
              onChange={(e) => setSetupKey(e.target.value)}
              disabled={isConnecting}
              className="font-mono text-xs"
            />
            <p className={FIELD.HELP}>
              {t("netbird.connection.setupKeyHelp")}
            </p>
          </div>
        ) : null}

        <div className={RAIL}>{rail}</div>
      </CardContent>
    </Card>
  );
}

/** Mirrors the loaded card's header structure and its setting tile, both from
 *  the same constants, so the swap moves nothing. */
export function ConnectionCardSkeleton() {
  const { t } = useTranslation("monitoring");
  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("netbird.connection.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("netbird.connection.description")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, CARD_BODY)} aria-hidden>
        <Skeleton className={SKELETON.SWITCH} />
        <Skeleton className={cn(SKELETON.ACTION, "w-40")} />
      </CardContent>
    </Card>
  );
}
