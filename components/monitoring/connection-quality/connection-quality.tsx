"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import { useConnectionQuality } from "@/hooks/use-connection-quality";
import { staggerContainer, staggerItem } from "@/lib/motion";

import ProbeTargetsCard from "./probe-targets-card";
import { CARD_CELL, PAIR, PAGE_ROOT } from "./shapes";
import SensitivityQualityCard from "./sensitivity-quality-card";

const K = "connection_quality";

export function ConnectionQualitySettings() {
  const { t } = useTranslation("monitoring");
  const cq = useConnectionQuality();

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {/* The cascade root declares initial/animate once; children only take variants. */}
      <motion.div variants={staggerItem}>
        <MonitoringPageHeader
          title={t(`${K}.page.title`)}
          description={t(`${K}.page.description`)}
        />
      </motion.div>

      <motion.div className={PAIR} variants={staggerContainer}>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <ProbeTargetsCard cq={cq} />
        </motion.div>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <SensitivityQualityCard cq={cq} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export default ConnectionQualitySettings;
