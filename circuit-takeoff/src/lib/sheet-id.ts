/**
 * Plan-set page identification — pure logic over extracted PDF text.
 *
 * Sheet numbers (E101, A1.1, FE101, M-101) live in the title block, which
 * on nearly every plan sits along the right edge or bottom-right of the
 * page. We prefer tokens found there; otherwise the largest matching
 * token anywhere wins. A failed guess never blocks — callers fall back
 * to "Page N".
 *
 * Coordinates follow PDF user space: x from the left, y from the BOTTOM.
 */

import type { Discipline } from "./types";

/** E101 · A1.1 · FE101 · M-101 — rejects dates ("2026") and scales ("1/8"). */
export const SHEET_NUMBER_RE = /^[A-Z]{1,3}[-.]?\d{1,3}(\.\d+)?$/;

export type PageTextItem = {
  str: string;
  /** Left edge, PDF units from the left of the page. */
  x: number;
  /** Baseline, PDF units from the BOTTOM of the page. */
  yFromBottom: number;
  /** Approximate glyph height (font size) in PDF units. */
  h: number;
};

export function isSheetNumberToken(s: string): boolean {
  return SHEET_NUMBER_RE.test(s.trim());
}

/**
 * Title-block region: the right ~15% strip, or the bottom ~15% band on
 * the right half of the page (wide-format title strips).
 */
export function inTitleBlock(
  item: Pick<PageTextItem, "x" | "yFromBottom">,
  pageW: number,
  pageH: number
): boolean {
  if (!(pageW > 0) || !(pageH > 0)) return false;
  const rightStrip = item.x >= pageW * 0.85;
  const bottomRightBand =
    item.yFromBottom <= pageH * 0.15 && item.x >= pageW * 0.5;
  return rightStrip || bottomRightBand;
}

/**
 * Find the sheet number: prefer matching tokens inside the title-block
 * region (largest font, then closest to the bottom-right corner); fall
 * back to the largest matching token anywhere on the page.
 */
export function findSheetNumber(
  items: PageTextItem[],
  pageW: number,
  pageH: number
): { token: string; item: PageTextItem } | null {
  const candidates = items.filter((i) => isSheetNumberToken(i.str));
  if (!candidates.length) return null;

  const cornerDist = (i: PageTextItem) =>
    Math.hypot(pageW - i.x, i.yFromBottom);
  const pick = (list: PageTextItem[]) =>
    [...list].sort((a, b) => b.h - a.h || cornerDist(a) - cornerDist(b))[0];

  const inRegion = candidates.filter((i) => inTitleBlock(i, pageW, pageH));
  const best = pick(inRegion.length ? inRegion : candidates);
  return { token: best.str.trim(), item: best };
}

/**
 * Guessed sheet title: the long text line in the title-block region
 * nearest to the sheet number (or to the bottom-right corner).
 */
export function findTitleGuess(
  items: PageTextItem[],
  pageW: number,
  pageH: number,
  anchor?: PageTextItem | null
): string | null {
  const ax = anchor?.x ?? pageW;
  const ay = anchor?.yFromBottom ?? 0;
  const lines = items.filter((i) => {
    const s = i.str.trim();
    return (
      s.length >= 10 &&
      /[A-Za-z]/.test(s) &&
      !isSheetNumberToken(s) &&
      inTitleBlock(i, pageW, pageH) &&
      i !== anchor
    );
  });
  if (!lines.length) return null;
  lines.sort(
    (a, b) =>
      Math.hypot(a.x - ax, a.yFromBottom - ay) -
      Math.hypot(b.x - ax, b.yFromBottom - ay)
  );
  return lines[0].str.trim();
}

/** Leading letter run of a sheet number: "FE101" → "FE". */
export function sheetNumberPrefix(sheetNumber: string): string {
  const m = sheetNumber.trim().match(/^[A-Z]{1,3}/);
  return m ? m[0] : "";
}

const PREFIX_MAP: Record<string, Discipline> = {
  L: "lighting",
  FA: "fire",
  FE: "fire",
  F: "fire",
  T: "data",
  TC: "data",
  D: "demo",
  AD: "demo",
  ED: "demo",
  A: "other",
  S: "other",
  M: "other",
  P: "other",
};

/**
 * Discipline from the sheet-number prefix. E → power unless a lighting
 * title is detected. Unknown prefixes return null (caller keeps default).
 */
export function suggestDiscipline(
  sheetNumber: string,
  title?: string | null
): Discipline | null {
  const prefix = sheetNumberPrefix(sheetNumber);
  if (!prefix) return null;
  if (prefix === "E") {
    return title && /light/i.test(title) ? "lighting" : "power";
  }
  const exact = PREFIX_MAP[prefix];
  if (exact) return exact;
  const first = PREFIX_MAP[prefix[0]];
  if (first) return first;
  if (prefix[0] === "E") {
    return title && /light/i.test(title) ? "lighting" : "power";
  }
  return null;
}

export type PageIdentification = {
  sheetNumber: string | null;
  title: string | null;
  discipline: Discipline | null;
};

export function identifyPage(
  items: PageTextItem[],
  pageW: number,
  pageH: number
): PageIdentification {
  const found = findSheetNumber(items, pageW, pageH);
  const title = findTitleGuess(items, pageW, pageH, found?.item ?? null);
  return {
    sheetNumber: found?.token ?? null,
    title,
    discipline: found ? suggestDiscipline(found.token, title) : null,
  };
}
