import React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TbInfoCircleFilled } from "react-icons/tb";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const TowerLockingSettingsComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Tower Locking Settings</CardTitle>
        <CardDescription>
          Configure cellular tower locking for the Primary Cell (PCell). Not
          compatible with NR5G-NSA.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    When enabled, the device will persist tower locking settings
                    across reboots.
                  </p>
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-muted-foreground text-sm">
                Persist Locking
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="band-failover" checked />
              <Label htmlFor="band-failover">Enabled</Label>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    When enabled, the device will unlock from the tower if
                    signal quality degrades below a certain threshold or becomes
                    unavailable.
                  </p>
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-muted-foreground text-sm">
                Failover
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="band-failover" checked />
              <Label htmlFor="band-failover">Enabled</Label>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    This will only take effect if Failover is enabled. Set the
                    signal quality threshold below which the device will unlock
                    from the tower.
                  </p>
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-muted-foreground text-sm">
                Failover Threshold
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Input
                type="text"
                placeholder="20%"
                className="w-16 h-8 text-center"
              />
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Current Signal Quality
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">
                <Badge
                  variant="outline"
                  className="bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 border border-orange-300/50 backdrop-blur-sm"
                >
                  18%
                </Badge>
              </p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Failover Status
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">
                <Badge
                  variant="outline"
                  className="bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 border border-orange-300/50 backdrop-blur-sm"
                >
                  Unlocked due to Poor Signal
                </Badge>
              </p>
            </div>
          </div>
          <Separator />

          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Active PCell E/AFRCN
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">28589</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Active PCell ID (PCI)
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">123</p>
            </div>
          </div>
          <Separator />
        </div>
      </CardContent>
    </Card>
  );
};

export default TowerLockingSettingsComponent;
