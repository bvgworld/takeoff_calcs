"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useSheetStore } from "@/store/sheet-store";
import type {
  Circuit,
  Device,
  DeviceType,
  Point,
  Project,
  ProjectSettings,
  Route,
  Sheet,
  ToolMode,
} from "@/lib/types";
import { Button } from "@/components/ui/Button";
import {
  autoRouteCircuit,
  farthestCumulativeFt,
  groupHomeRunPipes,
} from "@/lib/routing";
import { runCodeChecks } from "@/lib/code-checks";
import {
  aggregateTakeoff,
  buildCircuitTakeoff,
  takeoffToCsv,
} from "@/lib/takeoff";

const PlanCanvas = dynamic(
  () =>
    import("@/components/canvas/PlanCanvas").then((m) => m.PlanCanvas),
  { ssr: false }
);

type Props = {
  project: Project;
  sheet: Sheet;
  initialDevices: Device[];
  initialCircuits: Circuit[];
  initialRoutes: Route[];
  imageUrl: string;
};

const TOOLS: { id: ToolMode; label: string }[] = [
  { id: "pan", label: "Pan" },
  { id: "calibrate", label: "Calibrate" },
  { id: "stamp-panel", label: "Panel" },
  { id: "stamp-fixture", label: "Fixture" },
  { id: "stamp-receptacle", label: "Recept" },
  { id: "stamp-switch", label: "Switch" },
  { id: "select", label: "Select" },
  { id: "edit-route", label: "Edit route" },
];

export function SheetWorkspace({
  project,
  sheet: initialSheet,
  initialDevices,
  initialCircuits,
  initialRoutes,
  imageUrl,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [sheet, setSheet] = useState(initialSheet);
  const [settings] = useState<ProjectSettings>(project.settings);
  const [busy, setBusy] = useState("");
  const [knownFeet, setKnownFeet] = useState(10);

  const tool = useSheetStore((s) => s.tool);
  const setTool = useSheetStore((s) => s.setTool);
  const setCalibrate = useSheetStore((s) => s.setCalibrate);
  const devices = useSheetStore((s) => s.devices);
  const circuits = useSheetStore((s) => s.circuits);
  const routes = useSheetStore((s) => s.routes);
  const setDevices = useSheetStore((s) => s.setDevices);
  const setCircuits = useSheetStore((s) => s.setCircuits);
  const setRoutes = useSheetStore((s) => s.setRoutes);
  const selectedCircuitId = useSheetStore((s) => s.selectedCircuitId);
  const setSelectedCircuitId = useSheetStore((s) => s.setSelectedCircuitId);
  const selectedDeviceId = useSheetStore((s) => s.selectedDeviceId);

  useEffect(() => {
    setDevices(initialDevices);
    setCircuits(initialCircuits);
    setRoutes(initialRoutes);
  }, [
    initialDevices,
    initialCircuits,
    initialRoutes,
    setDevices,
    setCircuits,
    setRoutes,
  ]);

  useEffect(() => {
    setCalibrate({ knownFeet });
  }, [knownFeet, setCalibrate]);

  const onStamp = useCallback(
    async (x: number, y: number) => {
      const type = tool.replace("stamp-", "") as DeviceType;
      if (!["panel", "fixture", "receptacle", "switch"].includes(type)) return;
      const attrs =
        type === "fixture"
          ? { watts: 36, label: "F" }
          : type === "panel"
            ? { label: "LP-1" }
            : { label: type[0]!.toUpperCase() };
      const { data, error } = await supabase
        .from("devices")
        .insert({
          sheet_id: sheet.id,
          type,
          x,
          y,
          attrs,
          circuit_id: selectedCircuitId,
        })
        .select("*")
        .single();
      if (error) {
        alert(error.message);
        return;
      }
      setDevices([...useSheetStore.getState().devices, data as Device]);
    },
    [tool, supabase, sheet.id, selectedCircuitId, setDevices]
  );

  const onCalibrateComplete = useCallback(
    async (ftPerPx: number) => {
      const { error } = await supabase
        .from("sheets")
        .update({ ft_per_px: ftPerPx })
        .eq("id", sheet.id);
      if (error) {
        alert(error.message);
        return;
      }
      setSheet((s) => ({ ...s, ft_per_px: ftPerPx }));
    },
    [supabase, sheet.id]
  );

  const onRoutePathChange = useCallback(
    async (routeId: string, path: Point[], planFt: number) => {
      const { error } = await supabase
        .from("routes")
        .update({ path, plan_length_ft: planFt, user_edited: true })
        .eq("id", routeId);
      if (error) {
        alert(error.message);
        return;
      }
      setRoutes(
        useSheetStore
          .getState()
          .routes.map((r) =>
            r.id === routeId
              ? { ...r, path, plan_length_ft: planFt, user_edited: true }
              : r
          )
      );
    },
    [supabase, setRoutes]
  );

  async function createCircuit(ctype: "lighting" | "receptacle") {
    const panel = devices.find((d) => d.type === "panel");
    if (!panel) {
      alert("Stamp a panel first.");
      return;
    }
    const nextNum =
      circuits.reduce((m, c) => Math.max(m, c.number), 0) + 1 || 1;
    const voltage =
      ctype === "lighting"
        ? settings.lighting_voltage
        : settings.receptacle_voltage;
    const { data, error } = await supabase
      .from("circuits")
      .insert({
        sheet_id: sheet.id,
        panel_device_id: panel.id,
        number: nextNum,
        ctype,
        voltage,
        breaker_amps: 20,
      })
      .select("*")
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    setCircuits([...circuits, data as Circuit]);
    setSelectedCircuitId(data.id);
  }

  async function assignSelectedToCircuit() {
    if (!selectedDeviceId || !selectedCircuitId) {
      alert("Select a device and a circuit.");
      return;
    }
    const { error } = await supabase
      .from("devices")
      .update({ circuit_id: selectedCircuitId })
      .eq("id", selectedDeviceId);
    if (error) {
      alert(error.message);
      return;
    }
    setDevices(
      devices.map((d) =>
        d.id === selectedDeviceId
          ? { ...d, circuit_id: selectedCircuitId }
          : d
      )
    );
  }

  async function autoGroupUnassigned() {
    // Assign unassigned fixtures to new lighting circuit, receptacles to recept circuit
    const panel = devices.find((d) => d.type === "panel");
    if (!panel) {
      alert("Stamp a panel first.");
      return;
    }
    const unassigned = devices.filter(
      (d) => !d.circuit_id && d.type !== "panel"
    );
    const fixtures = unassigned.filter((d) => d.type === "fixture" || d.type === "switch");
    const recepts = unassigned.filter((d) => d.type === "receptacle");

    if (fixtures.length) {
      await createCircuit("lighting");
      const cktId = useSheetStore.getState().selectedCircuitId;
      if (cktId) {
        const ids = fixtures.map((d) => d.id);
        await supabase
          .from("devices")
          .update({ circuit_id: cktId })
          .in("id", ids);
        setDevices(
          useSheetStore
            .getState()
            .devices.map((d) =>
              ids.includes(d.id) ? { ...d, circuit_id: cktId } : d
            )
        );
      }
    }
    if (recepts.length) {
      await createCircuit("receptacle");
      const cktId = useSheetStore.getState().selectedCircuitId;
      if (cktId) {
        const ids = recepts.map((d) => d.id);
        await supabase
          .from("devices")
          .update({ circuit_id: cktId })
          .in("id", ids);
        setDevices(
          useSheetStore
            .getState()
            .devices.map((d) =>
              ids.includes(d.id) ? { ...d, circuit_id: cktId } : d
            )
        );
      }
    }
  }

  async function runAutoRoute(circuitId: string) {
    if (!sheet.ft_per_px) {
      alert("Calibrate scale first.");
      return;
    }
    setBusy("Routing…");
    const circuit = circuits.find((c) => c.id === circuitId);
    if (!circuit) return;
    const panel = devices.find((d) => d.id === circuit.panel_device_id);
    if (!panel) {
      alert("Circuit panel missing.");
      setBusy("");
      return;
    }
    const onCkt = devices.filter((d) => d.circuit_id === circuitId);
    const branch =
      circuit.ctype === "lighting"
        ? onCkt.filter((d) => d.type === "fixture")
        : onCkt.filter((d) => d.type === "receptacle");
    const switches = onCkt.filter((d) => d.type === "switch");

    const proposed = autoRouteCircuit({
      panel,
      branchDevices: branch,
      switches,
      ctype: circuit.ctype,
      ftPerPx: sheet.ft_per_px,
    });

    // Replace non-user-edited routes for this circuit
    const keep = routes.filter(
      (r) => r.circuit_id !== circuitId || r.user_edited
    );
    await supabase
      .from("routes")
      .delete()
      .eq("circuit_id", circuitId)
      .eq("user_edited", false);

    if (proposed.length) {
      const { data, error } = await supabase
        .from("routes")
        .insert(
          proposed.map((p) => ({
            circuit_id: circuitId,
            kind: p.kind,
            path: p.path,
            plan_length_ft: p.plan_length_ft,
            user_edited: false,
          }))
        )
        .select("*");
      if (error) {
        alert(error.message);
        setBusy("");
        return;
      }
      const keptEdited = keep.filter((r) => r.circuit_id === circuitId);
      const others = keep.filter((r) => r.circuit_id !== circuitId);
      setRoutes([...others, ...keptEdited, ...((data as Route[]) || [])]);
    } else {
      setRoutes(keep);
    }
    setBusy("");
  }

  const selectedCircuit = circuits.find((c) => c.id === selectedCircuitId);

  const pipeGroups = useMemo(() => {
    const byCkt = new Map<string, Route[]>();
    for (const r of routes) {
      const list = byCkt.get(r.circuit_id) || [];
      list.push(r);
      byCkt.set(r.circuit_id, list);
    }
    return groupHomeRunPipes(circuits, byCkt);
  }, [circuits, routes]);

  const selectedChecks = useMemo(() => {
    if (!selectedCircuit || !sheet.ft_per_px) return null;
    const panel = devices.find(
      (d) => d.id === selectedCircuit.panel_device_id
    );
    if (!panel) return null;
    const onCkt = devices.filter(
      (d) =>
        d.circuit_id === selectedCircuit.id ||
        d.id === selectedCircuit.panel_device_id
    );
    const cRoutes = routes.filter((r) => r.circuit_id === selectedCircuit.id);
    const farthest = farthestCumulativeFt({
      panel,
      devices: onCkt,
      routes: cRoutes,
      settings,
    });
    const pipe = pipeGroups.get(selectedCircuit.id);
    return runCodeChecks({
      ctype: selectedCircuit.ctype,
      voltage: selectedCircuit.voltage,
      breakerAmps: selectedCircuit.breaker_amps,
      devices: onCkt,
      farthestPlanFt: farthest,
      homeRunSharedCircuits: pipe?.groupSize ?? 1,
      settings,
    });
  }, [
    selectedCircuit,
    devices,
    routes,
    sheet.ft_per_px,
    settings,
    pipeGroups,
  ]);

  const takeoffLines = useMemo(() => {
    return circuits.flatMap((c) => {
      const pipe = pipeGroups.get(c.id);
      return buildCircuitTakeoff({
        circuit: c,
        devices,
        routes: routes.filter((r) => r.circuit_id === c.id),
        settings,
        pipeGroupSize: pipe?.groupSize ?? 1,
        ownsPipe: pipe?.ownsPipe ?? true,
      });
    });
  }, [circuits, devices, routes, settings, pipeGroups]);

  function exportCsv() {
    const totals = aggregateTakeoff(takeoffLines);
    const csv = takeoffToCsv([...takeoffLines, ...totals]);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name}-${sheet.name}-takeoff.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-screen flex-col bg-perry-white">
      <header className="flex items-center justify-between gap-4 bg-perry-industrial px-4 py-3 text-perry-white">
        <div>
          <Link
            href={`/projects/${project.id}`}
            className="text-xs text-perry-silver hover:text-white"
          >
            ← {project.name}
          </Link>
          <h1 className="font-anton text-lg tracking-wide">{sheet.name}</h1>
        </div>
        <div className="text-xs text-perry-silver">
          {sheet.ft_per_px
            ? `Scale: ${sheet.ft_per_px.toFixed(5)} ft/px`
            : "Not calibrated"}
          {busy ? ` · ${busy}` : ""}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-perry-silver bg-white px-3 py-2">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTool(t.id);
              if (t.id === "calibrate") setCalibrate({ active: true, p1: null });
            }}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
              tool === t.id
                ? "bg-perry-blue text-white"
                : "bg-perry-white text-perry-industrial"
            }`}
          >
            {t.label}
          </button>
        ))}
        {tool === "calibrate" && (
          <label className="ml-2 flex items-center gap-1 text-xs">
            Known length (ft)
            <input
              type="number"
              value={knownFeet}
              min={0.1}
              step={0.1}
              onChange={(e) => setKnownFeet(Number(e.target.value))}
              className="w-20 rounded border border-perry-silver px-1 py-0.5"
            />
          </label>
        )}
        <span className="ml-auto text-xs text-gray-500">
          Scroll to zoom · Pan tool to drag · Calibrate = two clicks on a known distance
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_320px]">
        <div className="min-h-0">
          <PlanCanvas
            imageUrl={imageUrl}
            imageW={sheet.image_w}
            imageH={sheet.image_h}
            ftPerPx={sheet.ft_per_px}
            onStamp={onStamp}
            onCalibrateComplete={onCalibrateComplete}
            onRoutePathChange={onRoutePathChange}
          />
        </div>

        <aside className="flex min-h-0 flex-col gap-3 overflow-auto border-l border-perry-silver bg-white p-3">
          <section>
            <h2 className="font-anton text-sm">Circuits</h2>
            <div className="mt-2 flex flex-wrap gap-1">
              <Button type="button" onClick={() => createCircuit("lighting")}>
                + Lighting
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => createCircuit("receptacle")}
              >
                + Recept
              </Button>
              <Button type="button" variant="ghost" onClick={autoGroupUnassigned}>
                Auto-group
              </Button>
            </div>
            <ul className="mt-2 space-y-1">
              {circuits.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedCircuitId(c.id)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${
                      selectedCircuitId === c.id
                        ? "bg-perry-blue text-white"
                        : "hover:bg-perry-white"
                    }`}
                  >
                    <span>
                      LP-1-{c.number} · {c.ctype} · {c.voltage}V
                    </span>
                    <span
                      className="text-xs underline opacity-80"
                      onClick={(e) => {
                        e.stopPropagation();
                        runAutoRoute(c.id);
                      }}
                    >
                      Route
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="secondary"
              className="mt-2 w-full"
              onClick={assignSelectedToCircuit}
            >
              Assign selected device → circuit
            </Button>
          </section>

          {selectedChecks && (
            <section>
              <h2 className="font-anton text-sm">Code checks</h2>
              <ul className="mt-2 space-y-2">
                {selectedChecks.checks.map((ch) => (
                  <li
                    key={ch.name}
                    className={`rounded border-l-4 px-2 py-1.5 text-xs ${
                      ch.status === "pass"
                        ? "border-green-700 bg-green-50"
                        : ch.status === "warn"
                          ? "border-amber-600 bg-amber-50"
                          : "border-perry-signal bg-red-50"
                    }`}
                  >
                    <div className="font-semibold uppercase tracking-wide">
                      {ch.status}
                    </div>
                    <div className="font-semibold">{ch.name}</div>
                    <div>{ch.detail}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between">
              <h2 className="font-anton text-sm">Takeoff</h2>
              <Button type="button" variant="secondary" onClick={exportCsv}>
                CSV
              </Button>
            </div>
            <div className="mt-2 max-h-64 overflow-auto text-xs">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-[10px] uppercase text-gray-500">
                    <th className="py-1">Ckt</th>
                    <th>Item</th>
                    <th className="text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {takeoffLines.slice(0, 40).map((l, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1 pr-1">{l.circuitLabel}</td>
                      <td>{l.item}</td>
                      <td className="text-right font-semibold">
                        {l.qty} {l.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {takeoffLines.length > 40 && (
                <p className="mt-1 text-gray-500">
                  Showing 40 of {takeoffLines.length} — export CSV for full.
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
