"use client";

import React, { useState, useEffect } from "react";
import { Gamepad2, Play, Zap, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AbstractPattern } from "./abstract-pattern";
import { AddScenarioItem } from "./add-scenario-item";
import { ActiveConfigCard } from "./active-config-card";
import { ScenarioItem, Scenario } from "./scenario-item";

// Gradient options for new scenarios
const gradientOptions = [
  { id: "purple", value: "from-violet-600 via-purple-600 to-indigo-700" },
  { id: "rose", value: "from-rose-500 via-pink-500 to-orange-400" },
  { id: "teal", value: "from-emerald-500 via-teal-500 to-cyan-500" },
  { id: "blue", value: "from-blue-500 via-indigo-500 to-purple-600" },
  { id: "amber", value: "from-amber-500 via-orange-500 to-red-500" },
  { id: "slate", value: "from-slate-600 via-gray-700 to-zinc-800" },
];

// Main Component
const ConnectionScenariosCard = () => {
  const [activeScenario, setActiveScenario] = useState("gaming");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState("");
  const [newScenarioDescription, setNewScenarioDescription] = useState("");
  const [selectedGradient, setSelectedGradient] = useState(
    gradientOptions[3].value,
  );

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editGradient, setEditGradient] = useState("");
  const [editBands, setEditBands] = useState("");
  const [editMode, setEditMode] = useState("");
  const [editOptimization, setEditOptimization] = useState("");

  const [scenarios, setScenarios] = useState<Scenario[]>([
    {
      id: "balanced",
      name: "Balanced",
      description: "Auto band selection",
      icon: Zap,
      gradient: "from-emerald-500 via-teal-500 to-cyan-500",
      pattern: "balanced",
      config: {
        bands: ["Auto"],
        mode: "Auto",
        optimization: "Balanced",
      },
    },
    {
      id: "gaming",
      name: "Gaming",
      description: "Low latency, N41/N78 priority",
      icon: Gamepad2,
      gradient: "from-violet-600 via-purple-600 to-indigo-700",
      pattern: "gaming",
      config: {
        bands: ["N41", "N78"],
        mode: "5G SA Preferred",
        optimization: "Latency",
      },
    },
    {
      id: "streaming",
      name: "Streaming",
      description: "High bandwidth, stable connection",
      icon: Play,
      gradient: "from-rose-500 via-pink-500 to-orange-400",
      pattern: "streaming",
      config: {
        bands: ["N41", "B66", "B2"],
        mode: "5G NSA + CA",
        optimization: "Throughput",
      },
    },
  ]);

  const activeScenarioData = scenarios.find((s) => s.id === activeScenario);

  const handleAddScenario = () => {
    if (!newScenarioName.trim()) return;

    const newScenario: Scenario = {
      id: `custom-${Date.now()}`,
      name: newScenarioName,
      description: newScenarioDescription || "Custom configuration",
      icon: Sparkles,
      gradient: selectedGradient,
      pattern: "custom",
      config: {
        bands: ["Auto"],
        mode: "Auto",
        optimization: "Custom",
      },
    };

    setScenarios((prev) => [...prev, newScenario]);
    setActiveScenario(newScenario.id);
    setShowAddDialog(false);
    setNewScenarioName("");
    setNewScenarioDescription("");
    setSelectedGradient(gradientOptions[3].value);
  };

  const handleDeleteScenario = (id: string) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
    // If the deleted scenario was active, switch to the first available scenario
    if (activeScenario === id) {
      const remainingScenarios = scenarios.filter((s) => s.id !== id);
      if (remainingScenarios.length > 0) {
        setActiveScenario(remainingScenarios[0].id);
      }
    }
  };

  const handleOpenEditDialog = () => {
    if (!activeScenarioData) return;
    setEditName(activeScenarioData.name);
    setEditDescription(activeScenarioData.description);
    setEditGradient(activeScenarioData.gradient);
    setEditBands(activeScenarioData.config.bands.join(", "));
    setEditMode(activeScenarioData.config.mode);
    setEditOptimization(activeScenarioData.config.optimization);
    setShowEditDialog(true);
  };

  const handleSaveEdit = () => {
    if (!activeScenarioData || !editName.trim()) return;

    setScenarios((prev) =>
      prev.map((s) =>
        s.id === activeScenarioData.id
          ? {
              ...s,
              name: editName,
              description: editDescription,
              gradient: editGradient,
              config: {
                bands: editBands.split(",").map((b) => b.trim()),
                mode: editMode,
                optimization: editOptimization,
              },
            }
          : s
      )
    );
    setShowEditDialog(false);
  };

  return (
    <div className="grid gap-y-6">
      {/* Row 1: Scenario Profile Cards */}
      <div className="col-span-full grid grid-cols-2 @xl/main:grid-cols-4 gap-4">
        {scenarios.map((scenario) => (
          <ScenarioItem
            key={scenario.id}
            scenario={scenario}
            isActive={activeScenario === scenario.id}
            onActivate={setActiveScenario}
            onDelete={handleDeleteScenario}
          />
        ))}
        <AddScenarioItem onClick={() => setShowAddDialog(true)} />
      </div>

      {/* Row 2: Active Configuration */}
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <ActiveConfigCard scenario={activeScenarioData} onEdit={handleOpenEditDialog} />
      </div>

      {/* Add Scenario Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Connection Scenario</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="scenario-name">Scenario Name</Label>
              <Input
                id="scenario-name"
                value={newScenarioName}
                onChange={(e) => setNewScenarioName(e.target.value)}
                placeholder="e.g., Work from Home"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="scenario-description">Description</Label>
              <Input
                id="scenario-description"
                value={newScenarioDescription}
                onChange={(e) => setNewScenarioDescription(e.target.value)}
                placeholder="e.g., Optimized for video calls"
              />
            </div>

            <div className="space-y-2">
              <Label>Card Theme</Label>
              <div className="grid grid-cols-6 gap-2">
                {gradientOptions.map((grad) => (
                  <button
                    key={grad.id}
                    type="button"
                    onClick={() => setSelectedGradient(grad.value)}
                    className={cn(
                      "h-9 rounded-lg bg-linear-to-br transition-all",
                      grad.value,
                      selectedGradient === grad.value
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                        : "hover:scale-105",
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Preview</Label>
              <div
                className={cn(
                  "relative overflow-hidden rounded-xl h-20 bg-linear-to-br",
                  selectedGradient,
                )}
              >
                <AbstractPattern
                  type="custom"
                  className="absolute inset-0 w-full h-full"
                />
                <div className="relative p-4 text-white">
                  <p className="font-medium">
                    {newScenarioName || "Scenario Name"}
                  </p>
                  <p className="text-sm text-white/70">
                    {newScenarioDescription || "Custom configuration"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleAddScenario}
              disabled={!newScenarioName.trim()}
            >
              Create Scenario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Scenario Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Configuration</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Scenario Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Scenario name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Scenario description"
              />
            </div>

            <div className="space-y-2">
              <Label>Card Theme</Label>
              <div className="grid grid-cols-6 gap-2">
                {gradientOptions.map((grad) => (
                  <button
                    key={grad.id}
                    type="button"
                    onClick={() => setEditGradient(grad.value)}
                    className={cn(
                      "h-9 rounded-lg bg-linear-to-br transition-all",
                      grad.value,
                      editGradient === grad.value
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                        : "hover:scale-105",
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-bands">Band Lock</Label>
              <Input
                id="edit-bands"
                value={editBands}
                onChange={(e) => setEditBands(e.target.value)}
                placeholder="e.g., N41, N78"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-mode">Network Mode</Label>
              <Input
                id="edit-mode"
                value={editMode}
                onChange={(e) => setEditMode(e.target.value)}
                placeholder="e.g., 5G SA Preferred"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-optimization">Optimization</Label>
              <Input
                id="edit-optimization"
                value={editOptimization}
                onChange={(e) => setEditOptimization(e.target.value)}
                placeholder="e.g., Latency"
              />
            </div>

            <div className="space-y-2">
              <Label>Preview</Label>
              <div
                className={cn(
                  "relative overflow-hidden rounded-xl h-20 bg-linear-to-br",
                  editGradient,
                )}
              >
                <AbstractPattern
                  type={activeScenarioData?.pattern || "custom"}
                  className="absolute inset-0 w-full h-full"
                />
                <div className="relative p-4 text-white">
                  <p className="font-medium">{editName || "Scenario Name"}</p>
                  <p className="text-sm text-white/70">
                    {editDescription || "Custom configuration"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSaveEdit} disabled={!editName.trim()}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ConnectionScenariosCard;