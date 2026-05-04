"use client";

import { useState, useEffect, type FormEvent, type ChangeEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { InfoIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useIpPassthrough } from "@/hooks/use-ip-passthrough";
import { useActiveProfile } from "@/hooks/use-active-profile";
import type {
  PassthroughMode,
  DnsProxy,
  IpptNat,
  UsbMode,
} from "@/types/ip-passthrough";

// MAC source: "automatic" = FF:FF:FF:FF:FF:FF (first connected device), "manual" = text input
type MacSource = "automatic" | "manual";

// Local-only types — descriptive strings avoid Radix Select "0"-as-falsy bug
type NatMode = "nat-on" | "nat-off";
type UsbModeLocal = "rmnet" | "ecm" | "mbim" | "rndis";

const USB_MODE_TO_API: Record<UsbModeLocal, string> = {
  rmnet: "0",
  ecm: "1",
  mbim: "2",
  rndis: "3",
};
const USB_MODE_FROM_API: Record<string, UsbModeLocal> = {
  "0": "rmnet",
  "1": "ecm",
  "2": "mbim",
  "3": "rndis",
};

const IPPassthroughCard = () => {
  const { t } = useTranslation("local-network");
  const {
    passthroughMode,
    targetMac,
    ipptNat,
    usbMode,
    dnsProxy,
    isLoading,
    isSaving,
    error,
    saveSettings,
    refresh,
  } = useIpPassthrough();
  const { activeProfile, isVerizonActive, isLoading: isProfileLoading } = useActiveProfile();
  const { saved, markSaved } = useSaveFlash();

  // Local form state — NatMode and UsbModeLocal use descriptive strings to
  // avoid Radix Select treating "0" as falsy and showing the placeholder
  const [localMode, setLocalMode] = useState<PassthroughMode>("disabled");
  const [localMacSource, setLocalMacSource] = useState<MacSource>("automatic");
  const [localMacInput, setLocalMacInput] = useState<string>("");
  const [localIpptNat, setLocalIpptNat] = useState<NatMode | "">("");
  const [localUsbMode, setLocalUsbMode] = useState<UsbModeLocal>("ecm");
  const [localDnsProxy, setLocalDnsProxy] = useState<DnsProxy>("disabled");

  // Pre-save confirmation dialog
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Sync form state when server data arrives
  useEffect(() => {
    if (passthroughMode !== null) setLocalMode(passthroughMode);
    if (ipptNat !== null) setLocalIpptNat(ipptNat === "1" ? "nat-on" : "nat-off");
    if (usbMode !== null) setLocalUsbMode(USB_MODE_FROM_API[usbMode] ?? "ecm");
    if (dnsProxy !== null) setLocalDnsProxy(dnsProxy);

    // Initialise MAC source only when mode is active
    if (
      passthroughMode !== null &&
      passthroughMode !== "disabled" &&
      targetMac !== null
    ) {
      if (targetMac === "" || targetMac === "FF:FF:FF:FF:FF:FF") {
        setLocalMacSource("automatic");
        setLocalMacInput("");
      } else {
        setLocalMacSource("manual");
        setLocalMacInput(targetMac);
      }
    }
  }, [passthroughMode, targetMac, ipptNat, usbMode, dnsProxy]);

  // Resolved MAC to send to backend
  const resolvedMac =
    localMacSource === "automatic" ? "FF:FF:FF:FF:FF:FF" : localMacInput;

  const macRequired = localMode !== "disabled";
  const macValid =
    !macRequired ||
    localMacSource === "automatic" ||
    /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(localMacInput);

  const resetToServer = () => {
    if (passthroughMode !== null) setLocalMode(passthroughMode);
    if (ipptNat !== null) setLocalIpptNat(ipptNat === "1" ? "nat-on" : "nat-off");
    if (usbMode !== null) setLocalUsbMode(USB_MODE_FROM_API[usbMode] ?? "ecm");
    if (dnsProxy !== null) setLocalDnsProxy(dnsProxy);

    if (passthroughMode !== "disabled" && targetMac) {
      if (targetMac === "" || targetMac === "FF:FF:FF:FF:FF:FF") {
        setLocalMacSource("automatic");
        setLocalMacInput("");
      } else {
        setLocalMacSource("manual");
        setLocalMacInput(targetMac);
      }
    } else {
      setLocalMacSource("automatic");
      setLocalMacInput("");
    }
  };

  // Step 1: validate → open confirm dialog
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (!macValid) {
      toast.error(t("ippt.error_invalid_mac"));
      return;
    }

    setShowConfirmDialog(true);
  };

  // Step 2: user confirmed → apply + reboot
  const handleConfirmedApply = async () => {
    setShowConfirmDialog(false);

    const success = await saveSettings({
      passthrough_mode: localMode,
      target_mac: macRequired ? resolvedMac : "",
      ippt_nat: (localIpptNat === "nat-on" ? "1" : "0") as IpptNat,
      usb_mode: USB_MODE_TO_API[localUsbMode] as UsbMode,
      dns_proxy: localDnsProxy,
    });

    if (success) {
      markSaved();
      toast.success(t("ippt.toast_success_apply"));
    } else {
      toast.error(t("ippt.toast_error_apply"));
    }
  };

  // Format MAC input: strip non-hex, uppercase, insert colons every 2 chars
  const handleMacInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
    const formatted = raw.match(/.{1,2}/g)?.join(":") ?? raw;
    setLocalMacInput(formatted.slice(0, 17));
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("ippt.card_title")}</CardTitle>
          <CardDescription>{t("ippt.card_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-9" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("ippt.card_title")}</CardTitle>
        <CardDescription>{t("ippt.card_description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!isProfileLoading && isVerizonActive && (
          <Alert className="mb-4 bg-info/15 text-info border-info/30">
            <InfoIcon className="size-4" />
            <AlertTitle>{t("ippt.locked_by_verizon.title")}</AlertTitle>
            <AlertDescription>
              <p>
                {t("ippt.locked_by_verizon.body", { name: activeProfile?.name ?? "" })}
              </p>
              <p className="mt-1">
                <Link
                  href="/cellular/custom-profiles"
                  className="underline underline-offset-2 font-medium"
                >
                  {t("ippt.locked_by_verizon.cta")}
                </Link>
              </p>
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 mb-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-destructive hover:text-destructive"
              onClick={refresh}
            >
              {t("actions.retry", { ns: "common" })}
            </Button>
          </div>
        )}
        <fieldset disabled={!isProfileLoading && isVerizonActive}>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
                  {/* Field 1: Passthrough Mode */}
                  <Field>
                    <FieldLabel>{t("ippt.label_passthrough_mode")}</FieldLabel>
                    <Select
                      name="ippt_mode"
                      value={localMode}
                      onValueChange={(v) => setLocalMode(v as PassthroughMode)}
                      disabled={isSaving}
                    >
                      <SelectTrigger aria-label={t("ippt.aria_passthrough_mode")}>
                        <SelectValue placeholder={t("ippt.placeholder_mode")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">
                          {t("ippt.option_mode_disabled_router")}
                        </SelectItem>
                        <SelectItem value="eth">{t("ippt.option_mode_eth")}</SelectItem>
                        <SelectItem value="usb">{t("ippt.option_mode_usb")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  {/* Field 2: Target Device MAC (hidden when disabled) */}
                  <Field>
                    <FieldLabel>{t("ippt.label_target_device_mac")}</FieldLabel>
                    <AnimatePresence mode="wait">
                      {localMode === "disabled" ? (
                        <motion.div
                          key="mac-disabled"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Select disabled>
                            <SelectTrigger aria-label={t("ippt.aria_target_device_mac")}>
                              <SelectValue placeholder={t("ippt.placeholder_mac_router_mode")} />
                            </SelectTrigger>
                            <SelectContent />
                          </Select>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="mac-active"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="flex flex-col gap-2"
                        >
                          <Select
                            name="mac_source"
                            value={localMacSource}
                            onValueChange={(v) =>
                              setLocalMacSource(v as MacSource)
                            }
                            disabled={isSaving}
                          >
                            <SelectTrigger aria-label={t("ippt.aria_mac_source")} className="w-full">
                              <SelectValue placeholder={t("ippt.placeholder_mac_source")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="automatic">
                                {t("ippt.option_mac_automatic")}
                              </SelectItem>
                              <SelectItem value="manual">
                                {t("ippt.option_mac_manual")}
                              </SelectItem>
                            </SelectContent>
                          </Select>

                          {/* Manual MAC text input */}
                          <AnimatePresence mode="wait">
                            {localMacSource === "manual" && (
                              <motion.div
                                key="manual-mac-input"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{
                                  duration: 0.3,
                                  ease: [0.16, 1, 0.3, 1],
                                }}
                              >
                                <Input
                                  aria-label={t("ippt.aria_mac_address")}
                                  placeholder={t("ippt.placeholder_mac_manual")}
                                  className="font-mono uppercase placeholder:normal-case"
                                  value={localMacInput}
                                  onChange={handleMacInputChange}
                                  maxLength={17}
                                  disabled={isSaving}
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                  {t("ippt.helper_mac_manual")}
                                </p>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Field>
                </div>

                <div className="grid @md/card:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  {/* Field 3: IPPT NAT Mode */}
                  <Field>
                    <FieldLabel>{t("ippt.label_nat_mode")}</FieldLabel>
                    <Select
                      value={
                        localIpptNat ||
                        (ipptNat !== null
                          ? ipptNat === "1"
                            ? "nat-on"
                            : "nat-off"
                          : "")
                      }
                      onValueChange={(v) => setLocalIpptNat(v as NatMode)}
                      disabled={isSaving}
                    >
                      <SelectTrigger aria-label={t("ippt.aria_nat_mode")}>
                        <SelectValue placeholder={t("ippt.placeholder_nat_mode")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nat-on">
                          {t("ippt.option_nat_on")}
                        </SelectItem>
                        <SelectItem value="nat-off">{t("ippt.option_nat_off")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  {/* Field 4: USB Modem Protocol */}
                  <Field>
                    <FieldLabel>{t("ippt.label_usb_mode")}</FieldLabel>
                    <Select
                      value={localUsbMode}
                      onValueChange={(v) => setLocalUsbMode(v as UsbModeLocal)}
                      disabled={isSaving}
                    >
                      <SelectTrigger aria-label={t("ippt.aria_usb_mode")}>
                        <SelectValue placeholder={t("ippt.placeholder_usb_mode")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rmnet">{t("ippt.option_usb_rmnet")}</SelectItem>
                        <SelectItem value="ecm">{t("ippt.option_usb_ecm")}</SelectItem>
                        <SelectItem value="mbim">{t("ippt.option_usb_mbim")}</SelectItem>
                        <SelectItem value="rndis">{t("ippt.option_usb_rndis")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <div className="grid @md/card:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  {/* Field 5: DNS Offloading */}
                  <Field>
                    <FieldLabel>{t("ippt.label_dns_proxy")}</FieldLabel>
                    <Select
                      name="dns_mode"
                      value={localDnsProxy}
                      onValueChange={(v) => setLocalDnsProxy(v as DnsProxy)}
                      disabled={isSaving}
                    >
                      <SelectTrigger aria-label={t("ippt.aria_dns_proxy")}>
                        <SelectValue placeholder={t("ippt.placeholder_dns_proxy")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">
                          {t("ippt.option_dns_disabled")}
                        </SelectItem>
                        <SelectItem value="enabled">
                          {t("ippt.option_dns_enabled")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </FieldGroup>
            </FieldSet>
          </div>

          <div className="flex items-center gap-x-2">
            <SaveButton
              type="submit"
              isSaving={isSaving}
              saved={saved}
              disabled={!macValid}
            />
            <Button
              type="button"
              variant="outline"
              onClick={resetToServer}
              disabled={isSaving}
              aria-label={t("ippt.aria_reset")}
            >
              <RotateCcwIcon />
            </Button>
          </div>
        </form>
        </fieldset>

        {/* Pre-save confirmation dialog */}
        <AlertDialog
          open={showConfirmDialog}
          onOpenChange={setShowConfirmDialog}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("ippt.dialog_title")}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>{t("ippt.dialog_desc_reboot_notice")}</p>
                  {localMode !== "disabled" && (
                    <p className="font-medium text-foreground">
                      {t("ippt.dialog_desc_unreachable_warning")}
                    </p>
                  )}
                  <p>{t("ippt.dialog_desc_persistence")}</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmedApply}>
                {t("ippt.button_apply_reboot")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};

export default IPPassthroughCard;
