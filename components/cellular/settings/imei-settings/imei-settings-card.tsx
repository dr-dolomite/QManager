import React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { Button } from "@/components/ui/button";
import { RotateCcwIcon, AlertTriangleIcon } from "lucide-react";

const IMEISettingsCard = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>IMEI Settings</CardTitle>
        <CardDescription>
          Please proceed with caution when modifying IMEI settings. Incorrect
          changes may lead to device malfunctions or legal issues.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4">
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="deviceImei">Set Device IMEI</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="inline-start-input"
                      placeholder="Enter Device IMEI"
                    />
                    <InputGroupAddon align="inline-start">
                      <Tooltip>
                        <TooltipTrigger className="pl-1.5">
                          <AlertTriangleIcon className="text-muted-foreground size-4" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            We are not responsible for any legal issues arising
                            from IMEI modifications.
                            <br />
                            Ensure compliance with
                            local laws.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>
                    Changing the IMEI will require a device reboot to take
                    effect.
                  </FieldDescription>
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

export default IMEISettingsCard;
