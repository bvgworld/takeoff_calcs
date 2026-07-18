import { describe, expect, it } from "vitest";
import {
  buildLvTakeoff,
  dataDropPlanTotal,
  dimmingFollows,
  dimmingTotalPlanFt,
  firePlanTotal,
  routeDataSystem,
  routeFireSystem,
  takeoffThermostats,
} from "./lv-routing";
import { manhattan } from "./routing";
import type { Circuit, Device, Route } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const settings = { ...DEFAULT_SETTINGS, lv_stub_ft: 10, waste_pct: 10 };
const FT = 0.1; // 0.1 ft/px

function device(
  partial: Partial<Device> & Pick<Device, "id" | "type" | "catalog_id" | "x" | "y">
): Device {
  return {
    sheet_id: "s1",
    attrs: {},
    circuit_id: null,
    created_at: "",
    ...partial,
  };
}

describe("data routing — star, not MST", () => {
  it("total = sum of N individual drop path lengths (not MST)", () => {
    const idf = device({
      id: "idf",
      type: "headend",
      catalog_id: "head-idf",
      x: 0,
      y: 0,
    });
    // Three drops in a line far from IDF — MST would be shorter than star
    const drops = [
      device({
        id: "d1",
        type: "receptacle",
        catalog_id: "recep-data",
        x: 100,
        y: 0,
      }),
      device({
        id: "d2",
        type: "receptacle",
        catalog_id: "recep-data",
        x: 200,
        y: 0,
      }),
      device({
        id: "d3",
        type: "receptacle",
        catalog_id: "recep-data",
        x: 300,
        y: 0,
      }),
    ];
    const proposed = routeDataSystem({
      idfs: [idf],
      drops,
      ftPerPx: FT,
    });
    expect(proposed).toHaveLength(3);
    expect(proposed.every((r) => r.kind === "homerun")).toBe(true);
    expect(proposed.every((r) => r.lv_system === "data")).toBe(true);

    const individualSum = proposed.reduce((s, r) => s + r.plan_length_ft, 0);
    // Star: 10+20+30 = 60 ft at 0.1 ft/px
    expect(individualSum).toBeCloseTo(60, 5);

    // MST over drops alone would be 20 ft (100→200→300); star is larger
    const mstLike =
      manhattan({ x: 100, y: 0 }, { x: 200, y: 0 }) * FT +
      manhattan({ x: 200, y: 0 }, { x: 300, y: 0 }) * FT;
    expect(individualSum).toBeGreaterThan(mstLike);

    const asRoutes: Route[] = proposed.map((p, i) => ({
      id: `r${i}`,
      circuit_id: null,
      sheet_id: "s1",
      lv_system: "data",
      kind: p.kind,
      path: p.path,
      plan_length_ft: p.plan_length_ft,
      user_edited: false,
      created_at: "",
    }));
    expect(dataDropPlanTotal(asRoutes)).toBeCloseTo(individualSum, 5);
  });
});

describe("dimming follow", () => {
  it("LF equals branch + switchleg and tracks route edits", () => {
    const circuit: Circuit = {
      id: "c1",
      sheet_id: "s1",
      panel_device_id: "p1",
      number: 1,
      ctype: "lighting",
      voltage: 277,
      breaker_amps: 20,
      entry_device_id: null,
      created_at: "",
    };
    const devices: Device[] = [
      device({
        id: "p1",
        type: "panel",
        catalog_id: "panel",
        x: 0,
        y: 0,
      }),
      device({
        id: "f1",
        type: "fixture",
        catalog_id: "fix-troffer-2x4",
        x: 100,
        y: 0,
        circuit_id: "c1",
        attrs: { dimming: true },
      }),
      device({
        id: "f2",
        type: "fixture",
        catalog_id: "fix-troffer-2x4",
        x: 200,
        y: 0,
        circuit_id: "c1",
        attrs: { dimming: true },
      }),
      device({
        id: "sw",
        type: "switch",
        catalog_id: "sw-dimmer-010",
        x: 50,
        y: 50,
        circuit_id: "c1",
      }),
    ];
    const routes: Route[] = [
      {
        id: "b1",
        circuit_id: "c1",
        kind: "branch",
        path: [
          { x: 100, y: 0 },
          { x: 200, y: 0 },
        ],
        plan_length_ft: 10,
        user_edited: false,
        created_at: "",
      },
      {
        id: "sl",
        circuit_id: "c1",
        kind: "switchleg",
        path: [
          { x: 50, y: 50 },
          { x: 100, y: 0 },
        ],
        plan_length_ft: 7.07,
        user_edited: false,
        created_at: "",
      },
      {
        id: "hr",
        circuit_id: "c1",
        kind: "homerun",
        path: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
        ],
        plan_length_ft: 50,
        user_edited: false,
        created_at: "",
      },
    ];

    const follows = dimmingFollows({ circuits: [circuit], devices, routes });
    expect(follows).toHaveLength(1);
    expect(follows[0].planFt).toBeCloseTo(17.07, 2);
    // Home run excluded
    expect(dimmingTotalPlanFt(follows)).toBeCloseTo(10 + 7.07, 2);

    // Edit branch length → dimming tracks
    const edited = routes.map((r) =>
      r.id === "b1" ? { ...r, plan_length_ft: 25 } : r
    );
    const after = dimmingFollows({
      circuits: [circuit],
      devices,
      routes: edited,
    });
    expect(after[0].planFt).toBeCloseTo(32.07, 2);
  });
});

describe("thermostat stubs", () => {
  it("each stat emits exactly one stub assembly and no route rows", () => {
    const devices = [
      device({
        id: "t1",
        type: "thermostat",
        catalog_id: "stat-wall",
        x: 10,
        y: 10,
      }),
      device({
        id: "t2",
        type: "thermostat",
        catalog_id: "stat-wall",
        x: 20,
        y: 20,
      }),
    ];
    const lines = takeoffThermostats(devices, settings);
    expect(lines.filter((l) => l.item === "1-gang mud ring")).toHaveLength(1);
    expect(lines.find((l) => l.item === "1-gang mud ring")?.qty).toBe(2);
    expect(lines.find((l) => l.item === '3/4" EMT connector')?.qty).toBe(2);
    const stub = lines.find((l) => l.item === '3/4" EMT stub');
    expect(stub?.qty).toBe(Math.ceil(2 * 10 * 1.1));
    expect(lines.every((l) => l.circuit === "TSTAT")).toBe(true);
    // No cable home-run style items
    expect(lines.some((l) => /FPL|Cat6|18\/2/.test(l.item))).toBe(false);
  });
});

describe("fire MST + home run", () => {
  it("routes MST over devices plus HR to FACP on synthetic room", () => {
    const facp = device({
      id: "facp",
      type: "headend",
      catalog_id: "head-facp",
      x: 0,
      y: 0,
    });
    const fire = [
      device({
        id: "s1",
        type: "fire",
        catalog_id: "fire-smoke",
        x: 100,
        y: 0,
      }),
      device({
        id: "s2",
        type: "fire",
        catalog_id: "fire-smoke",
        x: 200,
        y: 0,
      }),
      device({
        id: "pull",
        type: "fire",
        catalog_id: "fire-pull",
        x: 100,
        y: 100,
      }),
    ];
    const proposed = routeFireSystem({
      facp,
      fireDevices: fire,
      ftPerPx: FT,
    });
    expect(proposed.some((r) => r.kind === "branch")).toBe(true);
    expect(proposed.filter((r) => r.kind === "homerun")).toHaveLength(1);
    expect(proposed.every((r) => r.lv_system === "fire")).toBe(true);

    // 3 devices → 2 MST edges; HR from FACP to nearest (s1 at 100,0)
    const branchFt = proposed
      .filter((r) => r.kind === "branch")
      .reduce((s, r) => s + r.plan_length_ft, 0);
    const hr = proposed.find((r) => r.kind === "homerun")!;
    expect(hr.plan_length_ft).toBeCloseTo(10, 5); // 100px × 0.1
    expect(proposed.filter((r) => r.kind === "branch")).toHaveLength(2);

    const asRoutes: Route[] = proposed.map((p, i) => ({
      id: `f${i}`,
      circuit_id: null,
      sheet_id: "s1",
      lv_system: "fire" as const,
      kind: p.kind,
      path: p.path,
      plan_length_ft: p.plan_length_ft,
      user_edited: false,
      created_at: "",
    }));
    expect(firePlanTotal(asRoutes)).toBeCloseTo(branchFt + hr.plan_length_ft, 5);

    const lv = buildLvTakeoff({
      circuits: [],
      devices: [facp, ...fire],
      routes: asRoutes,
      settings,
    });
    expect(lv.some((l) => l.circuit === "FA" && l.item === "16/2 FPL")).toBe(
      true
    );
  });
});

describe("catalog — no RTU / 18/5", () => {
  it("head-rtu removed; LV cables stay without 18/5", async () => {
    const { getCatalogEntry } = await import("./catalog");
    const { LV_CABLES } = await import("./materials");
    expect(getCatalogEntry("head-rtu")).toBeUndefined();
    expect(LV_CABLES.some((c) => c.includes("18/5"))).toBe(false);
  });
});
