import type { Device, DeviceAttrs, DeviceType } from "./types";

/** 2×4 fixture size in image px. Fallback 24×48 pre-calibration. */
export function fixtureSizePx(ftPerPx: number | null): { w: number; h: number } {
  if (ftPerPx && ftPerPx > 0) {
    return { w: 2 / ftPerPx, h: 4 / ftPerPx };
  }
  return { w: 24, h: 48 };
}

export function nextPanelLabel(devices: Device[]): string {
  let max = 0;
  for (const d of devices) {
    if (d.type !== "panel") continue;
    const m = (d.attrs.label || "").match(/^LP-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `LP-${max + 1}`;
}

export function defaultAttrs(
  type: DeviceType,
  devices: Device[]
): DeviceAttrs {
  if (type === "panel") return { label: nextPanelLabel(devices) };
  if (type === "fixture") return { label: "F", watts: 36 };
  if (type === "receptacle") return { label: "R" };
  return { label: "S" };
}

export function countByType(devices: Device[]): Record<DeviceType, number> {
  return {
    panel: devices.filter((d) => d.type === "panel").length,
    fixture: devices.filter((d) => d.type === "fixture").length,
    receptacle: devices.filter((d) => d.type === "receptacle").length,
    switch: devices.filter((d) => d.type === "switch").length,
  };
}
