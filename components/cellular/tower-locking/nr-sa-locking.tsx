import React from "react";

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
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TbInfoCircleFilled } from "react-icons/tb";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";

const NRSALockingComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>NR-SA Tower Locking</CardTitle>
        <CardDescription>
          Manage NR-SA tower locking settings for your device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
              <p className="font-semibold text-muted-foreground text-sm">
                NR Tower Locking Enabled
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="nr-sa-tower-locking" checked />
              <Label htmlFor="nr-sa-tower-locking">Enabled</Label>
            </div>
          </div>
          <Separator />
          <form className="grid gap-4 mt-6">
            <div className="w-full">
              <FieldSet>
                <FieldGroup>
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel htmlFor="earfcn">NR ARFCN</FieldLabel>
                      <Input
                        id="nrarfcn1"
                        type="text"
                        placeholder="Enter NR ARFCN"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="nrpci">NR PCI</FieldLabel>
                      <Input
                        id="nrpci"
                        type="text"
                        placeholder="Enter NR PCI"
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel htmlFor="nr-band">NR Band</FieldLabel>
                      <Input
                        id="nr-band"
                        type="text"
                        placeholder="Enter NR Band"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="scs">SCS</FieldLabel>
                      <Select>
                        <SelectTrigger>
                          <SelectValue placeholder="SCS" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="15">15 kHz</SelectItem>
                          <SelectItem value="30">30 kHz</SelectItem>
                          <SelectItem value="60">60 kHz</SelectItem>
                          <SelectItem value="120">120 kHz</SelectItem>
                          <SelectItem value="240">240 kHz</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </FieldGroup>
              </FieldSet>
            </div>
          </form>
        </div>
      </CardContent>
    </Card>
  );
};

export default NRSALockingComponent;
