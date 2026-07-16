import type { CodeCheck, Device, ProjectSettings } from "./types";

const K = 12.9;
const CM: Record<string, number> = { "12": 6530, "10": 10380, "8": 16510 };
const FILL: [string, number][] = [
  ['1/2"', 9],
  ['3/4"', 16],
  ['1"', 26],
  ['1-1/4"', 45],
];

export type CircuitCheckInput = {
  ctype: "lighting" | "receptacle";
  voltage: number;
  breakerAmps: number;
  devices: Device[];
  farthestPlanFt: number;
  homeRunSharedCircuits?: number;
  settings: ProjectSettings;
};

export type CircuitCheckResult = {
  checks: CodeCheck[];
  va: number;
  amps: number;
  wireSize: string;
  emtSize: string;
  maxDev: number;
};

function card(
  status: CodeCheck["status"],
  name: string,
  detail: string,
  why: string
): CodeCheck {
  return { status, name, detail, why };
}

export function runCodeChecks(input: CircuitCheckInput): CircuitCheckResult {
  const {
    ctype,
    voltage: V,
    devices,
    farthestPlanFt,
    homeRunSharedCircuits = 3,
  } = input;

  const fixtures = devices.filter((d) => d.type === "fixture");
  const recepts = devices.filter((d) => d.type === "receptacle");
  const n = ctype === "lighting" ? fixtures.length : recepts.length;
  const w =
    ctype === "lighting"
      ? fixtures.reduce((s, d) => s + (d.attrs.watts ?? 36), 0) /
          Math.max(fixtures.length, 1) || 36
      : 0;

  const va =
    ctype === "lighting"
      ? fixtures.reduce((s, d) => s + (d.attrs.watts ?? 36), 0)
      : recepts.length * 180;
  const amps = V > 0 ? va / V : 0;
  const continuous = ctype === "lighting";
  const limit = continuous ? input.breakerAmps * 0.8 : input.breakerAmps;
  const pct = limit > 0 ? (amps / limit) * 100 : 0;

  const farthest = Math.max(farthestPlanFt, 1);
  const vd12 = (2 * K * amps * farthest) / CM["12"];
  const vd10 = (2 * K * amps * farthest) / CM["10"];
  const vd12p = (vd12 / V) * 100;
  const vd10p = (vd10 / V) * 100;
  let wireSize = "#12";
  let vdp = vd12p;
  if (vd12p > 3 && vd10p <= 3) {
    wireSize = "#10";
    vdp = vd10p;
  } else if (vd12p > 3) {
    wireSize = "#8";
    vdp = (((2 * K * amps * farthest) / CM["8"]) / V) * 100;
  }

  const ckts = homeRunSharedCircuits;
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

  const avgW = w || 36;
  const maxDev =
    ctype === "lighting" ? Math.floor((V * 16) / avgW) : 13;
  const devOk = n <= maxDev;

  const checks: CodeCheck[] = [];

  const loadStatus =
    pct > 100 ? "fail" : pct <= 70 ? "pass" : pct <= 85 ? "warn" : "warn";
  checks.push(
    card(
      loadStatus,
      "Circuit loading",
      `${va.toLocaleString()} VA → ${amps.toFixed(1)}A of ${limit}A usable (${pct.toFixed(0)}%).` +
        (continuous
          ? " Lighting is a continuous load — 80% of the breaker."
          : ""),
      "Breakers can only carry 80% of their rating for loads lasting 3+ hours (like lighting)."
    )
  );

  checks.push(
    card(
      devOk ? "pass" : "fail",
      ctype === "lighting" ? "Fixture count" : "Receptacle count (180 VA rule)",
      ctype === "lighting"
        ? `${n} fixtures @ ~${avgW.toFixed(0)}W. Math max: ${maxDev}.`
        : `${n} receptacles. Code max on a 20A circuit: 13 (2400 VA ÷ 180 VA).`,
      ctype === "lighting"
        ? "Max fixtures = (volts × 16A) ÷ watts per fixture."
        : "NEC assigns every commercial receptacle 180 VA for planning."
    )
  );

  checks.push(
    card(
      derOk ? "pass" : "fail",
      "Home run pipe: fill & derating",
      `${totalWires} × #12 THHN → ${emtSize} EMT by fill. ${ccc} CCC → #12 derated to ${derAmp.toFixed(0)}A` +
        (derOk
          ? " (still protects a 20A circuit)."
          : " — can no longer be protected at 20A."),
      "Past 3 current-carrying conductors, ampacity drops (×0.8 for 4–6, ×0.7 for 7–9, ×0.5 for 10+)."
    )
  );

  const vdOk = vd12p <= 3;
  checks.push(
    card(
      vdOk ? "pass" : wireSize === "#10" ? "warn" : "fail",
      "Voltage drop (to farthest device)",
      `${farthest.toFixed(0)} ft one way. On #12: ${vd12p.toFixed(1)}%. ` +
        (vdOk
          ? "Under the 3% target — run it in #12."
          : `Over 3% — upsize to ${wireSize} (drops to ${vdp.toFixed(1)}%).`),
      "NEC recommends ≤3% drop on branch circuits."
    )
  );

  return { checks, va, amps, wireSize, emtSize, maxDev };
}
