export type BranchMethod = "mc" | "emt";

export type ProjectSettings = {
  ceiling_height_ft: number;
  panel_stub_ft: number;
  switch_drop_ft: number;
  makeup_per_box_ft: number;
  waste_pct: number;
  branch_method: BranchMethod;
  lighting_voltage: number;
  receptacle_voltage: number;
};

export const DEFAULT_SETTINGS: ProjectSettings = {
  ceiling_height_ft: 10,
  panel_stub_ft: 10,
  switch_drop_ft: 10,
  makeup_per_box_ft: 2,
  waste_pct: 10,
  branch_method: "mc",
  lighting_voltage: 277,
  receptacle_voltage: 120,
};

export type Project = {
  id: string;
  user_id: string;
  name: string;
  settings: ProjectSettings;
  created_at: string;
};

export type Sheet = {
  id: string;
  project_id: string;
  name: string;
  pdf_path: string;
  image_path: string;
  image_w: number;
  image_h: number;
  ft_per_px: number | null;
  created_at: string;
};
