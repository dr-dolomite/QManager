"use client";

import * as React from "react";
import { ChevronRightIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { DISCLOSURE } from "./shapes";

/**
 * A quiet disclosure: a full-width row (chevron, label, a one-line summary on
 * the right edge) that opens a body in place. The summary keeps the answer
 * visible while the body is shut, so the common case never needs opening.
 */
export function Disclosure({
  label,
  summary,
  live = false,
  autoOpen = false,
  children,
}: {
  label: string;
  summary?: React.ReactNode;
  /** The summary reports something happening right now. */
  live?: boolean;
  /** Open while this holds, until the user opens or closes it themselves. */
  autoOpen?: boolean;
  children: React.ReactNode;
}) {
  const [manual, setManual] = React.useState<boolean | null>(null);
  return (
    <Collapsible
      open={manual ?? autoOpen}
      onOpenChange={setManual}
      className={DISCLOSURE.ROOT}
    >
      <CollapsibleTrigger className={DISCLOSURE.TRIGGER}>
        <ChevronRightIcon className={DISCLOSURE.CHEV} aria-hidden />
        <span>{label}</span>
        {summary ? (
          <span className={cn(DISCLOSURE.SUMMARY, live && DISCLOSURE.SUMMARY_LIVE)}>
            {summary}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={DISCLOSURE.BODY}>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
