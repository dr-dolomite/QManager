"use client";

import React, { useState, useMemo } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { HintIcon } from "@/components/ui/hint-icon";
import { Skeleton } from "@/components/ui/skeleton";

import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import {
  nrCarriersFromQcainfo,
  defaultScsForBand,
  compositeValue,
  parseCompositeValue,
  type CarrierOption,
} from "./simple-mode-utils";
import { CarrierLabel } from "./carrier-label";

import type {
  TowerLockConfig,
  TowerModemState,
  NrSaLockCell,
} from "@/types/tower-locking";
import type { ModemStatus, NetworkType } from "@/types/modem-status";
import { SCS_OPTIONS } from "@/types/tower-locking";

interface NRSALockingProps {
  config: TowerLockConfig | null;
  modemState: TowerModemState | null;
  modemData: ModemStatus | null;
  networkType: NetworkType | string;
  isLoading: boolean;
  isLocking: boolean;
  isWatcherRunning: boolean;
  onLock: (cell: NrSaLockCell) => Promise<boolean>;
  onUnlock: () => Promise<boolean>;
}

const STORAGE_KEY_NR_SIMPLE_MODE = "qmanager_tower_nr_simple_mode";

type ScsSource = "manual" | "band_default" | "servingcell";

const NRSALockingComponent = ({
  config,
  modemState,
  modemData,
  networkType,
  isLoading,
  isLocking,
  isWatcherRunning,
  onLock,
  onUnlock,
}: NRSALockingProps) => {
  const { t } = useTranslation("cellular");

  // Local form state
  const [arfcn, setArfcn] = useState("");
  const [pci, setPci] = useState("");
  const [band, setBand] = useState("");
  const [scs, setScs] = useState("");
  const [prevNrSa, setPrevNrSa] = useState(config?.nr_sa);

  // Simple Mode state (persisted to localStorage)
  const [simpleMode, setSimpleMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY_NR_SIMPLE_MODE) === "true";
  });

  const [scsSource, setScsSource] = useState<ScsSource>("manual");

  const handleSimpleModeToggle = (on: boolean) => {
    setSimpleMode(on);
    setScsSource("manual");
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_NR_SIMPLE_MODE, String(on));
    }
  };

  // Confirmation dialog state
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [pendingCell, setPendingCell] = useState<NrSaLockCell | null>(null);

  // Sync form from config when data loads (render-time update avoids effect cascade)
  if (config?.nr_sa !== prevNrSa) {
    setPrevNrSa(config?.nr_sa);
    if (config?.nr_sa) {
      if (config.nr_sa.arfcn !== null) setArfcn(String(config.nr_sa.arfcn));
      if (config.nr_sa.pci !== null) setPci(String(config.nr_sa.pci));
      if (config.nr_sa.band !== null) setBand(String(config.nr_sa.band));
      if (config.nr_sa.scs !== null) setScs(String(config.nr_sa.scs));
    }
  }

  // Derive carrier options for Simple Mode
  const carrierOptions = useMemo<CarrierOption[]>(
    () => (modemData ? nrCarriersFromQcainfo(modemData) : []),
    [modemData],
  );
  const hasOptions = carrierOptions.length > 0;

  const handleCarrierPick = (value: string) => {
    const parsed = parseCompositeValue(value);
    if (!parsed) return;
    const opt = carrierOptions.find(
      (o) => o.earfcn === parsed.earfcn && o.pci === parsed.pci,
    );
    if (!opt) return;

    setArfcn(String(opt.earfcn));
    setPci(String(opt.pci));
    setBand(String(opt.bandNumber));

    // SCS resolution: trust live serving cell when picking the PCC.
    const liveScs = modemData?.nr?.scs ?? null;
    const liveArfcn = modemData?.nr?.arfcn ?? null;
    const livePci = modemData?.nr?.pci ?? null;
    const isLiveServingCell =
      liveArfcn === opt.earfcn && livePci === opt.pci && liveScs !== null;

    if (isLiveServingCell) {
      setScs(String(liveScs));
      setScsSource("servingcell");
    } else {
      const fallback = defaultScsForBand(opt.bandNumber);
      setScs(fallback !== null ? String(fallback) : "");
      setScsSource("band_default");
    }
  };

  const currentArfcnComposite = useMemo(() => {
    const aNum = parseInt(arfcn, 10);
    const pNum = parseInt(pci, 10);
    if (Number.isNaN(aNum) || Number.isNaN(pNum)) return "";
    return compositeValue(aNum, pNum);
  }, [arfcn, pci]);

  const arfcnInList = useMemo(
    () =>
      carrierOptions.find(
        (o) => compositeValue(o.earfcn, o.pci) === currentArfcnComposite,
      ),
    [carrierOptions, currentArfcnComposite],
  );

  // Derive enabled state from modem state or config
  const isEnabled = modemState?.nr_locked ?? config?.nr_sa?.enabled ?? false;

  // NSA mode gating — NR-SA locking not available in NSA or LTE-only mode
  const isNsaMode = networkType === "5G-NSA";
  const isLteOnly = networkType === "LTE";
  const isCardDisabled = isNsaMode || isLteOnly;
  const isDisabled = isCardDisabled || isLocking;

  const handleToggle = (checked: boolean) => {
    if (checked && isWatcherRunning) {
      toast.warning(t("cell_locking.tower_locking.nr_sa.toast.failover_in_progress_title"), {
        description: t("cell_locking.tower_locking.nr_sa.toast.failover_in_progress_description"),
      });
      return;
    }
    if (checked) {
      const parsedArfcn = parseInt(arfcn, 10);
      const parsedPci = parseInt(pci, 10);
      const parsedBand = parseInt(band, 10);
      const parsedScs = parseInt(scs, 10);

      if (
        Number.isNaN(parsedArfcn) ||
        Number.isNaN(parsedPci) ||
        Number.isNaN(parsedBand) ||
        Number.isNaN(parsedScs)
      ) {
        toast.warning(t("cell_locking.tower_locking.nr_sa.toast.incomplete_title"), {
          description: t("cell_locking.tower_locking.nr_sa.toast.incomplete_description"),
        });
        return;
      }

      const cell: NrSaLockCell = {
        arfcn: parsedArfcn,
        pci: parsedPci,
        band: parsedBand,
        scs: parsedScs,
      };
      setPendingCell(cell);
      setShowLockDialog(true);
    } else {
      setShowUnlockDialog(true);
    }
  };

  const confirmLock = async () => {
    setShowLockDialog(false);
    if (pendingCell) {
      const success = await onLock(pendingCell);
      if (success) {
        toast.success(t("cell_locking.tower_locking.nr_sa.toast.lock_success"));
      } else {
        toast.error(t("cell_locking.tower_locking.nr_sa.toast.lock_error"));
      }
    }
  };

  const confirmUnlock = async () => {
    setShowUnlockDialog(false);
    const success = await onUnlock();
    if (success) {
      toast.success(t("cell_locking.tower_locking.nr_sa.toast.unlock_success"));
    } else {
      toast.error(t("cell_locking.tower_locking.nr_sa.toast.unlock_error"));
    }
  };

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("cell_locking.tower_locking.nr_sa.title")}</CardTitle>
          <CardDescription>
            {t("cell_locking.tower_locking.nr_sa.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Skeleton className="size-5 rounded-full" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
            <Separator />
            <div className="grid gap-4 mt-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className={`@container/card ${isCardDisabled ? "opacity-60" : ""}`}>
        <CardHeader>
          <CardTitle>{t("cell_locking.tower_locking.nr_sa.title")}</CardTitle>
          <CardDescription>
            {t("cell_locking.tower_locking.nr_sa.description")}
            {isNsaMode && t("cell_locking.tower_locking.nr_sa.description_suffix_nsa_mode")}
            {isLteOnly && t("cell_locking.tower_locking.nr_sa.description_suffix_lte_only")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <HintIcon
                    label={t("cell_locking.tower_locking.nr_sa.simple_mode.info_aria")}
                    variant="muted"
                    size="sm"
                  >
                    {hasOptions
                      ? t("cell_locking.tower_locking.nr_sa.simple_mode.info_tooltip")
                      : t("cell_locking.tower_locking.nr_sa.simple_mode.empty_tooltip")}
                  </HintIcon>

                  <p className="font-medium text-muted-foreground text-sm">
                    {t("cell_locking.tower_locking.nr_sa.simple_mode.toggle_label")}
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  {isLocking ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : null}
                  <Switch
                    id="nr-sa-simple-mode"
                    aria-label={t("cell_locking.tower_locking.nr_sa.simple_mode.switch_aria")}
                    checked={simpleMode && hasOptions}
                    onCheckedChange={handleSimpleModeToggle}
                    disabled={!hasOptions || isDisabled}
                  />
                  <Label htmlFor="nr-sa-simple-mode">
                    {simpleMode && hasOptions
                      ? t("state.on", { ns: "common" })
                      : t("state.off", { ns: "common" })}
                  </Label>
                </div>
              </div>
              {!hasOptions && (
                <p className="text-xs text-muted-foreground">
                  {t("cell_locking.tower_locking.nr_sa.simple_mode.empty_tooltip")}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <HintIcon
                  label={t("cell_locking.tower_locking.nr_sa.enabled_info_aria")}
                >
                  {t("cell_locking.tower_locking.nr_sa.enabled_tooltip")}
                </HintIcon>
                <p className="font-semibold text-muted-foreground text-sm">
                  {t("cell_locking.tower_locking.nr_sa.enabled_label")}
                </p>
              </div>
              <div className="flex items-center space-x-2">
                {isLocking ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : null}
                <Switch
                  id="nr-sa-tower-locking"
                  aria-label={t("cell_locking.tower_locking.nr_sa.enabled_label")}
                  checked={isEnabled}
                  onCheckedChange={handleToggle}
                  disabled={isDisabled}
                />
                <Label htmlFor="nr-sa-tower-locking">
                  {isEnabled ? t("state.enabled", { ns: "common" }) : t("state.disabled", { ns: "common" })}
                </Label>
              </div>
            </div>
            <Separator />
            <div className="grid gap-4 mt-6">
              <div className="w-full">
                <FieldSet>
                  <FieldGroup>
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="nrarfcn1">{t("cell_locking.tower_locking.nr_sa.arfcn_label")}</FieldLabel>
                        {simpleMode && hasOptions ? (
                          <Select
                            value={arfcnInList ? currentArfcnComposite : ""}
                            onValueChange={handleCarrierPick}
                            disabled={isDisabled}
                          >
                            <SelectTrigger id="nrarfcn1" className="w-full">
                              {arfcnInList ? (
                                <SelectValue />
                              ) : arfcn && pci ? (
                                <span
                                  className="min-w-0 italic text-muted-foreground line-clamp-1"
                                  title={t("cell_locking.tower_locking.nr_sa.simple_mode.custom_value_label", {
                                    arfcn,
                                    pci,
                                  })}
                                >
                                  {t("cell_locking.tower_locking.nr_sa.simple_mode.custom_value_label", {
                                    arfcn,
                                    pci,
                                  })}
                                </span>
                              ) : (
                                <SelectValue placeholder={t("cell_locking.tower_locking.nr_sa.simple_mode.select_placeholder")} />
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              {carrierOptions.map((opt) => {
                                const value = compositeValue(opt.earfcn, opt.pci);
                                return (
                                  <SelectItem key={value} value={value}>
                                    <CarrierLabel opt={opt} />
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            id="nrarfcn1"
                            type="text"
                            placeholder={t("cell_locking.tower_locking.nr_sa.arfcn_placeholder")}
                            value={arfcn}
                            onChange={(e) => setArfcn(e.target.value)}
                            disabled={isDisabled}
                          />
                        )}
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="nrpci">{t("cell_locking.tower_locking.nr_sa.pci_label")}</FieldLabel>
                        <Input
                          id="nrpci"
                          type="text"
                          placeholder={t("cell_locking.tower_locking.nr_sa.pci_placeholder")}
                          value={pci}
                          onChange={(e) => setPci(e.target.value)}
                          disabled={isDisabled}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="nr-band">{t("cell_locking.tower_locking.nr_sa.band_label")}</FieldLabel>
                        <Input
                          id="nr-band"
                          type="text"
                          placeholder={t("cell_locking.tower_locking.nr_sa.band_placeholder")}
                          value={band}
                          onChange={(e) => setBand(e.target.value)}
                          disabled={isDisabled}
                        />
                      </Field>
                      <Field>
                        <div className="flex items-center justify-between gap-2">
                          <FieldLabel htmlFor="scs">{t("cell_locking.tower_locking.nr_sa.scs_label")}</FieldLabel>
                          {simpleMode && scsSource === "band_default" && band && (
                            <HintIcon
                              label={t("cell_locking.tower_locking.nr_sa.simple_mode.scs_warning_aria")}
                              variant="warning"
                              size="sm"
                            >
                              {t("cell_locking.tower_locking.nr_sa.simple_mode.scs_band_default_warning", {
                                band,
                              })}
                            </HintIcon>
                          )}
                        </div>
                        <Select
                          value={scs}
                          onValueChange={(v) => {
                            setScs(v);
                            setScsSource("manual");
                          }}
                          disabled={isDisabled}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("cell_locking.tower_locking.nr_sa.scs_placeholder")} />
                          </SelectTrigger>
                          <SelectContent>
                            {SCS_OPTIONS.map((opt) => (
                              <SelectItem
                                key={opt.value}
                                value={String(opt.value)}
                              >
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  </FieldGroup>
                </FieldSet>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lock confirmation dialog */}
      <AlertDialog open={showLockDialog} onOpenChange={setShowLockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cell_locking.tower_locking.nr_sa.lock_dialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cell_locking.tower_locking.nr_sa.lock_dialog.description", {
                arfcn: pendingCell?.arfcn,
                pci: pendingCell?.pci,
                band: pendingCell?.band,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLock}>
              {t("cell_locking.tower_locking.nr_sa.lock_dialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unlock confirmation dialog */}
      <AlertDialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cell_locking.tower_locking.nr_sa.unlock_dialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cell_locking.tower_locking.nr_sa.unlock_dialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnlock}>
              {t("cell_locking.tower_locking.nr_sa.unlock_dialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default NRSALockingComponent;
