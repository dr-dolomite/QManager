"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TbInfoCircleFilled } from "react-icons/tb";

// -----------------------------------------------------------------------------
// InfoTip — keyboard-focusable info tooltip trigger (shared across the Alerts
// surface; mirrors the Watchdog page's InfoTip so the two feel identical).
// -----------------------------------------------------------------------------
export function InfoTip({ text, aria }: { text: string; aria: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-info inline-flex shrink-0"
          aria-label={aria}
        >
          <TbInfoCircleFilled className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}
