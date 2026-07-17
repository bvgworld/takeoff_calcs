import { describe, expect, it } from "vitest";
import {
  deratingOkFor12,
  pickMcCable,
  sizeConduit,
  sizeWire,
  LV_CABLES,
  MC_SKUS,
} from "./materials";
import {
  AMPACITY_90_THHN,
  EMT_FILL_40,
  THHN_AREA,
  WIRE_SIZES,
  deratingMultiplier,
} from "./nec-tables";
import { takeoffForCircuit } from "./takeoff";
import type { Circuit, Device, Route } from "./types";
import { DEFAULT_SETTINGS } from "./types";

describe("sizeConduit", () => {
  it("9 × #12 passes 3/4\" fill (smallest EMT is 1/2\")", () => {
    const area = 9 * THHN_AREA["12"];
    expect(area).toBeLessThanOrEqual(EMT_FILL_40['3/4"']);
    expect(area).toBeLessThanOrEqual(EMT_FILL_40['1/2"']);
    expect(sizeConduit([{ size: "12", count: 9 }])).toBe('1/2"');
  });

  it("17 × #12 fails 3/4\" and sizes to 1\"", () => {
    expect(17 * THHN_AREA["12"]).toBeGreaterThan(EMT_FILL_40['3/4"']);
    expect(sizeConduit([{ size: "12", count: 17 }])).toBe('1"');
  });

  it("mixed 3×#8 + 4×#12 sizes correctly", () => {
    // 3×0.0366 + 4×0.0133 = 0.163 → 3/4"
    expect(
      sizeConduit([
        { size: "8", count: 3 },
        { size: "12", count: 4 },
      ])
    ).toBe('3/4"');
  });
});

describe("sizeWire", () => {
  it("20A short run stays #12", () => {
    expect(
      sizeWire({
        breakerAmps: 20,
        cccInRaceway: 2,
        oneWayFt: 50,
        volts: 120,
        loadAmps: 12,
      }).size
    ).toBe("12");
  });

  it("30A picks #10", () => {
    expect(
      sizeWire({
        breakerAmps: 30,
        cccInRaceway: 2,
        oneWayFt: 40,
        volts: 120,
        loadAmps: 20,
      }).size
    ).toBe("10");
  });

  it("30A / 1400 ft edge case upsizes well past #10", () => {
    const short = sizeWire({
      breakerAmps: 30,
      cccInRaceway: 2,
      oneWayFt: 40,
      volts: 120,
      loadAmps: 24,
    });
    const long = sizeWire({
      breakerAmps: 30,
      cccInRaceway: 2,
      oneWayFt: 1400,
      volts: 120,
      loadAmps: 24,
    });
    expect(short.size).toBe("10");
    expect(WIRE_SIZES.indexOf(long.size)).toBeGreaterThan(
      WIRE_SIZES.indexOf(short.size)
    );
  });

  it("10 CCC derates #12 out of 20A — forces upsize (second-pipe case)", () => {
    expect(deratingMultiplier(10)).toBe(0.5);
    expect(AMPACITY_90_THHN["12"] * 0.5).toBe(15);
    expect(deratingOkFor12(20, 10)).toBe(false);
    // Packer already caps at 3 ckts/pipe; engine says 10 CCC cannot stay on #12/20A
    expect(deratingOkFor12(20, 6)).toBe(true);

    const r = sizeWire({
      breakerAmps: 20,
      cccInRaceway: 10,
      oneWayFt: 40,
      volts: 120,
      loadAmps: 12,
    });
    expect(r.size).not.toBe("12");
    expect(r.deratedAmpacity).toBeGreaterThanOrEqual(20);
  });
});

describe("cable catalog", () => {
  it("lists MC SKUs and LV cables (no NM)", () => {
    expect([...MC_SKUS]).toEqual([
      "14/2",
      "12/2",
      "12/3",
      "12/4",
      "10/2",
      "10/3",
      "8/3",
    ]);
    expect([...LV_CABLES]).toEqual([
      "18/2 dimming",
      "16/2 FPL",
      "14/2 FPL",
      "Cat6 plenum",
      "Cat5e plenum",
      "Cat6 riser",
    ]);
    expect(pickMcCable("12", 2)).toBe("12/2 MC cable");
    expect(pickMcCable("10", 2)).toBe("10/2 MC cable");
    expect(pickMcCable("12", 3)).toBe("12/3 MC cable");
    expect(pickMcCable("8", 3)).toBe("8/3 MC cable");
  });
});

describe("30A takeoff uses #10 + materials engine", () => {
  it("sizes THHN/MC from breaker_amps", () => {
    const circuit: Circuit = {
      id: "c1",
      number: 1,
      sheet_id: "s1",
      panel_device_id: "panel1",
      ctype: "receptacle",
      voltage: 120,
      breaker_amps: 30,
      created_at: "",
    };
    const devices: Device[] = [
      {
        id: "panel1",
        type: "panel",
        x: 0,
        y: 0,
        sheet_id: "s1",
        attrs: {},
        circuit_id: null,
        catalog_id: "panel",
        created_at: "",
      },
      {
        id: "r1",
        type: "receptacle",
        x: 100,
        y: 0,
        sheet_id: "s1",
        attrs: {},
        circuit_id: "c1",
        catalog_id: "recep-duplex-20",
        created_at: "",
      },
    ];
    const routes: Route[] = [
      {
        id: "hr",
        circuit_id: "c1",
        kind: "homerun",
        plan_length_ft: 40,
        path: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
        ],
        user_edited: false,
        created_at: "",
      },
      {
        id: "b1",
        circuit_id: "c1",
        kind: "branch",
        plan_length_ft: 20,
        path: [
          { x: 400, y: 0 },
          { x: 600, y: 0 },
        ],
        user_edited: false,
        created_at: "",
      },
    ];
    const lines = takeoffForCircuit({
      circuit,
      devices,
      routes,
      settings: { ...DEFAULT_SETTINGS, branch_method: "mc" },
      pipeGroupSize: 1,
      ownsPipe: true,
      maxHrPlanFt: 40,
    });
    expect(lines.some((l) => l.item === "#10 THHN cu")).toBe(true);
    expect(lines.some((l) => l.item === "10/2 MC cable")).toBe(true);
    expect(
      lines.some((l) => l.item === "30A 1-pole breaker + termination")
    ).toBe(true);
  });
});
