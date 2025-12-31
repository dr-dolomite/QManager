import React from "react";
import FullScannerComponent from "./scanner";

const CellScannerComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Cell Scanner</h1>
        <p className="text-muted-foreground max-w-5xl">
          Discover and analyze nearby cellular towers across all available
          networks. View signal strengths, network providers, and tower
          information in real-time. For optimal results, perform scans without
          an active SIM card to detect all carriers.
        </p>
      </div>
      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
      <FullScannerComponent />
      </div>
    </div>
  );
};

export default CellScannerComponent;
