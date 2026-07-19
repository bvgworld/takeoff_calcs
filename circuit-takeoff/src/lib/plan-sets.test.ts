import { describe, expect, it } from "vitest";
import {
  buildSheetInserts,
  defaultSheetName,
  groupSheetsByLevel,
  planSetPath,
  sha256Hex,
  type PlanSetPageInput,
} from "./plan-sets";
import {
  filterTakeoffLines,
  rollupTakeoffTotals,
  takeoffToCsv,
  type TakeoffLine,
} from "./takeoff";

function pageInput(
  partial: Partial<PlanSetPageInput> &
    Pick<PlanSetPageInput, "sheetId" | "pageNumber">
): PlanSetPageInput {
  return {
    name: `CBK DD p${partial.pageNumber}`,
    discipline: "power",
    level: "Level 1",
    imagePath: `u1/proj1/${partial.sheetId}/raster.png`,
    imageW: 12000,
    imageH: 9000,
    renderDpi: 287,
    ...partial,
  };
}

describe("plan set sheet inserts", () => {
  const rows = buildSheetInserts({
    projectId: "proj1",
    sourcePdfPath: planSetPath("u1", "proj1", "abc123"),
    startSortOrder: 4,
    pages: [
      pageInput({ sheetId: "s-a", pageNumber: 7, discipline: "power" }),
      pageInput({
        sheetId: "s-b",
        pageNumber: 12,
        discipline: "lighting",
        level: "Level 2",
      }),
    ],
  });

  it("persists page_number per sheet (and mirrors legacy pdf_page)", () => {
    expect(rows[0].page_number).toBe(7);
    expect(rows[0].pdf_page).toBe(7);
    expect(rows[1].page_number).toBe(12);
    expect(rows[1].pdf_page).toBe(12);
  });

  it("sheets created from one PDF share source_pdf_path", () => {
    // uid-first path — storage RLS only allows {userId}/... keys.
    expect(rows[0].source_pdf_path).toBe("u1/proj1/set-abc123.pdf");
    expect(rows[1].source_pdf_path).toBe(rows[0].source_pdf_path);
    expect(rows[0].pdf_path).toBe(rows[0].source_pdf_path);
  });

  it("appends sort_order after existing sheets and carries metadata", () => {
    expect(rows.map((r) => r.sort_order)).toEqual([4, 5]);
    expect(rows[1].discipline).toBe("lighting");
    expect(rows[1].level).toBe("Level 2");
  });

  it("default name is '{filename} p{N}'", () => {
    expect(defaultSheetName("CBK DD Set.pdf", 3)).toBe("CBK DD Set p3");
    expect(defaultSheetName("CBK DD Set.PDF", 1)).toBe("CBK DD Set p1");
  });

  it("sha256Hex is stable and hex", async () => {
    const bytes = new TextEncoder().encode("plan set").buffer as ArrayBuffer;
    const h1 = await sha256Hex(bytes);
    const h2 = await sha256Hex(bytes);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("groupSheetsByLevel", () => {
  it("groups by level (empty last), disciplines ordered within a level", () => {
    const groups = groupSheetsByLevel([
      { level: "", discipline: "power" as const, sort_order: 1 },
      { level: "Level 1", discipline: "fire" as const, sort_order: 2 },
      { level: "Level 1", discipline: "lighting" as const, sort_order: 3 },
      { level: "Level 2", discipline: "power" as const, sort_order: 4 },
    ]);
    expect(groups.map((g) => g.level)).toEqual(["Level 1", "Level 2", ""]);
    // lighting before fire (canonical discipline order)
    expect(groups[0].sheets.map((s) => s.discipline)).toEqual([
      "lighting",
      "fire",
    ]);
  });
});

describe("takeoff CSV with plan-set columns", () => {
  const lines: TakeoffLine[] = [
    {
      circuit: "Ckt 1",
      item: '3/4" EMT',
      qty: 50,
      uom: "LF",
      notes: "",
      level: "Level 1",
      discipline: "power",
      sheet: "E101 Power",
    },
    { circuit: "Fire", item: "FPLR cable", qty: 100, uom: "LF", notes: "" },
  ];

  it("CSV includes level, discipline, sheet columns", () => {
    const csv = takeoffToCsv(lines);
    const [header, row1, row2] = csv.replace("\uFEFF", "").split("\n");
    expect(header).toBe(
      "level,discipline,sheet,circuit,item,qty,uom,hours,notes"
    );
    expect(row1).toContain('"Level 1","power","E101 Power","Ckt 1"');
    expect(row2.startsWith('"","",""')).toBe(true);
  });
});

describe("takeoff filtering math", () => {
  const lines: TakeoffLine[] = [
    {
      circuit: "Ckt 1",
      item: '1/2" EMT',
      qty: 40,
      uom: "LF",
      notes: "",
      level: "Level 1",
      discipline: "power",
      sheet: "E101",
    },
    {
      circuit: "Ckt 2",
      item: '1/2" EMT',
      qty: 25,
      uom: "LF",
      notes: "",
      level: "Level 2",
      discipline: "power",
      sheet: "E201",
    },
    {
      circuit: "Ckt 3",
      item: '1/2" EMT',
      qty: 15,
      uom: "LF",
      notes: "",
      level: "Level 1",
      discipline: "lighting",
      sheet: "E102",
    },
    // Untagged project-wide LV line.
    { circuit: "Data", item: '1/2" EMT', qty: 10, uom: "LF", notes: "" },
  ];

  it("discipline subtotals sum to the grand total", () => {
    const grand = rollupTakeoffTotals(lines);
    const grandQty = grand.find((t) => t.item === '1/2" EMT')!.qty;

    const disciplines = Array.from(
      new Set(lines.map((l) => l.discipline ?? ""))
    );
    let sum = 0;
    for (const d of disciplines) {
      const sub = rollupTakeoffTotals(
        filterTakeoffLines(lines, { kind: "discipline", discipline: d })
      );
      sum += sub.find((t) => t.item === '1/2" EMT')?.qty ?? 0;
    }
    expect(sum).toBe(grandQty);
    expect(grandQty).toBe(90);
  });

  it("level subtotals sum to the grand total", () => {
    const grand = rollupTakeoffTotals(lines);
    const grandQty = grand.find((t) => t.item === '1/2" EMT')!.qty;
    const levels = Array.from(new Set(lines.map((l) => l.level ?? "")));
    let sum = 0;
    for (const lv of levels) {
      const sub = rollupTakeoffTotals(
        filterTakeoffLines(lines, { kind: "level", level: lv })
      );
      sum += sub.find((t) => t.item === '1/2" EMT')?.qty ?? 0;
    }
    expect(sum).toBe(grandQty);
  });

  it("'all' filter is identity", () => {
    expect(filterTakeoffLines(lines, { kind: "all" })).toEqual(lines);
  });
});
