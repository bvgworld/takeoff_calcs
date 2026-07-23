import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG } from "./catalog";
import {
  assembliesToLaborRows,
  assemblyItemCircuitQty,
  assemblyItemQty,
  assemblyJoinReport,
  enumerateTakeoffItemKeys,
  laborRowToAssemblySeed,
  parseAssemblyCsv,
  parseItemCsv,
  seedAssemblyRows,
} from "./estimating";
import { normalizeItemKey } from "./labor";
import { buildProjectTakeoff, type TakeoffLine } from "./takeoff";
import type { Circuit, Device, Route } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const SHEET = "s1";
const FT_PER_PX = 0.1;

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
  partial: Partial<Device> & Pick<Device, "id" | "type" | "x" | "y" | "catalog_id">
): Device {
  return {
    sheet_id: SHEET,
    attrs: {},
    circuit_id: null,
    created_at: "",
    ...partial,
  };
}

function route(
  partial: Partial<Route> &
    Pick<Route, "id" | "kind" | "path" | "plan_length_ft">
): Route {
  return {
    circuit_id: null,
    user_edited: false,
    created_at: "",
    ...partial,
  };
}

/**
 * Synthetic takeoff exercising every generator: one device of EVERY
 * catalog entry, power circuits under both branch methods (MC and EMT),
 * dimming follow, thermostat stubs, fire MST+HR, and data drops.
 */
function syntheticTakeoffLines(): TakeoffLine[] {
  const devices: Device[] = [
    device({ id: "panel1", type: "panel", catalog_id: "panel", x: 0, y: 0 }),
  ];

  // Every catalog entry stamped once; power-ish categories join circuits.
  for (const entry of CATALOG) {
    if (entry.id === "panel") continue;
    const circuitFor: Record<string, string | null> = {
      receptacle: "c1",
      jbox: "c1",
      fixture: "c2",
      switch: "c2",
      thermostat: null,
      headend: null,
      fire: null,
    };
    devices.push(
      device({
        id: `d-${entry.id}`,
        type: entry.category,
        catalog_id: entry.id,
        x: 100 + devices.length * 10,
        y: 100,
        circuit_id: circuitFor[entry.category] ?? null,
        attrs: entry.category === "fixture" ? { dimming: true } : {},
      })
    );
  }

  const circuits = [
    circuit({ id: "c1", number: 1, ctype: "receptacle" }),
    circuit({ id: "c2", number: 2, ctype: "lighting", voltage: 277 }),
  ];

  const seg = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const routes: Route[] = [
    route({ id: "hr1", circuit_id: "c1", kind: "homerun", path: seg, plan_length_ft: 40 }),
    route({ id: "b1", circuit_id: "c1", kind: "branch", path: seg, plan_length_ft: 30 }),
    route({ id: "hr2", circuit_id: "c2", kind: "homerun", path: seg, plan_length_ft: 35 }),
    route({ id: "b2", circuit_id: "c2", kind: "branch", path: seg, plan_length_ft: 25 }),
    route({ id: "sl2", circuit_id: "c2", kind: "switchleg", path: seg, plan_length_ft: 8 }),
    // LV routes
    route({ id: "fa1", kind: "branch", path: seg, plan_length_ft: 60, sheet_id: SHEET, lv_system: "fire" }),
    route({ id: "fa2", kind: "homerun", path: seg, plan_length_ft: 20, sheet_id: SHEET, lv_system: "fire" }),
    route({ id: "dd1", kind: "homerun", path: seg, plan_length_ft: 45, sheet_id: SHEET, lv_system: "data" }),
  ];

  const lines: TakeoffLine[] = [];
  for (const branch_method of ["mc", "emt"] as const) {
    const { lines: built } = buildProjectTakeoff({
      circuits,
      devices,
      routes,
      settings: { ...DEFAULT_SETTINGS, branch_method },
      ftPerPxBySheetId: { [SHEET]: FT_PER_PX },
    });
    lines.push(...built);
  }
  return lines;
}

describe("labor_items → assemblies migration conversion", () => {
  it("converts a 100LF row to per-LF hours with a note", () => {
    const asm = laborRowToAssemblySeed({
      item_key: "#12 THHN cu",
      uom: "100LF",
      hours_per_uom: 4.0,
    });
    expect(asm.uom).toBe("LF");
    expect(asm.hours_l1).toBeCloseTo(0.04);
    expect(asm.notes).toContain("Converted from 4 hrs/100LF");
    expect(asm.pricing_mode).toBe("computed");
  });

  it("LF and EA rows pass through unchanged (hours → level 1)", () => {
    const lf = laborRowToAssemblySeed({
      item_key: '1/2" EMT',
      uom: "LF",
      hours_per_uom: 0.04,
      notes: "bench value",
    });
    expect(lf.uom).toBe("LF");
    expect(lf.hours_l1).toBe(0.04);
    expect(lf.notes).toBe("bench value");

    const ea = laborRowToAssemblySeed({
      item_key: "Blank cover",
      uom: "ea",
      hours_per_uom: 0.05,
    });
    expect(ea.uom).toBe("EA");
    expect(ea.hours_l1).toBe(0.05);
  });

  it("migration SQL performs the same ÷100 conversion and notes it", () => {
    const sql = readFileSync(
      join(__dirname, "../../supabase/migrations/012_estimating_db.sql"),
      "utf8"
    );
    expect(sql).toMatch(/hours_per_uom \/ 100/);
    expect(sql).toMatch(/Converted from/);
    expect(sql).toMatch(/normalize_item_key/);
  });
});

describe("seed covers every generated takeoff key", () => {
  const lines = syntheticTakeoffLines();
  const seeded = seedAssemblyRows("u1", new Set());

  it("synthetic takeoff emits a non-trivial line set", () => {
    // Sanity: power (both methods), device assemblies, and LV all present.
    expect(lines.length).toBeGreaterThan(40);
    expect(lines.some((l) => l.item.includes("MC cable"))).toBe(true);
    expect(lines.some((l) => l.item === '1/2" EMT')).toBe(true);
    expect(lines.some((l) => l.item === "16/2 FPL")).toBe(true);
    expect(lines.some((l) => l.item === "Cat6 plenum")).toBe(true);
    expect(lines.some((l) => l.item === "18/2 dimming")).toBe(true);
    expect(lines.some((l) => l.item === "Thermostat")).toBe(true);
  });

  it("zero missing keys against the seeded assemblies", () => {
    const asAssemblies = seeded.map((s) => ({
      name: s.name,
      name_normalized: s.name_normalized,
      pricing_mode: s.pricing_mode,
      hours_l1: null,
    }));
    const report = assemblyJoinReport(lines, asAssemblies);
    expect(report.missingKeys).toEqual([]);
    // Seeded placeholders are flat-priced, so they don't warn about hours.
    expect(report.computedNoHours).toEqual([]);
  });

  it("every enumerated key is unique after normalization", () => {
    const keys = enumerateTakeoffItemKeys().map((k) =>
      normalizeItemKey(k.name)
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("seed skips keys the labor migration already created", () => {
    const existing = new Set([normalizeItemKey('1/2" EMT')]);
    const rows = seedAssemblyRows("u1", existing);
    expect(rows.some((r) => r.name === '1/2" EMT')).toBe(false);
    expect(rows.length).toBe(enumerateTakeoffItemKeys().length - 1);
  });

  it("seeded placeholders are flat @ $0 with no hours", () => {
    for (const r of seeded) {
      expect(r.pricing_mode).toBe("flat");
      expect(r.flat_price).toBe(0);
    }
  });
});

describe("missing-assembly-data report", () => {
  const lines: TakeoffLine[] = [
    { circuit: "Ckt 1", item: '1/2" EMT', qty: 50, uom: "LF", notes: "" },
    { circuit: "Ckt 1", item: "Mystery widget", qty: 1, uom: "EA", notes: "" },
  ];

  it("lists keys with no assembly and computed assemblies without hours", () => {
    const report = assemblyJoinReport(lines, [
      {
        name: '1/2" EMT',
        name_normalized: normalizeItemKey('1/2" EMT'),
        pricing_mode: "computed",
        hours_l1: null,
      },
    ]);
    expect(report.missingKeys).toEqual(["Mystery widget"]);
    expect(report.computedNoHours).toEqual(['1/2" EMT']);
  });

  it("computed assembly WITH hours is clean", () => {
    const report = assemblyJoinReport(lines.slice(0, 1), [
      {
        name: "1/2\u201D EMT", // smart quote — normalized join
        name_normalized: normalizeItemKey("1/2\u201D EMT"),
        pricing_mode: "computed",
        hours_l1: 0.04,
      },
    ]);
    expect(report.missingKeys).toEqual([]);
    expect(report.computedNoHours).toEqual([]);
  });
});

describe("assemblies → hour rows (takeoff join)", () => {
  it("level-1 hours drive the Hours column; null hours excluded", () => {
    const rows = assembliesToLaborRows([
      { name: '1/2" EMT', uom: "LF", hours_l1: 0.04 },
      { name: "Blank cover", uom: "EA", hours_l1: null },
    ]);
    expect(rows).toEqual([
      { item_key: '1/2" EMT', uom: "LF", hours_per_uom: 0.04 },
    ]);
  });
});

describe("assembly_items qty math", () => {
  it("0.1 couplings per LF × 75 LF = 7.5 exact", () => {
    expect(assemblyItemQty(0.1, 75)).toBeCloseTo(7.5);
  });

  it("EA items round up at the circuit level (matches coupling ceil)", () => {
    expect(assemblyItemCircuitQty(0.1, 75, "EA")).toBe(8);
  });

  it("LF items stay exact at the circuit level", () => {
    expect(assemblyItemCircuitQty(1.05, 75, "LF")).toBeCloseTo(78.75);
  });
});

describe("estimating CSV imports", () => {
  it("assembly CSV round-trips and overwrites by normalized key", () => {
    const { rows, errors } = parseAssemblyCsv(
      [
        "name,uom,hours_l1,hours_l2,hours_l3,pricing_mode,flat_price",
        '"1/2"" EMT",LF,0.04,0.05,0.07,computed,',
        "1/2\u201D EMT,LF,0.06,,,computed,", // smart-quote dup — later wins
        "Blank cover,EA,,,,flat,1.25",
        "Bad row,XX,1,,,computed,",
      ].join("\n")
    );
    expect(errors).toHaveLength(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].hours_l1).toBe(0.06);
    expect(rows[1]).toMatchObject({
      name: "Blank cover",
      pricing_mode: "flat",
      flat_price: 1.25,
    });
  });

  it("materials CSV parses supplier and quote date", () => {
    const { rows, errors } = parseItemCsv(
      [
        "name,uom,cost_per_uom,supplier,quote_date",
        '"1/2"" EMT coupling",EA,0.42,CED,2026-07-01',
        "No cost row,EA,not-a-number,,",
      ].join("\n")
    );
    expect(errors).toHaveLength(1);
    expect(rows).toEqual([
      {
        name: '1/2" EMT coupling',
        uom: "EA",
        cost_per_uom: 0.42,
        supplier: "CED",
        quote_date: "2026-07-01",
      },
    ]);
  });
});

describe("estimating DB schema (migration 012)", () => {
  const sql = readFileSync(
    join(__dirname, "../../supabase/migrations/012_estimating_db.sql"),
    "utf8"
  );

  it("unique constraints block duplicate normalized names", () => {
    expect(sql).toMatch(/unique \(user_id, name_normalized, uom\)/); // items
    expect(sql).toMatch(/unique \(user_id, name_normalized\)\n\);/); // assemblies
  });

  it("RLS is owner-only on all three tables", () => {
    expect(sql).toMatch(/alter table items enable row level security/);
    expect(sql).toMatch(/alter table assemblies enable row level security/);
    expect(sql).toMatch(
      /alter table assembly_items enable row level security/
    );
    expect(sql).toMatch(
      /create policy "items_owner" on items\s+for all using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/
    );
    expect(sql).toMatch(
      /create policy "assemblies_owner" on assemblies\s+for all using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/
    );
    // assembly_items rows are owned through their parent assembly.
    expect(sql).toMatch(
      /create policy "assembly_items_owner" on assembly_items[\s\S]+?a\.user_id = auth\.uid\(\)/
    );
  });

  it("keeps labor_items (no drop) — frozen, not deleted", () => {
    expect(sql).not.toMatch(/drop table.*labor_items/);
  });
});
