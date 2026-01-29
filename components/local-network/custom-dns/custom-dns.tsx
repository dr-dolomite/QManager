import React from "react";
import CustomDNSCard from "./custom-dns-card";

const CustomDNSComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Custom DNS Settings</h1>
        <p className="text-muted-foreground">
          Configure and manage custom DNS settings for your network devices,
          enhancing security and performance.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <CustomDNSCard />
      </div>
    </div>
  );
};

export default CustomDNSComponent;
