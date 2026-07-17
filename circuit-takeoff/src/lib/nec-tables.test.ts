import { describe, expect, it } from "vitest";
import {
  EMT_FILL_40,
  THHN_AREA,
  AMPACITY_75_CAPPED,
  AMPACITY_90_THHN,
  deratingMultiplier,
} from "./nec-tables";

describe("nec-tables exact values", () => {
  it("EMT 40% fill areas (Table 4)", () => {
    expect(EMT_FILL_40['1/2"']).toBe(0.122);
    expect(EMT_FILL_40['3/4"']).toBe(0.213);
    expect(EMT_FILL_40['1"']).toBe(0.346);
    expect(EMT_FILL_40['1-1/4"']).toBe(0.598);
    expect(EMT_FILL_40['1-1/2"']).toBe(0.814);
    expect(EMT_FILL_40['2"']).toBe(1.342);
    expect(EMT_FILL_40['2-1/2"']).toBe(2.343);
    expect(EMT_FILL_40['3"']).toBe(3.538);
    expect(EMT_FILL_40['4"']).toBe(5.901);
  });

  it("THHN areas (Table 5)", () => {
    expect(THHN_AREA["14"]).toBe(0.0097);
    expect(THHN_AREA["12"]).toBe(0.0133);
    expect(THHN_AREA["10"]).toBe(0.0211);
    expect(THHN_AREA["8"]).toBe(0.0366);
    expect(THHN_AREA["6"]).toBe(0.0507);
    expect(THHN_AREA["4"]).toBe(0.0824);
    expect(THHN_AREA["3"]).toBe(0.0973);
    expect(THHN_AREA["2"]).toBe(0.1158);
    expect(THHN_AREA["1"]).toBe(0.1562);
    expect(THHN_AREA["1/0"]).toBe(0.1855);
    expect(THHN_AREA["2/0"]).toBe(0.2223);
    expect(THHN_AREA["3/0"]).toBe(0.2679);
    expect(THHN_AREA["4/0"]).toBe(0.3237);
  });

  it("copper ampacity 75°C with 240.4(D) caps", () => {
    expect(AMPACITY_75_CAPPED["14"]).toBe(15);
    expect(AMPACITY_75_CAPPED["12"]).toBe(20);
    expect(AMPACITY_75_CAPPED["10"]).toBe(30);
    expect(AMPACITY_75_CAPPED["8"]).toBe(50);
    expect(AMPACITY_75_CAPPED["6"]).toBe(65);
    expect(AMPACITY_75_CAPPED["4"]).toBe(85);
    expect(AMPACITY_75_CAPPED["3"]).toBe(100);
    expect(AMPACITY_75_CAPPED["2"]).toBe(115);
    expect(AMPACITY_75_CAPPED["1"]).toBe(130);
    expect(AMPACITY_75_CAPPED["1/0"]).toBe(150);
    expect(AMPACITY_75_CAPPED["2/0"]).toBe(175);
    expect(AMPACITY_75_CAPPED["3/0"]).toBe(200);
    expect(AMPACITY_75_CAPPED["4/0"]).toBe(230);
  });

  it("90°C THHN column + derating multipliers", () => {
    expect(AMPACITY_90_THHN["14"]).toBe(25);
    expect(AMPACITY_90_THHN["12"]).toBe(30);
    expect(AMPACITY_90_THHN["10"]).toBe(40);
    expect(AMPACITY_90_THHN["8"]).toBe(55);
    expect(AMPACITY_90_THHN["6"]).toBe(75);
    expect(AMPACITY_90_THHN["4"]).toBe(95);
    expect(deratingMultiplier(3)).toBe(1);
    expect(deratingMultiplier(4)).toBe(0.8);
    expect(deratingMultiplier(6)).toBe(0.8);
    expect(deratingMultiplier(7)).toBe(0.7);
    expect(deratingMultiplier(9)).toBe(0.7);
    expect(deratingMultiplier(10)).toBe(0.5);
    expect(deratingMultiplier(20)).toBe(0.5);
  });
});
