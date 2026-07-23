/**
 * Labor foundation — per-user labor units joined onto takeoff lines by
 * normalized item key. Display-only: qty × hours_per_uom.
 * No crew rates, difficulty factors, or pricing (Phase 3+).
 */

import type { TakeoffLine } from "./takeoff";

/**
 * ONE normalize function applied on BOTH sides of the labor join (saving
 * a library entry AND computing hours). Defeats the exact-string traps:
 * unicode quote variants (smart quotes / primes), stray whitespace, case.
 * Must stay in sync with the SQL backfill in migration 012.
 */
export function normalizeItemKey(s: string): string {
  return s
    .replace(/[\u201C\u201D\u2033]/g, '"') // “ ” ″ → "
    .replace(/[\u2018\u2019\u2032]/g, "'") // ‘ ’ ′ → '
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** UOM comparison is whitespace/case-insensitive ("LF" ≡ " lf "). */
export function normalizeUom(s: string): string {
  return s.trim().toUpperCase();
}

export type LaborSource = "company" | "licensed";

export type LaborItem = {
  id: string;
  user_id: string;
  item_key: string;
  uom: string;
  hours_per_uom: number;
  source: LaborSource;
  notes: string | null;
};

/** The columns that matter for the join and for CSV import/export. */
export type LaborRow = {
  item_key: string;
  uom: string;
  hours_per_uom: number;
};

/** Map keyed by normalized item key (the join side for library entries). */
export function laborMapByKey(items: LaborRow[]): Map<string, LaborRow> {
  return new Map(items.map((i) => [normalizeItemKey(i.item_key), i]));
}

/**
 * Attach hours to takeoff lines: qty × hours_per_uom when the item has a
 * labor entry whose UOM also matches, null otherwise (rendered as "—").
 * A key match with a different UOM (LF vs EA) does NOT join silently —
 * laborJoinReport surfaces it as a mismatch instead.
 */
export function attachLaborHours<T extends TakeoffLine>(
  lines: T[],
  items: LaborRow[]
): T[] {
  const map = laborMapByKey(items);
  return lines.map((l) => {
    const entry = map.get(normalizeItemKey(l.item));
    return {
      ...l,
      hours:
        entry && normalizeUom(entry.uom) === normalizeUom(l.uom)
          ? l.qty * entry.hours_per_uom
          : null,
    };
  });
}

/** Sum of non-null hours across lines. */
export function totalLaborHours(lines: { hours?: number | null }[]): number {
  let sum = 0;
  for (const l of lines) {
    if (l.hours != null) sum += l.hours;
  }
  return sum;
}

// ————— CSV import/export (item_key,uom,hours_per_uom) —————

const CSV_HEADER = "item_key,uom,hours_per_uom";

/** Quote a CSV field when needed (shared with estimating CSVs). */
export function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function laborToCsv(items: LaborRow[]): string {
  const body = items
    .map((i) =>
      [csvField(i.item_key), csvField(i.uom), csvField(i.hours_per_uom)].join(
        ","
      )
    )
    .join("\n");
  return `${CSV_HEADER}\n${body}\n`;
}

/** Split one CSV line honoring quotes and "" escapes (shared with estimating CSVs). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export type LaborCsvResult = {
  rows: LaborRow[];
  errors: string[];
};

/**
 * Parse a labor CSV (header row optional, BOM tolerated). Bad rows are
 * reported by line number and skipped; later duplicates of an item_key win.
 */
export function parseLaborCsv(text: string): LaborCsvResult {
  const rows = new Map<string, LaborRow>();
  const errors: string[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    if (idx === 0 && line.toLowerCase().startsWith("item_key")) return;
    const cells = splitCsvLine(line).map((c) => c.trim());
    if (cells.length < 3) {
      errors.push(`Line ${idx + 1}: expected item_key,uom,hours_per_uom`);
      return;
    }
    const [item_key, uom, hoursRaw] = cells;
    const hours = Number(hoursRaw);
    if (!item_key) {
      errors.push(`Line ${idx + 1}: empty item_key`);
      return;
    }
    if (!uom) {
      errors.push(`Line ${idx + 1}: empty uom`);
      return;
    }
    if (!Number.isFinite(hours) || hours < 0) {
      errors.push(`Line ${idx + 1}: bad hours_per_uom "${hoursRaw}"`);
      return;
    }
    // Dedupe by normalized key so "1/2” EMT" and '1/2" EMT' collapse.
    rows.set(normalizeItemKey(item_key), { item_key, uom, hours_per_uom: hours });
  });

  return { rows: Array.from(rows.values()), errors };
}
