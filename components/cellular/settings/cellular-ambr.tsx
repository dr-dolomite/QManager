import React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleArrowDownIcon,
  CircleArrowUpIcon,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

const CellularAMBRCard = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Active AMBR View</CardTitle>
        <CardDescription>
          Aggregate Maximum Bit Rate (AMBR) is a parameter used in cellular
          networks to define the maximum data transfer rate that a user
          equipment (UE) can achieve.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-y-6">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <h2 className="font-semibold text-sm">LTE AMBR</h2>
              <Separator />
              <div className="flex items-center justify-between">
                <p className="font-semibold text-muted-foreground text-sm">
                  SMARTBRO
                </p>
                <div className="flex items-center gap-x-4">
                  <div className="flex items-center gap-x-1">
                    <CircleArrowDownIcon className="h-4 w-4 text-blue-500" />
                    <p className="font-semibold text-sm">2.01 Gbps</p>
                  </div>
                  <div className="flex items-center gap-x-1">
                    <CircleArrowUpIcon className="h-4 w-4 text-blue-500" />
                    <p className="font-semibold text-sm">2.01 Gbps</p>
                  </div>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <p className="font-semibold text-muted-foreground text-sm">
                  ims
                </p>
                <div className="flex items-center gap-x-4">
                  <div className="flex items-center gap-x-1">
                    <CircleArrowDownIcon className="h-4 w-4 text-blue-500" />
                    <p className="font-semibold text-sm">500 Mbps</p>
                  </div>
                  <div className="flex items-center gap-x-1">
                    <CircleArrowUpIcon className="h-4 w-4 text-blue-500" />
                    <p className="font-semibold text-sm">100 Mbps</p>
                  </div>
                </div>
              </div>
              <Separator />
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <CardDescription>
          While devices can request specific AMBR values, operators may ignore
          these and enforce their own speed limits based on subscription plans,
          network policies, or congestion conditions.
        </CardDescription>
      </CardFooter>
    </Card>
  );
};

export default CellularAMBRCard;
