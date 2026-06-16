"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useRadioDetails } from "@/hooks/use-radio-details";
import CellDataComponent from "@/components/cellular/cell-data";
import ActiveBandsComponent from "@/components/cellular/active-bands";

const CellularInformationComponent = () => {
  const { data, isLoading } = useModemStatus();
  // MIMO is fetched on-demand (off the poller) while this page is mounted.
  const { details: radioDetails } = useRadioDetails();
  const { t } = useTranslation("cellular");

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">
          {t("core_settings.info.page.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("core_settings.info.page.description")}
        </p>
      </div>
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <CellDataComponent
          network={data?.network ?? null}
          lte={data?.lte ?? null}
          nr={data?.nr ?? null}
          device={data?.device ?? null}
          mimo={radioDetails?.mimo ?? null}
          isLoading={isLoading}
        />
        <ActiveBandsComponent
          carrierComponents={data?.network?.carrier_components ?? null}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
};

export default CellularInformationComponent;
