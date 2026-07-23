import { describe, expect, it } from "vitest";
import {
  buildProjectTakeoff,
  groupHomeRunPipes,
  summarizeTakeoff,
  takeoffForCircuit,
  takeoffToCsv,
} from "./takeoff";
import type { Circuit, Device, Route } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const settings = { ...DEFAULT_SETTINGS, branch_method: "mc" as const };
/** 0.1 ft/px → 15 ft share radius = 150 image units. */
const FT_PER_PX = 0.1;
const SHEET = "s1";

function circuit(
  partial: Partial<Circuit> & Pick<Circuit, "id" | "number">
): Circuit {
  return {
    sheet_id: SHEET,
    panel_device_id: "panel1",
    ctype: "receptacle",
    voltage: 120,
    breaker_amps: 20,
    entry_device_id: null,
    created_at: "",
    ...partial,
  };
}

function device(
  partial: Partial<Device> & Pick<Device, "id" | "type" | "x" | "y">
): Device {
  return {
    sheet_id: SHEET,
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

function route(
  partial: Partial<Route> &
    Pick<Route, "id" | "circuit_id" | "kind" | "path" | "plan_length_ft">
): Route {
  return {
    user_edited: false,
    created_at: "",
    ...partial,
  };
}

describe("takeoffForCircuit (hand math)", () => {
  it("matches trainer-style HR + MC for a small receptacle circuit", () => {
    const c = circuit({ id: "c1", number: 1 });
    const devices = [
      device({ id: "panel1", type: "panel", x: 0, y: 0, circuit_id: null }),
      device({ id: "r1", type: "receptacle", x: 100, y: 0 }),
      device({ id: "r2", type: "receptacle", x: 200, y: 0 }),
      device({ id: "r3", type: "receptacle", x: 300, y: 0 }),
    ];
    const routes = [
      route({
        id: "hr",
        circuit_id: "c1",
        kind: "homerun",
        plan_length_ft: 40,
        path: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
        ],
      }),
      route({
        id: "b1",
        circuit_id: "c1",
        kind: "branch",
        plan_length_ft: 30,
        path: [
          { x: 400, y: 0 },
          { x: 700, y: 0 },
        ],
      }),
    ];

    const lines = takeoffForCircuit({
      circuit: c,
      devices,
      routes,
      settings,
      pipeGroupSize: 1,
      ownsPipe: true,
      maxHrPlanFt: 40,
    });

    const hrLen = 40 + settings.panel_stub_ft;
    const waste = 1.1;
    const totalWires = 3;
    const hrWire = Math.ceil((hrLen + 2 * 2) * totalWires * waste);
    const mcLen = Math.ceil(30 * waste);

    expect(lines.find((l) => l.item.includes("EMT") && l.uom === "LF")?.qty).toBe(
      Math.ceil(hrLen)
    );
    expect(lines.find((l) => l.item.includes("THHN"))?.qty).toBe(hrWire);
    expect(lines.find((l) => l.item.includes("MC cable"))?.qty).toBe(mcLen);
  });
});

describe("shared home-run pipe", () => {
  it("3 nearby entries share one EMT at longest length and 7× THHN", () => {
    // Entries ~5 ft apart (50px @ 0.1 ft/px) — within 15 ft.
    // Plan lengths 40 / 55 / 70 → pipe uses 70 + stub.
    const circuits = [
      circuit({ id: "c1", number: 1 }),
      circuit({ id: "c2", number: 2 }),
      circuit({ id: "c3", number: 3 }),
    ];
    const devices = [
      device({ id: "panel1", type: "panel", x: 0, y: 0, circuit_id: null }),
      device({ id: "r1", type: "receptacle", x: 400, y: 0, circuit_id: "c1" }),
      device({ id: "r2", type: "receptacle", x: 550, y: 50, circuit_id: "c2" }),
      device({ id: "r3", type: "receptacle", x: 700, y: 100, circuit_id: "c3" }),
    ];
    const routes = [
      route({
        id: "hr1",
        circuit_id: "c1",
        kind: "homerun",
        plan_length_ft: 40,
        path: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      }),
      route({
        id: "hr2",
        circuit_id: "c2",
        kind: "homerun",
        plan_length_ft: 55,
        path: [
          { x: 0, y: 0 },
          { x: 150, y: 0 },
        ],
      }),
      route({
        id: "hr3",
        circuit_id: "c3",
        kind: "homerun",
        plan_length_ft: 70,
        path: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ],
      }),
    ];

    const { lines, totals } = buildProjectTakeoff({
      circuits,
      devices,
      routes,
      settings,
      ftPerPxBySheetId: { [SHEET]: FT_PER_PX },
    });

    const hrLen = 70 + settings.panel_stub_ft; // 80
    const makeup = settings.makeup_per_box_ft;
    const waste = 1 + settings.waste_pct / 100;
    const expectedThhn = Math.ceil((hrLen + makeup * 2) * 7 * waste);

    const emtHr = lines.filter(
      (l) =>
        l.uom === "LF" &&
        l.item.endsWith(" EMT") &&
        (l.notes.includes("Shared HR") || l.notes.includes("HR plan+stub"))
    );
    expect(emtHr).toHaveLength(1);
    expect(emtHr[0].qty).toBe(Math.ceil(hrLen));
    expect(emtHr[0].notes).toMatch(/Shared HR \(3 ckts/);

    const hrThhn = lines.filter(
      (l) => l.item.includes("THHN") && l.notes.includes("×7×")
    );
    expect(hrThhn).toHaveLength(1);
    expect(hrThhn[0].qty).toBe(expectedThhn);

    const totalThhn =
      totals.find((t) => t.item.includes("THHN"))?.qty ??
      lines
        .filter((l) => l.item.includes("THHN"))
        .reduce((s, l) => s + l.qty, 0);
    expect(totalThhn).toBe(expectedThhn);
  });

  it("entries 30 ft apart do not share a pipe", () => {
    // 30 ft apart @ 0.1 ft/px = 300 px — outside 15 ft radius.
    const circuits = [
      circuit({ id: "c1", number: 1 }),
      circuit({ id: "c2", number: 2 }),
    ];
    const devices = [
      device({ id: "panel1", type: "panel", x: 0, y: 0, circuit_id: null }),
      device({ id: "r1", type: "receptacle", x: 100, y: 0, circuit_id: "c1" }),
      device({ id: "r2", type: "receptacle", x: 200, y: 0, circuit_id: "c2" }),
    ];
    const routes = [
      route({
        id: "hr1",
        circuit_id: "c1",
        kind: "homerun",
        plan_length_ft: 40,
        path: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      }),
      route({
        id: "hr2",
        circuit_id: "c2",
        kind: "homerun",
        plan_length_ft: 40,
        path: [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ],
      }),
    ];

    const byCkt = new Map<string, Route[]>();
    for (const r of routes) {
      if (!r.circuit_id) continue;
      const list = byCkt.get(r.circuit_id) || [];
      list.push(r);
      byCkt.set(r.circuit_id, list);
    }
    const pipes = groupHomeRunPipes(
      circuits,
      byCkt,
      new Map([[SHEET, FT_PER_PX]])
    );
    expect(pipes.get("c1")?.groupSize).toBe(1);
    expect(pipes.get("c2")?.groupSize).toBe(1);
    expect(pipes.get("c1")?.ownsPipe).toBe(true);
    expect(pipes.get("c2")?.ownsPipe).toBe(true);

    const { lines } = buildProjectTakeoff({
      circuits,
      devices,
      routes,
      settings,
      ftPerPxBySheetId: { [SHEET]: FT_PER_PX },
    });
    const emtHr = lines.filter(
      (l) =>
        l.uom === "LF" &&
        l.item.endsWith(" EMT") &&
        (l.notes.includes("Shared HR") || l.notes.includes("HR plan+stub"))
    );
    expect(emtHr).toHaveLength(2);
  });
});

describe("zero routes → zero LF", () => {
  it("summary LF is 0 when circuits exist but have no routes", () => {
    const c = circuit({ id: "c1", number: 1 });
    const devices = [
      device({ id: "panel1", type: "panel", x: 0, y: 0, circuit_id: null }),
      device({ id: "r1", type: "receptacle", x: 50, y: 0 }),
    ];
    const { lines } = buildProjectTakeoff({
      circuits: [c],
      devices,
      routes: [],
      settings,
      ftPerPxBySheetId: { [SHEET]: FT_PER_PX },
    });
    const summary = summarizeTakeoff(lines, devices);
    expect(summary.emtLf).toBe(0);
    expect(summary.mcLf).toBe(0);
    expect(summary.wireLf).toBe(0);
  });
});

describe("jbox assemblies", () => {
  it("emits jbox assembly lines once per box on the circuit", () => {
    const c = circuit({ id: "c1", number: 1 });
    const devices = [
      device({ id: "panel1", type: "panel", x: 0, y: 0, circuit_id: null }),
      device({ id: "r1", type: "receptacle", x: 100, y: 0 }),
      device({
        id: "jb1",
        type: "jbox",
        catalog_id: "jbox-4sq",
        x: 50,
        y: 0,
        attrs: { label: "JB-1" },
      }),
      device({
        id: "jb2",
        type: "jbox",
        catalog_id: "jbox-4sq",
        x: 60,
        y: 0,
        attrs: { label: "JB-2" },
      }),
    ];
    const routes = [
      route({
        id: "hr",
        circuit_id: "c1",
        kind: "homerun",
        plan_length_ft: 10,
        path: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
        ],
      }),
    ];
    const lines = takeoffForCircuit({
      circuit: c,
      devices,
      routes,
      settings,
    });
    const boxes = lines.find((l) => l.item === '4" sq J-box');
    const covers = lines.find((l) => l.item === "Blank cover");
    const supports = lines.find((l) => l.item === "Box support");
    expect(boxes?.qty).toBe(2);
    expect(covers?.qty).toBe(2);
    expect(supports?.qty).toBe(2);
  });

  it("HR note lands at JB label when entry_device_id is set", () => {
    const c = circuit({
      id: "c1",
      number: 1,
      entry_device_id: "jb1",
    });
    const devices = [
      device({ id: "panel1", type: "panel", x: 0, y: 0, circuit_id: null }),
      device({ id: "r1", type: "receptacle", x: 100, y: 0 }),
      device({
        id: "jb1",
        type: "jbox",
        x: 50,
        y: 0,
        attrs: { label: "JB-1" },
      }),
    ];
    const routes = [
      route({
        id: "hr",
        circuit_id: "c1",
        kind: "homerun",
        plan_length_ft: 10,
        path: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
        ],
      }),
    ];
    const lines = takeoffForCircuit({
      circuit: c,
      devices,
      routes,
      settings,
    });
    const hr = lines.find(
      (l) => l.item.includes("EMT") && !l.item.includes("coupling")
    );
    expect(hr?.notes).toContain("lands at JB-1");
  });

  it("unassigned jboxes emit under Unassigned J-boxes section", () => {
    const c = circuit({ id: "c1", number: 1 });
    const devices = [
      device({ id: "panel1", type: "panel", x: 0, y: 0, circuit_id: null }),
      device({ id: "r1", type: "receptacle", x: 100, y: 0 }),
      device({
        id: "jb1",
        type: "jbox",
        catalog_id: "jbox-4-11-16",
        x: 50,
        y: 0,
        circuit_id: null,
        attrs: { label: "JB-1" },
      }),
    ];
    const { lines } = buildProjectTakeoff({
      circuits: [c],
      devices,
      routes: [],
      settings,
      ftPerPxBySheetId: { [SHEET]: FT_PER_PX },
    });
    const unassigned = lines.filter((l) => l.circuit === "Unassigned J-boxes");
    expect(unassigned.some((l) => l.item === '4-11/16" sq J-box')).toBe(true);
    expect(unassigned.some((l) => l.item === "Blank cover")).toBe(true);
  });
});

describe("CSV + summary", () => {
  it("exports UTF-8 CSV with header and TOTAL rows", () => {
    const c = circuit({ id: "c1", number: 1 });
    const devices = [
      device({ id: "panel1", type: "panel", x: 0, y: 0, circuit_id: null }),
      device({ id: "r1", type: "receptacle", x: 50, y: 0 }),
    ];
    const routes = [
      route({
        id: "hr",
        circuit_id: "c1",
        kind: "homerun",
        plan_length_ft: 20,
        path: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
        ],
      }),
      route({
        id: "b1",
        circuit_id: "c1",
        kind: "branch",
        plan_length_ft: 10,
        path: [
          { x: 50, y: 0 },
          { x: 100, y: 0 },
        ],
      }),
    ];
    const { lines, totals } = buildProjectTakeoff({
      circuits: [c],
      devices,
      routes,
      settings,
      ftPerPxBySheetId: { [SHEET]: FT_PER_PX },
    });
    const csv = takeoffToCsv([...lines, ...totals]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(
      "circuit,item,qty,uom,hours,unit_price,ext_price,difficulty,rate_table,notes"
    );
    expect(csv).toContain('"TOTAL"');
    const summary = summarizeTakeoff(lines, devices);
    expect(summary.emtLf).toBeGreaterThan(0);
    expect(summary.mcLf).toBeGreaterThan(0);
    expect(summary.deviceCount).toBe(1);
  });
});
