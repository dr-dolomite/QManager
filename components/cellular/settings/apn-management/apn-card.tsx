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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RotateCcwIcon } from "lucide-react";

const APNSettingsCard = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>APN Settings</CardTitle>
        <CardDescription>
          Configure and manage Access Point Names (APNs) for your cellular
          connections.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4">
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <div className="grid xl:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel htmlFor="active-apn">Active APN</FieldLabel>
                    <Input
                      id="active-apn"
                      placeholder="Enter Active APN"
                      required
                    />
                  </Field>

                  <Field>
                    <FieldLabel>Auto APN</FieldLabel>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose Auto APN" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="tmo">T-Mobile Auto APN</SelectItem>
                        <SelectItem value="verizon">
                          Verizon Auto APN
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <div className="grid xl:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel>Carrier Profiles</FieldLabel>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose Carrier Profile" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">internet</SelectItem>
                        <SelectItem value="1">ims</SelectItem>
                        <SelectItem value="2">sos</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>IP Protocol</FieldLabel>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose IP Protocol" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IPV4V6">Default</SelectItem>
                        <SelectItem value="IPV4">IPv4 Only</SelectItem>
                        <SelectItem value="IPV6">IPv6 Only</SelectItem>
                        <SelectItem value="P2P">P2P Control</SelectItem>
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

export default APNSettingsCard;
