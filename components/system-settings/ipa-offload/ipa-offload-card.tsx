"use client";

import { motion } from "motion/react";
import { containerVariants, itemVariants } from "@/lib/motion";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";

import { useIpaOffload } from "@/hooks/use-ipa-offload";
import { requestRebootLater } from "@/lib/reboot";

const IpaOffloadCard = () => {
  const { t } = useTranslation("system-settings");
  const { state, isLoading, isSaving, error, setEnabled, refresh } =
    useIpaOffload();

  const handleToggle = async (checked: boolean) => {
    const ok = await setEnabled(checked);
    if (ok) {
      // The change only takes effect after a reboot, so queue the deferred banner.
      requestRebootLater("ipa_offload");
      toast.success(
        checked
          ? t("ipa_offload.toast_enabled")
          : t("ipa_offload.toast_disabled"),
      );
    } else {
      toast.error(t("ipa_offload.toast_failed"));
    }
  };

  const unavailable = state !== null && !state.available;
  // "Pending reboot" surfaces whenever a save has changed the on-disk setting.
  // The honest signal here is: the user toggled, the device acknowledged, and a
  // reboot is required for it to take effect.

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("ipa_offload.card_title")}</CardTitle>
        <CardDescription>{t("ipa_offload.card_description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-6 w-24" />
            </div>
            <Separator />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error && state === null ? (
          <div className="grid gap-3">
            <Alert variant="destructive">
              <AlertTriangleIcon className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button variant="outline" onClick={refresh} className="w-fit">
              <RotateCcwIcon className="size-4" />
              {t("retry", { ns: "common" })}
            </Button>
          </div>
        ) : (
          <motion.div
            className="grid gap-2"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {/* CPU-routing warning, always present so the tradeoff is explicit */}
            <motion.div variants={itemVariants}>
              <Alert>
                <AlertTriangleIcon className="size-4" />
                <AlertDescription>
                  {t("ipa_offload.cpu_warning")}
                </AlertDescription>
              </Alert>
            </motion.div>

            {/* Enable toggle */}
            <motion.div
              variants={itemVariants}
              className="flex items-center justify-between mt-2"
            >
              <Label
                htmlFor="ipa-offload"
                className="font-semibold text-muted-foreground text-sm"
              >
                {t("ipa_offload.enable_label")}
              </Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="ipa-offload"
                  checked={state?.enabled ?? false}
                  disabled={isSaving || unavailable}
                  onCheckedChange={handleToggle}
                  aria-label={t("ipa_offload.enable_label")}
                />
                <Label htmlFor="ipa-offload">
                  {state?.enabled
                    ? t("state.enabled", { ns: "common" })
                    : t("state.disabled", { ns: "common" })}
                </Label>
              </div>
            </motion.div>

            {/* Unavailable explanation: card stays visible, switch disabled */}
            {unavailable && (
              <motion.p
                variants={itemVariants}
                className="text-sm text-muted-foreground"
              >
                {t("ipa_offload.unavailable_hint")}
              </motion.p>
            )}

            {/* Pending-reboot honesty badge */}
            <motion.div
              variants={itemVariants}
              className="flex items-center justify-between mt-2"
            >
              <p className="font-semibold text-muted-foreground text-sm">
                {t("ipa_offload.status_label")}
              </p>
              <Badge
                variant="outline"
                className="bg-warning/15 text-warning border-warning/30 gap-1"
              >
                <RotateCcwIcon className="size-3" />
                {t("ipa_offload.pending_reboot_badge")}
              </Badge>
            </motion.div>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
};

export default IpaOffloadCard;
