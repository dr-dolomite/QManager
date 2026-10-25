"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  CheckIcon,
  Loader2Icon,
  PackageIcon,
  RefreshCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HintIcon } from "@/components/ui/hint-icon";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import type { TailscaleInstallSource } from "@/hooks/use-tailscale";
import type { InstallResult } from "@/types/video-optimizer";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import { InstallLogViewer } from "./install-log-viewer";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_TEXT,
  CARD_TITLE,
  HERO_PAD,
  HERO_SHELL,
  NOTICE,
  NOTICE_BODY,
  NOTICE_GLYPH,
  NOTICE_TONE,
  PILL_REST,
  RAIL,
  SOURCE,
} from "./shapes";

// -----------------------------------------------------------------------------
// Install — the not-installed hero. The only card on this shape.
// -----------------------------------------------------------------------------

/** The lucide check that SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

// Tiny first: it is the default wherever the firmware offers it.
const SOURCES: readonly TailscaleInstallSource[] = ["tiny", "official"];

export function InstallCard({
  installResult,
  runInstall,
  onRefresh,
  tinyAvailable,
}: {
  installResult: InstallResult;
  runInstall: (source: TailscaleInstallSource) => Promise<void>;
  onRefresh: () => void;
  /** The firmware trusts the Tiny build's feed; without it there is one path. */
  tinyAvailable: boolean;
}) {
  const { t } = useTranslation("common");
  const running = installResult.status === "running";
  const [picked, setPicked] = React.useState<TailscaleInstallSource>("tiny");
  const source: TailscaleInstallSource = tinyAvailable ? picked : "official";
  const showLog =
    running ||
    ((installResult.status === "complete" ||
      installResult.status === "error") &&
      !!installResult.log);

  // One toast per finished install, fired when a run we watched ends. A result
  // that was already terminal on mount never toasts.
  const prevStatus = React.useRef(installResult.status);
  React.useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = installResult.status;
    if (prev !== "running") return;
    if (installResult.status === "complete") {
      toast.success(t("tailscale.toast.installed"), { id: "tailscale-install" });
    } else if (installResult.status === "error") {
      toast.error(installResult.message || t("tailscale.toast.installFailed"), {
        id: "tailscale-install",
      });
    }
  }, [installResult.status, installResult.message, t]);

  return (
    <Card className={HERO_SHELL}>
      <CardHeader className={cn(HERO_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("tailscale.install.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {tinyAvailable
              ? t("tailscale.install.descriptionChoice")
              : t("tailscale.install.description")}
          </CardDescription>
        </div>
      </CardHeader>

      {/* No card-level `aria-live`: the notices below and the transcript are
          already live regions, and nesting them announces twice. */}
      <CardContent className={cn(HERO_PAD, CARD_BODY)}>
        <ConditionBlock
          tone="muted"
          icon={PackageIcon}
          title={t("tailscale.install.conditionTitle")}
          description={t("tailscale.install.conditionDescription")}
        />

        {installResult.status === "complete" ? (
          <div role="status" className={cn(NOTICE, NOTICE_TONE.success)}>
            <CheckCircle2Icon className={NOTICE_GLYPH} />
            <span className={NOTICE_BODY}>
              {installResult.message ?? t("tailscale.install.done")}
            </span>
          </div>
        ) : null}

        {installResult.status === "error" ? (
          <div role="alert" className={cn(NOTICE, NOTICE_TONE.destructive)}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            <span className={NOTICE_BODY}>
              {installResult.message || t("tailscale.install.failed")}
              {installResult.detail ? (
                <span className="mt-0.5 block">{installResult.detail}</span>
              ) : null}
            </span>
          </div>
        ) : null}

        {tinyAvailable ? (
          <div className={SOURCE.ROOT}>
            <div className={SOURCE.LABEL_ROW}>
              <span className={SOURCE.LABEL}>
                {t("tailscale.install.sourceLabel")}
              </span>
              <HintIcon label={t("tailscale.install.sourceHintLabel")}>
                {t("tailscale.install.sourceHint")}
              </HintIcon>
            </div>
            <SegmentedField
              value={picked}
              onValueChange={setPicked}
              ariaLabel={t("tailscale.install.sourceLabel")}
              disabled={running}
              breakpoint="never"
              glyph={renderCheckGlyph}
              options={SOURCES.map((s) => ({
                value: s,
                label: t(`tailscale.install.source.${s}.title`),
              }))}
            />
            <p className={SOURCE.DESC}>
              {t(`tailscale.install.source.${picked}.description`)}
            </p>
          </div>
        ) : null}

        <div className={cn(RAIL, "justify-center")}>
          <Button
            type="button"
            size="action"
            onClick={() => void runInstall(source)}
            disabled={running}
          >
            {running ? (
              <Loader2Icon className="size-4 motion-safe:animate-spin" />
            ) : (
              <PackageIcon className="size-4" />
            )}
            {/* Never the backend's own message: a control's label has a width
                contract, and this surface ships in five locales. */}
            {running
              ? t("tailscale.install.installing")
              : t("tailscale.install.install")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="action"
            className={PILL_REST}
            onClick={onRefresh}
            disabled={running}
          >
            <RefreshCcwIcon className="size-4" />
            {t("tailscale.install.checkAgain")}
          </Button>
        </div>

        {showLog ? (
          <InstallLogViewer log={installResult.log ?? ""} isRunning={running} />
        ) : null}
      </CardContent>
    </Card>
  );
}
