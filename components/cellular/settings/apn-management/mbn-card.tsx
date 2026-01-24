import React from "react";

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
import { Button } from "@/components/ui/button";
import { RotateCcwIcon } from "lucide-react";

const MBNCard = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>MBN Configuration</CardTitle>
        <CardDescription>
          Manage MBN (Mobile Broadband Network) profiles and settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4">
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <Field className="max-w-md">
                  <FieldLabel>Auto-Carrier Matching</FieldLabel>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose Auto-Carrier Matching" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Enabled</SelectItem>
                      <SelectItem value="1">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field className="max-w-md">
                  <FieldLabel>Firmware Carrier Profile</FieldLabel>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose Firmware Carrier Profile" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Default</SelectItem>
                      <SelectItem value="1">First Net</SelectItem>
                      <SelectItem value="2">Commercial-TMO</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
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

export default MBNCard;
