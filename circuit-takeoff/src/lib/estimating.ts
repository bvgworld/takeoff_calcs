/**
 * Estimating database — items (materials with price) + assemblies (what
 * gets stamped/taken off, labor hours per difficulty level, item list).
 *
 * Replaces the labor library as the takeoff join target. The join uses
 * the SAME normalize function as before (normalizeItemKey in labor.ts) —
 * one function, both sides, never forked.
 *
 * Pricing formula (per assembly unit, Prompt 12 wires the rate):
 *   computed unit price = hours[sheet difficulty] × blended labor rate
 *                       + Σ (item qty × item cost)
 *   unit price = flat_price when pricing_mode = 'flat'
 */

import { CATALOG } from "./catalog";
import {
  csvField,
  normalizeItemKey,
  normalizeUom,
  splitCsvLine,
  type LaborRow,
} from "./labor";
import { LV_CABLES, MC_SKUS, thhnItem } from "./materials";
import { CONDUIT_SIZES, WIRE_SIZES } from "./nec-tables";
import type { TakeoffLine } from "./takeoff";
import {
  BRANCH_STRAPS,
  BREAKER_AMP_CHOICES,
  HALF_INCH_CONNECTORS_COUPLINGS,
  LV_DATA_JACK,
  LV_EMT_STUB,
  LV_EMT_STUB_CONNECTOR,
  LV_FACEPLATE,
  LV_MUD_RING_1G,
  LV_PATCH_PANEL_PORT,
  LV_PULL_STRING,
  MC_CABLE_SUPPORTS,
  MC_CONNECTORS_ANTISHORTS,
  STRAPS_HANGERS,
  breakerItem,
  emtCouplingsItem,
  emtConnectorsItem,
  emtItem,
  mcCableItem,
} from "./takeoff-items";

export type ItemUom = "EA" | "LF" | "100LF";
export type AssemblyUom = "EA" | "LF";
export type PricingMode = "computed" | "flat";

export type EstimatingItem = {
  id: string;
  user_id: string;
  name: string;
  name_normalized: string;
  uom: ItemUom;
  cost_per_uom: number;
  supplier: string | null;
  quote_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Assembly = {
  id: string;
  user_id: string;
  name: string;
  name_normalized: string;
  uom: AssemblyUom;
  hours_l1: number | null;
  hours_l2: number | null;
  hours_l3: number | null;
  pricing_mode: PricingMode;
  flat_price: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AssemblyItem = {
  id: string;
  assembly_id: string;
  item_id: string;
  qty_per_uom: number;
};

// ————— Takeoff key enumeration (seed source) —————

export type TakeoffItemKey = { name: string; uom: AssemblyUom };

/**
 * Every item key the takeoff engine can generate, enumerated from the
 * generation code itself: device catalog assemblies, the power engine's
 * shared name constructors over their NEC domain tables, and the LV
 * catalog. NOT a hand-typed list — new catalog entries or SKUs appear
 * here automatically.
 */
export function enumerateTakeoffItemKeys(): TakeoffItemKey[] {
  const out = new Map<string, TakeoffItemKey>();
  const add = (name: string, uom: AssemblyUom) => {
    const key = normalizeItemKey(name);
    if (!out.has(key)) out.set(key, { name, uom });
  };

  // Device catalog assemblies (power, jbox, LV device hardware).
  for (const entry of CATALOG) {
    for (const line of entry.assembly) {
      add(line.item, line.uom);
    }
  }

  // Power engine — EMT family across every conduit size the sizer can pick.
  for (const size of CONDUIT_SIZES) {
    add(emtItem(size), "LF");
    add(emtCouplingsItem(size), "EA");
    add(emtConnectorsItem(size), "EA");
  }
  add(STRAPS_HANGERS, "EA");
  add(HALF_INCH_CONNECTORS_COUPLINGS, "EA");
  add(BRANCH_STRAPS, "EA");

  // Conductors across every wire size the sizer can pick.
  for (const size of WIRE_SIZES) {
    add(thhnItem(size), "LF");
  }
  for (const sku of MC_SKUS) {
    add(mcCableItem(sku), "LF");
  }
  add(MC_CONNECTORS_ANTISHORTS, "EA");
  add(MC_CABLE_SUPPORTS, "EA");

  for (const amps of BREAKER_AMP_CHOICES) {
    add(breakerItem(amps), "EA");
  }

  // LV catalog — cables + drop/stub hardware.
  for (const cable of LV_CABLES) {
    add(cable, "LF");
  }
  add(LV_MUD_RING_1G, "EA");
  add(LV_EMT_STUB, "LF");
  add(LV_EMT_STUB_CONNECTOR, "EA");
  add(LV_PULL_STRING, "LF");
  add(LV_DATA_JACK, "EA");
  add(LV_FACEPLATE, "EA");
  add(LV_PATCH_PANEL_PORT, "EA");

  return Array.from(out.values());
}

/** Insert-ready placeholder rows for keys missing from the user's DB. */
export function seedAssemblyRows(
  userId: string,
  existingNormalized: Set<string>
): Array<{
  user_id: string;
  name: string;
  name_normalized: string;
  uom: AssemblyUom;
  pricing_mode: PricingMode;
  flat_price: number;
  notes: string;
}> {
  return enumerateTakeoffItemKeys()
    .filter((k) => !existingNormalized.has(normalizeItemKey(k.name)))
    .map((k) => ({
      user_id: userId,
      name: k.name,
      name_normalized: normalizeItemKey(k.name),
      uom: k.uom,
      pricing_mode: "flat" as const,
      flat_price: 0,
      notes: "Seeded placeholder — set hours or a flat price",
    }));
}

// ————— labor_items → assemblies migration (TS mirror of migration 012) —————

/**
 * Mirrors the SQL in 012_estimating_db.sql: hours become level-1 hours;
 * 100LF rows are stored per-LF (÷100) with the conversion noted.
 */
export function laborRowToAssemblySeed(row: {
  item_key: string;
  uom: string;
  hours_per_uom: number;
  notes?: string | null;
}): {
  name: string;
  name_normalized: string;
  uom: AssemblyUom;
  hours_l1: number;
  pricing_mode: PricingMode;
  notes: string | null;
} {
  const uom = normalizeUom(row.uom);
  const per100 = uom === "100LF";
  return {
    name: row.item_key,
    name_normalized: normalizeItemKey(row.item_key),
    uom: per100 ? "LF" : (uom as AssemblyUom),
    hours_l1: per100 ? row.hours_per_uom / 100 : row.hours_per_uom,
    pricing_mode: "computed",
    notes: per100
      ? `${row.notes ? `${row.notes} · ` : ""}Converted from ${row.hours_per_uom} hrs/100LF`
      : (row.notes ?? null),
  };
}

// ————— Takeoff join —————

/**
 * Assemblies → hour rows for attachLaborHours (level-1 hours until sheet
 * difficulty arrives in Prompt 12). Computed assemblies with null hours
 * are excluded — their lines render "—" and the banner reports them.
 */
export function assembliesToLaborRows(
  assemblies: Pick<Assembly, "name" | "uom" | "hours_l1">[]
): LaborRow[] {
  return assemblies
    .filter((a) => a.hours_l1 != null)
    .map((a) => ({
      item_key: a.name,
      uom: a.uom,
      hours_per_uom: a.hours_l1 as number,
    }));
}

export type AssemblyJoinReport = {
  /** Takeoff keys with no assembly at all (should be zero after seed). */
  missingKeys: string[];
  /** Assemblies on this takeoff in computed mode with no hours entered. */
  computedNoHours: string[];
};

/** Missing-assembly-data report for the takeoff banner. */
export function assemblyJoinReport(
  lines: TakeoffLine[],
  assemblies: Pick<
    Assembly,
    "name" | "name_normalized" | "pricing_mode" | "hours_l1"
  >[]
): AssemblyJoinReport {
  const byKey = new Map(
    assemblies.map((a) => [a.name_normalized || normalizeItemKey(a.name), a])
  );
  const missing = new Map<string, string>();
  const noHours = new Map<string, string>();
  for (const l of lines) {
    const key = normalizeItemKey(l.item);
    const asm = byKey.get(key);
    if (!asm) {
      if (!missing.has(key)) missing.set(key, l.item);
    } else if (asm.pricing_mode === "computed" && asm.hours_l1 == null) {
      if (!noHours.has(key)) noHours.set(key, l.item);
    }
  }
  const sort = (m: Map<string, string>) =>
    Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  return { missingKeys: sort(missing), computedNoHours: sort(noHours) };
}

// ————— assembly_items quantity math —————

/** Exact item quantity for an assembly line: qty_per_uom × assembly qty. */
export function assemblyItemQty(
  qtyPerUom: number,
  assemblyQty: number
): number {
  return qtyPerUom * assemblyQty;
}

/**
 * Display rule at the CIRCUIT level: EA items round up (matching how the
 * takeoff already ceils couplings); LF/100LF stay exact.
 * 0.1 couplings/LF × 75 LF = 7.5 → 8 EA.
 */
export function assemblyItemCircuitQty(
  qtyPerUom: number,
  assemblyQty: number,
  itemUom: ItemUom
): number {
  const exact = assemblyItemQty(qtyPerUom, assemblyQty);
  return itemUom === "EA" ? Math.ceil(exact) : exact;
}

// ————— CSV import (assemblies + materials) —————

const ASSEMBLY_CSV_HEADER =
  "name,uom,hours_l1,hours_l2,hours_l3,pricing_mode,flat_price";
const ITEM_CSV_HEADER = "name,uom,cost_per_uom,supplier,quote_date";

export type AssemblyCsvRow = {
  name: string;
  uom: AssemblyUom;
  hours_l1: number | null;
  hours_l2: number | null;
  hours_l3: number | null;
  pricing_mode: PricingMode;
  flat_price: number | null;
};

export type ItemCsvRow = {
  name: string;
  uom: ItemUom;
  cost_per_uom: number;
  supplier: string | null;
  quote_date: string | null;
};

export type CsvParseResult<T> = { rows: T[]; errors: string[] };

function parseOptionalNumber(
  raw: string,
  what: string,
  lineNo: number,
  errors: string[]
): number | null | undefined {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    errors.push(`Line ${lineNo}: bad ${what} "${raw}"`);
    return undefined;
  }
  return n;
}

/**
 * Parse an assemblies CSV (header optional, BOM tolerated). Bad rows are
 * reported and skipped; later duplicates of a normalized name win —
 * import overwrites by normalized key, same behavior as the labor CSV.
 */
export function parseAssemblyCsv(text: string): CsvParseResult<AssemblyCsvRow> {
  const rows = new Map<string, AssemblyCsvRow>();
  const errors: string[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    if (idx === 0 && line.toLowerCase().startsWith("name,")) return;
    const cells = splitCsvLine(line).map((c) => c.trim());
    if (cells.length < 2) {
      errors.push(`Line ${idx + 1}: expected ${ASSEMBLY_CSV_HEADER}`);
      return;
    }
    const [name, uomRaw, l1Raw, l2Raw, l3Raw, modeRaw, flatRaw] = cells;
    if (!name) {
      errors.push(`Line ${idx + 1}: empty name`);
      return;
    }
    const uom = normalizeUom(uomRaw);
    if (uom !== "EA" && uom !== "LF") {
      errors.push(`Line ${idx + 1}: uom must be EA or LF, got "${uomRaw}"`);
      return;
    }
    const hours_l1 = parseOptionalNumber(l1Raw ?? "", "hours_l1", idx + 1, errors);
    const hours_l2 = parseOptionalNumber(l2Raw ?? "", "hours_l2", idx + 1, errors);
    const hours_l3 = parseOptionalNumber(l3Raw ?? "", "hours_l3", idx + 1, errors);
    if (
      hours_l1 === undefined ||
      hours_l2 === undefined ||
      hours_l3 === undefined
    ) {
      return;
    }
    const mode = (modeRaw || "computed").toLowerCase();
    if (mode !== "computed" && mode !== "flat") {
      errors.push(
        `Line ${idx + 1}: pricing_mode must be computed or flat, got "${modeRaw}"`
      );
      return;
    }
    const flat_price = parseOptionalNumber(
      flatRaw ?? "",
      "flat_price",
      idx + 1,
      errors
    );
    if (flat_price === undefined) return;
    rows.set(normalizeItemKey(name), {
      name,
      uom,
      hours_l1,
      hours_l2,
      hours_l3,
      pricing_mode: mode,
      flat_price,
    });
  });

  return { rows: Array.from(rows.values()), errors };
}

/** Parse a materials CSV (name, uom, cost_per_uom, supplier, quote_date). */
export function parseItemCsv(text: string): CsvParseResult<ItemCsvRow> {
  const rows = new Map<string, ItemCsvRow>();
  const errors: string[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    if (idx === 0 && line.toLowerCase().startsWith("name,")) return;
    const cells = splitCsvLine(line).map((c) => c.trim());
    if (cells.length < 3) {
      errors.push(`Line ${idx + 1}: expected ${ITEM_CSV_HEADER}`);
      return;
    }
    const [name, uomRaw, costRaw, supplier, quoteDate] = cells;
    if (!name) {
      errors.push(`Line ${idx + 1}: empty name`);
      return;
    }
    const uom = normalizeUom(uomRaw);
    if (uom !== "EA" && uom !== "LF" && uom !== "100LF") {
      errors.push(
        `Line ${idx + 1}: uom must be EA, LF, or 100LF, got "${uomRaw}"`
      );
      return;
    }
    const cost = Number(costRaw);
    if (!Number.isFinite(cost) || cost < 0) {
      errors.push(`Line ${idx + 1}: bad cost_per_uom "${costRaw}"`);
      return;
    }
    rows.set(`${normalizeItemKey(name)}|${uom}`, {
      name,
      uom,
      cost_per_uom: cost,
      supplier: supplier || null,
      quote_date: quoteDate || null,
    });
  });

  return { rows: Array.from(rows.values()), errors };
}

export function assembliesToCsv(
  assemblies: Pick<
    Assembly,
    | "name"
    | "uom"
    | "hours_l1"
    | "hours_l2"
    | "hours_l3"
    | "pricing_mode"
    | "flat_price"
  >[]
): string {
  const body = assemblies
    .map((a) =>
      [
        csvField(a.name),
        a.uom,
        a.hours_l1 ?? "",
        a.hours_l2 ?? "",
        a.hours_l3 ?? "",
        a.pricing_mode,
        a.flat_price ?? "",
      ].join(",")
    )
    .join("\n");
  return `${ASSEMBLY_CSV_HEADER}\n${body}\n`;
}
