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
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { TbInfoCircleFilled } from "react-icons/tb";

import { Switch } from "@/components/ui/switch";
import { AlertTriangleIcon } from "lucide-react";

const BackupIMEICard = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Backup Device IMEI</CardTitle>
        <CardDescription>
          Automatically sets up a backup IMEI for your device to ensure
          connectivity in case of primary IMEI issues.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4">
          <FieldSet>
            <FieldGroup>
              <div className="grid gap-2">
                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="backup-imei">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                      </TooltipTrigger>
                      <TooltipContent>
                        {/* Will show in Hexadecimal form */}
                        <p>
                          Switch to a backup IMEI when the primary IMEI was
                          rejected by the network.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    Enable Backup IMEI
                  </FieldLabel>
                  <Switch id="backup-imei" />
                </Field>

                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="internet-monitoring">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                      </TooltipTrigger>
                      <TooltipContent>
                        {/* Will show in Hexadecimal form */}
                        <p>
                          Switch to a backup IMEI when the primary IMEI
                          disconnects from the internet.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    Enable Internet Monitoring
                  </FieldLabel>
                  <Switch id="internet-monitoring" />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="deviceImei">Set Backup IMEI</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="inline-start-input"
                    placeholder="Enter Backup IMEI"
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
                          Ensure compliance with local laws.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  Switching to the backup IMEI will require a device reboot to take effect.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
};

export default BackupIMEICard;
