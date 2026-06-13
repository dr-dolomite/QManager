"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { rebootNow } from "@/lib/reboot";
import { cn } from "@/lib/utils";

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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CopyableCommand } from "@/components/ui/copyable-command";
import {
  Loader2,
  PackageIcon,
  ExternalLinkIcon,
  AlertCircle,
  RefreshCcwIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  MinusCircleIcon,
  LogInIcon,
  Trash2Icon,
} from "lucide-react";
import type { UseTailscaleReturn } from "@/hooks/use-tailscale";

// =============================================================================
// TailscaleConnectionCard — Multi-state connection + settings card
// =============================================================================
// States: Loading → Error → Not Installed → Service Stopped →
//         NeedsLogin → Connected → Disconnected

type TailscaleConnectionCardProps = Omit<UseTailscaleReturn, "refresh"> & {
  refresh: () => void;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function trimDNS(dns: string): string {
  return dns?.replace(/\.$/, "") || "";
}

function getIPv4(ips: string[] | undefined): string {
  return ips?.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) || "—";
}

function getIPv6(ips: string[] | undefined): string {
  return ips?.find((ip) => ip.includes(":")) || "—";
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TailscaleConnectionCard({
  status,
  isLoading,
  isConnecting,
  isDisconnecting,
  isTogglingService,
  isTogglingExitNode,
  isUninstalling,
  installResult,
  error,
  connect,
  disconnect,
  logout,
  startService,
  stopService,
  setBootEnabled,
  setExitNodeAdvertised,
  uninstall,
  runInstall,
  refresh,
}: TailscaleConnectionCardProps) {
  const { t } = useTranslation("monitoring");
  const [showRebootDialog, setShowRebootDialog] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);
  const [installVariant, setInstallVariant] = useState<"official" | "tiny">(
    "official",
  );

  const handleReboot = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsRebooting(true);
    rebootNow("tailscale");
  };

  // Reboot confirmation dialog (shown after successful uninstall)
  // Defined before early returns so it renders in all states including "Not Installed"
  const rebootDialog = (
    <AlertDialog open={showRebootDialog} onOpenChange={(open) => {
      if (!isRebooting) setShowRebootDialog(open);
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("tailscale.reboot_required_title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("tailscale.reboot_required_description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRebooting}>
            {t("tailscale.reboot_later_button")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isRebooting}
            onClick={handleReboot}
          >
            {isRebooting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("tailscale.rebooting_label")}
              </>
            ) : (
              t("tailscale.reboot_now_button")
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // --- Loading skeleton ------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("tailscale.connection_title")}</CardTitle>
          <CardDescription>
            {t("tailscale.connection_description")}
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <div className="grid gap-2">
            <Skeleton className="h-6 w-28" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
            <Skeleton className="h-9 w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error state (initial fetch failed) ------------------------------------
  if (!isLoading && error && !status) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("tailscale.connection_title")}</CardTitle>
          <CardDescription>
            {t("tailscale.connection_description")}
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>{t("tailscale.error_load_status")}</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => refresh()}>
                <RefreshCcwIcon className="size-3.5" />
                {t("actions.retry", { ns: "common" })}
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // --- Not Installed ---------------------------------------------------------
  if (status && !status.installed) {
    const installCmd =
      status.install_hint || t("tailscale.install_command");
    const installing = installResult.status === "running";

    const installVariants = [
      {
        id: "official" as const,
        title: t("tailscale.variant_official_title"),
        desc: t("tailscale.variant_official_description"),
      },
      {
        id: "tiny" as const,
        title: t("tailscale.variant_tiny_title"),
        desc: t("tailscale.variant_tiny_description"),
      },
    ];

    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("tailscale.connection_title")}</CardTitle>
          <CardDescription>
            {t("tailscale.connection_description")}
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <div className="flex flex-col items-center justify-center py-6 gap-4">
            <PackageIcon className="size-10 text-muted-foreground" />
            <div className="text-center space-y-1.5">
              <p className="text-sm font-medium">
                {t("tailscale.not_installed_title")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("tailscale.not_installed_description")}
              </p>
            </div>

            {installResult.status === "complete" && (
              <Alert className="border-success/30 bg-success/5">
                <CheckCircle2Icon className="text-success" />
                <AlertDescription className="text-success">
                  <p>{installResult.message}</p>
                </AlertDescription>
              </Alert>
            )}

            {installResult.status === "error" && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p>
                    {installResult.message}
                    {installResult.detail && (
                      <span className="block text-xs mt-1 opacity-80">
                        {installResult.detail}
                      </span>
                    )}
                  </p>
                </AlertDescription>
              </Alert>
            )}

            <div className="w-full max-w-sm space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t("tailscale.choose_variant_label")}
              </p>
              <RadioGroup
                value={installVariant}
                onValueChange={(v) =>
                  setInstallVariant(v as "official" | "tiny")
                }
                disabled={installing}
                aria-label={t("tailscale.choose_variant_label")}
              >
                {installVariants.map((v) => (
                  <Label
                    key={v.id}
                    htmlFor={`ts-variant-${v.id}`}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-accent/40",
                      installVariant === v.id
                        ? "border-primary bg-primary/5"
                        : "border-border",
                      installing && "opacity-60 pointer-events-none",
                    )}
                  >
                    <RadioGroupItem
                      id={`ts-variant-${v.id}`}
                      value={v.id}
                      className="mt-0.5"
                    />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium leading-none">
                        {v.title}
                      </p>
                      <p className="text-xs text-muted-foreground">{v.desc}</p>
                    </div>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => runInstall(installVariant)}
                disabled={installing}
              >
                {installing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {installResult.message || t("tailscale.installing_label")}
                  </>
                ) : (
                  <>
                    <PackageIcon className="size-4" />
                    {t("tailscale.install_button")}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refresh()}
                disabled={installing}
              >
                <RefreshCcwIcon className="size-3.5" />
                {t("tailscale.check_again_button")}
              </Button>
            </div>

            {installVariant === "tiny" && (
              <>
                <div className="w-full flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  <span>{t("tailscale.install_manually_label")}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <CopyableCommand command={installCmd} />
              </>
            )}
          </div>
          {rebootDialog}
        </CardContent>
      </Card>
    );
  }

  // --- Stale data warning (poll failed but we have previous data) ------------
  const staleWarning = error && status && (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertDescription className="flex items-center justify-between">
        <span className="text-xs">{error}</span>
        <Button variant="outline" size="sm" onClick={() => refresh()}>
          <RefreshCcwIcon className="size-3.5" />
          {t("actions.retry", { ns: "common" })}
        </Button>
      </AlertDescription>
    </Alert>
  );

  // --- From here, Tailscale IS installed -------------------------------------
  const version = status?.version;
  // Installed-variant identity: quiet muted text in the description, never a
  // badge. "opcg" (legacy pre-existing installs) shows nothing.
  const variantLabel =
    status?.install_variant === "tiny"
      ? t("tailscale.variant_tiny_short")
      : status?.install_variant === "official"
        ? t("tailscale.variant_official_short")
        : "";
  // Shared description prefix reused across all installed states to avoid drift.
  const descriptionPrefix = version
    ? `Tailscale v${version}${variantLabel ? ` · ${variantLabel}` : ""} · `
    : "";
  const backendState = status?.backend_state || "";
  const daemonRunning = status?.daemon_running;
  const bootEnabled = status?.enabled_on_boot ?? false;
  const self = status?.self;
  const tailnet = status?.tailnet;
  const health = (status?.health || []).filter(
    (msg) => !msg.includes("--accept-routes"),
  );
  const authUrl = status?.auth_url;

  // Boot toggle handler
  const handleBootToggle = async (checked: boolean) => {
    const success = await setBootEnabled(checked);
    if (success) {
      toast.success(
        checked
          ? t("tailscale.toast_service_started")
          : t("tailscale.toast_service_stopped"),
      );
    } else {
      toast.error(t("tailscale.boot_toggle_error"));
    }
  };

  // Boot toggle element (reused across states)
  const bootToggle = (
    <>
      <Separator />
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-muted-foreground">
          {t("tailscale.boot_toggle_label")}
        </p>
        <Switch
          checked={bootEnabled}
          onCheckedChange={handleBootToggle}
          aria-label={t("tailscale.boot_toggle_label")}
        />
      </div>
    </>
  );

  // Uninstall section (follows Email Alerts / Video Optimizer pattern)
  const uninstallSection = (
    <>
      <Separator className="mt-4" />
      <div className="flex items-center justify-between pt-4">
        <div>
          <p className="text-sm font-medium">{t("tailscale.remove_title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("tailscale.remove_description")}
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
              disabled={isUninstalling}
            >
              {isUninstalling ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("tailscale.removing_label")}
                </>
              ) : (
                <>
                  <Trash2Icon className="size-4" />
                  {t("tailscale.uninstall_button")}
                </>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("tailscale.uninstall_confirm_title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("tailscale.uninstall_confirm_description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  const success = await uninstall();
                  if (success) {
                    toast.success(t("tailscale.toast_uninstalled"));
                    setShowRebootDialog(true);
                  } else {
                    toast.error(t("tailscale.toast_uninstall_error"));
                  }
                }}
              >
                {t("tailscale.uninstall_confirm_button")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );

  // --- Service Stopped -------------------------------------------------------
  if (!daemonRunning) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("tailscale.connection_title")}</CardTitle>
          <CardDescription>
            {descriptionPrefix}{t("tailscale.connection_description")}
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <div className="grid gap-2">
            {staleWarning}
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-muted-foreground">
                {t("tailscale.label_service")}
              </p>
              <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-muted-foreground/30">
                <MinusCircleIcon className="size-3" />
                {t("tailscale.badge_stopped")}
              </Badge>
            </div>
            {bootToggle}
            <Separator />
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button
                onClick={async () => {
                  const success = await startService();
                  if (success) {
                    toast.success(t("tailscale.toast_service_started"));
                  } else {
                    toast.error(t("tailscale.toast_service_start_error"));
                  }
                }}
                disabled={isTogglingService}
              >
                {isTogglingService ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("tailscale.starting_label")}
                  </>
                ) : (
                  t("tailscale.service_start_button")
                )}
              </Button>
            </div>
            {uninstallSection}
            {rebootDialog}
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Needs Login -----------------------------------------------------------
  if (backendState === "NeedsLogin" || backendState === "NeedsMachineAuth") {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("tailscale.connection_title")}</CardTitle>
          <CardDescription>
            {descriptionPrefix}{t("tailscale.connection_description")}
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <div className="grid gap-2">
            {staleWarning}
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-muted-foreground">
                {t("tailscale.label_status")}
              </p>
              <Badge variant="outline" className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30">
                <LogInIcon className="size-3" />
                {t("tailscale.badge_needs_login")}
              </Badge>
            </div>

            {authUrl ? (
              <>
                <Separator />
                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertDescription className="space-y-3">
                    <p>
                      {t("tailscale.needs_login_description")}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(authUrl, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLinkIcon className="size-3.5" />
                      {t("tailscale.open_login_page_button")}
                    </Button>
                    <p className="text-xs text-muted-foreground animate-pulse motion-reduce:animate-none">
                      {t("tailscale.waiting_for_auth")}
                    </p>
                  </AlertDescription>
                </Alert>
              </>
            ) : (
              <>
                <Separator />
                <div className="pt-1">
                  <Button
                    onClick={async () => {
                      const success = await connect();
                      if (!success) {
                        toast.error(t("tailscale.toast_connect_error"));
                      }
                    }}
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        {t("tailscale.connecting_label")}
                      </>
                    ) : (
                      t("tailscale.login_button")
                    )}
                  </Button>
                </div>
              </>
            )}

            {bootToggle}
            <Separator />
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const success = await stopService();
                  if (success) {
                    toast.success(t("tailscale.toast_service_stopped"));
                  } else {
                    toast.error(t("tailscale.toast_service_stop_error"));
                  }
                }}
                disabled={isTogglingService}
              >
                {isTogglingService ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("tailscale.stopping_label")}
                  </>
                ) : (
                  t("tailscale.service_stop_button")
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Connected (Running) ---------------------------------------------------
  if (backendState === "Running") {
    const ipv4 = getIPv4(self?.tailscale_ips);
    const ipv6 = getIPv6(self?.tailscale_ips);
    const dnsName = trimDNS(self?.dns_name || "");
    const magicSuffix = tailnet?.magic_dns_enabled
      ? tailnet.magic_dns_suffix
      : "";

    const infoRows: { label: string; value: React.ReactNode }[] = [
      { label: t("tailscale.status_label_hostname"), value: self?.hostname || "—" },
      {
        label: t("tailscale.status_label_ipv4"),
        value: <span className="font-mono">{ipv4}</span>,
      },
      ...(ipv6 !== "—"
        ? [
            {
              label: t("tailscale.status_label_ipv6"),
              value: (
                <span className="font-mono break-all">{ipv6}</span>
              ),
            },
          ]
        : []),
      ...(dnsName
        ? [
            {
              label: t("tailscale.status_label_dns"),
              value: <span className="break-all">{dnsName}</span>,
            },
          ]
        : []),
      ...(tailnet?.name ? [{ label: t("tailscale.status_label_tailnet"), value: tailnet.name }] : []),
      ...(magicSuffix
        ? [
            {
              label: t("tailscale.status_label_magic_dns"),
              value: <span className="font-mono">{magicSuffix}</span>,
            },
          ]
        : []),
      ...(self?.relay
        ? [
            {
              label: t("tailscale.status_label_derp_relay"),
              value: self.relay.toUpperCase(),
            },
          ]
        : []),
    ];

    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("tailscale.connection_title")}</CardTitle>
          <CardDescription>
            {descriptionPrefix}{t("tailscale.connection_description")}
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <div className="grid gap-2">
            {staleWarning}
            {/* Boot toggle */}
            {bootToggle}
            {/* Health warnings */}
            {health.length > 0 && (
              <>
                <Separator />
                <Alert variant="destructive">
                  <AlertTriangleIcon className="size-4" />
                  <AlertTitle>{t("tailscale.health_warnings_title")}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 text-xs space-y-1">
                      {health.map((msg, i) => (
                        <li key={i}>{msg}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              </>
            )}

            <Separator />

            {/* Status badge */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-muted-foreground">
                {t("tailscale.label_status")}
              </p>
              <Badge variant="outline" className="bg-success/15 text-success hover:bg-success/20 border-success/30">
                <CheckCircle2Icon className="size-3" />
                {t("tailscale.badge_connected")}
              </Badge>
            </div>

            {/* Info rows */}
            {infoRows.map((row, i) => (
              <React.Fragment key={row.label}>
                <Separator />
                <motion.div
                  className="flex items-center justify-between gap-2"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.05, 0.35), ease: "easeOut" }}
                >
                  <p className="text-sm font-semibold text-muted-foreground shrink-0">
                    {row.label}
                  </p>
                  <p className="text-sm font-semibold text-right min-w-0 break-all">
                    {row.value}
                  </p>
                </motion.div>
              </React.Fragment>
            ))}

            {/* Exit node toggle (Connected only) */}
            <Separator />
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-muted-foreground">
                  {t("tailscale.exit_node_label")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("tailscale.exit_node_description")}
                </p>
              </div>
              <Switch
                checked={status?.exit_node_advertised ?? false}
                onCheckedChange={() =>
                  setExitNodeAdvertised(!(status?.exit_node_advertised ?? false))
                }
                disabled={isTogglingExitNode}
                aria-label={t("tailscale.exit_node_label")}
              />
            </div>

            {/* Actions */}
            <Separator />
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const success = await disconnect();
                  if (success) {
                    toast.success(t("tailscale.toast_disconnected"));
                  } else {
                    toast.error(t("tailscale.toast_disconnect_error"));
                  }
                }}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("tailscale.disconnecting_label")}
                  </>
                ) : (
                  t("tailscale.disconnect_button")
                )}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isDisconnecting}
                  >
                    {t("tailscale.logout_button")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("tailscale.logout_confirm_title")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("tailscale.logout_confirm_description")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        const success = await logout();
                        if (success) {
                          toast.success(t("tailscale.toast_logged_out"));
                        } else {
                          toast.error(t("tailscale.toast_logout_error"));
                        }
                      }}
                    >
                      {t("tailscale.logout_button")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Disconnected (Stopped backend state) ----------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("tailscale.connection_title")}</CardTitle>
        <CardDescription>
          {version ? `Tailscale v${version} · ` : ""}{t("tailscale.connection_description")}
        </CardDescription>
      </CardHeader>
      <CardContent aria-live="polite">
        <div className="grid gap-2">
          {staleWarning}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">
              {t("tailscale.label_status")}
            </p>
            <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-muted-foreground/30">
              <MinusCircleIcon className="size-3" />
              {t("tailscale.badge_disconnected")}
            </Badge>
          </div>

          {bootToggle}

          <Separator />
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Button
              onClick={async () => {
                const success = await connect();
                if (!success) {
                  toast.error(t("tailscale.toast_connect_retry_error"));
                }
              }}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("tailscale.connecting_label")}
                </>
              ) : (
                t("tailscale.connect_button")
              )}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isDisconnecting}
                >
                  {t("tailscale.logout_button")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("tailscale.logout_confirm_title")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("tailscale.logout_confirm_description")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      const success = await logout();
                      if (success) {
                        toast.success(t("tailscale.toast_logged_out"));
                      } else {
                        toast.error(t("tailscale.toast_logout_error"));
                      }
                    }}
                  >
                    {t("tailscale.logout_button")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          {uninstallSection}
          {rebootDialog}
        </div>
      </CardContent>
    </Card>
  );
}
