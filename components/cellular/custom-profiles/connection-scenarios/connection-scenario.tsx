import React from "react";
import ConnectionScenariosCard from "./connection-scenario-card";

const ConnectionScenariosComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Connection Scenarios</h1>
        <p className="text-muted-foreground">
          Manage and customize connection scenarios for your cellular profiles
          to optimize network performance and reliability.
        </p>
      </div>
        <ConnectionScenariosCard />
    </div>
  );
};

export default ConnectionScenariosComponent;
