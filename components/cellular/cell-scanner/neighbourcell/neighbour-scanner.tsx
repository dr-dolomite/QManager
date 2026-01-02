import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";
import { DownloadIcon } from "lucide-react";
import ScannerEmptyView from "@/components/cellular/cell-scanner/empty-view";
import NeighbourScanResultView, {
  type NeighbourCellResult,
} from "./neighbour-scan-result";

// Mock data for testing
const mockNeighbourResults: NeighbourCellResult[] = [
  {
    id: "1",
    networkType: "LTE",
    cellType: "intra",
    frequency: 150,
    pci: 295,
    signalStrength: -65,
  },
  {
    id: "2",
    networkType: "LTE",
    cellType: "intra",
    frequency: 150,
    pci: 296,
    signalStrength: -78,
  },
  {
    id: "3",
    networkType: "LTE",
    cellType: "inter",
    frequency: 1300,
    pci: 125,
    signalStrength: -85,
  },
  {
    id: "4",
    networkType: "NR5G-NSA",
    cellType: "nr5g",
    frequency: 528030,
    pci: 262,
    signalStrength: -72,
  },
  {
    id: "5",
    networkType: "NR5G-NSA",
    cellType: "nr5g",
    frequency: 528030,
    pci: 263,
    signalStrength: -88,
  },
  {
    id: "6",
    networkType: "NR5G-NSA",
    cellType: "nr5g",
    frequency: 627264,
    pci: 791,
    signalStrength: -95,
  },
  {
    id: "7",
    networkType: "LTE",
    cellType: "inter",
    frequency: 3050,
    pci: 321,
    signalStrength: -102,
  },
  {
    id: "8",
    networkType: "NR5G-NSA",
    cellType: "nr5g",
    frequency: 431810,
    pci: 654,
    signalStrength: -108,
  },
];

const NeighbourCellScanner = () => {
  // Set to true to show mock data, false to show empty view
  const hasScanResults = true;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Neighbor Cell Scanner</CardTitle>
        <CardDescription>
          Scan and display neighboring cellular towers and networks.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {hasScanResults ? (
            <NeighbourScanResultView data={mockNeighbourResults} />
          ) : (
            <ScannerEmptyView />
          )}
        </div>
        {hasScanResults && (
          <div className="mt-4 flex items-center gap-x-2">
            <Button>Start New Scan</Button>
            <Button>
              <DownloadIcon />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default NeighbourCellScanner;
