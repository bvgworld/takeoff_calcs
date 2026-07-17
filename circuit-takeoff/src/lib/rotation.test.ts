import { describe, expect, it } from "vitest";
import {
  fitSizeForRotation,
  normalizeRotation,
  rotateStep,
} from "./rotation";

describe("rotation", () => {
  it("normalizeRotation snaps to 0/90/180/270", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(270)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(-90)).toBe(270);
  });

  it("rotateStep round-trips after four steps", () => {
    let r = normalizeRotation(0);
    for (let i = 0; i < 4; i++) r = rotateStep(r, 1);
    expect(r).toBe(0);
    r = 90;
    for (let i = 0; i < 4; i++) r = rotateStep(r, -1);
    expect(r).toBe(90);
  });

  it("fitSizeForRotation swaps at 90/270", () => {
    expect(fitSizeForRotation(1000, 500, 0)).toEqual({ w: 1000, h: 500 });
    expect(fitSizeForRotation(1000, 500, 180)).toEqual({ w: 1000, h: 500 });
    expect(fitSizeForRotation(1000, 500, 90)).toEqual({ w: 500, h: 1000 });
    expect(fitSizeForRotation(1000, 500, 270)).toEqual({ w: 500, h: 1000 });
  });
});
