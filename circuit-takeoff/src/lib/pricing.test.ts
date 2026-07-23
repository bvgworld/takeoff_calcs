import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeItemKey } from "./labor";
import {
  assemblyHours,
  assemblyUnitPrice,
  blendedRate,
  itemCostPerUom,
  loadedRate,
  priceTakeoffLines,
  seedLaborClassRows,
  totalExtPrice,
  type LaborClass,
} from "./pricing";
import { takeoffToCsv, type TakeoffLine } from "./takeoff";

function cls(
  partial: Partial<LaborClass> & Pick<LaborClass, "base_rate" | "crew_weight">
): LaborClass {
  return {
    id: "x",
    rate_table_id: "t1",
    class_name: "Class",
    burden_pct: 0,
    burden_flat_per_hr: 0,
    is_field: true,
    ...partial,
  };
}

describe("loaded rate", () => {
  it("base × (1 + burden%/100) + flat adder", () => {
    expect(
      loadedRate({ base_rate: 40, burden_pct: 25, burden_flat_per_hr: 5 })
    ).toBeCloseTo(55);
  });
});

describe("blended rate", () => {
  it("weights: 1 foreman @60, 3 journeymen @50, 2 apprentices @30 → 45.00", () => {
    const classes = [
      cls({ class_name: "Foreman", base_rate: 60, crew_weight: 1 }),
      cls({ class_name: "Journeyman", base_rate: 50, crew_weight: 3 }),
      cls({ class_name: "Apprentice", base_rate: 30, crew_weight: 2 }),
    ];
    const b = blendedRate(classes);
    expect(b.rate).toBeCloseTo(45.0); // (60 + 150 + 60) / 6
    expect(b.usedWeights).toBe(true);
  });

  it("non-field classes are excluded even with a weight", () => {
    const b = blendedRate([
      cls({ base_rate: 50, crew_weight: 1 }),
      cls({
        class_name: "PM",
        base_rate: 90,
        crew_weight: 5,
        is_field: false,
      }),
    ]);
    expect(b.rate).toBeCloseTo(50);
  });

  it("no weights → simple average of field classes, flagged", () => {
    const b = blendedRate([
      cls({ base_rate: 60, crew_weight: 0 }),
      cls({ base_rate: 30, crew_weight: 0 }),
      cls({ base_rate: 999, crew_weight: 0, is_field: false }),
    ]);
    expect(b.rate).toBeCloseTo(45);
    expect(b.usedWeights).toBe(false);
  });

  it("no field classes at all → null rate", () => {
    expect(
      blendedRate([cls({ base_rate: 90, crew_weight: 1, is_field: false })])
        .rate
    ).toBeNull();
  });
});

describe("hours per difficulty", () => {
  const asm = { hours_l1: 0.2, hours_l2: null, hours_l3: 0.5 };

  it("explicit hours_lN wins, not estimated", () => {
    expect(assemblyHours(asm, 1)).toEqual({ hoursPerUom: 0.2, estimated: false });
    expect(assemblyHours(asm, 3)).toEqual({ hoursPerUom: 0.5, estimated: false });
  });

  it("null hours_l2 falls back to hours_l1 × 1.25 and is FLAGGED", () => {
    const r = assemblyHours(asm, 2);
    expect(r.hoursPerUom).toBeCloseTo(0.25);
    expect(r.estimated).toBe(true);
  });

  it("null hours_l3 falls back to hours_l1 × 1.5 and is FLAGGED", () => {
    const r = assemblyHours({ ...asm, hours_l3: null }, 3);
    expect(r.hoursPerUom).toBeCloseTo(0.3);
    expect(r.estimated).toBe(true);
  });

  it("no hours at all → null, not estimated", () => {
    expect(
      assemblyHours({ hours_l1: null, hours_l2: null, hours_l3: null }, 2)
    ).toEqual({ hoursPerUom: null, estimated: false });
  });
});

describe("assembly unit price", () => {
  const itemsById = new Map([
    ["i1", { uom: "EA" as const, cost_per_uom: 4.2 }],
    ["i2", { uom: "EA" as const, cost_per_uom: 5.2 }],
    ["i100", { uom: "100LF" as const, cost_per_uom: 42 }],
  ]);

  it("flat override ignores hours and items", () => {
    const r = assemblyUnitPrice(
      {
        pricing_mode: "flat",
        flat_price: 12.34,
        hours_l1: 99,
        hours_l2: 99,
        hours_l3: 99,
        assembly_items: [{ item_id: "i1", qty_per_uom: 100 }],
      },
      3,
      45,
      itemsById
    );
    expect(r.unitPrice).toBe(12.34);
    expect(r.flat).toBe(true);
    expect(r.estimated).toBe(false);
  });

  it("computed EA: 0.15 hrs × $45 + $9.40 items = $16.15", () => {
    const r = assemblyUnitPrice(
      {
        pricing_mode: "computed",
        flat_price: null,
        hours_l1: 0.15,
        hours_l2: null,
        hours_l3: null,
        assembly_items: [
          { item_id: "i1", qty_per_uom: 1 }, // 4.20
          { item_id: "i2", qty_per_uom: 1 }, // 5.20
        ],
      },
      1,
      45,
      itemsById
    );
    expect(r.unitPrice).toBeCloseTo(16.15);
    expect(r.flat).toBe(false);
    expect(r.estimated).toBe(false);
  });

  it("100LF item cost inside an LF assembly converts to per-LF", () => {
    // $42/100LF wire, 1 LF per LF of assembly → $0.42 materials per LF.
    const r = assemblyUnitPrice(
      {
        pricing_mode: "computed",
        flat_price: null,
        hours_l1: 0.04,
        hours_l2: null,
        hours_l3: null,
        assembly_items: [{ item_id: "i100", qty_per_uom: 1 }],
      },
      1,
      45,
      itemsById
    );
    expect(r.unitPrice).toBeCloseTo(0.04 * 45 + 0.42); // 2.22
    expect(itemCostPerUom({ uom: "100LF", cost_per_uom: 42 })).toBeCloseTo(
      0.42
    );
  });

  it("computed with no blended rate → null (never silently zero)", () => {
    const r = assemblyUnitPrice(
      {
        pricing_mode: "computed",
        flat_price: null,
        hours_l1: 0.1,
        hours_l2: null,
        hours_l3: null,
      },
      1,
      null,
      new Map()
    );
    expect(r.unitPrice).toBeNull();
  });
});

describe("takeoff line pricing (live difficulty, no re-route)", () => {
  const assemblies = [
    {
      name: '1/2" EMT',
      name_normalized: normalizeItemKey('1/2" EMT'),
      uom: "LF" as const,
      hours_l1: 0.04,
      hours_l2: null,
      hours_l3: null,
      pricing_mode: "computed" as const,
      flat_price: null,
      assembly_items: [{ item_id: "coupling", qty_per_uom: 0.1 }],
    },
  ];
  const itemsById = new Map([
    ["coupling", { uom: "EA" as const, cost_per_uom: 1.0 }],
  ]);
  const lines: TakeoffLine[] = [
    {
      circuit: "Ckt 1",
      item: '1/2" EMT',
      qty: 75,
      uom: "LF",
      notes: "",
      sheetId: "s1",
    },
  ];

  it("difficulty 1: hours = 75 × 0.04 = 3, ext = qty × unit", () => {
    const [l] = priceTakeoffLines(lines, {
      assemblies,
      itemsById,
      blendedRatePerHr: 45,
      difficultyBySheetId: { s1: 1 },
    });
    expect(l.qty).toBe(75); // quantity untouched
    expect(l.hours).toBeCloseTo(3);
    expect(l.unit_price).toBeCloseTo(0.04 * 45 + 0.1); // 1.90
    expect(l.ext_price).toBeCloseTo(75 * 1.9); // 142.50
    expect(l.hours_estimated).toBeUndefined();
  });

  it("changing sheet difficulty changes hours and ext $, flags estimate, same qty", () => {
    const [l] = priceTakeoffLines(lines, {
      assemblies,
      itemsById,
      blendedRatePerHr: 45,
      difficultyBySheetId: { s1: 2 },
    });
    expect(l.qty).toBe(75); // still untouched — no re-route
    expect(l.hours).toBeCloseTo(75 * 0.04 * 1.25); // 3.75
    expect(l.hours_estimated).toBe(true); // fallback multiplier, flagged
    expect(l.unit_price).toBeCloseTo(0.04 * 1.25 * 45 + 0.1); // 2.35
    expect(l.ext_price).toBeCloseTo(75 * 2.35);
  });

  it("untagged (project-wide) lines price at L1", () => {
    const [l] = priceTakeoffLines(
      [{ circuit: "FA", item: '1/2" EMT', qty: 10, uom: "LF", notes: "" }],
      {
        assemblies,
        itemsById,
        blendedRatePerHr: 45,
        difficultyBySheetId: { s1: 3 },
      }
    );
    expect(l.hours).toBeCloseTo(0.4);
    expect(l.hours_estimated).toBeUndefined();
  });

  it("totalExtPrice sums priced lines only", () => {
    expect(
      totalExtPrice([{ ext_price: 10 }, { ext_price: null }, {}])
    ).toBeCloseTo(10);
  });
});

describe("CSV pricing columns", () => {
  it("gains hours, unit_price, ext_price, difficulty, rate_table", () => {
    const csv = takeoffToCsv(
      [
        {
          circuit: "Ckt 1",
          item: '1/2" EMT',
          qty: 75,
          uom: "LF",
          notes: "",
          hours: 3,
          unit_price: 1.9,
          ext_price: 142.5,
          difficulty: 1,
        },
      ],
      { rateTable: "Non-union 2026" }
    );
    const [header, row] = csv.replace("\uFEFF", "").split("\n");
    expect(header).toBe(
      "level,discipline,sheet,circuit,item,qty,uom,hours,unit_price,ext_price,difficulty,rate_table,notes"
    );
    expect(row).toContain('"3","1.9","142.5","1","Non-union 2026"');
  });
});

describe("seed classes for a new rate table", () => {
  it("Foreman…Estimator, PM + Estimator not field, all zeroed", () => {
    const rows = seedLaborClassRows("t1");
    expect(rows.map((r) => r.class_name)).toEqual([
      "Foreman",
      "Journeyman",
      "Apprentice 1",
      "Apprentice 2",
      "Apprentice 3",
      "Apprentice 4",
      "Apprentice 5",
      "Laborer",
      "Project Manager",
      "Estimator",
    ]);
    for (const r of rows) {
      expect(r.base_rate).toBe(0);
      expect(r.crew_weight).toBe(0);
      expect(r.is_field).toBe(
        r.class_name !== "Project Manager" && r.class_name !== "Estimator"
      );
    }
  });
});

describe("labor rates schema (migration 013)", () => {
  const sql = readFileSync(
    join(__dirname, "../../supabase/migrations/013_labor_rates.sql"),
    "utf8"
  );

  it("RLS owner-only on rate_tables; labor_classes owned via parent", () => {
    expect(sql).toMatch(/alter table rate_tables enable row level security/);
    expect(sql).toMatch(/alter table labor_classes enable row level security/);
    expect(sql).toMatch(
      /create policy "rate_tables_owner" on rate_tables\s+for all using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/
    );
    expect(sql).toMatch(
      /create policy "labor_classes_owner" on labor_classes[\s\S]+?t\.user_id = auth\.uid\(\)/
    );
  });

  it("sheets gain difficulty 1/2/3 defaulting to 1", () => {
    expect(sql).toMatch(
      /alter table sheets add column if not exists difficulty int not null default 1\s+check \(difficulty in \(1, 2, 3\)\)/
    );
  });
});
