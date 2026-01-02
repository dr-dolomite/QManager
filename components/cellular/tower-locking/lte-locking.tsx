import React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TbInfoCircleFilled } from "react-icons/tb";
import { Input } from "@/components/ui/input";

import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";

const LTELockingComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>LTE Tower Locking</CardTitle>
        <CardDescription>
          Manage LTE tower locking settings for your device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
              <p className="font-semibold text-muted-foreground text-sm">
                LTE Tower Locking Enabled
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="lte-tower-locking" checked />
              <Label htmlFor="lte-tower-locking">Enabled</Label>
            </div>
          </div>
          <Separator />
          <form className="grid gap-4 mt-6">
            <div className="w-full">
              <FieldSet>
                <FieldGroup>
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel htmlFor="earfcn">E/ARFCN</FieldLabel>
                      <Input
                        id="earfcn1"
                        type="text"
                        placeholder="Enter E/ARFCN"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="pci">PCI</FieldLabel>
                      <Input id="pci" type="text" placeholder="Enter PCI" />
                    </Field>
                  </div>
                  {/* Optional locking entry 2 */}
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel htmlFor="earfcn2">E/ARFCN 2</FieldLabel>
                      <Input
                        id="earfcn2"
                        type="text"
                        placeholder="Enter E/ARFCN 2"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="pci2">PCI 2</FieldLabel>
                      <Input id="pci2" type="text" placeholder="Enter PCI 2" />
                    </Field>
                  </div>
                  {/* Optional locking entry 3 */}
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel htmlFor="earfcn3">E/ARFCN 3</FieldLabel>
                      <Input
                        id="earfcn3"
                        type="text"
                        placeholder="Enter E/ARFCN 3"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="pci3">PCI 3</FieldLabel>
                      <Input id="pci3" type="text" placeholder="Enter PCI 3" />
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

export default LTELockingComponent;
