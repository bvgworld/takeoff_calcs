import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attachLaborHours,
  laborToCsv,
  normalizeItemKey,
  parseLaborCsv,
  totalLaborHours,
  type LaborRow,
} from "./labor";
import {
  rollupTakeoffTotals,
  takeoffToCsv,
  type TakeoffLine,
} from "./takeoff";

const LABOR: LaborRow[] = [
  { item_key: '1/2" EMT', uom: "LF", hours_per_uom: 0.04 },
  { item_key: "One-hole straps / hangers", uom: "EA", hours_per_uom: 0.05 },
];

const LINES: TakeoffLine[] = [
  { circuit: "Ckt 1", item: '1/2" EMT', qty: 50, uom: "LF", notes: "" },
  { circuit: "Ckt 2", item: '1/2" EMT', qty: 25, uom: "LF", notes: "" },
  {
    circuit: "Ckt 1",
    item: "One-hole straps / hangers",
    qty: 8,
    uom: "EA",
    notes: "",
  },
  { circuit: "Ckt 1", item: "#12 THHN", qty: 200, uom: "LF", notes: "" },
  { circuit: "Ckt 2", item: "20A 1-pole breaker", qty: 1, uom: "EA", notes: "" },
];

describe("labor join math", () => {
  it("hours = qty × hours_per_uom for matched items", () => {
    const withHours = attachLaborHours(LINES, LABOR);
    expect(withHours[0].hours).toBeCloseTo(50 * 0.04); // 2
    expect(withHours[1].hours).toBeCloseTo(25 * 0.04); // 1
    expect(withHours[2].hours).toBeCloseTo(8 * 0.05); // 0.4
  });

  it("items without a labor entry get hours=null (rendered as —)", () => {
    const withHours = attachLaborHours(LINES, LABOR);
    expect(withHours[3].hours).toBeNull();
    expect(withHours[4].hours).toBeNull();
  });

  it("totalLaborHours sums only matched lines", () => {
    const withHours = attachLaborHours(LINES, LABOR);
    expect(totalLaborHours(withHours)).toBeCloseTo(2 + 1 + 0.4);
  });

  it("rollup totals carry summed hours per item", () => {
    const totals = rollupTakeoffTotals(attachLaborHours(LINES, LABOR));
    const emt = totals.find((t) => t.item === '1/2" EMT')!;
    expect(emt.qty).toBe(75);
    expect(emt.hours).toBeCloseTo(75 * 0.04); // 3
    const thhn = totals.find((t) => t.item === "#12 THHN")!;
    expect(thhn.hours).toBeNull();
  });
});

describe("normalized join (one normalize function, both sides)", () => {
  it("smart-quote entry matches straight-quote takeoff item", () => {
    const smart: LaborRow[] = [
      { item_key: "1/2\u201D EMT", uom: "LF", hours_per_uom: 0.25 },
    ];
    const withHours = attachLaborHours(LINES, smart);
    expect(withHours[0].hours).toBeCloseTo(50 * 0.25);
  });

  it("trailing space and case differences match", () => {
    const sloppy: LaborRow[] = [
      { item_key: '  1/2" emt ', uom: "LF", hours_per_uom: 0.25 },
    ];
    expect(attachLaborHours(LINES, sloppy)[0].hours).toBeCloseTo(12.5);
    expect(normalizeItemKey('  1/2\u201D  EMT ')).toBe(
      normalizeItemKey('1/2" emt')
    );
  });

  it("UOM mismatch is NOT joined silently", () => {
    const wrongUom: LaborRow[] = [
      { item_key: '1/2" EMT', uom: "EA", hours_per_uom: 0.25 },
    ];
    expect(attachLaborHours(LINES, wrongUom)[0].hours).toBeNull();
  });
});

describe("labor CSV import round-trip", () => {
  it("export → import preserves keys, uoms, and hours (incl. quotes)", () => {
    const csv = laborToCsv(LABOR);
    const { rows, errors } = parseLaborCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual(LABOR);
  });

  it("accepts headerless files and reports bad lines", () => {
    const { rows, errors } = parseLaborCsv(
      ['"3/4"" EMT",LF,0.05', "MC connectors,EA,not-a-number", ""].join("\n")
    );
    expect(rows).toEqual([
      { item_key: '3/4" EMT', uom: "LF", hours_per_uom: 0.05 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("bad hours_per_uom");
  });

  it("later duplicate item_keys win", () => {
    const { rows } = parseLaborCsv(
      "item_key,uom,hours_per_uom\nA,LF,1\nA,LF,2\n"
    );
    expect(rows).toEqual([{ item_key: "A", uom: "LF", hours_per_uom: 2 }]);
  });
});

describe("takeoff CSV hours column", () => {
  it("matched rows carry hours, unmatched rows are empty", () => {
    const csv = takeoffToCsv(attachLaborHours(LINES, LABOR));
    const [header, row1, , , , row5] = csv.replace("\uFEFF", "").split("\n");
    expect(header).toBe(
      "level,discipline,sheet,circuit,item,qty,uom,hours,unit_price,ext_price,difficulty,rate_table,notes"
    );
    expect(row1).toContain('"50","LF","2"');
    expect(row5).toContain('"1","EA","",');
  });
});

describe("labor_items RLS (migration 010)", () => {
  const sql = readFileSync(
    join(__dirname, "../../supabase/migrations/010_labor_items.sql"),
    "utf8"
  );

  it("enables row level security", () => {
    expect(sql).toMatch(/alter table labor_items enable row level security/);
  });

  it("owner-only policy covers all verbs with using + with check", () => {
    expect(sql).toMatch(
      /create policy "labor_items_owner" on labor_items\s+for all using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/
    );
  });

  it("one labor value per user per item_key", () => {
    expect(sql).toMatch(/unique \(user_id, item_key\)/);
  });
});
