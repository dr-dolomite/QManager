import React from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CardSimIcon,
  CloudCheckIcon,
  DiscIcon,
  MonitorSmartphoneIcon,
} from "lucide-react";
import { MdOutline5G } from "react-icons/md";
import { FaCheck } from "react-icons/fa";

const NetworkStatusComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex md:flex-row flex-col xl:items-center justify-center xl:justify-between gap-2">
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            Network Status
          </CardTitle>
          <div className="flex items-center gap-x-1.5">
            <Badge
              variant="outline"
              className="border-green-500 bg-green-500/10 text-green-500"
            >
              <DiscIcon />
              Radio On
            </Badge>
            <Badge
              variant="outline"
              className="border-green-500 bg-green-500/10 text-green-500"
            >
              <CloudCheckIcon />
              Internet
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid xl:grid-cols-3 grid-cols-1 grid-flow-row gap-4 place-items-center place-content-center">
          <div className="grid gap-2">
            {/* 5G circle with checkmark badge */}
            <div className="relative">
              <div className="rounded-full size-36 bg-primary flex items-center justify-center p-2">
                <MdOutline5G className="size-full text-white" />
              </div>
              {/* Checkmark badge */}
              <div className="absolute top-1 right-4 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-md">
                <FaCheck className="w-4 h-4 text-white" />
              </div>
            </div>
            <div className="grid gap-0.5 text-center">
              <h3 className="text-md font-semibold leading-none">5G Signal</h3>
              <p className="text-muted-foreground text-sm ">Non-Standalone</p>
            </div>
          </div>

          <div className="grid gap-2">
            {/* Connected devices circle */}
            <div className="relative">
              <div className="rounded-full size-36 bg-primary/15 flex items-center justify-center p-4">
                <CardSimIcon className="size-full text-primary" />
              </div>
              {/* Checkmark badge */}
              <div className="absolute top-1 right-4 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-md">
                <FaCheck className="w-4 h-4 text-white" />
              </div>
            </div>
            <div className="grid gap-0.5 text-center">
              <h3 className="text-md font-semibold leading-none">SIM</h3>
              <p className="text-muted-foreground text-sm">TMobile</p>
            </div>
          </div>

          <div className="grid gap-2">
            {/* Service status - pulsating circle */}
            <div className="relative flex items-center justify-center size-36">
              {/* Outer rings - pulsating */}
              <div className="absolute rounded-full size-36 bg-green-200 animate-pulse-ring" />
              <div
                className="absolute rounded-full size-28 bg-green-300 animate-pulse-ring"
                style={{ animationDelay: "0.3s" }}
              />
              <div
                className="absolute rounded-full size-20 bg-green-400 animate-pulse-ring"
                style={{ animationDelay: "0.6s" }}
              />
              {/* Center circle */}
              <div className="relative rounded-full size-12 bg-green-600" />
            </div>
            <div className="grid gap-0.5 text-center">
              <h3 className="text-md font-semibold leading-none">Service</h3>
              <p className="text-muted-foreground text-sm">Optimal</p>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex-col items-start gap-1.5 text-sm"></CardFooter>
    </Card>
  );
};

export default NetworkStatusComponent;
