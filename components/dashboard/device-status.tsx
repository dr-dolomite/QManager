"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { containerVariants, itemVariants } from "@/lib/motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";

import type { DeviceStatus } from "@/types/modem-status";

interface DeviceStatusComponentProps {
  data: DeviceStatus | null;
  /** Live APN name, sourced from network status (AT+CGCONTRDP), a sibling of `device` in the poll payload */
  apn?: string | null;
  isLoading: boolean;
}

const DeviceStatusComponent = ({
  data,
  apn,
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
    { label: t("device_status.active_mimo"), value: data?.mimo || "-", mono: true },
    {
      label: t("device_status.qmanager_version"),
      value: data?.qmanager_version || "-",
      mono: true,
    },
  ];

  if (isLoading) {
    return (
      <Card className="@container/card col-span-2">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl text-center">
            {t("device_status.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="flex items-center justify-center mb-8">
              <Skeleton className="size-44 rounded-full" />
            </div>
            <div className="grid gap-2">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i}>
                  <Separator />
                  <div className="flex items-center justify-between py-1">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-36" />
                  </div>
                </div>
              ))}
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
