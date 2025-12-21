import React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const CellDataComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle className="text-lg">Cellular Information</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground ">ISP</p>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold ">Verizon Wireless</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground ">Network Type</p>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold ">5G NR + LTE</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground ">Cell ID</p>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold ">36393062</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground ">
              Tracking Area Code
            </p>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold ">40495</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground ">
              Total Bandwidth in Use
            </p>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold ">200 MHz</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground ">
              Carrier Aggregation
            </p>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold ">Multi</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground ">Active MIMO</p>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold ">4x4 LTE | 4x4 NR</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground ">WAN IPv4</p>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold ">100.64.0.1</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground ">WAN IPv6</p>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold ">2607:f8b0:4005:805::200e</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground ">Primary DNS</p>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold ">121.54.70.163</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground ">
              Secondary DNS
            </p>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold ">121.54.70.164</p>
            </div>
          </div>
          <Separator />
        </div>
      </CardContent>
    </Card>
  );
};

export default CellDataComponent;
