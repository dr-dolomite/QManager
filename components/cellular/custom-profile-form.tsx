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
        <CardTitle>Create Custom Cellular Profile</CardTitle>
        <CardDescription>
          Fill out the form below to create a custom cellular profile.
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
                    <FieldLabel htmlFor="iccid">ICCID</FieldLabel>
                    <Input
                      id="iccid"
                      type="text"
                      placeholder="12345678901234567890"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="imei">IMEI</FieldLabel>
                    <Input
                      id="imei"
                      type="text"
                      placeholder="123456789012345"
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="lteBands">
                      Preferred LTE Bands
                    </FieldLabel>
                    <Input id="lteBands" type="text" placeholder="1,3,41" />
                    <FieldDescription>
                      Comma-separated list of LTE bands.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="nr5gBands">
                      Preferred NR5G Bands
                    </FieldLabel>
                    <Input id="nr5gBands" type="text" placeholder="1,3,41" />
                    <FieldDescription>
                      Comma-separated list of NR5G bands.
                    </FieldDescription>
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
