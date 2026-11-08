"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CardSimIcon, RotateCcwIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Banner, bannerActionVariants } from "@/components/ui/banner";
import type { CqWdMutationResult, WatchdogFailoverRecord } from "@/types/cq-watchdog";

export interface FailoverBannerProps {
  failover: WatchdogFailoverRecord;
  /** Relative time since the switch, already translated. */
  since: string;
  revertSim: () => Promise<CqWdMutationResult>;
}

/**
 * Running on the backup SIM. The one place the failover can be undone, so it
 * carries the Revert action — dropping it would strand a user on the backup.
 */
export function FailoverBanner({
  failover,
  since,
  revertSim,
}: FailoverBannerProps) {
  const { t } = useTranslation("monitoring");
  const [reverting, setReverting] = React.useState(false);
  // A revert already asked for stays pending until the daemon acts on it.
  const pending = reverting || failover.revert_pending === true;

  const handleRevert = React.useCallback(async () => {
    setReverting(true);
    const result = await revertSim();
    setReverting(false);
    if (result.ok) toast.success(t("watchdog.failover.requested"));
    else toast.error(result.message ?? t("watchdog.failover.failed"));
  }, [revertSim, t]);

  return (
    <Banner
      role="degraded"
      icon={CardSimIcon}
      title={t("watchdog.failover.title")}
      description={t("watchdog.failover.body", {
        current: failover.current_slot ?? "?",
        original: failover.original_slot ?? "?",
        since,
      })}
      action={
        <AlertDialog>
          <AlertDialogTrigger
            className={bannerActionVariants({ tone: "on-warning" })}
            disabled={pending}
          >
            <RotateCcwIcon />
            {pending
              ? t("watchdog.failover.reverting")
              : t("watchdog.failover.revert")}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("watchdog.failover.confirmTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("watchdog.failover.confirmBody", {
                  original: failover.original_slot ?? "?",
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("watchdog.failover.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleRevert()}>
                {t("watchdog.failover.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    />
  );
}
