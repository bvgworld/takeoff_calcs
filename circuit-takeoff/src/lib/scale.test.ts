import { describe, expect, it } from "vitest";
import {
  ARCH_SCALE_PRESETS,
  SHORT_BASELINE_PX,
  feetPerPaperInch,
  ftPerPxFromPreset,
  ftPerPxFromTwoPoint,
  isShortBaseline,
  nearestArchScale,
  pxToFt,
  scaleMismatchPct,
} from "./scale";
import {
  planLengthFt,
  polylineLengthPx,
  recomputeRoutePlanLengths,
} from "./routing";
import { buildProjectTakeoff, summarizeTakeoff } from "./takeoff";
import type { Circuit, Device, Route } from "./types";
import { DEFAULT_SETTINGS } from "./types";

describe("ftPerPxFromPreset", () => {
  it("1/8\" = 1'-0\" at 150 DPI is 8/150 ≈ 0.05333", () => {
    const eighth = ARCH_SCALE_PRESETS.find((p) => p.label.includes("1/8"));
    expect(eighth).toBeTruthy();
    expect(feetPerPaperInch(eighth!)).toBe(8);
    const ftPerPx = ftPerPxFromPreset(eighth!, 150);
    expect(ftPerPx).toBeCloseTo(8 / 150, 5);
    expect(ftPerPx).toBeCloseTo(0.05333, 5);
  });

  it("1\" = 20' engineering at 150 DPI is 20/150", () => {
    const ftPerPx = ftPerPxFromPreset(
      { kind: "eng", label: '1" = 20\'', feetPerPaperInch: 20 },
      150
    );
    expect(ftPerPx).toBeCloseTo(20 / 150, 5);
  });
});

describe("px→ft single source of truth", () => {
  it("Measure and planLengthFt both convert via pxToFt", () => {
    const ftPerPx = 0.1;
    const a = { x: 0, y: 0 };
    const b = { x: 50, y: 0 };
    const measurePx = Math.hypot(b.x - a.x, b.y - a.y);
    const measureFt = pxToFt(measurePx, ftPerPx);
    const routeFt = planLengthFt([a, b], ftPerPx);
    expect(routeFt).toBe(measureFt);
    expect(routeFt).toBe(pxToFt(polylineLengthPx([a, b]), ftPerPx));
  });

  it("takeoff length equals path px × latest ft_per_px after preset then two-point", () => {
    const sheetId = "s-scale";
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ];
    const pathPx = polylineLengthPx(path); // 150
    expect(pathPx).toBe(150);

    const circuit: Circuit = {
      id: "c1",
      sheet_id: sheetId,
      panel_device_id: "panel1",
      number: 1,
      ctype: "receptacle",
      voltage: 120,
      breaker_amps: 20,
      entry_device_id: null,
      created_at: "",
    };
    const devices: Device[] = [
      {
        id: "panel1",
        sheet_id: sheetId,
        type: "panel",
        x: 0,
        y: 0,
        attrs: { label: "LP-1" },
        circuit_id: null,
        catalog_id: "panel",
        created_at: "",
      },
      {
        id: "r1",
        sheet_id: sheetId,
        type: "receptacle",
        x: 100,
        y: 50,
        attrs: {},
        circuit_id: "c1",
        catalog_id: "recep-duplex-20",
        created_at: "",
      },
    ];

    let routes: Route[] = [
      {
        id: "hr",
        circuit_id: "c1",
        kind: "homerun",
        path,
        plan_length_ft: 999, // stale on purpose
        user_edited: false,
        created_at: "",
      },
    ];

    const presetFtPerPx = ftPerPxFromPreset(
      ARCH_SCALE_PRESETS.find((p) => p.label.includes("1/8"))!,
      150
    );
    routes = recomputeRoutePlanLengths(routes, presetFtPerPx);
    expect(routes[0].plan_length_ft).toBeCloseTo(pathPx * presetFtPerPx, 8);

    let { lines } = buildProjectTakeoff({
      circuits: [circuit],
      devices,
      routes,
      settings: { ...DEFAULT_SETTINGS, branch_method: "mc" },
      ftPerPxBySheetId: { [sheetId]: presetFtPerPx },
    });
    let summary = summarizeTakeoff(lines, devices);
    // EMT LF = ceil(plan + panel stub) — tracks recomputed plan_length_ft
    const hrWithStubPreset =
      routes[0].plan_length_ft + DEFAULT_SETTINGS.panel_stub_ft;
    expect(summary.emtLf).toBe(Math.ceil(hrWithStubPreset));

    const twoPointFtPerPx = ftPerPxFromTwoPoint(30, 200); // 0.15
    expect(twoPointFtPerPx).toBeCloseTo(0.15, 8);
    routes = recomputeRoutePlanLengths(routes, twoPointFtPerPx);
    expect(routes[0].plan_length_ft).toBeCloseTo(pathPx * twoPointFtPerPx, 8);
    expect(routes[0].plan_length_ft).not.toBeCloseTo(
      pathPx * presetFtPerPx,
      5
    );

    ({ lines } = buildProjectTakeoff({
      circuits: [circuit],
      devices,
      routes,
      settings: { ...DEFAULT_SETTINGS, branch_method: "mc" },
      ftPerPxBySheetId: { [sheetId]: twoPointFtPerPx },
    }));
    summary = summarizeTakeoff(lines, devices);
    const hrWithStubTwo =
      routes[0].plan_length_ft + DEFAULT_SETTINGS.panel_stub_ft;
    expect(summary.emtLf).toBe(Math.ceil(hrWithStubTwo));
  });

  it("short baseline and mismatch helpers", () => {
    expect(isShortBaseline(SHORT_BASELINE_PX - 1)).toBe(true);
    expect(isShortBaseline(SHORT_BASELINE_PX)).toBe(false);
    expect(scaleMismatchPct(0.1, 0.1)).toBeCloseTo(0, 5);
    expect(scaleMismatchPct(0.12, 0.1)).toBeCloseTo(20, 5);
  });
});

describe("nearestArchScale", () => {
  it("ftPerPx = 8/300 at renderDpi 300 → 1/8\", not 1/4\"", () => {
    const ftPerPx = 8 / 300;
    expect(nearestArchScale(ftPerPx, 300)).toBe('1/8" = 1\'-0"');
    // Wrong DPI (legacy 150) would mis-label this as ~1/4"
    expect(nearestArchScale(ftPerPx, 150)).toBe('1/4" = 1\'-0"');
  });
});
