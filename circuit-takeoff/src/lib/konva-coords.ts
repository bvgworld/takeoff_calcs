import type Konva from "konva";

export type XY = { x: number; y: number };

/**
 * Stage pointer → local coords of `node` (inverses full absolute transform,
 * including ancestors' rotation/scale/pan).
 */
export function pointerInNodeLocal(node: Konva.Node): XY | null {
  const stage = node.getStage();
  const pointer = stage?.getPointerPosition();
  if (!pointer) return null;
  return node.getAbsoluteTransform().copy().invert().point(pointer);
}

/** Stage pointer → local coords of a node's parent (for dragged children). */
export function pointerInParentLocal(node: Konva.Node): XY | null {
  const parent = node.getParent();
  if (!parent) return null;
  return pointerInNodeLocal(parent);
}
