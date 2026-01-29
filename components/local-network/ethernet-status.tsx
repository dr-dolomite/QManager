import React from "react";
import EthernetStatusCard from "./ethernet-card";

const EthernetStatusComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Ethernet Status Information</h1>
        <p className="text-muted-foreground">
          View detailed information about your device&apos;s Ethernet status,
          including connection status, speed, and other relevant metrics.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <EthernetStatusCard />
      </div>
    </div>
  );
};

export default EthernetStatusComponent;
