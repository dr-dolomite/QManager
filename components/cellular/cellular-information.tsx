import React from "react";
import CellDataComponent from "@/components/cellular/cell-data";
import ActiveBandsComponent from "@/components/cellular/active-bands";

const CellularInformationComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">
          Cellular and Radio Information
        </h1>
        <p className="text-muted-foreground">
          View detailed information about your device&apos;s cellular radio
          status, including signal strength, network type, and connection
          status.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
      <CellDataComponent />
       <ActiveBandsComponent />
      </div>
    </div>
  );
};

export default CellularInformationComponent;
