"use client";

import React, { useRef } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { CgEthernet } from "react-icons/cg";

import { AnimatedBeam } from "../ui/animated-beam";
import { Separator } from "../ui/separator";

const EthernetStatusCard = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<HTMLDivElement>(null);
  const ringsRef = useRef<HTMLDivElement>(null);
  const ethernetRef = useRef<HTMLDivElement>(null);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Ethernet Status</CardTitle>
        <CardDescription>
          Displays the current status of the Ethernet connection, including
          speed and connectivity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid space-y-6">
          <div
            ref={containerRef}
            className="relative flex items-center justify-between"
          >
            <div
              ref={deviceRef}
              className="size-32 bg-primary/15 rounded-full p-6 flex items-center justify-center"
            >
              <img
                src="/device-icon.svg"
                alt="Device Icon"
                className="size-full rounded-full drop-shadow-md"
              />
            </div>

            <div
              ref={ringsRef}
              className="relative flex items-center justify-center size-24"
            >
              {/* Outer rings - pulsating */}
              <div className="absolute rounded-full size-24 bg-green-200 animate-pulse-ring" />
              <div
                className="absolute rounded-full size-16 bg-green-300 animate-pulse-ring"
                style={{ animationDelay: "0.3s" }}
              />
              <div
                className="absolute rounded-full size-12 bg-green-400 animate-pulse-ring"
                style={{ animationDelay: "0.6s" }}
              />
              {/* Center circle */}
              <div className="relative rounded-full size-4 bg-green-600" />
            </div>

            <div
              ref={ethernetRef}
              className="size-32 bg-primary rounded-full p-6 flex items-center justify-center"
            >
              <CgEthernet className="size-full text-white" />
            </div>

            {/* Animated beams connecting the elements */}
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={deviceRef}
              toRef={ringsRef}
              duration={2}
              pathWidth={3}
              gradientStartColor="#3b82f6"
              gradientStopColor="#22c55e"
              startXOffset={72}
              endXOffset={-56}
            />
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={ringsRef}
              toRef={ethernetRef}
              duration={2}
              pathWidth={3}
              gradientStartColor="#22c55e"
              gradientStopColor="#3b82f6"
              startXOffset={56}
              endXOffset={-72}
            />
          </div>
          <div className="grid gap-2 w-full">
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Link Status
              </p>
              <p className="font-semibold xl:text-md text-sm">Connected</p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Auto-negotiation
              </p>
              <p className="font-semibold xl:text-md text-sm">Active</p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Active Link Speed
              </p>
              <p className="font-semibold xl:text-md text-sm">1 Gbps</p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Set Link Speed
              </p>
              <Select>
                <SelectTrigger className="w-full max-w-46 font-semibold text-muted-foreground xl:text-md text-sm">
                  <SelectValue placeholder="Select a link speed" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup className="font-semibold text-muted-foreground xl:text-md text-sm">
                    <SelectLabel>Link Speed Limit</SelectLabel>
                    <SelectItem value="max">
                      Max Speed (Auto)
                    </SelectItem>
                    <SelectItem value="10">10 Mbps</SelectItem>
                    <SelectItem value="100">100 Mbps</SelectItem>
                    <SelectItem value="1000">1000 Mbps</SelectItem>
                    <SelectItem value="auto">10/100/1000 Mbps</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <Separator />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default EthernetStatusCard;
