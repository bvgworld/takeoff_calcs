/**
 * Scale helpers: parse real-world distances, format badges / measures.
 * Raster assumed ~150 DPI for architectural-scale approximation.
 */

const ASSUMED_DPI = 150;

const ARCH_SCALES: { label: string; inchPerFt: number }[] = [
  { label: '1/16" = 1\'-0"', inchPerFt: 1 / 16 },
  { label: '3/32" = 1\'-0"', inchPerFt: 3 / 32 },
  { label: '1/8" = 1\'-0"', inchPerFt: 1 / 8 },
  { label: '3/16" = 1\'-0"', inchPerFt: 3 / 16 },
  { label: '1/4" = 1\'-0"', inchPerFt: 1 / 4 },
  { label: '3/8" = 1\'-0"', inchPerFt: 3 / 8 },
  { label: '1/2" = 1\'-0"', inchPerFt: 1 / 2 },
  { label: '3/4" = 1\'-0"', inchPerFt: 3 / 4 },
  { label: '1" = 1\'-0"', inchPerFt: 1 },
  { label: '1-1/2" = 1\'-0"', inchPerFt: 1.5 },
  { label: '3" = 1\'-0"', inchPerFt: 3 },
];

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

export function nearestArchScale(ftPerPx: number): string {
  if (!ftPerPx || ftPerPx <= 0) return "—";
  // inches on paper per real foot, at assumed raster DPI
  const inchPerFt = 1 / (ftPerPx * ASSUMED_DPI);
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

export function formatScaleBadge(ftPerPx: number): string {
  const px = ftPerPx >= 0.01 ? ftPerPx.toFixed(3) : ftPerPx.toFixed(5);
  return `Scale: 1px = ${px} ft (≈${nearestArchScale(ftPerPx)})`;
}

export function isCalibrated(ftPerPx: number | null | undefined): boolean {
  return typeof ftPerPx === "number" && ftPerPx > 0 && Number.isFinite(ftPerPx);
}

/** Pixel distance → feet using sheet scale. */
export function pxToFt(px: number, ftPerPx: number): number {
  return px * ftPerPx;
}
