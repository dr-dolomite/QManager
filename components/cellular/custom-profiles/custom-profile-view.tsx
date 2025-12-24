"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable, schema } from "@/components/cellular/custom-profiles/custom-profile-table";
import { z } from "zod";

// Sample data - replace with your actual data source
const profileData: z.infer<typeof schema>[] = [
  { id: 1, profile: "Default LTE Profile", status: "Active" },

];

const CustomProfileViewComponent = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>View Custom Profiles</CardTitle>
        <CardDescription>
          Manage your custom SIM profiles here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable data={profileData} />
      </CardContent>
    </Card>
  );
};

export default CustomProfileViewComponent;
