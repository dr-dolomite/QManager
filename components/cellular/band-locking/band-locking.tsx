import React from "react";
import BandCardsComponent from "./band-cards";
import BandSettingsComponent from "./band-settings";

const BandLockingComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Band Locking</h1>
        <p className="text-muted-foreground max-w-5xl">
          Manage and configure band locking settings for your cellular device to
          optimize network performance and connectivity.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <BandSettingsComponent />
        {/* Band Locking Cards or Components go here */}
        <BandCardsComponent
          title="LTE Band Locking"
          description="Select the LTE bands to lock for your device."
          bandType="lte"
          prefix="B"
        />
        <BandCardsComponent
          title="NSA Band Locking"
          description="Select the NR bands to lock for your device."
          bandType="nr"
          prefix="N"
        />
        <BandCardsComponent
          title="SA Band Locking"
          description="Select the NR bands to lock for your device."
          bandType="nr"
          prefix="N"
        />
      </div>
    </div>
  );
};

export default BandLockingComponent;
