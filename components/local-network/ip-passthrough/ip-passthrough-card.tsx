"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RotateCcwIcon } from "lucide-react";

const IPPassthroughCard = () => {
  const [macSource, setMacSource] = useState<string>("");

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>IP Passthrough (IPPT) Configuration</CardTitle>
        <CardDescription>
          Manage your IP Passthrough settings to optimize network performance
          and connectivity for your devices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4">
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <div className="grid xl:grid-cols-2 grid-cols-1 gap-4">
                  {/* Field 1: The "Why" - IP Passthrough Mode */}
                  <Field>
                    <FieldLabel>IP Passthrough (Bridge)</FieldLabel>
                    <Select name="ippt_mode">
                      <SelectTrigger>
                        <SelectValue placeholder="Select Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">
                          Disabled (Router Mode)
                        </SelectItem>
                        <SelectItem value="ethernet">Ethernet (ETH)</SelectItem>
                        <SelectItem value="usb">USB Tethering</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  {/* Field 2: The "Who" - The Target Device */}
                  <Field>
                    <FieldLabel>Target Device (MAC)</FieldLabel>
                    <div className="flex gap-2">
                      {/* The Dropdown handles the "Easy" choices */}
                      <Select
                        name="mac_source"
                        value={macSource}
                        onValueChange={setMacSource}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select Target" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="current">
                            This Device (Recommended)
                          </SelectItem>

                          <SelectItem value="2">192.168.224.4</SelectItem>

                          <SelectItem value="manual">
                            Enter Manually...
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Conditional Logic: Show input only when 'manual' is selected */}
                    <AnimatePresence mode="wait">
                      {macSource === "manual" && (
                        <motion.div
                          key="manual-mac-input"
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.3, ease: "easeInOut" }}
                          className="mt-2"
                        >
                          <Input
                            placeholder="XX:XX:XX:XX:XX:XX"
                            className="font-mono uppercase placeholder:normal-case"
                            maxLength={17}
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Only this specific device will receive the WAN IP.
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Field>
                </div>

                <div className="grid xl:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel>USB Connection Mode</FieldLabel>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose USB Modem Protocol" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">RMNET (QMI)</SelectItem>
                        <SelectItem value="1">ECM (Universal)</SelectItem>
                        <SelectItem value="2">MBIM (Windows)</SelectItem>
                        <SelectItem value="3">RNDIS (Legacy)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>DNS Offloading</FieldLabel>
                    <Select name="dns_mode" defaultValue="0">
                      <SelectTrigger>
                        <SelectValue placeholder="Select DNS Strategy" />
                      </SelectTrigger>
                      <SelectContent>
                        {/* The "Recommended" tag guides the user immediately */}
                        <SelectItem value="0">
                          Disabled (Recommended)
                        </SelectItem>
                        <SelectItem value="1">
                          Enabled (Use Modem DNS)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </FieldGroup>
            </FieldSet>
          </div>
          <div className="flex items-center gap-x-2">
            <Button type="submit">Save Settings</Button>
            <Button>
              <RotateCcwIcon />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default IPPassthroughCard;
