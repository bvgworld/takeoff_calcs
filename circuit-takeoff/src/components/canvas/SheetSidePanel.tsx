"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Circuit,
  CodeCheck,
  Device,
  ProjectSettings,
  Route,
} from "@/lib/types";
import { DeviceSidePanel } from "./DeviceSidePanel";
import { Button } from "@/components/ui/Button";
import { runCircuitChecks, farthestFromRoutes } from "@/lib/checks";
import { isCalibrated } from "@/lib/scale";
import { circuitHue } from "@/lib/routing";
import {
  dataRouteReady,
  dimmingFollows,
  dimmingTotalPlanFt,
  findThermostats,
  fireRouteReady,
  LV_COLORS,
} from "@/lib/lv-routing";
import { DEFAULT_SETTINGS } from "@/lib/types";

type Props = {
  selected: Device[];
  onChangeLabel: (label: string) => void;
  onChangeWatts: (watts: number) => void;
  onChangeDimming: (dimming: boolean) => void;
  devices: Device[];
  circuits: Circuit[];
  routes: Route[];
  settings: ProjectSettings;
  ftPerPx: number | null;
  onNewCircuit: (opts: {
    panelId: string;
    ctype: "lighting" | "receptacle";
    voltage: number;
  }) => void;
  onAssignSelected: (circuitId: string) => void;
  onAutoGroup: (ctype: "lighting" | "receptacle", panelId: string) => void;
  onRoute: (circuitId: string) => void;
  onRouteAll: () => void;
  onResetRoutes: (circuitId: string) => void;
  onRouteFire: () => void;
  onRouteData: () => void;
  editRoutes: boolean;
  onToggleEditRoutes: () => void;
  checkDetail: CodeCheck | null;
  onCheckClick: (check: CodeCheck | null) => void;
};

export function SheetSidePanel(props: Props) {
  const [tab, setTab] = useState<"selection" | "circuits">("circuits");

  return (
    <aside className="absolute bottom-0 right-0 top-0 z-20 flex w-72 flex-col border-l border-perry-silver bg-white shadow-sm">
      <div className="flex border-b border-perry-silver">
        <button
          type="button"
          onClick={() => setTab("selection")}
          className={`flex-1 px-3 py-2 text-xs font-semibold ${
            tab === "selection"
              ? "border-b-2 border-perry-blue text-perry-blue"
              : "text-gray-500"
          }`}
        >
          Selection
        </button>
        <button
          type="button"
          onClick={() => setTab("circuits")}
          className={`flex-1 px-3 py-2 text-xs font-semibold ${
            tab === "circuits"
              ? "border-b-2 border-perry-blue text-perry-blue"
              : "text-gray-500"
          }`}
        >
          Circuits
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === "selection" ? (
          <DeviceSidePanel
            selected={props.selected}
            onChangeLabel={props.onChangeLabel}
            onChangeWatts={props.onChangeWatts}
            onChangeDimming={props.onChangeDimming}
          />
        ) : (
          <CircuitsTab {...props} />
        )}
      </div>
      {props.checkDetail && (
        <div className="border-t border-perry-silver bg-perry-white p-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <strong>{props.checkDetail.name}</strong>
            <button
              type="button"
              className="text-perry-blue"
              onClick={() => props.onCheckClick(null)}
            >
              Close
            </button>
          </div>
          <p className="mt-1 text-gray-700">{props.checkDetail.detail}</p>
          <p className="mt-2 text-gray-500">{props.checkDetail.why}</p>
        </div>
      )}
    </aside>
  );
}

function CircuitsTab({
  devices,
  circuits,
  routes,
  settings,
  ftPerPx,
  selected,
  onNewCircuit,
  onAssignSelected,
  onAutoGroup,
  onRoute,
  onRouteAll,
  onResetRoutes,
  onRouteFire,
  onRouteData,
  editRoutes,
  onToggleEditRoutes,
  onCheckClick,
}: Props) {
  const panels = devices.filter((d) => d.type === "panel");
  const [panelId, setPanelId] = useState("");
  const [ctype, setCtype] = useState<"lighting" | "receptacle">("lighting");
  const [groupType, setGroupType] = useState<"lighting" | "receptacle">(
    "lighting"
  );
  const [assignId, setAssignId] = useState("");

  useEffect(() => {
    if (!panelId && panels[0]) setPanelId(panels[0].id);
  }, [panels, panelId]);

  useEffect(() => {
    if (!assignId && circuits[0]) setAssignId(circuits[0].id);
    if (assignId && !circuits.some((c) => c.id === assignId)) {
      setAssignId(circuits[0]?.id || "");
    }
  }, [circuits, assignId]);

  const calibrated = isCalibrated(ftPerPx);
  const activePanel = panelId || panels[0]?.id || "";
  const merged = { ...DEFAULT_SETTINGS, ...settings };

  const dimmingLf = useMemo(() => {
    const follows = dimmingFollows({ circuits, devices, routes });
    return dimmingTotalPlanFt(follows);
  }, [circuits, devices, routes]);

  const stats = useMemo(() => findThermostats(devices), [devices]);
  const stubLf = stats.length * (merged.lv_stub_ft ?? 10);
  const fireOk = fireRouteReady(devices);
  const dataOk = dataRouteReady(devices);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="font-display text-sm">New circuit</h3>
        <label className="block text-[10px] font-semibold uppercase text-gray-500">
          Panel
          <select
            value={activePanel}
            onChange={(e) => setPanelId(e.target.value)}
            className="mt-0.5 w-full rounded border border-perry-silver px-2 py-1 text-sm font-normal normal-case"
          >
            {panels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.attrs.label || "Panel"}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[10px] font-semibold uppercase text-gray-500">
          Type
          <select
            value={ctype}
            onChange={(e) =>
              setCtype(e.target.value as "lighting" | "receptacle")
            }
            className="mt-0.5 w-full rounded border border-perry-silver px-2 py-1 text-sm font-normal normal-case"
          >
            <option value="lighting">Lighting</option>
            <option value="receptacle">Receptacle</option>
          </select>
        </label>
        <Button
          type="button"
          className="w-full"
          disabled={!activePanel}
          onClick={() =>
            onNewCircuit({
              panelId: activePanel,
              ctype,
              voltage:
                ctype === "lighting"
                  ? settings.lighting_voltage
                  : settings.receptacle_voltage,
            })
          }
        >
          New circuit
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-sm">Assign</h3>
        <select
          value={assignId}
          onChange={(e) => setAssignId(e.target.value)}
          className="w-full rounded border border-perry-silver px-2 py-1 text-sm"
        >
          {circuits.map((c) => (
            <option key={c.id} value={c.id}>
              LP · {c.number} ({c.ctype})
            </option>
          ))}
        </select>
        <span
          className="block"
          title={
            selected.length === 0
              ? "Select devices with the lasso first."
              : undefined
          }
        >
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={!assignId || selected.length === 0}
            onClick={() => onAssignSelected(assignId)}
          >
            Assign to circuit ({selected.length})
          </Button>
        </span>
        <label className="block text-[10px] font-semibold uppercase text-gray-500">
          Auto-group type
          <select
            value={groupType}
            onChange={(e) =>
              setGroupType(e.target.value as "lighting" | "receptacle")
            }
            className="mt-0.5 w-full rounded border border-perry-silver px-2 py-1 text-sm font-normal normal-case"
          >
            <option value="lighting">Lighting</option>
            <option value="receptacle">Receptacles</option>
          </select>
        </label>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={!activePanel}
          onClick={() => onAutoGroup(groupType, activePanel)}
        >
          Auto-group {groupType === "lighting" ? "lighting" : "receptacles"}
        </Button>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm">Routes</h3>
          <button
            type="button"
            onClick={onToggleEditRoutes}
            className={`text-[10px] font-semibold uppercase ${
              editRoutes ? "text-perry-blue" : "text-gray-500"
            }`}
          >
            {editRoutes ? "Editing" : "Edit routes"}
          </button>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={!calibrated || !circuits.length}
          onClick={onRouteAll}
        >
          Route all
        </Button>
        {!calibrated && (
          <p className="text-[11px] text-perry-signal">
            Calibrate before routing.
          </p>
        )}
      </section>

      <ul className="space-y-2">
        {circuits.map((c) => (
          <CircuitRow
            key={c.id}
            circuit={c}
            devices={devices}
            routes={routes.filter((r) => r.circuit_id === c.id)}
            settings={settings}
            calibrated={calibrated}
            onRoute={() => onRoute(c.id)}
            onReset={() => onResetRoutes(c.id)}
            onCheckClick={onCheckClick}
          />
        ))}
        {!circuits.length && (
          <li className="text-xs text-gray-500">No circuits yet.</li>
        )}
      </ul>

      <section className="space-y-2 border-t border-perry-silver pt-3">
        <h3 className="font-display text-sm">LV systems</h3>

        <div className="rounded-md border border-perry-silver p-2">
          <div className="flex items-center justify-between gap-1">
            <span
              className="text-xs font-semibold"
              style={{ color: LV_COLORS.fire }}
            >
              Fire alarm
            </span>
          </div>
          <Button
            type="button"
            className="mt-2 w-full !px-2 !py-1 !text-[11px]"
            disabled={!calibrated}
            onClick={onRouteFire}
          >
            Route
          </Button>
          {!fireOk.ok && (
            <p className="mt-1 text-[10px] text-gray-500">{fireOk.missing}</p>
          )}
        </div>

        <div className="rounded-md border border-perry-silver p-2">
          <div className="flex items-center justify-between gap-1">
            <span
              className="text-xs font-semibold"
              style={{ color: LV_COLORS.data }}
            >
              Data
            </span>
          </div>
          <Button
            type="button"
            className="mt-2 w-full !px-2 !py-1 !text-[11px]"
            disabled={!calibrated}
            onClick={onRouteData}
          >
            Route
          </Button>
          {!dataOk.ok && (
            <p className="mt-1 text-[10px] text-gray-500">{dataOk.missing}</p>
          )}
        </div>

        <div className="rounded-md border border-perry-silver p-2">
          <div className="flex items-center justify-between">
            <span
              className="text-xs font-semibold"
              style={{ color: LV_COLORS.dimming }}
            >
              Dimming
            </span>
            <span className="text-[10px] tabular-nums text-gray-600">
              {dimmingLf.toFixed(1)} LF
            </span>
          </div>
          <p className="mt-1 text-[10px] text-gray-500">
            Follows lighting branch + switch leg (no Route button).
          </p>
        </div>

        <div className="rounded-md border border-perry-silver p-2">
          <div className="flex items-center justify-between">
            <span
              className="text-xs font-semibold"
              style={{ color: LV_COLORS.stat }}
            >
              Thermostats
            </span>
            <span className="text-[10px] tabular-nums text-gray-600">
              {stats.length} · {stubLf.toFixed(0)} LF stub
            </span>
          </div>
          <p className="mt-1 text-[10px] text-gray-500">
            Stub only — no routing.
          </p>
        </div>
      </section>
    </div>
  );
}

function CircuitRow({
  circuit,
  devices,
  routes,
  settings,
  calibrated,
  onRoute,
  onReset,
  onCheckClick,
}: {
  circuit: Circuit;
  devices: Device[];
  routes: Route[];
  settings: ProjectSettings;
  calibrated: boolean;
  onRoute: () => void;
  onReset: () => void;
  onCheckClick: (c: CodeCheck | null) => void;
}) {
  const onCkt = devices.filter(
    (d) => d.circuit_id === circuit.id || d.id === circuit.panel_device_id
  );
  const checks = useMemo(() => {
    const farthest = farthestFromRoutes(routes, settings);
    return runCircuitChecks({
      ctype: circuit.ctype,
      voltage: circuit.voltage,
      breakerAmps: circuit.breaker_amps,
      devices: onCkt,
      farthestFt: farthest || 1,
      homeRunSharedCircuits: 1,
      settings,
    });
  }, [circuit, onCkt, routes, settings]);

  const hue = circuitHue(circuit.number);
  const nDev = devices.filter((d) => d.circuit_id === circuit.id).length;

  return (
    <li className="rounded-md border border-perry-silver p-2">
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-semibold" style={{ color: hue }}>
          Ckt {circuit.number} · {circuit.ctype} · {circuit.voltage}V
        </span>
        <span className="text-[10px] text-gray-500">{nDev} dev</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {checks.checks.map((ch) => (
          <button
            key={ch.name}
            type="button"
            onClick={() => onCheckClick(ch)}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
              ch.status === "pass"
                ? "bg-green-100 text-green-800"
                : ch.status === "warn"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-red-100 text-perry-signal"
            }`}
          >
            {ch.status}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-1">
        <Button
          type="button"
          className="!px-2 !py-1 !text-[11px]"
          disabled={!calibrated}
          onClick={onRoute}
        >
          Route
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="!px-2 !py-1 !text-[11px]"
          onClick={onReset}
        >
          Reset routes
        </Button>
      </div>
    </li>
  );
}
