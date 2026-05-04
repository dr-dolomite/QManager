"use client";

import React, { useState, useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TbInfoCircleFilled } from "react-icons/tb";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  PercentIcon,
  CheckCircle2Icon,
  TriangleAlertIcon,
  XCircleIcon,
  MinusCircleIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

import type {
  TowerLockConfig,
  TowerFailoverState,
} from "@/types/tower-locking";
import type { ModemStatus } from "@/types/modem-status";
import { rsrpToQualityPercent, qualityLevel } from "@/types/tower-locking";

interface TowerLockingSettingsProps {
  config: TowerLockConfig | null;
  failoverState: TowerFailoverState | null;
  modemData: ModemStatus | null;
  isLoading: boolean;
  onPersistChange: (persist: boolean) => void;
  onFailoverChange: (enabled: boolean) => void;
  onThresholdChange: (threshold: number) => Promise<boolean>;
}

const TowerLockingSettingsComponent = ({
  config,
  failoverState,
  modemData,
  isLoading,
  onPersistChange,
  onFailoverChange,
  onThresholdChange,
}: TowerLockingSettingsProps) => {
  const { t } = useTranslation("cellular");
  // Whether any tower lock is active (from config — matches what failover daemon checks)
  const hasActiveLock = (config?.lte?.enabled || config?.nr_sa?.enabled) ?? false;
  const scheduleEnabled = config?.schedule?.enabled ?? false;

  // Local state for threshold input
  const [thresholdInput, setThresholdInput] = useState<string>("");
  const [isSavingThreshold, setIsSavingThreshold] = useState(false);
  const { saved: thresholdSaved, markSaved: markThresholdSaved } = useSaveFlash();

  // Sync threshold from config (adjust state during render)
  const [prevThreshold, setPrevThreshold] = useState<number | undefined>(
    undefined,
  );
  if (
    config?.failover?.threshold !== undefined &&
    config.failover.threshold !== prevThreshold
  ) {
    setPrevThreshold(config.failover.threshold);
    setThresholdInput(String(config.failover.threshold));
  }

  // Whether the input differs from the saved config value
  const thresholdDirty =
    thresholdInput !== String(config?.failover?.threshold ?? "");

  // Save threshold via Update button
  const handleThresholdSave = useCallback(async () => {
    const val = parseInt(thresholdInput, 10);
    if (isNaN(val) || val < 0 || val > 100) return;
    setIsSavingThreshold(true);
    const ok = await onThresholdChange(val);
    setIsSavingThreshold(false);
    if (ok) {
      markThresholdSaved();
      toast.success(t("cell_locking.tower_locking.settings.threshold_toast_success"));
    }
  }, [thresholdInput, onThresholdChange, markThresholdSaved, t]);

  // --- Determine which RSRP to use based on network type ---
  const networkType = modemData?.network?.type ?? "";
  let activeRsrp: number | null = null;
  let activeEarfcn: number | string = "-";
  let activePci: number | string = "-";

  if (networkType === "5G-SA") {
    activeRsrp = modemData?.nr?.rsrp ?? null;
    activeEarfcn = modemData?.nr?.arfcn ?? "-";
    activePci = modemData?.nr?.pci ?? "-";
  } else {
    // LTE or 5G-NSA — use LTE PCell
    activeRsrp = modemData?.lte?.rsrp ?? null;
    activeEarfcn = modemData?.lte?.earfcn ?? "-";
    activePci = modemData?.lte?.pci ?? "-";
  }

  const signalQualityPct = rsrpToQualityPercent(activeRsrp);
  const qualityLvl = qualityLevel(signalQualityPct);

  // --- Signal quality badge styling ---
  const qualityBadgeStyles: Record<string, string> = {
    good: "bg-success/15 text-success hover:bg-success/20 border-success/30",
    fair: "bg-warning/15 text-warning hover:bg-warning/20 border-warning/30",
    poor: "bg-warning/15 text-warning hover:bg-warning/20 border-warning/30",
    critical:
      "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30",
    none: "bg-muted/50 text-muted-foreground border-muted-foreground/30",
  };

  const qualityIcons: Record<string, React.ReactNode> = {
    good: <CheckCircle2Icon className="h-3 w-3" />,
    fair: <TriangleAlertIcon className="h-3 w-3" />,
    poor: <TriangleAlertIcon className="h-3 w-3" />,
    critical: <XCircleIcon className="h-3 w-3" />,
    none: null,
  };

  // --- Failover status badge ---
  const renderFailoverBadge = () => {
    // Show loading only during initial load; after that show a fallback
    if (!failoverState && isLoading) {
      return (
        <Badge
          variant="outline"
          className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("cell_locking.tower_locking.settings.failover_badge.loading")}
        </Badge>
      );
    }

    if (!failoverState) {
      return (
        <Badge
          variant="outline"
          className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
        >
          <MinusCircleIcon className="h-3 w-3" />
          {t("cell_locking.tower_locking.settings.failover_badge.unknown")}
        </Badge>
      );
    }

    if (failoverState.watcher_running) {
      return (
        <Badge
          variant="outline"
          className="bg-success/15 text-success hover:bg-success/20 border-success/30"
        >
          <CheckCircle2Icon className="h-3 w-3" />
          {t("cell_locking.tower_locking.settings.failover_badge.monitoring")}
        </Badge>
      );
    }

    if (failoverState.activated) {
      return (
        <Badge
          variant="outline"
          className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30"
        >
          <TriangleAlertIcon className="h-3 w-3" />
          {t("cell_locking.tower_locking.settings.failover_badge.unlocked_poor_signal")}
        </Badge>
      );
    }

    if (!failoverState.enabled) {
      return (
        <Badge
          variant="outline"
          className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
        >
          <MinusCircleIcon className="h-3 w-3" />
          {t("cell_locking.tower_locking.settings.failover_badge.disabled")}
        </Badge>
      );
    }

    return (
      <Badge
        variant="outline"
        className="bg-success/15 text-success hover:bg-success/20 border-success/30"
      >
        <CheckCircle2Icon className="h-3 w-3" />
        {t("cell_locking.tower_locking.settings.failover_badge.ready")}
      </Badge>
    );
  };

  // --- Schedule status badge ---
  const renderScheduleBadge = () => {
    // Show loading only during initial load; after that show a fallback
    if (!config && isLoading) {
      return (
        <Badge
          variant="outline"
          className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("cell_locking.tower_locking.settings.schedule_badge.loading")}
        </Badge>
      );
    }

    if (!config) {
      return (
        <Badge
          variant="outline"
          className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
        >
          <MinusCircleIcon className="h-3 w-3" />
          {t("cell_locking.tower_locking.settings.schedule_badge.unknown")}
        </Badge>
      );
    }

    if (scheduleEnabled) {
      return (
        <Badge
          variant="outline"
          className="bg-success/15 text-success hover:bg-success/20 border-success/30"
        >
          <CheckCircle2Icon className="h-3 w-3" />
          {t("cell_locking.tower_locking.settings.schedule_badge.active")}
        </Badge>
      );
    }

    return (
      <Badge
        variant="outline"
        className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
      >
        <MinusCircleIcon className="h-3 w-3" />
        {t("cell_locking.tower_locking.settings.schedule_badge.inactive")}
      </Badge>
    );
  };

  // --- Connection state badge ---
  const renderConnectionStateBadge = () => {
    const serviceStatus = modemData?.network?.service_status;

    if (!modemData && isLoading) {
      return (
        <Badge
          variant="outline"
          className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("cell_locking.tower_locking.settings.connection_badge.loading")}
        </Badge>
      );
    }

    if (!modemData || !serviceStatus) {
      return (
        <Badge
          variant="outline"
          className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
        >
          <MinusCircleIcon className="h-3 w-3" />
          {t("cell_locking.tower_locking.settings.connection_badge.unknown")}
        </Badge>
      );
    }

    switch (serviceStatus) {
      case "optimal":
      case "connected":
        return (
          <Badge
            variant="outline"
            className="bg-success/15 text-success hover:bg-success/20 border-success/30"
          >
            <CheckCircle2Icon className="h-3 w-3" />
            {t("cell_locking.tower_locking.settings.connection_badge.connected")}
          </Badge>
        );
      case "limited":
        return (
          <Badge
            variant="outline"
            className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30"
          >
            <TriangleAlertIcon className="h-3 w-3" />
            {t("cell_locking.tower_locking.settings.connection_badge.limited")}
          </Badge>
        );
      case "searching":
        return (
          <Badge
            variant="outline"
            className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30"
          >
            <TriangleAlertIcon className="h-3 w-3" />
            {t("cell_locking.tower_locking.settings.connection_badge.searching")}
          </Badge>
        );
      case "no_service":
        return (
          <Badge
            variant="outline"
            className="bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30"
          >
            <XCircleIcon className="h-3 w-3" />
            {t("cell_locking.tower_locking.settings.connection_badge.no_service")}
          </Badge>
        );
      default:
        return (
          <Badge
            variant="outline"
            className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
          >
            {serviceStatus}
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("cell_locking.tower_locking.settings.title")}</CardTitle>
          <CardDescription>
            {t("cell_locking.tower_locking.settings.description_loading")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            {/* Persist Locking */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Separator />
            {/* Failover */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Separator />
            {/* Failover Threshold */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
            <Separator />
            {/* Current Signal Quality */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Separator />
            {/* Failover Status */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Separator />
            {/* Connection State */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Separator />
            {/* Schedule Locking Status */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Separator />
            {/* Active PCell E/AFRCN */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-12" />
            </div>
            <Separator />
            {/* Active PCell ID (PCI) */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-12" />
            </div>
            <Separator />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("cell_locking.tower_locking.settings.title")}</CardTitle>
        <CardDescription>
          {t("cell_locking.tower_locking.settings.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex" aria-label={t("cell_locking.tower_locking.settings.persist_info_aria")}>
                    <TbInfoCircleFilled className="size-5 text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {t("cell_locking.tower_locking.settings.persist_tooltip")}
                  </p>
                </TooltipContent>
              </Tooltip>
              <span className="font-semibold text-muted-foreground text-sm">
                {t("cell_locking.tower_locking.settings.persist_label")}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="tower-persist"
                checked={config?.persist ?? false}
                disabled={!config}
                onCheckedChange={onPersistChange}
              />
              <Label htmlFor="tower-persist">
                {config?.persist
                  ? t("state.enabled", { ns: "common" })
                  : t("state.disabled", { ns: "common" })}
              </Label>
            </div>
          </div>
          <Separator />
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="inline-flex" aria-label={t("cell_locking.tower_locking.settings.failover_info_aria")}>
                      <TbInfoCircleFilled className="size-5 text-info" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {t("cell_locking.tower_locking.settings.failover_tooltip")}
                    </p>
                  </TooltipContent>
                </Tooltip>
                <span className="font-semibold text-muted-foreground text-sm">
                  {t("cell_locking.tower_locking.settings.failover_label")}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="tower-failover"
                  checked={config?.failover?.enabled ?? false}
                  disabled={!config || !hasActiveLock}
                  onCheckedChange={(checked) => {
                    onFailoverChange(checked);
                    if (!checked) {
                      toast.warning(t("cell_locking.tower_locking.settings.failover_toast_disabled"));
                    }
                  }}
                />
                <Label htmlFor="tower-failover">
                  {!hasActiveLock
                    ? t("cell_locking.tower_locking.settings.failover_no_lock")
                    : (config?.failover?.enabled ?? false)
                      ? t("state.enabled", { ns: "common" })
                      : t("state.disabled", { ns: "common" })}
                </Label>
              </div>
            </div>
            {hasActiveLock && !(config?.failover?.enabled ?? false) && (
              <p className="text-xs text-muted-foreground pl-6">
                {t("cell_locking.tower_locking.settings.failover_hint")}
              </p>
            )}
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex" aria-label={t("cell_locking.tower_locking.settings.threshold_info_aria")}>
                    <TbInfoCircleFilled className="size-5 text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {t("cell_locking.tower_locking.settings.threshold_tooltip")}
                  </p>
                </TooltipContent>
              </Tooltip>
              <label
                htmlFor="failover-threshold"
                className="font-semibold text-muted-foreground text-sm"
              >
                {t("cell_locking.tower_locking.settings.threshold_label")}
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <InputGroup>
                <InputGroupInput
                  id="failover-threshold"
                  type="text"
                  placeholder={t("cell_locking.tower_locking.settings.threshold_placeholder")}
                  className="w-10 h-6"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleThresholdSave();
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <PercentIcon />
                </InputGroupAddon>
              </InputGroup>
              {(thresholdDirty || thresholdSaved) && (
                <SaveButton
                  size="sm"
                  className="h-8"
                  isSaving={isSavingThreshold}
                  saved={thresholdSaved}
                  label={t("cell_locking.tower_locking.settings.threshold_update")}
                  disabled={thresholdInput !== "" && (isNaN(Number(thresholdInput)) || Number(thresholdInput) < 0 || Number(thresholdInput) > 100)}
                  onClick={handleThresholdSave}
                />
              )}
            </div>
            {thresholdInput !== "" && (isNaN(Number(thresholdInput)) || Number(thresholdInput) < 0 || Number(thresholdInput) > 100) && (
              <p className="text-sm text-destructive" role="alert">
                {t("cell_locking.tower_locking.settings.threshold_error_range")}
              </p>
            )}
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">
              {t("cell_locking.tower_locking.settings.signal_quality_label")}
            </span>
            <div className="flex items-center gap-1.5">
              <Badge
                variant="outline"
                className={qualityBadgeStyles[qualityLvl]}
              >
                {qualityIcons[qualityLvl]}
                {activeRsrp !== null ? `${signalQualityPct}%` : "N/A"}
              </Badge>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">
              {t("cell_locking.tower_locking.settings.failover_status_label")}
            </span>
            <div className="flex items-center gap-1.5">
              {renderFailoverBadge()}
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">
              {t("cell_locking.tower_locking.settings.connection_state_label")}
            </span>
            <div className="flex items-center gap-1.5">
              {renderConnectionStateBadge()}
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">
              {t("cell_locking.tower_locking.settings.schedule_status_label")}
            </span>
            <div className="flex items-center gap-1.5">
              {renderScheduleBadge()}
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">
              {t("cell_locking.tower_locking.settings.earfcn_label")}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold">
                {activeEarfcn !== null ? String(activeEarfcn) : "-"}
              </span>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">
              {t("cell_locking.tower_locking.settings.pci_label")}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold">
                {activePci !== null ? String(activePci) : "-"}
              </span>
            </div>
          </div>
          <Separator />
        </div>
      </CardContent>
    </Card>
  );
};

export default TowerLockingSettingsComponent;
