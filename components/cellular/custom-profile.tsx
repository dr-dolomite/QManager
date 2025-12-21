import React from "react";


import CustomProfileFormComponent from "./custom-profile-form";
import EmptyProfileViewComponent from "./empty-profile";

const CustomProfileComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Custom SIM Profile</h1>
        <p className="text-muted-foreground">
          Create and manage custom SIM profiles for your cellular device. Enter
          the necessary details below to set up a new profile.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <CustomProfileFormComponent/>
        <EmptyProfileViewComponent/>
      </div>
    </div>
  );
};

export default CustomProfileComponent;
