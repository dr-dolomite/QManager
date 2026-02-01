import React from "react";
import { Settings, Clock, Signal, Zap, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface ScenarioConfig {
  bands: string[];
  mode: string;
  optimization: string;
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  gradient: string;
  pattern: "gaming" | "streaming" | "balanced" | "custom";
  config: ScenarioConfig;
}

interface ActiveConfigCardProps {
  scenario: Scenario | undefined;
  onEdit?: () => void;
}

export const ActiveConfigCard = ({ scenario, onEdit }: ActiveConfigCardProps) => {
  if (!scenario) return null;
  const Icon = scenario.icon;

  return (
    <Card className="@container/card">
      <CardContent className="px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "p-2.5 rounded-xl bg-linear-to-br text-white",
                scenario.gradient,
              )}
            >
              <Icon className="w-6 h-6" />
            </div>
            <div className="grid">
              <h4 className="font-semibold">{scenario.name} Configuration</h4>
              <Badge
                variant="outline"
                className="bg-green-500/20 text-green-500 hover:bg-green-500/30 border border-green-300/50 backdrop-blur-sm"
              >
                <div className="w-2 h-2 rounded-full bg-green-500" />
                Active
              </Badge>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onEdit}>
            <Settings />
          </Button>
        </div>

        {/* Config Details */}
        <div className="grid gap-2">
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Band Lock
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">
                {scenario.config.bands.join(", ")}
              </p>
            </div>
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Network Mode
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">{scenario.config.mode}</p>
            </div>
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground ">
              Optimization
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold ">
                {scenario.config.optimization}
              </p>
            </div>
          </div>
          <Separator />
        </div>
      </CardContent>
    </Card>
  );
};
