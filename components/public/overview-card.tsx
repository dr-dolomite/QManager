"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import {
  CheckCircle2Icon,
  Loader2Icon,
  MinusCircleIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { usePublicOverview } from "@/hooks/use-public-overview";
import {
  deriveConnectionLabel,
  formatCarrierComponents,
  formatUptime,
} from "@/lib/public-overview/format";
import type { CarrierComponentRow } from "@/lib/public-overview/format";
import { getSignalQuality, RSRP_THRESHOLDS } from "@/types/modem-status";
import type { ConnectionState } from "@/types/modem-status";
import { useEffect } from "react";

// ---------- Connection badge mapping ---------------------------------------

interface BadgeStyle {
  classes: string;
  Icon: LucideIcon;
  spin?: boolean;
}

function badgeStyleFor(label: ConnectionState | "modem_unreachable"): BadgeStyle {
  switch (label) {
    case "connected":
      return {
        classes:
          "bg-success/15 text-success hover:bg-success/20 border-success/30",
        Icon: CheckCircle2Icon,
      };
    case "limited":
      return {
        classes:
          "bg-warning/15 text-warning hover:bg-warning/20 border-warning/30",
        Icon: TriangleAlertIcon,
      };
    case "searching":
      return {
        classes: "bg-info/15 text-info hover:bg-info/20 border-info/30",
        Icon: Loader2Icon,
        spin: true,
      };
    case "inactive":
    case "unknown":
      return {
        classes:
          "bg-muted/50 text-muted-foreground border-muted-foreground/30",
        Icon: MinusCircleIcon,
      };
    case "disconnected":
    case "error":
    case "modem_unreachable":
    default:
      return {
        classes:
          "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30",
        Icon: XCircleIcon,
      };
  }
}

// ---------- Component ------------------------------------------------------

export default function OverviewCard() {
  const { t } = useTranslation("common");
  const { data, isLoading, isStale, error, refresh } = usePublicOverview();
  // Honor prefers-reduced-motion (WCAG 2.3.3) — vestibular-sensitive users
  // get a static card instead of the slide+fade entrance.
  const reduceMotion = useReducedMotion();

  // Setup gate: bounce to /setup/ on a fresh-install device.
  useEffect(() => {
    if (data?.state === "setup_required") {
      window.location.href = "/setup/";
    }
  }, [data]);

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={
        reduceMotion ? { duration: 0 } : { duration: 0.3, ease: "easeOut" }
      }
    >
      <Card className="@container/overview w-full">
        <CardHeader className="justify-items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-md p-1">
            {/* Decorative: the adjacent CardTitle ("Welcome to QManager")
                already names the product for screen readers. Matches the
                logo treatment in components/auth/login-component.tsx. */}
            <img
              src="/qmanager-logo.svg"
              alt=""
              aria-hidden="true"
              className="size-full"
            />
          </div>
          <CardTitle as="h1">{t("overview.title")}</CardTitle>
          <CardDescription>{t("overview.tagline")}</CardDescription>
        </CardHeader>

        <CardContent>
          {renderBody({ data, isLoading, isStale, error, t, refresh })}
        </CardContent>

        {/* Primary CTA in the footer with copyright underneath — conventional
            shadcn pattern; keeps content above the fold and the chrome below. */}
        <CardFooter className="flex flex-col gap-3">
          <Button asChild className="w-full">
            <Link href="/login/">{t("overview.login_button")}</Link>
          </Button>
          <p className="text-muted-foreground text-xs">
            {t("overview.copyright", { year: new Date().getFullYear() })}
          </p>
        </CardFooter>
      </Card>
    </motion.div>
  );
}

// ---------- Body renderer --------------------------------------------------

interface BodyProps {
  data: ReturnType<typeof usePublicOverview>["data"];
  isLoading: boolean;
  isStale: boolean;
  error: string | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
  refresh: () => void;
}

function renderBody({
  data,
  isLoading,
  isStale,
  error,
  t,
  refresh,
}: BodyProps) {
  // Loading skeleton (first paint, no data yet)
  if (isLoading && !data) {
    return <SkeletonBody />;
  }

  // Setup-required: hook is redirecting; keep the body neutral.
  if (data?.state === "setup_required") {
    return <SkeletonBody />;
  }

  // Network error with no usable data → empty state.
  if (error && !data) {
    return (
      <EmptyState
        title={t("overview.empty.title")}
        subtitle={t("overview.empty.fetch_error")}
        retryLabel={t("overview.empty.retry")}
        onRetry={refresh}
      />
    );
  }

  // Unavailable (poller down, parse error)
  if (data?.state === "unavailable") {
    return (
      <EmptyState
        title={t("overview.empty.title")}
        subtitle={t("overview.empty.subtitle")}
        retryLabel={t("overview.empty.retry")}
        onRetry={refresh}
      />
    );
  }

  // From here on, data.state === "ok"
  if (!data || data.state !== "ok") {
    return <SkeletonBody />;
  }

  const reachable = data.modem_reachable;
  const connectionLabel: ConnectionState | "modem_unreachable" = reachable
    ? deriveConnectionLabel(data.network.lte_state, data.network.nr_state)
    : "modem_unreachable";
  const badge = badgeStyleFor(connectionLabel);
  // Network type is independent of connection state. Empty type → omit the
  // suffix entirely (don't borrow "Unknown" from the connection-state
  // vocabulary; that's reserved for ConnectionState === "unknown").
  const networkType = data.network.type;
  const connectionText =
    connectionLabel === "modem_unreachable"
      ? t("overview.connection.modem_unreachable")
      : networkType
      ? `${t(`overview.connection.${connectionLabel}`)} · ${networkType}`
      : t(`overview.connection.${connectionLabel}`);

  const quality = getSignalQuality(data.signal.rsrp, RSRP_THRESHOLDS);
  const qualityLabel = t(`overview.quality.${quality}`);
  const signalLine = formatSignalLine(data.signal, t, reachable);

  const uptime = formatUptime(data.uptime_seconds);
  const uptimeText = t(`overview.uptime.${uptime.key}`, { ...uptime });

  const rowsMutedClass = reachable ? "" : "text-muted-foreground";

  return (
    <div className="flex flex-col gap-5">
      {/* Connection state row.
          aria-live wraps ONLY the connection badge so screen readers announce
          state transitions (e.g. connected → searching) but ignore the stale
          indicator toggling on/off — otherwise a flapping signal would re-
          announce the full row on every poll.
          aria-atomic dropped intentionally: when only the network type changes
          ("Connected · LTE" → "Connected · NSA"), the live region announces
          just the diff, not the full label. */}
      <div className="flex flex-wrap items-center gap-2">
        <div aria-live="polite">
          <Badge variant="outline" className={badge.classes}>
            <badge.Icon
              className={`size-3 ${badge.spin ? "motion-safe:animate-spin" : ""}`}
              aria-hidden
            />
            {connectionText}
          </Badge>
        </div>
        {isStale && (
          <Badge
            variant="outline"
            className="bg-info/15 text-info hover:bg-info/20 border-info/30"
          >
            {t("overview.stale_indicator")}
          </Badge>
        )}
      </div>

      {/* Hero — signal quality */}
      <div className="flex flex-col gap-1">
        <div className="text-2xl font-semibold leading-tight">
          {qualityLabel}
        </div>
        <div className="text-muted-foreground text-sm">{signalLine}</div>
      </div>

      {/* Grid — carrier / uptime (short, predictable values stay 2-col) */}
      <dl
        className={`grid grid-cols-1 gap-4 @[18rem]/overview:grid-cols-2 ${rowsMutedClass}`}
      >
        <Field
          label={t("overview.field.carrier")}
          value={data.network.carrier || t("overview.field.empty")}
        />
        <Field
          label={t("overview.field.uptime")}
          value={uptimeText}
          numeric
        />
      </dl>

      {/* Carrier Aggregation — full-width per-component list to avoid the
          overflow + alignment risk of parallel "Bands" / "PCI" cells. */}
      <CarrierAggregation
        rows={formatCarrierComponents(data.network.bands)}
        mutedClass={rowsMutedClass}
        t={t}
      />
    </div>
  );
}

// ---------- Sub-components -------------------------------------------------

function Field({
  label,
  value,
  numeric = false,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </dt>
      <dd
        className={`text-sm font-medium break-words ${
          numeric ? "tabular-nums" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function CarrierAggregation({
  rows,
  mutedClass,
  t,
}: {
  rows: CarrierComponentRow[];
  mutedClass: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const label = t("overview.field.aggregation");
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${mutedClass}`}>
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      {rows.length === 0 ? (
        <div className="text-sm font-medium">{t("overview.field.empty")}</div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {rows.map((row, idx) => {
            const bandText =
              row.bandwidth != null
                ? t("overview.aggregation.band_with_bw", {
                    band: row.band,
                    bandwidth: row.bandwidth,
                  })
                : t("overview.aggregation.band_only", { band: row.band });
            return (
              <li
                key={`${row.band}-${idx}`}
                className="grid grid-cols-2 gap-3 text-sm font-medium tabular-nums"
              >
                <span className="break-words">{bandText}</span>
                <span className="break-words">
                  {row.pci != null ? (
                    <>
                      <span className="text-muted-foreground">
                        {t("overview.aggregation.pci_label")}
                      </span>{" "}
                      {row.pci}
                    </>
                  ) : (
                    t("overview.field.empty")
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SkeletonBody() {
  // Mirrors the real layout (badge pill → hero label+sub → 2-col carrier+uptime
  // → full-width bands list) so first paint → data arrival doesn't shift.
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <Skeleton className="h-5 w-32 rounded-full" />

      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-40" />
      </div>

      <div className="grid grid-cols-1 gap-4 @[18rem]/overview:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-14" />
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  subtitle,
  retryLabel,
  onRetry,
}: {
  title: string;
  subtitle: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <MinusCircleIcon
        className="text-muted-foreground size-8"
        aria-hidden
      />
      <div className="flex flex-col gap-1">
        <div className="text-base font-medium">{title}</div>
        <p className="text-muted-foreground text-sm">{subtitle}</p>
      </div>
      {onRetry && retryLabel && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

// ---------- Helpers --------------------------------------------------------

function formatSignalLine(
  signal: { rsrp: number | null; sinr: number | null },
  t: (key: string, opts?: Record<string, unknown>) => string,
  reachable: boolean,
): string {
  if (!reachable) return t("overview.signal.none");
  const { rsrp, sinr } = signal;
  if (rsrp != null && sinr != null) {
    return t("overview.signal.dual", { rsrp, sinr });
  }
  if (rsrp != null) return t("overview.signal.rsrp_only", { rsrp });
  if (sinr != null) return t("overview.signal.sinr_only", { sinr });
  return t("overview.signal.none");
}
