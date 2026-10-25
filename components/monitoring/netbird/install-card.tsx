"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  CopyIcon,
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
import { Skeleton } from "@/components/ui/skeleton";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import type { InstallResult } from "@/types/video-optimizer";

import {
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_ACTIONS,
  CARD_HEAD_TEXT,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  COMMAND,
  NOTICE,
  NOTICE_BODY,
  NOTICE_GLYPH,
  NOTICE_TONE,
  SKELETON,
  STATUS_LINE,
  STATUS_VARIANT,
} from "./shapes";

// -----------------------------------------------------------------------------
// Install — the not-installed card. The only card on this shape.
// -----------------------------------------------------------------------------
// Header (action title, quiet status), one tile holding the manual route, then
// the card foot: the cost on the left edge, the commit on the right. The card
// header carries a Refresh icon, as Tailscale's does. There is no
// install transcript to show, so a live run only changes the foot.
// -----------------------------------------------------------------------------

/** The header the card and its skeleton share, so the swap never shifts. */
function InstallHeader({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation("monitoring");
  return (
    <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
      <div className={CARD_HEAD_TEXT}>
        <CardTitle className={CARD_TITLE}>
          {t("netbird.install.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("netbird.install.description")}
        </CardDescription>
      </div>
      {children}
    </CardHeader>
  );
}

/** The manual route: its label on the left edge, the command and copy button beside it. */
function CommandRow({ command }: { command: string }) {
  const { t } = useTranslation("monitoring");

  const copy = async () => {
    if (await copyText(command)) {
      toast.success(t("netbird.toast.copied"));
    } else {
      toast.error(t("netbird.toast.copyFailed"));
    }
  };

  return (
    <div className={COMMAND.ROOT}>
      <span className={COMMAND.LABEL}>{t("netbird.install.manualLabel")}</span>
      <div className={COMMAND.BOX}>
        <code className={COMMAND.TEXT}>{command}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={copy}
          className={COMMAND.COPY}
          aria-label={t("netbird.install.copyCommand")}
        >
          <CopyIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function InstallCard({
  installResult,
  runInstall,
  onRefresh,
  isRefreshing,
  installHint,
}: {
  installResult: InstallResult;
  runInstall: () => Promise<void>;
  onRefresh: () => void;
  isRefreshing: boolean;
  installHint?: string;
}) {
  const { t } = useTranslation("monitoring");
  const running = installResult.status === "running";
  const failed = installResult.status === "error";
  const done = installResult.status === "complete";
  const command = installHint || t("netbird.install.manualCommand");

  // One toast per finished install, fired when a run we watched ends. A result
  // that was already terminal on mount never toasts.
  const prevStatus = React.useRef(installResult.status);
  React.useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = installResult.status;
    if (prev !== "running") return;
    if (installResult.status === "complete") {
      toast.success(t("netbird.toast.installed"), { id: "netbird-install" });
    } else if (installResult.status === "error") {
      toast.error(installResult.message || t("netbird.toast.installFailed"), {
        id: "netbird-install",
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
      <span>{t("netbird.install.installingNow")}</span>
    </span>
  ) : done ? (
    <span className={STATUS_LINE}>
      <CheckCircle2Icon
        className="text-success-on-surface size-4 flex-none"
        aria-hidden
      />
      <span>{installResult.message ?? t("netbird.install.done")}</span>
    </span>
  ) : (
    <span className={STATUS_LINE}>
      <TriangleAlertIcon
        className="text-warning-on-surface size-4 flex-none"
        aria-hidden
      />
      <span>{t("netbird.install.cost")}</span>
    </span>
  );

  return (
    <Card className={CARD_SHELL}>
      <InstallHeader>
        <div className={CARD_HEAD_ACTIONS}>
          <Badge variant={STATUS_VARIANT.notInstalled} role="status">
            <span className="sr-only">{t("netbird.status.aria")}</span>
            <PackageIcon className="size-3" aria-hidden />
            {t("netbird.status.notInstalled")}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={running || isRefreshing}
            aria-label={t("netbird.page.refresh")}
            title={t("netbird.page.refresh")}
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

      {/* No card-level `aria-live`: the notice and the foot status are already
          live regions, and nesting them announces twice. */}
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {failed ? (
          <div role="alert" className={cn(NOTICE, NOTICE_TONE.destructive)}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            <span className={NOTICE_BODY}>
              {installResult.message || t("netbird.install.failed")}
              {installResult.detail ? (
                <span className="mt-0.5 block">{installResult.detail}</span>
              ) : null}
            </span>
          </div>
        ) : null}

        <CommandRow command={command} />
      </CardContent>

      <CardFoot
        className={CARD_PAD}
        status={status}
        actions={
          <Button
            type="button"
            size="action"
            onClick={() => runInstall()}
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
              ? t("netbird.install.installing")
              : failed
                ? t("netbird.install.retry")
                : t("netbird.install.install")}
          </Button>
        }
      />
    </Card>
  );
}

/** Mirrors the card above from the same constants: real header copy, the
 *  tile's pinned minimum height, and a foot holding the action's height. */
export function InstallCardSkeleton() {
  return (
    <Card className={CARD_SHELL}>
      <InstallHeader />
      <CardContent className={cn(CARD_PAD, CARD_BODY)} aria-hidden>
        <Skeleton className={SKELETON.SWITCH} />
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
