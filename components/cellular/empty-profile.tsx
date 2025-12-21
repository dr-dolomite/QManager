import React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { CardSimIcon, RefreshCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

const EmptyProfileViewComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>View Custom Profiles</CardTitle>
        <CardDescription>
          Manage your custom cellular profiles here.
        </CardDescription>
      </CardHeader>
      <CardContent className="h-full flex items-center justify-center">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CardSimIcon />
            </EmptyMedia>
            <EmptyTitle>No Custom Profiles</EmptyTitle>
            <EmptyDescription>
              You have not created any custom SIM profiles yet. Click the button
              below to refresh or create a new profile.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm">
              <RefreshCcwIcon />
              Refresh
            </Button>
          </EmptyContent>
        </Empty>
      </CardContent>
    </Card>
  );
};

export default EmptyProfileViewComponent;
