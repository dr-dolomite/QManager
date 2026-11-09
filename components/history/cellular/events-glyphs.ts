import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import type { EventTone } from "@/lib/event-presentation";
import type { CellularEventType } from "@/types/history";

// One glyph per event family, so a row is scannable by shape before it is read.
// Lost and gained anchors differ by glyph as well as by disc colour.
const GLYPH: Record<CellularEventType, MaterialSymbolName> = {
  signal_lost: "signal_cellular_off",
  signal_restored: "signal_cellular_alt",
  nr_anchor: "link",
  pci_change: "cell_tower",
  scc_pci_change: "alt_route",
  band_change: "swap_horiz",
  ca_change: "layers",
};

export function eventGlyph(type: CellularEventType, tone: EventTone): MaterialSymbolName {
  if (type === "nr_anchor" && tone !== "success") return "link_off";
  return GLYPH[type];
}

/** The type's resting glyph, for the filter menu. */
export function eventTypeGlyph(type: CellularEventType): MaterialSymbolName {
  return GLYPH[type];
}
