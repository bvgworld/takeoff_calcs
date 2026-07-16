import type { Point } from "./types";

export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Orthogonal polyline: horizontal then vertical. */
export function manhattanPath(a: Point, b: Point): Point[] {
  if (a.x === b.x || a.y === b.y) return [a, b];
  return [a, { x: b.x, y: a.y }, b];
}

export function pathLengthPx(path: Point[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += dist(path[i - 1], path[i]);
  return len;
}

export function pathLengthFt(path: Point[], ftPerPx: number): number {
  return pathLengthPx(path) * ftPerPx;
}

/** Prim MST on devices using Manhattan distance. Returns undirected edges as index pairs. */
export function mstEdges(points: Point[]): [number, number][] {
  const n = points.length;
  if (n < 2) return [];
  const inTree = new Array(n).fill(false);
  const best = new Array(n).fill(Infinity);
  const parent = new Array(n).fill(-1);
  best[0] = 0;
  const edges: [number, number][] = [];

  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && (u === -1 || best[i] < best[u])) u = i;
    }
    if (u === -1) break;
    inTree[u] = true;
    if (parent[u] !== -1) edges.push([parent[u], u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = manhattan(points[u], points[v]);
      if (d < best[v]) {
        best[v] = d;
        parent[v] = u;
      }
    }
  }
  return edges;
}

/** Find device index closest to panel for home-run attach point among MST nodes. */
export function nearestIndex(from: Point, points: Point[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = manhattan(from, points[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
