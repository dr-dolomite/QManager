import * as React from "react";
import { TbInfoCircleFilled } from "react-icons/tb";
import { TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type HintVariant = "info" | "muted" | "warning";
type HintSize = "sm" | "md";

interface VariantStyle {
  Icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  cursor: string;
}

const VARIANT_STYLES: Record<HintVariant, VariantStyle> = {
  info: {
    Icon: TbInfoCircleFilled,
    iconClass: "text-info",
    cursor: "",
  },
  muted: {
    Icon: TbInfoCircleFilled,
    iconClass: "text-muted-foreground",
    cursor: "",
  },
  warning: {
    Icon: TriangleAlertIcon,
    iconClass: "text-warning",
    cursor: "cursor-help",
  },
};

const SIZE_CLASS: Record<HintSize, string> = {
  sm: "size-4",
  md: "size-5",
};

export interface HintIconProps {
  /** Accessible label announced by screen readers — must disambiguate when multiple hints share a page. */
  label: string;
  /** Tooltip body. Plain string or rich nodes both fine. */
  children: React.ReactNode;
  /**
   * Visual treatment. `info` for primary system-state hints, `muted` for secondary UI-preference hints,
   * `warning` for passive caution markers (renders TriangleAlertIcon + cursor-help).
   */
  variant?: HintVariant;
  /** `md` (size-5, default) for primary hints; `sm` (size-4) for secondary or inline-with-text hints. */
  size?: HintSize;
}

export function HintIcon({
  label,
  children,
  variant = "info",
  size = "md",
}: HintIconProps) {
  const { Icon, iconClass, cursor } = VARIANT_STYLES[variant];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn("inline-flex items-center", cursor)}
        >
          <Icon className={cn(SIZE_CLASS[size], iconClass)} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-balance max-w-sm">{children}</p>
      </TooltipContent>
    </Tooltip>
  );
}
