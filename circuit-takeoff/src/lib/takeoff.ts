import { getCatalogEntry } from "./catalog";
import { runCircuitChecks, farthestFromRoutes } from "./checks";
import { resolveCatalogId } from "./devices";
import { buildLvTakeoff } from "./lv-routing";
import { pickMcCable, parseWireLabel, thhnItem } from "./materials";
import { applyLengthAdders } from "./routing";
import type {
  Circuit,
  Device,
  Point,
  ProjectSettings,
  Route,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";

function mergeSettings(settings: ProjectSettings): ProjectSettings {
  return { ...DEFAULT_SETTINGS, ...settings };
}
/** Home-run entries within this distance (feet) may share a pipe. */
export const HR_SHARE_RADIUS_FT = 15;

export type TakeoffLine = {
  circuit: string;
  item: string;
  qty: number;
  uom: string;
  notes: string;
};

export type PipeShareInfo = {
  groupSize: number;
  ownsPipe: boolean;
  /** Longest homerun plan_length_ft in the pipe (no stub). */
  maxHrPlanFt: number;
};

/** Home-run entry = last point of homerun polyline (device side). */
function hrEntry(routes: Route[]): Point | null {
  const hr = routes.find((r) => r.kind === "homerun");
  if (!hr?.path?.length) return null;
  return hr.path[hr.path.length - 1];
}

function hrPlanFt(routes: Route[]): number {
  const hr = routes.find((r) => r.kind === "homerun");
  return hr?.plan_length_ft ?? 0;
}

function shareRadiusPx(ftPerPx: number): number {
  if (!(ftPerPx > 0)) return 0;
  return HR_SHARE_RADIUS_FT / ftPerPx;
}

/**
 * Circuits sharing a panel with HR entries within HR_SHARE_RADIUS_FT
 * share a pipe, packed max 3 per pipe. Pipe length uses the longest
 * panel-to-entry plan length in the cluster.
 */
export function groupHomeRunPipes(
  circuits: Circuit[],
  routesByCircuit: Map<string, Route[]>,
  ftPerPxBySheetId: Map<string, number>
): Map<string, PipeShareInfo> {
  const result = new Map<string, PipeShareInfo>();
  const byPanel = new Map<string, Circuit[]>();
  for (const c of circuits) {
    const list = byPanel.get(c.panel_device_id) || [];
    list.push(c);
    byPanel.set(c.panel_device_id, list);
  }

  Array.from(byPanel.values()).forEach((panelCircuits) => {
    type Node = {
      id: string;
      number: number;
      entry: Point;
      planFt: number;
      sheetId: string;
    };
    const nodes: Node[] = [];
    for (const c of panelCircuits) {
      const routes = routesByCircuit.get(c.id) || [];
      const entry = hrEntry(routes);
      if (!entry) continue;
      nodes.push({
        id: c.id,
        number: c.number,
        entry,
        planFt: hrPlanFt(routes),
        sheetId: c.sheet_id,
      });
    }

    const parent = nodes.map((_, i) => i);
    const find = (i: number): number =>
      parent[i] === i ? i : (parent[i] = find(parent[i]));

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        // Same sheet scale required to compare; use i's sheet ft/px.
        const ftPerPx = ftPerPxBySheetId.get(nodes[i].sheetId) ?? 0;
        if (nodes[i].sheetId !== nodes[j].sheetId || !(ftPerPx > 0)) {
          continue;
        }
        const thresh = shareRadiusPx(ftPerPx);
        const d = Math.hypot(
          nodes[i].entry.x - nodes[j].entry.x,
          nodes[i].entry.y - nodes[j].entry.y
        );
        if (d <= thresh) {
          const ri = find(i);
          const rj = find(j);
          if (ri !== rj) parent[ri] = rj;
        }
      }
    }

    const clusters = new Map<number, Node[]>();
    for (let i = 0; i < nodes.length; i++) {
      const r = find(i);
      const list = clusters.get(r) || [];
      list.push(nodes[i]);
      clusters.set(r, list);
    }

    Array.from(clusters.values()).forEach((members) => {
      members.sort((a, b) => a.number - b.number);
      for (let i = 0; i < members.length; i += 3) {
        const pipe = members.slice(i, i + 3);
        const maxHrPlanFt = Math.max(...pipe.map((m) => m.planFt));
        pipe.forEach((m, idx) => {
          result.set(m.id, {
            groupSize: pipe.length,
            ownsPipe: idx === 0,
            maxHrPlanFt,
          });
        });
      }
    });
  });

  for (const c of circuits) {
    if (!result.has(c.id)) {
      result.set(c.id, {
        groupSize: 1,
        ownsPipe: true,
        maxHrPlanFt: hrPlanFt(routesByCircuit.get(c.id) || []),
      });
    }
  }
  return result;
}

export function takeoffForCircuit(opts: {
  circuit: Circuit;
  devices: Device[];
  routes: Route[];
  settings: ProjectSettings;
  pipeGroupSize?: number;
  ownsPipe?: boolean;
  /** Longest HR plan ft in shared pipe; stub applied here. */
  maxHrPlanFt?: number;
}): TakeoffLine[] {
  const {
    circuit,
    devices,
    routes,
    pipeGroupSize = 1,
    ownsPipe = true,
    maxHrPlanFt,
  } = opts;
  const settings = mergeSettings(opts.settings);

  const label = `Ckt ${circuit.number}`;
  const onCkt = devices.filter(
    (d) => d.circuit_id === circuit.id || d.id === circuit.panel_device_id
  );
  const branchDevs =
    circuit.ctype === "lighting"
      ? onCkt.filter((d) => d.type === "fixture")
      : onCkt.filter((d) => d.type === "receptacle");
  const switches = onCkt.filter((d) => d.type === "switch");
  const n = branchDevs.length;

  const lengths = applyLengthAdders(routes, settings);
  const ownHrLen = lengths.homerun;
  const planForPipe =
    maxHrPlanFt !== undefined ? maxHrPlanFt : hrPlanFt(routes);
  const hrLen = planForPipe + settings.panel_stub_ft;
  const branchLen = lengths.branch + lengths.switchleg;

  const farthest = farthestFromRoutes(routes, settings);
  const ckts = Math.min(Math.max(pipeGroupSize, 1), 3);
  const checks = runCircuitChecks({
    ctype: circuit.ctype,
    voltage: circuit.voltage,
    breakerAmps: circuit.breaker_amps,
    devices: onCkt,
    farthestFt: Math.max(farthest, 1),
    homeRunSharedCircuits: ckts,
    settings,
  });

  const wireSize = parseWireLabel(checks.wireSize);
  const waste = 1 + settings.waste_pct / 100;
  /** 2 hots/neutrals per circuit + 1 shared ground. */
  const totalWires = ckts * 2 + 1;
  const makeup = settings.makeup_per_box_ft;
  const boxCount =
    circuit.ctype === "lighting" ? n + switches.length : n;
  const hrBoxes = 2;
  const mc = settings.branch_method === "mc";
  const segs =
    circuit.ctype === "lighting" ? Math.max(n, 0) : Math.max(0, n - 1);
  const insulatedBranch =
    circuit.ctype === "lighting" && switches.length > 0 ? 3 : 2;
  const mcItem = pickMcCable(wireSize, insulatedBranch);
  const thhn = thhnItem(wireSize);

  const rows: TakeoffLine[] = [];
  const push = (
    item: string,
    qty: number,
    uom: string,
    notes: string
  ) => {
    if (qty === 0) return;
    rows.push({ circuit: label, item, qty, uom, notes });
  };

  // HOME RUN — only when a real HR plan length exists (not stub-alone).
  // Pipe owner emits EMT once; conductors = 2n+1 × longest length.
  if (ownsPipe && planForPipe > 0) {
    const couplings = Math.max(0, Math.ceil(hrLen / 10) - 1);
    const straps = Math.ceil(hrLen / 10) + 2;
    const hrWire = Math.ceil((hrLen + makeup * hrBoxes) * totalWires * waste);
    const shareNote =
      ckts > 1
        ? `Shared HR (${ckts} ckts, ${totalWires} cond) · longest plan+stub=${hrLen.toFixed(1)}ft`
        : `HR plan+stub=${hrLen.toFixed(1)}ft` +
          (ownHrLen !== hrLen
            ? ` (own ${ownHrLen.toFixed(1)})`
            : "");
    push(`${checks.emtSize} EMT`, Math.ceil(hrLen), "LF", shareNote);
    push(
      `${checks.emtSize} EMT couplings`,
      couplings,
      "EA",
      `ceil(${hrLen.toFixed(0)}/10)-1`
    );
    push(`${checks.emtSize} EMT connectors`, 2, "EA", "One each end");
    push(
      "One-hole straps / hangers",
      straps,
      "EA",
      `ceil(HR/10)+2`
    );
    const hrUp =
      checks.wireSize !== "#12" && circuit.breaker_amps <= 20
        ? ` · upsized from #12 for VD`
        : circuit.breaker_amps > 20
          ? ` · ${checks.wireSize} for ${circuit.breaker_amps}A`
          : "";
    push(
      thhn,
      hrWire,
      "LF",
      `(${hrLen.toFixed(1)}+${makeup}×${hrBoxes})×${totalWires}×${waste.toFixed(2)}` +
        hrUp
    );
  }

  // BRANCH
  if (mc) {
    const mcLen = Math.ceil(branchLen * waste);
    push(
      mcItem,
      mcLen,
      "LF",
      `branch+switchleg=${branchLen.toFixed(1)}×${waste.toFixed(2)}` +
        (checks.wireSize !== "#12" ? ` · ${checks.wireSize}` : "")
    );
    push("MC connectors + anti-shorts", segs * 2, "EA", `2×${segs} segments`);
    push(
      "MC cable supports",
      Math.ceil(branchLen / 6) || 0,
      "EA",
      "Every 6'"
    );
  } else if (branchLen > 0) {
    const brWire = Math.ceil(
      (branchLen + makeup * Math.max(boxCount, 1)) * 3 * waste
    );
    push(`1/2" EMT`, Math.ceil(branchLen), "LF", "Branch in pipe");
    push(
      `1/2" connectors + couplings`,
      segs * 2 + Math.ceil(branchLen / 10),
      "EA",
      ""
    );
    const brUp =
      checks.wireSize !== "#12" && circuit.breaker_amps <= 20
        ? ` · upsized from #12 for VD`
        : circuit.breaker_amps > 20
          ? ` · ${checks.wireSize} for ${circuit.breaker_amps}A`
          : "";
    push(
      thhn,
      brWire,
      "LF",
      `(${branchLen.toFixed(1)}+makeup×${boxCount})×3×${waste.toFixed(2)}` +
        brUp
    );
    push("Straps", Math.ceil(branchLen / 10) + segs, "EA", "");
  }
  // Device assemblies from catalog (per subtype)
  const assemblyDevs = onCkt.filter(
    (d) => d.type !== "panel" && d.id !== circuit.panel_device_id
  );
  const rolled = new Map<string, { qty: number; notes: string }>();
  for (const d of assemblyDevs) {
    const entry = getCatalogEntry(resolveCatalogId(d));
    if (!entry) continue;
    for (const line of entry.assembly) {
      const key = `${line.item}|${line.uom}`;
      const cur = rolled.get(key) || { qty: 0, notes: entry.label };
      cur.qty += line.qty;
      rolled.set(key, cur);
    }
  }
  Array.from(rolled.entries()).forEach(([key, v]) => {
    const [item, uom] = key.split("|");
    push(item, v.qty, uom, v.notes);
  });

  push(
    `${circuit.breaker_amps}A 1-pole breaker + termination`,
    1,
    "EA",
    ""
  );

  return rows;
}

function toFtPerPxMap(
  input: Map<string, number> | Record<string, number>
): Map<string, number> {
  if (input instanceof Map) return input;
  return new Map(Object.entries(input));
}

export function buildProjectTakeoff(opts: {
  circuits: Circuit[];
  devices: Device[];
  routes: Route[];
  settings: ProjectSettings;
  /** Image scale (ft/px) keyed by sheet_id — required for HR clustering. */
  ftPerPxBySheetId: Map<string, number> | Record<string, number>;
}): { lines: TakeoffLine[]; totals: TakeoffLine[] } {
  const { circuits, devices, routes } = opts;
  const settings = mergeSettings(opts.settings);
  const ftPerPxBySheetId = toFtPerPxMap(opts.ftPerPxBySheetId);
  const byCkt = new Map<string, Route[]>();
  for (const r of routes) {
    if (!r.circuit_id) continue;
    const list = byCkt.get(r.circuit_id) || [];
    list.push(r);
    byCkt.set(r.circuit_id, list);
  }
  const pipes = groupHomeRunPipes(circuits, byCkt, ftPerPxBySheetId);

  const ordered = [...circuits].sort((a, b) => a.number - b.number);
  const powerLines = ordered.flatMap((c) => {
    const pipe = pipes.get(c.id);
    return takeoffForCircuit({
      circuit: c,
      devices,
      routes: byCkt.get(c.id) || [],
      settings,
      pipeGroupSize: pipe?.groupSize ?? 1,
      ownsPipe: pipe?.ownsPipe ?? true,
      maxHrPlanFt: pipe?.maxHrPlanFt,
    });
  });

  const lvLines = buildLvTakeoff({
    circuits,
    devices,
    routes,
    settings,
  }) as TakeoffLine[];

  const lines = [...powerLines, ...lvLines];

  const map = new Map<string, TakeoffLine>();
  for (const l of lines) {
    if (l.qty === 0) continue;
    const key = `${l.item}|${l.uom}`;
    const existing = map.get(key);
    if (existing) {
      existing.qty += l.qty;
    } else {
      map.set(key, {
        circuit: "TOTAL",
        item: l.item,
        qty: l.qty,
        uom: l.uom,
        notes: "Rolled up across circuits",
      });
    }
  }
  const totals = Array.from(map.values()).sort((a, b) =>
    a.item.localeCompare(b.item)
  );

  return { lines, totals };
}

export function takeoffToCsv(lines: TakeoffLine[]): string {
  const header = "circuit,item,qty,uom,notes";
  const body = lines
    .map((l) =>
      [l.circuit, l.item, l.qty, l.uom, l.notes]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
  return `\uFEFF${header}\n${body}\n`; // BOM for Excel UTF-8
}

export type TakeoffSummary = {
  emtLf: number;
  mcLf: number;
  wireLf: number;
  deviceCount: number;
};

export function summarizeTakeoff(
  lines: TakeoffLine[],
  devices: Device[] = []
): TakeoffSummary {
  let emtLf = 0;
  let mcLf = 0;
  let wireLf = 0;
  for (const l of lines) {
    if (l.uom !== "LF") continue;
    const item = l.item.toLowerCase();
    if (
      item.includes("emt") &&
      !item.includes("coupling") &&
      !item.includes("connector")
    ) {
      emtLf += l.qty;
    } else if (item.includes("mc cable")) {
      mcLf += l.qty;
    } else if (item.includes("thhn")) {
      wireLf += l.qty;
    }
  }
  const deviceCount = devices.filter(
    (d) =>
      d.type === "fixture" ||
      d.type === "receptacle" ||
      d.type === "switch" ||
      d.type === "thermostat" ||
      d.type === "fire" ||
      d.type === "headend"
  ).length;
  return { emtLf, mcLf, wireLf, deviceCount };
}
