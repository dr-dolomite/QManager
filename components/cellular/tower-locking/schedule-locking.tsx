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
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle"
import { CircleIcon } from "lucide-react";

const ScheduleTowerLockingComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Schedule Tower Locking</CardTitle>
        <CardDescription>
          Set specific times to enable or disable tower locking.
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
                    Schedule tower locking to automatically enable or disable at
                    specified times.
                  </p>
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-muted-foreground text-sm">
                Enable Scheduled Locking
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="schedule-locking" />
              <Label htmlFor="schedule-locking">Enabled</Label>
            </div>
          </div>
          <Separator />
          <div className="flex flex-col gap-4 mt-4">
            <div className="flex items-center justify-between">
              <Label className="font-semibold text-muted-foreground text-sm">
                Start Time
              </Label>
              <Input type="time" className="w-32 h-8" />
            </div>
            <div className="flex items-center justify-between">
              <Label className="font-semibold text-muted-foreground text-sm">
                End Time
              </Label>
              <Input type="time" className="w-32 h-8" />
            </div>
          </div>
          <Separator />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
            {/* Toggle between days of the week */}
            <Label className="font-semibold text-muted-foreground text-sm">
              Repeat On
            </Label>
            <div className="flex flex-wrap gap-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <Toggle 
                aria-label={`toggle-repeat-${day.toLowerCase()}`}
                key={day} 
                size="sm" 
                className="data-[state=on]:bg-transparent data-[state=on]:*:[svg]:fill-blue-500 data-[state=on]:*:[svg]:stroke-blue-500"
                variant="outline">
                  <CircleIcon/>
                  {day}
                </Toggle>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ScheduleTowerLockingComponent;
