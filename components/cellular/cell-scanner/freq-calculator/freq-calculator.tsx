import React from "react";
import FrequencyCalculator from "./calculator";

const FrequencyCalculatorComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Frequency Calculator</h1>
        <p className="text-muted-foreground max-w-5xl">
          Calculate and convert cellular frequencies, channels, and bands for
          various network types including LTE and 5G NR. This tool helps in
          identifying the correct frequency allocations and channel numbers for
          efficient network planning and optimization.
        </p>
      </div>
      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <FrequencyCalculator />
      </div>
    </div>
  );
};

export default FrequencyCalculatorComponent;
