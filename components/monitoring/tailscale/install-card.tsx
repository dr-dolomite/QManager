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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { HintIcon } from "@/components/ui/hint-icon";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import type { TailscaleInstallSource } from "@/hooks/use-tailscale";
import type { InstallResult } from "@/types/video-optimizer";
import { cn } from "@/lib/utils";

import { InstallLogViewer } from "./install-log-viewer";
import {
  BUILD,
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_ACTIONS,
  CARD_HEAD_TEXT,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  HEAD_TAG,
  NOTICE,
  NOTICE_BODY,
  NOTICE_GLYPH,
  NOTICE_TONE,
  SKELETON,
  STATUS_LINE,
  STATUS_VARIANT,
  SWITCH_ROW,
} from "./shapes";

// -----------------------------------------------------------------------------
// Install — the not-installed card. The only card on this shape.
// -----------------------------------------------------------------------------
// Header (action title, quiet status, refresh), one Build tile, then the
// card foot: the cost on the left edge, the commit on the right. While a run is
// live the transcript takes the tile's place, so the card never grows a second
// region below the button.
// -----------------------------------------------------------------------------

/** The lucide check that SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

// Tiny first: it is the default wherever the firmware offers it.
const SOURCES: readonly TailscaleInstallSource[] = ["tiny", "official"];

/** The header both the card and its skeleton share, so the swap never shifts. */
function InstallHeader({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation("common");
  return (
    <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
      <div className={CARD_HEAD_TEXT}>
        <CardTitle className={CARD_TITLE}>
          {t("tailscale.install.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("tailscale.install.description")}
        </CardDescription>
      </div>
      {children}
    </CardHeader>
  );
}

export function InstallCard({
  installResult,
  runInstall,
  onRefresh,
  isRefreshing,
  tinyAvailable,
}: {
  installResult: InstallResult;
  runInstall: (source: TailscaleInstallSource) => Promise<void>;
  onRefresh: () => void;
  isRefreshing: boolean;
  /** The firmware trusts the Tiny build's feed; without it there is one path. */
  tinyAvailable: boolean;
}) {
  const { t } = useTranslation("common");
  const running = installResult.status === "running";
  const failed = installResult.status === "error";
  const done = installResult.status === "complete";
  const [picked, setPicked] = React.useState<TailscaleInstallSource>("tiny");
  const source: TailscaleInstallSource = tinyAvailable ? picked : "official";
  const showLog = running || ((done || failed) && !!installResult.log);

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

  // The foot's left edge says what is true right now: the run, the finish, or
  // the one consequence that applies before and after a failed attempt.
  const status = running ? (
    <span className={STATUS_LINE}>
      <Loader2Icon
        className="size-4 flex-none motion-safe:animate-spin"
        aria-hidden
      />
      <span>
        {t("tailscale.install.installingBuild", {
          build: t(`tailscale.install.source.${source}.title`),
        })}
      </span>
    </span>
  ) : done ? (
    <span className={STATUS_LINE}>
      <CheckCircle2Icon
        className="text-success-on-surface size-4 flex-none"
        aria-hidden
      />
      <span>{installResult.message ?? t("tailscale.install.done")}</span>
    </span>
  ) : (
    <span className={STATUS_LINE}>
      <TriangleAlertIcon
        className="text-warning-on-surface size-4 flex-none"
        aria-hidden
      />
      <span>{t("tailscale.install.cost")}</span>
    </span>
  );

  return (
    <Card className={CARD_SHELL}>
      <InstallHeader>
        <div className={CARD_HEAD_ACTIONS}>
          <Badge variant={STATUS_VARIANT.notInstalled} role="status">
            <span className="sr-only">{t("tailscale.status.aria")}</span>
            <PackageIcon className="size-3" aria-hidden />
            {t("tailscale.status.notInstalled")}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={running || isRefreshing}
            aria-label={t("tailscale.page.refresh")}
            title={t("tailscale.page.refresh")}
          >
            <RefreshCcwIcon
              className={cn(
                "size-4",
                isRefreshing && "motion-safe:animate-spin",
              )}
            />
          </Button>
        </div>
      </InstallHeader>

      {/* No card-level `aria-live`: the notice, the transcript and the foot
          status are already live regions, and nesting them announces twice. */}
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {failed ? (
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

        {showLog ? (
          <InstallLogViewer log={installResult.log ?? ""} isRunning={running} />
        ) : (
          <div className={BUILD.ROOT}>
            <div className={SWITCH_ROW.TEXT}>
              <div className={cn(BUILD.LABEL_ROW, SWITCH_ROW.TITLE)}>
                <span>{t("tailscale.install.sourceLabel")}</span>
                {tinyAvailable ? (
                  <HintIcon label={t("tailscale.install.sourceHintLabel")}>
                    {t("tailscale.install.sourceHint")}
                  </HintIcon>
                ) : null}
              </div>
              <p className={BUILD.DESC}>
                {t(`tailscale.install.source.${source}.description`)}
                {tinyAvailable ? (
                  <span className={BUILD.NOTE}>
                    {t("tailscale.install.switchLater")}
                  </span>
                ) : null}
              </p>
            </div>
            {tinyAvailable ? (
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
            ) : (
              <Tag variant="neutral" className={HEAD_TAG}>
                {t("tailscale.install.source.official.title")}
              </Tag>
            )}
          </div>
        )}
      </CardContent>

      <CardFoot
        className={CARD_PAD}
        status={status}
        actions={
          <Button
            type="button"
            size="action"
            onClick={() => void runInstall(source)}
            disabled={running || done}
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
              : failed
                ? t("tailscale.install.retry")
                : t("tailscale.install.install")}
          </Button>
        }
      />
    </Card>
  );
}

/** Mirrors the card above from the same constants: real header copy, a pinned
 *  tile and a foot holding the action's pinned height. */
export function InstallCardSkeleton() {
  return (
    <Card className={CARD_SHELL}>
      <InstallHeader />
      <CardContent className={cn(CARD_PAD, CARD_BODY)} aria-hidden>
        <Skeleton className={SKELETON.BUILD} />
      </CardContent>
      <CardFoot
        className={CARD_PAD}
        liveStatus={false}
        aria-hidden="true"
        actions={<Skeleton className={cn(SKELETON.ACTION, "w-40")} />}
      />
    </Card>
  );
}
