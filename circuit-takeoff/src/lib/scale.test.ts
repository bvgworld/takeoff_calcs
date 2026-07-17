import { describe, expect, it } from "vitest";
import {
  ARCH_SCALE_PRESETS,
  feetPerPaperInch,
  ftPerPxFromPreset,
} from "./scale";

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
