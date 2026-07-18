"use client";

import { memo } from "react";
import { Group, Rect, Circle, Line, RegularPolygon, Text } from "react-konva";
import type Konva from "konva";
import type { Device } from "@/lib/types";
import { fixtureSizePx, resolveCatalogId } from "@/lib/devices";
import { getCatalogEntry } from "@/lib/catalog";
import { pointerInParentLocal } from "@/lib/konva-coords";

/**
 * Dev-only, once: verify the drag target is the OUTER device Group.
 * Konva fires drag events on the draggable node itself, so inner children
 * (inverse-scale Group, Rect body, Text label) can never be the drag
 * target — this assert documents and guards that invariant.
 */
let dragChainLogged = false;
function assertDragTargetOnce(node: Konva.Node) {
  if (process.env.NODE_ENV === "production" || dragChainLogged) return;
  dragChainLogged = true;
  const chain: string[] = [];
  let n: Konva.Node | null = node;
  while (n) {
    chain.push(`${n.getClassName()}${n.name() ? `(${n.name()})` : ""}`);
    n = n.getParent();
  }
  // eslint-disable-next-line no-console
  console.info("[DeviceShape] drag target chain:", chain.join(" → "));
  console.assert(
    node.getClassName() === "Group" && node.name() === "device",
    "[DeviceShape] drag target is not the outer device Group:",
    node.getClassName(),
    node.name()
  );
}

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

/** Constant-screen-size symbol body (panel / switch / etc.) in screen px. */
function ConstantSizeBody({
  category,
  symbol,
  label,
  selected,
}: {
  category: string;
  symbol: string;
  label: string;
  selected: boolean;
}) {
  const r12 = 6;
  const rSel = 7;
  const panelHalf = 8;
  const panelSel = 10;
  const stroke = 1.5;
  const selStroke = 2;

  if (category === "panel") {
    return (
      <>
        {selected && (
          <Rect
            x={-panelSel}
            y={-panelSel}
            width={panelSel * 2}
            height={panelSel * 2}
            stroke="#A01825"
            strokeWidth={selStroke}
            cornerRadius={3}
          />
        )}
        <Rect
          x={-panelHalf}
          y={-panelHalf}
          width={panelHalf * 2}
          height={panelHalf * 2}
          fill="#141E2C"
          cornerRadius={3}
        />
        <Text
          text={label.slice(0, 6) || "LP"}
          x={-panelHalf}
          y={-4}
          width={panelHalf * 2}
          align="center"
          fontSize={9}
          fontStyle="bold"
          fill="#F6F7FC"
          listening={false}
        />
      </>
    );
  }

  // J-box: small square with X (constant screen size).
  if (category === "jbox") {
    const half = r12;
    return (
      <>
        {selected && (
          <Rect
            x={-rSel}
            y={-rSel}
            width={rSel * 2}
            height={rSel * 2}
            stroke="#A01825"
            strokeWidth={selStroke}
            cornerRadius={2}
          />
        )}
        <Rect
          x={-half}
          y={-half}
          width={half * 2}
          height={half * 2}
          fill="#F6F7FC"
          stroke="#141E2C"
          strokeWidth={stroke}
          cornerRadius={1}
        />
        <Line
          points={[-half * 0.55, -half * 0.55, half * 0.55, half * 0.55]}
          stroke="#141E2C"
          strokeWidth={stroke}
          listening={false}
        />
        <Line
          points={[half * 0.55, -half * 0.55, -half * 0.55, half * 0.55]}
          stroke="#141E2C"
          strokeWidth={stroke}
          listening={false}
        />
        <Text
          text={label.slice(0, 6) || "JB"}
          x={-half - 2}
          y={half + 1}
          width={half * 2 + 4}
          align="center"
          fontSize={8}
          fontStyle="bold"
          fill="#141E2C"
          listening={false}
        />
      </>
    );
  }

  if (symbol === "circle") {
    return (
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
    );
  }

  if (symbol === "square" || symbol === "rect") {
    return (
      <>
        {selected && (
          <Rect
            x={-rSel}
            y={-rSel}
            width={rSel * 2}
            height={rSel * 2}
            stroke="#A01825"
            strokeWidth={selStroke}
            cornerRadius={2}
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
          cornerRadius={2}
        />
        <Text
          text={label.slice(0, 4)}
          x={-r12}
          y={-5}
          width={r12 * 2}
          align="center"
          fontSize={9}
          fontStyle="bold"
          fill={category === "headend" ? "#F6F7FC" : "#141E2C"}
          listening={false}
        />
      </>
    );
  }

  if (symbol === "triangle") {
    return (
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
    );
  }

  if (symbol === "hex") {
    return (
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
    );
  }

  return null;
}

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
  const inv = 1 / s;
  const symbol = entry?.symbol ?? "circle";
  const category = entry?.category ?? device.type;
  const isFixture = category === "fixture";

  return (
    // Outer group: image-space position only — this node is draggable.
    <Group
      name="device"
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
        e.cancelBubble = true;
        assertDragTargetOnce(e.target);
        const stage = e.target.getStage();
        if (stage) {
          e.target.setAttr("_stageWasDraggable", stage.draggable());
          stage.draggable(false);
        }
        // Grab offset: position minus pointer, so the device does NOT
        // jump its center to the cursor on dragstart.
        const local = pointerInParentLocal(e.target);
        e.target.setAttr("_gx", local ? e.target.x() - local.x : 0);
        e.target.setAttr("_gy", local ? e.target.y() - local.y : 0);
        e.target.setAttr("_ox", e.target.x());
        e.target.setAttr("_oy", e.target.y());
        onDragStart?.();
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        const local = pointerInParentLocal(e.target);
        if (local) {
          e.target.position({
            x: local.x + ((e.target.getAttr("_gx") as number) || 0),
            y: local.y + ((e.target.getAttr("_gy") as number) || 0),
          });
        }
        const ox = e.target.getAttr("_ox") as number;
        const oy = e.target.getAttr("_oy") as number;
        const x = e.target.x();
        const y = e.target.y();
        onDragMove(x, y, x - ox, y - oy);
        e.target.setAttr("_ox", x);
        e.target.setAttr("_oy", y);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const stage = e.target.getStage();
        if (stage) {
          const was = e.target.getAttr("_stageWasDraggable");
          stage.draggable(was === true);
        }
        const local = pointerInParentLocal(e.target);
        if (local) {
          e.target.position({
            x: local.x + ((e.target.getAttr("_gx") as number) || 0),
            y: local.y + ((e.target.getAttr("_gy") as number) || 0),
          });
        }
        onDragEnd(e.target.x(), e.target.y());
      }}
    >
      {isFixture ? (
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
        })()
      ) : (
        // Inner inverse-scale: constant screen size; NOT draggable.
        <Group scaleX={inv} scaleY={inv} perfectDrawEnabled={false}>
          <ConstantSizeBody
            category={category}
            symbol={symbol}
            label={label}
            selected={selected}
          />
        </Group>
      )}
    </Group>
  );
}

export const DeviceShape = memo(DeviceShapeInner);
