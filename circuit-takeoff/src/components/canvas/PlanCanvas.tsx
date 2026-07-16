"use client";

import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle, Group, Text, Rect } from "react-konva";
import useImage from "./use-image";
import { useSheetStore } from "@/store/sheet-store";
import type { Device, Point, Route } from "@/lib/types";
import { DEVICE_COLORS, DEVICE_LABELS } from "./device-shapes";
import { pathLengthFt } from "@/lib/geometry";

type Props = {
  imageUrl: string;
  imageW: number;
  imageH: number;
  ftPerPx: number | null;
  onStamp: (x: number, y: number) => void;
  onCalibrateComplete: (ftPerPx: number) => void;
  onRoutePathChange: (routeId: string, path: Point[], planFt: number) => void;
};

export function PlanCanvas({
  imageUrl,
  imageW,
  imageH,
  ftPerPx,
  onStamp,
  onCalibrateComplete,
  onRoutePathChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const image = useImage(imageUrl);

  const tool = useSheetStore((s) => s.tool);
  const stageScale = useSheetStore((s) => s.stageScale);
  const stagePos = useSheetStore((s) => s.stagePos);
  const setStageView = useSheetStore((s) => s.setStageView);
  const calibrate = useSheetStore((s) => s.calibrate);
  const setCalibrate = useSheetStore((s) => s.setCalibrate);
  const devices = useSheetStore((s) => s.devices);
  const routes = useSheetStore((s) => s.routes);
  const selectedCircuitId = useSheetStore((s) => s.selectedCircuitId);
  const selectedRouteId = useSheetStore((s) => s.selectedRouteId);
  const setSelectedRouteId = useSheetStore((s) => s.setSelectedRouteId);
  const selectedDeviceId = useSheetStore((s) => s.selectedDeviceId);
  const setSelectedDeviceId = useSheetStore((s) => s.setSelectedDeviceId);

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

  function toImagePoint(stageX: number, stageY: number): Point {
    return {
      x: (stageX - stagePos.x) / stageScale,
      y: (stageY - stagePos.y) / stageScale,
    };
  }

  function onWheel(e: {
    evt: WheelEvent;
    target: { getStage: () => { x: () => number; y: () => number } | null };
  }) {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    const oldScale = stageScale;
    const pointer = {
      x: e.evt.offsetX,
      y: e.evt.offsetY,
    };
    const scaleBy = 1.08;
    const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    const clamped = Math.min(8, Math.max(0.15, newScale));
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };
    setStageView(clamped, {
      x: pointer.x - mousePointTo.x * clamped,
      y: pointer.y - mousePointTo.y * clamped,
    });
  }

  function handleStageClick(e: {
    target: { getStage: () => unknown };
    evt: MouseEvent;
  }) {
    const stage = e.target.getStage() as {
      getPointerPosition: () => Point | null;
    } | null;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const pt = toImagePoint(pointer.x, pointer.y);

    if (tool === "calibrate") {
      if (!calibrate.p1) {
        setCalibrate({ p1: pt });
        return;
      }
      const dx = pt.x - calibrate.p1.x;
      const dy = pt.y - calibrate.p1.y;
      const px = Math.hypot(dx, dy);
      if (px < 1) return;
      const feet = calibrate.knownFeet || 10;
      onCalibrateComplete(feet / px);
      setCalibrate({ p1: null, active: false });
      useSheetStore.getState().setTool("pan");
      return;
    }

    if (tool.startsWith("stamp-")) {
      onStamp(pt.x, pt.y);
    }
  }

  const visibleRoutes = selectedCircuitId
    ? routes.filter((r) => r.circuit_id === selectedCircuitId)
    : routes;

  return (
    <div ref={containerRef} className="h-full w-full bg-[#E8EAF0]">
      <Stage
        width={size.w}
        height={size.h}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        draggable={tool === "pan"}
        onDragEnd={(e) => {
          setStageView(stageScale, { x: e.target.x(), y: e.target.y() });
        }}
        onWheel={onWheel as never}
        onClick={handleStageClick as never}
      >
        <Layer>
          {image && (
            <KonvaImage image={image} width={imageW} height={imageH} />
          )}
        </Layer>
        <Layer>
          {visibleRoutes.map((r) => (
            <RouteLine
              key={r.id}
              route={r}
              selected={r.id === selectedRouteId}
              editable={tool === "edit-route" && r.id === selectedRouteId}
              ftPerPx={ftPerPx}
              onSelect={() => setSelectedRouteId(r.id)}
              onPathChange={onRoutePathChange}
            />
          ))}
        </Layer>
        <Layer>
          {devices.map((d) => (
            <DeviceMark
              key={d.id}
              device={d}
              selected={d.id === selectedDeviceId}
              onSelect={() => setSelectedDeviceId(d.id)}
            />
          ))}
          {calibrate.p1 && (
            <Circle
              x={calibrate.p1.x}
              y={calibrate.p1.y}
              radius={6}
              fill="#A01825"
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}

function DeviceMark({
  device,
  selected,
  onSelect,
}: {
  device: Device;
  selected: boolean;
  onSelect: () => void;
}) {
  const color = DEVICE_COLORS[device.type];
  const label = device.attrs.label || DEVICE_LABELS[device.type];
  const w = device.type === "panel" ? 36 : device.type === "fixture" ? 28 : 22;
  const h = device.type === "fixture" ? 16 : w;

  return (
    <Group
      x={device.x}
      y={device.y}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
    >
      <Rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        fill={device.type === "panel" ? color : "#EAF0FE"}
        stroke={selected ? "#A01825" : color}
        strokeWidth={selected ? 3 : 1.5}
        cornerRadius={4}
      />
      <Text
        text={label.slice(0, 4)}
        x={-w / 2}
        y={-6}
        width={w}
        align="center"
        fontSize={11}
        fontStyle="bold"
        fill={device.type === "panel" ? "#F6F7FC" : "#141E2C"}
      />
    </Group>
  );
}

function RouteLine({
  route,
  selected,
  editable,
  ftPerPx,
  onSelect,
  onPathChange,
}: {
  route: Route;
  selected: boolean;
  editable: boolean;
  ftPerPx: number | null;
  onSelect: () => void;
  onPathChange: (routeId: string, path: Point[], planFt: number) => void;
}) {
  const colors: Record<string, string> = {
    homerun: "#141E2C",
    branch: "#2C64F2",
    switchleg: "#9A6A00",
  };
  const dash = route.kind === "branch" ? [8, 5] : undefined;
  const flat = route.path.flatMap((p) => [p.x, p.y]);

  return (
    <Group>
      <Line
        points={flat}
        stroke={colors[route.kind] || "#2C64F2"}
        strokeWidth={selected ? 4 : 2.5}
        dash={dash}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={16}
        onClick={(e) => {
          e.cancelBubble = true;
          onSelect();
        }}
      />
      {editable &&
        route.path.map((p, i) => {
          if (i === 0 || i === route.path.length - 1) return null;
          return (
            <Circle
              key={i}
              x={p.x}
              y={p.y}
              radius={7}
              fill="#fff"
              stroke="#2C64F2"
              strokeWidth={2}
              draggable
              onDragMove={(e) => {
                const next = route.path.map((pt, idx) =>
                  idx === i ? { x: e.target.x(), y: e.target.y() } : pt
                );
                // Keep orthogonal: snap bend to H or V with neighbors
                const prev = next[i - 1];
                const nxt = next[i + 1];
                let x = e.target.x();
                let y = e.target.y();
                // Prefer keeping axis-aligned segments
                if (Math.abs(x - prev.x) < Math.abs(y - prev.y)) x = prev.x;
                else y = prev.y;
                if (nxt) {
                  if (x === prev.x) y = e.target.y();
                  else x = e.target.x();
                }
                e.target.position({ x, y });
                next[i] = { x, y };
                // Enforce next segment orthogonal
                if (nxt) {
                  if (next[i].x !== nxt.x && next[i].y !== nxt.y) {
                    next[i] = { x: nxt.x, y: next[i].y };
                    e.target.position(next[i]);
                  }
                }
              }}
              onDragEnd={(e) => {
                const next = [...route.path];
                next[i] = { x: e.target.x(), y: e.target.y() };
                const ft = ftPerPx ? pathLengthFt(next, ftPerPx) : route.plan_length_ft;
                onPathChange(route.id, next, ft);
              }}
            />
          );
        })}
    </Group>
  );
}
