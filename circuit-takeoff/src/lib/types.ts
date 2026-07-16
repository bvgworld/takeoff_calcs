export type DeviceType = "panel" | "fixture" | "receptacle" | "switch";
export type CircuitType = "lighting" | "receptacle";
export type BranchMethod = "mc" | "emt";
export type RouteKind = "homerun" | "branch" | "switchleg";

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

export type Point = { x: number; y: number };

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

export type DeviceAttrs = {
  label?: string;
  watts?: number;
};

export type Device = {
  id: string;
  sheet_id: string;
  type: DeviceType;
  x: number;
  y: number;
  attrs: DeviceAttrs;
  circuit_id: string | null;
  created_at: string;
};

export type Circuit = {
  id: string;
  sheet_id: string;
  panel_device_id: string;
  number: number;
  ctype: CircuitType;
  voltage: number;
  breaker_amps: number;
  created_at: string;
};

export type Route = {
  id: string;
  circuit_id: string;
  kind: RouteKind;
  path: Point[];
  plan_length_ft: number;
  user_edited: boolean;
  created_at: string;
};

export type ToolMode =
  | "pan"
  | "calibrate"
  | "stamp-panel"
  | "stamp-fixture"
  | "stamp-receptacle"
  | "stamp-switch"
  | "select"
  | "edit-route";

export type CheckStatus = "pass" | "warn" | "fail";

export type CodeCheck = {
  status: CheckStatus;
  name: string;
  detail: string;
  why: string;
};
