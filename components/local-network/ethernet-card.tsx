"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Image from "next/image";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { CgEthernet } from "react-icons/cg";
import {
  RefreshCcwIcon,
  Loader2,
  AlertCircle,
  CheckIcon,
  CheckCircle2Icon,
  XCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSaveFlash } from "@/components/ui/save-button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { AnimatedBeam } from "../ui/animated-beam";
import { Separator } from "../ui/separator";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/ethernet.sh";

interface EthernetStatus {
  link_status: string;
  speed: string;
  duplex: string;
  auto_negotiation: string;
  speed_limit: string;
  supports_2500?: boolean;
}

const EthernetStatusCard = () => {
  const { t } = useTranslation("local-network");
  const [status, setStatus] = useState<EthernetStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { saved, markSaved } = useSaveFlash();

  const containerRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<HTMLDivElement>(null);
  const ringsRef = useRef<HTMLDivElement>(null);
  const ethernetRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const hasDataRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch ethernet status
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (data.success) {
        hasDataRef.current = true;
        setError(null);
        setStatus({
          link_status: data.link_status,
          speed: data.speed,
          duplex: data.duplex,
          auto_negotiation: data.auto_negotiation,
          speed_limit: data.speed_limit,
          supports_2500: data.supports_2500,
        });
      }
    } catch {
      // Only surface errors when we have no data to show
      if (mountedRef.current && !hasDataRef.current) {
        setError(t("ethernet.error_unable_to_reach"));
      }
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    fetchStatus();

    const interval = setInterval(() => {
      fetchStatus(true);
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // Set link speed limit
  // ---------------------------------------------------------------------------
  const handleSpeedChange = async (value: string) => {
    setIsSaving(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speed_limit: value }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (data.success) {
        markSaved();
        toast.success(t("ethernet.toast_speed_updated"));

        // Backend reports how long the PHY link bounce takes. Fall back to
        // 5 s if the field is missing (older builds / non-ethtool paths).
        const windowSec =
          typeof data.disconnect_window_seconds === "number"
            ? data.disconnect_window_seconds
            : 5;

        // Wait for the quiet period, then poll silently until we see a
        // definitive status (link up + known speed) or the timeout elapses.
        // Some 2.5G negotiations take longer than 5 s; keep retrying rather
        // than latching onto a momentary "Unknown" reading.
        await new Promise((resolve) => setTimeout(resolve, windowSec * 1000));

        const MAX_POLLS = 6;
        const POLL_INTERVAL_MS = 1500;
        for (let i = 0; i < MAX_POLLS; i++) {
          if (!mountedRef.current) return;
          try {
            const pollResp = await authFetch(CGI_ENDPOINT);
            if (pollResp.ok) {
              const pollData = await pollResp.json();
              if (!mountedRef.current) return;
              if (
                pollData.success &&
                pollData.link_status === "up" &&
                pollData.speed &&
                pollData.speed !== "Unknown"
              ) {
                setStatus({
                  link_status: pollData.link_status,
                  speed: pollData.speed,
                  duplex: pollData.duplex,
                  auto_negotiation: pollData.auto_negotiation,
                  speed_limit: pollData.speed_limit,
                  supports_2500: pollData.supports_2500,
                });
                setError(null);
                hasDataRef.current = true;
                return;
              }
            }
          } catch {
            // Swallow — PHY may still be renegotiating; retry.
          }
          if (i < MAX_POLLS - 1) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          }
        }

        // Poll loop exhausted — fall back to a normal refetch so the card
        // reflects whatever state we can observe (may show "Unknown").
        if (mountedRef.current) {
          await fetchStatus(true);
        }
      } else {
        toast.error(resolveErrorMessage(t, undefined, data.detail, t("ethernet.toast_error_set_speed")));
      }
    } catch {
      if (mountedRef.current) {
        toast.error(t("ethernet.toast_error_set_speed"));
      }
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const isConnected = status?.link_status === "up";

  // Colors based on connection state
  const ringColors = isConnected
    ? {
        outer: "bg-success/15",
        mid: "bg-success/25",
        inner: "bg-success/40",
        center: "bg-success",
      }
    : {
        outer: "bg-muted-foreground/10",
        mid: "bg-muted-foreground/15",
        inner: "bg-muted-foreground/25",
        center: "bg-muted-foreground/50",
      };

  // Resolve CSS custom properties to computed values for SVG stopColor
  const beamColors = useMemo(() => {
    if (typeof document === "undefined") {
      return { start: "#3b82f6", stop: "#22c55e" };
    }
    const styles = getComputedStyle(document.documentElement);
    const primary = styles.getPropertyValue("--primary").trim();
    const success = styles.getPropertyValue("--success").trim();
    const muted = styles.getPropertyValue("--muted-foreground").trim();

    return isConnected
      ? { start: primary || "#3b82f6", stop: success || "#22c55e" }
      : { start: muted || "#9ca3af", stop: muted || "#6b7280" };
  }, [isConnected]);

  // Format display values
  const formatSpeed = (speed: string) => {
    if (!speed || speed === "Unknown") return "N/A";
    // If already formatted like "1000Mb/s", convert to friendlier display
    const match = speed.match(/^(\d+)Mb\/s$/);
    if (match) {
      const mbps = parseInt(match[1], 10);
      if (mbps >= 1000) return `${mbps / 1000} Gbps`;
      return `${mbps} Mbps`;
    }
    return speed;
  };

  const formatDuplex = (duplex: string) => {
    if (!duplex || duplex === "Unknown") return "N/A";
    return duplex.charAt(0).toUpperCase() + duplex.slice(1);
  };

  const formatAutoNeg = (autoNeg: string) => {
    if (!autoNeg || autoNeg === "Unknown") return "N/A";
    return autoNeg === "on"
      ? t("shared.status_active")
      : t("shared.status_inactive");
  };

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("ethernet.card_title")}</CardTitle>
          <CardDescription>
            {t("ethernet.card_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid space-y-6">
            <div className="flex items-center justify-between">
              <Skeleton className="size-16 @xs/card:size-32 rounded-full" />
              <Skeleton className="size-12 @xs/card:size-24 rounded-full" />
              <Skeleton className="size-16 @xs/card:size-32 rounded-full" />
            </div>
            <div className="grid gap-2 w-full">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state (only when no data has ever loaded)
  // ---------------------------------------------------------------------------
  if (error && !status) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("ethernet.card_title")}</CardTitle>
          <CardDescription>
            {t("ethernet.card_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
            <AlertCircle className="size-10 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">{error}</p>
              <p className="text-sm text-muted-foreground">
                {t("ethernet.error_load_failed")}
              </p>
            </div>
            <Button variant="outline" onClick={() => fetchStatus()}>
              <RefreshCcwIcon className="mr-2 size-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t("ethernet.card_title")}</CardTitle>
            <CardDescription>
              {t("ethernet.card_description")}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("ethernet.aria_refresh")}
            onClick={() => fetchStatus()}
            disabled={isSaving}
          >
            <RefreshCcwIcon className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid space-y-6">
          <div
            ref={containerRef}
            className="relative flex items-center justify-between"
          >
            <div
              ref={deviceRef}
              className="size-16 @xs/card:size-24 bg-primary/15 rounded-full p-3 @xs/card:p-4 flex items-center justify-center"
            >
              <img
                src="/device-icon.png"
                alt={t("ethernet.alt_device_icon")}
                className="size-full drop-shadow-md object-contain"
                loading="lazy"
              />
            </div>

            <div
              ref={ringsRef}
              className="relative flex items-center justify-center size-12 @xs/card:size-24"
            >
              {/* Outer rings - pulsating when connected, static when disconnected */}
              <div
                className={`absolute rounded-full size-12 @xs/card:size-24 ${ringColors.outer} ${
                  isConnected ? "animate-pulse-ring" : ""
                }`}
              />
              <div
                className={`absolute rounded-full size-9 @xs/card:size-16 ${ringColors.mid} ${
                  isConnected ? "animate-pulse-ring" : ""
                }`}
                style={isConnected ? { animationDelay: "0.3s" } : undefined}
              />
              <div
                className={`absolute rounded-full size-6 @xs/card:size-12 ${ringColors.inner} ${
                  isConnected ? "animate-pulse-ring" : ""
                }`}
                style={isConnected ? { animationDelay: "0.6s" } : undefined}
              />
              {/* Center circle */}
              <div
                className={`relative rounded-full size-4 ${ringColors.center}`}
              />
            </div>

            <div
              ref={ethernetRef}
              className={`size-16 @xs/card:size-24 rounded-full p-3 @xs/card:p-6 flex items-center justify-center ${
                isConnected ? "bg-primary" : "bg-muted-foreground/50"
              }`}
            >
              <CgEthernet className="size-full text-primary-foreground" />
            </div>

            {/* Animated beams connecting the elements */}
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={deviceRef}
              toRef={ringsRef}
              duration={2}
              pathWidth={3}
              gradientStartColor={beamColors.start}
              gradientStopColor={beamColors.stop}
              startXOffset={72}
              endXOffset={-56}
            />
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={ringsRef}
              toRef={ethernetRef}
              duration={2}
              pathWidth={3}
              gradientStartColor={beamColors.stop}
              gradientStopColor={beamColors.start}
              startXOffset={56}
              endXOffset={-72}
            />
          </div>
          <div className="grid gap-2 w-full">
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                {t("ethernet.label_link_status")}
              </p>
              {isConnected ? (
                <Badge
                  variant="outline"
                  className="bg-success/15 text-success hover:bg-success/20 border-success/30"
                >
                  <CheckCircle2Icon className="h-3 w-3" />
                  {t("ethernet.badge_connected")}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30"
                >
                  <XCircleIcon className="h-3 w-3" />
                  {t("ethernet.badge_disconnected")}
                </Badge>
              )}
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                {t("ethernet.label_auto_negotiation")}
              </p>
              <p className="font-semibold @sm/card:text-base text-sm">
                {formatAutoNeg(status?.auto_negotiation ?? "")}
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                {t("ethernet.label_active_link_speed")}
              </p>
              <p className="font-semibold @sm/card:text-base text-sm">
                {isConnected ? formatSpeed(status?.speed ?? "") : "N/A"}
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                {t("ethernet.label_duplex")}
              </p>
              <p className="font-semibold @sm/card:text-base text-sm">
                {isConnected ? formatDuplex(status?.duplex ?? "") : "N/A"}
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                {t("ethernet.label_set_link_speed")}
              </p>
              <Select
                value={status?.speed_limit ?? "auto"}
                onValueChange={handleSpeedChange}
                disabled={isSaving}
              >
                <SelectTrigger
                  aria-label={t("ethernet.aria_set_link_speed")}
                  className="w-full max-w-[50%] font-semibold text-muted-foreground @sm/card:text-base text-sm"
                >
                  {isSaving ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t("state.applying", { ns: "common" })}
                    </span>
                  ) : saved ? (
                    <span className="flex items-center gap-2">
                      <CheckIcon className="h-3 w-3" />
                      {t("ethernet.badge_saved")}
                    </span>
                  ) : (
                    <SelectValue placeholder={t("ethernet.placeholder_link_speed")} />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                    <SelectLabel>{t("ethernet.select_label_link_speed")}</SelectLabel>
                    <SelectItem value="auto">{t("ethernet.option_auto_max_speed")}</SelectItem>
                    <SelectItem value="10">{t("ethernet.option_speed_10")}</SelectItem>
                    <SelectItem value="100">{t("ethernet.option_speed_100")}</SelectItem>
                    <SelectItem value="1000">{t("ethernet.option_speed_1000")}</SelectItem>
                    {status?.supports_2500 ? (
                      <SelectItem value="2500">{t("ethernet.option_speed_2500")}</SelectItem>
                    ) : null}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <Separator />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default EthernetStatusCard;
