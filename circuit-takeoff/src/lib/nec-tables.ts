/**
 * NEC table data for materials engine.
 * Values are authoritative for Phase 1.5 — assert exact numbers in tests.
 */

export type WireSize =
  | "14"
  | "12"
  | "10"
  | "8"
  | "6"
  | "4"
  | "3"
  | "2"
  | "1"
  | "1/0"
  | "2/0"
  | "3/0"
  | "4/0";

export type ConduitSize =
  | '1/2"'
  | '3/4"'
  | '1"'
  | '1-1/4"'
  | '1-1/2"'
  | '2"'
  | '2-1/2"'
  | '3"'
  | '4"';

/** EMT usable fill area, sq in — NEC Ch.9 Table 4, 40% column. */
export const EMT_FILL_40: Record<ConduitSize, number> = {
  '1/2"': 0.122,
  '3/4"': 0.213,
  '1"': 0.346,
  '1-1/4"': 0.598,
  '1-1/2"': 0.814,
  '2"': 1.342,
  '2-1/2"': 2.343,
  '3"': 3.538,
  '4"': 5.901,
};

export const CONDUIT_SIZES: ConduitSize[] = [
  '1/2"',
  '3/4"',
  '1"',
  '1-1/4"',
  '1-1/2"',
  '2"',
  '2-1/2"',
  '3"',
  '4"',
];

/** THHN/THWN-2 conductor areas, sq in — Table 5. */
export const THHN_AREA: Record<WireSize, number> = {
  "14": 0.0097,
  "12": 0.0133,
  "10": 0.0211,
  "8": 0.0366,
  "6": 0.0507,
  "4": 0.0824,
  "3": 0.0973,
  "2": 0.1158,
  "1": 0.1562,
  "1/0": 0.1855,
  "2/0": 0.2223,
  "3/0": 0.2679,
  "4/0": 0.3237,
};

/**
 * Copper ampacity, 75°C column (Table 310.16) with 240.4(D) small-conductor
 * caps applied (#14→15, #12→20, #10→30).
 */
export const AMPACITY_75_CAPPED: Record<WireSize, number> = {
  "14": 15,
  "12": 20,
  "10": 30,
  "8": 50,
  "6": 65,
  "4": 85,
  "3": 100,
  "2": 115,
  "1": 130,
  "1/0": 150,
  "2/0": 175,
  "3/0": 200,
  "4/0": 230,
};

/** THHN 90°C column (Table 310.16) — used as derating base. */
export const AMPACITY_90_THHN: Record<WireSize, number> = {
  "14": 25,
  "12": 30,
  "10": 40,
  "8": 55,
  "6": 75,
  "4": 95,
  "3": 110,
  "2": 130,
  "1": 145,
  "1/0": 170,
  "2/0": 195,
  "3/0": 225,
  "4/0": 260,
};

export const WIRE_SIZES: WireSize[] = [
  "14",
  "12",
  "10",
  "8",
  "6",
  "4",
  "3",
  "2",
  "1",
  "1/0",
  "2/0",
  "3/0",
  "4/0",
];

/** Circular mils for voltage-drop (Table 8 + Prompt 9 list). */
export const CM: Record<WireSize, number> = {
  "14": 4110,
  "12": 6530,
  "10": 10380,
  "8": 16510,
  "6": 26240,
  "4": 41740,
  "3": 52620,
  "2": 66360,
  "1": 83690,
  "1/0": 105600,
  "2/0": 133100,
  "3/0": 167800,
  "4/0": 211600,
};

export const VD_K_COPPER = 12.9;

/**
 * Derating multiplier by current-carrying conductor count — 310.15(C)(1).
 * Applied against the 90°C column for THHN.
 */
export function deratingMultiplier(ccc: number): number {
  if (ccc >= 10 && ccc <= 20) return 0.5;
  if (ccc >= 7 && ccc <= 9) return 0.7;
  if (ccc >= 4 && ccc <= 6) return 0.8;
  return 1;
}
