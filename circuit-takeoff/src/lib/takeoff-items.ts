/**
 * Takeoff item names — single source of truth.
 *
 * Every item key the takeoff engine can emit is defined here (or in the
 * device catalog / SKU tables) and used by BOTH the generators
 * (takeoff.ts, lv-routing.ts) and the estimating-DB seed enumeration
 * (estimating.ts). Names cannot drift between the two.
 *
 * No quantity math lives here.
 */

// ————— Power (takeoff.ts) —————

/** "1/2\" EMT", "3/4\" EMT", … (LF) */
export function emtItem(size: string): string {
  return `${size} EMT`;
}

/** "1/2\" EMT couplings" (EA) */
export function emtCouplingsItem(size: string): string {
  return `${size} EMT couplings`;
}

/** "1/2\" EMT connectors" (EA) */
export function emtConnectorsItem(size: string): string {
  return `${size} EMT connectors`;
}

export const STRAPS_HANGERS = "One-hole straps / hangers"; // EA
export const MC_CONNECTORS_ANTISHORTS = "MC connectors + anti-shorts"; // EA
export const MC_CABLE_SUPPORTS = "MC cable supports"; // EA
export const HALF_INCH_CONNECTORS_COUPLINGS = '1/2" connectors + couplings'; // EA
export const BRANCH_STRAPS = "Straps"; // EA

/** "20A 1-pole breaker + termination" (EA) */
export function breakerItem(amps: number): string {
  return `${amps}A 1-pole breaker + termination`;
}

/**
 * Breaker sizes the seed enumerates. The UI currently only creates 20A
 * circuits; common sizes are included so hand-edited data still lands on
 * a seeded assembly. Keep next to breakerItem so name + domain live together.
 */
export const BREAKER_AMP_CHOICES = [15, 20, 30, 40, 50] as const;

/** "12/2 MC cable" (LF) — SKU domain is MC_SKUS in materials.ts. */
export function mcCableItem(sku: string): string {
  return `${sku} MC cable`;
}

// ————— Low voltage (lv-routing.ts) —————

export const LV_MUD_RING_1G = "1-gang mud ring"; // EA
export const LV_EMT_STUB = '3/4" EMT stub'; // LF
export const LV_EMT_STUB_CONNECTOR = '3/4" EMT connector'; // EA
export const LV_PULL_STRING = "Pull string"; // LF
export const LV_DATA_JACK = "Data jack"; // EA
export const LV_FACEPLATE = "Faceplate"; // EA
export const LV_PATCH_PANEL_PORT = "Patch-panel port"; // EA
