"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { X, Trash2 } from "lucide-react";

// Types
type LTEBand = {
  band: number;
  name: string;
  dlLow: number;
  dlHigh: number;
  ulLow: number;
  ulHigh: number;
  earfcnOffset: number;
  earfcnRange: [number, number];
  spacing: number;
  duplexType: "FDD" | "TDD";
};

type NRBand = {
  band: number;
  name: string;
  dlLow: number;
  dlHigh: number;
  ulLow: number;
  ulHigh: number;
  nrarfcnOffset: number;
  nrarfcnRange: [number, number];
  duplexType: "FDD" | "TDD";
};

type LTEMatchingBand = LTEBand & {
  dlFrequency: string;
  ulFrequency: string;
  ulEarfcn: number;
};

type LTEResult = {
  networkType: "LTE";
  earfcn: number;
  frequency: string;
  possibleBands: LTEMatchingBand[];
};

type NRResult = {
  networkType: "NR";
  earfcn: number;
  frequency: string;
  possibleBands: NRBand[];
};

type CalculationResult = LTEResult | NRResult | null;

type ErrorResult = {
  error: string;
};

type HistoryEntry = {
  networkType: "LTE" | "NR";
  earfcn: number;
  frequency: string;
  possibleBands: (LTEMatchingBand | NRBand)[];
  timestamp: string;
  id: string;
};

// LTE Band configurations
const lteBands: LTEBand[] = [
  // FDD Bands
  {
    band: 1,
    name: "2100",
    dlLow: 2110,
    dlHigh: 2170,
    ulLow: 1920,
    ulHigh: 1980,
    earfcnOffset: 0,
    earfcnRange: [0, 599],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 2,
    name: "1900 PCS",
    dlLow: 1930,
    dlHigh: 1990,
    ulLow: 1850,
    ulHigh: 1910,
    earfcnOffset: 600,
    earfcnRange: [600, 1199],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 3,
    name: "1800",
    dlLow: 1805,
    dlHigh: 1880,
    ulLow: 1710,
    ulHigh: 1785,
    earfcnOffset: 1200,
    earfcnRange: [1200, 1949],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 4,
    name: "AWS-1",
    dlLow: 2110,
    dlHigh: 2155,
    ulLow: 1710,
    ulHigh: 1755,
    earfcnOffset: 1950,
    earfcnRange: [1950, 2399],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 5,
    name: "850",
    dlLow: 869,
    dlHigh: 894,
    ulLow: 824,
    ulHigh: 849,
    earfcnOffset: 2400,
    earfcnRange: [2400, 2649],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 7,
    name: "2600",
    dlLow: 2620,
    dlHigh: 2690,
    ulLow: 2500,
    ulHigh: 2570,
    earfcnOffset: 2750,
    earfcnRange: [2750, 3449],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 8,
    name: "900",
    dlLow: 925,
    dlHigh: 960,
    ulLow: 880,
    ulHigh: 915,
    earfcnOffset: 3450,
    earfcnRange: [3450, 3799],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 12,
    name: "700 a",
    dlLow: 729,
    dlHigh: 746,
    ulLow: 699,
    ulHigh: 716,
    earfcnOffset: 5010,
    earfcnRange: [5010, 5179],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 13,
    name: "700 c",
    dlLow: 746,
    dlHigh: 756,
    ulLow: 777,
    ulHigh: 787,
    earfcnOffset: 5180,
    earfcnRange: [5180, 5279],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 14,
    name: "700 PS",
    dlLow: 758,
    dlHigh: 768,
    ulLow: 788,
    ulHigh: 798,
    earfcnOffset: 5280,
    earfcnRange: [5280, 5379],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 17,
    name: "700 b",
    dlLow: 734,
    dlHigh: 746,
    ulLow: 704,
    ulHigh: 716,
    earfcnOffset: 5730,
    earfcnRange: [5730, 5849],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 20,
    name: "800 DD",
    dlLow: 791,
    dlHigh: 821,
    ulLow: 832,
    ulHigh: 862,
    earfcnOffset: 6150,
    earfcnRange: [6150, 6449],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 25,
    name: "1900+",
    dlLow: 1930,
    dlHigh: 1995,
    ulLow: 1850,
    ulHigh: 1915,
    earfcnOffset: 8040,
    earfcnRange: [8040, 8689],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 26,
    name: "850+",
    dlLow: 859,
    dlHigh: 894,
    ulLow: 814,
    ulHigh: 849,
    earfcnOffset: 8690,
    earfcnRange: [8690, 9039],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 28,
    name: "700 APT",
    dlLow: 758,
    dlHigh: 803,
    ulLow: 703,
    ulHigh: 748,
    earfcnOffset: 9210,
    earfcnRange: [9210, 9659],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 66,
    name: "AWS-3",
    dlLow: 2110,
    dlHigh: 2200,
    ulLow: 1710,
    ulHigh: 1780,
    earfcnOffset: 66436,
    earfcnRange: [66436, 67335],
    spacing: 0.1,
    duplexType: "FDD",
  },
  {
    band: 71,
    name: "600",
    dlLow: 617,
    dlHigh: 652,
    ulLow: 663,
    ulHigh: 698,
    earfcnOffset: 68586,
    earfcnRange: [68586, 68935],
    spacing: 0.1,
    duplexType: "FDD",
  },
  // TDD Bands
  {
    band: 38,
    name: "TD 2600",
    dlLow: 2570,
    dlHigh: 2620,
    ulLow: 2570,
    ulHigh: 2620,
    earfcnOffset: 37750,
    earfcnRange: [37750, 38249],
    spacing: 0.1,
    duplexType: "TDD",
  },
  {
    band: 40,
    name: "TD 2300",
    dlLow: 2300,
    dlHigh: 2400,
    ulLow: 2300,
    ulHigh: 2400,
    earfcnOffset: 38650,
    earfcnRange: [38650, 39649],
    spacing: 0.1,
    duplexType: "TDD",
  },
  {
    band: 41,
    name: "TD 2500",
    dlLow: 2496,
    dlHigh: 2690,
    ulLow: 2496,
    ulHigh: 2690,
    earfcnOffset: 39650,
    earfcnRange: [39650, 41589],
    spacing: 0.1,
    duplexType: "TDD",
  },
  {
    band: 48,
    name: "CBRS",
    dlLow: 3550,
    dlHigh: 3700,
    ulLow: 3550,
    ulHigh: 3700,
    earfcnOffset: 55240,
    earfcnRange: [55240, 56739],
    spacing: 0.1,
    duplexType: "TDD",
  },
];

// NR Band configurations based on 3GPP TS 138.104
const nrBands: NRBand[] = [
  // Low bands (FR1)
  {
    band: 5,
    name: "850",
    dlLow: 869,
    dlHigh: 894,
    ulLow: 824,
    ulHigh: 849,
    nrarfcnOffset: 173800,
    nrarfcnRange: [173800, 178800],
    duplexType: "FDD",
  },
  {
    band: 8,
    name: "900",
    dlLow: 925,
    dlHigh: 960,
    ulLow: 880,
    ulHigh: 915,
    nrarfcnOffset: 185000,
    nrarfcnRange: [185000, 192000],
    duplexType: "FDD",
  },
  {
    band: 12,
    name: "700 a",
    dlLow: 729,
    dlHigh: 746,
    ulLow: 699,
    ulHigh: 716,
    nrarfcnOffset: 145800,
    nrarfcnRange: [145800, 149200],
    duplexType: "FDD",
  },
  {
    band: 14,
    name: "700 PS",
    dlLow: 758,
    dlHigh: 768,
    ulLow: 788,
    ulHigh: 798,
    nrarfcnOffset: 151600,
    nrarfcnRange: [151600, 153600],
    duplexType: "FDD",
  },
  {
    band: 20,
    name: "800 DD",
    dlLow: 791,
    dlHigh: 821,
    ulLow: 832,
    ulHigh: 862,
    nrarfcnOffset: 158200,
    nrarfcnRange: [158200, 164200],
    duplexType: "FDD",
  },
  {
    band: 28,
    name: "700 APT",
    dlLow: 758,
    dlHigh: 803,
    ulLow: 703,
    ulHigh: 748,
    nrarfcnOffset: 151600,
    nrarfcnRange: [151600, 160600],
    duplexType: "FDD",
  },
  {
    band: 71,
    name: "600",
    dlLow: 617,
    dlHigh: 652,
    ulLow: 663,
    ulHigh: 698,
    nrarfcnOffset: 123400,
    nrarfcnRange: [123400, 130400],
    duplexType: "FDD",
  },
  // Mid bands (FR1)
  {
    band: 1,
    name: "2100",
    dlLow: 2110,
    dlHigh: 2170,
    ulLow: 1920,
    ulHigh: 1980,
    nrarfcnOffset: 422000,
    nrarfcnRange: [422000, 434000],
    duplexType: "FDD",
  },
  {
    band: 2,
    name: "1900 PCS",
    dlLow: 1930,
    dlHigh: 1990,
    ulLow: 1850,
    ulHigh: 1910,
    nrarfcnOffset: 386000,
    nrarfcnRange: [386000, 398000],
    duplexType: "FDD",
  },
  {
    band: 3,
    name: "1800",
    dlLow: 1805,
    dlHigh: 1880,
    ulLow: 1710,
    ulHigh: 1785,
    nrarfcnOffset: 361000,
    nrarfcnRange: [361000, 376000],
    duplexType: "FDD",
  },
  {
    band: 7,
    name: "2600",
    dlLow: 2620,
    dlHigh: 2690,
    ulLow: 2500,
    ulHigh: 2570,
    nrarfcnOffset: 524000,
    nrarfcnRange: [524000, 538000],
    duplexType: "FDD",
  },
  {
    band: 25,
    name: "1900+",
    dlLow: 1930,
    dlHigh: 1995,
    ulLow: 1850,
    ulHigh: 1915,
    nrarfcnOffset: 386000,
    nrarfcnRange: [386000, 399000],
    duplexType: "FDD",
  },
  {
    band: 66,
    name: "AWS-3",
    dlLow: 2110,
    dlHigh: 2200,
    ulLow: 1710,
    ulHigh: 1780,
    nrarfcnOffset: 422000,
    nrarfcnRange: [422000, 440000],
    duplexType: "FDD",
  },
  {
    band: 70,
    name: "AWS-4",
    dlLow: 1995,
    dlHigh: 2020,
    ulLow: 1695,
    ulHigh: 1710,
    nrarfcnOffset: 399000,
    nrarfcnRange: [399000, 404000],
    duplexType: "FDD",
  },
  // TDD bands (FR1)
  {
    band: 34,
    name: "2000 TDD",
    dlLow: 2010,
    dlHigh: 2025,
    ulLow: 2010,
    ulHigh: 2025,
    nrarfcnOffset: 402000,
    nrarfcnRange: [402000, 405000],
    duplexType: "TDD",
  },
  {
    band: 38,
    name: "TD 2600",
    dlLow: 2570,
    dlHigh: 2620,
    ulLow: 2570,
    ulHigh: 2620,
    nrarfcnOffset: 514000,
    nrarfcnRange: [514000, 524000],
    duplexType: "TDD",
  },
  {
    band: 39,
    name: "IMT 1900 TDD",
    dlLow: 1880,
    dlHigh: 1920,
    ulLow: 1880,
    ulHigh: 1920,
    nrarfcnOffset: 376000,
    nrarfcnRange: [376000, 384000],
    duplexType: "TDD",
  },
  {
    band: 40,
    name: "TD 2300",
    dlLow: 2300,
    dlHigh: 2400,
    ulLow: 2300,
    ulHigh: 2400,
    nrarfcnOffset: 460000,
    nrarfcnRange: [460000, 480000],
    duplexType: "TDD",
  },
  {
    band: 41,
    name: "TD 2500",
    dlLow: 2496,
    dlHigh: 2690,
    ulLow: 2496,
    ulHigh: 2690,
    nrarfcnOffset: 499200,
    nrarfcnRange: [499200, 537999],
    duplexType: "TDD",
  },
  {
    band: 48,
    name: "CBRS",
    dlLow: 3550,
    dlHigh: 3700,
    ulLow: 3550,
    ulHigh: 3700,
    nrarfcnOffset: 636667,
    nrarfcnRange: [636667, 646666],
    duplexType: "TDD",
  },
  {
    band: 77,
    name: "C-Band",
    dlLow: 3300,
    dlHigh: 4200,
    ulLow: 3300,
    ulHigh: 4200,
    nrarfcnOffset: 620000,
    nrarfcnRange: [620000, 680000],
    duplexType: "TDD",
  },
  {
    band: 78,
    name: "C-Band (3.5GHz)",
    dlLow: 3300,
    dlHigh: 3800,
    ulLow: 3300,
    ulHigh: 3800,
    nrarfcnOffset: 620000,
    nrarfcnRange: [620000, 653333],
    duplexType: "TDD",
  },
  {
    band: 79,
    name: "4.5GHz",
    dlLow: 4400,
    dlHigh: 5000,
    ulLow: 4400,
    ulHigh: 5000,
    nrarfcnOffset: 693334,
    nrarfcnRange: [693334, 733333],
    duplexType: "TDD",
  },
  {
    band: 90,
    name: "TD 2600",
    dlLow: 2496,
    dlHigh: 2690,
    ulLow: 2496,
    ulHigh: 2690,
    nrarfcnOffset: 499200,
    nrarfcnRange: [499200, 538000],
    duplexType: "TDD",
  },
  // FR2 (mmWave) bands
  {
    band: 257,
    name: "28 GHz",
    dlLow: 26500,
    dlHigh: 29500,
    ulLow: 26500,
    ulHigh: 29500,
    nrarfcnOffset: 2054166,
    nrarfcnRange: [2054166, 2104165],
    duplexType: "TDD",
  },
  {
    band: 258,
    name: "26 GHz",
    dlLow: 24250,
    dlHigh: 27500,
    ulLow: 24250,
    ulHigh: 27500,
    nrarfcnOffset: 2016667,
    nrarfcnRange: [2016667, 2070832],
    duplexType: "TDD",
  },
  {
    band: 259,
    name: "41 GHz",
    dlLow: 39500,
    dlHigh: 43500,
    ulLow: 39500,
    ulHigh: 43500,
    nrarfcnOffset: 2270832,
    nrarfcnRange: [2270832, 2337499],
    duplexType: "TDD",
  },
  {
    band: 260,
    name: "39 GHz",
    dlLow: 37000,
    dlHigh: 40000,
    ulLow: 37000,
    ulHigh: 40000,
    nrarfcnOffset: 2229166,
    nrarfcnRange: [2229166, 2279165],
    duplexType: "TDD",
  },
  {
    band: 261,
    name: "28 GHz",
    dlLow: 27500,
    dlHigh: 28350,
    ulLow: 27500,
    ulHigh: 28350,
    nrarfcnOffset: 2070833,
    nrarfcnRange: [2070833, 2084999],
    duplexType: "TDD",
  },
];

// Calculate LTE frequency from EARFCN
const calculateLTEFrequency = (earfcn: number): LTEResult | null => {
  const matchingBands: LTEMatchingBand[] = [];
  for (const band of lteBands) {
    if (earfcn >= band.earfcnRange[0] && earfcn <= band.earfcnRange[1]) {
      const dlFreq = band.dlLow + (earfcn - band.earfcnOffset) * band.spacing;

      let ulEarfcn: number;
      let ulFreq: number;

      if (band.duplexType === "FDD") {
        const dlOffset = earfcn - band.earfcnOffset;
        ulEarfcn = earfcn + 18000;
        ulFreq = band.ulLow + dlOffset * band.spacing;
      } else {
        ulEarfcn = earfcn;
        ulFreq = dlFreq;
      }

      matchingBands.push({
        ...band,
        dlFrequency: dlFreq.toFixed(2),
        ulFrequency: ulFreq.toFixed(2),
        ulEarfcn,
      });
    }
  }

  if (matchingBands.length === 0) {
    return null;
  }

  const primaryBand = matchingBands[0];

  return {
    networkType: "LTE",
    earfcn,
    frequency: primaryBand.dlFrequency,
    possibleBands: matchingBands,
  };
};

// Calculate NR frequency from NR-ARFCN using 3GPP TS 38.104 specifications
const calculateNRFrequency = (nrarfcn: number): NRResult | null => {
  let frequency: number;

  if (nrarfcn >= 0 && nrarfcn <= 599999) {
    frequency = 0 + (nrarfcn - 0) * 0.005;
  } else if (nrarfcn >= 600000 && nrarfcn <= 2016666) {
    frequency = 3000 + (nrarfcn - 600000) * 0.015;
  } else if (nrarfcn >= 2016667 && nrarfcn <= 3279165) {
    frequency = 24250.08 + (nrarfcn - 2016667) * 0.06;
  } else {
    return null;
  }

  const matchingBands: NRBand[] = [];
  for (const band of nrBands) {
    if (nrarfcn >= band.nrarfcnRange[0] && nrarfcn <= band.nrarfcnRange[1]) {
      matchingBands.push(band);
    }
  }

  if (matchingBands.length === 0) {
    return null;
  }

  return {
    networkType: "NR",
    earfcn: nrarfcn,
    frequency: frequency.toFixed(2),
    possibleBands: matchingBands,
  };
};

// Decide which calculation to use based on the EARFCN/NR-ARFCN range
const calculateFrequency = (
  earfcn: string,
  forceType: "lte" | "nr" | null = null
): CalculationResult | ErrorResult => {
  const earfcnNum = parseInt(earfcn);

  if (isNaN(earfcnNum)) {
    return { error: "Please enter a valid number" };
  }

  if (
    forceType === "lte" ||
    (forceType === null && earfcnNum >= 0 && earfcnNum <= 68935)
  ) {
    return calculateLTEFrequency(earfcnNum);
  } else if (forceType === "nr" || (forceType === null && earfcnNum >= 123400)) {
    return calculateNRFrequency(earfcnNum);
  }

  return null;
};

// Initialize history from localStorage
const getInitialHistory = (): HistoryEntry[] => {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const savedHistory = localStorage.getItem("earfcnHistory");
      if (savedHistory) {
        return JSON.parse(savedHistory) as HistoryEntry[];
      }
    } catch {
      // Silently fail
    }
  }
  return [];
};

const FrequencyCalculator = () => {
  const [earfcn, setEarfcn] = useState<string>("");
  const [result, setResult] = useState<CalculationResult>(null);
  const [error, setError] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"auto" | "lte" | "nr">("auto");
  const [history, setHistory] = useState<HistoryEntry[]>(getInitialHistory);

  // Save history to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        if (history.length > 0) {
          localStorage.setItem("earfcnHistory", JSON.stringify(history));
        } else {
          localStorage.removeItem("earfcnHistory");
        }
      } catch {
        // Silently fail
      }
    }
  }, [history]);

  const handleCalculate = (): void => {
    if (!earfcn) {
      setError("Please enter an E/ARFCN value");
      setResult(null);
      return;
    }

    try {
      const forceType = activeTab === "auto" ? null : activeTab;
      const calculationResult = calculateFrequency(earfcn, forceType);

      if (calculationResult && !("error" in calculationResult)) {
        setResult(calculationResult);
        setError("");

        const historyEntry: HistoryEntry = {
          ...calculationResult,
          timestamp: new Date().toISOString(),
          id: Date.now().toString(),
        };

        setHistory((prev) => [historyEntry, ...prev.slice(0, 9)]);
      } else if (calculationResult && "error" in calculationResult) {
        setError(calculationResult.error);
        setResult(null);
      } else {
        setError("Could not identify band for this E/ARFCN value");
        setResult(null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError("Calculation error: " + errorMessage);
      setResult(null);
    }
  };

  const deleteHistoryEntry = (id: string): void => {
    setHistory((prev) => prev.filter((entry) => entry.id !== id));
  };

  const clearHistory = (): void => {
    setHistory([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleCalculate();
    }
  };

  return (
    <div className="grid gap-4 @xl/main:grid-cols-2">
      {/* Calculator Card */}
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>E/ARFCN Calculator</CardTitle>
          <CardDescription>
            Enter a channel number to calculate frequency and band information.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            defaultValue="auto"
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value as "auto" | "lte" | "nr")
            }
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="auto">Auto</TabsTrigger>
              <TabsTrigger value="lte">LTE</TabsTrigger>
              <TabsTrigger value="nr">NR</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-2">
            <Label htmlFor="earfcn">
              {activeTab === "lte"
                ? "E-ARFCN"
                : activeTab === "nr"
                ? "NR-ARFCN"
                : "E/ARFCN Value"}
            </Label>
            <div className="flex gap-2">
              <Input
                id="earfcn"
                type="number"
                placeholder="Enter channel number"
                value={earfcn}
                onChange={(e) => setEarfcn(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <Button onClick={handleCalculate}>Calculate</Button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-500/20 text-red-500 border border-red-300/50 rounded-md text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <Separator />
              <div className="space-y-3">
                <h3 className="font-semibold">Result</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground font-semibold">Network Type</div>
                  <div className="font-medium">
                    <Badge variant="default">{result.networkType}</Badge>
                  </div>

                  <div className="text-muted-foreground font-semibold">
                    {result.networkType === "LTE" ? "EARFCN" : "NR-ARFCN"}
                  </div>
                  <div className="font-medium">{result.earfcn}</div>

                  <div className="text-muted-foreground font-semibold">Frequency</div>
                  <div className="font-medium">{result.frequency} MHz</div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <h4 className="font-semibold">Possible Operating Bands</h4>
                <div className="space-y-4">
                  {result.possibleBands.map((band, index) => (
                    <div key={index} className="space-y-2">
                      {index > 0 && <Separator />}
                      <div className="font-semibold">
                        {result.networkType === "NR"
                          ? `n${band.band}`
                          : `Band ${band.band}`}{" "}
                        <span className="font-semibold text-sm">
                          ({band.name})
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-sm">
                        <div className="text-muted-foreground font-semibold">Duplex Mode</div>
                        <div className="font-medium">{band.duplexType}</div>

                        <div className="text-muted-foreground font-semibold">
                          Downlink Range
                        </div>
                        <div className="font-medium">
                          {band.dlLow} - {band.dlHigh} MHz
                        </div>

                        {band.duplexType === "FDD" && (
                          <>
                            <div className="text-muted-foreground font-semibold">
                              Uplink Range
                            </div>
                            <div className="font-medium">
                              {band.ulLow} - {band.ulHigh} MHz
                            </div>
                          </>
                        )}

                        <div className="text-muted-foreground font-semibold">
                          {result.networkType === "LTE"
                            ? "EARFCN Range"
                            : "NR-ARFCN Range"}
                        </div>
                        <div className="font-medium">
                          {result.networkType === "LTE"
                            ? `${(band as LTEMatchingBand).earfcnRange[0]} - ${
                                (band as LTEMatchingBand).earfcnRange[1]
                              }`
                            : `${(band as NRBand).nrarfcnRange[0]} - ${
                                (band as NRBand).nrarfcnRange[1]
                              }`}
                        </div>

                        {result.networkType === "LTE" && (
                          <>
                            <div className="text-muted-foreground font-semibold">
                              DL Frequency
                            </div>
                            <div className="font-medium">
                              {(band as LTEMatchingBand).dlFrequency} MHz
                            </div>

                            <div className="text-muted-foreground font-semibold">
                              UL Frequency
                            </div>
                            <div className="font-medium">
                              {(band as LTEMatchingBand).ulFrequency} MHz
                            </div>

                            {band.duplexType === "FDD" && (
                              <>
                                <div className="text-muted-foreground font-semibold">
                                  UL EARFCN
                                </div>
                                <div className="font-medium">
                                  {(band as LTEMatchingBand).ulEarfcn}
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Calculation method:{" "}
                {result.networkType === "NR"
                  ? "3GPP TS 38.104 Section 5.4.2.1"
                  : "3GPP TS 36.101 Section 5.7"}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History Card */}
      <Card className="@container/card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Calculation History</CardTitle>
              <CardDescription>
                Your recent calculations are saved locally.
              </CardDescription>
            </div>
            {history.length > 0 && (
              <Button variant="destructive" size="sm" onClick={clearHistory}>
                <Trash2 className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No calculation history yet.
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 border rounded-lg flex justify-between items-start"
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{entry.earfcn}</span>
                      <Badge>{entry.networkType}</Badge>
                      <span className="text-sm font-medium text-muted-foreground">
                        {entry.frequency} MHz
                      </span>
                    </div>
                    {entry.possibleBands && (
                      <div className="text-sm font-semibold">
                        Bands:{" "}
                        {entry.possibleBands
                          .map((band) =>
                            entry.networkType === "NR"
                              ? `n${band.band}`
                              : `B${band.band}`
                          )
                          .join(", ")}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {entry.timestamp
                        ? new Date(entry.timestamp).toLocaleString()
                        : "No timestamp"}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteHistoryEntry(entry.id)}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FrequencyCalculator;