import React from "react";

import { IconBell } from "@tabler/icons-react";
import { RefreshCcwIcon, ScanSearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

const ScannerEmptyView = () => {
  return (
    <Empty className="from-muted/50 to-background h-full bg-gradient-to-b from-30%">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ScanSearchIcon />
        </EmptyMedia>
        <EmptyTitle>No Scans Available</EmptyTitle>
        <EmptyDescription>
          There are currently no cellular scans available. Please initiate a new
          scan to discover nearby networks and towers.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm">
          <RefreshCcwIcon />
          Start New Scan
        </Button>
      </EmptyContent>
    </Empty>
  );
};

export default ScannerEmptyView;
