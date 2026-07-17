"use client";

import { Group, Line, Circle, Arrow } from "react-konva";
import type { Circuit, Point, Route } from "@/lib/types";
import { circuitHue, planLengthFt, snapOrthogonalBend } from "@/lib/routing";
import { LV_COLORS, LV_DASH, dimmingFollows } from "@/lib/lv-routing";
import type { Device } from "@/lib/types";
import { pointerInParentLocal } from "@/lib/konva-coords";

type Props = {
  circuits: Circuit[];
  devices: Device[];
  routes: Route[];
  ftPerPx: number;
  selectedRouteId: string | null;
  editMode: boolean;
  onSelectRoute: (id: string) => void;
  onPathChange: (
    routeId: string,
    path: Point[],
    planFt: number,
    userEdited: boolean
  ) => void;
};

export function RouteLayer({
  circuits,
  devices,
  routes,
  ftPerPx,
  selectedRouteId,
  editMode,
  onSelectRoute,
  onPathChange,
}: Props) {
  const byCkt = new Map(circuits.map((c) => [c.id, c]));
  const dimming = dimmingFollows({ circuits, devices, routes });

  return (
    <Group>
      {routes.map((r) => {
        const lv = r.lv_system;
        const ckt = r.circuit_id ? byCkt.get(r.circuit_id) : undefined;
        const hue = lv
          ? LV_COLORS[lv]
          : ckt
            ? circuitHue(ckt.number)
            : "#2C64F2";
        const flat = r.path.flatMap((p) => [p.x, p.y]);
        const selected = r.id === selectedRouteId;
        const heavy = r.kind === "homerun";
        const dash = lv
          ? LV_DASH[lv]
          : r.kind === "switchleg"
            ? [8, 5]
            : undefined;

        return (
          <Group key={r.id}>
            <Line
              points={flat}
              stroke={hue}
              strokeWidth={heavy ? (selected ? 5 : 3.5) : selected ? 3.5 : 2}
              dash={dash}
              lineCap="round"
              lineJoin="round"
              hitStrokeWidth={14}
              onClick={(e) => {
                e.cancelBubble = true;
                onSelectRoute(r.id);
              }}
            />
            {r.kind === "homerun" && r.path.length >= 2 && !lv && (
              <HomeRunDecor path={r.path} color={hue} />
            )}
            {editMode &&
              selected &&
              r.path.map((p, i) => {
                if (i === 0 || i === r.path.length - 1) return null;
                return (
                  <Circle
                    key={`${r.id}-${i}`}
                    x={p.x}
                    y={p.y}
                    radius={6}
                    fill="#fff"
                    stroke={hue}
                    strokeWidth={2}
                    draggable
                    onDragMove={(e) => {
                      const local = pointerInParentLocal(e.target);
                      if (local) e.target.position(local);
                      const next = snapOrthogonalBend(
                        r.path,
                        i,
                        e.target.x(),
                        e.target.y()
                      );
                      e.target.position(next[i]);
                      const ft = planLengthFt(next, ftPerPx);
                      onPathChange(r.id, next, ft, true);
                    }}
                    onDragEnd={(e) => {
                      const local = pointerInParentLocal(e.target);
                      if (local) e.target.position(local);
                      const next = snapOrthogonalBend(
                        r.path,
                        i,
                        e.target.x(),
                        e.target.y()
                      );
                      const ft = planLengthFt(next, ftPerPx);
                      onPathChange(r.id, next, ft, true);
                    }}
                  />
                );
              })}
          </Group>
        );
      })}

      {/* Dimming follow overlay — distinct dash on existing branch/switchleg */}
      {dimming.flatMap((f) =>
        f.paths.map((seg, i) => {
          if (seg.path.length < 2) return null;
          return (
            <Line
              key={`dim-${f.circuitId}-${i}`}
              points={seg.path.flatMap((p) => [p.x, p.y])}
              stroke={LV_COLORS.dimming}
              strokeWidth={2}
              dash={LV_DASH.dimming}
              lineCap="round"
              lineJoin="round"
              listening={false}
              opacity={0.85}
            />
          );
        })
      )}
    </Group>
  );
}

/** Arrowhead at entry end + hash marks near panel (start). */
function HomeRunDecor({ path, color }: { path: Point[]; color: string }) {
  if (path.length < 2) return null;
  const start = path[0];
  const end = path[path.length - 1];
  const second = path[1];

  const marks = 3;
  const hashes = [];
  for (let i = 0; i < marks; i++) {
    const t = 0.15 + i * 0.08;
    const mx = start.x + (second.x - start.x) * t;
    const my = start.y + (second.y - start.y) * t;
    const dx = second.x - start.x;
    const dy = second.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * 6;
    const py = (dx / len) * 6;
    hashes.push(
      <Line
        key={i}
        points={[mx - px, my - py, mx + px, my + py]}
        stroke={color}
        strokeWidth={1.5}
        listening={false}
      />
    );
  }

  const prev = path[path.length - 2];
  return (
    <Group listening={false}>
      {hashes}
      <Arrow
        points={[prev.x, prev.y, end.x, end.y]}
        stroke={color}
        fill={color}
        strokeWidth={2}
        pointerLength={10}
        pointerWidth={8}
      />
    </Group>
  );
}
