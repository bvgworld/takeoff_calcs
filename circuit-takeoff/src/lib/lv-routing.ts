/**
 * Low-voltage routing + takeoff — pathing and assemblies only.
 * No breaker / VA / VD. Waste % + 1 ft makeup per termination.
 */

import { getCatalogEntry } from "./catalog";
import type { LvSystem } from "./catalog";
import {
  nearestDeviceIndex,
  orthogonalPolyline,
  planLengthFt,
  primMst,
} from "./routing";
import {
  LV_DATA_JACK,
  LV_EMT_STUB,
  LV_EMT_STUB_CONNECTOR,
  LV_FACEPLATE,
  LV_MUD_RING_1G,
  LV_PATCH_PANEL_PORT,
  LV_PULL_STRING,
} from "./takeoff-items";
import type {
  Circuit,
  Device,
  LvRouteSystem,
  Point,
  ProjectSettings,
  Route,
  RouteKind,
} from "./types";

/** Same shape as takeoff TakeoffLine — kept local to avoid circular imports. */
export type LvTakeoffLine = {
  circuit: string;
  item: string;
  qty: number;
  uom: string;
  notes: string;
};
export const LV_MAKEUP_FT = 1;

export const LV_COLORS: Record<"fire" | "data" | "dimming" | "stat", string> = {
  fire: "#BE123C",
  data: "#0F766E",
  dimming: "#7C3AED",
  stat: "#9A6A00",
};

export const LV_DASH: Record<"fire" | "data" | "dimming", number[]> = {
  fire: [6, 4],
  data: [4, 4],
  dimming: [2, 5],
};

export type ProposedLvRoute = {
  kind: RouteKind;
  path: Point[];
  plan_length_ft: number;
  user_edited: boolean;
  lv_system: LvRouteSystem;
  /** For data: which drop device this home run serves. */
  device_id?: string;
};

function wasteMult(settings: ProjectSettings): number {
  return 1 + settings.waste_pct / 100;
}

/** Cable LF = ceil((plan + 1×terminations) × waste). */
export function lvCableLf(
  planFt: number,
  terminations: number,
  settings: ProjectSettings
): number {
  return Math.ceil((planFt + LV_MAKEUP_FT * terminations) * wasteMult(settings));
}

export function deviceLvSystem(d: Device): LvSystem | undefined {
  return getCatalogEntry(d.catalog_id)?.attrs.lvSystem;
}

export function isFireDevice(d: Device): boolean {
  return d.type === "fire" || deviceLvSystem(d) === "fire";
}

export function isDataDrop(d: Device): boolean {
  if (d.type === "headend") return false;
  return deviceLvSystem(d) === "data";
}

export function isThermostat(d: Device): boolean {
  return d.type === "thermostat" || deviceLvSystem(d) === "stat";
}

export function findFacp(devices: Device[]): Device | null {
  return (
    devices.find(
      (d) => d.catalog_id === "head-facp" || (d.type === "headend" && deviceLvSystem(d) === "fire")
    ) ?? null
  );
}

export function findIdfRooms(devices: Device[]): Device[] {
  return devices.filter(
    (d) =>
      d.catalog_id === "head-idf" ||
      (d.type === "headend" && deviceLvSystem(d) === "data")
  );
}

export function findThermostats(devices: Device[]): Device[] {
  return devices.filter(isThermostat);
}

export function findFireDevices(devices: Device[]): Device[] {
  return devices.filter((d) => d.type === "fire");
}

export function findDataDrops(devices: Device[]): Device[] {
  return devices.filter(isDataDrop);
}

/** Lighting circuit carries dimming if it has a 0-10V dimmer or any fixture marked dimming. */
export function circuitNeedsDimming(
  circuit: Circuit,
  devices: Device[]
): boolean {
  if (circuit.ctype !== "lighting") return false;
  const onCkt = devices.filter((d) => d.circuit_id === circuit.id);
  if (
    onCkt.some(
      (d) =>
        d.type === "switch" &&
        getCatalogEntry(d.catalog_id)?.attrs.lvSystem === "dimming"
    )
  ) {
    return true;
  }
  return onCkt.some((d) => d.type === "fixture" && !!d.attrs.dimming);
}

/**
 * Fire: MST daisy over fire devices + single home run from nearest device to FACP.
 * Reuses power branch algorithm; no clustering, no conduit.
 */
export function routeFireSystem(opts: {
  facp: Device;
  fireDevices: Device[];
  ftPerPx: number;
}): ProposedLvRoute[] {
  const { facp, fireDevices, ftPerPx } = opts;
  const D = fireDevices.filter((d) => d.id !== facp.id);
  const routes: ProposedLvRoute[] = [];
  if (D.length === 0) return routes;

  const points = D.map((d) => ({ x: d.x, y: d.y }));
  if (D.length >= 2) {
    for (const [i, j] of primMst(points)) {
      const path = orthogonalPolyline(points[i], points[j]);
      routes.push({
        kind: "branch",
        path,
        plan_length_ft: planLengthFt(path, ftPerPx),
        user_edited: false,
        lv_system: "fire",
      });
    }
  }

  const ei = nearestDeviceIndex({ x: facp.x, y: facp.y }, D);
  const entry = D[ei];
  const hrPath = orthogonalPolyline(
    { x: facp.x, y: facp.y },
    { x: entry.x, y: entry.y }
  );
  routes.push({
    kind: "homerun",
    path: hrPath,
    plan_length_ft: planLengthFt(hrPath, ftPerPx),
    user_edited: false,
    lv_system: "fire",
  });
  return routes;
}

/**
 * Data: every drop gets its own orthogonal home run to the nearest IDF.
 * Never chained (star topology).
 */
export function routeDataSystem(opts: {
  idfs: Device[];
  drops: Device[];
  ftPerPx: number;
}): ProposedLvRoute[] {
  const { idfs, drops, ftPerPx } = opts;
  if (!idfs.length || !drops.length) return [];
  const routes: ProposedLvRoute[] = [];
  for (const drop of drops) {
    const ii = nearestDeviceIndex({ x: drop.x, y: drop.y }, idfs);
    const idf = idfs[ii];
    const path = orthogonalPolyline(
      { x: drop.x, y: drop.y },
      { x: idf.x, y: idf.y }
    );
    routes.push({
      kind: "homerun",
      path,
      plan_length_ft: planLengthFt(path, ftPerPx),
      user_edited: false,
      lv_system: "data",
      device_id: drop.id,
    });
  }
  return routes;
}

export type DimmingFollow = {
  circuitId: string;
  circuitNumber: number;
  /** Verbatim branch + switchleg plan lengths. */
  planFt: number;
  paths: { kind: RouteKind; path: Point[] }[];
  terminations: number;
};

/** Follow power branch + switchleg for dimming circuits — no new geometry. */
export function dimmingFollows(opts: {
  circuits: Circuit[];
  devices: Device[];
  routes: Route[];
}): DimmingFollow[] {
  const { circuits, devices, routes } = opts;
  const out: DimmingFollow[] = [];
  for (const c of circuits) {
    if (!circuitNeedsDimming(c, devices)) continue;
    const cRoutes = routes.filter(
      (r) =>
        r.circuit_id === c.id &&
        (r.kind === "branch" || r.kind === "switchleg")
    );
    const planFt = cRoutes.reduce((s, r) => s + r.plan_length_ft, 0);
    const onCkt = devices.filter((d) => d.circuit_id === c.id);
    const terminations = Math.max(
      onCkt.filter((d) => d.type === "fixture" || d.type === "switch").length,
      2
    );
    out.push({
      circuitId: c.id,
      circuitNumber: c.number,
      planFt,
      paths: cRoutes.map((r) => ({ kind: r.kind, path: r.path })),
      terminations,
    });
  }
  return out;
}

export function dimmingTotalPlanFt(follows: DimmingFollow[]): number {
  return follows.reduce((s, f) => s + f.planFt, 0);
}

export type LvReadyResult =
  | { ok: true }
  | { ok: false; missing: string };

export function fireRouteReady(devices: Device[]): LvReadyResult {
  const fire = findFireDevices(devices);
  const facp = findFacp(devices);
  if (!fire.length && !facp) {
    return { ok: false, missing: "Stamp fire devices and a FACP to route fire" };
  }
  if (!fire.length) {
    return { ok: false, missing: "Stamp fire devices to route fire" };
  }
  if (!facp) {
    return { ok: false, missing: "Stamp a FACP to route fire" };
  }
  return { ok: true };
}

export function dataRouteReady(devices: Device[]): LvReadyResult {
  const drops = findDataDrops(devices);
  const idfs = findIdfRooms(devices);
  if (!drops.length && !idfs.length) {
    return {
      ok: false,
      missing: "Stamp data outlets and an IT room to route data",
    };
  }
  if (!drops.length) {
    return { ok: false, missing: "Stamp data outlets to route data" };
  }
  if (!idfs.length) {
    return { ok: false, missing: "Stamp an IT room to route data" };
  }
  return { ok: true };
}

function push(
  rows: LvTakeoffLine[],
  circuit: string,
  item: string,
  qty: number,
  uom: string,
  notes: string
) {
  if (qty === 0) return;
  rows.push({ circuit, item, qty, uom, notes });
}

/** Thermostat stubs — no routes. */
export function takeoffThermostats(
  devices: Device[],
  settings: ProjectSettings
): LvTakeoffLine[] {
  const stats = findThermostats(devices);
  if (!stats.length) return [];
  const stubFt = settings.lv_stub_ft ?? 10;
  const n = stats.length;
  const totalStub = n * stubFt;
  const waste = wasteMult(settings);
  const rows: LvTakeoffLine[] = [];
  push(rows, "TSTAT", LV_MUD_RING_1G, n, "EA", "Thermostat stubs");
  push(
    rows,
    "TSTAT",
    LV_EMT_STUB,
    Math.ceil(totalStub * waste),
    "LF",
    `${n}×${stubFt}ft ×${waste.toFixed(2)}`
  );
  push(rows, "TSTAT", LV_EMT_STUB_CONNECTOR, n, "EA", "One per stub");
  push(
    rows,
    "TSTAT",
    LV_PULL_STRING,
    Math.ceil(totalStub * waste),
    "LF",
    "Per stub LF"
  );
  // Device hardware from catalog
  for (const d of stats) {
    const entry = getCatalogEntry(d.catalog_id);
    if (!entry) continue;
    for (const line of entry.assembly) {
      push(rows, "TSTAT", line.item, line.qty, line.uom, entry.label);
    }
  }
  return rows;
}

/** Dimming 18/2 follows power branch + switchleg. */
export function takeoffDimming(
  follows: DimmingFollow[],
  settings: ProjectSettings
): LvTakeoffLine[] {
  if (!follows.length) return [];
  const rows: LvTakeoffLine[] = [];
  for (const f of follows) {
    const lf = lvCableLf(f.planFt, f.terminations, settings);
    push(
      rows,
      "DIM",
      "18/2 dimming",
      lf,
      "LF",
      `Ckt ${f.circuitNumber} branch+switchleg=${f.planFt.toFixed(1)}ft`
    );
  }
  return rows;
}

/** Fire MST + HR — 16/2 FPL default. */
export function takeoffFire(opts: {
  devices: Device[];
  routes: Route[];
  settings: ProjectSettings;
  cable?: "16/2 FPL" | "14/2 FPL";
}): LvTakeoffLine[] {
  const { devices, routes, settings, cable = "16/2 FPL" } = opts;
  const fireRoutes = routes.filter((r) => r.lv_system === "fire");
  const fireDevs = findFireDevices(devices);
  const facp = findFacp(devices);
  if (!fireDevs.length && !fireRoutes.length) return [];

  const rows: LvTakeoffLine[] = [];
  const planFt = fireRoutes.reduce((s, r) => s + r.plan_length_ft, 0);
  const terminations = fireDevs.length + (facp ? 1 : 0);
  if (planFt > 0) {
    push(
      rows,
      "FA",
      cable,
      lvCableLf(planFt, terminations, settings),
      "LF",
      `MST+HR plan=${planFt.toFixed(1)}ft · ${terminations} terminations`
    );
  }
  for (const d of fireDevs) {
    const entry = getCatalogEntry(d.catalog_id);
    if (!entry) continue;
    for (const line of entry.assembly) {
      push(rows, "FA", line.item, line.qty, line.uom, entry.label);
    }
  }
  if (facp) {
    const entry = getCatalogEntry(facp.catalog_id);
    if (entry) {
      for (const line of entry.assembly) {
        push(rows, "FA", line.item, line.qty, line.uom, "FACP");
      }
    }
  }
  return rows;
}

/** Data: per-drop cable + stub assembly; never MST total. */
export function takeoffData(opts: {
  devices: Device[];
  routes: Route[];
  settings: ProjectSettings;
  cable?: string;
}): LvTakeoffLine[] {
  const { devices, routes, settings, cable = "Cat6 plenum" } = opts;
  const drops = findDataDrops(devices);
  const idfs = findIdfRooms(devices);
  const dataRoutes = routes.filter((r) => r.lv_system === "data");
  if (!drops.length && !dataRoutes.length) return [];

  const rows: LvTakeoffLine[] = [];
  const stubFt = settings.lv_stub_ft ?? 10;
  const waste = wasteMult(settings);

  // Match routes to drops by order / nearest endpoint when device_id absent
  const used = new Set<string>();
  for (const drop of drops) {
    let route = dataRoutes.find(
      (r) =>
        !used.has(r.id) &&
        r.path.length &&
        Math.hypot(r.path[0].x - drop.x, r.path[0].y - drop.y) < 1.5
    );
    if (!route) {
      route = dataRoutes.find((r) => !used.has(r.id));
    }
    if (route) used.add(route.id);
    const planFt = route?.plan_length_ft ?? 0;
    // 2 terminations: drop + IDF
    if (planFt > 0) {
      push(
        rows,
        "DATA",
        cable,
        lvCableLf(planFt, 2, settings),
        "LF",
        `Drop ${drop.attrs.label || drop.id.slice(0, 6)} · ${planFt.toFixed(1)}ft`
      );
    }
    push(rows, "DATA", LV_MUD_RING_1G, 1, "EA", "Per drop");
    push(
      rows,
      "DATA",
      LV_EMT_STUB,
      Math.ceil(stubFt * waste),
      "LF",
      `${stubFt}ft ×${waste.toFixed(2)}`
    );
    push(rows, "DATA", LV_DATA_JACK, 1, "EA", "Per drop");
    push(rows, "DATA", LV_FACEPLATE, 1, "EA", "Per drop");
    push(rows, "DATA", LV_PATCH_PANEL_PORT, 1, "EA", "Per drop");
  }

  for (const idf of idfs) {
    const entry = getCatalogEntry(idf.catalog_id);
    if (!entry) continue;
    for (const line of entry.assembly) {
      push(rows, "DATA", line.item, line.qty, line.uom, "IDF");
    }
  }
  return rows;
}

/** All LV takeoff sections after power circuits. */
export function buildLvTakeoff(opts: {
  circuits: Circuit[];
  devices: Device[];
  routes: Route[];
  settings: ProjectSettings;
}): LvTakeoffLine[] {
  const { circuits, devices, routes, settings } = opts;
  const follows = dimmingFollows({ circuits, devices, routes });
  return [
    ...takeoffDimming(follows, settings),
    ...takeoffThermostats(devices, settings),
    ...takeoffFire({ devices, routes, settings }),
    ...takeoffData({ devices, routes, settings }),
  ];
}

/** Sum of individual data drop plan lengths (not an MST). */
export function dataDropPlanTotal(routes: Route[]): number {
  return routes
    .filter((r) => r.lv_system === "data")
    .reduce((s, r) => s + r.plan_length_ft, 0);
}

export function firePlanTotal(routes: Route[]): number {
  return routes
    .filter((r) => r.lv_system === "fire")
    .reduce((s, r) => s + r.plan_length_ft, 0);
}

export function isPowerRoute(r: Route): boolean {
  return r.circuit_id != null && !r.lv_system;
}

export function isLvRoute(r: Route): boolean {
  return r.lv_system === "fire" || r.lv_system === "data";
}
