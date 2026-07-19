/**
 * Pure gating rules for canvas pointer events.
 *
 * Route/LV polylines carry a wide hitStrokeWidth (14px) so they're easy
 * to grab while editing — but that same width swallowed stamp clicks and
 * circuit-paint clicks anywhere near a drawn route. The fix: the whole
 * routes layer only listens while route editing is live; otherwise Konva
 * hit-testing falls through to the plan image underneath.
 */

export type CanvasStage =
  | "calibrate"
  | "devices"
  | "circuits"
  | "routes"
  | "takeoff";

/** Routes/LV layer takes pointer events only while route editing is live. */
export function routeLayerInteractive(opts: {
  editRoutes: boolean;
  stage: CanvasStage;
}): boolean {
  return opts.editRoutes || opts.stage === "routes";
}

export type ClickTarget = "stage" | "image" | "route-line" | "other";

/** Map a Konva className to a click-target kind for the empty-click gate. */
export function classifyClickTarget(konvaClassName: string): ClickTarget {
  if (konvaClassName === "Stage") return "stage";
  if (konvaClassName === "Image") return "image";
  // Route polylines and HR arrows are the only listening Line/Arrow nodes.
  if (konvaClassName === "Line" || konvaClassName === "Arrow") {
    return "route-line";
  }
  return "other";
}

/**
 * With the routes layer non-listening, a hit that would have been a route
 * line falls through to the image below (Konva skips non-listening nodes).
 */
export function effectiveClickTarget(
  raw: ClickTarget,
  routesInteractive: boolean
): ClickTarget {
  return raw === "route-line" && !routesInteractive ? "image" : raw;
}

/** Stamping / lasso / paint clicks are allowed on empty plan area. */
export function isEmptyClickTarget(t: ClickTarget): boolean {
  return t === "stage" || t === "image";
}
