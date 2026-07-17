"use client";

import { memo } from "react";
import { Group, Rect, Circle, Line, RegularPolygon, Text } from "react-konva";
import type { Device } from "@/lib/types";
import { fixtureSizePx, resolveCatalogId } from "@/lib/devices";
import { getCatalogEntry } from "@/lib/catalog";
import { pointerInParentLocal } from "@/lib/konva-coords";

type Props = {
  device: Device;
  selected: boolean;
  ftPerPx: number | null;
  viewScale: number;
  listening: boolean;
  onSelect: (shiftKey: boolean) => void;
  onDragStart?: () => void;
  onDragMove: (x: number, y: number, dx: number, dy: number) => void;
  onDragEnd: (x: number, y: number) => void;
};

function DeviceShapeInner({
  device,
  selected,
  ftPerPx,
  viewScale,
  listening,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  const catalogId = resolveCatalogId(device);
  const entry = getCatalogEntry(catalogId);
  const label = device.attrs.label || entry?.label.slice(0, 4) || "?";
  const s = viewScale > 0 ? viewScale : 1;
  const u = 1 / s;
  const r12 = 6 * u;
  const rSel = 7 * u;
  const panelHalf = 8 * u;
  const panelSel = 10 * u;
  const stroke = 1.5 * u;
  const selStroke = 2 * u;
  const symbol = entry?.symbol ?? "circle";
  const category = entry?.category ?? device.type;

  return (
    <Group
      x={device.x}
      y={device.y}
      draggable={listening && selected}
      listening={listening}
      perfectDrawEnabled={false}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(e.evt.shiftKey);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(false);
      }}
      onDragStart={(e) => {
        const local = pointerInParentLocal(e.target);
        if (local) e.target.position(local);
        e.target.setAttr("_ox", e.target.x());
        e.target.setAttr("_oy", e.target.y());
        onDragStart?.();
      }}
      onDragMove={(e) => {
        const local = pointerInParentLocal(e.target);
        if (local) e.target.position(local);
        const ox = e.target.getAttr("_ox") as number;
        const oy = e.target.getAttr("_oy") as number;
        const x = e.target.x();
        const y = e.target.y();
        onDragMove(x, y, x - ox, y - oy);
        e.target.setAttr("_ox", x);
        e.target.setAttr("_oy", y);
      }}
      onDragEnd={(e) => {
        const local = pointerInParentLocal(e.target);
        if (local) e.target.position(local);
        onDragEnd(e.target.x(), e.target.y());
      }}
    >
      {category === "panel" && (
        <>
          {selected && (
            <Rect
              x={-panelSel}
              y={-panelSel}
              width={panelSel * 2}
              height={panelSel * 2}
              stroke="#A01825"
              strokeWidth={selStroke}
              cornerRadius={3 * u}
            />
          )}
          <Rect
            x={-panelHalf}
            y={-panelHalf}
            width={panelHalf * 2}
            height={panelHalf * 2}
            fill="#141E2C"
            cornerRadius={3 * u}
          />
          <Text
            text={label.slice(0, 6) || "LP"}
            x={-panelHalf}
            y={-4 * u}
            width={panelHalf * 2}
            align="center"
            fontSize={9 * u}
            fontStyle="bold"
            fill="#F6F7FC"
            listening={false}
          />
        </>
      )}

      {category === "fixture" &&
        (() => {
          const { w, h } = fixtureSizePx(ftPerPx, catalogId);
          return (
            <>
              {selected && (
                <Rect
                  x={-w / 2 - 3}
                  y={-h / 2 - 3}
                  width={w + 6}
                  height={h + 6}
                  stroke="#A01825"
                  strokeWidth={2}
                  cornerRadius={2}
                />
              )}
              <Rect
                x={-w / 2}
                y={-h / 2}
                width={w}
                height={h}
                fill="#EAF0FE"
                stroke="#2C64F2"
                strokeWidth={1.5}
                cornerRadius={2}
              />
              <Text
                text={label.slice(0, 4) || "F"}
                x={-w / 2}
                y={-5}
                width={w}
                align="center"
                fontSize={Math.min(11, w * 0.35)}
                fontStyle="bold"
                fill="#141E2C"
                listening={false}
              />
            </>
          );
        })()}

      {category !== "panel" &&
        category !== "fixture" &&
        symbol === "circle" && (
          <>
            {selected && (
              <Circle radius={rSel} stroke="#A01825" strokeWidth={selStroke} />
            )}
            <Circle
              radius={r12}
              fill={category === "fire" ? "#F9E9EB" : "#EAF0FE"}
              stroke={category === "fire" ? "#A01825" : "#1D7A46"}
              strokeWidth={stroke}
            />
            {category === "receptacle" && (
              <>
                <Line
                  points={[-r12 * 0.55, -r12 * 0.35, r12 * 0.55, -r12 * 0.35]}
                  stroke="#1D7A46"
                  strokeWidth={stroke}
                  listening={false}
                />
                <Line
                  points={[-r12 * 0.55, r12 * 0.35, r12 * 0.55, r12 * 0.35]}
                  stroke="#1D7A46"
                  strokeWidth={stroke}
                  listening={false}
                />
              </>
            )}
          </>
        )}

      {category !== "panel" &&
        category !== "fixture" &&
        (symbol === "square" || symbol === "rect") && (
          <>
            {selected && (
              <Rect
                x={-rSel}
                y={-rSel}
                width={rSel * 2}
                height={rSel * 2}
                stroke="#A01825"
                strokeWidth={selStroke}
                cornerRadius={2 * u}
              />
            )}
            <Rect
              x={-r12}
              y={-r12}
              width={r12 * 2}
              height={r12 * 2}
              fill={
                category === "switch"
                  ? "#FBF3DC"
                  : category === "headend"
                    ? "#141E2C"
                    : "#EAF0FE"
              }
              stroke={
                category === "switch"
                  ? "#9A6A00"
                  : category === "headend"
                    ? "#2C64F2"
                    : "#141E2C"
              }
              strokeWidth={stroke}
              cornerRadius={2 * u}
            />
            <Text
              text={label.slice(0, 4)}
              x={-r12}
              y={-5 * u}
              width={r12 * 2}
              align="center"
              fontSize={9 * u}
              fontStyle="bold"
              fill={category === "headend" ? "#F6F7FC" : "#141E2C"}
              listening={false}
            />
          </>
        )}

      {category !== "panel" &&
        category !== "fixture" &&
        symbol === "triangle" && (
          <>
            {selected && (
              <RegularPolygon
                sides={3}
                radius={rSel}
                stroke="#A01825"
                strokeWidth={selStroke}
              />
            )}
            <RegularPolygon
              sides={3}
              radius={r12}
              fill="#F9E9EB"
              stroke="#A01825"
              strokeWidth={stroke}
            />
          </>
        )}

      {category !== "panel" &&
        category !== "fixture" &&
        symbol === "hex" && (
          <>
            {selected && (
              <RegularPolygon
                sides={6}
                radius={rSel}
                stroke="#A01825"
                strokeWidth={selStroke}
              />
            )}
            <RegularPolygon
              sides={6}
              radius={r12}
              fill="#EAF0FE"
              stroke="#2C64F2"
              strokeWidth={stroke}
            />
          </>
        )}
    </Group>
  );
}

export const DeviceShape = memo(DeviceShapeInner);
