import type { CatalogCategory } from "./catalog";
import {
  backfillCatalogId,
  defaultWatts,
  getCatalogEntry,
} from "./catalog";
import type { Circuit, Device, DeviceAttrs, DeviceType } from "./types";

/** Fixture size in image px from catalog trueSize (ft). Fallback 24×48. */
export function fixtureSizePx(
  ftPerPx: number | null,
  catalogId?: string | null
): { w: number; h: number } {
  const entry = catalogId ? getCatalogEntry(catalogId) : undefined;
  const tw = entry?.trueSize?.w ?? 2;
  const th = entry?.trueSize?.h ?? 4;
  if (ftPerPx && ftPerPx > 0) {
    return { w: tw / ftPerPx, h: th / ftPerPx };
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

export function defaultAttrsForCatalog(
  catalogId: string,
  devices: Device[]
): DeviceAttrs {
  const entry = getCatalogEntry(catalogId);
  if (!entry) return { label: "?" };
  if (entry.category === "panel") return { label: nextPanelLabel(devices) };
  if (entry.category === "fixture") {
    return {
      label: "F",
      watts: entry.attrs.watts ?? defaultWatts(catalogId),
      dimming: false,
    };
  }
  if (entry.category === "receptacle") return { label: "R" };
  if (entry.category === "switch") return { label: "S" };
  if (entry.category === "thermostat") return { label: "T" };
  if (entry.category === "fire") return { label: "FA" };
  if (entry.category === "headend") {
    if (entry.id === "head-facp") return { label: "FACP" };
    if (entry.id === "head-idf") return { label: "IDF" };
    if (entry.id === "head-rtu") return { label: "RTU" };
    return { label: entry.label.slice(0, 6) };
  }
  return { label: entry.label.slice(0, 4) };
}

/** @deprecated use defaultAttrsForCatalog */
export function defaultAttrs(
  type: DeviceType,
  devices: Device[]
): DeviceAttrs {
  return defaultAttrsForCatalog(backfillCatalogId(type), devices);
}

export function countByCategory(
  devices: Device[]
): Record<CatalogCategory, number> {
  const out: Record<CatalogCategory, number> = {
    receptacle: 0,
    fixture: 0,
    switch: 0,
    panel: 0,
    thermostat: 0,
    headend: 0,
    fire: 0,
  };
  for (const d of devices) {
    const cat = (d.type || getCatalogEntry(d.catalog_id)?.category) as
      | CatalogCategory
      | undefined;
    if (cat && cat in out) out[cat] += 1;
  }
  return out;
}

/** @deprecated use countByCategory */
export function countByType(devices: Device[]): Record<DeviceType, number> {
  return countByCategory(devices);
}

export function circuitDisplayLabel(
  circuit: Circuit,
  devices: Device[]
): string {
  const panel = devices.find((d) => d.id === circuit.panel_device_id);
  const base = panel?.attrs.label || "LP";
  return `${base}-${circuit.number}`;
}

export function resolveCatalogId(device: Device): string {
  return device.catalog_id || backfillCatalogId(device.type);
}
