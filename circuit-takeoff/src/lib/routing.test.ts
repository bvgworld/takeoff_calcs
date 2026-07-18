import { describe, expect, it } from "vitest";
import {
  applyLengthAdders,
  glueRoutesToMovedDevice,
  manhattan,
  moveOrthogonalSegment,
  moveRouteEndpoint,
  orthogonalPolyline,
  planLengthFt,
  polylineLengthPx,
  primMst,
  recomputeRoutePlanLengths,
  routeCircuit,
} from "./routing";
import { pxToFt } from "./scale";
import type { Route } from "./types";
import type { Device, ProjectSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

function pt(x: number, y: number) {
  return { x, y };
}

function device(
  partial: Partial<Device> & Pick<Device, "id" | "type" | "x" | "y">
): Device {
  return {
    sheet_id: "sheet",
    attrs: {},
    circuit_id: "c1",
    catalog_id:
      partial.catalog_id ||
      ({
        panel: "panel",
        fixture: "fix-troffer-2x4",
        receptacle: "recep-duplex-20",
        switch: "sw-sp",
        thermostat: "stat-wall",
        headend: "head-facp",
        fire: "fire-smoke",
        jbox: "jbox-4sq",
      } as Record<string, string>)[partial.type] ||
      "recep-duplex-20",
    created_at: "",
    ...partial,
  };
}

describe("manhattan", () => {
  it("sums absolute deltas", () => {
    expect(manhattan(pt(0, 0), pt(3, 4))).toBe(7);
  });
});

describe("polyline length", () => {
  it("computes orthogonal path length in px and ft via pxToFt", () => {
    const path = orthogonalPolyline(pt(0, 0), pt(30, 40));
    expect(path).toEqual([pt(0, 0), pt(30, 0), pt(30, 40)]);
    expect(polylineLengthPx(path)).toBe(70);
    expect(planLengthFt(path, 0.1)).toBeCloseTo(7, 5);
    expect(planLengthFt(path, 0.1)).toBe(pxToFt(polylineLengthPx(path), 0.1));
  });

  it("recomputeRoutePlanLengths updates from path × ft_per_px", () => {
    const path = [pt(0, 0), pt(100, 0)];
    const routes = [
      {
        id: "r1",
        path,
        plan_length_ft: 999,
      },
    ];
    const out = recomputeRoutePlanLengths(routes, 0.05);
    expect(out[0].plan_length_ft).toBeCloseTo(5, 8);
    const out2 = recomputeRoutePlanLengths(out, 0.2);
    expect(out2[0].plan_length_ft).toBeCloseTo(20, 8);
  });
});

describe("Prim MST", () => {
  it("connects 2 devices with one edge", () => {
    const edges = primMst([pt(0, 0), pt(10, 0)]);
    expect(edges).toHaveLength(1);
    expect(manhattan(pt(0, 0), pt(10, 0))).toBe(10);
  });

  it("10-device MST total length is sane (≤ complete graph lower bound check)", () => {
    const points = Array.from({ length: 10 }, (_, i) =>
      pt(i * 10, (i % 3) * 10)
    );
    const edges = primMst(points);
    expect(edges).toHaveLength(9);
    let total = 0;
    for (const [a, b] of edges) total += manhattan(points[a], points[b]);
    // MST ≤ any star from point 0
    let star = 0;
    for (let i = 1; i < points.length; i++) {
      star += manhattan(points[0], points[i]);
    }
    expect(total).toBeLessThanOrEqual(star);
    expect(total).toBeGreaterThan(0);
  });
});

describe("routeCircuit", () => {
  const panel = device({ id: "p", type: "panel", x: 0, y: 0 });
  const settings: ProjectSettings = { ...DEFAULT_SETTINGS, panel_stub_ft: 10, switch_drop_ft: 8 };

  it("builds branch + homerun for two fixtures", () => {
    const a = device({ id: "a", type: "fixture", x: 100, y: 0 });
    const b = device({ id: "b", type: "fixture", x: 100, y: 100 });
    const routes = routeCircuit({
      panel,
      devicesOnCircuit: [a, b],
      ctype: "lighting",
      ftPerPx: 0.1,
    });
    expect(routes.some((r) => r.kind === "branch")).toBe(true);
    expect(routes.some((r) => r.kind === "homerun")).toBe(true);
    for (const r of routes) {
      for (let i = 1; i < r.path.length; i++) {
        const p0 = r.path[i - 1];
        const p1 = r.path[i];
        expect(p0.x === p1.x || p0.y === p1.y).toBe(true);
      }
    }
  });

  it("applies length adders", () => {
    const routes = [
      { kind: "homerun" as const, plan_length_ft: 50 },
      { kind: "switchleg" as const, plan_length_ft: 12 },
      { kind: "branch" as const, plan_length_ft: 20 },
    ];
    const totals = applyLengthAdders(routes, settings);
    expect(totals.homerun).toBe(60);
    expect(totals.switchleg).toBe(20);
    expect(totals.branch).toBe(20);
  });

  it("lighting entry is switch when present", () => {
    const sw = device({ id: "s", type: "switch", x: 50, y: 0 });
    const f = device({ id: "f", type: "fixture", x: 100, y: 0 });
    const routes = routeCircuit({
      panel,
      devicesOnCircuit: [sw, f],
      ctype: "lighting",
      ftPerPx: 1,
    });
    const hr = routes.find((r) => r.kind === "homerun")!;
    const end = hr.path[hr.path.length - 1];
    expect(end.x).toBe(50);
    expect(end.y).toBe(0);
    expect(routes.some((r) => r.kind === "switchleg")).toBe(true);
  });

  it("entry override → HR ends at J-box and MST includes it", () => {
    const jb = device({ id: "jb1", type: "jbox", x: 40, y: 20 });
    const a = device({ id: "a", type: "receptacle", x: 100, y: 0 });
    const b = device({ id: "b", type: "receptacle", x: 100, y: 100 });
    const routes = routeCircuit({
      panel,
      devicesOnCircuit: [jb, a, b],
      ctype: "receptacle",
      ftPerPx: 1,
      entryDeviceId: "jb1",
    });
    const hr = routes.find((r) => r.kind === "homerun")!;
    const end = hr.path[hr.path.length - 1];
    expect(end.x).toBe(40);
    expect(end.y).toBe(20);
    const branches = routes.filter((r) => r.kind === "branch");
    expect(branches.length).toBe(2); // MST over jbox + 2 receptacles
    const touchesJbox = branches.some((r) =>
      r.path.some((p) => p.x === 40 && p.y === 20)
    );
    expect(touchesJbox).toBe(true);
  });

  it("null entry → identical output to pre-change auto path", () => {
    const a = device({ id: "a", type: "fixture", x: 100, y: 0 });
    const b = device({ id: "b", type: "fixture", x: 100, y: 100 });
    const sw = device({ id: "s", type: "switch", x: 50, y: 0 });
    const withNull = routeCircuit({
      panel,
      devicesOnCircuit: [sw, a, b],
      ctype: "lighting",
      ftPerPx: 1,
      entryDeviceId: null,
    });
    const omitted = routeCircuit({
      panel,
      devicesOnCircuit: [sw, a, b],
      ctype: "lighting",
      ftPerPx: 1,
    });
    expect(withNull).toEqual(omitted);
    // Pre-change snapshot: HR lands at switch; one branch; one switchleg.
    expect(withNull.filter((r) => r.kind === "branch")).toHaveLength(1);
    expect(withNull.filter((r) => r.kind === "switchleg")).toHaveLength(1);
    const hr = withNull.find((r) => r.kind === "homerun")!;
    expect(hr.path[hr.path.length - 1]).toEqual({ x: 50, y: 0 });
    expect(hr.plan_length_ft).toBe(50);
  });
});

describe("route endpoint gluing", () => {
  it("moveRouteEndpoint keeps far bends and restores orthogonality", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 80, y: 30 },
    ];
    const next = moveRouteEndpoint(path, "start", { x: 10, y: 5 });
    expect(next[0]).toEqual({ x: 10, y: 5 });
    expect(next[next.length - 1]).toEqual({ x: 80, y: 30 });
    // first bend orthogonal to start and following anchor
    expect(
      next[0].x === next[1].x || next[0].y === next[1].y
    ).toBe(true);
  });

  it("glueRoutesToMovedDevice updates matching endpoints only", () => {
    const route: Route = {
      id: "r1",
      circuit_id: "c1",
      kind: "branch",
      path: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 40 },
      ],
      plan_length_ft: 90,
      user_edited: true,
      created_at: "",
    };
    const out = glueRoutesToMovedDevice(
      [route],
      { x: 50, y: 40 },
      { x: 60, y: 55 },
      1
    );
    expect(out[0].path[0]).toEqual({ x: 0, y: 0 });
    expect(out[0].path[out[0].path.length - 1]).toEqual({ x: 60, y: 55 });
    expect(out[0].plan_length_ft).toBe(planLengthFt(out[0].path, 1));
  });
});

describe("moveOrthogonalSegment", () => {
  it("moves a middle horizontal segment vertically; neighbors stay orthogonal", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 0 },
    ];
    const next = moveOrthogonalSegment(path, 1, { x: 10, y: 15 });
    expect(next[0]).toEqual({ x: 0, y: 0 });
    expect(next[next.length - 1]).toEqual({ x: 20, y: 0 });
    // Moved segment at y=15
    expect(next.some((p) => p.y === 15 && p.x === 0)).toBe(true);
    expect(next.some((p) => p.y === 15 && p.x === 20)).toBe(true);
  });

  it("inserts a bend when dragging a segment adjacent to a locked start", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 20 },
    ];
    const next = moveOrthogonalSegment(path, 0, { x: 15, y: 8 });
    expect(next[0]).toEqual({ x: 0, y: 0 }); // locked
    expect(next[next.length - 1]).toEqual({ x: 30, y: 20 });
    expect(next.length).toBeGreaterThanOrEqual(3);
    // Has horizontal run at y=8
    expect(next.some((p, i) => i > 0 && p.y === 8)).toBe(true);
  });
});
