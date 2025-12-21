import React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const DeviceStatus = () => {
  return (
    <Card className="@container/card col-span-2">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl text-center">
          Device Information
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <div className="flex items-center justify-center mb-8">
            <div className="size-44 bg-primary/15 rounded-full p-4 flex items-center justify-center">
              <img
                src="/device-icon.svg"
                alt="Device Icon"
                className="size-full rounded-full drop-shadow-md"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Manufacturer
              </p>
              <p className="font-semibold xl:text-md text-sm">Quectel</p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Model
              </p>
              <p className="font-semibold xl:text-md text-sm">RM551E-GL</p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Firmware Version
              </p>
              <p className="font-semibold xl:text-md text-sm">
                RM551EGL00AAR01A04M8G
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Build Date
              </p>
              <p className="font-semibold xl:text-md text-sm">Jun 25 2025</p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                QManager Version
              </p>
              <p className="font-semibold xl:text-md text-sm">1.0.0-beta.5</p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Phone Number
              </p>
              <p className="font-semibold xl:text-md text-sm tabular-nums">
                +1 (555) 123-4567
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                IMSI
              </p>
              <p className="font-semibold xl:text-md text-sm tabular-nums">
                310260123456789
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                ICCID
              </p>
              <p className="font-semibold xl:text-md text-sm tabular-nums">
                8901260420001234567
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Device IMEI
              </p>
              <p className="font-semibold xl:text-md text-sm tabular-nums">
                866792052000123
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                LTE Category
              </p>
              <p className="font-semibold xl:text-md text-sm tabular-nums">
                Cat 20
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Active MIMO
              </p>
              <p className="font-semibold xl:text-md text-sm tabular-nums">
                LTE 4x4 | NR 4x4
              </p>
            </div>
            <Separator />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DeviceStatus;
