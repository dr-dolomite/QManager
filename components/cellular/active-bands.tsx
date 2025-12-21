import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const ActiveBandsComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle className="text-lg">Active Cellular Bands</CardTitle>
      </CardHeader>
      <CardContent>
        <Accordion
          type="single"
          collapsible
          className="w-full"
          defaultValue="item-1"
        >
          <AccordionItem value="item-1">
            <AccordionTrigger className="font-bold text-base">
              <div className="flex items-center gap-2">
                {/* {formatBandName(band.bandNumber)} */}
                <Badge className={`text-xs rounded-full bg-blue-500`}>NR</Badge>
                <p className="font-bold">NR5G BAND 41 (2500 MHz - 2690 MHz)</p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="grid gap-1 text-balance text-base">
              {/* RSRP */}
              <div className="flex items-center justify-between">
                <p className="font-semibold text-muted-foreground">RSRP</p>
                <div className="flex items-center">
                  <Progress className="w-24 mr-2" value={75} />
                  <p className="ml-2 font-bold w-20 text-right">-95 dBm</p>
                </div>
              </div>

              {/* RSRQ */}
              <div className="flex items-center justify-between">
                <p className="font-semibold text-muted-foreground">RSRQ</p>
                <div className="flex items-center">
                  <Progress className="w-24 mr-2" value={75} />
                  <p className="ml-2 font-bold w-20 text-right">-10 dB</p>
                </div>
              </div>

              {/* SINR / NR-SNR */}
              <div className="flex items-center justify-between">
                <p className="font-semibold text-muted-foreground">SINR</p>
                <div className="flex items-center">
                  <Progress className="w-24 mr-2" value={75} />
                  <p className="ml-2 font-bold w-20 text-right">-5 dB</p>
                </div>
              </div>

              {/* Bandwidth */}
              <div className="flex items-center justify-between">
                <p className="font-semibold text-muted-foreground">Bandwidth</p>
                <p className="font-bold">100 MHz</p>
              </div>

              {/* EARFCN */}
              <div className="flex items-center justify-between">
                <p className="font-semibold text-muted-foreground">EARFCN</p>
                <p className="font-bold">12345</p>
              </div>

              {/* PCI */}
              <div className="flex items-center justify-between">
                <p className="font-semibold text-muted-foreground">PCI</p>
                <p className="font-bold">123</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
};

export default ActiveBandsComponent;
