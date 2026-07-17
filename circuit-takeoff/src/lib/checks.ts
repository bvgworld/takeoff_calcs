import { defaultWatts, sumReceptacleYokes } from "./catalog";
import type { CodeCheck, Device, ProjectSettings } from "./types";
import { applyLengthAdders } from "./routing";
import type { RouteKind } from "./types";

const K = 12.9;
const CM: Record<string, number> = { "12": 6530, "10": 10380, "8": 16510 };
const FILL: [string, number][] = [
  ['1/2"', 9],
  ['3/4"', 16],
  ['1"', 26],
  ['1-1/4"', 45],
];

export type CheckInput = {
  ctype: "lighting" | "receptacle";
  voltage: number;
  breakerAmps: number;
  devices: Device[];
  /** Cumulative one-way ft to farthest load (incl. stubs). */
  farthestFt: number;
  homeRunSharedCircuits?: number;
  settings: ProjectSettings;
};

export type CheckResult = {
  checks: CodeCheck[];
  va: number;
  amps: number;
  wireSize: string;
  emtSize: string;
};

function card(
  status: CodeCheck["status"],
  name: string,
  detail: string,
  why: string
): CodeCheck {
  return { status, name, detail, why };
}

/** Trainer four checks: loading, device count, fill/derating, voltage drop. */
export function runCircuitChecks(input: CheckInput): CheckResult {
  const {
    ctype,
    voltage: V,
    breakerAmps,
    devices,
    farthestFt,
    homeRunSharedCircuits = 1,
  } = input;

  const fixtures = devices.filter((d) => d.type === "fixture");
  const recepts = devices.filter((d) => d.type === "receptacle");
  const yokes = sumReceptacleYokes(recepts);
  const n = ctype === "lighting" ? fixtures.length : yokes;
  const avgW =
    ctype === "lighting"
      ? fixtures.reduce(
          (s, d) =>
            s + (d.attrs.watts ?? defaultWatts(d.catalog_id) ?? 36),
          0
        ) / Math.max(fixtures.length, 1) || 36
      : 36;

  const va =
    ctype === "lighting"
      ? fixtures.reduce(
          (s, d) =>
            s + (d.attrs.watts ?? defaultWatts(d.catalog_id) ?? 36),
          0
        )
      : yokes * 180;
  const amps = V > 0 ? va / V : 0;
  const continuous = ctype === "lighting";
  const limit = continuous ? breakerAmps * 0.8 : breakerAmps;
  const pct = limit > 0 ? (amps / limit) * 100 : 0;

  const farthest = Math.max(farthestFt, 1);
  const vd12p = (((2 * K * amps * farthest) / CM["12"]) / V) * 100;
  const vd10p = (((2 * K * amps * farthest) / CM["10"]) / V) * 100;
  let wireSize = "#12";
  let vdp = vd12p;
  if (vd12p > 3 && vd10p <= 3) {
    wireSize = "#10";
    vdp = vd10p;
  } else if (vd12p > 3) {
    wireSize = "#8";
    vdp = (((2 * K * amps * farthest) / CM["8"]) / V) * 100;
  }

  const ckts = Math.min(Math.max(homeRunSharedCircuits, 1), 3);
  const ccc = ckts * 2;
  const totalWires = ckts * 2 + 1;
  let emtSize = "—";
  for (const [sz, cap] of FILL) {
    if (totalWires <= cap) {
      emtSize = sz;
      break;
    }
  }
  let derFactor = 1;
  if (ccc >= 4 && ccc <= 6) derFactor = 0.8;
  else if (ccc >= 7 && ccc <= 9) derFactor = 0.7;
  else if (ccc >= 10 && ccc <= 20) derFactor = 0.5;
  const derAmp = 30 * derFactor;
  const derOk = derAmp >= 20;

  const maxDev =
    ctype === "lighting" ? Math.floor((V * 16) / avgW) : 13;
  const devOk = n <= maxDev;

  const loadStatus: CodeCheck["status"] =
    pct > 100 ? "fail" : pct <= 70 ? "pass" : "warn";

  const checks: CodeCheck[] = [
    card(
      loadStatus,
      "Circuit loading",
      `${va.toLocaleString()} VA → ${amps.toFixed(1)}A of ${limit}A usable (${pct.toFixed(0)}%).` +
        (continuous ? " Lighting continuous — 80% of breaker." : ""),
      "Breakers carry 80% continuously for loads lasting 3+ hours."
    ),
    card(
      devOk ? "pass" : "fail",
      ctype === "lighting" ? "Fixture count" : "Receptacle yokes (180 VA)",
      ctype === "lighting"
        ? `${n} fixtures @ ~${avgW.toFixed(0)}W. Max: ${maxDev}.`
        : `${yokes} yokes (${recepts.length} devices). Code max 13 on 20A; practice 6–8.`,
      ctype === "lighting"
        ? "Max fixtures = (V × 16A) ÷ W."
        : "NEC 180 VA per yoke (duplex=1, quad=2). Device amp rating does not change this check."
    ),
    card(
      derOk ? "pass" : "fail",
      "Home run pipe: fill & derating",
      `${totalWires} × #12 → ${emtSize} EMT. ${ccc} CCC → #12 @ ${derAmp.toFixed(0)}A.` +
        (derOk ? " OK for 20A." : " Split pipes or upsize."),
      "Derating: ×0.8 for 4–6 CCC, ×0.7 for 7–9, ×0.5 for 10+."
    ),
    card(
      vd12p <= 3 ? "pass" : wireSize === "#10" ? "warn" : "fail",
      "Voltage drop",
      `${farthest.toFixed(0)} ft. On #12: ${vd12p.toFixed(1)}%. ` +
        (vd12p <= 3
          ? "Under 3%."
          : `Upsize to ${wireSize} (${vdp.toFixed(1)}%).`),
      "NEC recommends ≤3% branch drop."
    ),
  ];

  return { checks, va, amps, wireSize, emtSize };
}

export function farthestFromRoutes(
  routes: { kind: RouteKind; plan_length_ft: number }[],
  settings: ProjectSettings
): number {
  const t = applyLengthAdders(routes, settings);
  // Approximate farthest as HR + branch + switchleg totals
  return t.homerun + t.branch + t.switchleg;
}
