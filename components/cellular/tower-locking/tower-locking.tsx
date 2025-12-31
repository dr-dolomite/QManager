import React from "react";
import TowerLockingSettingsComponent from "@/components/cellular/tower-locking/tower-settings";
import ScheduleTowerLockingComponent from "./schedule-locking";
import LTELockingComponent from "./lte-locking";
import NRSALockingComponent from "./nr-sa-locking";

const TowerLockingComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Tower Locking</h1>
        <p className="text-muted-foreground max-w-5xl ">
          Manage and configure tower locking settings for your cellular device
          to select and lock onto specific cell towers, enhancing network
          stability and performance.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
          <TowerLockingSettingsComponent />
          <LTELockingComponent />
        </div>

        <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
          <ScheduleTowerLockingComponent />
          <NRSALockingComponent />
        </div>
      </div>
    </div>
  );
};

export default TowerLockingComponent;
