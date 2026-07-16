import type {
  Circuit,
  Device,
  ProjectSettings,
  Route,
} from "./types";
import { runCodeChecks } from "./code-checks";
import {
  farthestCumulativeFt,
  routeTakeoffLengths,
} from "./routing";

export type TakeoffLine = {
  circuitLabel: string;
  item: string;
  qty: number;
  unit: string;
  note: string;
};

/**
 * takeoffForCircuit — Branch Circuit Trainer formulas + route stubs.
 *
 * Lengths:
 *   homerun   = plan + panel_stub_ft
 *   switchleg = plan + switch_drop_ft
 *   branch    = plan
 *
 * wire LF = (route LF + makeup_per_box_ft × box_count)
 *           × conductors × (1 + waste_pct/100)
 *
 * Home-run pipe: shared group size (max 3) drives fill/derating;
 * EMT/THHN for the pipe is emitted only when ownsPipe.
 */
export function buildCircuitTakeoff(opts: {
  circuit: Circuit;
  devices: Device[];
  routes: Route[];
  settings: ProjectSettings;
  /** Circuits in this home-run pipe (1–3). */
  pipeGroupSize?: number;
  /** Only the pipe owner emits shared home-run EMT/wire. */
  ownsPipe?: boolean;
}): TakeoffLine[] {
  const {
    circuit,
    devices,
    routes,
    settings,
    pipeGroupSize = 1,
    ownsPipe = true,
  } = opts;

  const label = `LP-1-${circuit.number}`;
  const onCkt = devices.filter(
    (d) => d.circuit_id === circuit.id || d.id === circuit.panel_device_id
  );
  const panel = devices.find((d) => d.id === circuit.panel_device_id);
  const branchDevs =
    circuit.ctype === "lighting"
      ? onCkt.filter((d) => d.type === "fixture")
      : onCkt.filter((d) => d.type === "receptacle");
  const switches = onCkt.filter((d) => d.type === "switch");
  const n = branchDevs.length;

  const { homerun: hrLen, branch: branchPlan, switchleg: swLen } =
    routeTakeoffLengths(routes, settings);
  // Branch takeoff length = plan only (switchleg stubs counted with switchleg wire/MC)
  const branchLen = branchPlan + swLen;

  const farthest = panel
    ? farthestCumulativeFt({
        panel,
        devices: onCkt,
        routes,
        settings,
      })
    : hrLen + branchLen;

  const ckts = Math.min(Math.max(pipeGroupSize, 1), 3);
  const checks = runCodeChecks({
    ctype: circuit.ctype,
    voltage: circuit.voltage,
    breakerAmps: circuit.breaker_amps,
    devices: onCkt,
    farthestPlanFt: Math.max(farthest, 1),
    homeRunSharedCircuits: ckts,
    settings,
  });

  const wire = checks.wireSize.replace("#", "");
  const waste = 1 + settings.waste_pct / 100;
  const totalWires = ckts * 2 + 1; // hots+neutrals + shared ground
  const makeup = settings.makeup_per_box_ft;

  // Trainer-style box counts
  const boxCount =
    circuit.ctype === "lighting" ? n + switches.length : n;
  // Home-run ends: panel + entry box
  const hrBoxes = 2;

  const rows: TakeoffLine[] = [];
  const push = (item: string, qty: number, unit: string, note: string) => {
    if (qty <= 0 && unit !== "EA") return;
    rows.push({ circuitLabel: label, item, qty, unit, note });
  };

  // ---- HOME RUN (shared pipe — only owner emits) ----
  if (ownsPipe && hrLen > 0) {
    const couplings = Math.max(0, Math.ceil(hrLen / 10) - 1);
    const straps = Math.ceil(hrLen / 10) + 2;
    const hrWire = Math.ceil(
      (hrLen + makeup * hrBoxes) * totalWires * waste
    );

    push(
      `${checks.emtSize} EMT`,
      Math.ceil(hrLen),
      "LF",
      ckts > 1
        ? `Shared home run (${ckts} circuits) · plan + panel stub`
        : "Home run · plan + panel stub"
    );
    push(`${checks.emtSize} EMT couplings`, couplings, "EA", "10-ft sticks");
    push(`${checks.emtSize} EMT connectors`, 2, "EA", "One each end");
    push("One-hole straps / hangers", straps, "EA", "Every 10', within 3' of boxes");
    push(
      `#${wire} THHN cu`,
      hrWire,
      "LF",
      `${totalWires} conductors × (HR + makeup×${hrBoxes}) × waste`
    );
  }

  // ---- BRANCH ----
  const mc = settings.branch_method === "mc";
  // Trainer: lighting segs = n (fixture segments incl switch leg), recept = n-1
  const segs =
    circuit.ctype === "lighting" ? Math.max(n, 0) : Math.max(0, n - 1);

  if (mc) {
    const mcLen = Math.ceil(branchLen * waste);
    push(
      `${wire}/2 MC cable`,
      mcLen,
      "LF",
      circuit.ctype === "lighting"
        ? "Branch + switch leg (plan + switch drop)"
        : "Box-to-box branch"
    );
    push("MC connectors + anti-shorts", segs * 2, "EA", "2 per segment end");
    push(
      "MC cable supports",
      Math.ceil(branchLen / 6) || 0,
      "EA",
      'Every 6\', within 12" of boxes'
    );
  } else {
    const brWire = Math.ceil(
      (branchLen + makeup * Math.max(boxCount, 1)) * 3 * waste
    );
    push(`1/2" EMT`, Math.ceil(branchLen), "LF", "Branch runs in pipe per spec");
    push(
      `1/2" connectors + couplings`,
      segs * 2 + Math.ceil(branchLen / 10),
      "EA",
      ""
    );
    push(
      `#${wire} THHN cu`,
      brWire,
      "LF",
      `3 conductors × (branch + makeup×boxes) × waste`
    );
    push("Straps", Math.ceil(branchLen / 10) + segs, "EA", "");
  }

  // ---- DEVICES ----
  if (circuit.ctype === "lighting") {
    push("Fixture connections / whips", n, "EA", "Splice + pigtail at each fixture");
    push('4" sq box + 1G mud ring', switches.length, "EA", "Switch location");
    push(
      "Single-pole switch, spec grade + plate",
      switches.length,
      "EA",
      "20A rated"
    );
  } else {
    push('4" sq box + 1G mud ring', n, "EA", "One per receptacle");
    push(
      "Duplex receptacle, spec grade + plate",
      n,
      "EA",
      "20A, NEMA 5-20R"
    );
  }
  push("20A 1-pole breaker + termination", 1, "EA", "If not in gear package");

  return rows;
}

export function takeoffToCsv(lines: TakeoffLine[]): string {
  const header = "Circuit,Item,Qty,Unit,Note";
  const body = lines
    .map((l) =>
      [l.circuitLabel, l.item, l.qty, l.unit, l.note]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
  return `${header}\n${body}\n`;
}

export function aggregateTakeoff(lines: TakeoffLine[]): TakeoffLine[] {
  const map = new Map<string, TakeoffLine>();
  for (const l of lines) {
    if (l.qty === 0) continue;
    const key = `${l.item}|${l.unit}`;
    const existing = map.get(key);
    if (existing) {
      existing.qty += l.qty;
      existing.circuitLabel = "PROJECT";
      existing.note = "Rolled up";
    } else {
      map.set(key, { ...l, circuitLabel: "PROJECT" });
    }
  }
  return Array.from(map.values());
}
