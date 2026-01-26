import React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import { CircleCheckIcon, RefreshCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const FPLMNCard = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>FPLMN Status</CardTitle>
        <CardDescription>
          The FPLMN list stores networks that your device has been unable to
          connect to. Clearing this list may improve network connectivity and
          roaming performance.
          <a
            href="https://onomondo.com/blog/how-to-clear-the-fplmn-list-on-a-sim/"
            target="_blank"
            rel="noreferrer"
            className="underline ml-1 text-primary hover:text-primary/80"
          >
            Learn more
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Empty className="bg-muted/30 h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-primary rounded-xl">
              <CircleCheckIcon className="text-primary-foreground w-6 h-6" />
            </EmptyMedia>
            <EmptyTitle>FPLMN List is Clean</EmptyTitle>
            <EmptyDescription className="max-w-xs text-pretty">
              The forbidden network list is empty and does not need clearing.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button>
              <RefreshCcwIcon />
              Refresh Status
            </Button>
            {/* 
                <Button variant="destructive">
          Clear FPLMN List
        </Button>
        */}
          </EmptyContent>
        </Empty>
      </CardContent>
    </Card>
  );
};

export default FPLMNCard;
