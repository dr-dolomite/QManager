"use client";

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, CheckCircle2Icon, MinusCircleIcon } from "lucide-react";

// =============================================================================
// CellMapperAccountCard — Read-only definition-list card showing account status.
// Shows linkage status, username, linked date, token expiry, and action buttons.
// =============================================================================

interface CellMapperAccountCardProps {
  settings: {
    username: string | null;
    linked_at: number | null;
    consent_accepted: boolean;
  } | null;
  isLinked: boolean;
  isLoading: boolean;
  onSignOut: () => Promise<boolean>;
  onTestConnection: () => Promise<{ success: boolean; message: string }>;
}

export function CellMapperAccountCard({
  settings,
  isLinked,
  isLoading,
  onSignOut,
  onTestConnection,
}: CellMapperAccountCardProps) {
  const { t } = useTranslation("monitoring");

  // Loading skeleton
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("cellmapper.account_card_title")}</CardTitle>
          <CardDescription>
            {t("cellmapper.account_card_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Separator className="mb-3" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            ))}
            <Separator />
            <div className="flex items-center gap-2 pt-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <CellMapperAccountCardContent
      settings={settings}
      isLinked={isLinked}
      onSignOut={onSignOut}
      onTestConnection={onTestConnection}
    />
  );
}

// --- Inner component ----------------------------------------------------------

function CellMapperAccountCardContent({
  settings,
  isLinked,
  onSignOut,
  onTestConnection,
}: Omit<CellMapperAccountCardProps, "isLoading">) {
  const { t } = useTranslation("monitoring");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Token expiry: linked_at unix timestamp + 90-day TTL
  const tokenExpiryDays = useMemo(() => {
    if (!settings?.linked_at) return null;
    const expiresAt = settings.linked_at + 90 * 24 * 60 * 60;
    const remaining = Math.ceil((expiresAt - Date.now() / 1000) / 86400);
    return remaining > 0 ? remaining : 0;
  }, [settings?.linked_at]);

  // "Since" date formatted from unix timestamp
  const formattedDate = settings?.linked_at
    ? new Date(settings.linked_at * 1000).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      const ok = await onSignOut();
      if (ok) toast.success(t("cellmapper.toast_signout_success"));
      else toast.error(t("cellmapper.toast_signout_error"));
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const result = await onTestConnection();
      if (result.success) toast.success(t("cellmapper.toast_test_ok"));
      else
        toast.error(
          t("cellmapper.toast_test_fail", { reason: result.message }),
        );
    } finally {
      setIsTesting(false);
    }
  };

  // Definition-list rows
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: t("cellmapper.account_row_status"),
      value: isLinked ? (
        <Badge
          variant="outline"
          className="bg-success/15 text-success border-success/30 hover:bg-success/20"
        >
          <CheckCircle2Icon className="h-3 w-3" />
          {t("cellmapper.account_status_linked")}
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
        >
          <MinusCircleIcon className="h-3 w-3" />
          {t("cellmapper.account_status_not_linked")}
        </Badge>
      ),
    },
    {
      label: t("cellmapper.account_row_user"),
      value: settings?.username ?? (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      label: t("cellmapper.account_row_since"),
      value: formattedDate ?? (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      label: t("cellmapper.account_row_token_expires"),
      value:
        tokenExpiryDays !== null ? (
          <span
            className={
              tokenExpiryDays <= 7
                ? "text-destructive font-semibold"
                : tokenExpiryDays <= 30
                  ? "text-warning font-semibold"
                  : undefined
            }
          >
            {t("cellmapper.account_token_days", { count: tokenExpiryDays })}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("cellmapper.account_card_title")}</CardTitle>
        <CardDescription>
          {t("cellmapper.account_card_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-0">
          {rows.map((row) => (
            <div key={row.label}>
              <Separator className="mb-2" />
              <div className="flex items-center justify-between py-1">
                <p className="text-sm font-semibold text-muted-foreground">
                  {row.label}
                </p>
                <p className="text-sm font-semibold">{row.value}</p>
              </div>
            </div>
          ))}
          <Separator className="mb-4 mt-2" />

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!isLinked || isSigningOut}
              onClick={() => void handleSignOut()}
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            >
              {isSigningOut ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("cellmapper.account_signing_out")}
                </>
              ) : (
                t("cellmapper.account_sign_out_button")
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={!isLinked || isTesting}
              onClick={() => void handleTest()}
            >
              {isTesting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("cellmapper.account_testing")}
                </>
              ) : (
                t("cellmapper.account_test_connection_button")
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
