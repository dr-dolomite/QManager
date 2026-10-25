"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  CircleHelpIcon,
  MinusCircleIcon,
  PackageIcon,
  PowerOffIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  SKELETON,
  TILE,
  TILE_CAPTION,
  TILE_CAPTION_MONO,
  TILE_VALUE,
  TILE_VALUE_MONO,
  TILE_VALUE_TONE,
  type DiscTone,
  type NetbirdView,
  type TileValueTone,
} from "./shapes";

export interface StatusTileProps {
  icon: LucideIcon;
  eyebrow: string;
  value: string;
  caption: React.ReactNode;
  discTone?: DiscTone;
  valueTone?: TileValueTone;
  /** True when the figure is an identifier the device emitted, not a reading. */
  mono?: boolean;
}

function StatusTile({
  icon: Icon,
  eyebrow,
  value,
  caption,
  discTone = "neutral",
  valueTone = "neutral",
  mono = false,
}: StatusTileProps) {
  return (
    <div className={TILE.ROOT}>
      <span
        aria-hidden
        className={cn(TILE.DISC, DISC_TRANSITION, DISC_TONE[discTone])}
      >
        <Icon className={TILE.GLYPH} />
      </span>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{eyebrow}</span>
        {/* Colour goes on the figure and the disc, never on the tile body. */}
        <span
          title={value}
          className={cn(
            mono ? TILE_VALUE_MONO : TILE_VALUE,
            TILE_VALUE_TONE[valueTone],
          )}
        >
          {value}
        </span>
        <span className={TILE_CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

export function StatusBand({ tiles }: { tiles: StatusTileProps[] }) {
  return (
    <div className={TILE.GRID}>
      {tiles.map((tile) => (
        <StatusTile key={tile.eyebrow} {...tile} />
      ))}
    </div>
  );
}

/** Mirrors the band's pinned tile height from the same constant. */
export function StatusBandSkeleton() {
  return (
    <div className={TILE.GRID} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className={SKELETON.TILE} />
      ))}
    </div>
  );
}

/** A short machine-voice fact under a figure, such as a hostname. */
export function TileMono({ children }: { children: React.ReactNode }) {
  return <span className={TILE_CAPTION_MONO}>{children}</span>;
}

/** Distinct glyph per state: four of the five land on the same `muted` fill. */
export const STATUS_GLYPH = {
  connected: CheckCircle2Icon,
  disconnected: MinusCircleIcon,
  serviceStopped: PowerOffIcon,
  notInstalled: PackageIcon,
  unknown: CircleHelpIcon,
} satisfies Record<NetbirdView, LucideIcon>;

/** A control-plane link (management or signal): "Connected" is translated, any
 *  other word is the daemon's own and is shown as it came. */
export function ControlPlaneChip({ raw }: { raw: string }) {
  const { t } = useTranslation("monitoring");
  return raw === "Connected" ? (
    <Badge variant="success">
      <CheckCircle2Icon className="size-3" />
      {t("netbird.status.connected")}
    </Badge>
  ) : (
    <Badge variant="destructive">
      <XCircleIcon className="size-3" />
      {raw}
    </Badge>
  );
}
