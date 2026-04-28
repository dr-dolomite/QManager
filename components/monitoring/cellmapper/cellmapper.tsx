"use client";

import { useTranslation } from "react-i18next";
import { useCellMapper } from "@/hooks/use-cellmapper";
import dynamic from "next/dynamic";

const CellMapperMapCard = dynamic(
  () => import("./cellmapper-map-card").then((mod) => mod.CellMapperMapCard),
  { ssr: false, loading: () => <div className="h-[400px] animate-pulse rounded-lg bg-muted" /> }
);
import { CellMapperStatusCard } from "./cellmapper-status-card";
import { CellMapperUploadCard } from "./cellmapper-upload-card";
import { CellMapperSignInCard } from "./cellmapper-signin-card";
import { CellMapperInfoStrip } from "./cellmapper-info-strip";
import { CellMapperErrorLog } from "./cellmapper-error-log";

// ─── Component ───────────────────────────────────────────────────────────────

const CellMapperComponent = () => {
  const { t } = useTranslation("monitoring");
  const hookData = useCellMapper();

  // ── Not linked: show full-page sign-in ─────────────────────────────────
  if (!hookData.isLoading && hookData.status && !hookData.status.account.linked) {
    return (
      <div className="@container/main w-full mx-auto p-2">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">{t("cellmapper.page_title")}</h1>
          <p className="text-muted-foreground">{t("cellmapper.page_description")}</p>
        </div>
        <div className="max-w-md mx-auto">
          <CellMapperSignInCard
            isLinked={false}
            username={null}
            onSignIn={hookData.signIn}
          />
        </div>
        {/* Show map even when not linked — useful for GPS testing */}
        <div className="mt-4">
          <CellMapperMapCard
            gps={hookData.status?.gps ?? null}
            isLoading={hookData.isLoading}
            isStale={hookData.isStale}
          />
        </div>
      </div>
    );
  }

  // ── Main dashboard ─────────────────────────────────────────────────────
  return (
    <div className="@container/main w-full mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{t("cellmapper.page_title")}</h1>
        <p className="text-muted-foreground">{t("cellmapper.page_description")}</p>
      </div>

      {/* Re-auth banner: session expired OR uploader flagged needs_reauth */}
      {((hookData.status?.account.linked === false &&
        hookData.status?.account.username) ||
        hookData.status?.service.uploader_needs_reauth) && (
          <div className="mb-4">
            <CellMapperSignInCard
              isLinked={false}
              username={hookData.status.account.username}
              onSignIn={hookData.signIn}
              reAuthMode
            />
          </div>
        )}

      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 @5xl/main:grid-cols-[1fr_2fr_1fr] gap-4">
        <CellMapperStatusCard
          status={hookData.status}
          isLoading={hookData.isLoading}
          isStale={hookData.isStale}
          lastUpdated={hookData.lastUpdated}
          onRefresh={hookData.refresh}
        />
        <CellMapperMapCard
          gps={hookData.status?.gps ?? null}
          isLoading={hookData.isLoading}
          isStale={hookData.isStale}
        />
        <CellMapperUploadCard
          buffer={hookData.status?.buffer ?? null}
          lastUpload={hookData.status?.service.last_upload ?? null}
          uploaderState={hookData.status?.service.uploader_state}
          isLoading={hookData.isLoading}
          isStale={hookData.isStale}
          onUploadNow={hookData.triggerUpload}
        />
      </div>

      {/* Info strip — destination + quick nav links */}
      <CellMapperInfoStrip status={hookData.status} />

      {/* Error log — expandable, hidden when empty */}
      <CellMapperErrorLog errors={hookData.status?.errors ?? []} />
    </div>
  );
};

export default CellMapperComponent;
