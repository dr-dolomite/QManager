import React from "react";
import NeighbourCellScanner from "./neighbour-scanner";

const NeighbourcellComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Neighbor Cell Scanner</h1>
        <p className="text-muted-foreground max-w-5xl">
          Discover and analyze neighboring cellular towers from your current
          connection. View signal strengths, network providers, and tower
          information in real-time to optimize your connectivity.
        </p>
      </div>
      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <NeighbourCellScanner />
      </div>
    </div>
  );
};

export default NeighbourcellComponent;
