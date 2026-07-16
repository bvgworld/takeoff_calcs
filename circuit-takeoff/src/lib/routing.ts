import {
  dist,
  manhattanPath,
  mstEdges,
  nearestIndex,
  pathLengthFt,
} from "./geometry";
import type { Device, Point, ProjectSettings, Route, RouteKind } from "./types";

export type ProposedRoute = {
  kind: RouteKind;
  path: Point[];
  /** Plan length only (px × ft_per_px). Stubs applied in takeoff / VD. */
  plan_length_ft: number;
  user_edited: boolean;
};

/**
 * routeCircuit — MST daisy chain + Manhattan paths + home run to entry.
 *
 * D = devices on circuit excluding panel and switch
 * S = first switch on circuit (lighting only, may be null)
 *
 * 1. BRANCH: Prim MST over D; each edge → H-then-V polyline, kind=branch
 * 2. ENTRY: lighting → S if present else nearest D to panel
 *           receptacle → nearest D to panel
 *    If S present: switchleg S → nearest fixture in D
 * 3. HOME RUN: panel → entry, kind=homerun
 * 4. plan_length_ft = polyline px × ft_per_px (stubs NOT included here)
 */
export function autoRouteCircuit(opts: {
  panel: Device;
  branchDevices: Device[];
  switches: Device[];
  ctype: "lighting" | "receptacle";
  ftPerPx: number;
}): ProposedRoute[] {
  const { panel, branchDevices, switches, ctype, ftPerPx } = opts;
  const routes: ProposedRoute[] = [];
  const D = branchDevices;
  const S =
    ctype === "lighting" && switches.length > 0 ? switches[0] : null;

  if (D.length === 0 && !S) return routes;

  const points = D.map((d) => ({ x: d.x, y: d.y }));

  // 1. BRANCH CHAIN
  if (D.length >= 2) {
    for (const [i, j] of mstEdges(points)) {
      const path = manhattanPath(points[i], points[j]);
      routes.push({
        kind: "branch",
        path,
        plan_length_ft: pathLengthFt(path, ftPerPx),
        user_edited: false,
      });
    }
  }

  // 2. ENTRY + switchleg
  let entry: Device;
  if (ctype === "lighting" && S) {
    entry = S;
    if (D.length > 0) {
      const fi = nearestIndex({ x: S.x, y: S.y }, points);
      const path = manhattanPath({ x: S.x, y: S.y }, points[fi]);
      routes.push({
        kind: "switchleg",
        path,
        plan_length_ft: pathLengthFt(path, ftPerPx),
        user_edited: false,
      });
    }
  } else if (D.length > 0) {
    const ei = nearestIndex({ x: panel.x, y: panel.y }, points);
    entry = D[ei];
  } else {
    entry = S!;
  }

  // 3. HOME RUN
  const hrPath = manhattanPath(
    { x: panel.x, y: panel.y },
    { x: entry.x, y: entry.y }
  );
  routes.push({
    kind: "homerun",
    path: hrPath,
    plan_length_ft: pathLengthFt(hrPath, ftPerPx),
    user_edited: false,
  });

  return routes;
}

/** Home-run entry point in image px (last point of homerun polyline). */
export function homeRunEntryPoint(routes: Route[]): Point | null {
  const hr = routes.find((r) => r.kind === "homerun");
  if (!hr?.path?.length) return null;
  return hr.path[hr.path.length - 1];
}

/**
 * Circuits sharing a panel whose home-run entry points are within 150px
 * share a pipe, packed max 3 circuits (9 CCC) per 3/4" EMT.
 * Returns map circuitId → { groupSize, ownsPipe }.
 */
export function groupHomeRunPipes(
  circuits: { id: string; panel_device_id: string; number: number }[],
  routesByCircuit: Map<string, Route[]>
): Map<string, { groupSize: number; ownsPipe: boolean; groupId: string }> {
  const result = new Map<
    string,
    { groupSize: number; ownsPipe: boolean; groupId: string }
  >();

  const byPanel = new Map<string, typeof circuits>();
  for (const c of circuits) {
    const list = byPanel.get(c.panel_device_id) || [];
    list.push(c);
    byPanel.set(c.panel_device_id, list);
  }

  Array.from(byPanel.values()).forEach((panelCircuits) => {
    type Node = { id: string; number: number; entry: Point };
    const nodes: Node[] = [];
    for (const c of panelCircuits) {
      const entry = homeRunEntryPoint(routesByCircuit.get(c.id) || []);
      if (!entry) continue;
      nodes.push({ id: c.id, number: c.number, entry });
    }

    // Cluster by 150px proximity (union-find)
    const parent = nodes.map((_, i) => i);
    const find = (i: number): number =>
      parent[i] === i ? i : (parent[i] = find(parent[i]));
    const unite = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (dist(nodes[i].entry, nodes[j].entry) <= 150) unite(i, j);
      }
    }

    const clusters = new Map<number, Node[]>();
    for (let i = 0; i < nodes.length; i++) {
      const r = find(i);
      const list = clusters.get(r) || [];
      list.push(nodes[i]);
      clusters.set(r, list);
    }

    // Pack each cluster into pipes of max 3
    Array.from(clusters.values()).forEach((members) => {
      members.sort((a, b) => a.number - b.number);
      for (let i = 0; i < members.length; i += 3) {
        const pipe = members.slice(i, i + 3);
        const groupId = pipe.map((m) => m.id).join(",");
        pipe.forEach((m, idx) => {
          result.set(m.id, {
            groupSize: pipe.length,
            ownsPipe: idx === 0,
            groupId,
          });
        });
      }
    });
  });

  // Circuits with no home run yet
  for (const c of circuits) {
    if (!result.has(c.id)) {
      result.set(c.id, {
        groupSize: 1,
        ownsPipe: true,
        groupId: c.id,
      });
    }
  }

  return result;
}

/**
 * Voltage-drop path length: cumulative route lengths from panel to farthest
 * load device, with stubs:
 *   homerun  += panel_stub_ft
 *   switchleg += switch_drop_ft
 *   branch   += 0
 */
export function farthestCumulativeFt(opts: {
  panel: Device;
  devices: Device[];
  routes: Route[];
  settings: ProjectSettings;
}): number {
  const { panel, devices, routes, settings } = opts;
  if (!routes.length) return 0;

  type NodeKey = string;
  const keyOf = (p: Point) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const deviceKeys = new Map<string, Device>();
  for (const d of devices) {
    deviceKeys.set(keyOf({ x: d.x, y: d.y }), d);
  }

  const snap = (p: Point): NodeKey => {
    let best: NodeKey = keyOf(p);
    let bestD = Infinity;
    for (const d of devices) {
      const dd = dist(p, { x: d.x, y: d.y });
      if (dd < bestD) {
        bestD = dd;
        best = keyOf({ x: d.x, y: d.y });
      }
    }
    // Also allow panel
    const pd = dist(p, { x: panel.x, y: panel.y });
    if (pd < bestD) best = keyOf({ x: panel.x, y: panel.y });
    return best;
  };

  const panelKey = keyOf({ x: panel.x, y: panel.y });
  const adj = new Map<NodeKey, { to: NodeKey; w: number }[]>();
  const addEdge = (a: NodeKey, b: NodeKey, w: number) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push({ to: b, w });
    adj.get(b)!.push({ to: a, w });
  };

  for (const r of routes) {
    if (!r.path?.length) continue;
    const a = snap(r.path[0]);
    const b = snap(r.path[r.path.length - 1]);
    let w = r.plan_length_ft;
    if (r.kind === "homerun") w += settings.panel_stub_ft;
    if (r.kind === "switchleg") w += settings.switch_drop_ft;
    addEdge(a, b, w);
  }

  // Dijkstra from panel
  const distMap = new Map<NodeKey, number>();
  const pq: { k: NodeKey; d: number }[] = [{ k: panelKey, d: 0 }];
  distMap.set(panelKey, 0);
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d);
    const cur = pq.shift()!;
    if (cur.d !== distMap.get(cur.k)) continue;
    for (const e of adj.get(cur.k) || []) {
      const nd = cur.d + e.w;
      if (nd < (distMap.get(e.to) ?? Infinity)) {
        distMap.set(e.to, nd);
        pq.push({ k: e.to, d: nd });
      }
    }
  }

  let max = 0;
  for (const d of devices) {
    if (d.type !== "fixture" && d.type !== "receptacle") continue;
    const k = keyOf({ x: d.x, y: d.y });
    const dd = distMap.get(k);
    if (dd !== undefined) max = Math.max(max, dd);
  }
  return max;
}

/** Effective takeoff lengths from stored plan lengths + settings stubs. */
export function routeTakeoffLengths(
  routes: Route[],
  settings: ProjectSettings
): { homerun: number; branch: number; switchleg: number } {
  let homerun = 0;
  let branch = 0;
  let switchleg = 0;
  for (const r of routes) {
    if (r.kind === "homerun") {
      homerun += r.plan_length_ft + settings.panel_stub_ft;
    } else if (r.kind === "switchleg") {
      switchleg += r.plan_length_ft + settings.switch_drop_ft;
    } else {
      branch += r.plan_length_ft;
    }
  }
  return { homerun, branch, switchleg };
}
