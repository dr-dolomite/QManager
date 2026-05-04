import type { CarrierOption } from "./simple-mode-utils";

interface CarrierLabelProps {
  opt: CarrierOption;
}

// Layout: [PCC/SCC] Band (EARFCN) RSRP dBm
export function CarrierLabel({ opt }: CarrierLabelProps) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span
        className={`text-[10px] px-1.5 py-0.5 rounded border ${
          opt.type === "PCC"
            ? "border-success/40 text-success bg-success/10"
            : "border-info/40 text-info bg-info/10"
        }`}
      >
        {opt.type}
      </span>
      <span className="font-medium">{opt.band || "—"}</span>
      <span className="tabular-nums text-muted-foreground">({opt.earfcn})</span>
      {opt.rsrp !== null && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {opt.rsrp} dBm
        </span>
      )}
    </span>
  );
}
