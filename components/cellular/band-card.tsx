import React from "react";

import { Card, CardTitle, CardHeader, CardContent } from "@/components/ui/card";

const BandCardComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle className="text-md font-semibold tabular-nums @[250px]/card:text-lg">
          4G LTE - B41
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-muted-foreground xl:text-md text-sm">Band</p>
          <p className="font-semibold xl:text-md text-sm">B41</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-muted-foreground xl:text-md text-sm">EARFCN</p>
          <p className="font-semibold xl:text-md text-sm">1995</p>
        </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BandCardComponent;
