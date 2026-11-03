"use client";

import type * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import type { UpdateInfo } from "@/hooks/use-software-update";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_STACK,
  CARD_TITLE,
  ROW,
  ROW_GROUP,
  VALUE_MONO,
} from "./shapes";

const K = "software_update.managed";

/** The package name `update.sh` reports when the field is missing. */
const FALLBACK_PACKAGE = "sdxpinn-qmanager";

export interface ManagedCardProps {
  info: UpdateInfo | null;
}

/**
 * Replaces the update, notes, preferences and version cards on a package
 * install: the package manager owns every one of those verbs, so the page only
 * says where the update lives and under which name.
 */
export function ManagedCard({ info }: ManagedCardProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const packageName = info?.package_name?.trim() || FALLBACK_PACKAGE;

  return (
    <motion.div variants={staggerItem}>
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>{t(`${K}.title`)}</CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(`${K}.description`)}
          </CardDescription>
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_STACK)}>
          <div className={ROW_GROUP}>
            <div className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <span className={ROW.LABEL}>{t(`${K}.package.label`)}</span>
                <span className={ROW.CONSEQUENCE}>
                  {t(`${K}.package.description`)}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <Tag variant="neutral" className={VALUE_MONO}>
                  {packageName}
                </Tag>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default ManagedCard;
