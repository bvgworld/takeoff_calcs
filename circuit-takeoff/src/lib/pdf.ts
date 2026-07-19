/**
 * Client-only PDF helpers (pdfjs-dist).
 * Raster targets 300 DPI; longest edge capped at 12000px.
 * renderDpi is the ACTUAL effective DPI after the cap (for scale presets).
 */

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PageTextItem } from "./sheet-id";

export const TARGET_DPI = 300;
export const MAX_EDGE = 12000;
/** Sharp-zoom tile canvas cap (per side). */
export const SHARP_MAX_EDGE = 4096;
/** Picker-grid thumbnail DPI. */
export const THUMB_DPI = 72;

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  return pdfjs;
}

export async function getPdfPageCount(file: File): Promise<number> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  return doc.numPages;
}

/** Open a PDF document once for multi-page workflows (picker + rasters). */
export async function loadPdfDocument(file: File): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

/** Raster one page of an already-open document (full-res pipeline). */
export async function rasterPdfPageFromDoc(
  doc: PDFDocumentProxy,
  pageNumber: number,
  dpi = TARGET_DPI
): Promise<{
  blob: Blob;
  width: number;
  height: number;
  /** Output pixels per PDF inch after the edge cap. */
  renderDpi: number;
}> {
  const page = await doc.getPage(pageNumber);

  let scale = dpi / 72;
  let viewport = page.getViewport({ scale });
  const longest = Math.max(viewport.width, viewport.height);
  if (longest > MAX_EDGE) {
    scale *= MAX_EDGE / longest;
    viewport = page.getViewport({ scale });
  }

  const renderDpi = scale * 72;

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not get canvas context");

  // Crisp raster — avoid browser downsampling blur on the offscreen canvas
  ctx.imageSmoothingEnabled = false;

  await page.render({
    canvasContext: ctx,
    canvas,
    viewport,
  }).promise;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))),
      "image/png"
    );
  });

  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    renderDpi,
  };
}

export async function rasterPdfPage(
  file: File,
  pageNumber: number,
  dpi = TARGET_DPI
): Promise<{
  blob: Blob;
  width: number;
  height: number;
  renderDpi: number;
}> {
  const doc = await loadPdfDocument(file);
  return rasterPdfPageFromDoc(doc, pageNumber, dpi);
}

/**
 * Extract a page's text items in PDF user space (x from left, y from
 * bottom, h ≈ font size) for sheet-number identification. Scanned pages
 * simply return zero items.
 */
export async function extractPdfPageText(
  doc: PDFDocumentProxy,
  pageNumber: number
): Promise<{ items: PageTextItem[]; pageW: number; pageH: number }> {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: PageTextItem[] = [];
  for (const raw of tc.items as Array<{
    str?: string;
    transform?: number[];
    height?: number;
  }>) {
    if (!raw.str || !raw.str.trim() || !raw.transform) continue;
    const [, , c, d, e, f] = raw.transform;
    items.push({
      str: raw.str,
      x: e,
      yFromBottom: f,
      h: Math.hypot(c, d) || raw.height || 0,
    });
  }
  return { items, pageW: vp.width, pageH: vp.height };
}

/** Low-res page thumbnail (~72 DPI, JPEG data URL) for the picker grid. */
export async function renderPdfThumbnail(
  doc: PDFDocumentProxy,
  pageNumber: number,
  dpi = THUMB_DPI
): Promise<{ dataUrl: string; width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not get canvas context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.75),
    width: canvas.width,
    height: canvas.height,
  };
}

/** Session cache: signed URL → document promise. */
const docCache = new Map<string, Promise<PDFDocumentProxy>>();

export function getCachedPdfDocument(
  url: string
): Promise<PDFDocumentProxy> {
  let p = docCache.get(url);
  if (!p) {
    p = (async () => {
      const pdfjs = await loadPdfjs();
      return pdfjs.getDocument({ url, withCredentials: false }).promise;
    })();
    docCache.set(url, p);
    p.catch(() => {
      docCache.delete(url);
    });
  }
  return p;
}

export function clearPdfDocumentCache(url?: string) {
  if (url) docCache.delete(url);
  else docCache.clear();
}

export type ImageRect = { x: number; y: number; w: number; h: number };

/**
 * Render a region of a PDF page into an offscreen canvas for sharp zoom.
 * Region is in base-raster image pixel space (same coords as devices).
 * Output canvas is capped at SHARP_MAX_EDGE per side.
 */
export async function renderPdfImageRegion(opts: {
  page: PDFPageProxy;
  /** Base raster width/height (sheet image_w / image_h). */
  imageW: number;
  imageH: number;
  region: ImageRect;
  /** Stage zoom (1 = 100%). */
  viewScale: number;
}): Promise<{ canvas: HTMLCanvasElement; region: ImageRect } | null> {
  const { page, imageW, imageH, viewScale } = opts;
  const region = clampRect(opts.region, imageW, imageH);
  if (region.w < 2 || region.h < 2) return null;

  let outW = Math.ceil(region.w * viewScale);
  let outH = Math.ceil(region.h * viewScale);
  const long = Math.max(outW, outH);
  if (long > SHARP_MAX_EDGE) {
    const k = SHARP_MAX_EDGE / long;
    outW = Math.max(1, Math.floor(outW * k));
    outH = Math.max(1, Math.floor(outH * k));
  }

  const baseVp = page.getViewport({ scale: 1 });
  // PDF points → base image pixels
  const sx = imageW / baseVp.width;
  const sy = imageH / baseVp.height;
  // Canvas pixels per PDF point (uniform from X; Y uses matching page mapping)
  const pdfScale = (outW / region.w) * sx;

  const viewport = page.getViewport({ scale: pdfScale });
  const offsetX = -(region.x / sx) * pdfScale;
  const offsetY = -(region.y / sy) * pdfScale;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);

  await page.render({
    canvasContext: ctx,
    canvas,
    viewport,
    transform: [1, 0, 0, 1, offsetX, offsetY],
  }).promise;

  return { canvas, region };
}

function clampRect(r: ImageRect, imageW: number, imageH: number): ImageRect {
  const x = Math.max(0, Math.min(imageW, r.x));
  const y = Math.max(0, Math.min(imageH, r.y));
  const x2 = Math.max(0, Math.min(imageW, r.x + r.w));
  const y2 = Math.max(0, Math.min(imageH, r.y + r.h));
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/**
 * AABB of the stage viewport in unrotated image (content-group local) space.
 */
export function visibleImageRect(opts: {
  stageW: number;
  stageH: number;
  scale: number;
  pos: { x: number; y: number };
  imageW: number;
  imageH: number;
  rotationDeg: number;
  /** Extra margin in image pixels. */
  pad?: number;
}): ImageRect {
  const { stageW, stageH, scale, pos, imageW, imageH, rotationDeg } = opts;
  const pad = opts.pad ?? 32;
  const corners = [
    { x: (0 - pos.x) / scale, y: (0 - pos.y) / scale },
    { x: (stageW - pos.x) / scale, y: (0 - pos.y) / scale },
    { x: (stageW - pos.x) / scale, y: (stageH - pos.y) / scale },
    { x: (0 - pos.x) / scale, y: (stageH - pos.y) / scale },
  ];
  const cx = imageW / 2;
  const cy = imageH / 2;
  const rad = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const locals = corners.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      x: dx * cos - dy * sin + cx,
      y: dx * sin + dy * cos + cy,
    };
  });
  let minX = Math.min(...locals.map((p) => p.x)) - pad;
  let minY = Math.min(...locals.map((p) => p.y)) - pad;
  let maxX = Math.max(...locals.map((p) => p.x)) + pad;
  let maxY = Math.max(...locals.map((p) => p.y)) + pad;
  minX = Math.max(0, minX);
  minY = Math.max(0, minY);
  maxX = Math.min(imageW, maxX);
  maxY = Math.min(imageH, maxY);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
