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
import type { PipelineStage } from "./PipelineBar";
import { Button } from "@/components/ui/Button";
import { runCircuitChecks, farthestFromRoutes } from "@/lib/checks";
import { isCalibrated, formatScaleBadge } from "@/lib/scale";
import { circuitHue } from "@/lib/routing";
import { circuitDisplayLabel, countByCategory } from "@/lib/devices";
import {
  STAMP_CATEGORIES,
  catalogByCategory,
  getCatalogEntry,
  type CatalogCategory,
  type CatalogEntry,
} from "@/lib/catalog";
import {
  dataRouteReady,
  dimmingFollows,
  dimmingTotalPlanFt,
  findThermostats,
  fireRouteReady,
  LV_COLORS,
} from "@/lib/lv-routing";
import type { TakeoffSummary } from "@/lib/takeoff";
import { DEFAULT_SETTINGS } from "@/lib/types";

export type ArmedCircuit = string | "new" | null;

type Props = {
  stage: PipelineStage;
  onGoToStage: (stage: PipelineStage) => void;

  // Calibrate
  calibrated: boolean;
  ftPerPx: number | null;
  renderDpi?: number | null;
  onStartCalibrate: () => void;

  // Devices
  selected: Device[];
  onChangeLabel: (label: string) => void;
  onChangeWatts: (watts: number) => void;
  onChangeDimming: (dimming: boolean) => void;
  lastCatalogId: string;
  stamping: boolean;
  onPickStamp: (entry: CatalogEntry) => void;

  // Shared data
  devices: Device[];
  circuits: Circuit[];
  routes: Route[];
  settings: ProjectSettings;

  // Circuits (paint model)
  armedCircuitId: ArmedCircuit;
  onArmCircuit: (id: ArmedCircuit) => void;
  onAutoGroup: (ctype: "lighting" | "receptacle", panelId: string) => void;
  circuitBusy?: boolean;

  // Routes
  onRoute: (circuitId: string) => void;
  onRouteAll: () => void;
  onResetRoutes: (circuitId: string) => void;
  onSetHrEntry: (circuitId: string, entryDeviceId: string | null) => void;
  onRouteFire: () => void;
  onRouteData: () => void;
  editRoutes: boolean;
  onToggleEditRoutes: () => void;
  checkDetail: CodeCheck | null;
  onCheckClick: (check: CodeCheck | null) => void;

  // Takeoff
  takeoffSummary: TakeoffSummary;
  takeoffHref: string | null;
};

const STAGE_TITLES: Record<PipelineStage, string> = {
  calibrate: "Calibrate",
  devices: "Devices",
  circuits: "Circuits",
  routes: "Routes",
  takeoff: "Takeoff",
};

function Coach({
  text,
  buttonLabel,
  onClick,
  disabled,
}: {
  text: string;
  buttonLabel?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-md border border-dashed border-perry-silver bg-perry-white/60 p-3">
      <p className="text-xs text-gray-600">{text}</p>
      {buttonLabel && onClick && (
        <Button
          type="button"
          className="mt-2 w-full"
          onClick={onClick}
          disabled={disabled}
        >
          {buttonLabel}
        </Button>
      )}
    </div>
  );
}

export function SheetSidePanel(props: Props) {
  const { stage, checkDetail, onCheckClick } = props;

  return (
    <aside className="absolute bottom-0 right-0 top-9 z-20 flex w-72 flex-col border-l border-perry-silver bg-white shadow-sm">
      <div className="border-b border-perry-silver px-3 py-2">
        <h2 className="font-display text-sm text-perry-industrial">
          {STAGE_TITLES[stage]}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {stage === "calibrate" && <CalibrateStage {...props} />}
        {stage === "devices" && <DevicesStage {...props} />}
        {stage === "circuits" && <CircuitsStage {...props} />}
        {stage === "routes" && <RoutesStage {...props} />}
        {stage === "takeoff" && <TakeoffStage {...props} />}
      </div>
      {checkDetail && (
        <div className="border-t border-perry-silver bg-perry-white p-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <strong>{checkDetail.name}</strong>
            <button
              type="button"
              className="text-perry-blue"
              onClick={() => onCheckClick(null)}
            >
              Close
            </button>
          </div>
          <p className="mt-1 text-gray-700">{checkDetail.detail}</p>
          <p className="mt-2 text-gray-500">{checkDetail.why}</p>
        </div>
      )}
    </aside>
  );
}

// ————— Calibrate —————

function CalibrateStage({
  calibrated,
  ftPerPx,
  renderDpi,
  onStartCalibrate,
  onGoToStage,
}: Props) {
  return (
    <div className="space-y-3">
      {calibrated && ftPerPx != null ? (
        <>
          <div className="rounded-md border border-perry-silver p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Scale
            </p>
            <p className="mt-1 text-sm font-semibold text-green-700">
              Calibrated · {formatScaleBadge(ftPerPx, renderDpi ?? null)}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={onStartCalibrate}
          >
            Re-calibrate
          </Button>
          <Button
            type="button"
            className="w-full"
            onClick={() => onGoToStage("devices")}
          >
            Next: stamp devices →
          </Button>
        </>
      ) : (
        <Coach
          text="Set the scale first — click two points on a known dimension (a door, a grid line) and enter the real length."
          buttonLabel="Calibrate scale"
          onClick={onStartCalibrate}
        />
      )}
    </div>
  );
}

// ————— Devices —————

function DevicesStage(props: Props) {
  const {
    devices,
    selected,
    lastCatalogId,
    stamping,
    onPickStamp,
    onChangeLabel,
    onChangeWatts,
    onChangeDimming,
  } = props;
  const [openCat, setOpenCat] = useState<CatalogCategory | null>(null);
  const counts = useMemo(() => countByCategory(devices), [devices]);
  const lastEntry = getCatalogEntry(lastCatalogId);

  return (
    <div className="space-y-3">
      {devices.length === 0 && (
        <Coach
          text="No devices yet — pick a subtype below, then click the plan to stamp. Start with a Panel."
          buttonLabel={lastEntry ? `Stamp ${lastEntry.label}` : undefined}
          onClick={lastEntry ? () => onPickStamp(lastEntry) : undefined}
        />
      )}

      {lastEntry && (
        <button
          type="button"
          onClick={() => onPickStamp(lastEntry)}
          className={`w-full rounded-md border px-3 py-2 text-left ${
            stamping
              ? "border-perry-blue bg-blue-50/60"
              : "border-perry-silver bg-white hover:border-perry-blue"
          }`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Last used {stamping ? "· stamping" : ""}
          </p>
          <p className="text-sm font-semibold text-perry-industrial">
            {lastEntry.label}
          </p>
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        {STAMP_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() =>
              setOpenCat((prev) => (prev === c.id ? null : c.id))
            }
            className={`rounded-md border px-3 py-2.5 text-left ${
              openCat === c.id
                ? "border-perry-blue bg-blue-50/60"
                : "border-perry-silver bg-white hover:border-perry-blue"
            }`}
          >
            <p className="text-sm font-semibold text-perry-industrial">
              {c.label}
            </p>
            <p className="text-[11px] tabular-nums text-gray-500">
              {counts[c.id] ?? 0} placed
            </p>
          </button>
        ))}
      </div>

      {openCat && (
        <ul className="rounded-md border border-perry-silver bg-white p-1">
          {catalogByCategory(openCat).map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-perry-white ${
                  e.id === lastCatalogId
                    ? "font-semibold text-perry-blue"
                    : "text-perry-industrial"
                }`}
                onClick={() => {
                  onPickStamp(e);
                  setOpenCat(null);
                }}
              >
                {e.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <span
        className="block"
        title="Phase 3 — visual search finds every symbol matching the selected device."
      >
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled
        >
          Find all like this
        </Button>
      </span>

      {selected.length > 0 && (
        <div className="border-t border-perry-silver pt-3">
          <DeviceSidePanel
            selected={selected}
            onChangeLabel={onChangeLabel}
            onChangeWatts={onChangeWatts}
            onChangeDimming={onChangeDimming}
          />
        </div>
      )}
    </div>
  );
}

// ————— Circuits (paint) —————

function CircuitsStage(props: Props) {
  const {
    devices,
    circuits,
    armedCircuitId,
    onArmCircuit,
    onAutoGroup,
    circuitBusy = false,
  } = props;
  const [groupType, setGroupType] = useState<"lighting" | "receptacle">(
    "lighting"
  );
  const panels = devices.filter((d) => d.type === "panel");
  const [panelId, setPanelId] = useState("");
  useEffect(() => {
    if (!panelId && panels[0]) setPanelId(panels[0].id);
  }, [panels, panelId]);

  const unassigned = devices.filter(
    (d) => d.type !== "panel" && !d.circuit_id
  ).length;

  return (
    <div className="space-y-3">
      {!circuits.length && (
        <Coach
          text={
            unassigned > 0
              ? `${unassigned} device${unassigned === 1 ? "" : "s"} not on a circuit — press N for a new circuit, then click devices to paint them in.`
              : "No circuits yet — stamp devices first, then press N and click devices to paint them in."
          }
          buttonLabel="New circuit (N)"
          onClick={() => onArmCircuit("new")}
          disabled={circuitBusy}
        />
      )}

      {circuits.length > 0 && unassigned > 0 && (
        <p className="text-[11px] text-gray-600">
          {unassigned} device{unassigned === 1 ? "" : "s"} not on a circuit —
          arm a circuit (or press N), then click devices to paint them in.
        </p>
      )}

      {circuits.length > 0 && (
        <ul className="space-y-1">
          {circuits.map((c, i) => {
            const hue = circuitHue(c.number);
            const armed = armedCircuitId === c.id;
            const nDev = devices.filter(
              (d) => d.circuit_id === c.id
            ).length;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onArmCircuit(armed ? null : c.id)}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left ${
                    armed ? "bg-perry-white" : "bg-white hover:bg-perry-white"
                  }`}
                  style={{
                    borderColor: armed ? hue : "#C5CBD8",
                    boxShadow: armed ? `inset 0 0 0 1px ${hue}` : undefined,
                  }}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: hue }}
                  />
                  <span
                    className="flex-1 text-xs font-semibold"
                    style={{ color: hue }}
                  >
                    {circuitDisplayLabel(c, devices)} · {c.ctype}
                  </span>
                  <span className="text-[10px] tabular-nums text-gray-500">
                    {i < 9 ? `[${i + 1}] ` : ""}
                    {nDev} dev
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {armedCircuitId && (
        <p className="rounded-md bg-perry-white px-2 py-1.5 text-[11px] text-gray-600">
          {armedCircuitId === "new"
            ? "New circuit armed — click the first device to create it (device type sets the circuit type)."
            : "Painting — click devices to toggle them in/out. Lasso adds all."}
        </p>
      )}

      <Button
        type="button"
        variant={armedCircuitId === "new" ? "primary" : "secondary"}
        className="w-full"
        disabled={circuitBusy}
        onClick={() =>
          onArmCircuit(armedCircuitId === "new" ? null : "new")
        }
      >
        {circuitBusy
          ? "Creating…"
          : armedCircuitId === "new"
            ? "Cancel new circuit"
            : "New circuit (N)"}
      </Button>

      <section className="space-y-2 border-t border-perry-silver pt-3">
        <h3 className="font-display text-sm">Auto-fill circuits</h3>
        <div className="flex gap-1.5">
          <select
            value={groupType}
            onChange={(e) =>
              setGroupType(e.target.value as "lighting" | "receptacle")
            }
            className="flex-1 rounded border border-perry-silver px-2 py-1 text-sm"
          >
            <option value="lighting">Lighting</option>
            <option value="receptacle">Receptacles</option>
          </select>
          <Button
            type="button"
            variant="ghost"
            disabled={!panelId}
            onClick={() => onAutoGroup(groupType, panelId)}
          >
            Auto-fill
          </Button>
        </div>
        {panels.length > 1 && (
          <select
            value={panelId}
            onChange={(e) => setPanelId(e.target.value)}
            className="w-full rounded border border-perry-silver px-2 py-1 text-sm"
          >
            {panels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.attrs.label || "Panel"}
              </option>
            ))}
          </select>
        )}
        {!panels.length && (
          <p className="text-[11px] text-perry-signal">
            Stamp a Panel before creating circuits.
          </p>
        )}
      </section>
    </div>
  );
}

// ————— Routes —————

function RoutesStage(props: Props) {
  const {
    devices,
    circuits,
    routes,
    settings,
    ftPerPx,
    onRoute,
    onRouteAll,
    onResetRoutes,
    onSetHrEntry,
    onRouteFire,
    onRouteData,
    editRoutes,
    onToggleEditRoutes,
    onCheckClick,
  } = props;
  const calibrated = isCalibrated(ftPerPx);
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  const powerRoutes = routes.filter((r) => r.circuit_id);

  const dimmingLf = useMemo(() => {
    const follows = dimmingFollows({ circuits, devices, routes });
    return dimmingTotalPlanFt(follows);
  }, [circuits, devices, routes]);
  const stats = useMemo(() => findThermostats(devices), [devices]);
  const stubLf = stats.length * (merged.lv_stub_ft ?? 10);
  const fireOk = fireRouteReady(devices);
  const dataOk = dataRouteReady(devices);

  return (
    <div className="space-y-3">
      {!powerRoutes.length && (
        <Coach
          text={
            !calibrated
              ? "Calibrate first — footages need a scale."
              : !circuits.length
                ? "No circuits yet — paint devices into circuits first."
                : "No routes yet — Route all draws home runs and branch chains for every circuit."
          }
          buttonLabel={
            calibrated && circuits.length ? "Route all" : undefined
          }
          onClick={
            calibrated && circuits.length ? onRouteAll : undefined
          }
        />
      )}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="secondary"
          disabled={!calibrated || !circuits.length}
          onClick={onRouteAll}
        >
          Route all
        </Button>
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
      <p className="text-[11px] text-gray-500">
        Click a route to select it, then drag bends or segments. Edited
        routes survive re-routing.
      </p>

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
            onSetHrEntry={(entryId) => onSetHrEntry(c.id, entryId)}
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
          <span
            className="text-xs font-semibold"
            style={{ color: LV_COLORS.fire }}
          >
            Fire alarm
          </span>
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
          <span
            className="text-xs font-semibold"
            style={{ color: LV_COLORS.data }}
          >
            Data
          </span>
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

// ————— Takeoff —————

function TakeoffStage({
  routes,
  takeoffSummary,
  takeoffHref,
  onGoToStage,
}: Props) {
  const powerRoutes = routes.filter((r) => r.circuit_id);
  const cells: [string, number][] = [
    ["EMT LF", takeoffSummary.emtLf],
    ["MC LF", takeoffSummary.mcLf],
    ["Wire LF", takeoffSummary.wireLf],
    ["Devices", takeoffSummary.deviceCount],
  ];
  return (
    <div className="space-y-3">
      {!powerRoutes.length && (
        <Coach
          text="No routed circuits yet — quantities appear once routes are drawn."
          buttonLabel="Go to Routes"
          onClick={() => onGoToStage("routes")}
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        {cells.map(([label, value]) => (
          <div
            key={label}
            className="rounded-md border border-perry-silver p-3"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {label}
            </p>
            <p className="mt-1 font-display text-xl tabular-nums text-perry-industrial">
              {value}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-500">
        This sheet&apos;s devices and routes roll into the project takeoff
        with per-circuit detail, shared home-run pipes, and CSV export.
      </p>
      {takeoffHref && (
        <a
          href={takeoffHref}
          className="block w-full rounded-md bg-perry-blue px-3 py-2 text-center text-sm font-semibold text-white hover:brightness-110"
        >
          Open full takeoff
        </a>
      )}
    </div>
  );
}

// ————— Per-circuit row (Routes stage) —————

function CircuitRow({
  circuit,
  devices,
  routes,
  settings,
  calibrated,
  onRoute,
  onReset,
  onSetHrEntry,
  onCheckClick,
}: {
  circuit: Circuit;
  devices: Device[];
  routes: Route[];
  settings: ProjectSettings;
  calibrated: boolean;
  onRoute: () => void;
  onReset: () => void;
  onSetHrEntry: (entryDeviceId: string | null) => void;
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
  const entryCandidates = devices.filter(
    (d) => d.type === "jbox" || d.type === "switch"
  );

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
      <label className="mt-2 block text-[10px] font-semibold uppercase text-gray-500">
        Set HR entry
        <select
          className="mt-0.5 w-full rounded border border-perry-silver bg-white px-1.5 py-1 text-[11px] font-normal normal-case text-gray-800"
          value={circuit.entry_device_id ?? ""}
          onChange={(e) =>
            onSetHrEntry(e.target.value ? e.target.value : null)
          }
        >
          <option value="">Auto (nearest)</option>
          {entryCandidates.map((d) => (
            <option key={d.id} value={d.id}>
              {d.attrs.label || d.type}
              {d.type === "jbox" ? " · J-box" : " · Switch"}
            </option>
          ))}
        </select>
      </label>
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
