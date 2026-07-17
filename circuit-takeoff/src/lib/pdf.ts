/**
 * Client-only PDF helpers (pdfjs-dist).
 * Raster targets ~150 DPI; longest edge capped at 6000px.
 */

const TARGET_DPI = 150;
const MAX_EDGE = 6000;

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

export async function rasterPdfPage(
  file: File,
  pageNumber: number,
  dpi = TARGET_DPI
): Promise<{
  blob: Blob;
  width: number;
  height: number;
  /** Output pixels per PDF inch after the edge cap. */
  renderDpi: number;
}> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
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
