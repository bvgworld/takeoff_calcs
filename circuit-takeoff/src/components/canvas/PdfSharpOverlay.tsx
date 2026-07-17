"use client";

/**
 * Display-only PDF sharp-zoom tile. Never participates in hit-testing or
 * coordinate math. Lives inside the same rotated content Group as the base raster.
 */

import { useEffect, useRef, useState } from "react";
import { Image as KonvaImage } from "react-konva";
import {
  clearPdfDocumentCache,
  getCachedPdfDocument,
  renderPdfImageRegion,
  visibleImageRect,
  type ImageRect,
} from "@/lib/pdf";

const SETTLE_MS = 300;
const ZOOM_THRESHOLD = 1.5;

type Props = {
  pdfUrl: string | null;
  pdfPage: number;
  imageW: number;
  imageH: number;
  scale: number;
  pos: { x: number; y: number };
  stageW: number;
  stageH: number;
  rotationDeg: number;
  /** True while wheel-zooming, stage-dragging, or mid-button pan. */
  viewMoving: boolean;
};

export function PdfSharpOverlay({
  pdfUrl,
  pdfPage,
  imageW,
  imageH,
  scale,
  pos,
  stageW,
  stageH,
  rotationDeg,
  viewMoving,
}: Props) {
  const [tile, setTile] = useState<{
    image: HTMLCanvasElement;
    region: ImageRect;
  } | null>(null);
  const [opacity, setOpacity] = useState(0);
  const genRef = useRef(0);
  const warnedRef = useRef(false);

  // Drop cache when URL changes / unmount
  useEffect(() => {
    return () => {
      if (pdfUrl) clearPdfDocumentCache(pdfUrl);
    };
  }, [pdfUrl]);

  useEffect(() => {
    if (!pdfUrl || scale <= ZOOM_THRESHOLD || viewMoving) {
      setOpacity(0);
      if (scale <= ZOOM_THRESHOLD) setTile(null);
      return;
    }

    setOpacity(0);
    const gen = ++genRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const region = visibleImageRect({
            stageW,
            stageH,
            scale,
            pos,
            imageW,
            imageH,
            rotationDeg,
          });
          if (region.w < 4 || region.h < 4) return;

          const doc = await getCachedPdfDocument(pdfUrl);
          if (gen !== genRef.current) return;
          const page = await doc.getPage(pdfPage);
          if (gen !== genRef.current) return;

          const result = await renderPdfImageRegion({
            page,
            imageW,
            imageH,
            region,
            viewScale: scale,
          });
          if (gen !== genRef.current || !result) return;

          setTile({ image: result.canvas, region: result.region });
          // Fade in next frame
          requestAnimationFrame(() => {
            if (gen === genRef.current) setOpacity(1);
          });
        } catch (err) {
          if (!warnedRef.current) {
            warnedRef.current = true;
            console.warn("[PdfSharpOverlay] falling back to raster", err);
          }
          setTile(null);
          setOpacity(0);
        }
      })();
    }, SETTLE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    pdfUrl,
    pdfPage,
    imageW,
    imageH,
    scale,
    pos,
    stageW,
    stageH,
    rotationDeg,
    viewMoving,
  ]);

  if (!tile || scale <= ZOOM_THRESHOLD) return null;

  return (
    <KonvaImage
      image={tile.image}
      x={tile.region.x}
      y={tile.region.y}
      width={tile.region.w}
      height={tile.region.h}
      listening={false}
      perfectDrawEnabled={false}
      imageSmoothingEnabled={false}
      opacity={opacity}
    />
  );
}
