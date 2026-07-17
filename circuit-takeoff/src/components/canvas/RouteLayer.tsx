"use client";

import { Group, Line, Circle, Arrow } from "react-konva";
import type { Circuit, Point, Route } from "@/lib/types";
import {
  circuitHue,
  moveOrthogonalSegment,
  planLengthFt,
  snapOrthogonalBend,
} from "@/lib/routing";
import { LV_COLORS, LV_DASH, dimmingFollows } from "@/lib/lv-routing";
import type { Device } from "@/lib/types";
import { pointerInParentLocal } from "@/lib/konva-coords";

type Props = {
  circuits: Circuit[];
  devices: Device[];
  routes: Route[];
  ftPerPx: number;
  selectedRouteId: string | null;
  /** Show/edit handles when a route is selected (Select or Edit routes). */
  editEnabled: boolean;
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
  editEnabled,
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
        const showHandles = selected && editEnabled;

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

            {/* Per-segment hit targets for whole-segment drag */}
            {showHandles &&
              r.path.slice(0, -1).map((a, i) => {
                const b = r.path[i + 1];
                const horiz = Math.abs(a.y - b.y) <= 0.75;
                return (
                  <Line
                    key={`${r.id}-seg-${i}`}
                    points={[a.x, a.y, b.x, b.y]}
                    stroke="transparent"
                    strokeWidth={14}
                    hitStrokeWidth={16}
                    lineCap="round"
                    onMouseEnter={(e) => {
                      const stage = e.target.getStage();
                      if (stage) {
                        stage.container().style.cursor = horiz
                          ? "ns-resize"
                          : "ew-resize";
                      }
                    }}
                    onMouseLeave={(e) => {
                      const stage = e.target.getStage();
                      if (stage) stage.container().style.cursor = "";
                    }}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      onSelectRoute(r.id);
                    }}
                    draggable
                    // Path rewrite drives geometry; keep this hit-line parked at origin.
                    dragBoundFunc={() => ({ x: 0, y: 0 })}
                    onDragStart={(e) => {
                      e.cancelBubble = true;
                      const stage = e.target.getStage();
                      if (stage) {
                        e.target.setAttr("_stageWasDraggable", stage.draggable());
                        stage.draggable(false);
                      }
                      e.target.setAttr("_segIndex", i);
                      e.target.setAttr(
                        "_path0",
                        r.path.map((p) => ({ ...p }))
                      );
                    }}
                    onDragMove={(e) => {
                      e.cancelBubble = true;
                      e.target.position({ x: 0, y: 0 });
                      const local = pointerInParentLocal(e.target);
                      if (!local) return;
                      const segIndex = e.target.getAttr("_segIndex") as number;
                      const base =
                        (e.target.getAttr("_path0") as Point[]) || r.path;
                      // Always from drag-start path so segIndex stays valid.
                      const next = moveOrthogonalSegment(base, segIndex, local, {
                        lockStart: true,
                        lockEnd: true,
                      });
                      onPathChange(
                        r.id,
                        next,
                        planLengthFt(next, ftPerPx),
                        true
                      );
                    }}
                    onDragEnd={(e) => {
                      e.cancelBubble = true;
                      e.target.position({ x: 0, y: 0 });
                      const stage = e.target.getStage();
                      if (stage) {
                        const was = e.target.getAttr("_stageWasDraggable");
                        stage.draggable(was === true);
                        stage.container().style.cursor = "";
                      }
                      const local = pointerInParentLocal(e.target);
                      const segIndex = e.target.getAttr("_segIndex") as number;
                      const base =
                        (e.target.getAttr("_path0") as Point[]) || r.path;
                      if (local) {
                        const next = moveOrthogonalSegment(
                          base,
                          segIndex,
                          local,
                          { lockStart: true, lockEnd: true }
                        );
                        onPathChange(
                          r.id,
                          next,
                          planLengthFt(next, ftPerPx),
                          true
                        );
                      }
                    }}
                  />
                );
              })}

            {r.kind === "homerun" && r.path.length >= 2 && !lv && (
              <HomeRunDecor path={r.path} color={hue} />
            )}

            {showHandles &&
              r.path.map((p, i) => {
                const isEnd = i === 0 || i === r.path.length - 1;
                if (isEnd) {
                  // Locked endpoint — visible, not draggable
                  return (
                    <Circle
                      key={`${r.id}-end-${i}`}
                      x={p.x}
                      y={p.y}
                      radius={5}
                      fill="#94a3b8"
                      stroke={hue}
                      strokeWidth={2}
                      listening={false}
                    />
                  );
                }
                return (
                  <Circle
                    key={`${r.id}-bend-${i}`}
                    x={p.x}
                    y={p.y}
                    radius={6}
                    fill="#fff"
                    stroke={hue}
                    strokeWidth={2}
                    draggable
                    onDragStart={(e) => {
                      e.cancelBubble = true;
                      const stage = e.target.getStage();
                      if (stage) {
                        e.target.setAttr(
                          "_stageWasDraggable",
                          stage.draggable()
                        );
                        stage.draggable(false);
                      }
                    }}
                    onDragMove={(e) => {
                      e.cancelBubble = true;
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
                      e.cancelBubble = true;
                      const stage = e.target.getStage();
                      if (stage) {
                        const was = e.target.getAttr("_stageWasDraggable");
                        stage.draggable(was === true);
                      }
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

function HomeRunDecor({ path, color }: { path: Point[]; color: string }) {
  if (path.length < 2) return null;
  const start = path[0];
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
  const end = path[path.length - 1];
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
