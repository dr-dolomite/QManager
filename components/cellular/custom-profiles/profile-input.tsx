"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  FileDownIcon,
  Loader2Icon,
  PlusIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";

import type {
  ProfileFormData,
  UseSimProfilesReturn,
} from "@/hooks/use-sim-profiles";
import type { UseCurrentSettingsReturn } from "@/hooks/use-current-settings";
import { useScenarioList } from "@/hooks/use-scenario-list";
import { useWanProfiles } from "@/hooks/use-wan-profiles";
import type { DayOfWeek } from "@/types/sim-profile";
import {
  MNO_PRESETS,
  MNO_CUSTOM_ID,
  getMnoPreset,
} from "@/constants/mno-presets";

// -----------------------------------------------------------------------------
// Add / Edit profile form — wired to the backend via the shared useSimProfiles.
// -----------------------------------------------------------------------------
// The same card serves create and edit: when the coordinator hands an
// `editingId`, the form loads that profile and flips its title to "Edit
// Profile". Fields are controlled so Submit can emit the flat ProfileFormData
// that save.sh expects (APN keys top-level; the backend nests them into
// settings.apn). The Scenario tab is driven by real scenario ids from
// useScenarioList — the backend validates that scenario refs are known.
const MAX_WINDOWS = 2;

// System EXPO ease-out — the silky settle used across QManager motion.
const EXPO = [0.16, 1, 0.3, 1] as const;

// Wizard tab order — the "Next" button walks the user forward through these.
const TAB_ORDER = ["identity", "network", "scenario", "review"] as const;

// One wizard step. Slides in from the direction of travel (+ forward, - back)
// and fades, on the system EXPO curve. Reduced motion shows it instantly.
const WizardPanel = ({
  dir,
  children,
}: {
  dir: number;
  children: React.ReactNode;
}) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, x: dir * 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: EXPO }}
    >
      {children}
    </motion.div>
  );
};

// Sentinel value for the "+ Create scenario" Select item. Picking it navigates
// to Connection Scenarios with ?create=1, which that page reads post-mount to
// open its New Scenario dialog immediately (and then strips the param).
const CREATE_SCENARIO_VALUE = "__create_scenario__";
const SCENARIOS_CREATE_HREF =
  "/cellular/custom-profiles/connection-scenarios?create=1";

// Synthetic "Custom" value for the APN Profiles select — shown automatically
// when the typed APN matches none of the saved slots. Picking it is a no-op
// (the APN Name field stays the source of truth); it exists so the trigger
// reads "Custom" instead of going blank while the user types a custom APN.
const APN_CUSTOM_VALUE = "__custom__";

interface ScheduleWindow {
  id: number;
  scenario: string;
  start: string;
  end: string;
}

interface ProfileInputProps {
  sim: UseSimProfilesReturn;
  currentSettings: UseCurrentSettingsReturn;
  editingId: string | null;
  onDoneEditing: () => void;
}

// UI PDP token <-> backend PDP token.
const PDP_TO_BACKEND: Record<string, string> = {
  ipv4: "IP",
  ipv6: "IPV6",
  ipv4v6: "IPV4V6",
};
const PDP_FROM_BACKEND: Record<string, string> = {
  IP: "ipv4",
  IPV6: "ipv6",
  IPV4V6: "ipv4v6",
};
const PDP_DISPLAY: Record<string, string> = {
  ipv4: "IPv4",
  ipv6: "IPv6",
  ipv4v6: "IPv4 & IPv6",
};

/** Resolve a stored MNO label back to its preset id for the Select. */
function mnoIdForLabel(label: string): string {
  return MNO_PRESETS.find((p) => p.label === label)?.id ?? MNO_CUSTOM_ID;
}

const ProfileInputComponent = ({
  sim,
  currentSettings,
  editingId,
  onDoneEditing,
}: ProfileInputProps) => {
  const { t } = useTranslation("cellular");
  const router = useRouter();
  const { scenarios, nameForId } = useScenarioList();
  const wan = useWanProfiles();

  const [tab, setTab] = React.useState("identity");
  const [tabDir, setTabDir] = React.useState(1);
  const [submitting, setSubmitting] = React.useState(false);
  const reduceMotion = useReducedMotion();

  // Route every tab change through here so the wizard panel knows which way it
  // travelled (forward from Next / a later tab, back from an earlier tab or an
  // Edit jump on Review). Direction drives the slide-in offset sign.
  const changeTab = React.useCallback(
    (next: string) => {
      setTabDir(
        TAB_ORDER.indexOf(next as (typeof TAB_ORDER)[number]) >=
          TAB_ORDER.indexOf(tab as (typeof TAB_ORDER)[number])
          ? 1
          : -1,
      );
      setTab(next);
    },
    [tab],
  );

  // --- Identity -------------------------------------------------------------
  const [name, setName] = React.useState("");
  const [simIccid, setSimIccid] = React.useState("");
  const [mnoId, setMnoId] = React.useState<string>(MNO_CUSTOM_ID);

  // --- Network --------------------------------------------------------------
  const [apn, setApn] = React.useState("");
  const [pdp, setPdp] = React.useState("ipv4v6");
  const [cid, setCid] = React.useState("1");
  const [imei, setImei] = React.useState("");
  const [ttl, setTtl] = React.useState("");
  const [hl, setHl] = React.useState("");

  // --- Scenario -------------------------------------------------------------
  const [defaultScenario, setDefaultScenario] = React.useState("balanced");
  const [scheduleEnabled, setScheduleEnabled] = React.useState(false);
  const [windows, setWindows] = React.useState<ScheduleWindow[]>([]);
  const nextId = React.useRef(1);

  // --- Verizon brick-guard + Load-from-SIM ----------------------------------
  const [verizonDialogOpen, setVerizonDialogOpen] = React.useState(false);
  const pendingMnoRef = React.useRef<string>(MNO_CUSTOM_ID);
  const [loadingSim, setLoadingSim] = React.useState(false);
  const loadRequestedRef = React.useRef(false);

  const isVerizon = getMnoPreset(mnoId)?.label === "Verizon";
  const atCap = windows.length >= MAX_WINDOWS;
  const isEditing = editingId !== null;
  const isReview = tab === "review";

  // Required fields = everything except Preferred IMEI / TTL / HL. The selects
  // (MNO, IP protocol, CID, default scenario) always carry a value, so only the
  // three free-text identity/network fields can actually be blank.
  const requiredFilled =
    name.trim() !== "" && simIccid.trim() !== "" && apn.trim() !== "";

  // An ICCID may belong to only one profile — a second profile on the same SIM
  // would make activation ambiguous. Block save when the trimmed ICCID collides
  // with another stored profile (ignore the row being edited).
  const trimmedIccid = simIccid.trim();
  const duplicateIccid =
    trimmedIccid !== "" &&
    sim.profiles.some(
      (p) => p.id !== editingId && (p.sim_iccid ?? "").trim() === trimmedIccid,
    );

  const resetForm = React.useCallback(() => {
    setName("");
    setSimIccid("");
    setMnoId(MNO_CUSTOM_ID);
    setApn("");
    setPdp("ipv4v6");
    setCid("1");
    setImei("");
    setTtl("");
    setHl("");
    setDefaultScenario("balanced");
    setScheduleEnabled(false);
    setWindows([]);
    setTab("identity");
  }, []);

  // --- Edit-mode prefill ----------------------------------------------------
  const { getProfile } = sim;
  React.useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    getProfile(editingId).then((p) => {
      if (cancelled || !p) return;
      setName(p.name);
      setSimIccid(p.sim_iccid);
      setMnoId(mnoIdForLabel(p.mno));
      setApn(p.settings.apn.name);
      setCid(String(p.settings.apn.cid));
      setPdp(PDP_FROM_BACKEND[p.settings.apn.pdp_type] ?? "ipv4v6");
      setImei(p.settings.imei);
      setTtl(p.settings.ttl ? String(p.settings.ttl) : "");
      setHl(p.settings.hl ? String(p.settings.hl) : "");
      setDefaultScenario(p.scenario.default);
      setScheduleEnabled(p.scenario.schedule.enabled);
      setWindows(
        p.scenario.schedule.blocks.map((b) => ({
          id: nextId.current++,
          scenario: b.scenario,
          start: b.start,
          end: b.end,
        })),
      );
      setTab("identity");
    });
    return () => {
      cancelled = true;
    };
  }, [editingId, getProfile]);

  // --- Window CRUD ----------------------------------------------------------
  const addWindow = () => {
    if (atCap) return;
    setWindows((prev) => [
      ...prev,
      {
        id: nextId.current++,
        scenario: defaultScenario,
        start: "22:00",
        end: "06:00",
      },
    ]);
  };

  const updateWindow = (id: number, patch: Partial<ScheduleWindow>) =>
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    );

  const removeWindow = (id: number) =>
    setWindows((prev) => prev.filter((w) => w.id !== id));

  // Default-scenario Select: the "+ Create scenario" item is a sentinel — pick
  // it to jump to Connection Scenarios with its New dialog already open, instead
  // of committing it as the selected value.
  const handleDefaultScenarioChange = (value: string) => {
    if (value === CREATE_SCENARIO_VALUE) {
      router.push(SCENARIOS_CREATE_HREF);
      return;
    }
    setDefaultScenario(value);
  };

  // Wizard navigation: advance to the next tab (no-op on the last/Review tab).
  const goNext = () => {
    const idx = TAB_ORDER.indexOf(tab as (typeof TAB_ORDER)[number]);
    if (idx >= 0 && idx < TAB_ORDER.length - 1) changeTab(TAB_ORDER[idx + 1]);
  };

  // --- MNO preset selection (with Verizon guard) ----------------------------
  const applyMno = React.useCallback((id: string) => {
    setMnoId(id);
    const preset = getMnoPreset(id);
    if (preset) {
      setApn(preset.apn_name);
      setTtl(preset.ttl ? String(preset.ttl) : "");
      setHl(preset.hl ? String(preset.hl) : "");
      // Verizon delivers data only on PDP context 3 (MPDN). Lock CID to 3.
      if (preset.label === "Verizon") setCid("3");
    }
  }, []);

  const handleMnoChange = (id: string) => {
    const preset = getMnoPreset(id);
    if (preset?.label === "Verizon") {
      // Gate Verizon behind the brick-warning dialog before committing.
      pendingMnoRef.current = id;
      setVerizonDialogOpen(true);
      return;
    }
    applyMno(id);
  };

  // --- Load from SIM --------------------------------------------------------
  const handleLoadFromSim = () => {
    loadRequestedRef.current = true;
    setLoadingSim(true);
    currentSettings.refresh();
  };

  // Autofill once the requested current_settings query lands. Gated on
  // loadRequestedRef so the coordinator's mount fetch never autofills the form.
  const settings = currentSettings.settings;
  React.useEffect(() => {
    if (!loadRequestedRef.current || !settings) return;
    loadRequestedRef.current = false;
    if (settings.iccid) setSimIccid(settings.iccid);
    if (settings.imei) setImei(settings.imei);
    const active =
      settings.apn_profiles?.find((p) => p.cid === settings.active_cid) ??
      settings.apn_profiles?.[0];
    if (active) {
      if (active.apn) setApn(active.apn);
      setCid(String(active.cid));
      setPdp(PDP_FROM_BACKEND[active.pdp_type] ?? "ipv4v6");
    }
    toast.success(t("custom_profiles.form.loaded_from_sim"));
  }, [settings, t]);

  React.useEffect(() => {
    if (!currentSettings.isLoading) setLoadingSim(false);
  }, [currentSettings.isLoading]);

  // --- APN Profiles picker --------------------------------------------------
  // The named 5-slot APN registry (APN Management) is a third pre-fill source,
  // alongside MNO presets and Load-from-SIM. Only configured slots (non-empty
  // apn) are offered. Picking one copies apn + IP protocol + CID into the
  // editable fields; the PDP token space is identical (ipv4/ipv6/ipv4v6), so no
  // translation is needed here. CID is NOT copied while Verizon is selected —
  // that field is locked to context 3 and we must not fight the brick-guard.
  const savedApnProfiles = React.useMemo(
    () => (wan.profiles ?? []).filter((p) => p.apn.trim() !== ""),
    [wan.profiles],
  );

  // The Select value is DERIVED from the typed APN — no separate state. If the
  // current APN matches a saved slot, that slot is shown selected; otherwise a
  // synthetic "Custom" option is shown (only once the field is non-empty), so
  // the trigger reflects reality as the user types or picks.
  const matchedApnProfile = savedApnProfiles.find((p) => p.apn === apn);
  const apnSelectValue = matchedApnProfile
    ? String(matchedApnProfile.id)
    : apn.trim() !== ""
      ? APN_CUSTOM_VALUE
      : "";

  const handleApnSelect = (value: string) => {
    if (value === APN_CUSTOM_VALUE) return; // display-only; keep typed APN
    const p = savedApnProfiles.find((x) => String(x.id) === value);
    if (!p) return;
    if (p.apn) setApn(p.apn);
    if (p.pdp_type in PDP_DISPLAY) setPdp(p.pdp_type);
    if (!isVerizon) setCid(String(p.cid));
  };

  // --- Submit / Cancel ------------------------------------------------------
  const buildFormData = (): ProfileFormData => ({
    name: name.trim(),
    mno: getMnoPreset(mnoId)?.label ?? "Custom",
    sim_iccid: simIccid.trim(),
    cid: Number(cid) || 1,
    apn_name: apn.trim(),
    pdp_type: PDP_TO_BACKEND[pdp] ?? "IPV4V6",
    imei: imei.trim(),
    ttl: Number(ttl) || 0,
    hl: Number(hl) || 0,
    scenario: {
      default: defaultScenario,
      schedule: {
        enabled: scheduleEnabled,
        blocks: scheduleEnabled
          ? windows.map((w) => ({
              start: w.start,
              end: w.end,
              days: [0, 1, 2, 3, 4, 5, 6] as DayOfWeek[],
              scenario: w.scenario,
            }))
          : [],
      },
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("custom_profiles.form.fields.profile_name_required"));
      changeTab("identity");
      return;
    }
    if (!simIccid.trim()) {
      toast.error(t("custom_profiles.form.fields.sim_iccid_required"));
      changeTab("identity");
      return;
    }
    if (duplicateIccid) {
      toast.error(t("custom_profiles.form.fields.sim_iccid_duplicate"));
      changeTab("identity");
      return;
    }
    if (!apn.trim()) {
      toast.error(t("custom_profiles.form.fields.apn_name_required"));
      changeTab("network");
      return;
    }
    setSubmitting(true);
    const data = buildFormData();
    const ok = isEditing
      ? await sim.updateProfile(editingId, data)
      : (await sim.createProfile(data)) !== null;
    setSubmitting(false);

    if (ok) {
      toast.success(
        isEditing
          ? t("custom_profiles.form.profile_updated")
          : t("custom_profiles.form.profile_added"),
      );
      resetForm();
      onDoneEditing();
    } else {
      toast.error(sim.error || t("custom_profiles.form.save_failed"));
    }
  };

  const handleClear = () => {
    resetForm();
    onDoneEditing();
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>
          {isEditing
            ? t("custom_profiles.form.edit_title")
            : t("custom_profiles.form.add_title")}
        </CardTitle>
        <CardDescription>
          {isEditing
            ? t("custom_profiles.form.edit_description_simple")
            : t("custom_profiles.form.add_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Tabs value={tab} onValueChange={changeTab} className="w-full">
              <TabsList>
                <TabsTrigger value="identity">
                  {t("custom_profiles.form.steps.identity_short")}
                </TabsTrigger>
                <TabsTrigger value="network">
                  {t("custom_profiles.form.tab_network")}
                </TabsTrigger>
                <TabsTrigger value="scenario">
                  {t("custom_profiles.form.steps.scenario_short")}
                </TabsTrigger>
                <TabsTrigger value="review">
                  {t("custom_profiles.form.steps.review_short")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="identity">
               <WizardPanel dir={tabDir}>
                <FieldSet>
                  <div className="flex items-center justify-between">
                    <FieldDescription>
                      {t("custom_profiles.form.sections.identity_desc")}
                    </FieldDescription>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={handleLoadFromSim}
                      disabled={loadingSim}
                    >
                      {loadingSim ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <FileDownIcon />
                      )}
                      {t("custom_profiles.form.load_from_sim")}
                    </Button>
                  </div>
                  <FieldGroup>
                    <Field>
                      <FieldLabel>
                        {t("custom_profiles.form.fields.profile_name_label")}
                      </FieldLabel>
                      <Input
                        placeholder={t(
                          "custom_profiles.form.fields.profile_name_placeholder",
                        )}
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>
                        {t("custom_profiles.form.fields.sim_iccid_label")}
                      </FieldLabel>
                      <Input
                        placeholder={t(
                          "custom_profiles.form.sim_iccid_placeholder_inline",
                        )}
                        value={simIccid}
                        onChange={(e) => setSimIccid(e.target.value)}
                        aria-invalid={duplicateIccid || undefined}
                      />
                      <FieldDescription
                        className={duplicateIccid ? "text-destructive" : undefined}
                      >
                        {duplicateIccid
                          ? t("custom_profiles.form.fields.sim_iccid_duplicate")
                          : t("custom_profiles.form.sim_iccid_hint_inline")}
                      </FieldDescription>
                    </Field>
                    <FieldSeparator />
                    <Field>
                      <FieldLabel>
                        {t("custom_profiles.form.fields.mno_label")}
                      </FieldLabel>
                      <Select value={mnoId} onValueChange={handleMnoChange}>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t(
                              "custom_profiles.form.fields.mno_label",
                            )}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {MNO_PRESETS.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.label}
                              </SelectItem>
                            ))}
                            <SelectItem value={MNO_CUSTOM_ID}>
                              {t("custom_profiles.form.fields.mno_custom")}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        {t("custom_profiles.form.mno_hint")}
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                </FieldSet>
               </WizardPanel>
              </TabsContent>
              <TabsContent value="network">
               <WizardPanel dir={tabDir}>
                <FieldSet>
                  <FieldDescription>
                    {t("custom_profiles.form.network_desc")}
                  </FieldDescription>
                  <FieldGroup>
                    {savedApnProfiles.length > 0 ? (
                      <div className="grid grid-cols-2 gap-4">
                        <Field>
                          <FieldLabel>
                            {t("custom_profiles.form.fields.apn_name_label")}
                          </FieldLabel>
                          <Input
                            placeholder={t(
                              "custom_profiles.form.fields.apn_name_placeholder",
                            )}
                            required
                            value={apn}
                            onChange={(e) => setApn(e.target.value)}
                          />
                        </Field>
                        <Field>
                          <FieldLabel>
                            {t("custom_profiles.form.fields.reuse_apn_label")}
                          </FieldLabel>
                          <Select
                            value={apnSelectValue}
                            onValueChange={handleApnSelect}
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t(
                                  "custom_profiles.form.fields.reuse_apn_placeholder",
                                )}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {apnSelectValue === APN_CUSTOM_VALUE && (
                                  <SelectItem value={APN_CUSTOM_VALUE}>
                                    {t(
                                      "custom_profiles.form.fields.reuse_apn_custom",
                                    )}
                                  </SelectItem>
                                )}
                                {savedApnProfiles.map((p) => (
                                  <SelectItem key={p.id} value={String(p.id)}>
                                    {p.name.trim()
                                      ? `${p.name.trim()} — ${p.apn}`
                                      : p.apn}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                    ) : (
                      <Field>
                        <FieldLabel>
                          {t("custom_profiles.form.fields.apn_name_label")}
                        </FieldLabel>
                        <Input
                          placeholder={t(
                            "custom_profiles.form.fields.apn_name_placeholder",
                          )}
                          required
                          value={apn}
                          onChange={(e) => setApn(e.target.value)}
                        />
                      </Field>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel>
                          {t("custom_profiles.form.fields.ip_protocol_label")}
                        </FieldLabel>
                        <Select value={pdp} onValueChange={setPdp}>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "custom_profiles.form.fields.ip_protocol_label",
                              )}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="ipv4">
                                {t("custom_profiles.form.pdp_inline.ipv4")}
                              </SelectItem>
                              <SelectItem value="ipv6">
                                {t("custom_profiles.form.pdp_inline.ipv6")}
                              </SelectItem>
                              <SelectItem value="ipv4v6">
                                {t("custom_profiles.form.pdp_inline.dual")}
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>

                      <Field>
                        <FieldLabel>
                          {t("custom_profiles.form.fields.cid_label")}
                        </FieldLabel>
                        <Select
                          value={cid}
                          onValueChange={setCid}
                          disabled={isVerizon}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "custom_profiles.form.fields.cid_label",
                              )}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="1">
                                {t("custom_profiles.form.cid_default_option")}
                              </SelectItem>
                              <SelectItem value="2">CID 2</SelectItem>
                              <SelectItem value="3">CID 3</SelectItem>
                              <SelectItem value="4">CID 4</SelectItem>
                              <SelectItem value="5">CID 5</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {isVerizon && (
                          <FieldDescription>
                            {t(
                              "custom_profiles.form.cid_locked_verizon_inline",
                            )}
                          </FieldDescription>
                        )}
                      </Field>
                    </div>
                    <FieldSeparator />
                    <Field>
                      <FieldLabel>
                        {t("custom_profiles.form.fields.imei_label")}
                      </FieldLabel>
                      <Input
                        placeholder={t(
                          "custom_profiles.form.fields.imei_label",
                        )}
                        value={imei}
                        onChange={(e) => setImei(e.target.value)}
                      />
                      <FieldDescription className="text-warning">
                        {t("custom_profiles.form.fields.imei_danger")}
                      </FieldDescription>
                    </Field>

                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel>
                          {t("custom_profiles.form.fields.ttl_label")}
                        </FieldLabel>
                        <Input
                          placeholder={t(
                            "custom_profiles.form.fields.ttl_label",
                          )}
                          inputMode="numeric"
                          value={ttl}
                          onChange={(e) => setTtl(e.target.value)}
                        />
                      </Field>

                      <Field>
                        <FieldLabel>
                          {t("custom_profiles.form.fields.hl_label")}
                        </FieldLabel>
                        <Input
                          placeholder={t(
                            "custom_profiles.form.fields.hl_label",
                          )}
                          inputMode="numeric"
                          value={hl}
                          onChange={(e) => setHl(e.target.value)}
                        />
                      </Field>
                    </div>
                  </FieldGroup>
                </FieldSet>
               </WizardPanel>
              </TabsContent>
              <TabsContent value="scenario">
               <WizardPanel dir={tabDir}>
                <FieldSet>
                  <FieldDescription>
                    {t("custom_profiles.form.scenario_desc_inline")}
                  </FieldDescription>
                  <FieldGroup>
                    {/* Default scenario — the always-on choice, reads first. */}
                    <Field>
                      <FieldLabel htmlFor="default-scenario">
                        {t("custom_profiles.form.default_scenario_label")}
                      </FieldLabel>
                      <Select
                        value={defaultScenario}
                        onValueChange={handleDefaultScenarioChange}
                      >
                        <SelectTrigger id="default-scenario">
                          <SelectValue
                            placeholder={t(
                              "custom_profiles.form.default_scenario_label",
                            )}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {scenarios.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                          <SelectSeparator />
                          <SelectItem value={CREATE_SCENARIO_VALUE}>
                            <PlusIcon className="size-4" />
                            {t("custom_profiles.form.create_scenario_option")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        {t("custom_profiles.form.default_scenario_hint")}
                      </FieldDescription>
                    </Field>

                    {/* Schedule opt-in. */}
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <div className="grid gap-0.5">
                        <Label htmlFor="schedule-enabled">
                          {t("custom_profiles.form.schedule_inline_label")}
                        </Label>
                        <span className="text-muted-foreground text-xs">
                          {t("custom_profiles.form.schedule_inline_hint")}
                        </span>
                      </div>
                      <Switch
                        id="schedule-enabled"
                        checked={scheduleEnabled}
                        onCheckedChange={setScheduleEnabled}
                      />
                    </div>

                    {/* Windows — only when the schedule is on. */}
                    {scheduleEnabled && (
                      <div className="flex flex-col gap-3">
                        {windows.length === 0 ? (
                          <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
                            {t("custom_profiles.form.windows_empty")}
                          </div>
                        ) : (
                          <AnimatePresence initial={false}>
                          {windows.map((w, i) => (
                            <motion.div
                              key={w.id}
                              initial={
                                reduceMotion
                                  ? false
                                  : { opacity: 0, height: 0 }
                              }
                              animate={{ opacity: 1, height: "auto" }}
                              exit={
                                reduceMotion
                                  ? { opacity: 0 }
                                  : { opacity: 0, height: 0 }
                              }
                              transition={
                                reduceMotion
                                  ? { duration: 0 }
                                  : { duration: 0.25, ease: EXPO }
                              }
                              className="overflow-hidden"
                            >
                            <div className="bg-muted/30 rounded-lg border p-3">
                              <div className="mb-3 flex items-center justify-between">
                                <span className="text-sm font-medium">
                                  {t("custom_profiles.form.window_label", {
                                    index: i + 1,
                                  })}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground hover:text-foreground size-7"
                                  onClick={() => removeWindow(w.id)}
                                  aria-label={t(
                                    "custom_profiles.form.window_remove_aria",
                                    { index: i + 1 },
                                  )}
                                >
                                  <XIcon />
                                </Button>
                              </div>
                              <div className="flex flex-col gap-3">
                                <Field>
                                  <FieldLabel htmlFor={`window-scenario-${w.id}`}>
                                    {t(
                                      "custom_profiles.form.scenario.block_scenario_label",
                                    )}
                                  </FieldLabel>
                                  <Select
                                    value={w.scenario}
                                    onValueChange={(v) =>
                                      updateWindow(w.id, { scenario: v })
                                    }
                                  >
                                    <SelectTrigger
                                      id={`window-scenario-${w.id}`}
                                    >
                                      <SelectValue
                                        placeholder={t(
                                          "custom_profiles.form.scenario.block_scenario_label",
                                        )}
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        {scenarios.map((s) => (
                                          <SelectItem key={s.id} value={s.id}>
                                            {s.name}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                </Field>
                                <div className="grid grid-cols-2 gap-3">
                                  <Field>
                                    <FieldLabel htmlFor={`window-start-${w.id}`}>
                                      {t("custom_profiles.form.window_from")}
                                    </FieldLabel>
                                    <Input
                                      id={`window-start-${w.id}`}
                                      type="time"
                                      className="tabular-nums"
                                      value={w.start}
                                      onChange={(e) =>
                                        updateWindow(w.id, {
                                          start: e.target.value,
                                        })
                                      }
                                    />
                                  </Field>
                                  <Field>
                                    <FieldLabel htmlFor={`window-end-${w.id}`}>
                                      {t("custom_profiles.form.window_to")}
                                    </FieldLabel>
                                    <Input
                                      id={`window-end-${w.id}`}
                                      type="time"
                                      className="tabular-nums"
                                      value={w.end}
                                      onChange={(e) =>
                                        updateWindow(w.id, {
                                          end: e.target.value,
                                        })
                                      }
                                    />
                                  </Field>
                                </div>
                              </div>
                            </div>
                            </motion.div>
                          ))}
                          </AnimatePresence>
                        )}

                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {t("custom_profiles.form.windows_count", {
                              count: windows.length,
                              max: MAX_WINDOWS,
                            })}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={addWindow}
                            disabled={atCap}
                          >
                            <PlusIcon />
                            {t("custom_profiles.form.add_window")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </FieldGroup>
                </FieldSet>
               </WizardPanel>
              </TabsContent>
              <TabsContent value="review">
               <WizardPanel dir={tabDir}>
                <FieldSet>
                  <FieldDescription>
                    {isEditing
                      ? t("custom_profiles.form.review_desc_edit")
                      : t("custom_profiles.form.review_desc_add")}
                  </FieldDescription>
                  <div className="flex flex-col gap-5">
                    <SummarySection
                      title={t("custom_profiles.form.review.section_identity")}
                      onEdit={() => changeTab("identity")}
                      rows={[
                        {
                          label: t("custom_profiles.form.review.profile_name"),
                          value: name.trim() || null,
                        },
                        {
                          label: t("custom_profiles.form.review.sim_iccid"),
                          value:
                            simIccid.trim() ||
                            t("custom_profiles.form.review.all_sims"),
                          numeric: simIccid.trim() !== "",
                        },
                        {
                          label: t("custom_profiles.form.review.operator"),
                          value:
                            getMnoPreset(mnoId)?.label ??
                            t("custom_profiles.form.fields.mno_custom"),
                        },
                      ]}
                    />
                    <SummarySection
                      title={t("custom_profiles.form.review.section_network")}
                      onEdit={() => changeTab("network")}
                      rows={[
                        {
                          label: t("custom_profiles.form.review.apn"),
                          value: apn.trim() || null,
                        },
                        {
                          label: t("custom_profiles.form.review.ip_protocol"),
                          value: PDP_DISPLAY[pdp] ?? pdp,
                        },
                        {
                          label: t("custom_profiles.form.review.profile_slot"),
                          value:
                            cid === "1"
                              ? t(
                                  "custom_profiles.form.review.cid_value_default",
                                  { cid },
                                )
                              : t("custom_profiles.form.review.cid_value", {
                                  cid,
                                }),
                          numeric: true,
                        },
                        {
                          label: t(
                            "custom_profiles.form.review.preferred_imei",
                          ),
                          value: imei.trim() || null,
                        },
                        {
                          label: t("custom_profiles.form.review.ttl_hl"),
                          value:
                            ttl.trim() || hl.trim()
                              ? `${ttl.trim() || "—"} / ${hl.trim() || "—"}`
                              : null,
                          numeric: true,
                        },
                      ]}
                    />
                    <SummarySection
                      title={t("custom_profiles.form.review.section_scenario")}
                      onEdit={() => changeTab("scenario")}
                      rows={[
                        {
                          label: t("custom_profiles.form.review.default"),
                          value: nameForId(defaultScenario),
                        },
                        ...(scheduleEnabled
                          ? windows.length === 0
                            ? [
                                {
                                  label: t(
                                    "custom_profiles.form.review.schedule",
                                  ),
                                  value: t(
                                    "custom_profiles.form.review.schedule_on_no_windows",
                                  ),
                                },
                              ]
                            : windows.map((w, i) => ({
                                label: t(
                                  "custom_profiles.form.window_label",
                                  { index: i + 1 },
                                ),
                                value: t(
                                  "custom_profiles.form.review.window_value",
                                  {
                                    scenario: nameForId(w.scenario),
                                    start: w.start,
                                    end: w.end,
                                  },
                                ),
                                numeric: true,
                              }))
                          : [
                              {
                                label: t(
                                  "custom_profiles.form.review.schedule",
                                ),
                                value: t(
                                  "custom_profiles.form.review.schedule_off",
                                ),
                              },
                            ]),
                      ]}
                    />
                  </div>
                </FieldSet>
               </WizardPanel>
              </TabsContent>
            </Tabs>
            <FieldSeparator />
            <Field orientation="horizontal">
              {/*
                Distinct keys are LOAD-BEARING, not cosmetic. Without them React
                reconciles these two buttons by position and reuses the same
                <button> DOM node, mutating its `type` from "button" to "submit"
                in place. Because React 18 flushes the "Next" click synchronously,
                that mutation lands BEFORE the browser performs the click's
                default action — so the browser sees a submit button and submits
                the form, silently saving the profile on every Next→Review step.
                Separate keys force a remount: the clicked node stays type="button"
                for its whole life, so no stray submit fires.
              */}
              {isReview ? (
                <Button
                  key="profile-submit"
                  type="submit"
                  disabled={submitting || !requiredFilled || duplicateIccid}
                >
                  {submitting && <Loader2Icon className="animate-spin" />}
                  {isEditing
                    ? t("custom_profiles.form.submit_edit")
                    : t("custom_profiles.form.submit_add")}
                </Button>
              ) : (
                <Button key="profile-next" type="button" onClick={goNext}>
                  {t("custom_profiles.form.next")}
                </Button>
              )}
              <Button variant="outline" type="button" onClick={handleClear}>
                {t("custom_profiles.form.clear")}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>

      {/* Verizon brick-guard — selecting Verizon warns before committing. */}
      <AlertDialog open={verizonDialogOpen} onOpenChange={setVerizonDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("custom_profiles.form.verizon_inline.dialog_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("custom_profiles.form.verizon_inline.dialog_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("custom_profiles.form.verizon_inline.dialog_cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => applyMno(pendingMnoRef.current)}>
              {t("custom_profiles.form.verizon_inline.dialog_confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

// -----------------------------------------------------------------------------
// Review-tab building blocks (presentational summary bound to live form state).
// -----------------------------------------------------------------------------
interface SummaryRow {
  label: string;
  value: string | null;
  numeric?: boolean;
}

const SummarySection = ({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: SummaryRow[];
  onEdit: () => void;
}) => {
  const { t } = useTranslation("cellular");
  return (
  <section>
    <div className="mb-1 flex items-center justify-between">
      <h3 className="text-sm font-semibold">{title}</h3>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2"
        onClick={onEdit}
      >
        <SquarePenIcon className="size-3.5" />
        {t("custom_profiles.form.review_edit_aria")}
      </Button>
    </div>
    <dl className="divide-border divide-y">
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 py-2 text-sm"
        >
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd
            className={
              row.value === null
                ? "text-muted-foreground/60"
                : row.numeric
                  ? "text-right font-medium tabular-nums"
                  : "text-right font-medium"
            }
          >
            {row.value ?? t("custom_profiles.form.review.not_set")}
          </dd>
        </div>
      ))}
    </dl>
  </section>
  );
};

export default ProfileInputComponent;
