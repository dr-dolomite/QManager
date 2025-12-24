"use client";

import React, { useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RotateCcwIcon } from "lucide-react";

// Mock data for prototyping
const mockBands = {
  lte: [
    "1",
    "2",
    "3",
    "4",
    "5",
    "7",
    "8",
    "12",
    "13",
    "14",
    "17",
    "18",
    "19",
    "20",
    "25",
    "26",
    "28",
    "29",
    "30",
    "32",
    "34",
    "38",
    "39",
    "40",
    "41",
    "42",
    "43",
    "46",
    "48",
    "66",
    "71",
  ],
  nr: [
    "1",
    "2",
    "3",
    "5",
    "7",
    "8",
    "12",
    "14",
    "20",
    "25",
    "28",
    "29",
    "30",
    "38",
    "40",
    "41",
    "48",
    "66",
    "71",
    "77",
    "78",
    "79",
    "257",
    "258",
    "260",
    "261",
  ],
};

interface BandCardsProps {
  title: string;
  description: string;
  bandType: "lte" | "nr";
  prefix: string;
}

const BandCardsComponent = ({
  title,
  description,
  bandType,
  prefix,
}: BandCardsProps) => {
  const [checkedBands, setCheckedBands] = useState<string[]>([]);

  const handleCheckboxChange = (band: string) => {
    setCheckedBands((prev) =>
      prev.includes(band) ? prev.filter((b) => b !== band) : [...prev, band]
    );
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid lg:grid-cols-8 md:grid-cols-6 sm:grid-cols-4 grid-cols-3 grid-flow-row gap-4">
        {mockBands[bandType].map((band) => (
          <div className="flex items-center space-x-2" key={band}>
            <Checkbox
              id={`${bandType}-${band}`}
              checked={checkedBands.includes(band)}
              onCheckedChange={() => handleCheckboxChange(band)}
              className="hover:cursor-pointer"
            />
            <Label htmlFor={`${bandType}-${band}`} className="cursor-pointer">
              {prefix}
              {band}
            </Label>
          </div>
        ))}
      </CardContent>
      <CardFooter>
        <div className="mt-3 flex items-center gap-x-2">
          <Button>Lock Selected Bands</Button>
          <Button size="icon">
            <RotateCcwIcon />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};

export default BandCardsComponent;
