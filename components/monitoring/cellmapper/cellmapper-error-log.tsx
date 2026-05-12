"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CellMapperErrorLogProps {
  errors: Array<{
    ts: number;
    source: string;
    msg: string;
    count: number;
  }>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CellMapperErrorLog({ errors }: CellMapperErrorLogProps) {
  const { t } = useTranslation("monitoring");
  const [expanded, setExpanded] = useState(false);

  // Don't render anything if there are no errors
  if (errors.length === 0) return null;

  return (
    <div className="mt-4">
      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground hover:text-foreground gap-1"
        onClick={() => setExpanded(!expanded)}
      >
        <AlertTriangleIcon className="h-3 w-3" />
        {t("cellmapper.errors_toggle")}
        <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0">
          {errors.length}
        </Badge>
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="h-3 w-3" />
        </motion.span>
      </Button>

      {errors.length > 50 && (
        <p className="text-xs text-muted-foreground italic mt-1 ml-1">
          {t("cellmapper.errors_historical_hint")}
        </p>
      )}

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1 max-h-64 overflow-y-auto rounded-md border p-3">
              {errors.map((err, i) => (
                <div
                  key={`${err.ts}-${i}`}
                  className="flex items-start gap-2 text-xs"
                >
                  <span className="text-muted-foreground whitespace-nowrap font-mono">
                    {new Date(err.ts * 1000).toLocaleTimeString()}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 shrink-0"
                  >
                    {err.source}
                  </Badge>
                  <span className="text-muted-foreground flex-1">{err.msg}</span>
                  {err.count > 1 && (
                    <span className="text-muted-foreground/60 text-[10px]">
                      {t("cellmapper.errors_count", { count: err.count })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
