import React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "../ui/separator";
import { Badge } from "../ui/badge";
import {
  TbAlertTriangleFilled,
  TbCircleArrowDownFilled,
  TbCircleArrowUpFilled,
  TbInfoCircleFilled,
} from "react-icons/tb";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";

const DeviceMetricsComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader className="-mb-4">
        <CardTitle className="text-lg font-semibold tabular-nums">
          Device Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Modem Temperature
            </p>
            <div className="flex items-center gap-1.5">
              {/* <Badge className="bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 border border-orange-300/50 backdrop-blur-sm">
                <TbAlertTriangleFilled className="text-orange-500" />
                High Temperature
              </Badge> */}
              <p className="font-semibold text-sm">45&deg;C</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              CPU Usage
            </p>
            <div className="flex items-center gap-1.5">
              <Badge className="bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 border border-orange-300/50 backdrop-blur-sm">
                <TbAlertTriangleFilled className="text-orange-500" />
                High CPU Usage
              </Badge>
              <p className="font-semibold text-sm">95%</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Memory Usage
            </p>
            <p className="font-semibold text-sm">3.2 GB / 8 GB</p>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Live Traffic
            </p>
            <div className="flex items-center gap-x-2">
              <div className="flex items-center gap-1">
                <TbCircleArrowDownFilled className="text-blue-500 w-5 h-5" />
                <p className="font-semibold text-sm">12.5 Mbps</p>
              </div>
              <div className="flex items-center gap-1">
                <TbCircleArrowUpFilled className="text-purple-500 w-5 h-5" />
                <p className="font-semibold text-sm">3.8 Mbps</p>
              </div>
            </div>
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Data Usage
            </p>
            <div className="flex items-center gap-x-2">
              <div className="flex items-center gap-1">
                <TbCircleArrowDownFilled className="text-blue-500 w-5 h-5" />
                <p className="font-semibold text-sm">12.5 GB</p>
              </div>
              <div className="flex items-center gap-1">
                <TbCircleArrowUpFilled className="text-purple-500 w-5 h-5" />
                <p className="font-semibold text-sm">3.8 GB</p>
              </div>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              LTE Cell Distance
            </p>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    This is based on LTE TA value (4) which equates to
                    approximately 1.2 km distance from the cell tower.
                  </p>
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-sm">1.2 km</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              NR5G Cell Distance
            </p>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    This is based on NR TA value (4) which equates to
                    approximately 1.2 km distance from the cell tower.
                  </p>
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-sm">1.2 km</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Connection Uptime
            </p>
            <p className="font-semibold text-sm">5h 23m 32s</p>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Device Uptime
            </p>
            <p className="font-semibold text-sm">12h 45m 10s</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DeviceMetricsComponent;
