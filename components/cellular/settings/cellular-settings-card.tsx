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

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RotateCcwIcon } from "lucide-react";

const CellularSettingsCard = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Cellular Basic Settings</CardTitle>
        <CardDescription>
          Manage your cellular connection settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4">
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <div className="grid xl:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel>Select Active U-SIM Slot</FieldLabel>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose U-SIM Slot" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">U-SIM 1</SelectItem>
                        <SelectItem value="2">U-SIM 2</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>Select Cellular Functionality</FieldLabel>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose Cellular Functionality" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Minimum Functionality</SelectItem>
                        <SelectItem value="1">Full Functionality</SelectItem>
                        <SelectItem value="2">
                          Disable Cellular Functionality
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <div className="grid xl:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel>Select Network (RAT) Mode</FieldLabel>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose Network Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AUTO">Automatic</SelectItem>
                        <SelectItem value="LTE">LTE Only</SelectItem>
                        <SelectItem value="NR5G">NR5G Only</SelectItem>
                        <SelectItem value="LTE:NR5G">LTE + NR5G</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>NR5G Mode Control</FieldLabel>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose NR5G Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AUTO">
                          SA and NSA Automatic
                        </SelectItem>
                        <SelectItem value="NSA">NSA Only</SelectItem>
                        <SelectItem value="SA">SA Only</SelectItem>
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

export default CellularSettingsCard;
