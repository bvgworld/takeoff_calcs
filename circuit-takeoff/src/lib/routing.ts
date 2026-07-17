import type { Device, Point, ProjectSettings, Route, RouteKind } from "./types";

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

export function nearPoint(a: Point, b: Point, eps = 0.75): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

/**
 * Move a route endpoint and rebuild the adjacent orthogonal bend so the
 * remainder of the polyline (user edits) stays put.
 */
export function moveRouteEndpoint(
  path: Point[],
  end: "start" | "end",
  newPos: Point
): Point[] {
  if (path.length === 0) return [{ ...newPos }];
  if (path.length === 1) return [{ ...newPos }];

  if (end === "start") {
    if (path.length === 2) return orthogonalPolyline(newPos, path[1]);
    const bend = path[1];
    const anchor = path[2];
    const opt1 = { x: newPos.x, y: anchor.y };
    const opt2 = { x: anchor.x, y: newPos.y };
    const d1 = Math.hypot(bend.x - opt1.x, bend.y - opt1.y);
    const d2 = Math.hypot(bend.x - opt2.x, bend.y - opt2.y);
    const nextBend = d1 <= d2 ? opt1 : opt2;
    const next: Point[] = [{ ...newPos }, nextBend, ...path.slice(2).map((p) => ({ ...p }))];
    if (
      next[1].x === next[0].x &&
      next[1].y === next[0].y
    ) {
      next.splice(1, 1);
    } else if (
      next.length > 2 &&
      next[1].x === next[2].x &&
      next[1].y === next[2].y
    ) {
      next.splice(1, 1);
    }
    return next;
  }

  const last = path.length - 1;
  if (path.length === 2) return orthogonalPolyline(path[0], newPos);
  const bend = path[last - 1];
  const anchor = path[last - 2];
  const opt1 = { x: newPos.x, y: anchor.y };
  const opt2 = { x: anchor.x, y: newPos.y };
  const d1 = Math.hypot(bend.x - opt1.x, bend.y - opt1.y);
  const d2 = Math.hypot(bend.x - opt2.x, bend.y - opt2.y);
  const nextBend = d1 <= d2 ? opt1 : opt2;
  const next: Point[] = [
    ...path.slice(0, last - 1).map((p) => ({ ...p })),
    nextBend,
    { ...newPos },
  ];
  const n = next.length;
  if (next[n - 2].x === next[n - 1].x && next[n - 2].y === next[n - 1].y) {
    next.splice(n - 2, 1);
  } else if (
    n > 2 &&
    next[n - 2].x === next[n - 3].x &&
    next[n - 2].y === next[n - 3].y
  ) {
    next.splice(n - 2, 1);
  }
  return next;
}

/** Glue route endpoints that sat on `from` so they follow `to`. */
export function glueRoutesToMovedDevice(
  routes: Route[],
  from: Point,
  to: Point,
  ftPerPx: number
): Route[] {
  if (nearPoint(from, to, 1e-9)) return routes;
  return routes.map((r) => {
    if (!r.path.length) return r;
    let path = r.path;
    let changed = false;
    if (nearPoint(path[0], from)) {
      path = moveRouteEndpoint(path, "start", to);
      changed = true;
    }
    if (nearPoint(path[path.length - 1], from)) {
      path = moveRouteEndpoint(path, "end", to);
      changed = true;
    }
    if (!changed) return r;
    return {
      ...r,
      path,
      plan_length_ft: planLengthFt(path, ftPerPx),
    };
  });
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
