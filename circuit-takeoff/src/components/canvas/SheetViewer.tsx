"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text } from "react-konva";
import type Konva from "konva";
import useImage from "./use-image";
import { CalibrateDialog } from "./CalibrateDialog";
import { createClient } from "@/lib/supabase/client";
import {
  formatFtIn,
  formatScaleBadge,
  isCalibrated,
  pxToFt,
} from "@/lib/scale";

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

type Tool = "pan" | "calibrate" | "measure";
type Point = { x: number; y: number };

type Props = {
  sheetId: string;
  imageUrl: string;
  imageW: number;
  imageH: number;
  initialFtPerPx: number | null;
  title?: string;
  backHref?: string;
};

export function SheetViewer({
  sheetId,
  imageUrl,
  imageW,
  imageH,
  initialFtPerPx,
  title,
  backHref,
}: Props) {
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

  const [tool, setTool] = useState<Tool>("pan");
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

  const calibrated = isCalibrated(ftPerPx);
  const pointing = tool === "calibrate" || tool === "measure";

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
    el.addEventListener("mousedown", block);
    el.addEventListener("auxclick", block);
    return () => {
      el.removeEventListener("mousedown", block);
      el.removeEventListener("auxclick", block);
    };
  }, []);

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

    if (e.evt.button !== 0 || !pointing) return;
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const pt = toImagePoint(pointer);

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

    // measure
    if (!calibrated || ftPerPx == null) {
      setP1(null);
      setCursor(null);
      return;
    }
    const ft = pxToFt(px, ftPerPx);
    setMeasureResult({ a: p1, b: pt, ft });
    setP1(null);
    setCursor(null);
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

    if (!pointing || !p1) return;
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    setCursor(toImagePoint(pointer));
  }

  function onMouseUp() {
    if (!midPan.current.active) return;
    midPan.current.active = false;
    const stage = stageRef.current;
    if (stage) {
      stage.draggable(tool === "pan");
      stage.container().style.cursor =
        tool === "pan" ? "grab" : pointing ? "crosshair" : "default";
    }
  }

  function selectTool(t: Tool) {
    setTool(t);
    setP1(null);
    setCursor(null);
    if (t !== "measure") setMeasureResult(null);
    const stage = stageRef.current;
    if (stage) {
      stage.draggable(t === "pan");
      stage.container().style.cursor =
        t === "pan" ? "grab" : "crosshair";
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
    selectTool("pan");
  }

  const liveLine =
    p1 && cursor
      ? [p1.x, p1.y, cursor.x, cursor.y]
      : null;

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
          className={`pointer-events-none absolute left-3 z-10 max-w-[55%] truncate font-display text-sm text-perry-industrial ${
            calibrated ? "top-3" : "top-10"
          }`}
        >
          {title}
        </div>
      )}

      <div
        className={`absolute left-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-lg border border-perry-silver bg-white px-3 py-2 shadow-sm ${
          calibrated ? "top-12" : "top-16"
        }`}
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
        {calibrated && ftPerPx != null && (
          <>
            <span className="h-4 w-px bg-perry-silver" />
            <span className="text-xs font-semibold text-perry-industrial">
              {formatScaleBadge(ftPerPx)}
            </span>
          </>
        )}
      </div>

      {tool === "calibrate" && !calibratePending && (
        <p className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md bg-perry-industrial/90 px-3 py-1.5 text-xs text-white">
          {p1
            ? "Click the second point on a known dimension"
            : "Click the first point on a known dimension"}
        </p>
      )}
      {tool === "measure" && (
        <p className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md bg-perry-industrial/90 px-3 py-1.5 text-xs text-white">
          {!calibrated
            ? "Calibrate first to measure distances"
            : p1
              ? "Click the second point"
              : "Click the first point"}
        </p>
      )}

      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ cursor: tool === "pan" ? "grab" : "crosshair" }}
      >
        <Stage
          ref={stageRef}
          width={size.w}
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
          <Layer listening={false} perfectDrawEnabled={false}>
            {image && (
              <KonvaImage
                image={image}
                width={imageW}
                height={imageH}
                listening={false}
                perfectDrawEnabled={false}
                imageSmoothingEnabled={scale < 1}
              />
            )}
          </Layer>
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
          </Layer>
        </Stage>
      </div>

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
