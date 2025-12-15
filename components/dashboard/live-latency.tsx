"use client";
import React from "react";

import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "../ui/button";
import { TbPlayerPlayFilled } from "react-icons/tb";
import { Separator } from "../ui/separator";

export const description = "A multiple bar chart";

const chartData = [
  { time: "7:01", latency: 50, packetloss: 1 },
  { time: "7:02", latency: 70, packetloss: 3 },
  { time: "7:03", latency: 60, packetloss: 9 },
  { time: "7:04", latency: 80, packetloss: 20 },
  { time: "7:05", latency: 55, packetloss: 10 },
];

const chartConfig = {
  latency: {
    label: "Latency",
    color: "var(--chart-1)",
  },
  packetloss: {
    label: "Packetloss",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

const LiveLatencyComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader className="-mb-4">
        <CardTitle className="text-lg font-semibold tabular-nums">
          Live Latency and Speed Test
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <LineChart
            accessibilityLayer
            data={chartData}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <>
                      <div
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
                        style={
                          {
                            "--color-bg": `var(--color-${name})`,
                          } as React.CSSProperties
                        }
                      />
                      {chartConfig[name as keyof typeof chartConfig]?.label ||
                        name}
                      <div className="ml-auto flex items-baseline gap-0.5 font-mono font-medium tabular-nums text-foreground">
                        {value}
                        <span className="font-normal text-muted-foreground">
                          {name === "latency" ? "ms" : "%"}
                        </span>
                      </div>
                    </>
                  )}
                />
              }
            />
            <Line
              dataKey="latency"
              type="monotone"
              stroke="var(--color-latency)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              dataKey="packetloss"
              type="monotone"
              stroke="var(--color-packetloss)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
      <CardFooter>
        <div className="flex w-full items-start gap-2 text-sm">
          <div className="grid gap-2">
            <div className="flex items-center gap-2 leading-none font-medium">
              Speed Test
            </div>
            <div className="text-muted-foreground flex items-center gap-2 leading-none">
              <Button variant="default" size="icon-sm" className="p-0.5 rounded-full">
                <TbPlayerPlayFilled className="w-4 h-4" />
              </Button>
              Start a speed test to measure your current network speed.
            </div>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
};

export default LiveLatencyComponent;
