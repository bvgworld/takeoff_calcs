/**
 * Pricing engine — single source of truth for rate/price math.
 * Pure functions only; takeoff QUANTITIES are never touched here.
 *
 *   loaded_rate  = base_rate × (1 + burden_pct/100) + burden_flat_per_hr
 *   blended rate = Σ(loaded × crew_weight) / Σ(crew_weight)
 *                  over field classes with weight > 0
 *   unit price   = flat_price                        (pricing_mode 'flat')
 *                = hours(difficulty) × blended rate
 *                  + Σ(qty_per_uom × item cost/uom)  (pricing_mode 'computed')
 *   hours(difficulty) uses hours_lN; when null it falls back to
 *   hours_l1 × default multiplier (L2 = 1.25, L3 = 1.5) and the row is
 *   FLAGGED as estimated — never silently.
 */

import type {
  Assembly,
  AssemblyItem,
  EstimatingItem,
} from "./estimating";
import { normalizeItemKey, normalizeUom } from "./labor";
import type { TakeoffLine } from "./takeoff";

export type Difficulty = 1 | 2 | 3;

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: "L1",
  2: "L2",
  3: "L3",
};

/** Fallback multipliers applied to hours_l1 when hours_lN is null. */
export const DIFFICULTY_FALLBACK_MULT: Record<Difficulty, number> = {
  1: 1,
  2: 1.25,
  3: 1.5,
};

// ————— Rate tables —————

export type RateTable = {
  id: string;
  user_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
};

export type LaborClass = {
  id: string;
  rate_table_id: string;
  class_name: string;
  base_rate: number;
  burden_pct: number;
  burden_flat_per_hr: number;
  is_field: boolean;
  crew_weight: number;
};

/** Seed classes for every new rate table — all editable/deletable. */
export const SEED_LABOR_CLASSES: Array<
  Pick<LaborClass, "class_name" | "is_field">
> = [
  { class_name: "Foreman", is_field: true },
  { class_name: "Journeyman", is_field: true },
  { class_name: "Apprentice 1", is_field: true },
  { class_name: "Apprentice 2", is_field: true },
  { class_name: "Apprentice 3", is_field: true },
  { class_name: "Apprentice 4", is_field: true },
  { class_name: "Apprentice 5", is_field: true },
  { class_name: "Laborer", is_field: true },
  { class_name: "Project Manager", is_field: false },
  { class_name: "Estimator", is_field: false },
];

export function seedLaborClassRows(
  rateTableId: string
): Array<Omit<LaborClass, "id">> {
  return SEED_LABOR_CLASSES.map((c) => ({
    rate_table_id: rateTableId,
    class_name: c.class_name,
    base_rate: 0,
    burden_pct: 0,
    burden_flat_per_hr: 0,
    is_field: c.is_field,
    crew_weight: 0,
  }));
}

/** loaded_rate = base × (1 + burden%/100) + flat adder. */
export function loadedRate(
  cls: Pick<LaborClass, "base_rate" | "burden_pct" | "burden_flat_per_hr">
): number {
  return (
    cls.base_rate * (1 + cls.burden_pct / 100) + cls.burden_flat_per_hr
  );
}

export type BlendedRate = {
  /** $/hr, null when the table has no field classes. */
  rate: number | null;
  /** False = no crew weights set; simple average fallback (warn in UI). */
  usedWeights: boolean;
};

/**
 * Σ(loaded × weight) / Σ(weight) over field classes with weight > 0.
 * No weights set → simple average of field classes, flagged.
 */
export function blendedRate(
  classes: Pick<
    LaborClass,
    "base_rate" | "burden_pct" | "burden_flat_per_hr" | "is_field" | "crew_weight"
  >[]
): BlendedRate {
  const field = classes.filter((c) => c.is_field);
  if (!field.length) return { rate: null, usedWeights: false };

  const weighted = field.filter((c) => c.crew_weight > 0);
  if (weighted.length) {
    const wSum = weighted.reduce((s, c) => s + c.crew_weight, 0);
    const sum = weighted.reduce(
      (s, c) => s + loadedRate(c) * c.crew_weight,
      0
    );
    return { rate: sum / wSum, usedWeights: true };
  }

  const avg =
    field.reduce((s, c) => s + loadedRate(c), 0) / field.length;
  return { rate: avg, usedWeights: false };
}

// ————— Hours per difficulty —————

export type HoursResolution = {
  /** Hours per assembly UOM, null when even hours_l1 is missing. */
  hoursPerUom: number | null;
  /** True when hours_lN was null and hours_l1 × multiplier was used. */
  estimated: boolean;
};

export function assemblyHours(
  a: Pick<Assembly, "hours_l1" | "hours_l2" | "hours_l3">,
  difficulty: Difficulty
): HoursResolution {
  const direct =
    difficulty === 1 ? a.hours_l1 : difficulty === 2 ? a.hours_l2 : a.hours_l3;
  if (direct != null) return { hoursPerUom: direct, estimated: false };
  if (a.hours_l1 != null) {
    return {
      hoursPerUom: a.hours_l1 * DIFFICULTY_FALLBACK_MULT[difficulty],
      estimated: difficulty !== 1,
    };
  }
  return { hoursPerUom: null, estimated: false };
}

// ————— Unit price —————

/** Item cost normalized to per-1-UOM (100LF prices convert to per-LF). */
export function itemCostPerUom(
  item: Pick<EstimatingItem, "uom" | "cost_per_uom">
): number {
  return item.uom === "100LF" ? item.cost_per_uom / 100 : item.cost_per_uom;
}

export type UnitPriceResult = {
  /** $ per assembly UOM; null when it cannot be computed. */
  unitPrice: number | null;
  /** True when the hours used were a difficulty fallback estimate. */
  estimated: boolean;
  /** True when pricing_mode = 'flat' (show the "F" badge). */
  flat: boolean;
};

export function assemblyUnitPrice(
  assembly: Pick<
    Assembly,
    "pricing_mode" | "flat_price" | "hours_l1" | "hours_l2" | "hours_l3"
  > & { assembly_items?: Pick<AssemblyItem, "item_id" | "qty_per_uom">[] },
  difficulty: Difficulty,
  blendedRatePerHr: number | null,
  itemsById: Map<string, Pick<EstimatingItem, "uom" | "cost_per_uom">>
): UnitPriceResult {
  if (assembly.pricing_mode === "flat") {
    return {
      unitPrice: assembly.flat_price ?? null,
      estimated: false,
      flat: true,
    };
  }

  const { hoursPerUom, estimated } = assemblyHours(assembly, difficulty);
  if (hoursPerUom == null || blendedRatePerHr == null) {
    return { unitPrice: null, estimated, flat: false };
  }

  let materials = 0;
  for (const ai of assembly.assembly_items ?? []) {
    const item = itemsById.get(ai.item_id);
    if (!item) continue;
    materials += ai.qty_per_uom * itemCostPerUom(item);
  }

  return {
    unitPrice: hoursPerUom * blendedRatePerHr + materials,
    estimated,
    flat: false,
  };
}

// ————— Takeoff line pricing —————

/** TakeoffLine with the pricing enrichment guaranteed to be applied. */
export type PricedTakeoffLine = TakeoffLine & { hours: number | null };

export type PricingInputs = {
  assemblies: Array<
    Pick<
      Assembly,
      | "name"
      | "name_normalized"
      | "uom"
      | "hours_l1"
      | "hours_l2"
      | "hours_l3"
      | "pricing_mode"
      | "flat_price"
    > & { assembly_items?: Pick<AssemblyItem, "item_id" | "qty_per_uom">[] }
  >;
  itemsById: Map<string, Pick<EstimatingItem, "uom" | "cost_per_uom">>;
  blendedRatePerHr: number | null;
  /** Sheet id → difficulty. Untagged (project-wide) lines use L1. */
  difficultyBySheetId: Record<string, Difficulty>;
};

/**
 * Attach hours + prices to takeoff lines. Pure — recomputes live when the
 * sheet difficulty changes, with zero effect on routing or quantities.
 */
export function priceTakeoffLines(
  lines: TakeoffLine[],
  inputs: PricingInputs
): PricedTakeoffLine[] {
  const byKey = new Map(
    inputs.assemblies.map((a) => [
      a.name_normalized || normalizeItemKey(a.name),
      a,
    ])
  );
  return lines.map((l) => {
    const asm = byKey.get(normalizeItemKey(l.item));
    const difficulty: Difficulty =
      (l.sheetId && inputs.difficultyBySheetId[l.sheetId]) || 1;
    if (!asm || normalizeUom(asm.uom) !== normalizeUom(l.uom)) {
      return { ...l, hours: null, difficulty };
    }
    const { hoursPerUom, estimated } = assemblyHours(asm, difficulty);
    const price = assemblyUnitPrice(
      asm,
      difficulty,
      inputs.blendedRatePerHr,
      inputs.itemsById
    );
    return {
      ...l,
      difficulty,
      hours: hoursPerUom != null ? l.qty * hoursPerUom : null,
      hours_estimated: estimated || price.estimated || undefined,
      unit_price: price.unitPrice,
      ext_price: price.unitPrice != null ? l.qty * price.unitPrice : null,
      priced_flat: price.flat || undefined,
    };
  });
}

/** Sum of non-null ext prices across lines. */
export function totalExtPrice(
  lines: { ext_price?: number | null }[]
): number {
  let sum = 0;
  for (const l of lines) {
    if (l.ext_price != null) sum += l.ext_price;
  }
  return sum;
}
