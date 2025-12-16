"use client";

import { useState, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const description = "Signal history chart for RSRP, RSRQ, and SINR";

// Generate 5 data points (1 per minute for 5 minutes)
const generateSignalData = () => {
  const data = [];
  const now = new Date();

  for (let i = 9; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 1000);
    const timeStr = time.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    // RSRP: typically -140 to -44 dBm (closer to -44 is better)
    // 4G tends to be slightly weaker than 5G in this simulation
    const rsrp4G =
      -95 + Math.floor(Math.random() * 30) - 15 + Math.sin(i / 10) * 5;
    const rsrp5G =
      -85 + Math.floor(Math.random() * 25) - 12 + Math.sin(i / 10) * 5;

    // RSRQ: typically -20 to -3 dB (closer to -3 is better)
    const rsrq4G =
      -12 + Math.floor(Math.random() * 6) - 3 + Math.sin(i / 8) * 2;
    const rsrq5G =
      -10 + Math.floor(Math.random() * 5) - 2 + Math.sin(i / 8) * 2;

    // SINR: typically -20 to 30 dB (higher is better)
    const sinr4G =
      8 + Math.floor(Math.random() * 12) - 6 + Math.sin(i / 12) * 3;
    const sinr5G =
      12 + Math.floor(Math.random() * 14) - 7 + Math.sin(i / 12) * 3;

    data.push({
      time: timeStr,
      rsrp4G: Math.round(rsrp4G),
      rsrp5G: Math.round(rsrp5G),
      rsrq4G: parseFloat(rsrq4G.toFixed(1)),
      rsrq5G: parseFloat(rsrq5G.toFixed(1)),
      sinr4G: parseFloat(sinr4G.toFixed(1)),
      sinr5G: parseFloat(sinr5G.toFixed(1)),
    });
  }
  return data;
};

const chartConfig = {
  rsrp4G: {
    label: "LTE",
    color: "var(--chart-1)",
  },
  rsrp5G: {
    label: "5G",
    color: "var(--chart-3)",
  },
  rsrq4G: {
    label: "LTE",
    color: "var(--chart-1)",
  },
  rsrq5G: {
    label: "5G",
    color: "var(--chart-3)",
  },
  sinr4G: {
    label: "LTE",
    color: "var(--chart-1)",
  },
  sinr5G: {
    label: "5G",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

export function SignalHistoryComponent() {
  const [signalType, setSignalType] = useState("rsrp");

  // Generate data only on client side to avoid hydration mismatch
  const chartData = useMemo(() => generateSignalData(), []);

  const getDataKeys = () => {
    switch (signalType) {
      case "rsrp":
        return { key4G: "rsrp4G", key5G: "rsrp5G", unit: "dBm", label: "RSRP" };
      case "rsrq":
        return { key4G: "rsrq4G", key5G: "rsrq5G", unit: "dB", label: "RSRQ" };
      case "sinr":
        return { key4G: "sinr4G", key5G: "sinr5G", unit: "dB", label: "SINR" };
      default:
        return { key4G: "rsrp4G", key5G: "rsrp5G", unit: "dBm", label: "RSRP" };
    }
  };

  const { key4G, key5G } = getDataKeys();

  // Calculate the min value for the current signal type to use as baseline
  const getBaseValue = () => {
    const values = chartData.flatMap((d) => [
      d[key4G as keyof typeof d] as number,
      d[key5G as keyof typeof d] as number,
    ]);
    return Math.min(...values);
  };

  const baseValue = getBaseValue();

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          Signal History
        </CardTitle>
        <CardAction>
          <ToggleGroup
            type="single"
            value={signalType}
            onValueChange={(value) => value && setSignalType(value)}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[540px]/card:flex"
          >
            <ToggleGroupItem value="rsrp">RSRP</ToggleGroupItem>
            <ToggleGroupItem value="rsrq">RSRQ</ToggleGroupItem>
            <ToggleGroupItem value="sinr">SINR</ToggleGroupItem>
          </ToggleGroup>
          <Select value={signalType} onValueChange={setSignalType}>
            <SelectTrigger
              className="flex w-32 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[540px]/card:hidden"
              size="sm"
              aria-label="Select signal type"
            >
              <SelectValue placeholder="RSRP" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="rsrp" className="rounded-lg">
                RSRP
              </SelectItem>
              <SelectItem value="rsrq" className="rounded-lg">
                RSRQ
              </SelectItem>
              <SelectItem value="sinr" className="rounded-lg">
                SINR
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full"
        >
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="fill4G" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={`var(--color-${key4G})`}
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor={`var(--color-${key4G})`}
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fill5G" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={`var(--color-${key5G})`}
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor={`var(--color-${key5G})`}
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => `${value}`}
              domain={["dataMin - 5", "dataMax + 5"]}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => `${value}`}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey={key4G}
              type="monotone"
              fill="url(#fill4G)"
              stroke={`var(--color-${key4G})`}
              baseValue={baseValue}
            />
            <Area
              dataKey={key5G}
              type="monotone"
              fill="url(#fill5G)"
              stroke={`var(--color-${key5G})`}
              baseValue={baseValue}
            />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
      <CardFooter>
        <div className="flex w-full items-start gap-2 text-sm">
          <div className="grid gap-2">
            <div className="flex items-center gap-2 leading-none font-medium">
              This chart shows the {signalType.toUpperCase()} signal strength
              over the past 10 minutes.
            </div>
            <div className="text-muted-foreground flex items-center gap-2 leading-none">
              Values may fluctuate due to environmental factors and network
              conditions.
            </div>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}
