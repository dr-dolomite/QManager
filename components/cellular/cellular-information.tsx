"use client";

import { Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Signal quality thresholds
const getSignalQuality = (
  type: "rsrp" | "rsrq" | "sinr",
  value: number
): { label: string; textColor: string; bgColor: string } => {
  if (type === "rsrp") {
    if (value >= -90) return { label: "Excellent", textColor: "text-green-600", bgColor: "bg-green-600/10" };
    if (value >= -100) return { label: "Fair", textColor: "text-amber-600", bgColor: "bg-amber-600/10" };
    return { label: "Poor", textColor: "text-orange-600", bgColor: "bg-orange-600/10" };
  }
  if (type === "rsrq") {
    if (value >= -10) return { label: "Excellent", textColor: "text-green-600", bgColor: "bg-green-600/10" };
    if (value >= -15) return { label: "Fair", textColor: "text-amber-600", bgColor: "bg-amber-600/10" };
    return { label: "Poor", textColor: "text-orange-600", bgColor: "bg-orange-600/10" };
  }
  // SINR
  if (value >= 13) return { label: "Excellent", textColor: "text-green-600", bgColor: "bg-green-600/10" };
  if (value >= 0) return { label: "Fair", textColor: "text-amber-600", bgColor: "bg-amber-600/10" };
  return { label: "Poor", textColor: "text-orange-600", bgColor: "bg-orange-600/10" };
};

// Info row component
const InfoRow = ({
  label,
  value,
  unit,
  quality,
  tooltip,
}: {
  label: string;
  value: string | number;
  unit?: string;
  quality?: { label: string; textColor: string; bgColor: string };
  tooltip?: string;
}) => (
  <div className={`flex items-center justify-between py-2 ${quality ? `${quality.bgColor} rounded-md px-2` : "px-2"}`}>
    <p className={`font-semibold ${quality ? quality.textColor : "text-muted-foreground"}`}>
      {label}
    </p>
    <div className="flex items-center gap-2">
      <p className={`font-semibold ${quality ? quality.textColor : ""}`}>
        {value}
        {unit && ` ${unit}`}
      </p>
      {quality && <p className={quality.textColor}>{quality.label}</p>}
      {tooltip && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Info className={`h-4 w-4 ${quality ? quality.textColor : "text-muted-foreground"}`} />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-sm">{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  </div>
);

// Band card data type
interface BandData {
  id: string;
  title: string;
  cqi?: number;
  rsrp: number;
  rsrq: number;
  sinr: number;
  pci: number;
  band: string;
  bandwidth: string;
  earfcn?: number;
  arfcn?: number;
}

// Expandable band card component
const BandCard = ({ data }: { data: BandData }) => {

  const sinrQuality = getSignalQuality("sinr", data.sinr);

  return (
      <Card className="overflow-hidden @container/card ">
        <CardHeader>
          <CardTitle>
            {data.title} - {data.band}
          </CardTitle>
        </CardHeader>
          <CardContent className="pt-0">
            {data.cqi !== undefined && <InfoRow label="CQI" value={data.cqi} />}
            <InfoRow label="RSRP" value={data.rsrp} unit="dBm" />
            <InfoRow label="RSRQ" value={data.rsrq} unit="dB" />
            <InfoRow
              label="SINR"
              value={data.sinr}
              unit="dB"
              quality={sinrQuality}
              tooltip="The Signal-to-Interference-plus-Noise Ratio (SINR) indicates the signal quality, which can be significantly affected by electromagnetic interference. Keep the device as far away as possible from household appliances that may cause electromagnetic interference, such as microwave ovens, televisions and audio systems."
            />
            <InfoRow label="PCI" value={data.pci} />
            <InfoRow label="Band" value={data.band} />
            <InfoRow label="Band Width" value={data.bandwidth} />
            {data.earfcn !== undefined && (
              <InfoRow label="EARFCN" value={data.earfcn} />
            )}
            {data.arfcn !== undefined && (
              <InfoRow label="ARFCN" value={data.arfcn} />
            )}
          </CardContent>
      </Card>
  );
};

// Mock data - replace with real data from API
const mockBandData: BandData[] = [
  {
    id: "lte",
    title: "4G LTE",
    cqi: 10,
    rsrp: -90,
    rsrq: -8,
    sinr: -5,
    pci: 45,
    band: "B20",
    bandwidth: "20 MHz",
    earfcn: 6300,
  },
    {
    id: "lte",
    title: "4G LTE",
    cqi: 10,
    rsrp: -90,
    rsrq: -8,
    sinr: -5,
    pci: 45,
    band: "B20",
    bandwidth: "20 MHz",
    earfcn: 6300,
  },
    {
    id: "lte",
    title: "4G LTE",
    cqi: 10,
    rsrp: -90,
    rsrq: -8,
    sinr: 30,
    pci: 45,
    band: "B20",
    bandwidth: "20 MHz",
    earfcn: 6300,
  },
  {
    id: "nr",
    title: "5G NR",
    rsrp: -85,
    rsrq: -10,
    sinr: 12,
    pci: 120,
    band: "n78",
    bandwidth: "100 MHz",
    arfcn: 627264,
  },
    {
    id: "nr",
    title: "5G NR",
    rsrp: -65,
    rsrq: -10,
    sinr: 25,
    pci: 120,
    band: "n71",
    bandwidth: "100 MHz",
    arfcn: 627264,
  },
];

const CellularInformationComponent = () => {
  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Radio Data</h1>
        <p className="text-muted-foreground">
          Overview of your cellular connection details.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 grid-flow-row gap-6 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        {mockBandData.map((band) => (
          <BandCard key={band.id} data={band} />
        ))}
      </div>
    </div>
  );
};

export default CellularInformationComponent;
