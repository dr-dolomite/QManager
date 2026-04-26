"use client";

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useCellMapperSettings } from "@/hooks/use-cellmapper-settings";
import { useCellMapper } from "@/hooks/use-cellmapper";
import { CellMapperAccountCard } from "./cellmapper-account-card";
import { CellMapperCollectionCard } from "./cellmapper-collection-card";
import { CellMapperUploadDestinationCard } from "./cellmapper-upload-destination-card";
import { CellMapperRetentionCard } from "./cellmapper-retention-card";
import { CellMapperConsentDialog } from "./cellmapper-consent-dialog";

// =============================================================================
// CellMapperSettings — Settings page orchestrator.
// Wires up all 4 settings cards in a 2×2 responsive grid and manages the
// consent dialog lifecycle.
// =============================================================================

const CellMapperSettingsComponent = () => {
  const { t } = useTranslation("monitoring");
  const settingsHook = useCellMapperSettings();
  const statusHook = useCellMapper(); // For account linked status + adapter
  const [consentOpen, setConsentOpen] = useState(false);

  // When user confirms consent: persist consent + enable in one save
  const handleConsentConfirm = useCallback(async () => {
    await settingsHook.saveSettings({ consent_accepted: true, enabled: true });
    setConsentOpen(false);
  }, [settingsHook]);

  return (
    <div className="@container/main mx-auto p-2">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">
          {t("cellmapper.settings_page_title")}
        </h1>
        <p className="text-muted-foreground">
          {t("cellmapper.settings_page_description")}
        </p>
      </div>

      {/* 2×2 responsive grid — single column below @3xl, two columns above */}
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 gap-4">
        <CellMapperAccountCard
          settings={settingsHook.settings}
          isLinked={statusHook.status?.account.linked ?? false}
          isLoading={settingsHook.isLoading}
          onSignOut={statusHook.signOut}
          onTestConnection={settingsHook.testConnection}
        />

        <CellMapperCollectionCard
          settings={settingsHook.settings}
          adapterName={statusHook.status?.adapter.name ?? null}
          isLoading={settingsHook.isLoading}
          isSaving={settingsHook.isSaving}
          onSave={settingsHook.saveSettings}
          onTestGps={settingsHook.testGps}
          onConsentRequired={() => setConsentOpen(true)}
        />

        <CellMapperUploadDestinationCard
          settings={settingsHook.settings}
          isLoading={settingsHook.isLoading}
          isSaving={settingsHook.isSaving}
          onSave={settingsHook.saveSettings}
          onTestEndpoint={settingsHook.testEndpoint}
        />

        <CellMapperRetentionCard
          settings={settingsHook.settings}
          bufferStats={settingsHook.bufferStats}
          isLoading={settingsHook.isLoading}
          isSaving={settingsHook.isSaving}
          onSave={settingsHook.saveSettings}
          onPurge={settingsHook.purgeBuffer}
          onExport={settingsHook.exportCsv}
        />
      </div>

      {/* Consent dialog — mounted once, controlled by consentOpen state */}
      <CellMapperConsentDialog
        open={consentOpen}
        onOpenChange={setConsentOpen}
        endpoint={
          settingsHook.settings?.upload_target === "custom"
            ? settingsHook.settings?.custom_url || "custom endpoint"
            : "cellmapper.net"
        }
        onConfirm={() => void handleConsentConfirm()}
      />
    </div>
  );
};

export default CellMapperSettingsComponent;
