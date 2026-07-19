"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Group,
  Image as KonvaImage,
  Line,
  Circle,
  Text,
  Rect,
} from "react-konva";
import type Konva from "konva";
import useImage from "./use-image";
import { CalibrateDialog } from "./CalibrateDialog";
import { DeviceShape } from "./DeviceShape";
import { SheetSidePanel, type ArmedCircuit } from "./SheetSidePanel";
import { RouteLayer } from "./RouteLayer";
import { CircuitLegend } from "./CircuitLegend";
import { PdfSharpOverlay } from "./PdfSharpOverlay";
import {
  PipelineBar,
  type PipelineStage,
  type PipelineStep,
} from "./PipelineBar";
import { ShortcutCheatSheet } from "./ShortcutCheatSheet";
import { TakeoffSummaryCard } from "@/components/takeoff/TakeoffSummaryCard";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import {
  formatFtIn,
  formatScaleBadge,
  ftPerPxFromTwoPoint,
  isCalibrated,
  pxToFt,
} from "@/lib/scale";
import {
  backfillCatalogId,
  getCatalogEntry,
  type CatalogEntry,
} from "@/lib/catalog";
import {
  circuitDisplayLabel,
  defaultAttrsForCatalog,
} from "@/lib/devices";
import { pointerInNodeLocal } from "@/lib/konva-coords";
import {
  circuitHue,
  devicesForCircuitRouting,
  glueRoutesToMovedDevice,
  recomputeRoutePlanLengths,
  routeCircuit,
} from "@/lib/routing";
import {
  createRoutePersister,
  type RoutePersister,
} from "@/lib/route-persist";
import { routeLayerInteractive } from "@/lib/canvas-gates";
import { withWriteTimeout } from "@/lib/write-guard";
import {
  dataRouteReady,
  findDataDrops,
  findFacp,
  findFireDevices,
  findIdfRooms,
  fireRouteReady,
  routeDataSystem,
  routeFireSystem,
} from "@/lib/lv-routing";
import {
  fitSizeForRotation,
  normalizeRotation,
  rotateStep,
  type SheetRotation,
} from "@/lib/rotation";
import { autoGroupDevices } from "@/lib/auto-group";
import { insertCircuitWithRetry } from "@/lib/circuits";
import { buildProjectTakeoff, summarizeTakeoff } from "@/lib/takeoff";
import type {
  Circuit,
  CodeCheck,
  Device,
  Point as GeoPoint,
  ProjectSettings,
  Route,
} from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
type UndoAction =
  | { kind: "stamp"; device: Device }
  | { kind: "delete"; devices: Device[] }
  | { kind: "move"; before: { id: string; x: number; y: number }[] };

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const DRAG_DEBOUNCE_MS = 120;

type Tool =
  | "select"
  | "pan"
  | "calibrate"
  | "measure"
  | "stamp";

type Point = { x: number; y: number };

type Props = {
  sheetId: string;
  imageUrl: string;
  /** Signed URL for source PDF (sharp-zoom overlay). */
  pdfUrl?: string | null;
  /** 1-based page that was rasterized. */
  pdfPage?: number;
  imageW: number;
  imageH: number;
  initialFtPerPx: number | null;
  initialRotation?: SheetRotation;
  initialRenderDpi?: number | null;
  settings?: ProjectSettings;
  title?: string;
  backHref?: string;
};

export function SheetViewer({
  sheetId,
  imageUrl,
  pdfUrl = null,
  pdfPage = 1,
  imageW,
  imageH,
  initialFtPerPx,
  initialRotation = 0,
  initialRenderDpi = null,
  settings: settingsProp,
  title,
  backHref,
}: Props) {
  const settings = settingsProp || DEFAULT_SETTINGS;
  const { showError } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const contentGroupRef = useRef<Konva.Group>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [viewMoving, setViewMoving] = useState(false);
  const viewMovingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const image = useImage(imageUrl);
  const midPan = useRef<{
    active: boolean;
    lastX: number;
    lastY: number;
  }>({ active: false, lastX: 0, lastY: 0 });
  const dragTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const devicesRef = useRef<Device[]>([]);
  const undoRef = useRef<UndoAction | null>(null);
  const moveBeforeRef = useRef<{ id: string; x: number; y: number }[] | null>(
    null
  );
  const routesRef = useRef<Route[]>([]);
  const showErrorRef = useRef<typeof showError>(showError);
  const routePersister = useRef<RoutePersister | null>(null);
  if (!routePersister.current) {
    routePersister.current = createRoutePersister({
      debounceMs: DRAG_DEBOUNCE_MS,
      getRoute: (id) => routesRef.current.find((r) => r.id === id),
      write: async (id, fields) => {
        const supabase = createClient();
        const { error } = await withWriteTimeout(() =>
          supabase.from("routes").update(fields).eq("id", id)
        );
        return { error };
      },
      onError: (message, retry) => showErrorRef.current(message, retry),
    });
  }

  const [tool, setTool] = useState<Tool>("select");
  const [lastCatalogId, setLastCatalogId] = useState("recep-duplex-20");
  const [sheetLoading, setSheetLoading] = useState(true);
  const [ftPerPx, setFtPerPx] = useState<number | null>(initialFtPerPx);
  const [rotation, setRotation] = useState<SheetRotation>(
    normalizeRotation(initialRotation ?? 0)
  );
  const [renderDpi] = useState<number | null>(initialRenderDpi ?? null);
  const [calibrateDialogOpen, setCalibrateDialogOpen] = useState(false);
  const [p1, setP1] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  /** Endpoints only — feet derived from current ftPerPx (never cached). */
  const [measureResult, setMeasureResult] = useState<{
    a: Point;
    b: Point;
  } | null>(null);
  const [calibratePending, setCalibratePending] = useState<{
    a: Point;
    b: Point;
    px: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const [devices, setDevices] = useState<Device[]>([]);
  const [circuits, setCircuits] = useState<Circuit[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [editRoutes, setEditRoutes] = useState(false);
  const [circuitBusy, setCircuitBusy] = useState(false);
  const [checkDetail, setCheckDetail] = useState<CodeCheck | null>(null);
  const [lasso, setLasso] = useState<{
    start: Point;
    current: Point;
  } | null>(null);
  const lassoRef = useRef<{ start: Point; active: boolean } | null>(null);

  // Process-flow shell: active stage, armed circuit for painting, cheat sheet.
  const [stage, setStage] = useState<PipelineStage>("calibrate");
  const stageInitRef = useRef(false);
  const [armed, setArmed] = useState<ArmedCircuit>(null);
  const armedRef = useRef<ArmedCircuit>(null);
  const [cheatOpen, setCheatOpen] = useState(false);
  const lastPanelIdRef = useRef<string | null>(null);
  const circuitsRef = useRef<Circuit[]>([]);

  const calibrated = isCalibrated(ftPerPx);
  const pointing = tool === "calibrate" || tool === "measure";
  const stamping = tool === "stamp";
  const stampEntry = stamping ? getCatalogEntry(lastCatalogId) : undefined;

  devicesRef.current = devices;
  circuitsRef.current = circuits;
  armedRef.current = armed;

  const selected = useMemo(
    () => devices.filter((d) => selectedIds.includes(d.id)),
    [devices, selectedIds]
  );
  const circuitById = useMemo(
    () => new Map(circuits.map((c) => [c.id, c])),
    [circuits]
  );

  // Land on the first incomplete step once the sheet loads.
  useEffect(() => {
    if (sheetLoading || stageInitRef.current) return;
    stageInitRef.current = true;
    if (!calibrated) setStage("calibrate");
    else if (!devices.length) setStage("devices");
    else if (!circuits.length) setStage("circuits");
    else if (!routes.some((r) => r.circuit_id)) setStage("routes");
    else setStage("takeoff");
  }, [sheetLoading, calibrated, devices, circuits, routes]);

  // Load devices, circuits, routes
  useEffect(() => {
    const supabase = createClient();
    setSheetLoading(true);
    void (async () => {
      const [{ data: devs, error: de }, { data: ckts, error: ce }] =
        await Promise.all([
          supabase.from("devices").select("*").eq("sheet_id", sheetId),
          supabase.from("circuits").select("*").eq("sheet_id", sheetId),
        ]);
      if (de || ce) {
        showError(de?.message || ce?.message || "Failed to load sheet data");
      }
      setDevices(
        ((devs as Device[]) || []).map((d) => ({
          ...d,
          catalog_id: d.catalog_id || backfillCatalogId(d.type),
        }))
      );
      const circuitRows = ((ckts as Circuit[]) || []).map((c) => ({
        ...c,
        entry_device_id: c.entry_device_id ?? null,
      }));
      setCircuits(circuitRows);
      const ids = circuitRows.map((c) => c.id);
      const powerQ = ids.length
        ? supabase.from("routes").select("*").in("circuit_id", ids)
        : Promise.resolve({ data: [] as Route[], error: null });
      const lvQ = supabase
        .from("routes")
        .select("*")
        .eq("sheet_id", sheetId);
      const [{ data: powerRts }, { data: lvRts }] = await Promise.all([
        powerQ,
        lvQ,
      ]);
      const merged = [
        ...((powerRts as Route[]) || []),
        ...((lvRts as Route[]) || []),
      ];
      // Dedupe by id (shouldn't overlap)
      const byId = new Map(merged.map((r) => [r.id, r]));
      setRoutes(Array.from(byId.values()));
      setSheetLoading(false);
    })();
  }, [sheetId, showError]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const block = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    const onContext = (e: MouseEvent) => {
      if (stamping) {
        e.preventDefault();
        selectTool("select");
      }
    };
    el.addEventListener("mousedown", block);
    el.addEventListener("auxclick", block);
    el.addEventListener("contextmenu", onContext);
    return () => {
      el.removeEventListener("mousedown", block);
      el.removeEventListener("auxclick", block);
      el.removeEventListener("contextmenu", onContext);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamping]);

  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLSelectElement ||
      (t instanceof HTMLElement && t.isContentEditable);

    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void performUndo();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setCalibratePending(null);
        setCalibrateDialogOpen(false);
        setMeasureResult(null);
        setP1(null);
        setCursor(null);
        setLasso(null);
        lassoRef.current = null;
        setCheatOpen(false);
        setArmed(null);
        selectTool("select");
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setCheatOpen((v) => !v);
        return;
      }

      if (
        (e.key === "n" || e.key === "N") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setStage("circuits");
        setArmed((prev) => (prev === "new" ? null : "new"));
        return;
      }

      if (
        /^[1-9]$/.test(e.key) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        const ckt = circuitsRef.current[Number(e.key) - 1];
        if (ckt) {
          e.preventDefault();
          setStage("circuits");
          setArmed((prev) => (prev === ckt.id ? null : ckt.id));
        }
        return;
      }

      if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        selectTool("select");
        return;
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        selectTool("measure");
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        selectTool("stamp");
        return;
      }

      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        if (tool === "select") selectTool("stamp");
        else selectTool("select");
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        tool === "select" &&
        selectedIds.length > 0
      ) {
        e.preventDefault();
        void deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, selectedIds, lastCatalogId]);

  const fitToScreen = useCallback(() => {
    if (!size.w || !size.h || !imageW || !imageH) return;
    const pad = 24;
    const { w: fitW, h: fitH } = fitSizeForRotation(imageW, imageH, rotation);
    const s = Math.min(
      (size.w - pad) / fitW,
      (size.h - pad) / fitH,
      MAX_SCALE
    );
    const clamped = Math.max(MIN_SCALE, s);
    // Center the image pivot (rotation origin), not the unrotated top-left.
    const cx = imageW / 2;
    const cy = imageH / 2;
    setScale(clamped);
    setPos({
      x: size.w / 2 - cx * clamped,
      y: size.h / 2 - cy * clamped,
    });
  }, [size.w, size.h, imageW, imageH, rotation]);

  useEffect(() => {
    if (image && size.w > 0) fitToScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, imageW, imageH, size.w, size.h, rotation]);

  /** Pointer in unrotated image space (content Group local coords). */
  function toImagePoint(): Point | null {
    const g = contentGroupRef.current;
    if (!g) return null;
    return pointerInNodeLocal(g);
  }

  function cursorFor(t: Tool): string {
    if (t === "pan") return "grab";
    if (t === "select") return "default";
    return "crosshair";
  }

  function selectTool(t: Tool) {
    setTool(t);
    setP1(null);
    setCursor(null);
    setLasso(null);
    lassoRef.current = null;
    if (t !== "measure") setMeasureResult(null);
    if (t !== "stamp" && t !== "select") setSelectedIds([]);
    // Keep the step bar in sync with what the user is doing.
    if (t === "stamp") setStage("devices");
    if (t === "calibrate") {
      setStage("calibrate");
      setCalibratePending(null);
      setCalibrateDialogOpen(true);
    }
    const stage = stageRef.current;
    if (stage) {
      stage.draggable(t === "pan");
      stage.container().style.cursor = cursorFor(t);
    }
  }

  async function persistRotation(next: SheetRotation) {
    setRotation(next);
    const supabase = createClient();
    const { error } = await withWriteTimeout(() =>
      supabase.from("sheets").update({ rotation: next }).eq("id", sheetId)
    );
    if (error) {
      showError(error.message, () => void persistRotation(next));
    }
  }

  function rotateBy(dir: 1 | -1) {
    void persistRotation(rotateStep(rotation, dir));
  }

  function schedulePosPersist(id: string, x: number, y: number) {
    const prev = dragTimers.current.get(id);
    if (prev) clearTimeout(prev);
    dragTimers.current.set(
      id,
      setTimeout(() => {
        dragTimers.current.delete(id);
        const supabase = createClient();
        void (async () => {
          const { error } = await withWriteTimeout(() =>
            supabase.from("devices").update({ x, y }).eq("id", id)
          );
          if (error) {
            showError(error.message, () => schedulePosPersist(id, x, y));
          }
        })();
      }, DRAG_DEBOUNCE_MS)
    );
  }

  routesRef.current = routes;
  showErrorRef.current = showError;

  // Flush pending route writes when leaving the sheet (SPA nav unmount)
  // or when the page is hidden/closed (best effort).
  useEffect(() => {
    const flush = () => routePersister.current?.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  async function performUndo() {
    const action = undoRef.current;
    if (!action) return;
    undoRef.current = null;
    const supabase = createClient();

    if (action.kind === "stamp") {
      setDevices((prev) => prev.filter((d) => d.id !== action.device.id));
      setSelectedIds((prev) => prev.filter((id) => id !== action.device.id));
      const { error } = await withWriteTimeout(() =>
        supabase.from("devices").delete().eq("id", action.device.id)
      );
      if (error) {
        setDevices((prev) => [...prev, action.device]);
        showError(error.message);
      }
      return;
    }

    if (action.kind === "delete") {
      setDevices((prev) => [...prev, ...action.devices]);
      const { error } = await withWriteTimeout(() =>
        supabase.from("devices").insert(
          action.devices.map((d) => ({
            id: d.id,
            sheet_id: d.sheet_id,
            type: d.type,
            catalog_id: d.catalog_id,
            x: d.x,
            y: d.y,
            attrs: d.attrs,
            circuit_id: d.circuit_id,
          }))
        )
      );
      if (error) {
        setDevices((prev) =>
          prev.filter((d) => !action.devices.some((x) => x.id === d.id))
        );
        showError(error.message);
      }
      return;
    }

    if (action.kind === "move") {
      const map = new Map(action.before.map((b) => [b.id, b]));
      setDevices((prev) =>
        prev.map((d) => {
          const b = map.get(d.id);
          return b ? { ...d, x: b.x, y: b.y } : d;
        })
      );
      for (const b of action.before) {
        const { error } = await withWriteTimeout(() =>
          supabase.from("devices").update({ x: b.x, y: b.y }).eq("id", b.id)
        );
        if (error) {
          showError(error.message);
          break;
        }
      }
    }
  }

  async function stampAt(pt: Point) {
    const entry = getCatalogEntry(lastCatalogId);
    if (!entry) return;
    const id = crypto.randomUUID();
    const attrs = defaultAttrsForCatalog(entry.id, devicesRef.current);
    const optimistic: Device = {
      id,
      sheet_id: sheetId,
      type: entry.category,
      catalog_id: entry.id,
      x: pt.x,
      y: pt.y,
      attrs,
      circuit_id: null,
      created_at: new Date().toISOString(),
    };
    setDevices((prev) => [...prev, optimistic]);
    setSelectedIds([id]);

    const supabase = createClient();
    const { data, error } = await withWriteTimeout(() =>
      supabase
        .from("devices")
        .insert({
          id,
          sheet_id: sheetId,
          type: entry.category,
          catalog_id: entry.id,
          x: pt.x,
          y: pt.y,
          attrs,
        })
        .select("*")
        .single()
    );
    if (error) {
      setDevices((prev) => prev.filter((d) => d.id !== id));
      showError(error.message, () => void stampAt(pt));
      return;
    }
    const saved = data as Device;
    undoRef.current = { kind: "stamp", device: saved };
    setDevices((prev) =>
      prev.map((d) => (d.id === id ? saved : d))
    );
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const removed = devicesRef.current.filter((d) => ids.includes(d.id));
    undoRef.current = { kind: "delete", devices: removed };
    setDevices((prev) => prev.filter((d) => !ids.includes(d.id)));
    setSelectedIds([]);
    const supabase = createClient();
    const { error } = await withWriteTimeout(() =>
      supabase.from("devices").delete().in("id", ids)
    );
    if (error) {
      showError(error.message, () => void deleteSelected());
      const { data } = await supabase
        .from("devices")
        .select("*")
        .eq("sheet_id", sheetId);
      setDevices((data as Device[]) || []);
      undoRef.current = null;
    }
  }

  async function createCircuit(opts: {
    panelId: string;
    ctype: "lighting" | "receptacle";
    voltage: number;
  }): Promise<Circuit | null> {
    if (circuitBusy) return null;
    setCircuitBusy(true);
    const { panelId, ctype, voltage } = opts;
    lastPanelIdRef.current = panelId;
    const nextNum =
      circuitsRef.current.reduce((m, c) => Math.max(m, c.number), 0) + 1;
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Circuit = {
      id: tempId,
      sheet_id: sheetId,
      panel_device_id: panelId,
      number: nextNum,
      ctype,
      voltage,
      breaker_amps: 20,
      entry_device_id: null,
      created_at: new Date().toISOString(),
    };
    setCircuits((prev) => [...prev, optimistic]);
    try {
      const supabase = createClient();
      const data = await insertCircuitWithRetry(supabase, {
        sheet_id: sheetId,
        panel_device_id: panelId,
        number: nextNum,
        ctype,
        voltage,
        breaker_amps: 20,
      });
      setCircuits((prev) => prev.map((c) => (c.id === tempId ? data : c)));
      return data;
    } catch (err) {
      setCircuits((prev) => prev.filter((c) => c.id !== tempId));
      showError(
        err instanceof Error ? err.message : "Failed to create circuit"
      );
      return null;
    } finally {
      setCircuitBusy(false);
    }
  }

  /** Panel = last used (fallback first); type = from the painted device. */
  async function createCircuitForDevice(dev: Device): Promise<Circuit | null> {
    const panels = devicesRef.current.filter((d) => d.type === "panel");
    const panelId =
      lastPanelIdRef.current &&
      panels.some((p) => p.id === lastPanelIdRef.current)
        ? lastPanelIdRef.current
        : panels[0]?.id;
    if (!panelId) {
      showError("Stamp a Panel first — circuits need a panel to feed from.");
      return null;
    }
    const ctype = dev.type === "receptacle" ? "receptacle" : "lighting";
    const voltage =
      ctype === "lighting"
        ? settings.lighting_voltage
        : settings.receptacle_voltage;
    return createCircuit({ panelId, ctype, voltage });
  }

  async function assignDevices(ids: string[], circuitId: string | null) {
    const targets = ids.filter((id) => {
      const d = devicesRef.current.find((x) => x.id === id);
      return d && d.type !== "panel";
    });
    if (!targets.length) return;
    const run = async () => {
      setDevices((prev) =>
        prev.map((d) =>
          targets.includes(d.id) ? { ...d, circuit_id: circuitId } : d
        )
      );
      const supabase = createClient();
      const { error } = await withWriteTimeout(() =>
        supabase
          .from("devices")
          .update({ circuit_id: circuitId })
          .in("id", targets)
      );
      if (error) showError(error.message, () => void run());
    };
    await run();
  }

  /** Circuits stage: click toggles the device in/out of the armed circuit. */
  async function paintDevice(dev: Device) {
    const target = armedRef.current;
    if (!target || dev.type === "panel") return;
    if (target === "new") {
      const ckt = await createCircuitForDevice(dev);
      if (!ckt) return;
      setArmed(ckt.id);
      await assignDevices([dev.id], ckt.id);
      return;
    }
    await assignDevices([dev.id], dev.circuit_id === target ? null : target);
  }

  /** Circuits stage: lasso adds all hit devices to the armed circuit. */
  async function paintLasso(ids: string[]) {
    const target = armedRef.current;
    if (!target) return;
    if (target === "new") {
      const first = devicesRef.current.find(
        (d) => ids.includes(d.id) && d.type !== "panel"
      );
      if (!first) return;
      const ckt = await createCircuitForDevice(first);
      if (!ckt) return;
      setArmed(ckt.id);
      await assignDevices(ids, ckt.id);
      return;
    }
    await assignDevices(ids, target);
  }

  async function persistAttrs(ids: string[], patch: Partial<Device["attrs"]>) {
    setDevices((prev) =>
      prev.map((d) =>
        ids.includes(d.id)
          ? { ...d, attrs: { ...d.attrs, ...patch } }
          : d
      )
    );
    const supabase = createClient();
    for (const id of ids) {
      const d = devicesRef.current.find((x) => x.id === id);
      const attrs = { ...(d?.attrs || {}), ...patch };
      const { error } = await withWriteTimeout(() =>
        supabase.from("devices").update({ attrs }).eq("id", id)
      );
      if (error) {
        showError(error.message, () => void persistAttrs(ids, patch));
        return;
      }
    }
  }

  function markViewMoving() {
    setViewMoving(true);
    if (viewMovingTimer.current) clearTimeout(viewMovingTimer.current);
    viewMovingTimer.current = setTimeout(() => {
      setViewMoving(false);
      viewMovingTimer.current = null;
    }, 120);
  }

  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.08;
    const newScale = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy
      )
    );

    const mousePointTo = {
      x: (pointer.x - pos.x) / oldScale,
      y: (pointer.y - pos.y) / oldScale,
    };
    markViewMoving();
    setScale(newScale);
    setPos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }

  function onMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.evt.button === 2 && stamping) {
      e.evt.preventDefault();
      selectTool("select");
      return;
    }

    if (e.evt.button === 1) {
      e.evt.preventDefault();
      midPan.current = {
        active: true,
        lastX: e.evt.clientX,
        lastY: e.evt.clientY,
      };
      const stage = stageRef.current;
      if (stage) {
        stage.draggable(false);
        stage.container().style.cursor = "grabbing";
      }
      return;
    }

    if (e.evt.button !== 0) return;

    const stage = stageRef.current;
    const pt = toImagePoint();
    if (!pt) return;

    // Clicked a device shape — let DeviceShape handle it
    const targetName = e.target.getClassName?.() || "";
    const isStageBg =
      e.target === stage ||
      targetName === "Stage" ||
      (e.target.getLayer?.() &&
        e.target.getLayer() === stage?.findOne("Layer") &&
        targetName === "Image");

    // Prefer: if target is Image or Stage empty area
    const clickedEmpty =
      e.target === stage ||
      e.target.getClassName() === "Image" ||
      e.target.getClassName() === "Stage";

    if (stamping && clickedEmpty) {
      void stampAt(pt);
      return;
    }

    if (pointing) {
      if (!p1) {
        setP1(pt);
        setCursor(pt);
        if (tool === "measure") setMeasureResult(null);
        return;
      }
      if (tool === "calibrate") {
        const px = Math.hypot(pt.x - p1.x, pt.y - p1.y);
        setCalibratePending({ a: p1, b: pt, px });
        setP1(null);
        setCursor(null);
        setCalibrateDialogOpen(true);
        return;
      }
      if (!calibrated || ftPerPx == null) {
        setP1(null);
        setCursor(null);
        return;
      }
      setMeasureResult({ a: p1, b: pt });
      setP1(null);
      setCursor(null);
      return;
    }

    if (tool === "select" && clickedEmpty) {
      if (!e.evt.shiftKey) setSelectedIds([]);
      lassoRef.current = { start: pt, active: true };
      setLasso({ start: pt, current: pt });
    }

    void isStageBg;
  }

  function onMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (midPan.current.active) {
      const dx = e.evt.clientX - midPan.current.lastX;
      const dy = e.evt.clientY - midPan.current.lastY;
      midPan.current.lastX = e.evt.clientX;
      midPan.current.lastY = e.evt.clientY;
      markViewMoving();
      setPos((p) => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }

    const pt = toImagePoint();
    if (!pt) return;

    if (pointing && p1) {
      setCursor(pt);
      return;
    }

    if (lassoRef.current?.active) {
      setLasso({ start: lassoRef.current.start, current: pt });
    }
  }

  function onMouseUp() {
    if (midPan.current.active) {
      midPan.current.active = false;
      const stage = stageRef.current;
      if (stage) {
        stage.draggable(tool === "pan");
        stage.container().style.cursor = cursorFor(tool);
      }
    }

    if (lassoRef.current?.active && lasso) {
      const x1 = Math.min(lasso.start.x, lasso.current.x);
      const x2 = Math.max(lasso.start.x, lasso.current.x);
      const y1 = Math.min(lasso.start.y, lasso.current.y);
      const y2 = Math.max(lasso.start.y, lasso.current.y);
      const hit = devicesRef.current
        .filter((d) => d.x >= x1 && d.x <= x2 && d.y >= y1 && d.y <= y2)
        .map((d) => d.id);
      if (hit.length) {
        if (stage === "circuits" && armedRef.current) {
          void paintLasso(hit);
        } else {
          setSelectedIds((prev) => Array.from(new Set([...prev, ...hit])));
        }
      }
      lassoRef.current = null;
      setLasso(null);
    }
  }

  /**
   * Persist sheet ft_per_px, sync in-memory scale, and recompute every
   * route's plan_length_ft from stored px paths × the new scale.
   */
  async function applySheetScale(next: number) {
    if (!(next > 0) || !Number.isFinite(next)) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await withWriteTimeout(() =>
      supabase.from("sheets").update({ ft_per_px: next }).eq("id", sheetId)
    );
    if (error) {
      setSaving(false);
      showError(error.message, () => void applySheetScale(next));
      return;
    }

    const updated = recomputeRoutePlanLengths(routesRef.current, next);
    setFtPerPx(next);
    setRoutes(updated);
    routesRef.current = updated;
    setMeasureResult(null);
    setCalibratePending(null);
    setCalibrateDialogOpen(false);
    selectTool("select");

    const results = await Promise.all(
      updated.map((r) =>
        withWriteTimeout(() =>
          supabase
            .from("routes")
            .update({ plan_length_ft: r.plan_length_ft })
            .eq("id", r.id)
        )
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) showError(failed.error.message);
    setSaving(false);
  }

  async function saveCalibration(feet: number) {
    if (!calibratePending || calibratePending.px < 1) return;
    const next = ftPerPxFromTwoPoint(feet, calibratePending.px);
    await applySheetScale(next);
  }

  async function savePresetScale(next: number) {
    await applySheetScale(next);
  }

  const liveLine =
    p1 && cursor ? [p1.x, p1.y, cursor.x, cursor.y] : null;

  const measureLine = measureResult
    ? [
        measureResult.a.x,
        measureResult.a.y,
        measureResult.b.x,
        measureResult.b.y,
      ]
    : null;

  const measureLabelPos = measureResult
    ? {
        x: (measureResult.a.x + measureResult.b.x) / 2,
        y: (measureResult.a.y + measureResult.b.y) / 2,
      }
    : null;

  const measureFt =
    measureResult && ftPerPx != null
      ? pxToFt(
          Math.hypot(
            measureResult.b.x - measureResult.a.x,
            measureResult.b.y - measureResult.a.y
          ),
          ftPerPx
        )
      : null;

  const lassoRect = lasso
    ? {
        x: Math.min(lasso.start.x, lasso.current.x),
        y: Math.min(lasso.start.y, lasso.current.y),
        w: Math.abs(lasso.current.x - lasso.start.x),
        h: Math.abs(lasso.current.y - lasso.start.y),
      }
    : null;

  // Everything shifts down 2.25rem to make room for the pipeline bar.
  const topOffset = calibrated ? "top-[5.25rem]" : "top-[6.25rem]";
  const legendOffset = calibrated ? "top-[7rem]" : "top-[8.25rem]";

  const powerRouted = routes.some((r) => r.circuit_id);
  const steps: PipelineStep[] = [
    { id: "calibrate", label: "Calibrate", done: calibrated, blocked: null },
    { id: "devices", label: "Devices", done: devices.length > 0, blocked: null },
    {
      id: "circuits",
      label: "Circuits",
      done: circuits.length > 0,
      blocked: devices.some((d) => d.type !== "panel")
        ? null
        : "Stamp devices first",
    },
    {
      id: "routes",
      label: "Routes",
      done: powerRouted,
      blocked: !calibrated
        ? "Calibrate first"
        : circuits.length
          ? null
          : "Create a circuit first",
    },
    {
      id: "takeoff",
      label: "Takeoff",
      done: powerRouted,
      blocked: routes.length ? null : "Route circuits first",
    },
  ];

  function goToStage(s: PipelineStage) {
    const step = steps.find((x) => x.id === s);
    if (step?.blocked && !step.done) return;
    if (s !== "circuits") setArmed(null);
    if (s === "calibrate" && !calibrated) {
      selectTool("calibrate"); // sets stage + opens the dialog
      return;
    }
    setStage(s);
  }

  const takeoffSummary = useMemo(() => {
    const { lines } = buildProjectTakeoff({
      circuits,
      devices,
      routes,
      settings,
      ftPerPxBySheetId: ftPerPx ? { [sheetId]: ftPerPx } : {},
    });
    return summarizeTakeoff(lines, devices);
  }, [circuits, devices, routes, settings, ftPerPx, sheetId]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#E8EAF0]">
      <PipelineBar steps={steps} active={stage} onSelect={goToStage} />

      {!calibrated && (
        <div className="absolute inset-x-0 top-9 z-30 bg-perry-signal px-4 py-2 text-center text-xs font-semibold text-white">
          Not calibrated — footages unavailable. Routing and takeoff are
          blocked until you calibrate. Stamping is still allowed.
        </div>
      )}

      {title && (
        <div
          className={`pointer-events-none absolute left-3 z-10 max-w-[40%] truncate font-display text-sm text-perry-industrial ${
            calibrated ? "top-12" : "top-[4.75rem]"
          }`}
        >
          {title}
        </div>
      )}

      <div
        className={`absolute left-3 z-20 flex max-w-[calc(100%-17rem)] flex-wrap items-center gap-2 rounded-lg border border-perry-silver bg-white px-3 py-2 shadow-sm ${topOffset}`}
      >
        {backHref && (
          <a
            href={backHref}
            className="text-xs font-medium text-perry-blue hover:underline"
          >
            ← Back
          </a>
        )}
        <span className="min-w-[3.5rem] text-xs font-semibold tabular-nums text-perry-industrial">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={fitToScreen}
          className="rounded-md bg-perry-white px-2 py-1 text-xs font-semibold text-perry-industrial hover:bg-perry-silver/30"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={() => rotateBy(-1)}
          title="Rotate left 90°"
          className="rounded-md bg-perry-white px-2 py-1 text-xs font-semibold text-perry-industrial hover:bg-perry-silver/30"
        >
          ⟲
        </button>
        <button
          type="button"
          onClick={() => rotateBy(1)}
          title="Rotate right 90°"
          className="rounded-md bg-perry-white px-2 py-1 text-xs font-semibold text-perry-industrial hover:bg-perry-silver/30"
        >
          ⟳
        </button>
        <span className="text-[10px] tabular-nums text-gray-500">{rotation}°</span>
        <span className="h-4 w-px bg-perry-silver" />
        {(
          [
            ["select", "Select"],
            ["pan", "Pan"],
            ["calibrate", "Calibrate"],
            ["measure", "Measure"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => selectTool(id)}
            className={`rounded-md px-2 py-1 text-xs font-semibold ${
              tool === id
                ? "bg-perry-blue text-white"
                : "bg-perry-white text-perry-industrial hover:bg-perry-silver/30"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="h-4 w-px bg-perry-silver" />
        <button
          type="button"
          onClick={() => setCheatOpen(true)}
          title="Keyboard shortcuts"
          className="rounded-md bg-perry-white px-2 py-1 text-xs font-semibold text-perry-industrial hover:bg-perry-silver/30"
        >
          ?
        </button>
        {calibrated && ftPerPx != null && (
          <>
            <span className="h-4 w-px bg-perry-silver" />
            <span className="text-xs font-semibold text-perry-industrial">
              {formatScaleBadge(ftPerPx, renderDpi)}
            </span>
          </>
        )}
      </div>

      <div className={`absolute left-3 z-20 ${legendOffset}`}>
        <CircuitLegend circuits={circuits} />
      </div>

      {(sheetLoading || !image) && (
        <div className="absolute inset-0 right-72 z-30 flex items-center justify-center bg-[#E8EAF0]/80">
          <p className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-perry-industrial shadow-sm">
            Loading sheet…
          </p>
        </div>
      )}

      {(tool === "calibrate" || tool === "measure" || stamping) && (
        <p className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md bg-perry-industrial/90 px-3 py-1.5 text-xs text-white">
          {stamping &&
            `Stamp ${stampEntry?.label || lastCatalogId} — click to place · Esc / right-click to exit`}
          {tool === "calibrate" &&
            !calibrateDialogOpen &&
            !calibratePending &&
            (p1
              ? "Click the second point on a known dimension"
              : "Click the first point on a known dimension")}
          {tool === "measure" &&
            (!calibrated
              ? "Calibrate first to measure distances"
              : p1
                ? "Click the second point"
                : "Click the first point")}
        </p>
      )}

      <div
        ref={containerRef}
        className="absolute bottom-0 left-0 right-72 top-9"
        style={{ cursor: cursorFor(tool) }}
      >
        <Stage
          ref={stageRef}
          width={Math.max(100, size.w - 0)}
          height={size.h}
          scaleX={scale}
          scaleY={scale}
          x={pos.x}
          y={pos.y}
          draggable={tool === "pan"}
          pixelRatio={1}
          onDragStart={() => {
            markViewMoving();
          }}
          onDragMove={() => {
            markViewMoving();
          }}
          onDragEnd={(e) => {
            setPos({ x: e.target.x(), y: e.target.y() });
            markViewMoving();
          }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          perfectDrawEnabled={false}
        >
          <Layer listening={tool !== "pan"} perfectDrawEnabled={false}>
            <Group
              ref={contentGroupRef}
              x={imageW / 2}
              y={imageH / 2}
              offsetX={imageW / 2}
              offsetY={imageH / 2}
              rotation={rotation}
            >
              {image && (
                <KonvaImage
                  image={image}
                  width={imageW}
                  height={imageH}
                  listening={tool !== "pan"}
                  perfectDrawEnabled={false}
                  imageSmoothingEnabled={scale < 1}
                />
              )}
              <PdfSharpOverlay
                pdfUrl={pdfUrl}
                pdfPage={pdfPage}
                imageW={imageW}
                imageH={imageH}
                scale={scale}
                pos={pos}
                stageW={Math.max(100, size.w)}
                stageH={size.h}
                rotationDeg={rotation}
                viewMoving={viewMoving}
              />
              {/* Circuit halos — every assigned device wears its circuit's
                  color at all times; the armed circuit glows stronger. */}
              {devices.map((d) => {
                if (!d.circuit_id) return null;
                const ckt = circuitById.get(d.circuit_id);
                if (!ckt) return null;
                const isArmed = armed !== null && armed === d.circuit_id;
                return (
                  <Circle
                    key={`halo-${d.id}`}
                    x={d.x}
                    y={d.y}
                    radius={12 / scale}
                    stroke={circuitHue(ckt.number)}
                    strokeWidth={(isArmed ? 4 : 2.5) / scale}
                    opacity={isArmed ? 0.95 : 0.55}
                    listening={false}
                    perfectDrawEnabled={false}
                  />
                );
              })}
              {devices.map((d) => (
                <DeviceShape
                  key={d.id}
                  device={d}
                  selected={selectedIds.includes(d.id)}
                  ftPerPx={ftPerPx}
                  viewScale={scale}
                  listening={tool === "select" && !editRoutes}
                  onSelect={(shift) => {
                    if (tool !== "select") return;
                    if (stage === "circuits" && armedRef.current) {
                      void paintDevice(d);
                      return;
                    }
                    setSelectedIds((prev) => {
                      if (shift) {
                        return prev.includes(d.id)
                          ? prev.filter((id) => id !== d.id)
                          : [...prev, d.id];
                      }
                      return [d.id];
                    });
                  }}
                  onDragStart={() => {
                    const moveIds = selectedIds.includes(d.id)
                      ? selectedIds
                      : [d.id];
                    moveBeforeRef.current = devicesRef.current
                      .filter((dev) => moveIds.includes(dev.id))
                      .map((dev) => ({ id: dev.id, x: dev.x, y: dev.y }));
                    const stage = stageRef.current;
                    if (stage) stage.draggable(false);
                  }}
                  onDragMove={(x, y, dx, dy) => {
                    const moveIds = selectedIds.includes(d.id)
                      ? selectedIds
                      : [d.id];
                    const moves: {
                      id: string;
                      from: GeoPoint;
                      to: GeoPoint;
                    }[] = [];
                    setDevices((prev) =>
                      prev.map((dev) => {
                        if (dev.id === d.id) {
                          moves.push({
                            id: dev.id,
                            from: { x: dev.x, y: dev.y },
                            to: { x, y },
                          });
                          schedulePosPersist(dev.id, x, y);
                          return { ...dev, x, y };
                        }
                        if (moveIds.includes(dev.id)) {
                          const nx = dev.x + dx;
                          const ny = dev.y + dy;
                          moves.push({
                            id: dev.id,
                            from: { x: dev.x, y: dev.y },
                            to: { x: nx, y: ny },
                          });
                          schedulePosPersist(dev.id, nx, ny);
                          return { ...dev, x: nx, y: ny };
                        }
                        return dev;
                      })
                    );
                    if (ftPerPx && moves.length) {
                      let next = routesRef.current;
                      const changedIds = new Set<string>();
                      for (const m of moves) {
                        const glued = glueRoutesToMovedDevice(
                          next,
                          m.from,
                          m.to,
                          ftPerPx
                        );
                        for (let i = 0; i < glued.length; i++) {
                          if (glued[i] !== next[i]) {
                            changedIds.add(glued[i].id);
                          }
                        }
                        next = glued;
                      }
                      if (changedIds.size) {
                        routesRef.current = next;
                        setRoutes(next);
                        changedIds.forEach((id) =>
                          routePersister.current?.queue(id)
                        );
                      }
                    }
                  }}
                  onDragEnd={(x, y) => {
                    const stage = stageRef.current;
                    if (stage) stage.draggable(tool === "pan");
                    schedulePosPersist(d.id, x, y);
                    setDevices((prev) =>
                      prev.map((dev) =>
                        dev.id === d.id ? { ...dev, x, y } : dev
                      )
                    );
                    const before = moveBeforeRef.current;
                    moveBeforeRef.current = null;
                    if (before?.length) {
                      const changed = before.some((b) => {
                        const cur = devicesRef.current.find((x) => x.id === b.id);
                        return !cur || cur.x !== b.x || cur.y !== b.y;
                      });
                      const primary = before.find((b) => b.id === d.id);
                      if (
                        changed ||
                        (primary && (primary.x !== x || primary.y !== y))
                      ) {
                        undoRef.current = { kind: "move", before };
                      }
                    }
                  }}
                />
              ))}
              {ftPerPx && (
                /* Non-listening unless route editing is live — the wide
                   hitStrokeWidth on route lines must never swallow stamp
                   or circuit-paint clicks (Konva falls through to the
                   image when this Group doesn't listen). */
                <Group
                  listening={routeLayerInteractive({ editRoutes, stage })}
                >
                <RouteLayer
                  circuits={circuits}
                  devices={devices}
                  routes={routes}
                  ftPerPx={ftPerPx}
                  selectedRouteId={selectedRouteId}
                  editEnabled={tool === "select" || editRoutes}
                  onSelectRoute={setSelectedRouteId}
                  onPathChange={(routeId, path, planFt, userEdited) => {
                    const next = routesRef.current.map((r) =>
                      r.id === routeId
                        ? {
                            ...r,
                            path: path as GeoPoint[],
                            plan_length_ft: planFt,
                            user_edited: userEdited,
                          }
                        : r
                    );
                    routesRef.current = next;
                    setRoutes(next);
                    routePersister.current?.queue(routeId);
                  }}
                />
                </Group>
              )}
              {liveLine && (
                <Line
                  points={liveLine}
                  stroke="#A01825"
                  strokeWidth={2 / scale}
                  dash={[8 / scale, 6 / scale]}
                  listening={false}
                />
              )}
              {p1 && (
                <Circle
                  x={p1.x}
                  y={p1.y}
                  radius={5 / scale}
                  fill="#A01825"
                  stroke="#fff"
                  strokeWidth={1.5 / scale}
                  listening={false}
                />
              )}
              {measureLine && (
                <Line
                  points={measureLine}
                  stroke="#2C64F2"
                  strokeWidth={2 / scale}
                  listening={false}
                />
              )}
              {measureResult && (
                <>
                  <Circle
                    x={measureResult.a.x}
                    y={measureResult.a.y}
                    radius={4 / scale}
                    fill="#2C64F2"
                    listening={false}
                  />
                  <Circle
                    x={measureResult.b.x}
                    y={measureResult.b.y}
                    radius={4 / scale}
                    fill="#2C64F2"
                    listening={false}
                  />
                </>
              )}
              {measureLabelPos && measureFt != null && (
                <Text
                  x={measureLabelPos.x}
                  y={measureLabelPos.y - 18 / scale}
                  text={`${formatFtIn(measureFt)}  (${measureFt.toFixed(2)} ft)`}
                  fontSize={14 / scale}
                  fontFamily="Poppins, sans-serif"
                  fontStyle="bold"
                  fill="#141E2C"
                  stroke="#fff"
                  strokeWidth={3 / scale}
                  fillAfterStrokeEnabled
                  listening={false}
                />
              )}
              {lassoRect && (
                <Rect
                  x={lassoRect.x}
                  y={lassoRect.y}
                  width={lassoRect.w}
                  height={lassoRect.h}
                  stroke="#2C64F2"
                  strokeWidth={1 / scale}
                  dash={[6 / scale, 4 / scale]}
                  fill="rgba(44,100,242,0.08)"
                  listening={false}
                />
              )}
            </Group>
          </Layer>
        </Stage>
      </div>

      <TakeoffSummaryCard summary={takeoffSummary} />

      <SheetSidePanel
        stage={stage}
        onGoToStage={goToStage}
        calibrated={calibrated}
        renderDpi={renderDpi}
        onStartCalibrate={() => selectTool("calibrate")}
        lastCatalogId={lastCatalogId}
        stamping={stamping}
        onPickStamp={(entry: CatalogEntry) => {
          setLastCatalogId(entry.id);
          selectTool("stamp");
        }}
        armedCircuitId={armed}
        onArmCircuit={(id) => {
          setArmed(id);
          if (id) setStage("circuits");
        }}
        takeoffSummary={takeoffSummary}
        takeoffHref={backHref ? `${backHref}/takeoff` : null}
        selected={selected}
        onChangeLabel={(label) => {
          void persistAttrs(
            selected.map((d) => d.id),
            { label }
          );
        }}
        onChangeWatts={(watts) => {
          const ids = selected
            .filter((d) => d.type === "fixture")
            .map((d) => d.id);
          void persistAttrs(ids, { watts });
        }}
        onChangeDimming={(dimming) => {
          const ids = selected
            .filter((d) => d.type === "fixture")
            .map((d) => d.id);
          void persistAttrs(ids, { dimming });
        }}
        devices={devices}
        circuits={circuits}
        routes={routes}
        settings={settings}
        ftPerPx={ftPerPx}
        editRoutes={editRoutes}
        onToggleEditRoutes={() => {
          if (!editRoutes && routes.length === 0) {
            showError("No routes yet — click Route first.");
            return;
          }
          setEditRoutes((v) => !v);
        }}
        checkDetail={checkDetail}
        onCheckClick={setCheckDetail}
        circuitBusy={circuitBusy}
        onAutoGroup={async (ctype, panelId) => {
          lastPanelIdRef.current = panelId;
          const clusters = autoGroupDevices({
            devices,
            ctype,
            settings,
          });
          if (!clusters.length) {
            showError("No unassigned devices to group.");
            return;
          }
          const supabase = createClient();
          let nextNum =
            circuits.reduce((m, c) => Math.max(m, c.number), 0) + 1;
          const created: Circuit[] = [];
          for (const cluster of clusters) {
            const voltage =
              ctype === "lighting"
                ? settings.lighting_voltage
                : settings.receptacle_voltage;
            try {
              const ckt = await insertCircuitWithRetry(supabase, {
                sheet_id: sheetId,
                panel_device_id: panelId,
                number: nextNum,
                ctype,
                voltage,
                breaker_amps: 20,
              });
              nextNum = ckt.number + 1;
              created.push(ckt);
              const { error: assignErr } = await withWriteTimeout(() =>
                supabase
                  .from("devices")
                  .update({ circuit_id: ckt.id })
                  .in("id", cluster.deviceIds)
              );
              if (assignErr) {
                showError(assignErr.message);
                break;
              }
              setDevices((prev) =>
                prev.map((d) =>
                  cluster.deviceIds.includes(d.id)
                    ? { ...d, circuit_id: ckt.id }
                    : d
                )
              );
            } catch (err) {
              showError(
                err instanceof Error ? err.message : "Auto-group failed"
              );
              break;
            }
          }
          setCircuits((prev) => [...prev, ...created]);
        }}
        onRoute={async (circuitId) => {
          if (!ftPerPx) {
            showError("Calibrate scale before routing.");
            return;
          }
          const circuit = circuits.find((c) => c.id === circuitId);
          if (!circuit) return;
          const panel = devices.find((d) => d.id === circuit.panel_device_id);
          if (!panel) {
            showError("Panel missing for this circuit.");
            return;
          }
          const assigned = devices.filter((d) => d.circuit_id === circuitId);
          if (!assigned.length) {
            showError(
              `Circuit ${circuitDisplayLabel(circuit, devices)} has no devices — lasso-select devices and Assign first.`
            );
            return;
          }
          const onCkt = devicesForCircuitRouting(
            devices,
            circuitId,
            circuit.entry_device_id
          );
          const proposed = routeCircuit({
            panel,
            devicesOnCircuit: onCkt,
            ctype: circuit.ctype,
            ftPerPx,
            entryDeviceId: circuit.entry_device_id,
          });
          const supabase = createClient();
          // Keep user_edited routes
          const { error: delErr } = await withWriteTimeout(() =>
            supabase
              .from("routes")
              .delete()
              .eq("circuit_id", circuitId)
              .eq("user_edited", false)
          );
          if (delErr) {
            showError(delErr.message);
            return;
          }
          const kept = routes.filter(
            (r) => r.circuit_id === circuitId && r.user_edited
          );
          const others = routes.filter((r) => r.circuit_id !== circuitId);
          if (proposed.length) {
            const { data, error } = await withWriteTimeout(() =>
              supabase
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
                .select("*")
            );
            if (error) {
              showError(error.message);
              return;
            }
            setRoutes([...others, ...kept, ...((data as Route[]) || [])]);
          } else {
            setRoutes([...others, ...kept]);
          }
        }}
        onRouteAll={async () => {
          if (!ftPerPx) {
            showError("Calibrate scale before routing.");
            return;
          }
          const empty = circuits.filter(
            (c) => !devices.some((d) => d.circuit_id === c.id)
          );
          if (empty.length) {
            showError(
              `Circuit ${circuitDisplayLabel(empty[0], devices)} has no devices — lasso-select devices and Assign first.`
            );
          }
          const supabase = createClient();
          const kept = routes.filter((r) => r.user_edited || !!r.lv_system);
          const cktIds = circuits.map((c) => c.id);
          if (cktIds.length) {
            const { error: delErr } = await withWriteTimeout(() =>
              supabase
                .from("routes")
                .delete()
                .in("circuit_id", cktIds)
                .eq("user_edited", false)
            );
            if (delErr) {
              showError(delErr.message);
              return;
            }
          }
          const inserted: Route[] = [];
          for (const c of circuits) {
            const panel = devices.find((d) => d.id === c.panel_device_id);
            if (!panel) continue;
            const onCkt = devicesForCircuitRouting(
              devices,
              c.id,
              c.entry_device_id
            );
            if (!onCkt.length) continue;
            const proposed = routeCircuit({
              panel,
              devicesOnCircuit: onCkt,
              ctype: c.ctype,
              ftPerPx,
              entryDeviceId: c.entry_device_id,
            });
            if (!proposed.length) continue;
            const { data, error } = await withWriteTimeout(() =>
              supabase
                .from("routes")
                .insert(
                  proposed.map((p) => ({
                    circuit_id: c.id,
                    kind: p.kind,
                    path: p.path,
                    plan_length_ft: p.plan_length_ft,
                    user_edited: false,
                  }))
                )
                .select("*")
            );
            if (error) {
              showError(error.message);
              break;
            }
            inserted.push(...((data as Route[]) || []));
          }
          setRoutes([...kept, ...inserted]);
        }}
        onRouteFire={async () => {
          if (!ftPerPx) {
            showError("Calibrate scale before routing.");
            return;
          }
          const ready = fireRouteReady(devices);
          if (!ready.ok) {
            showError(ready.missing);
            return;
          }
          const facp = findFacp(devices)!;
          const fireDevs = findFireDevices(devices);
          const proposed = routeFireSystem({
            facp,
            fireDevices: fireDevs,
            ftPerPx,
          });
          const supabase = createClient();
          const { error: delErr } = await withWriteTimeout(() =>
            supabase
              .from("routes")
              .delete()
              .eq("sheet_id", sheetId)
              .eq("lv_system", "fire")
              .eq("user_edited", false)
          );
          if (delErr) {
            showError(delErr.message);
            return;
          }
          const keep = routes.filter(
            (r) => r.lv_system !== "fire" || r.user_edited
          );
          if (!proposed.length) {
            setRoutes(keep);
            return;
          }
          const { data, error } = await withWriteTimeout(() =>
            supabase
              .from("routes")
              .insert(
                proposed.map((p) => ({
                  circuit_id: null,
                  sheet_id: sheetId,
                  lv_system: "fire",
                  kind: p.kind,
                  path: p.path,
                  plan_length_ft: p.plan_length_ft,
                  user_edited: false,
                }))
              )
              .select("*")
          );
          if (error) {
            showError(error.message);
            return;
          }
          setRoutes([...keep, ...((data as Route[]) || [])]);
        }}
        onRouteData={async () => {
          if (!ftPerPx) {
            showError("Calibrate scale before routing.");
            return;
          }
          const ready = dataRouteReady(devices);
          if (!ready.ok) {
            showError(ready.missing);
            return;
          }
          const idfs = findIdfRooms(devices);
          const drops = findDataDrops(devices);
          const proposed = routeDataSystem({ idfs, drops, ftPerPx });
          const supabase = createClient();
          const { error: delErr } = await withWriteTimeout(() =>
            supabase
              .from("routes")
              .delete()
              .eq("sheet_id", sheetId)
              .eq("lv_system", "data")
              .eq("user_edited", false)
          );
          if (delErr) {
            showError(delErr.message);
            return;
          }
          const keep = routes.filter(
            (r) => r.lv_system !== "data" || r.user_edited
          );
          if (!proposed.length) {
            setRoutes(keep);
            return;
          }
          const { data, error } = await withWriteTimeout(() =>
            supabase
              .from("routes")
              .insert(
                proposed.map((p) => ({
                  circuit_id: null,
                  sheet_id: sheetId,
                  lv_system: "data",
                  kind: p.kind,
                  path: p.path,
                  plan_length_ft: p.plan_length_ft,
                  user_edited: false,
                }))
              )
              .select("*")
          );
          if (error) {
            showError(error.message);
            return;
          }
          setRoutes([...keep, ...((data as Route[]) || [])]);
        }}
        onSetHrEntry={async (circuitId, entryDeviceId) => {
          const prevEntry =
            circuits.find((c) => c.id === circuitId)?.entry_device_id ?? null;
          setCircuits((prev) =>
            prev.map((c) =>
              c.id === circuitId
                ? { ...c, entry_device_id: entryDeviceId }
                : c
            )
          );
          const supabase = createClient();
          const { error } = await withWriteTimeout(() =>
            supabase
              .from("circuits")
              .update({ entry_device_id: entryDeviceId })
              .eq("id", circuitId)
          );
          if (error) {
            showError(error.message);
            setCircuits((prev) =>
              prev.map((c) =>
                c.id === circuitId
                  ? { ...c, entry_device_id: prevEntry }
                  : c
              )
            );
          }
        }}
        onResetRoutes={async (circuitId) => {
          const supabase = createClient();
          const { error: delErr } = await withWriteTimeout(() =>
            supabase.from("routes").delete().eq("circuit_id", circuitId)
          );
          if (delErr) {
            showError(delErr.message);
            return;
          }
          setRoutes((prev) => prev.filter((r) => r.circuit_id !== circuitId));
          // re-route fresh
          if (!ftPerPx) return;
          const circuit = circuits.find((c) => c.id === circuitId);
          const panel = devices.find((d) => d.id === circuit?.panel_device_id);
          if (!circuit || !panel) return;
          const onCkt = devicesForCircuitRouting(
            devices,
            circuitId,
            circuit.entry_device_id
          );
          const proposed = routeCircuit({
            panel,
            devicesOnCircuit: onCkt,
            ctype: circuit.ctype,
            ftPerPx,
            entryDeviceId: circuit.entry_device_id,
          });
          if (!proposed.length) return;
          const { data, error } = await withWriteTimeout(() =>
            supabase
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
              .select("*")
          );
          if (error) {
            showError(error.message);
            return;
          }
          setRoutes((prev) => [
            ...prev.filter((r) => r.circuit_id !== circuitId),
            ...((data as Route[]) || []),
          ]);
        }}
      />

      {cheatOpen && <ShortcutCheatSheet onClose={() => setCheatOpen(false)} />}

      {calibrateDialogOpen && (
        <CalibrateDialog
          pixelDistance={calibratePending?.px ?? null}
          renderDpi={renderDpi}
          currentFtPerPx={ftPerPx}
          onCancel={() => {
            if (saving) return;
            setCalibratePending(null);
            setCalibrateDialogOpen(false);
            selectTool("select");
          }}
          onPickPoints={() => {
            setCalibratePending(null);
            setCalibrateDialogOpen(false);
            setTool("calibrate");
            setP1(null);
            setCursor(null);
          }}
          onConfirmTwoPoint={(feet) => {
            if (saving) return;
            void saveCalibration(feet);
          }}
          onConfirmPreset={(next) => {
            if (saving) return;
            void savePresetScale(next);
          }}
        />
      )}
    </div>
  );
}
