import { describe, expect, it } from "vitest";
import {
  findSheetNumber,
  findTitleGuess,
  identifyPage,
  inTitleBlock,
  isSheetNumberToken,
  suggestDiscipline,
  type PageTextItem,
} from "./sheet-id";

const W = 3024; // 42x30in sheet at 72dpi
const H = 2160;

function item(
  str: string,
  x: number,
  yFromBottom: number,
  h = 10
): PageTextItem {
  return { str, x, yFromBottom, h };
}

describe("sheet number regex", () => {
  it.each(["E101", "A1.1", "FE101", "M-101", "E1.1", "FA100", "T101"])(
    "accepts %s",
    (s) => {
      expect(isSheetNumberToken(s)).toBe(true);
    }
  );

  it.each([
    "2026", // date/year — no letter prefix
    '1/8"', // scale
    "1/8",
    "07/19/2026",
    "3/32\" = 1'-0\"",
    "ELEC", // letters only
    "ABCD101", // too many prefix letters
    "E10123", // too many digits
    "e101", // lowercase — PDF title blocks are uppercase
    "NO. 12345",
  ])("rejects %s", (s) => {
    expect(isSheetNumberToken(s)).toBe(false);
  });
});

describe("discipline mapping", () => {
  const cases: [string, string | null, string | null][] = [
    ["E101", null, "power"],
    ["E101", "OVERALL FLOOR PLAN - ELECTRICAL", "power"],
    ["E101", "FIRST FLOOR LIGHTING PLAN", "lighting"],
    ["L101", null, "lighting"],
    ["FA101", null, "fire"],
    ["FE101", null, "fire"],
    ["F101", null, "fire"],
    ["T101", null, "data"],
    ["TC101", null, "data"],
    ["D101", null, "demo"],
    ["AD101", null, "demo"],
    ["ED101", null, "demo"],
    ["A1.1", null, "other"],
    ["S201", null, "other"],
    ["M-101", null, "other"],
    ["P101", null, "other"],
    ["Q101", null, null], // unknown prefix — no guess, caller keeps default
  ];

  it.each(cases)("%s (title %s) → %s", (num, title, expected) => {
    expect(suggestDiscipline(num, title)).toBe(expected);
  });
});

describe("title-block region filtering", () => {
  it("picks E101 in the bottom-right over matching body text", () => {
    const items = [
      // Body text that happens to match the pattern (e.g. a detail ref),
      // in the middle of the page with a LARGER font.
      item("A1.1", W * 0.4, H * 0.5, 24),
      // The real sheet number in the title block (bottom-right corner).
      item("E101", W * 0.92, H * 0.04, 14),
    ];
    const found = findSheetNumber(items, W, H);
    expect(found?.token).toBe("E101");
  });

  it("falls back to the largest matching token anywhere when the title block has none", () => {
    const items = [
      item("A1.1", W * 0.3, H * 0.6, 8),
      item("E101", W * 0.4, H * 0.5, 20), // largest → wins
    ];
    expect(findSheetNumber(items, W, H)?.token).toBe("E101");
  });

  it("region check: right strip and bottom-right band qualify, body does not", () => {
    expect(inTitleBlock({ x: W * 0.9, yFromBottom: H * 0.5 }, W, H)).toBe(true);
    expect(inTitleBlock({ x: W * 0.6, yFromBottom: H * 0.1 }, W, H)).toBe(true);
    expect(inTitleBlock({ x: W * 0.4, yFromBottom: H * 0.5 }, W, H)).toBe(
      false
    );
    // Bottom-LEFT (e.g. a date stamp) is not title block.
    expect(inTitleBlock({ x: W * 0.1, yFromBottom: H * 0.05 }, W, H)).toBe(
      false
    );
  });

  it("guesses the nearest long line in the region as the title", () => {
    const anchor = item("E101", W * 0.92, H * 0.04, 14);
    const items = [
      anchor,
      item("OVERALL FLOOR PLAN - ELECTRICAL", W * 0.88, H * 0.08, 10),
      item("GENERAL NOTES AND LEGEND SHEET", W * 0.88, H * 0.6, 10), // farther
      item("SOME RANDOM BODY PARAGRAPH TEXT", W * 0.3, H * 0.5, 10), // not region
    ];
    expect(findTitleGuess(items, W, H, anchor)).toBe(
      "OVERALL FLOOR PLAN - ELECTRICAL"
    );
  });

  it("identifyPage: full happy path with discipline from prefix + title", () => {
    const items = [
      item("FIRST FLOOR LIGHTING PLAN", W * 0.88, H * 0.08, 10),
      item("E101", W * 0.92, H * 0.04, 14),
      item("2026", W * 0.9, H * 0.02, 6), // date in title block — rejected
    ];
    const id = identifyPage(items, W, H);
    expect(id.sheetNumber).toBe("E101");
    expect(id.title).toBe("FIRST FLOOR LIGHTING PLAN");
    expect(id.discipline).toBe("lighting");
  });

  it("identifyPage: textless page yields all nulls (never blocks)", () => {
    expect(identifyPage([], W, H)).toEqual({
      sheetNumber: null,
      title: null,
      discipline: null,
    });
  });
});
