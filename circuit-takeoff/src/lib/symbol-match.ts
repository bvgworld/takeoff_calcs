/**
 * Symbol template matching (Prompt 13, "Find similar").
 *
 * Pure matching logic shared by the Web Worker (browser) and the unit
 * tests (node). OpenCV.js (WASM) is NOT imported here — the caller loads
 * it lazily and passes the `cv` instance in, so this module adds nothing
 * to any bundle that doesn't explicitly enter symbol search.
 *
 * Coordinate spaces: matching runs in the (possibly downscaled) capture
 * space; `scaleCandidate` maps results back to full-res raster pixels.
 * Device centers land at the candidate box center.
 */

import type { CatalogEntry } from "@/lib/catalog";
import { defaultAttrsForCatalog } from "@/lib/devices";
import type { Device } from "@/lib/types";

export type Rect = { x: number; y: number; w: number; h: number };

export type MatchCandidate = {
  /** Stable id for check/uncheck UI state. */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** TM_CCOEFF_NORMED score, 0–1 (clamped). */
  confidence: number;
  /** Template rotation (deg) that produced the hit. */
  rotation: number;
  /** Template scale that produced the hit. */
  scale: number;
};

export type ImageDataLike = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

/** Max template edge in raster pixels — bigger boxes error out. */
export const MAX_TEMPLATE_PX = 200;
/** Min template edge — a couple of pixels can't identify a symbol. */
export const MIN_TEMPLATE_PX = 8;
/** Long-edge cap; larger rasters are matched on a downscaled copy. */
export const MATCH_MAX_EDGE = 4000;
/** Default confidence threshold for pre-checking candidates. */
export const DEFAULT_MATCH_THRESHOLD = 0.85;
/** Slider bounds. */
export const MATCH_THRESHOLD_MIN = 0.5;
export const MATCH_THRESHOLD_MAX = 0.99;

export const MATCH_ROTATIONS = [0, 90, 180, 270] as const;
export const MATCH_SCALES = [0.9, 1.0, 1.1] as const;

// ————— minimal structural OpenCV surface (keeps `any` out) —————

export type CvMat = {
  rows: number;
  cols: number;
  data: { set(arr: Uint8ClampedArray | Uint8Array): void };
  data32F: Float32Array;
  delete(): void;
  clone(): CvMat;
  roi(rect: unknown): CvMat;
};

export type Cv = {
  Rect: new (x: number, y: number, w: number, h: number) => unknown;
  Size: new (w: number, h: number) => unknown;
  Mat: new () => CvMat;
  matFromImageData(img: ImageDataLike): CvMat;
  cvtColor(src: CvMat, dst: CvMat, code: number): void;
  matchTemplate(image: CvMat, templ: CvMat, result: CvMat, method: number): void;
  resize(
    src: CvMat,
    dst: CvMat,
    dsize: unknown,
    fx?: number,
    fy?: number,
    interpolation?: number
  ): void;
  rotate(src: CvMat, dst: CvMat, rotateCode: number): void;
  COLOR_RGBA2GRAY: number;
  TM_CCOEFF_NORMED: number;
  ROTATE_90_CLOCKWISE: number;
  ROTATE_180: number;
  ROTATE_90_COUNTERCLOCKWISE: number;
  INTER_AREA: number;
  onRuntimeInitialized?: () => void;
};

/**
 * Normalize the opencv.js module export to a ready `cv` object.
 * @techstark/opencv-js default-exports a thenable that resolves once the
 * WASM runtime initializes; older builds expose onRuntimeInitialized.
 */
export async function resolveCv(mod: unknown): Promise<Cv> {
  const raw = (mod as { default?: unknown }).default ?? mod;
  const thenable = raw as { then?: unknown };
  const cv = (
    typeof thenable.then === "function" ? await (raw as Promise<unknown>) : raw
  ) as Cv;
  if (!("Mat" in cv) || typeof cv.Mat !== "function") {
    await new Promise<void>((res) => {
      cv.onRuntimeInitialized = res;
    });
  }
  return cv;
}

// ————— geometry helpers —————

/** Downscale factor (≤ 1) so the long edge fits maxEdge. */
export function downscaleFactor(
  w: number,
  h: number,
  maxEdge: number = MATCH_MAX_EDGE
): number {
  const long = Math.max(w, h);
  return long <= maxEdge ? 1 : maxEdge / long;
}

/** Scale a candidate's box back to full-res raster coordinates. */
export function scaleCandidate(
  c: MatchCandidate,
  factor: number
): MatchCandidate {
  return {
    ...c,
    x: c.x * factor,
    y: c.y * factor,
    w: c.w * factor,
    h: c.h * factor,
  };
}

/** Center point of a candidate box (device stamp location). */
export function candidateCenter(c: MatchCandidate): { x: number; y: number } {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}

/**
 * Validate the user-dragged template rectangle (raster pixels).
 * Returns a helpful error message, or null when the rect is usable.
 */
export function validateTemplateRect(
  rect: Rect,
  max: number = MAX_TEMPLATE_PX,
  min: number = MIN_TEMPLATE_PX
): string | null {
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);
  if (w < min || h < min) {
    return `Template too small (${w}×${h}px) — drag a box at least ${min}×${min}px around one symbol.`;
  }
  if (w > max || h > max) {
    return `Template too large (${w}×${h}px). Max is ${max}×${max}px at raster scale — drag a tighter box around a single symbol.`;
  }
  return null;
}

function iou(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Greedy non-max suppression: keep the highest-confidence box, drop any
 * box overlapping a kept one beyond `overlap` IoU. Collapses the plateau
 * of near-identical hits around each true instance to one candidate.
 */
export function nonMaxSuppression<T extends Rect & { confidence: number }>(
  candidates: T[],
  overlap = 0.35
): T[] {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const kept: T[] = [];
  for (const c of sorted) {
    let clear = true;
    for (const k of kept) {
      if (iou(k, c) >= overlap) {
        clear = false;
        break;
      }
    }
    if (clear) kept.push(c);
  }
  return kept;
}

export type FindMatchesOptions = {
  rotations?: readonly number[];
  scales?: readonly number[];
  /** Collect hits at/above this score (slider minimum). */
  collectFloor?: number;
  /** NMS IoU overlap. */
  nmsOverlap?: number;
  /** Cap on returned candidates (highest confidence first). */
  maxCandidates?: number;
  /** Called after each rotation×scale pass. */
  onProgress?: (done: number, total: number) => void;
};

/**
 * Run cv.matchTemplate (TM_CCOEFF_NORMED) for every rotation×scale combo
 * of the template cut from `image` at `templateRect`, collect peaks, NMS
 * them, and exclude the template's own location. All coordinates are in
 * the space of `image` — the caller rescales if it downsampled.
 */
export async function findSymbolMatches(
  cv: Cv,
  image: ImageDataLike,
  templateRect: Rect,
  opts: FindMatchesOptions = {}
): Promise<MatchCandidate[]> {
  const rotations = opts.rotations ?? MATCH_ROTATIONS;
  const scales = opts.scales ?? MATCH_SCALES;
  const floor = opts.collectFloor ?? MATCH_THRESHOLD_MIN;
  const nmsOverlap = opts.nmsOverlap ?? 0.35;
  const maxCandidates = opts.maxCandidates ?? 400;
  const total = rotations.length * scales.length;

  const rect = {
    x: Math.max(0, Math.round(templateRect.x)),
    y: Math.max(0, Math.round(templateRect.y)),
    w: Math.round(templateRect.w),
    h: Math.round(templateRect.h),
  };
  rect.w = Math.min(rect.w, image.width - rect.x);
  rect.h = Math.min(rect.h, image.height - rect.y);
  if (rect.w < 2 || rect.h < 2) return [];

  const src = cv.matFromImageData(image);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();

  const roi = gray.roi(new cv.Rect(rect.x, rect.y, rect.w, rect.h));
  const tmplBase = roi.clone();
  roi.delete();

  const raw: Omit<MatchCandidate, "id">[] = [];
  let done = 0;

  try {
    for (const rot of rotations) {
      let rotated: CvMat;
      if (rot === 0) {
        rotated = tmplBase.clone();
      } else {
        rotated = new cv.Mat();
        const code =
          rot === 90
            ? cv.ROTATE_90_CLOCKWISE
            : rot === 180
              ? cv.ROTATE_180
              : cv.ROTATE_90_COUNTERCLOCKWISE;
        cv.rotate(tmplBase, rotated, code);
      }
      try {
        for (const s of scales) {
          const tw = Math.max(4, Math.round(rotated.cols * s));
          const th = Math.max(4, Math.round(rotated.rows * s));
          if (tw >= image.width || th >= image.height) {
            done++;
            opts.onProgress?.(done, total);
            continue;
          }
          const tmpl = new cv.Mat();
          cv.resize(rotated, tmpl, new cv.Size(tw, th), 0, 0, cv.INTER_AREA);
          const result = new cv.Mat();
          try {
            cv.matchTemplate(gray, tmpl, result, cv.TM_CCOEFF_NORMED);
            const data = result.data32F;
            const rw = result.cols;
            const combo: Omit<MatchCandidate, "id">[] = [];
            for (let i = 0; i < data.length; i++) {
              const v = data[i];
              if (!(v >= floor)) continue; // skips NaN too
              combo.push({
                x: i % rw,
                y: Math.floor(i / rw),
                w: tw,
                h: th,
                confidence: Math.min(1, v),
                rotation: rot,
                scale: s,
              });
            }
            // Bound memory on pathological plateaus before global NMS.
            if (combo.length > 5000) {
              combo.sort((a, b) => b.confidence - a.confidence);
              combo.length = 5000;
            }
            raw.push(...combo);
          } finally {
            tmpl.delete();
            result.delete();
          }
          done++;
          opts.onProgress?.(done, total);
        }
      } finally {
        rotated.delete();
      }
    }
  } finally {
    tmplBase.delete();
    gray.delete();
  }

  const kept = nonMaxSuppression(raw, nmsOverlap)
    // Exclude the template's own location (any rotation/scale of it).
    .filter((c) => {
      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2;
      return !(
        cx >= rect.x &&
        cx <= rect.x + rect.w &&
        cy >= rect.y &&
        cy <= rect.y + rect.h
      );
    })
    .slice(0, maxCandidates);

  return kept.map((c, i) => ({ ...c, id: `m${i}` }));
}

// ————— apply / undo helpers (pure; used by SheetViewer + tests) —————

/**
 * Turn checked candidates into optimistic Device rows stamped at each
 * candidate's center, tagged source='template_match' with confidence.
 * Labels sequence correctly (JB-1, JB-2, …) because each new device is
 * appended to the working list before the next label is computed.
 */
export function matchesToDevices(
  candidates: MatchCandidate[],
  entry: CatalogEntry,
  sheetId: string,
  existing: Device[]
): Device[] {
  const working = [...existing];
  return candidates.map((c) => {
    const center = candidateCenter(c);
    const d: Device = {
      id: crypto.randomUUID(),
      sheet_id: sheetId,
      type: entry.category,
      catalog_id: entry.id,
      x: center.x,
      y: center.y,
      attrs: defaultAttrsForCatalog(entry.id, working),
      circuit_id: null,
      created_at: new Date().toISOString(),
      source: "template_match",
      confidence: c.confidence,
    };
    working.push(d);
    return d;
  });
}

/** Batch undo: remove all — and only — the applied batch. */
export function removeBatch(devices: Device[], batchIds: string[]): Device[] {
  const gone = new Set(batchIds);
  return devices.filter((d) => !gone.has(d.id));
}
