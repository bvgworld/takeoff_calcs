import { describe, expect, it } from "vitest";
import {
  BACKFILL_CATALOG_ID,
  backfillCatalogId,
  getCatalogEntry,
  requireCatalogEntry,
  sumReceptacleYokes,
} from "./catalog";
import { takeoffForCircuit } from "./takeoff";
import type { Circuit, Device, Route } from "./types";
import { DEFAULT_SETTINGS } from "./types";

describe("catalog backfill", () => {
  it("maps legacy Phase-1 types", () => {
    expect(backfillCatalogId("fixture")).toBe("fix-troffer-2x4");
    expect(backfillCatalogId("receptacle")).toBe("recep-duplex-20");
    expect(backfillCatalogId("switch")).toBe("sw-sp");
    expect(backfillCatalogId("panel")).toBe("panel");
    expect(BACKFILL_CATALOG_ID.fixture).toBe("fix-troffer-2x4");
  });
});

describe("yoke counting", () => {
  it("5 quads = 10 yokes × 180 VA", () => {
    const devices = Array.from({ length: 5 }, (_, i) => ({
      catalog_id: "recep-quad-20",
      type: "receptacle" as const,
      id: `q${i}`,
    }));
    expect(sumReceptacleYokes(devices)).toBe(10);
    expect(sumReceptacleYokes(devices) * 180).toBe(1800);
  });

  it("data-only outlets contribute 0 yokes; combo contributes 1", () => {
    expect(
      sumReceptacleYokes([{ catalog_id: "recep-data", type: "receptacle" }])
    ).toBe(0);
    expect(
      sumReceptacleYokes([
        { catalog_id: "recep-combo-power-data", type: "receptacle" },
      ])
    ).toBe(1);
  });
});

describe("catalog assemblies in takeoff", () => {
  it("emits WP GFI assembly lines including in-use cover", () => {
    const circuit: Circuit = {
      id: "c1",
      sheet_id: "s1",
      panel_device_id: "panel1",
      number: 1,
      ctype: "receptacle",
      voltage: 120,
      breaker_amps: 20,
      created_at: "",
    };
    const devices: Device[] = [
      {
        id: "panel1",
        sheet_id: "s1",
        type: "panel",
        catalog_id: "panel",
        x: 0,
        y: 0,
        attrs: { label: "LP-1" },
        circuit_id: null,
        created_at: "",
      },
      {
        id: "r1",
        sheet_id: "s1",
        type: "receptacle",
        catalog_id: "recep-wp-gfi-duplex-20",
        x: 100,
        y: 0,
        attrs: {},
        circuit_id: "c1",
        created_at: "",
      },
    ];
    const routes: Route[] = [
      {
        id: "hr",
        circuit_id: "c1",
        kind: "homerun",
        path: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        plan_length_ft: 20,
        user_edited: false,
        created_at: "",
      },
    ];
    const lines = takeoffForCircuit({
      circuit,
      devices,
      routes,
      settings: DEFAULT_SETTINGS,
      ownsPipe: true,
      maxHrPlanFt: 20,
    });
    expect(
      lines.some((l) => l.item.includes("In-use weatherproof cover"))
    ).toBe(true);
    expect(
      lines.some((l) => l.item.includes("WP GFI duplex"))
    ).toBe(true);
    expect(requireCatalogEntry("recep-wp-gfi-duplex-20").assembly.length).toBe(
      3
    );
    expect(getCatalogEntry("nope")).toBeUndefined();
  });
});
