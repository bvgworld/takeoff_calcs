"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer,
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
import { SheetSidePanel } from "./SheetSidePanel";
import { RouteLayer } from "./RouteLayer";
import { createClient } from "@/lib/supabase/client";
import {
  formatFtIn,
  formatScaleBadge,
  isCalibrated,
  pxToFt,
} from "@/lib/scale";
import { countByType, defaultAttrs } from "@/lib/devices";
import { routeCircuit } from "@/lib/routing";
import { autoGroupDevices } from "@/lib/auto-group";
import type {
  Circuit,
  CodeCheck,
  Device,
  DeviceType,
  Point as GeoPoint,
  ProjectSettings,
  Route,
} from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const DRAG_DEBOUNCE_MS = 120;

type Tool =
  | "select"
  | "pan"
  | "calibrate"
  | "measure"
  | "stamp-panel"
  | "stamp-fixture"
  | "stamp-receptacle"
  | "stamp-switch";

type Point = { x: number; y: number };

type Props = {
  sheetId: string;
  imageUrl: string;
  imageW: number;
  imageH: number;
  initialFtPerPx: number | null;
  settings?: ProjectSettings;
  title?: string;
  backHref?: string;
};

export function SheetViewer({
  sheetId,
  imageUrl,
  imageW,
  imageH,
  initialFtPerPx,
  settings: settingsProp,
  title,
  backHref,
}: Props) {
  const settings = settingsProp || DEFAULT_SETTINGS;
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
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

  const [tool, setTool] = useState<Tool>("select");
  const [ftPerPx, setFtPerPx] = useState<number | null>(initialFtPerPx);
  const [p1, setP1] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [measureResult, setMeasureResult] = useState<{
    a: Point;
    b: Point;
    ft: number;
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
  const [checkDetail, setCheckDetail] = useState<CodeCheck | null>(null);
  const [lasso, setLasso] = useState<{
    start: Point;
    current: Point;
  } | null>(null);
  const lassoRef = useRef<{ start: Point; active: boolean } | null>(null);
  const routePersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const calibrated = isCalibrated(ftPerPx);
  const pointing = tool === "calibrate" || tool === "measure";
  const stamping = tool.startsWith("stamp-");
  const stampType = stamping
    ? (tool.replace("stamp-", "") as DeviceType)
    : null;

  devicesRef.current = devices;

  const counts = useMemo(() => countByType(devices), [devices]);
  const selected = useMemo(
    () => devices.filter((d) => selectedIds.includes(d.id)),
    [devices, selectedIds]
  );

  // Load devices, circuits, routes
  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const [{ data: devs }, { data: ckts }] = await Promise.all([
        supabase.from("devices").select("*").eq("sheet_id", sheetId),
        supabase.from("circuits").select("*").eq("sheet_id", sheetId),
      ]);
      setDevices((devs as Device[]) || []);
      const circuitRows = (ckts as Circuit[]) || [];
      setCircuits(circuitRows);
      const ids = circuitRows.map((c) => c.id);
      if (ids.length) {
        const { data: rts } = await supabase
          .from("routes")
          .select("*")
          .in("circuit_id", ids);
        setRoutes((rts as Route[]) || []);
      } else {
        setRoutes([]);
      }
    })();
  }, [sheetId]);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stamping) {
        selectTool("select");
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        tool === "select" &&
        selectedIds.length > 0 &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        void deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamping, tool, selectedIds]);

  const fitToScreen = useCallback(() => {
    if (!size.w || !size.h || !imageW || !imageH) return;
    const pad = 24;
    const s = Math.min(
      (size.w - pad) / imageW,
      (size.h - pad) / imageH,
      MAX_SCALE
    );
    const clamped = Math.max(MIN_SCALE, s);
    setScale(clamped);
    setPos({
      x: (size.w - imageW * clamped) / 2,
      y: (size.h - imageH * clamped) / 2,
    });
  }, [size.w, size.h, imageW, imageH]);

  useEffect(() => {
    if (image && size.w > 0) fitToScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, imageW, imageH, size.w, size.h]);

  function toImagePoint(stagePointer: Point): Point {
    return {
      x: (stagePointer.x - pos.x) / scale,
      y: (stagePointer.y - pos.y) / scale,
    };
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
    if (!t.startsWith("stamp-") && t !== "select") setSelectedIds([]);
    const stage = stageRef.current;
    if (stage) {
      stage.draggable(t === "pan");
      stage.container().style.cursor = cursorFor(t);
    }
  }

  function schedulePosPersist(id: string, x: number, y: number) {
    const prev = dragTimers.current.get(id);
    if (prev) clearTimeout(prev);
    dragTimers.current.set(
      id,
      setTimeout(() => {
        dragTimers.current.delete(id);
        const supabase = createClient();
        void supabase.from("devices").update({ x, y }).eq("id", id);
      }, DRAG_DEBOUNCE_MS)
    );
  }

  async function stampAt(pt: Point) {
    if (!stampType) return;
    const id = crypto.randomUUID();
    const attrs = defaultAttrs(stampType, devicesRef.current);
    const optimistic: Device = {
      id,
      sheet_id: sheetId,
      type: stampType,
      x: pt.x,
      y: pt.y,
      attrs,
      circuit_id: null,
      created_at: new Date().toISOString(),
    };
    setDevices((prev) => [...prev, optimistic]);
    setSelectedIds([id]);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("devices")
      .insert({
        id,
        sheet_id: sheetId,
        type: stampType,
        x: pt.x,
        y: pt.y,
        attrs,
      })
      .select("*")
      .single();
    if (error) {
      setDevices((prev) => prev.filter((d) => d.id !== id));
      alert(error.message);
      return;
    }
    setDevices((prev) =>
      prev.map((d) => (d.id === id ? (data as Device) : d))
    );
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setDevices((prev) => prev.filter((d) => !ids.includes(d.id)));
    setSelectedIds([]);
    const supabase = createClient();
    const { error } = await supabase.from("devices").delete().in("id", ids);
    if (error) {
      alert(error.message);
      // reload
      const { data } = await supabase
        .from("devices")
        .select("*")
        .eq("sheet_id", sheetId);
      setDevices((data as Device[]) || []);
    }
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
    await Promise.all(
      ids.map(async (id) => {
        const d = devicesRef.current.find((x) => x.id === id);
        const attrs = { ...(d?.attrs || {}), ...patch };
        const { error } = await supabase
          .from("devices")
          .update({ attrs })
          .eq("id", id);
        if (error) console.error(error);
      })
    );
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
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const pt = toImagePoint(pointer);

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
      const px = Math.hypot(pt.x - p1.x, pt.y - p1.y);
      if (tool === "calibrate") {
        setCalibratePending({ a: p1, b: pt, px });
        setP1(null);
        setCursor(null);
        return;
      }
      if (!calibrated || ftPerPx == null) {
        setP1(null);
        setCursor(null);
        return;
      }
      setMeasureResult({ a: p1, b: pt, ft: pxToFt(px, ftPerPx) });
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
      setPos((p) => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }

    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const pt = toImagePoint(pointer);

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
        setSelectedIds((prev) => Array.from(new Set([...prev, ...hit])));
      }
      lassoRef.current = null;
      setLasso(null);
    }
  }

  async function saveCalibration(feet: number) {
    if (!calibratePending || calibratePending.px < 1) return;
    const next = feet / calibratePending.px;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("sheets")
      .update({ ft_per_px: next })
      .eq("id", sheetId);
    setSaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    setFtPerPx(next);
    setCalibratePending(null);
    selectTool("select");
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

  const lassoRect = lasso
    ? {
        x: Math.min(lasso.start.x, lasso.current.x),
        y: Math.min(lasso.start.y, lasso.current.y),
        w: Math.abs(lasso.current.x - lasso.start.x),
        h: Math.abs(lasso.current.y - lasso.start.y),
      }
    : null;

  const topOffset = calibrated ? "top-12" : "top-16";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#E8EAF0]">
      {!calibrated && (
        <div className="absolute inset-x-0 top-0 z-30 bg-perry-signal px-4 py-2 text-center text-xs font-semibold text-white">
          Not calibrated — footages unavailable. Routing and takeoff are
          blocked until you calibrate. Stamping is still allowed.
        </div>
      )}

      {title && (
        <div
          className={`pointer-events-none absolute left-3 z-10 max-w-[40%] truncate font-display text-sm text-perry-industrial ${
            calibrated ? "top-3" : "top-10"
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
        {(
          [
            ["stamp-panel", "Panel"],
            ["stamp-fixture", "Fixture"],
            ["stamp-receptacle", "Receptacle"],
            ["stamp-switch", "Switch"],
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
        <span className="text-xs font-semibold tabular-nums text-perry-industrial">
          F: {counts.fixture} · R: {counts.receptacle} · S: {counts.switch} · P:{" "}
          {counts.panel}
        </span>
        {calibrated && ftPerPx != null && (
          <>
            <span className="h-4 w-px bg-perry-silver" />
            <span className="text-xs font-semibold text-perry-industrial">
              {formatScaleBadge(ftPerPx)}
            </span>
          </>
        )}
      </div>

      {(tool === "calibrate" || tool === "measure" || stamping) && (
        <p className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md bg-perry-industrial/90 px-3 py-1.5 text-xs text-white">
          {stamping &&
            `Stamp ${stampType} — click to place · Esc / right-click to exit`}
          {tool === "calibrate" &&
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
        className="absolute inset-0 right-72"
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
          onDragEnd={(e) => {
            setPos({ x: e.target.x(), y: e.target.y() });
          }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          perfectDrawEnabled={false}
        >
          {/* Layer 1 — plan */}
          <Layer listening={tool !== "pan"} perfectDrawEnabled={false}>
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
          </Layer>

          {/* Layer 2 — devices */}
          <Layer perfectDrawEnabled={false}>
            {devices.map((d) => (
              <DeviceShape
                key={d.id}
                device={d}
                selected={selectedIds.includes(d.id)}
                ftPerPx={ftPerPx}
                listening={tool === "select" && !editRoutes}
                onSelect={(shift) => {
                  if (tool !== "select") return;
                  setSelectedIds((prev) => {
                    if (shift) {
                      return prev.includes(d.id)
                        ? prev.filter((id) => id !== d.id)
                        : [...prev, d.id];
                    }
                    return [d.id];
                  });
                }}
                onDragMove={(x, y, dx, dy) => {
                  const moveIds = selectedIds.includes(d.id)
                    ? selectedIds
                    : [d.id];
                  setDevices((prev) =>
                    prev.map((dev) => {
                      if (dev.id === d.id) {
                        schedulePosPersist(dev.id, x, y);
                        return { ...dev, x, y };
                      }
                      if (moveIds.includes(dev.id)) {
                        const nx = dev.x + dx;
                        const ny = dev.y + dy;
                        schedulePosPersist(dev.id, nx, ny);
                        return { ...dev, x: nx, y: ny };
                      }
                      return dev;
                    })
                  );
                }}
                onDragEnd={(x, y) => {
                  schedulePosPersist(d.id, x, y);
                  setDevices((prev) =>
                    prev.map((dev) =>
                      dev.id === d.id ? { ...dev, x, y } : dev
                    )
                  );
                }}
              />
            ))}
          </Layer>

          {/* Layer 3 — routes */}
          <Layer perfectDrawEnabled={false}>
            {ftPerPx && (
              <RouteLayer
                circuits={circuits}
                routes={routes}
                ftPerPx={ftPerPx}
                selectedRouteId={selectedRouteId}
                editMode={editRoutes}
                onSelectRoute={setSelectedRouteId}
                onPathChange={(routeId, path, planFt, userEdited) => {
                  setRoutes((prev) =>
                    prev.map((r) =>
                      r.id === routeId
                        ? {
                            ...r,
                            path: path as GeoPoint[],
                            plan_length_ft: planFt,
                            user_edited: userEdited,
                          }
                        : r
                    )
                  );
                  if (routePersistTimer.current) {
                    clearTimeout(routePersistTimer.current);
                  }
                  routePersistTimer.current = setTimeout(() => {
                    const supabase = createClient();
                    void supabase
                      .from("routes")
                      .update({
                        path,
                        plan_length_ft: planFt,
                        user_edited: userEdited,
                      })
                      .eq("id", routeId);
                  }, 150);
                }}
              />
            )}
          </Layer>

          {/* Overlay — measure / calibrate / lasso */}
          <Layer listening={false}>
            {liveLine && (
              <Line
                points={liveLine}
                stroke="#A01825"
                strokeWidth={2 / scale}
                dash={[8 / scale, 6 / scale]}
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
              />
            )}
            {measureLine && (
              <Line
                points={measureLine}
                stroke="#2C64F2"
                strokeWidth={2 / scale}
              />
            )}
            {measureResult && (
              <>
                <Circle
                  x={measureResult.a.x}
                  y={measureResult.a.y}
                  radius={4 / scale}
                  fill="#2C64F2"
                />
                <Circle
                  x={measureResult.b.x}
                  y={measureResult.b.y}
                  radius={4 / scale}
                  fill="#2C64F2"
                />
              </>
            )}
            {measureLabelPos && measureResult && (
              <Text
                x={measureLabelPos.x}
                y={measureLabelPos.y - 18 / scale}
                text={`${formatFtIn(measureResult.ft)}  (${measureResult.ft.toFixed(2)} ft)`}
                fontSize={14 / scale}
                fontFamily="Poppins, sans-serif"
                fontStyle="bold"
                fill="#141E2C"
                stroke="#fff"
                strokeWidth={3 / scale}
                fillAfterStrokeEnabled
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
              />
            )}
          </Layer>
        </Stage>
      </div>

      <SheetSidePanel
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
        devices={devices}
        circuits={circuits}
        routes={routes}
        settings={settings}
        ftPerPx={ftPerPx}
        editRoutes={editRoutes}
        onToggleEditRoutes={() => setEditRoutes((v) => !v)}
        checkDetail={checkDetail}
        onCheckClick={setCheckDetail}
        onNewCircuit={async ({ panelId, ctype, voltage }) => {
          const supabase = createClient();
          const nextNum =
            circuits.reduce((m, c) => Math.max(m, c.number), 0) + 1;
          const { data, error } = await supabase
            .from("circuits")
            .insert({
              sheet_id: sheetId,
              panel_device_id: panelId,
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
          setCircuits((prev) => [...prev, data as Circuit]);
        }}
        onAssignSelected={async (circuitId) => {
          const ids = selectedIds.filter((id) => {
            const d = devices.find((x) => x.id === id);
            return d && d.type !== "panel";
          });
          if (!ids.length) return;
          setDevices((prev) =>
            prev.map((d) =>
              ids.includes(d.id) ? { ...d, circuit_id: circuitId } : d
            )
          );
          const supabase = createClient();
          const { error } = await supabase
            .from("devices")
            .update({ circuit_id: circuitId })
            .in("id", ids);
          if (error) alert(error.message);
        }}
        onAutoGroup={async (ctype, panelId) => {
          const clusters = autoGroupDevices({
            devices,
            ctype,
            settings,
          });
          if (!clusters.length) {
            alert("No unassigned devices to group.");
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
            const { data, error } = await supabase
              .from("circuits")
              .insert({
                sheet_id: sheetId,
                panel_device_id: panelId,
                number: nextNum++,
                ctype,
                voltage,
                breaker_amps: 20,
              })
              .select("*")
              .single();
            if (error) {
              alert(error.message);
              break;
            }
            const ckt = data as Circuit;
            created.push(ckt);
            await supabase
              .from("devices")
              .update({ circuit_id: ckt.id })
              .in("id", cluster.deviceIds);
            setDevices((prev) =>
              prev.map((d) =>
                cluster.deviceIds.includes(d.id)
                  ? { ...d, circuit_id: ckt.id }
                  : d
              )
            );
          }
          setCircuits((prev) => [...prev, ...created]);
        }}
        onRoute={async (circuitId) => {
          if (!ftPerPx) {
            alert("Calibrate first.");
            return;
          }
          const circuit = circuits.find((c) => c.id === circuitId);
          if (!circuit) return;
          const panel = devices.find((d) => d.id === circuit.panel_device_id);
          if (!panel) {
            alert("Panel missing.");
            return;
          }
          const onCkt = devices.filter((d) => d.circuit_id === circuitId);
          const proposed = routeCircuit({
            panel,
            devicesOnCircuit: onCkt,
            ctype: circuit.ctype,
            ftPerPx,
          });
          const supabase = createClient();
          // Keep user_edited routes
          await supabase
            .from("routes")
            .delete()
            .eq("circuit_id", circuitId)
            .eq("user_edited", false);
          const kept = routes.filter(
            (r) => r.circuit_id === circuitId && r.user_edited
          );
          const others = routes.filter((r) => r.circuit_id !== circuitId);
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
              return;
            }
            setRoutes([...others, ...kept, ...((data as Route[]) || [])]);
          } else {
            setRoutes([...others, ...kept]);
          }
        }}
        onRouteAll={async () => {
          if (!ftPerPx) {
            alert("Calibrate first.");
            return;
          }
          const supabase = createClient();
          const kept = routes.filter((r) => r.user_edited);
          const cktIds = circuits.map((c) => c.id);
          if (cktIds.length) {
            await supabase
              .from("routes")
              .delete()
              .in("circuit_id", cktIds)
              .eq("user_edited", false);
          }
          const inserted: Route[] = [];
          for (const c of circuits) {
            const panel = devices.find((d) => d.id === c.panel_device_id);
            if (!panel) continue;
            const onCkt = devices.filter((d) => d.circuit_id === c.id);
            const proposed = routeCircuit({
              panel,
              devicesOnCircuit: onCkt,
              ctype: c.ctype,
              ftPerPx,
            });
            if (!proposed.length) continue;
            const { data, error } = await supabase
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
              .select("*");
            if (error) {
              alert(error.message);
              break;
            }
            inserted.push(...((data as Route[]) || []));
          }
          setRoutes([...kept, ...inserted]);
        }}
        onResetRoutes={async (circuitId) => {
          const supabase = createClient();
          await supabase.from("routes").delete().eq("circuit_id", circuitId);
          setRoutes((prev) => prev.filter((r) => r.circuit_id !== circuitId));
          // re-route fresh
          if (!ftPerPx) return;
          const circuit = circuits.find((c) => c.id === circuitId);
          const panel = devices.find((d) => d.id === circuit?.panel_device_id);
          if (!circuit || !panel) return;
          const onCkt = devices.filter((d) => d.circuit_id === circuitId);
          const proposed = routeCircuit({
            panel,
            devicesOnCircuit: onCkt,
            ctype: circuit.ctype,
            ftPerPx,
          });
          if (!proposed.length) return;
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
            return;
          }
          setRoutes((prev) => [
            ...prev.filter((r) => r.circuit_id !== circuitId),
            ...((data as Route[]) || []),
          ]);
        }}
      />

      {calibratePending && (
        <CalibrateDialog
          pixelDistance={calibratePending.px}
          onCancel={() => {
            if (saving) return;
            setCalibratePending(null);
            selectTool("calibrate");
          }}
          onConfirm={(feet) => {
            if (saving) return;
            void saveCalibration(feet);
          }}
        />
      )}
    </div>
  );
}
