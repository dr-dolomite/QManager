"use client";

import AdaptivePollingCard from "@/components/system-settings/adaptive-polling/adaptive-polling-card";

const AdaptivePollingSettings = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Adaptive Polling</h1>
        <p className="text-muted-foreground">
          Controls how often the modem is queried for status data based on
          whether the UI is active.
        </p>
      </div>
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <AdaptivePollingCard />
      </div>
    </div>
  );
};

export default AdaptivePollingSettings;
