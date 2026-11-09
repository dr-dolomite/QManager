"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { useSites } from "@/hooks/use-sites";
import { DUR, EASE_STANDARD, rowCascadeDelay } from "@/lib/motion";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { cn } from "@/lib/utils";
import type { HistoryRange } from "@/types/history";
import type { SiteEntry, SitesConfig, SitesResponse } from "@/types/sites";

import { ConditionBlock } from "./condition-block";
import {
  buildSitePoints,
  latencyTone,
  msText,
  siteAverage,
  type UnitLabels,
} from "./derive";
import { ManageSitesDialog, useIntervalLabel } from "./manage-sites-dialog";
import {
  CARD_DESC,
  CARD_HEADER,
  CARD_SHELL,
  CARD_TITLE,
  HEADER_ACTIONS,
  NOTICE,
  SITES,
  SITE_INK,
  TRANSITION_INK,
} from "./shapes";
import { SiteDetail } from "./site-detail";
import { SiteMark } from "./site-mark";

/** The saved config as the CGI reports it: every configured site, gateway excluded. */
function configOf(data: SitesResponse): SitesConfig {
  return {
    enabled: data.enabled,
    interval_sec: data.interval_sec,
    sites: data.sites
      .filter((s) => s.kind === "site")
      .map(({ host, label }) => ({ host, label })),
  };
}

interface SiteCellProps {
  site: SiteEntry;
  /** The same site in the live sweep; null while Live is off or before its first read. */
  liveSite: SiteEntry | null;
  index: number;
  limitMs: number;
  units: UnitLabels;
  /** A sweep is running, or the range read is still catching up: the figure dims. */
  dim: boolean;
  selected: boolean;
  onSelect: (host: string) => void;
}

function SiteCell({
  site,
  liveSite,
  index,
  limitMs,
  units,
  dim,
  selected,
  onSelect,
}: SiteCellProps) {
  const { t } = useTranslation("history");

  let value: ReactNode;
  if (liveSite?.latest) {
    // Live: the sample itself, a miss is a miss.
    const ms = liveSite.latest.ok ? liveSite.latest.ms : null;
    value =
      ms === null ? (
        <span className={SITE_INK.bad}>{t("connection.sites.no_reply")}</span>
      ) : (
        <span className={SITE_INK[latencyTone(ms, limitMs)]}>
          {msText(ms, units)}
        </span>
      );
  } else {
    const average = siteAverage(site.series);
    const sampled = site.series.some((b) => b.n > 0);
    if (average !== null) {
      value = (
        <span className={SITE_INK[latencyTone(average, limitMs)]}>
          {msText(average, units)}
        </span>
      );
    } else if (sampled) {
      value = (
        <span className={SITE_INK.bad}>{t("connection.sites.no_reply")}</span>
      );
    } else if (!site.latest) {
      value = (
        <span className={SITES.QUIET}>{t("connection.sites.not_checked")}</span>
      );
    } else {
      value = <span className={SITES.QUIET}>{units.dash}</span>;
    }
  }

  return (
    <motion.button
      type="button"
      className={cn(SITES.CELL, SITES.CELL_BUTTON)}
      aria-pressed={selected}
      onClick={() => onSelect(site.host)}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: DUR.standard,
        ease: EASE_STANDARD,
        delay: rowCascadeDelay(index),
      }}
    >
      <SiteMark host={site.host} label={site.label} size="cell" selected={selected} />
      <span className={SITES.LABEL} title={site.host}>
        {site.label}
      </span>
      <span
        className={cn(
          SITES.VALUE,
          SITES.VALUE_H,
          TRANSITION_INK,
          dim && SITES.CHECKING,
        )}
      >
        {value}
      </span>
    </motion.button>
  );
}

function SitesSkeleton() {
  return (
    <div className={SITES.GRID} aria-hidden>
      {Array.from({ length: SITES.SKELETON_COUNT }).map((_, i) => (
        <div key={i} className={SITES.CELL}>
          <Skeleton className={SITES.TILE} />
          <Skeleton className={cn(SITES.LABEL_H, "w-[4.5rem] rounded-inline")} />
          <Skeleton className={cn(SITES.VALUE_H, "w-11 rounded-inline")} />
        </div>
      ))}
    </div>
  );
}

export interface SitesCardProps {
  /** The page range; the card has no range control of its own. */
  range: HistoryRange;
  /** The latency limit (ms): values are coloured against it and the panel draws it. */
  latencyLimitMs: number;
}

export function SitesCard({ range, latencyLimitMs }: SitesCardProps) {
  const { t } = useTranslation("history");
  const intervalLabel = useIntervalLabel();

  const [live, setLive] = useState(false);
  const {
    data,
    dataRange,
    dataNow,
    liveData,
    isLoading,
    error,
    checkPending,
    refresh,
    checkNow,
    save,
  } = useSites(range, live);

  const [turningOn, setTurningOn] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);

  // Stable identity: the memoised chart takes `units` as a prop.
  const units = useMemo<UnitLabels>(
    () => ({
      ms: t("connection.sites.unit_ms"),
      s: t("connection.sites.unit_s"),
      dash: t("connection.sites.unmeasured"),
    }),
    [t],
  );

  const off = data !== null && !data.enabled;
  const dim = (data?.checking ?? false) || checkPending || dataRange !== range;
  const sites = data?.sites ?? [];
  const selected = sites.find((s) => s.host === selectedHost) ?? null;

  // The panel keeps the range it was read for until the new range lands.
  const shownRange = dataRange ?? range;
  const selectedSeries = selected?.series;
  const points = useMemo(
    () =>
      selectedSeries && dataNow !== null
        ? buildSitePoints(selectedSeries, shownRange, dataNow)
        : [],
    [selectedSeries, shownRange, dataNow],
  );

  const liveSites = useMemo(
    () => new Map((liveData?.sites ?? []).map((s) => [s.host, s])),
    [liveData],
  );

  // A saved list is checked at once, so new sites show a value without waiting a sweep.
  const handleSave = async (config: SitesConfig) => {
    const result = await save(config);
    if (result.ok && config.enabled) {
      void checkNow().then((check) => {
        if (!check.ok) {
          toast.error(t("connection.toast.check_failed"), {
            description: resolveErrorMessage(
              t,
              check.code,
              check.error,
              t("connection.sites.error_description"),
            ),
          });
        }
      });
    }
    return result;
  };

  const handleTurnOn = async () => {
    if (!data) return;
    setTurningOn(true);
    const result = await save({ ...configOf(data), enabled: true });
    setTurningOn(false);
    if (result.ok) {
      toast.success(t("connection.toast.turn_on_ok"));
    } else {
      toast.error(t("connection.toast.turn_on_failed"), {
        description: resolveErrorMessage(
          t,
          result.code,
          result.error,
          t("connection.sites.error_description"),
        ),
      });
    }
  };

  const openManage = () => {
    setFormKey((k) => k + 1);
    setManageOpen(true);
  };

  const toggleSelected = (host: string) =>
    setSelectedHost((cur) => (cur === host ? null : host));

  let body: ReactNode;
  if (!data && isLoading) {
    body = <SitesSkeleton />;
  } else if (!data) {
    body = (
      <ConditionBlock
        tone="destructive"
        icon="error"
        title={t("connection.sites.error_title")}
        description={t("connection.sites.error_description")}
        actionLabel={t("connection.sites.retry")}
        onAction={refresh}
        actionIcon="refresh"
      />
    );
  } else if (off) {
    body = (
      <ConditionBlock
        tone="muted"
        icon="power_settings_new"
        title={t("connection.sites.off_title")}
        description={t("connection.sites.off_description", {
          interval: intervalLabel(data.interval_sec),
        })}
        actionLabel={t("connection.sites.turn_on")}
        onAction={handleTurnOn}
        actionIcon="power_settings_new"
        actionVariant="tonal"
        actionBusy={turningOn}
      />
    );
  } else if (sites.length === 0) {
    body = (
      <ConditionBlock
        tone="muted"
        icon="public"
        title={t("connection.sites.empty_title")}
        description={t("connection.sites.empty_description")}
        actionLabel={t("connection.sites.manage")}
        onAction={openManage}
        actionIcon="tune"
      />
    );
  } else {
    body = (
      <>
        <div className={SITES.GRID} aria-busy={dim || undefined}>
          {sites.map((site, i) => (
            <SiteCell
              key={site.host}
              site={site}
              liveSite={liveSites.get(site.host) ?? null}
              index={i}
              limitMs={latencyLimitMs}
              units={units}
              dim={dim && liveData === null}
              selected={site.host === selected?.host}
              onSelect={toggleSelected}
            />
          ))}
        </div>
        {selected && dataNow !== null ? (
          <motion.div
            key={selected.host}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
          >
            <SiteDetail
              site={selected}
              range={shownRange}
              points={points}
              nowSec={dataNow}
              limitMs={latencyLimitMs}
              units={units}
              onClose={() => setSelectedHost(null)}
            />
          </motion.div>
        ) : null}
      </>
    );
  }

  return (
    <Card className={CARD_SHELL} aria-label={t("connection.sites.title")}>
      <CardHeader className={CARD_HEADER}>
        <CardTitle as="h2" className={CARD_TITLE}>
          {t("connection.sites.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("connection.sites.description")}
        </CardDescription>
        <CardAction className={HEADER_ACTIONS}>
          <Button
            type="button"
            variant="ghost"
            onClick={openManage}
            disabled={!data}
          >
            <MaterialSymbol name="tune" size={18} />
            {t("connection.sites.manage")}
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-5 px-0">
        {error && data ? (
          <div role="alert" className={NOTICE}>
            <MaterialSymbol name="warning" size={14} className="flex-none" />
            {t("connection.sites.notice_stale")}
          </div>
        ) : null}
        {body}
      </CardContent>

      <ManageSitesDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        formKey={formKey}
        seed={data ? configOf(data) : null}
        live={live}
        onSave={handleSave}
        onLiveChange={setLive}
      />
    </Card>
  );
}
