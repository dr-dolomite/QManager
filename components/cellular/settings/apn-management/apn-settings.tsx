import React from "react";
import APNSettingsCard from "./apn-card";
import MBNCard from "./mbn-card";

const APNSettingsComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">
            APN Management
        </h1>
        <p className="text-muted-foreground max-w-5xl">
            Manage Access Point Names (APNs) for your cellular connections. Configure and prioritize APNs to ensure optimal connectivity and performance for your device.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <APNSettingsCard />
        <MBNCard />
      </div>
    </div>
  );
};

export default APNSettingsComponent;
