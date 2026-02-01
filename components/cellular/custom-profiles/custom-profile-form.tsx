import React from "react";

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const CustomProfileFormComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Create Custom SIM Profile</CardTitle>
        <CardDescription>
          Fill out the form below to create a custom SIM profile.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4">
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="profileName">Profile Name</FieldLabel>
                  <Input
                    id="profileName"
                    type="text"
                    placeholder="My Custom Profile"
                  />
                </Field>
                <Field>
                  <FieldLabel>Mobile Network Operator</FieldLabel>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose Mobile Network Operator" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Verizon">Verizon</SelectItem>
                      <SelectItem value="Others">Others</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Select your mobile network operator.
                  </FieldDescription>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="imei">Register Current SIM</FieldLabel>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose Mobile Network Operator" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">SMART ending in 6869</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="imei">Preferred IMEI</FieldLabel>
                    <Input
                      id="imei"
                      type="text"
                      placeholder="123456789012345"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="ttlValue">
                      Preferred TTL Value
                    </FieldLabel>
                    <Input id="ttlValue" type="text" placeholder="64" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="hlValue">
                      Preferred HL Value
                    </FieldLabel>
                    <Input id="hlValue" type="text" placeholder="64" />
                  </Field>
                </div>
              </FieldGroup>
            </FieldSet>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default CustomProfileFormComponent;
