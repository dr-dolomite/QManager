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
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2Icon, DownloadIcon, AlertTriangleIcon } from "lucide-react";

import { useDiagnostics } from "@/hooks/use-diagnostics";

const DiagnosticsCard = () => {
  const { t } = useTranslation("system-settings");
  const { stage, error, capture } = useDiagnostics();

  const isCapturing = stage === "capturing";

  const handleCapture = async () => {
    const ok = await capture();
    if (ok) {
      toast.success(t("diagnostics.toast_success"));
    } else {
      toast.error(t("diagnostics.toast_failed"));
    }
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("diagnostics.card_title")}</CardTitle>
        <CardDescription>{t("diagnostics.card_description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <motion.div
          className="grid gap-4"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.p
            variants={itemVariants}
            className="text-sm text-muted-foreground"
          >
            {t("diagnostics.body")}
          </motion.p>

          {stage === "error" && error && (
            <motion.div variants={itemVariants}>
              <Alert variant="destructive">
                <AlertTriangleIcon className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </motion.div>
          )}

          <motion.div variants={itemVariants}>
            <Button
              onClick={handleCapture}
              disabled={isCapturing}
              className="w-full @sm/card:w-auto"
            >
              {isCapturing ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  {t("diagnostics.button_capturing")}
                </>
              ) : (
                <>
                  <DownloadIcon className="size-4" />
                  {t("diagnostics.button_capture")}
                </>
              )}
            </Button>
          </motion.div>
        </motion.div>
      </CardContent>
    </Card>
  );
};

export default DiagnosticsCard;
