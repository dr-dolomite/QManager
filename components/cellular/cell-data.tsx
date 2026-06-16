"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { TbInfoCircleFilled } from "react-icons/tb";
import { Button } from "@/components/ui/button";

import type {
  NetworkStatus,
  LteStatus,
  NrStatus,
  DeviceStatus,
} from "@/types/modem-status";
import { formatNumericField } from "@/types/modem-status";
import type { TFunction } from "i18next";

// =============================================================================
// Props
// =============================================================================

interface CellDataComponentProps {
  network: NetworkStatus | null;
  lte: LteStatus | null;
  nr: NrStatus | null;
  device: DeviceStatus | null;
  /**
   * Live MIMO label from the on-demand radio-details endpoint. Preferred while
   * the page is mounted; falls back to the poller's last-known `device.mimo`
   * when empty/undefined (before the first on-demand fetch returns / stale).
   */
  mimo?: string | null;
  isLoading: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/** Map network type enum to human-readable display */
function formatNetworkType(type: string, t: TFunction): string {
  switch (type) {
    case "5G-NSA":
      return t("core_settings.info.cell_data.network_type_values.nsa");
    case "5G-SA":
      return t("core_settings.info.cell_data.network_type_values.sa");
    case "LTE":
      return t("core_settings.info.cell_data.network_type_values.lte");
    default:
      return type || "-";
  }
}

/** Build CA summary string from network status */
function formatCarrierAggregation(network: NetworkStatus, t: TFunction): string {
  const isNSA = network.type === "5G-NSA";
  const parts: string[] = [];

  if (network.ca_active && network.ca_count > 0) {
    parts.push(
      t("core_settings.info.cell_data.carrier_aggregation.lte_carriers", {
        count: network.ca_count + 1,
      })
    );
  } else if (isNSA) {
    // NSA always has an LTE anchor — show "LTE" even without CA
    parts.push(t("core_settings.info.cell_data.carrier_aggregation.lte_anchor"));
  }

  if (network.nr_ca_active && network.nr_ca_count > 0) {
    // Genuine NR CA — show carrier count (+1 for primary NR carrier)
    parts.push(
      t("core_settings.info.cell_data.carrier_aggregation.nr_carriers", {
        count: network.nr_ca_count + 1,
      })
    );
  } else if (isNSA) {
    // NSA dual connectivity: NR leg is active but not doing CA
    parts.push(t("core_settings.info.cell_data.carrier_aggregation.nr_leg"));
  }

  if (parts.length === 0)
    return t("core_settings.info.cell_data.carrier_aggregation.inactive");
  return parts.join(" + ");
}

/** Convert decimal to hex string for TAC tooltip, e.g. 49026 → "BF82" */
function decToHex(value: number | null): string {
  if (value === null || value === undefined) return "-";
  return value.toString(16).toUpperCase();
}

/**
 * Normalize an IPv6 address to RFC 5952 compressed form.
 * Handles both standard colon notation and Quectel's dotted-decimal
 * octet format (16 dot-separated bytes from AT+CGCONTRDP).
 *
 * Examples:
 *   "253.0.151.106.0.0.0.0.0.0.0.0.0.0.0.9" → "fd00:9b6a::9"
 *   "2607:fb90:0000:0000:0000:0000:0000:c505" → "2607:fb90::c505"
 *   "10.151.151.44" (IPv4, 4 octets) → returned as-is
 */
function compressIPv6(ip: string): string {
  if (!ip) return "-";

  let groups: string[];

  // Detect Quectel dotted-decimal IPv6: exactly 16 dot-separated decimal octets
  const dotParts = ip.split(".");
  if (dotParts.length === 16 && dotParts.every((p) => /^\d{1,3}$/.test(p))) {
    // Pair octets into 8 hex groups
    groups = [];
    for (let i = 0; i < 16; i += 2) {
      const hi = parseInt(dotParts[i], 10);
      const lo = parseInt(dotParts[i + 1], 10);
      groups.push(((hi << 8) | lo).toString(16));
    }
  } else if (ip.includes(":")) {
    // Standard colon notation — expand :: to full 8 groups first
    const halves = ip.split("::");
    if (halves.length === 2) {
      const left = halves[0] ? halves[0].split(":") : [];
      const right = halves[1] ? halves[1].split(":") : [];
      const fill = 8 - left.length - right.length;
      groups = [...left, ...Array(fill).fill("0"), ...right];
    } else {
      groups = ip.split(":");
    }
    // Strip leading zeros from each group
    groups = groups.map((g) => (parseInt(g, 16) || 0).toString(16));
  } else {
    // IPv4 or unknown — return as-is
    return ip;
  }

  // Find longest run of consecutive "0" groups (RFC 5952: use :: for first longest)
  let bestStart = -1,
    bestLen = 0,
    curStart = -1,
    curLen = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === "0") {
      if (curStart === -1) curStart = i;
      curLen++;
    } else {
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
      curStart = -1;
      curLen = 0;
    }
  }
  if (curLen > bestLen) {
    bestStart = curStart;
    bestLen = curLen;
  }

  // Collapse the longest zero run into ::
  if (bestLen >= 2) {
    const left = groups.slice(0, bestStart).join(":");
    const right = groups.slice(bestStart + bestLen).join(":");
    if (!left && !right) return "::";
    if (!left) return "::" + right;
    if (!right) return left + "::";
    return left + "::" + right;
  }

  return groups.join(":");
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function CellDataSkeleton() {
  const { t } = useTranslation("cellular");
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("core_settings.info.cell_data.card.title")}</CardTitle>
        <CardDescription>
          {t("core_settings.info.cell_data.card.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <React.Fragment key={i}>
              <Separator />
              <div className="flex items-center justify-between py-0.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-36" />
              </div>
            </React.Fragment>
          ))}
          <Separator />
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Component
// =============================================================================

const CellDataComponent = ({
  network,
  lte,
  nr,
  device,
  mimo,
  isLoading,
}: CellDataComponentProps) => {
  const { t } = useTranslation("cellular");

  if (isLoading) return <CellDataSkeleton />;

  // Determine which RAT provides Cell ID and TAC
  // SA mode: use NR values. NSA/LTE: use LTE values.
  const isSA = network?.type === "5G-SA";
  const cellId = isSA ? nr?.cell_id : lte?.cell_id;
  const tac = isSA ? nr?.tac : lte?.tac;
  const enodebId = isSA ? nr?.enodeb_id : lte?.enodeb_id;
  const sectorId = isSA ? nr?.sector_id : lte?.sector_id;
  const cellIdLabel = isSA ? "gNodeB" : "eNodeB";
  const hasIpv6Dns = Boolean(network?.primary_dns_v6 || network?.secondary_dns_v6);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("core_settings.info.cell_data.card.title")}</CardTitle>
        <CardDescription>
          {t("core_settings.info.cell_data.card.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <motion.div
          className="grid gap-2"
          initial="hidden"
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
        >
          {/* ISP */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              {t("core_settings.info.cell_data.rows.isp")}
            </p>
            <p className="text-sm font-semibold">{network?.carrier || "-"}</p>
          </motion.div>

          {/* APN */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              {t("core_settings.info.cell_data.rows.apn")}
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold">{network?.apn || "-"}</p>
              <Button
                variant="link"
                size="sm"
                className="p-0.5 cursor-pointer"
                asChild
              >
                <Link href="/cellular/settings/apn-management">
                  {t("core_settings.info.cell_data.rows.apn_edit")}
                </Link>
              </Button>
            </div>
          </motion.div>

          {/* Network Type */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              {t("core_settings.info.cell_data.rows.network_type")}
            </p>
            <p className="text-sm font-semibold">
              {network ? formatNetworkType(network.type, t) : "-"}
            </p>
          </motion.div>

          {/* Cell ID */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              {t("core_settings.info.cell_data.rows.cell_id")}
            </p>
            <div className="flex items-center gap-1.5">
              {cellId != null && enodebId != null ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex"
                      aria-label={t("core_settings.info.cell_data.info_aria")}
                    >
                      <TbInfoCircleFilled className="size-5 text-info" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="grid">
                      <p>
                        {t("core_settings.info.cell_data.rows.cell_id_tooltip_row", {
                          label: cellIdLabel,
                        })}{" "}
                        <span className="font-semibold">
                          {formatNumericField(enodebId)}
                        </span>
                      </p>

                      <p>
                        {t("core_settings.info.cell_data.rows.sector_tooltip")}{" "}
                        <span className="font-semibold">
                          {formatNumericField(sectorId)}
                        </span>
                      </p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <p className="text-sm font-semibold">
                {formatNumericField(cellId)}
              </p>
            </div>
          </motion.div>

          {/* TAC */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              {t("core_settings.info.cell_data.rows.tac")}
            </p>
            <div className="flex items-center gap-1.5">
              {tac != null ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex"
                      aria-label={t("core_settings.info.cell_data.info_aria")}
                    >
                      <TbInfoCircleFilled className="size-5 text-info" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {t("core_settings.info.cell_data.rows.tac_hex_tooltip")}{" "}
                      <span className="font-semibold">0x{decToHex(tac)}</span>
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <p className="text-sm font-semibold">{formatNumericField(tac)}</p>
            </div>
          </motion.div>

          {/* Total Bandwidth */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              {t("core_settings.info.cell_data.rows.total_bandwidth")}
            </p>
            <div className="flex items-center gap-1.5">
              {network?.bandwidth_details ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex"
                      aria-label={t("core_settings.info.cell_data.info_aria")}
                    >
                      <TbInfoCircleFilled className="size-5 text-info" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{network.bandwidth_details}</p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <p className="text-sm font-semibold">
                {network?.total_bandwidth_mhz
                  ? `${network.total_bandwidth_mhz} MHz`
                  : "-"}
              </p>
            </div>
          </motion.div>

          {/* Carrier Aggregation */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              {t("core_settings.info.cell_data.rows.carrier_aggregation")}
            </p>
            <p className="text-sm font-semibold">
              {network ? formatCarrierAggregation(network, t) : "-"}
            </p>
          </motion.div>

          {/* Active MIMO */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              {t("core_settings.info.cell_data.rows.active_mimo")}
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold">
                {/* Prefer live on-demand MIMO; fall back to poller snapshot. */}
                {mimo || device?.mimo || "-"}
              </p>
              <Button
                variant="link"
                size="sm"
                className="p-0.5 cursor-pointer"
                asChild
              >
                <Link href="/cellular/antenna-statistics">
                  {t("core_settings.info.cell_data.rows.active_mimo_link")}
                </Link>
              </Button>
            </div>
          </motion.div>

          {/* WAN IPv4 */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              {t("core_settings.info.cell_data.rows.wan_ipv4")}
            </p>
            <p className="text-sm font-semibold font-mono">
              {network?.wan_ipv4 || "-"}
            </p>
          </motion.div>

          {/* WAN IPv6 */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              {t("core_settings.info.cell_data.rows.wan_ipv6")}
            </p>
            <div className="flex items-center gap-1.5">
              {network?.wan_ipv6 && compressIPv6(network.wan_ipv6) !== network.wan_ipv6 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex"
                      aria-label={t("core_settings.info.cell_data.info_aria")}
                    >
                      <TbInfoCircleFilled className="size-5 text-info" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{network.wan_ipv6}</p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <p className="text-sm font-semibold font-mono">
                {network?.wan_ipv6 ? compressIPv6(network.wan_ipv6) : "-"}
              </p>
            </div>
          </motion.div>

          {/* Primary DNS (IPv4) */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              {hasIpv6Dns
                ? t("core_settings.info.cell_data.rows.primary_dns_ipv4")
                : t("core_settings.info.cell_data.rows.primary_dns")}
            </p>
            <div className="flex items-center gap-1.5">
              {network?.primary_dns_v4 && compressIPv6(network.primary_dns_v4) !== network.primary_dns_v4 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex"
                      aria-label={t("core_settings.info.cell_data.info_aria")}
                    >
                      <TbInfoCircleFilled className="size-5 text-info" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-mono">{network.primary_dns_v4}</p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <p className="text-sm font-semibold font-mono">
                {network?.primary_dns_v4 ? compressIPv6(network.primary_dns_v4) : "-"}
              </p>
            </div>
          </motion.div>

          {/* Primary DNS (IPv6) — hidden when carrier provides no IPv6 DNS */}
          {hasIpv6Dns && (
            <>
              <Separator />
              <motion.div
                className="flex items-center justify-between"
                variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <p className="text-sm font-semibold text-muted-foreground">
                  {t("core_settings.info.cell_data.rows.primary_dns_ipv6")}
                </p>
                <div className="flex items-center gap-1.5">
                  {network?.primary_dns_v6 && compressIPv6(network.primary_dns_v6) !== network.primary_dns_v6 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex"
                          aria-label={t("core_settings.info.cell_data.info_aria")}
                        >
                          <TbInfoCircleFilled className="size-5 text-info" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-mono">{network.primary_dns_v6}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  <p className="text-sm font-semibold font-mono">
                    {network?.primary_dns_v6 ? compressIPv6(network.primary_dns_v6) : "-"}
                  </p>
                </div>
              </motion.div>
            </>
          )}

          {/* Secondary DNS (IPv4) */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              {hasIpv6Dns
                ? t("core_settings.info.cell_data.rows.secondary_dns_ipv4")
                : t("core_settings.info.cell_data.rows.secondary_dns")}
            </p>
            <div className="flex items-center gap-1.5">
              {network?.secondary_dns_v4 && compressIPv6(network.secondary_dns_v4) !== network.secondary_dns_v4 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex"
                      aria-label={t("core_settings.info.cell_data.info_aria")}
                    >
                      <TbInfoCircleFilled className="size-5 text-info" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-mono">{network.secondary_dns_v4}</p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <p className="text-sm font-semibold font-mono">
                {network?.secondary_dns_v4 ? compressIPv6(network.secondary_dns_v4) : "-"}
              </p>
            </div>
          </motion.div>

          {/* Secondary DNS (IPv6) — hidden when carrier provides no IPv6 DNS */}
          {hasIpv6Dns && (
            <>
              <Separator />
              <motion.div
                className="flex items-center justify-between"
                variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <p className="text-sm font-semibold text-muted-foreground">
                  {t("core_settings.info.cell_data.rows.secondary_dns_ipv6")}
                </p>
                <div className="flex items-center gap-1.5">
                  {network?.secondary_dns_v6 && compressIPv6(network.secondary_dns_v6) !== network.secondary_dns_v6 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex"
                          aria-label={t("core_settings.info.cell_data.info_aria")}
                        >
                          <TbInfoCircleFilled className="size-5 text-info" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-mono">{network.secondary_dns_v6}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  <p className="text-sm font-semibold font-mono">
                    {network?.secondary_dns_v6 ? compressIPv6(network.secondary_dns_v6) : "-"}
                  </p>
                </div>
              </motion.div>
            </>
          )}
          <Separator />
        </motion.div>
      </CardContent>
    </Card>
  );
};

export default CellDataComponent;
