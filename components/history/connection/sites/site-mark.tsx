"use client";

import { BrandMark } from "@/components/ui/brand-mark";
import { cn } from "@/lib/utils";

import { DETAIL, DIALOG, SITES } from "./shapes";

// The domain -> glyph map and the fetched-logo fallback live in `components/ui/brand-mark.tsx`
// (shared with the SMS sender discs); this file only fixes the Sites plate sizes.

export interface SiteMarkProps {
  host: string;
  label: string;
  /**
   * `cell`: the 56px grid tile. `row`: the 32px dialog list plate.
   * `panel`: the 36px plate in the selected-site panel.
   */
  size: "cell" | "row" | "panel";
  /** A grid tile only: the site is the one the panel is showing. */
  selected?: boolean;
}

const SKIN = {
  cell: {
    plate: SITES.TILE,
    glyph: SITES.MARK,
    favicon: SITES.FAVICON,
    monogram: SITES.MONOGRAM,
  },
  row: {
    plate: DIALOG.LOGO,
    glyph: DIALOG.LOGO_MARK,
    favicon: DIALOG.LOGO_FAVICON,
    monogram: DIALOG.LOGO_MONOGRAM,
  },
  panel: {
    plate: DETAIL.PLATE,
    glyph: DETAIL.PLATE_MARK,
    favicon: DETAIL.PLATE_FAVICON,
    monogram: DETAIL.PLATE_MONOGRAM,
  },
} as const;

export function SiteMark({ host, label, size, selected = false }: SiteMarkProps) {
  const skin = SKIN[size];
  return (
    <BrandMark
      domain={host}
      label={label}
      className={cn(
        skin.plate,
        size === "cell" && (selected ? SITES.TILE_SELECTED : SITES.TILE_HOVER),
      )}
      glyphClassName={skin.glyph}
      faviconClassName={skin.favicon}
      monogramClassName={skin.monogram}
    />
  );
}
