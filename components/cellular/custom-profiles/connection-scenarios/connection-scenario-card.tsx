"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AbstractPattern } from "./abstract-pattern";
import { AddScenarioItem } from "./add-scenario-item";
import { ActiveConfigCard } from "./active-config-card";
import { ScenarioItem, Scenario } from "./scenario-item";
import { useConnectionScenarios } from "@/hooks/use-connection-scenarios";
import {
  NETWORK_MODE_OPTIONS,
  inputToBands,
  bandsToInput,
} from "@/types/connection-scenario";

// =============================================================================
// Constants
// =============================================================================

const gradientOptions = [
  { id: "purple", value: "from-violet-600 via-purple-600 to-indigo-700" },
  { id: "rose", value: "from-rose-500 via-pink-500 to-orange-400" },
  { id: "teal", value: "from-emerald-500 via-teal-500 to-cyan-500" },
  { id: "blue", value: "from-blue-500 via-indigo-500 to-purple-600" },
  { id: "amber", value: "from-amber-500 via-orange-500 to-red-500" },
  { id: "slate", value: "from-slate-600 via-gray-700 to-zinc-800" },
  { id: "sky", value: "from-sky-400 via-blue-500 to-indigo-500" },
  { id: "lime", value: "from-lime-400 via-green-500 to-emerald-600" },
  { id: "fuchsia", value: "from-fuchsia-500 via-pink-600 to-rose-600" },
  { id: "gold", value: "from-yellow-400 via-amber-500 to-orange-600" },
  { id: "ocean", value: "from-cyan-500 via-blue-600 to-indigo-800" },
  { id: "sunset", value: "from-orange-400 via-red-500 to-pink-600" },
];

// =============================================================================
// Main Component
// =============================================================================

const ConnectionScenariosCard = () => {
  const { t } = useTranslation("cellular");

  // ---------------------------------------------------------------------------
  // Translated default scenarios (built-in, icons are UI-only)
  // ---------------------------------------------------------------------------
  const defaultScenarios = useMemo<Scenario[]>(
    () => [
      {
        id: "balanced",
        name: t("scenarios.default_balanced_name"),
        description: t("scenarios.default_balanced_description"),
        icon: Zap,
        gradient: "from-emerald-500 via-teal-500 to-cyan-500",
        pattern: "balanced",
        isDefault: true,
        config: {
          atModeValue: "AUTO",
          mode: t("scenarios.mode_option_auto"),
          optimization: t("scenarios.default_balanced_name"),
          lte_bands: "",
          nsa_nr_bands: "",
          sa_nr_bands: "",
        },
      },
      {
        id: "gaming",
        name: t("scenarios.default_gaming_name"),
        description: t("scenarios.default_gaming_description"),
        icon: Gamepad2,
        gradient: "from-violet-600 via-purple-600 to-indigo-700",
        pattern: "gaming",
        isDefault: true,
        config: {
          atModeValue: "NR5G",
          mode: t("scenarios.mode_option_nrsa"),
          optimization: t("scenarios.default_gaming_optimization"),
          lte_bands: "",
          nsa_nr_bands: "",
          sa_nr_bands: "",
        },
      },
      {
        id: "streaming",
        name: t("scenarios.default_streaming_name"),
        description: t("scenarios.default_streaming_description"),
        icon: Play,
        gradient: "from-rose-500 via-pink-500 to-orange-400",
        pattern: "streaming",
        isDefault: true,
        config: {
          atModeValue: "LTE:NR5G",
          mode: t("scenarios.mode_option_nrsa_nsa"),
          optimization: t("scenarios.default_streaming_optimization"),
          lte_bands: "",
          nsa_nr_bands: "",
          sa_nr_bands: "",
        },
      },
    ],
    [t],
  );

  // ---------------------------------------------------------------------------
  // Translated network mode options
  // ---------------------------------------------------------------------------
  const networkModeOptions = useMemo(
    () => [
      { value: "AUTO", label: t("scenarios.mode_option_auto") },
      { value: "LTE", label: t("scenarios.mode_option_lte") },
      { value: "NR5G", label: t("scenarios.mode_option_nrsa") },
      { value: "LTE:NR5G", label: t("scenarios.mode_option_nrsa_nsa") },
    ],
    [t],
  );

  const modeValueToLabel = useCallback(
    (value: string) => {
      return networkModeOptions.find((o) => o.value === value)?.label ?? value;
    },
    [networkModeOptions],
  );

  const {
    activeScenarioId,
    customScenarios: storedScenarios,
    isLoading,
    isActivating,
    activateScenario,
    saveCustomScenario,
    deleteCustomScenario,
  } = useConnectionScenarios();

  // Convert backend StoredScenario[] → UI Scenario[] (add icon, pattern, isDefault)
  const customScenarios: Scenario[] = useMemo(
    () =>
      storedScenarios.map((s) => ({
        ...s,
        icon: Sparkles,
        pattern: "custom" as const,
        isDefault: false,
      })),
    [storedScenarios],
  );

  // --- Selection state (view config without activating) ----------------------
  const [selectedId, setSelectedId] = useState<string>(activeScenarioId);

  // Sync selection to active when active changes (e.g., on initial load)
  useEffect(() => {
    setSelectedId(activeScenarioId);
  }, [activeScenarioId]);

  // --- Dialog state ----------------------------------------------------------
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  // Add form state
  const [addName, setAddName] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addGradient, setAddGradient] = useState(gradientOptions[3].value);
  const [addMode, setAddMode] = useState("AUTO");
  const [addLteBands, setAddLteBands] = useState("");
  const [addNsaNrBands, setAddNsaNrBands] = useState("");
  const [addSaNrBands, setAddSaNrBands] = useState("");

  // Edit form state
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editGradient, setEditGradient] = useState("");
  const [editMode, setEditMode] = useState("AUTO");
  const [editOptimization, setEditOptimization] = useState("");
  const [editLteBands, setEditLteBands] = useState("");
  const [editNsaNrBands, setEditNsaNrBands] = useState("");
  const [editSaNrBands, setEditSaNrBands] = useState("");

  // --- Derived ---------------------------------------------------------------
  const scenarios = useMemo(
    () => [...defaultScenarios, ...customScenarios],
    [defaultScenarios, customScenarios],
  );
  const selectedScenario = scenarios.find((s) => s.id === selectedId);
  const isSelectedActive = selectedId === activeScenarioId;

  // Fall back to first default if selected scenario isn't found
  // (e.g., active custom scenario ID from backend doesn't match any local scenario)
  useEffect(() => {
    if (!isLoading && selectedId && !scenarios.find((s) => s.id === selectedId)) {
      setSelectedId(defaultScenarios[0].id);
    }
  }, [isLoading, selectedId, scenarios, defaultScenarios]);

  // ---------------------------------------------------------------------------
  // Handle selection (click card = view config)
  // ---------------------------------------------------------------------------
  const handleSelect = (id: string) => {
    setSelectedId(id);
  };

  // ---------------------------------------------------------------------------
  // Handle activation (explicit button press)
  // ---------------------------------------------------------------------------
  const handleActivate = useCallback(async () => {
    if (!selectedScenario || isActivating) return;
    if (selectedId === activeScenarioId) return;

    const success = await activateScenario(selectedId, selectedScenario.config);

    if (success) {
      toast.success(
        t("scenarios.activation_toast.success", { name: selectedScenario.name }),
      );
    } else {
      toast.error(
        t("scenarios.activation_toast.error", { name: selectedScenario.name }),
      );
    }
  }, [
    selectedScenario,
    selectedId,
    activeScenarioId,
    isActivating,
    activateScenario,
    t,
  ]);

  // ---------------------------------------------------------------------------
  // Add custom scenario
  // ---------------------------------------------------------------------------
  const [isSaving, setIsSaving] = useState(false);

  const handleAddScenario = async () => {
    if (!addName.trim() || isSaving) return;

    setIsSaving(true);
    const scenarioData = {
      name: addName,
      description: addDescription || t("scenarios.add_dialog.fields.preview_placeholder"),
      gradient: addGradient,
      config: {
        atModeValue: addMode,
        mode: modeValueToLabel(addMode),
        optimization: t("scenarios.default_custom_optimization"),
        lte_bands: inputToBands(addLteBands),
        nsa_nr_bands: inputToBands(addNsaNrBands),
        sa_nr_bands: inputToBands(addSaNrBands),
      },
    };

    const newId = await saveCustomScenario(scenarioData);
    setIsSaving(false);

    if (newId) {
      setSelectedId(newId);
      setShowAddDialog(false);
      resetAddForm();
      toast.success(t("scenarios.add_dialog.toast.success"));
    } else {
      toast.error(t("scenarios.add_dialog.toast.error"));
    }
  };

  const resetAddForm = () => {
    setAddName("");
    setAddDescription("");
    setAddGradient(gradientOptions[3].value);
    setAddMode("AUTO");
    setAddLteBands("");
    setAddNsaNrBands("");
    setAddSaNrBands("");
  };

  // ---------------------------------------------------------------------------
  // Delete custom scenario
  // ---------------------------------------------------------------------------
  const handleDeleteScenario = async (id: string) => {
    const success = await deleteCustomScenario(id);
    if (success) {
      // If the deleted scenario was selected, fall back to active or default
      if (selectedId === id) {
        setSelectedId(
          activeScenarioId === id ? defaultScenarios[0].id : activeScenarioId,
        );
      }
      toast.success(t("scenarios.deletion_toast.success"));
    } else {
      toast.error(t("scenarios.deletion_toast.error"));
    }
  };

  // ---------------------------------------------------------------------------
  // Edit custom scenario
  // ---------------------------------------------------------------------------
  const handleOpenEditDialog = () => {
    if (!selectedScenario || selectedScenario.isDefault) return;

    setEditId(selectedScenario.id);
    setEditName(selectedScenario.name);
    setEditDescription(selectedScenario.description);
    setEditGradient(selectedScenario.gradient);
    setEditMode(selectedScenario.config.atModeValue);
    setEditOptimization(selectedScenario.config.optimization);
    setEditLteBands(bandsToInput(selectedScenario.config.lte_bands));
    setEditNsaNrBands(bandsToInput(selectedScenario.config.nsa_nr_bands));
    setEditSaNrBands(bandsToInput(selectedScenario.config.sa_nr_bands));
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim() || isSaving) return;

    setIsSaving(true);
    const updatedId = await saveCustomScenario({
      id: editId,
      name: editName,
      description: editDescription,
      gradient: editGradient,
      config: {
        atModeValue: editMode,
        mode: modeValueToLabel(editMode),
        optimization: editOptimization,
        lte_bands: inputToBands(editLteBands),
        nsa_nr_bands: inputToBands(editNsaNrBands),
        sa_nr_bands: inputToBands(editSaNrBands),
      },
    });
    setIsSaving(false);

    if (updatedId) {
      setShowEditDialog(false);
      toast.success(t("scenarios.edit_dialog.toast.success"));
    } else {
      toast.error(t("scenarios.edit_dialog.toast.error"));
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="grid gap-y-6">
      {/* Row 1: Scenario Profile Cards */}
      <div className="col-span-full grid grid-cols-2 @3xl/main:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="rounded-xl h-36" />
            ))}
            <Skeleton className="rounded-xl h-36 opacity-50" />
          </>
        ) : (
          <>
            <motion.div
              className="contents"
              initial="hidden"
              animate="visible"
              variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
            >
              {scenarios.map((scenario) => (
                <motion.div
                  key={scenario.id}
                  variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <ScenarioItem
                    scenario={scenario}
                    isActive={activeScenarioId === scenario.id}
                    isSelected={selectedId === scenario.id}
                    onSelect={handleSelect}
                    onDelete={handleDeleteScenario}
                  />
                </motion.div>
              ))}
            </motion.div>
            <AddScenarioItem onClick={() => setShowAddDialog(true)} />
          </>
        )}
      </div>

      {/* Row 2: Selected Scenario Configuration */}
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row">
        {isLoading ? (
          <Card className="@container/card">
            <CardContent className="px-6">
              <div className="flex items-center gap-3 mb-5">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div className="grid gap-1.5">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </div>
              <div className="grid gap-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <React.Fragment key={i}>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                  </React.Fragment>
                ))}
                <Separator />
              </div>
            </CardContent>
          </Card>
        ) : (
          <ActiveConfigCard
            scenario={selectedScenario}
            isActive={isSelectedActive}
            isActivating={isActivating}
            onEdit={handleOpenEditDialog}
            onActivate={handleActivate}
          />
        )}
      </div>

      {/* ===== Add Scenario Dialog ===== */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("scenarios.add_dialog.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="add-name">
                {t("scenarios.add_dialog.fields.name_label")}
              </Label>
              <Input
                id="add-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder={t("scenarios.add_dialog.fields.name_placeholder")}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="add-description">
                {t("scenarios.add_dialog.fields.description_label")}
              </Label>
              <Input
                id="add-description"
                value={addDescription}
                onChange={(e) => setAddDescription(e.target.value)}
                placeholder={t("scenarios.add_dialog.fields.description_placeholder")}
              />
            </div>

            {/* Network Mode */}
            <div className="space-y-2">
              <Label>{t("scenarios.add_dialog.fields.network_mode_label")}</Label>
              <Select value={addMode} onValueChange={setAddMode}>
                <SelectTrigger
                  aria-label={t("scenarios.add_dialog.fields.network_mode_aria")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {networkModeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Band Locks */}
            <div className="space-y-2">
              <Label htmlFor="add-lte-bands">
                {t("scenarios.add_dialog.fields.lte_bands_label")}
              </Label>
              <Input
                id="add-lte-bands"
                value={addLteBands}
                onChange={(e) => setAddLteBands(e.target.value)}
                placeholder={t("scenarios.add_dialog.fields.lte_bands_placeholder")}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-sa-bands">
                  {t("scenarios.add_dialog.fields.sa_bands_label")}
                </Label>
                <Input
                  id="add-sa-bands"
                  value={addSaNrBands}
                  onChange={(e) => setAddSaNrBands(e.target.value)}
                  placeholder={t("scenarios.add_dialog.fields.sa_bands_placeholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-nsa-bands">
                  {t("scenarios.add_dialog.fields.nsa_bands_label")}
                </Label>
                <Input
                  id="add-nsa-bands"
                  value={addNsaNrBands}
                  onChange={(e) => setAddNsaNrBands(e.target.value)}
                  placeholder={t("scenarios.add_dialog.fields.nsa_bands_placeholder")}
                />
              </div>
            </div>

            {/* Card Theme */}
            <div className="space-y-2">
              <Label>{t("scenarios.add_dialog.fields.theme_label")}</Label>
              <div className="grid grid-cols-6 gap-2">
                {gradientOptions.map((grad) => (
                  <button
                    key={grad.id}
                    type="button"
                    onClick={() => setAddGradient(grad.value)}
                    className={cn(
                      "h-9 rounded-lg bg-linear-to-br transition-all",
                      grad.value,
                      addGradient === grad.value
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                        : "hover:scale-105",
                    )}
                  />
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <Label>{t("scenarios.add_dialog.fields.preview_label")}</Label>
              <div
                className={cn(
                  "relative overflow-hidden rounded-xl h-20 bg-linear-to-br",
                  addGradient,
                )}
              >
                <AbstractPattern
                  type="custom"
                  className="absolute inset-0 w-full h-full"
                />
                <div className="relative p-4 text-white">
                  <p className="font-medium">
                    {addName || t("scenarios.add_dialog.fields.name_label")}
                  </p>
                  <p className="text-sm text-white/70">
                    {addDescription ||
                      t("scenarios.add_dialog.fields.preview_placeholder")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t("actions.cancel", { ns: "common" })}</Button>
            </DialogClose>
            <Button
              onClick={handleAddScenario}
              disabled={!addName.trim() || isSaving}
            >
              {isSaving
                ? t("scenarios.add_dialog.buttons.creating")
                : t("scenarios.add_dialog.buttons.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Edit Scenario Dialog ===== */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("scenarios.edit_dialog.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="edit-name">
                {t("scenarios.edit_dialog.fields.name_label")}
              </Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t("scenarios.edit_dialog.fields.name_placeholder")}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="edit-description">
                {t("scenarios.edit_dialog.fields.description_label")}
              </Label>
              <Input
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder={t("scenarios.edit_dialog.fields.description_placeholder")}
              />
            </div>

            {/* Network Mode */}
            <div className="space-y-2">
              <Label>{t("scenarios.edit_dialog.fields.network_mode_label")}</Label>
              <Select value={editMode} onValueChange={setEditMode}>
                <SelectTrigger
                  aria-label={t("scenarios.edit_dialog.fields.network_mode_aria")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {networkModeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Optimization */}
            <div className="space-y-2">
              <Label htmlFor="edit-optimization">
                {t("scenarios.edit_dialog.fields.optimization_label")}
              </Label>
              <Input
                id="edit-optimization"
                value={editOptimization}
                onChange={(e) => setEditOptimization(e.target.value)}
                placeholder={t(
                  "scenarios.edit_dialog.fields.optimization_placeholder",
                )}
              />
            </div>

            {/* Band Locks */}
            <div className="space-y-2">
              <Label htmlFor="edit-lte-bands">
                {t("scenarios.edit_dialog.fields.lte_bands_label")}
              </Label>
              <Input
                id="edit-lte-bands"
                value={editLteBands}
                onChange={(e) => setEditLteBands(e.target.value)}
                placeholder={t("scenarios.edit_dialog.fields.lte_bands_placeholder")}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-sa-bands">
                  {t("scenarios.edit_dialog.fields.sa_bands_label")}
                </Label>
                <Input
                  id="edit-sa-bands"
                  value={editSaNrBands}
                  onChange={(e) => setEditSaNrBands(e.target.value)}
                  placeholder={t("scenarios.edit_dialog.fields.sa_bands_placeholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-nsa-bands">
                  {t("scenarios.edit_dialog.fields.nsa_bands_label")}
                </Label>
                <Input
                  id="edit-nsa-bands"
                  value={editNsaNrBands}
                  onChange={(e) => setEditNsaNrBands(e.target.value)}
                  placeholder={t("scenarios.edit_dialog.fields.nsa_bands_placeholder")}
                />
              </div>
            </div>

            {/* Card Theme */}
            <div className="space-y-2">
              <Label>{t("scenarios.edit_dialog.fields.theme_label")}</Label>
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

            {/* Preview */}
            <div className="space-y-2">
              <Label>{t("scenarios.edit_dialog.fields.preview_label")}</Label>
              <div
                className={cn(
                  "relative overflow-hidden rounded-xl h-20 bg-linear-to-br",
                  editGradient,
                )}
              >
                <AbstractPattern
                  type="custom"
                  className="absolute inset-0 w-full h-full"
                />
                <div className="relative p-4 text-white">
                  <p className="font-medium">
                    {editName || t("scenarios.edit_dialog.fields.name_label")}
                  </p>
                  <p className="text-sm text-white/70">
                    {editDescription ||
                      t("scenarios.edit_dialog.fields.preview_placeholder")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t("actions.cancel", { ns: "common" })}</Button>
            </DialogClose>
            <Button
              onClick={handleSaveEdit}
              disabled={!editName.trim() || isSaving}
            >
              {isSaving
                ? t("scenarios.edit_dialog.buttons.saving")
                : t("scenarios.edit_dialog.buttons.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ConnectionScenariosCard;
