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
import { TriangleAlertIcon } from "lucide-react";

const BandSettingsComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Band Locking Settings</CardTitle>
        <CardDescription>
          Configure your cellular band locking preferences below.
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
                    When enabled, the device will automatically switch to the
                    default bands if the locked bands are unavailable.
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
            <p className="text-sm font-semibold text-muted-foreground ">
              Failover Status
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">
                <Badge
                  variant="outline"
                  className="bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 border border-orange-300/50 backdrop-blur-sm"
                >
                  <TriangleAlertIcon/>
                  Using Default Bands
                </Badge>
              </p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Active LTE Bands
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">B1, B3, B7, B20</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Active NR5G NSA Bands
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">N41, N78</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Active NR5G SA Bands
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">N78</p>
            </div>
          </div>
          <Separator />
        </div>
      </CardContent>
    </Card>
  );
};

export default BandSettingsComponent;
