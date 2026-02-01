import React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { TbInfoCircleFilled } from "react-icons/tb";
import { Button } from "../ui/button";

const CellDataComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Cellular Information</CardTitle>
        <CardDescription>
          Detailed information about the connected cellular network.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">ISP</p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">Verizon Wireless</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Access Point Name (APN)
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">vzwinternet</p>
              <Button variant="link" size="sm" className="p-0.5 cursor-pointer">
                Edit
              </Button>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Network Type
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">5G NR + LTE</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Cell ID
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">36393062</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Tracking Area Code
            </p>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {/* Will show in Hexadecimal form */}
                    <p>0x80F3P</p>
                  </TooltipContent>
                </Tooltip>
                {/* Will show in integer form */}
                <p className="text-sm font-semibold">32895</p>
              </div>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Total Bandwidth in Use
            </p>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {/* Will show each bandwidth value*/}
                    <p>100 + 100</p>
                  </TooltipContent>
                </Tooltip>
                {/* Will show in total bandwidth */}
                <p className="text-sm font-semibold">200 MHz</p>
              </div>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Carrier Aggregation
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">Multi</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Active MIMO
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">4x4 LTE | 4x4 NR</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              WAN IPv4
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">100.64.0.1</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              WAN IPv6
            </p>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {/* Will show full IPv6 address */}
                    <p>2607:f8b0:4005:805::200e</p>
                  </TooltipContent>
                </Tooltip>
                {/* Will show shortened / truncated IPv6 address */}
                <p className="text-sm font-semibold">2607:f8b0:4...::200e</p>
              </div>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Primary DNS
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">121.54.70.163</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Secondary DNS
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">121.54.70.164</p>
            </div>
          </div>
          <Separator />
        </div>
      </CardContent>
    </Card>
  );
};

export default CellDataComponent;
