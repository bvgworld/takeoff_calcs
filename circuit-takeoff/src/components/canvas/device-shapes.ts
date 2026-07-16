import type { DeviceType } from "@/lib/types";

export const DEVICE_COLORS: Record<DeviceType, string> = {
  panel: "#141E2C",
  fixture: "#2C64F2",
  receptacle: "#1D7A46",
  switch: "#9A6A00",
};

export const DEVICE_LABELS: Record<DeviceType, string> = {
  panel: "P",
  fixture: "F",
  receptacle: "R",
  switch: "S",
};
