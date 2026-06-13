"use client";

import { useTranslation } from "react-i18next";
import { useSystemSettings } from "@/hooks/use-system-settings";
import SystemSettingsCard from "@/components/system-settings/system-settings-card";
import ScheduledOperationsCard from "@/components/system-settings/scheduled-operations-card";
import DiagnosticsCard from "@/components/system-settings/diagnostics/diagnostics-card";
import IpaOffloadCard from "@/components/system-settings/ipa-offload/ipa-offload-card";

const SystemSettings = () => {
  const { t } = useTranslation("system-settings");
  const hookData = useSystemSettings();

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{t("page.title")}</h1>
      </div>
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <SystemSettingsCard {...hookData} />
        <ScheduledOperationsCard {...hookData} />
        <IpaOffloadCard />
        <DiagnosticsCard />
      </div>
    </div>
  );
};

export default SystemSettings;
