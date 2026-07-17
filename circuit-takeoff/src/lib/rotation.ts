/** Display-only sheet rotation (degrees). Stored coords stay unrotated. */

export type SheetRotation = 0 | 90 | 180 | 270;

export function normalizeRotation(deg: number): SheetRotation {
  const r = ((Math.round(deg) % 360) + 360) % 360;
  if (r === 90 || r === 180 || r === 270) return r;
  return 0;
}

export function rotateStep(
  current: SheetRotation,
  dir: 1 | -1
): SheetRotation {
  return normalizeRotation(current + dir * 90);
}

/** Axis-aligned bounds size after rotation about image center. */
export function fitSizeForRotation(
  imageW: number,
  imageH: number,
  rot: SheetRotation
): { w: number; h: number } {
  if (rot === 90 || rot === 270) return { w: imageH, h: imageW };
  return { w: imageW, h: imageH };
}
