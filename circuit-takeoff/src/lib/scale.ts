/**
 * Scale helpers: parse real-world distances, format badges / measures.
 *
 * DISTANCE CONVERSION RULE: every px→ft conversion must use the sheet's
 * stored ft_per_px via pxToFt (or planLengthFt → pxToFt). Only the
 * calibrate dialog may read render_dpi / scale presets to WRITE ft_per_px.
 *
 * Architectural-scale badge approximation uses sheet.render_dpi when
 * present; legacy sheets fall back to 150 DPI.
 * New uploads store actual render_dpi (300 target, 12000px cap).
 */

/** Fallback DPI for nearestArchScale when sheet.render_dpi is null. */
export const FALLBACK_RENDER_DPI = 150;

/** Warn when two-point reference span is shorter than this (image px). */
export const SHORT_BASELINE_PX = 150;

/** Show preset-vs-current note when relative difference exceeds this (%). */
export const SCALE_MISMATCH_WARN_PCT = 5;

/** Paper inches per real foot (architectural). */
export type ArchScalePreset = {
  kind: "arch";
  label: string;
  inchPerFt: number;
};

/** Engineering: 1" on paper = N feet. */
export type EngScalePreset = {
  kind: "eng";
  label: string;
  feetPerPaperInch: number;
};

export type ScalePreset = ArchScalePreset | EngScalePreset;

export const ARCH_SCALE_PRESETS: ArchScalePreset[] = [
  { kind: "arch", label: '1/16" = 1\'-0"', inchPerFt: 1 / 16 },
  { kind: "arch", label: '3/32" = 1\'-0"', inchPerFt: 3 / 32 },
  { kind: "arch", label: '1/8" = 1\'-0"', inchPerFt: 1 / 8 },
  { kind: "arch", label: '3/16" = 1\'-0"', inchPerFt: 3 / 16 },
  { kind: "arch", label: '1/4" = 1\'-0"', inchPerFt: 1 / 4 },
  { kind: "arch", label: '3/8" = 1\'-0"', inchPerFt: 3 / 8 },
  { kind: "arch", label: '1/2" = 1\'-0"', inchPerFt: 1 / 2 },
  { kind: "arch", label: '3/4" = 1\'-0"', inchPerFt: 3 / 4 },
  { kind: "arch", label: '1" = 1\'-0"', inchPerFt: 1 },
];

export const ENG_SCALE_PRESETS: EngScalePreset[] = [
  { kind: "eng", label: '1" = 10\'', feetPerPaperInch: 10 },
  { kind: "eng", label: '1" = 20\'', feetPerPaperInch: 20 },
  { kind: "eng", label: '1" = 30\'', feetPerPaperInch: 30 },
  { kind: "eng", label: '1" = 40\'', feetPerPaperInch: 40 },
  { kind: "eng", label: '1" = 50\'', feetPerPaperInch: 50 },
  { kind: "eng", label: '1" = 60\'', feetPerPaperInch: 60 },
];

const ARCH_SCALES = ARCH_SCALE_PRESETS;

/** Feet of real world per inch of paper for a preset. */
export function feetPerPaperInch(preset: ScalePreset): number {
  if (preset.kind === "eng") return preset.feetPerPaperInch;
  return 1 / preset.inchPerFt;
}

/**
 * ft_per_px from a drawing-scale preset and the sheet's actual render DPI.
 * Example: 1/8"=1'-0" → 8 ft/paper-inch; at 150 DPI → 8/150 ≈ 0.05333.
 */
export function ftPerPxFromPreset(
  preset: ScalePreset,
  renderDpi: number
): number {
  if (!(renderDpi > 0)) {
    throw new Error("renderDpi must be positive");
  }
  return feetPerPaperInch(preset) / renderDpi;
}

/** Parse 25', 25.5, 25'-6", 25' 6", 25 ft 6 in, etc. → feet. */
export function parseDistanceFt(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, "");
  if (!s) return null;

  // Decimal feet: 25.5 or 25
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 0 ? n : null;
  }

  // 25ft / 25 ft / 25 feet
  const ftOnly = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|')$/);
  if (ftOnly) {
    const n = Number(ftOnly[1]);
    return n > 0 ? n : null;
  }

  // 25'-6" | 25'6" | 25' 6" | 25' - 6" | 25 ft 6 in | 25'-6
  const arch = s.match(
    /^(\d+)\s*(?:'|ft|feet)?\s*-?\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?$/
  );
  if (arch) {
    const feet = Number(arch[1]);
    const inches = Number(arch[2]);
    if (inches >= 12) return null;
    const total = feet + inches / 12;
    return total > 0 ? total : null;
  }

  // 6" only
  const inchOnly = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/);
  if (inchOnly) {
    const n = Number(inchOnly[1]) / 12;
    return n > 0 ? n : null;
  }

  return null;
}

export function formatFtIn(ft: number): string {
  if (!Number.isFinite(ft) || ft < 0) return "—";
  const sign = ft < 0 ? "-" : "";
  const abs = Math.abs(ft);
  let whole = Math.floor(abs + 1e-9);
  let inches = Math.round((abs - whole) * 12);
  if (inches === 12) {
    whole += 1;
    inches = 0;
  }
  return `${sign}${whole}'-${inches}"`;
}

/**
 * Nearest architectural scale label for a ft_per_px value.
 * @param renderDpi sheet.render_dpi, or omit/null to use FALLBACK_RENDER_DPI (150).
 */
export function nearestArchScale(
  ftPerPx: number,
  renderDpi?: number | null
): string {
  if (!ftPerPx || ftPerPx <= 0) return "—";
  const dpi =
    typeof renderDpi === "number" && renderDpi > 0
      ? renderDpi
      : FALLBACK_RENDER_DPI;
  // inches on paper per real foot, at the sheet's raster DPI
  const inchPerFt = 1 / (ftPerPx * dpi);
  let best = ARCH_SCALES[0];
  let bestErr = Infinity;
  for (const s of ARCH_SCALES) {
    const err = Math.abs(Math.log(inchPerFt) - Math.log(s.inchPerFt));
    if (err < bestErr) {
      bestErr = err;
      best = s;
    }
  }
  return best.label;
}

export function formatScaleBadge(
  ftPerPx: number,
  renderDpi?: number | null
): string {
  const px = ftPerPx >= 0.01 ? ftPerPx.toFixed(3) : ftPerPx.toFixed(5);
  return `Scale: 1px = ${px} ft (≈${nearestArchScale(ftPerPx, renderDpi)})`;
}

export function isCalibrated(ftPerPx: number | null | undefined): boolean {
  return typeof ftPerPx === "number" && ftPerPx > 0 && Number.isFinite(ftPerPx);
}

/**
 * Pixel distance → feet using the sheet's current ft_per_px.
 * Single source of truth for all distance conversions (Measure, routes, etc.).
 */
export function pxToFt(px: number, ftPerPx: number): number {
  return px * ftPerPx;
}

/** Two-point calibration: real feet ÷ image-pixel span → ft_per_px. */
export function ftPerPxFromTwoPoint(
  feet: number,
  pixelDistance: number
): number {
  if (!(feet > 0) || !(pixelDistance > 0)) {
    throw new Error("feet and pixelDistance must be positive");
  }
  return feet / pixelDistance;
}

/** Absolute percent difference between two positive scales. */
export function scaleMismatchPct(a: number, b: number): number | null {
  if (!(a > 0) || !(b > 0)) return null;
  return Math.abs(a / b - 1) * 100;
}

export function isShortBaseline(pixelDistance: number | null | undefined): boolean {
  return (
    typeof pixelDistance === "number" &&
    pixelDistance > 0 &&
    pixelDistance < SHORT_BASELINE_PX
  );
}
