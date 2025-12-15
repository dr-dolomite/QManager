import React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TbCircleCheckFilled, TbCircleXFilled } from "react-icons/tb";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";

const RecentActivitiesComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader className="-mb-4">
        <CardTitle className="text-lg font-semibold tabular-nums">
          Recent Activities
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <Separator />
          <div className="flex items-center gap-2">
            <TbCircleCheckFilled className="w-6 h-6 text-green-500" />
            <div className="flex flex-1 flex-col gap-y-0.5">
              <Label className="text-muted-foreground">
                Event Name - 10 minutes ago
              </Label>
              <p className="text-sm font-medium leading-none">
                New bands added: B3; Additional carriers aggregated - Carriers
                increased from 2 to 3
              </p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center gap-2">
            <TbCircleCheckFilled className="w-6 h-6 text-green-500" />
            <div className="flex flex-1 flex-col gap-y-0.5">
              <Label className="text-muted-foreground">
                Event Name - 10 minutes ago
              </Label>
              <p className="text-sm font-medium leading-none">
                Bands removed: B3; Carriers reduced from 3 to 2
              </p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center gap-2">
            <TbCircleCheckFilled className="w-6 h-6 text-green-500" />
            <div className="flex flex-1 flex-col gap-y-0.5">
              <Label className="text-muted-foreground">
                Event Name - 10 minutes ago
              </Label>
              <p className="text-sm font-medium leading-none">
                Bands removed: B3; Carriers reduced from 3 to 2
              </p>
            </div>
          </div>
          <Separator />
          {/* example lost connectivity */}
          <div className="flex items-center gap-2">
            <TbCircleXFilled className="w-6 h-6 text-orange-500" />
            <div className="flex flex-1 flex-col gap-y-0.5">
              <Label className="text-muted-foreground">
                Event Name - 10 minutes ago
              </Label>
              <p className="text-sm font-medium leading-none">
                Connectivity lost to the network. Attempting to reconnect...
              </p>
            </div>
          </div>

          <Separator />
          {/* example lost connectivity */}
          <div className="flex items-center gap-2">
            <TbCircleXFilled className="w-6 h-6 text-orange-500" />
            <div className="flex flex-1 flex-col gap-y-0.5">
              <Label className="text-muted-foreground">
                Event Name - 10 minutes ago
              </Label>
              <p className="text-sm font-medium leading-none">
                Connectivity lost to the network. Attempting to reconnect...
              </p>
            </div>
          </div>

        </div>
      </CardContent>
    </Card>
  );
};

export default RecentActivitiesComponent;
