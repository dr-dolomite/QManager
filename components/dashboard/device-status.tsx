"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { containerVariants, itemVariants } from "@/lib/motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";

import type { DeviceStatus } from "@/types/modem-status";

/**
 * Per-row [label, value] skeleton bar widths, mirroring the real field lengths
 * (Firmware Version → QManager Version) so the placeholder reads as this card,
 * not a generic list. Keeps the loading rhythm aligned with the loaded layout.
 */
const SKELETON_ROW_WIDTHS: ReadonlyArray<readonly [string, string]> = [
  ["w-32", "w-40"], // Firmware Version
  ["w-24", "w-24"], // Build Date
  ["w-12", "w-20"], // APN
  ["w-28", "w-32"], // Phone Number
  ["w-14", "w-36"], // IMSI
  ["w-14", "w-44"], // ICCID
  ["w-28", "w-36"], // Device IMEI
  ["w-28", "w-32"], // Active MIMO
  ["w-32", "w-20"], // QManager Version
];

interface DeviceStatusComponentProps {
  data: DeviceStatus | null;
  /** Live APN name, sourced from network status (AT+CGCONTRDP), a sibling of `device` in the poll payload */
  apn?: string | null;
  /**
   * Live MIMO label from the on-demand radio-details endpoint. Preferred while
   * the page is mounted; falls back to the poller's last-known `data.mimo` when
   * empty/undefined (before the first on-demand fetch returns / when stale).
   */
  mimo?: string | null;
  isLoading: boolean;
}

const DeviceStatusComponent = ({
  data,
  apn,
  mimo,
  isLoading,
}: DeviceStatusComponentProps) => {
  const { t } = useTranslation("dashboard");
  const [hidePrivate, setHidePrivate] = useState(false);

  const rows = [
    { label: t("device_status.firmware_version"), value: data?.firmware || "-" },
    { label: t("device_status.build_date"), value: data?.build_date || "-" },
    { label: t("device_status.apn"), value: apn || "-", mono: true },
    {
      label: t("device_status.phone_number"),
      value: data?.phone_number || "-",
      mono: true,
      private: true,
    },
    { label: t("device_status.imsi"), value: data?.imsi || "-", mono: true, private: true },
    { label: t("device_status.iccid"), value: data?.iccid || "-", mono: true, private: true },
    {
      label: t("device_status.device_imei"),
      value: data?.imei || "-",
      mono: true,
      private: true,
    },
    {
      // Prefer the live on-demand MIMO label; fall back to the poller snapshot.
      label: t("device_status.active_mimo"),
      value: mimo || data?.mimo || "-",
      mono: true,
    },
    {
      label: t("device_status.qmanager_version"),
      value: data?.qmanager_version || "-",
      mono: true,
    },
  ];

  if (isLoading) {
    return (
      <Card className="@container/card col-span-2" aria-busy="true">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold @[250px]/card:text-3xl text-center flex-1">
            {t("device_status.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="flex items-center justify-center mb-8">
              <div className="size-44 bg-primary/15 rounded-full p-4 flex items-center justify-center">
                <Skeleton className="size-full rounded-full" />
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex justify-end">
                <Skeleton className="size-9 rounded-md" />
              </div>
              <div className="grid divide-y divide-border border-y border-border">
                {SKELETON_ROW_WIDTHS.map(([labelW, valueW], i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2"
                  >
                    <Skeleton className={`h-5 xl:h-6 ${labelW}`} />
                    <Skeleton className={`h-5 xl:h-6 ${valueW}`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card col-span-2">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold @[250px]/card:text-3xl text-center flex-1">
          {t("device_status.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <div className="flex items-center justify-center mb-8">
            <div className="size-44 bg-primary/15 rounded-full p-4 flex items-center justify-center">
              <img
                src="/device-icon.png"
                alt={t("device_status.icon_alt")}
                className="size-full drop-shadow-md object-contain"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setHidePrivate((prev) => !prev)}
                aria-label={
                  hidePrivate ? t("device_status.show_private") : t("device_status.hide_private")
                }
              >
                {hidePrivate ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
            <motion.dl
              className="grid divide-y divide-border border-y border-border"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {rows.map((row) => (
                <motion.div
                  key={row.label}
                  variants={itemVariants}
                  className="flex items-center justify-between py-2"
                >
                  <dt className="font-semibold text-muted-foreground xl:text-base text-sm">
                    {row.label}
                  </dt>
                  <dd
                    className={`font-semibold xl:text-base text-sm ${
                      row.mono ? "tabular-nums" : ""
                    }`}
                  >
                    {hidePrivate && row.private ? "••••••••••••" : row.value}
                  </dd>
                </motion.div>
              ))}
            </motion.dl>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DeviceStatusComponent;
