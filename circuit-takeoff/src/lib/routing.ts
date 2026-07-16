import type { Device, Point, ProjectSettings, RouteKind } from "./types";

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Horizontal-then-vertical orthogonal polyline. */
export function orthogonalPolyline(a: Point, b: Point): Point[] {
  if (a.x === b.x || a.y === b.y) return [{ ...a }, { ...b }];
  return [{ ...a }, { x: b.x, y: a.y }, { ...b }];
}

export function polylineLengthPx(path: Point[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return len;
}

export function planLengthFt(path: Point[], ftPerPx: number): number {
  return polylineLengthPx(path) * ftPerPx;
}

/** Prim's MST; returns undirected edges as index pairs into points. */
export function primMst(points: Point[]): [number, number][] {
  const n = points.length;
  if (n < 2) return [];
  const inTree = new Array(n).fill(false);
  const best = new Array(n).fill(Infinity);
  const parent = new Array(n).fill(-1);
  best[0] = 0;
  const edges: [number, number][] = [];

  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && (u === -1 || best[i] < best[u])) u = i;
    }
    if (u === -1) break;
    inTree[u] = true;
    if (parent[u] !== -1) edges.push([parent[u], u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = manhattan(points[u], points[v]);
      if (d < best[v]) {
        best[v] = d;
        parent[v] = u;
      }
    }
  }
  return edges;
}

export function nearestDeviceIndex(from: Point, devices: Device[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < devices.length; i++) {
    const d = manhattan(from, { x: devices[i].x, y: devices[i].y });
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export type ProposedRoute = {
  kind: RouteKind;
  path: Point[];
  plan_length_ft: number;
  user_edited: boolean;
};

export type RouteTotals = {
  homerun: number;
  switchleg: number;
  branch: number;
};

/**
 * routeCircuit — Section 4 exactly.
 * plan_length_ft stores plan only; adders applied via applyLengthAdders.
 */
export function routeCircuit(opts: {
  panel: Device;
  devicesOnCircuit: Device[];
  ctype: "lighting" | "receptacle";
  ftPerPx: number;
}): ProposedRoute[] {
  const { panel, devicesOnCircuit, ctype, ftPerPx } = opts;
  const routes: ProposedRoute[] = [];

  const D = devicesOnCircuit.filter(
    (d) => d.type !== "panel" && d.type !== "switch"
  );
  const S =
    ctype === "lighting"
      ? devicesOnCircuit.find((d) => d.type === "switch") ?? null
      : null;

  if (D.length === 0 && !S) return routes;

  const points = D.map((d) => ({ x: d.x, y: d.y }));

  // 1. BRANCH CHAIN — Prim MST
  if (D.length >= 2) {
    for (const [i, j] of primMst(points)) {
      const path = orthogonalPolyline(points[i], points[j]);
      routes.push({
        kind: "branch",
        path,
        plan_length_ft: planLengthFt(path, ftPerPx),
        user_edited: false,
      });
    }
  }

  // 2. ENTRY + switchleg
  let entry: Device;
  if (ctype === "lighting" && S) {
    entry = S;
    if (D.length > 0) {
      const fi = nearestDeviceIndex({ x: S.x, y: S.y }, D);
      const path = orthogonalPolyline(
        { x: S.x, y: S.y },
        { x: D[fi].x, y: D[fi].y }
      );
      routes.push({
        kind: "switchleg",
        path,
        plan_length_ft: planLengthFt(path, ftPerPx),
        user_edited: false,
      });
    }
  } else if (D.length > 0) {
    const ei = nearestDeviceIndex({ x: panel.x, y: panel.y }, D);
    entry = D[ei];
  } else {
    entry = S!;
  }

  // 3. HOME RUN
  const hrPath = orthogonalPolyline(
    { x: panel.x, y: panel.y },
    { x: entry.x, y: entry.y }
  );
  routes.push({
    kind: "homerun",
    path: hrPath,
    plan_length_ft: planLengthFt(hrPath, ftPerPx),
    user_edited: false,
  });

  return routes;
}

/** Apply Section 4 length adders to plan lengths. */
export function applyLengthAdders(
  routes: { kind: RouteKind; plan_length_ft: number }[],
  settings: ProjectSettings
): RouteTotals {
  let homerun = 0;
  let switchleg = 0;
  let branch = 0;
  for (const r of routes) {
    if (r.kind === "homerun") {
      homerun += r.plan_length_ft + settings.panel_stub_ft;
    } else if (r.kind === "switchleg") {
      switchleg += r.plan_length_ft + settings.switch_drop_ft;
    } else {
      branch += r.plan_length_ft;
    }
  }
  return { homerun, switchleg, branch };
}

/** Keep a bend orthogonal to neighbors after drag. */
export function snapOrthogonalBend(
  path: Point[],
  index: number,
  x: number,
  y: number
): Point[] {
  if (index <= 0 || index >= path.length - 1) return path;
  const next = path.map((p) => ({ ...p }));
  const prev = next[index - 1];
  const nxt = next[index + 1];
  // Prefer matching prev's axis that reduces kink to next
  let nx = x;
  let ny = y;
  if (Math.abs(x - prev.x) < Math.abs(y - prev.y)) {
    nx = prev.x;
    ny = y;
  } else {
    nx = x;
    ny = prev.y;
  }
  // Ensure segment to next is also orthogonal
  if (nx !== nxt.x && ny !== nxt.y) {
    if (nx === prev.x) ny = nxt.y;
    else nx = nxt.x;
  }
  next[index] = { x: nx, y: ny };
  return next;
}

export const CIRCUIT_HUES = [
  "#2C64F2",
  "#1D7A46",
  "#9A6A00",
  "#7C3AED",
  "#0891B2",
  "#BE123C",
  "#CA8A04",
  "#0F766E",
];

export function circuitHue(number: number): string {
  return CIRCUIT_HUES[(number - 1) % CIRCUIT_HUES.length];
}
