import { describe, expect, it } from "vitest";
import {
  classifyClickTarget,
  effectiveClickTarget,
  isEmptyClickTarget,
  routeLayerInteractive,
} from "./canvas-gates";

describe("route layer listening gate", () => {
  it("is OFF while stamping/painting (devices & circuits stages)", () => {
    expect(
      routeLayerInteractive({ editRoutes: false, stage: "devices" })
    ).toBe(false);
    expect(
      routeLayerInteractive({ editRoutes: false, stage: "circuits" })
    ).toBe(false);
    expect(
      routeLayerInteractive({ editRoutes: false, stage: "calibrate" })
    ).toBe(false);
    expect(
      routeLayerInteractive({ editRoutes: false, stage: "takeoff" })
    ).toBe(false);
  });

  it("is ON in the Routes stage and whenever Edit routes is active", () => {
    expect(routeLayerInteractive({ editRoutes: false, stage: "routes" })).toBe(
      true
    );
    expect(routeLayerInteractive({ editRoutes: true, stage: "devices" })).toBe(
      true
    );
  });
});

describe("stamp click-through over drawn routes", () => {
  it("a stamp click whose Konva target would be the route Line still stamps", () => {
    // With a route drawn, the raw hit under the cursor is the route Line
    // (14px hitStrokeWidth) — but the layer is non-listening while
    // stamping, so Konva resolves the hit to the plan image beneath.
    const routesInteractive = routeLayerInteractive({
      editRoutes: false,
      stage: "devices", // stamping arms the Devices stage
    });
    const raw = classifyClickTarget("Line");
    expect(raw).toBe("route-line");
    const effective = effectiveClickTarget(raw, routesInteractive);
    expect(effective).toBe("image");
    expect(isEmptyClickTarget(effective)).toBe(true); // → stampAt() fires
  });

  it("circuit-paint clicks pass through routes the same way", () => {
    const routesInteractive = routeLayerInteractive({
      editRoutes: false,
      stage: "circuits",
    });
    expect(
      isEmptyClickTarget(
        effectiveClickTarget(classifyClickTarget("Arrow"), routesInteractive)
      )
    ).toBe(true);
  });

  it("route lines still take clicks while route editing is live", () => {
    const routesInteractive = routeLayerInteractive({
      editRoutes: true,
      stage: "routes",
    });
    const effective = effectiveClickTarget(
      classifyClickTarget("Line"),
      routesInteractive
    );
    expect(effective).toBe("route-line");
    expect(isEmptyClickTarget(effective)).toBe(false); // selects the route
  });
});
