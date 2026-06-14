"use client";

import AdaptivePollingCard from "@/components/system-settings/adaptive-polling/adaptive-polling-card";

const AdaptivePollingSettings = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Adaptive Polling</h1>
        <p className="text-muted-foreground">
          Save the modem from constant AT polling by slowing down when no one is
          viewing the UI, then snapping back to full rate on demand.
        </p>
      </div>
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <AdaptivePollingCard />
      </div>
    </div>
  );
};

export default AdaptivePollingSettings;
