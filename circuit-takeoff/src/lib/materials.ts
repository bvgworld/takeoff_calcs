/**
 * Materials engine — conduit fill, wire sizing, cable SKUs.
 * Pure functions; no NM/Romex.
 */

import {
  AMPACITY_75_CAPPED,
  AMPACITY_90_THHN,
  CM,
  CONDUIT_SIZES,
  EMT_FILL_40,
  THHN_AREA,
  VD_K_COPPER,
  WIRE_SIZES,
  deratingMultiplier,
  type ConduitSize,
  type WireSize,
} from "./nec-tables";
import { mcCableItem } from "./takeoff-items";

export type ConductorGroup = { size: WireSize; count: number };

export type SizeWireInput = {
  breakerAmps: number;
  /** Current-carrying conductors in the raceway (hots + neutrals). */
  cccInRaceway: number;
  oneWayFt: number;
  volts: number;
  loadAmps: number;
};

export type SizeWireResult = {
  size: WireSize;
  label: string; // "#12"
  vdPercent: number;
  deratedAmpacity: number;
  cappedAmpacity: number;
};

/** Sum Table 5 areas; return smallest EMT whose 40% fill fits. */
export function sizeConduit(conductors: ConductorGroup[]): ConduitSize {
  let area = 0;
  for (const g of conductors) {
    const a = THHN_AREA[g.size];
    if (a == null) throw new Error(`Unknown wire size: ${g.size}`);
    area += a * g.count;
  }
  for (const sz of CONDUIT_SIZES) {
    if (area <= EMT_FILL_40[sz]) return sz;
  }
  return '4"';
}

export function voltageDropPercent(
  size: WireSize,
  loadAmps: number,
  oneWayFt: number,
  volts: number
): number {
  if (!(volts > 0)) return Infinity;
  const cm = CM[size];
  return (((2 * VD_K_COPPER * loadAmps * oneWayFt) / cm) / volts) * 100;
}

/**
 * Smallest wire where:
 * (a) capped 75°C ampacity ≥ breaker
 * (b) derated 90°C ampacity ≥ breaker
 * (c) VD ≤ 3% at loadAmps
 */
export function sizeWire(input: SizeWireInput): SizeWireResult {
  const { breakerAmps, cccInRaceway, oneWayFt, volts, loadAmps } = input;
  const der = deratingMultiplier(cccInRaceway);
  const ft = Math.max(oneWayFt, 1);
  const load = Math.max(loadAmps, 0);

  for (const size of WIRE_SIZES) {
    const capped = AMPACITY_75_CAPPED[size];
    const derated = AMPACITY_90_THHN[size] * der;
    if (capped < breakerAmps) continue;
    if (derated < breakerAmps) continue;
    const vd = voltageDropPercent(size, load, ft, volts);
    if (vd > 3) continue;
    return {
      size,
      label: `#${size}`,
      vdPercent: vd,
      deratedAmpacity: derated,
      cappedAmpacity: capped,
    };
  }

  // Fallback: largest size even if VD still high
  const size = WIRE_SIZES[WIRE_SIZES.length - 1];
  return {
    size,
    label: `#${size}`,
    vdPercent: voltageDropPercent(size, load, ft, volts),
    deratedAmpacity: AMPACITY_90_THHN[size] * der,
    cappedAmpacity: AMPACITY_75_CAPPED[size],
  };
}

/** Whether #12 alone can serve this breaker under raceway derating. */
export function deratingOkFor12(
  breakerAmps: number,
  cccInRaceway: number
): boolean {
  return AMPACITY_90_THHN["12"] * deratingMultiplier(cccInRaceway) >= breakerAmps;
}

/** Commercial MC / THHN / LV cable SKUs — no NM/Romex. */
export const MC_SKUS = [
  "14/2",
  "12/2",
  "12/3",
  "12/4",
  "10/2",
  "10/3",
  "8/3",
] as const;

export type McSku = (typeof MC_SKUS)[number];

export const LV_CABLES = [
  "18/2 dimming",
  "16/2 FPL",
  "14/2 FPL",
  "Cat6 plenum",
  "Cat5e plenum",
  "Cat6 riser",
] as const;

/**
 * Pick MC takeoff item for branch runs.
 * `insulatedCount` is insulated conductors (2 = /2 with ground, 3 = /3, …).
 */
export function pickMcCable(
  wireSize: WireSize,
  insulatedCount = 2
): string {
  const n = Math.min(Math.max(Math.round(insulatedCount), 2), 4);
  const candidates = MC_SKUS.filter((s) => {
    const [awg, cnt] = s.split("/");
    return awg === wireSize && Number(cnt) === n;
  });
  if (candidates.length) return mcCableItem(candidates[0]);

  // Prefer same AWG with closest conductor count, else nearest smaller AWG /2
  const sameAwg = MC_SKUS.filter((s) => s.startsWith(`${wireSize}/`));
  if (sameAwg.length) {
    const best = sameAwg.reduce((a, b) => {
      const da = Math.abs(Number(a.split("/")[1]) - n);
      const db = Math.abs(Number(b.split("/")[1]) - n);
      return db < da ? b : a;
    });
    return mcCableItem(best);
  }

  // Walk up sizes until we find a /2
  const idx = WIRE_SIZES.indexOf(wireSize);
  for (let i = Math.max(idx, 0); i < WIRE_SIZES.length; i++) {
    const sku = `${WIRE_SIZES[i]}/2` as McSku;
    if ((MC_SKUS as readonly string[]).includes(sku)) {
      return mcCableItem(sku);
    }
  }
  return mcCableItem("12/2");
}

export function thhnItem(wireSize: WireSize): string {
  return `#${wireSize} THHN cu`;
}

export function parseWireLabel(label: string): WireSize {
  const s = label.replace(/^#/, "") as WireSize;
  if (!(s in THHN_AREA)) return "12";
  return s;
}
