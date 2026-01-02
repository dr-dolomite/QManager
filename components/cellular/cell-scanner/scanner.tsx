import React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ScannerEmptyView from "./empty-view";
import ScanResultView, { type CellScanResult } from "./scan-result";
import { Button } from "@/components/ui/button";
import { DownloadIcon } from "lucide-react";

// Mock data for testing
const mockScanResults: CellScanResult[] = [
  {
    id: "1",
    networkType: "LTE",
    earfcn: 1300,
    pci: 123,
    band: 3,
    bandwidth: 20,
    cellID: 12345678,
    tac: 1234,
    signalStrength: -65,
    mcc: 515,
    mnc: 3,
    provider: "Globe",
  },
  {
    id: "2",
    networkType: "LTE",
    earfcn: 6300,
    pci: 456,
    band: 20,
    bandwidth: 10,
    cellID: 87654321,
    tac: 5678,
    signalStrength: -78,
    mcc: 515,
    mnc: 3,
    provider: "Globe",
  },
  {
    id: "3",
    networkType: "NR5G-SA",
    earfcn: 627264,
    pci: 789,
    band: 78,
    bandwidth: 100,
    cellID: 11223344,
    tac: 9012,
    signalStrength: -85,
    mcc: 515,
    mnc: 3,
    provider: "Globe",
  },
  {
    id: "4",
    networkType: "LTE",
    earfcn: 3050,
    pci: 321,
    band: 7,
    bandwidth: 15,
    cellID: 55667788,
    tac: 3456,
    signalStrength: -92,
    mcc: 515,
    mnc: 5,
    provider: "Smart",
  },
  {
    id: "5",
    networkType: "NR5G-SA",
    earfcn: 431810,
    pci: 654,
    band: 41,
    bandwidth: 40,
    cellID: 99887766,
    tac: 7890,
    signalStrength: -105,
    mcc: 515,
    mnc: 5,
    provider: "Smart",
  },
  {
    id: "6",
    networkType: "LTE",
    earfcn: 2850,
    pci: 987,
    band: 1,
    bandwidth: 20,
    cellID: 44332211,
    tac: 2345,
    signalStrength: -72,
    mcc: 515,
    mnc: 2,
    provider: "DITO",
  },
  {
    id: "7",
    networkType: "NR5G-SA",
    earfcn: 520110,
    pci: 234,
    band: 77,
    bandwidth: 80,
    cellID: 66554433,
    tac: 6789,
    signalStrength: -88,
    mcc: 515,
    mnc: 2,
    provider: "DITO",
  },
  {
    id: "8",
    networkType: "LTE",
    earfcn: 38950,
    pci: 567,
    band: 40,
    bandwidth: 20,
    cellID: 22114433,
    tac: 4567,
    signalStrength: -98,
    mcc: 515,
    mnc: 3,
    provider: "Globe",
  },
];

const FullScannerComponent = () => {
  // Set to true to show mock data, false to show empty view
  const hasScanResults = true;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Cell Scanner</CardTitle>
        <CardDescription>
          Scan and display available cellular networks and towers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {hasScanResults ? (
            <ScanResultView data={mockScanResults} />
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

export default FullScannerComponent;
