"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { withWriteTimeout } from "@/lib/write-guard";
import type { BranchMethod, ProjectSettings } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export function ProjectSettingsForm({
  projectId,
  settings: initial,
}: {
  projectId: string;
  settings: ProjectSettings;
}) {
  const router = useRouter();
  const { showError } = useToast();
  const [s, setS] = useState<ProjectSettings>({
    ...DEFAULT_SETTINGS,
    ...initial,
  });
  const [busy, setBusy] = useState(false);

  function num(key: keyof ProjectSettings, v: string) {
    setS((prev) => ({ ...prev, [key]: Number(v) }));
  }

  async function saveSettings() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await withWriteTimeout(() =>
      supabase.from("projects").update({ settings: s }).eq("id", projectId)
    );
    setBusy(false);
    if (error) showError(error.message, () => void saveSettings());
    else router.refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await saveSettings();
  }

  const field = (
    label: string,
    key: keyof ProjectSettings,
    step = "1"
  ) => (
    <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
      {label}
      <input
        type="number"
        step={step}
        value={s[key] as number}
        onChange={(e) => num(key, e.target.value)}
        className="mt-1 w-full rounded-md border border-perry-silver px-2 py-1.5 text-sm font-normal normal-case"
      />
    </label>
  );

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-perry-silver bg-white p-4"
    >
      {field("Ceiling height (ft)", "ceiling_height_ft")}
      {field("Panel stub (ft)", "panel_stub_ft")}
      {field("Switch drop (ft)", "switch_drop_ft")}
      {field("Makeup per box (ft)", "makeup_per_box_ft")}
      {field("Waste %", "waste_pct")}
      {field("LV stub (ft)", "lv_stub_ft")}
      {field("Lighting voltage", "lighting_voltage")}
      {field("Receptacle voltage", "receptacle_voltage")}
      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
        Branch method
        <select
          value={s.branch_method}
          onChange={(e) =>
            setS((prev) => ({
              ...prev,
              branch_method: e.target.value as BranchMethod,
            }))
          }
          className="mt-1 w-full rounded-md border border-perry-silver px-2 py-1.5 text-sm font-normal normal-case"
        >
          <option value="mc">MC allowed</option>
          <option value="emt">Full EMT</option>
        </select>
      </label>
      <Button type="submit" disabled={busy} className="w-full">
        Save settings
      </Button>
    </form>
  );
}
