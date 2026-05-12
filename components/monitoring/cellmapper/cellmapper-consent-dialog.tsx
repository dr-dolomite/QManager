"use client";

import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ExternalLinkIcon } from "lucide-react";

// =============================================================================
// CellMapperConsentDialog — AlertDialog shown when the user first enables the
// collector without having previously accepted the data-sharing consent.
// =============================================================================

interface CellMapperConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "cellmapper.net" or a custom URL */
  endpoint: string;
  onConfirm: () => void;
}

export function CellMapperConsentDialog({
  open,
  onOpenChange,
  endpoint,
  onConfirm,
}: CellMapperConsentDialogProps) {
  const { t } = useTranslation("monitoring");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("cellmapper.consent_title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("cellmapper.consent_desc")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{t("cellmapper.consent_preamble")}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t("cellmapper.consent_bullet_gps")}</li>
            <li>
              {t("cellmapper.consent_bullet_tos")}
              <a
                href="https://www.cellmapper.net/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-foreground hover:underline inline-flex items-center gap-0.5"
              >
                <ExternalLinkIcon className="size-3" />
              </a>
            </li>
            <li>{t("cellmapper.consent_bullet_delete")}</li>
          </ul>
          <p className="pt-2 text-xs">
            {t("cellmapper.consent_destination", { endpoint })}
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>
            {t("cellmapper.consent_cancel")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t("cellmapper.consent_confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
