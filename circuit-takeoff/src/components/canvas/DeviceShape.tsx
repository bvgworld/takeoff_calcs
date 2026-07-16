"use client";

import { memo } from "react";
import { Group, Rect, Circle, Line, Text } from "react-konva";
import type { Device } from "@/lib/types";
import { fixtureSizePx } from "@/lib/devices";

type Props = {
  device: Device;
  selected: boolean;
  ftPerPx: number | null;
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
  listening,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  const label = device.attrs.label || "";
  const ring = selected ? 3 : 0;

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
        e.target.setAttr("_ox", e.target.x());
        e.target.setAttr("_oy", e.target.y());
        onDragStart?.();
      }}
      onDragMove={(e) => {
        const ox = e.target.getAttr("_ox") as number;
        const oy = e.target.getAttr("_oy") as number;
        const x = e.target.x();
        const y = e.target.y();
        onDragMove(x, y, x - ox, y - oy);
        e.target.setAttr("_ox", x);
        e.target.setAttr("_oy", y);
      }}
      onDragEnd={(e) => {
        onDragEnd(e.target.x(), e.target.y());
      }}
    >
      {device.type === "panel" && (
        <>
          {selected && (
            <Rect
              x={-20}
              y={-20}
              width={40}
              height={40}
              stroke="#A01825"
              strokeWidth={ring}
              cornerRadius={3}
            />
          )}
          <Rect
            x={-16}
            y={-16}
            width={32}
            height={32}
            fill="#141E2C"
            cornerRadius={3}
          />
          <Text
            text={label.slice(0, 6) || "LP"}
            x={-16}
            y={-5}
            width={32}
            align="center"
            fontSize={9}
            fontStyle="bold"
            fill="#F6F7FC"
            listening={false}
          />
        </>
      )}

      {device.type === "fixture" && (() => {
        const { w, h } = fixtureSizePx(ftPerPx);
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

      {device.type === "receptacle" && (
        <>
          {selected && (
            <Circle
              radius={14}
              stroke="#A01825"
              strokeWidth={2}
            />
          )}
          <Circle
            radius={11}
            fill="#EAF0FE"
            stroke="#1D7A46"
            strokeWidth={1.5}
          />
          <Line
            points={[-6, -4, 6, -4]}
            stroke="#1D7A46"
            strokeWidth={1.5}
            listening={false}
          />
          <Line
            points={[-6, 4, 6, 4]}
            stroke="#1D7A46"
            strokeWidth={1.5}
            listening={false}
          />
        </>
      )}

      {device.type === "switch" && (
        <>
          {selected && (
            <Rect
              x={-12}
              y={-12}
              width={24}
              height={24}
              stroke="#A01825"
              strokeWidth={2}
              cornerRadius={2}
            />
          )}
          <Rect
            x={-9}
            y={-9}
            width={18}
            height={18}
            fill="#FBF3DC"
            stroke="#9A6A00"
            strokeWidth={1.5}
            cornerRadius={2}
          />
          <Text
            text="S"
            x={-9}
            y={-5}
            width={18}
            align="center"
            fontSize={11}
            fontStyle="bold"
            fill="#141E2C"
            listening={false}
          />
        </>
      )}
    </Group>
  );
}

export const DeviceShape = memo(DeviceShapeInner);
