"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import useImage from "./use-image";

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

type Props = {
  imageUrl: string;
  imageW: number;
  imageH: number;
  title?: string;
  backHref?: string;
};

export function SheetViewer({
  imageUrl,
  imageW,
  imageH,
  title,
  backHref,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const image = useImage(imageUrl);
  const midPan = useRef<{
    active: boolean;
    lastX: number;
    lastY: number;
  }>({ active: false, lastX: 0, lastY: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Block browser autoscroll on middle-click
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const block = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    el.addEventListener("mousedown", block);
    el.addEventListener("auxclick", block);
    return () => {
      el.removeEventListener("mousedown", block);
      el.removeEventListener("auxclick", block);
    };
  }, []);

  const fitToScreen = useCallback(() => {
    if (!size.w || !size.h || !imageW || !imageH) return;
    const pad = 24;
    const s = Math.min(
      (size.w - pad) / imageW,
      (size.h - pad) / imageH,
      MAX_SCALE
    );
    const clamped = Math.max(MIN_SCALE, s);
    setScale(clamped);
    setPos({
      x: (size.w - imageW * clamped) / 2,
      y: (size.h - imageH * clamped) / 2,
    });
  }, [size.w, size.h, imageW, imageH]);

  useEffect(() => {
    if (image && size.w > 0) fitToScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, imageW, imageH, size.w, size.h]);

  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.08;
    const newScale = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy
      )
    );

    const mousePointTo = {
      x: (pointer.x - pos.x) / oldScale,
      y: (pointer.y - pos.y) / oldScale,
    };
    setScale(newScale);
    setPos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }

  function onMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.evt.button === 1) {
      e.evt.preventDefault();
      midPan.current = {
        active: true,
        lastX: e.evt.clientX,
        lastY: e.evt.clientY,
      };
      const stage = stageRef.current;
      if (stage) stage.draggable(false);
      if (stage) stage.container().style.cursor = "grabbing";
    }
  }

  function onMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!midPan.current.active) return;
    const dx = e.evt.clientX - midPan.current.lastX;
    const dy = e.evt.clientY - midPan.current.lastY;
    midPan.current.lastX = e.evt.clientX;
    midPan.current.lastY = e.evt.clientY;
    setPos((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  function onMouseUp() {
    if (!midPan.current.active) return;
    midPan.current.active = false;
    const stage = stageRef.current;
    if (stage) {
      stage.draggable(true);
      stage.container().style.cursor = "grab";
    }
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#E8EAF0]">
      {title && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[60%] truncate font-display text-sm text-perry-industrial">
          {title}
        </div>
      )}

      <div className="absolute left-3 top-12 z-20 flex items-center gap-2 rounded-lg border border-perry-silver bg-white px-3 py-2 shadow-sm">
        {backHref && (
          <a
            href={backHref}
            className="text-xs font-medium text-perry-blue hover:underline"
          >
            ← Back
          </a>
        )}
        <span className="min-w-[3.5rem] text-xs font-semibold tabular-nums text-perry-industrial">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={fitToScreen}
          className="rounded-md bg-perry-white px-2 py-1 text-xs font-semibold text-perry-industrial hover:bg-perry-silver/30"
        >
          Fit
        </button>
      </div>

      <div ref={containerRef} className="absolute inset-0 cursor-grab">
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h}
          scaleX={scale}
          scaleY={scale}
          x={pos.x}
          y={pos.y}
          draggable
          pixelRatio={1}
          onDragEnd={(e) => {
            setPos({ x: e.target.x(), y: e.target.y() });
          }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          perfectDrawEnabled={false}
        >
          <Layer listening={false} perfectDrawEnabled={false}>
            {image && (
              <KonvaImage
                image={image}
                width={imageW}
                height={imageH}
                listening={false}
                perfectDrawEnabled={false}
                imageSmoothingEnabled={scale < 1}
              />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
