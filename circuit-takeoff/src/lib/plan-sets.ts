/**
 * Plan sets — one PDF upload becomes many sheets.
 * The source PDF is stored ONCE at plans/{userId}/{projectId}/set-{hash}.pdf;
 * every sheet created from it references that path plus a page_number.
 * Discipline + level are metadata (not folders) that drive sheet
 * grouping, takeoff sections, and CSV columns.
 */

import type { Discipline } from "./types";
import { DISCIPLINES } from "./types";

export { DISCIPLINES };
export type { Discipline };

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  lighting: "Lighting",
  power: "Power",
  fire: "Fire",
  data: "Data",
  demo: "Demo",
  site: "Site",
  other: "Other",
};

/** Badge classes — lighting amber, power perry-blue, fire signal-red, data teal, demo gray. */
export const DISCIPLINE_BADGE: Record<Discipline, string> = {
  lighting: "bg-amber-100 text-amber-800",
  power: "bg-blue-100 text-perry-blue",
  fire: "bg-red-100 text-perry-signal",
  data: "bg-teal-100 text-teal-800",
  demo: "bg-gray-200 text-gray-600",
  site: "bg-green-100 text-green-800",
  other: "bg-slate-100 text-slate-600",
};

/** Level group heading — empty level sorts last as "No level". */
export function levelLabel(level: string): string {
  return level.trim() || "No level";
}

/**
 * Shared set PDF storage path within the "plans" bucket. First folder
 * MUST be the auth user id — storage RLS only allows uid-first paths
 * (same reason the rasters live at `${userId}/${projectId}/...`).
 */
export function planSetPath(
  userId: string,
  projectId: string,
  hash: string
): string {
  return `${userId}/${projectId}/set-${hash}.pdf`;
}

/** Default sheet name for a picked page: "{filename} p{N}". */
export function defaultSheetName(filename: string, pageNumber: number): string {
  const base = filename.replace(/\.pdf$/i, "").trim() || "Sheet";
  return `${base} p${pageNumber}`;
}

/** SHA-256 hex of file bytes (crypto.subtle — browser and Node 20+). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type PlanSetPageInput = {
  sheetId: string;
  /** 1-based page in the source PDF. */
  pageNumber: number;
  name: string;
  discipline: Discipline;
  level: string;
  imagePath: string;
  imageW: number;
  imageH: number;
  renderDpi: number;
};

export type SheetInsertRow = {
  id: string;
  project_id: string;
  name: string;
  pdf_path: string;
  image_path: string;
  image_w: number;
  image_h: number;
  rotation: 0;
  render_dpi: number;
  /** Legacy column, kept in sync with page_number (sharp-zoom overlay). */
  pdf_page: number;
  page_number: number;
  source_pdf_path: string;
  discipline: Discipline;
  level: string;
  sort_order: number;
};

/**
 * Insert rows for the sheets created from one plan set. All rows share
 * source_pdf_path; each persists its own page_number; sort_order appends
 * after the project's existing sheets.
 */
export function buildSheetInserts(opts: {
  projectId: string;
  sourcePdfPath: string;
  startSortOrder: number;
  pages: PlanSetPageInput[];
}): SheetInsertRow[] {
  return opts.pages.map((p, i) => ({
    id: p.sheetId,
    project_id: opts.projectId,
    name: p.name,
    pdf_path: opts.sourcePdfPath,
    image_path: p.imagePath,
    image_w: p.imageW,
    image_h: p.imageH,
    rotation: 0,
    render_dpi: p.renderDpi,
    pdf_page: p.pageNumber,
    page_number: p.pageNumber,
    source_pdf_path: opts.sourcePdfPath,
    discipline: p.discipline,
    level: p.level.trim(),
    sort_order: opts.startSortOrder + i,
  }));
}

/**
 * Group sheets by level (order of first appearance by sort_order, empty
 * level last), then by discipline in canonical order within each level.
 */
export function groupSheetsByLevel<
  T extends { level: string; discipline: Discipline; sort_order: number },
>(sheets: T[]): { level: string; sheets: T[] }[] {
  const sorted = [...sheets].sort((a, b) => a.sort_order - b.sort_order);
  const byLevel = new Map<string, T[]>();
  for (const s of sorted) {
    const key = s.level.trim();
    const list = byLevel.get(key) || [];
    list.push(s);
    byLevel.set(key, list);
  }
  const dOrder = (d: Discipline) => DISCIPLINES.indexOf(d);
  const groups = Array.from(byLevel.entries()).map(([level, list]) => ({
    level,
    sheets: [...list].sort(
      (a, b) =>
        dOrder(a.discipline) - dOrder(b.discipline) ||
        a.sort_order - b.sort_order
    ),
  }));
  // Named levels first (stable), empty level last.
  groups.sort((a, b) => Number(a.level === "") - Number(b.level === ""));
  return groups;
}
