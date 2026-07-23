import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  candidateCenter,
  downscaleFactor,
  findSymbolMatches,
  matchesToDevices,
  nonMaxSuppression,
  removeBatch,
  resolveCv,
  scaleCandidate,
  validateTemplateRect,
  DEFAULT_MATCH_THRESHOLD,
  type Cv,
  type ImageDataLike,
  type MatchCandidate,
} from "./symbol-match";
import { requireCatalogEntry } from "./catalog";
import type { Device } from "./types";
// The package's CJS export IS a thenable (resolves when the WASM runtime
// is up), which breaks ESM interop — `import` sees a `then` export and
// coerces the module namespace as a promise. createRequire loads the raw
// CJS export instead.
import { createRequire } from "node:module";
const cvReady: unknown = createRequire(import.meta.url)(
  "@techstark/opencv-js"
);

// ————— synthetic fixture: white sheet with a planted symbol —————

/** All-white RGBA image. */
function makeImage(w: number, h: number): ImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  return { data, width: w, height: h };
}

/** 0/1 pixel pattern → black pixels blitted at (x, y). */
function stamp(img: ImageDataLike, pattern: number[][], x: number, y: number) {
  for (let r = 0; r < pattern.length; r++) {
    for (let c = 0; c < pattern[r].length; c++) {
      if (!pattern[r][c]) continue;
      const i = ((y + r) * img.width + (x + c)) * 4;
      img.data[i] = 0;
      img.data[i + 1] = 0;
      img.data[i + 2] = 0;
    }
  }
}

/** Rotate a square pattern 90° clockwise. */
function rot90(p: number[][]): number[][] {
  const n = p.length;
  const out = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) out[c][n - 1 - r] = p[r][c];
  }
  return out;
}

/**
 * The "symbol": 24×24, 2px border + main diagonal + solid block in the
 * top-left corner. Deliberately NOT 90°-symmetric so rotated instances
 * only match the rotated template.
 */
function symbolPattern(size = 24): number[][] {
  const p = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const border = r < 2 || c < 2 || r >= size - 2 || c >= size - 2;
      const diag = Math.abs(r - c) <= 1;
      const block = r >= 4 && r < 10 && c >= 4 && c < 10;
      if (border || diag || block) p[r][c] = 1;
    }
  }
  return p;
}

/** Visually-similar decoy: same border, but a horizontal bar interior. */
function decoyPattern(size = 24): number[][] {
  const p = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const border = r < 2 || c < 2 || r >= size - 2 || c >= size - 2;
      const bar = r >= size / 2 - 1 && r <= size / 2 + 1;
      if (border || bar) p[r][c] = 1;
    }
  }
  return p;
}

const SIZE = 24;
// Template source instance + two upright copies + one 90° copy + decoy.
const TEMPLATE_AT = { x: 60, y: 60 };
const UPRIGHT_AT = [
  { x: 200, y: 300 },
  { x: 420, y: 120 },
];
const ROTATED_AT = { x: 300, y: 400 };
const DECOY_AT = { x: 500, y: 300 };
const TEMPLATE_RECT = { x: TEMPLATE_AT.x, y: TEMPLATE_AT.y, w: SIZE, h: SIZE };

function buildFixture(): ImageDataLike {
  const img = makeImage(640, 480);
  const sym = symbolPattern(SIZE);
  stamp(img, sym, TEMPLATE_AT.x, TEMPLATE_AT.y);
  for (const at of UPRIGHT_AT) stamp(img, sym, at.x, at.y);
  stamp(img, rot90(sym), ROTATED_AT.x, ROTATED_AT.y);
  stamp(img, decoyPattern(SIZE), DECOY_AT.x, DECOY_AT.y);
  return img;
}

function near(c: MatchCandidate, at: { x: number; y: number }, tol = 3) {
  const center = candidateCenter(c);
  return (
    Math.abs(center.x - (at.x + SIZE / 2)) <= tol &&
    Math.abs(center.y - (at.y + SIZE / 2)) <= tol
  );
}

let cv: Cv;
let candidates: MatchCandidate[];

beforeAll(async () => {
  cv = await resolveCv(cvReady);
  candidates = await findSymbolMatches(cv, buildFixture(), TEMPLATE_RECT);
}, 60_000);

describe("findSymbolMatches on the synthetic fixture", () => {
  it("finds every planted instance at ≥ 0.85", () => {
    for (const at of [...UPRIGHT_AT, ROTATED_AT]) {
      const hit = candidates.find((c) => near(c, at));
      expect(hit, `instance at ${at.x},${at.y}`).toBeDefined();
      expect(hit!.confidence).toBeGreaterThanOrEqual(DEFAULT_MATCH_THRESHOLD);
    }
  });

  it("finds the rotated instance via the rotated template", () => {
    const hit = candidates.find((c) => near(c, ROTATED_AT));
    expect(hit).toBeDefined();
    expect(hit!.rotation).not.toBe(0);
  });

  it("scores the decoy lower than every true match", () => {
    const decoy = candidates.find((c) => near(c, DECOY_AT, 6));
    const trueConfs = [...UPRIGHT_AT, ROTATED_AT].map(
      (at) => candidates.find((c) => near(c, at))!.confidence
    );
    const minTrue = Math.min(...trueConfs);
    if (decoy) {
      expect(decoy.confidence).toBeLessThan(minTrue);
      expect(decoy.confidence).toBeLessThan(DEFAULT_MATCH_THRESHOLD);
    }
    // If the decoy didn't clear the 0.5 collection floor at all, it
    // trivially scored lower — nothing more to assert.
  });

  it("NMS returns exactly one candidate per planted instance", () => {
    for (const at of [...UPRIGHT_AT, ROTATED_AT]) {
      const hits = candidates.filter((c) => near(c, at, 6));
      expect(hits.length, `instance at ${at.x},${at.y}`).toBe(1);
    }
  });

  it("excludes the template's own location", () => {
    const own = candidates.find((c) => near(c, TEMPLATE_AT, 6));
    expect(own).toBeUndefined();
  });

  it("reports progress for every rotation × scale pass", async () => {
    const seen: number[] = [];
    await findSymbolMatches(cv, buildFixture(), TEMPLATE_RECT, {
      onProgress: (done, total) => {
        seen.push(done);
        expect(total).toBe(12);
      },
    });
    expect(seen.length).toBe(12);
    expect(seen[seen.length - 1]).toBe(12);
  });
});

describe("nonMaxSuppression", () => {
  it("collapses overlapping boxes to the highest-confidence one", () => {
    const boxes = [
      { x: 100, y: 100, w: 20, h: 20, confidence: 0.9 },
      { x: 102, y: 101, w: 20, h: 20, confidence: 0.95 },
      { x: 99, y: 99, w: 20, h: 20, confidence: 0.85 },
      { x: 300, y: 300, w: 20, h: 20, confidence: 0.7 },
    ];
    const kept = nonMaxSuppression(boxes);
    expect(kept.length).toBe(2);
    expect(kept[0].confidence).toBe(0.95);
    expect(kept.some((k) => k.x === 300)).toBe(true);
  });

  it("keeps non-overlapping boxes untouched", () => {
    const boxes = [
      { x: 0, y: 0, w: 10, h: 10, confidence: 0.6 },
      { x: 50, y: 50, w: 10, h: 10, confidence: 0.8 },
    ];
    expect(nonMaxSuppression(boxes).length).toBe(2);
  });
});

describe("template rect validation", () => {
  it("rejects rects over 200px with a helpful message", () => {
    const err = validateTemplateRect({ x: 0, y: 0, w: 250, h: 80 });
    expect(err).toMatch(/too large/i);
    expect(err).toMatch(/200×200/);
  });

  it("rejects tiny rects", () => {
    expect(validateTemplateRect({ x: 0, y: 0, w: 4, h: 4 })).toMatch(
      /too small/i
    );
  });

  it("accepts a reasonable symbol box", () => {
    expect(validateTemplateRect({ x: 10, y: 10, w: 60, h: 60 })).toBeNull();
  });
});

describe("downscale + coordinate scale-back", () => {
  it("downscaleFactor caps the long edge at 4000", () => {
    expect(downscaleFactor(3000, 2000)).toBe(1);
    expect(downscaleFactor(8000, 6000)).toBe(0.5);
    expect(downscaleFactor(2000, 10000)).toBe(0.4);
  });

  it("scaleCandidate maps matched coords back to full-res", () => {
    const c: MatchCandidate = {
      id: "m0",
      x: 100,
      y: 200,
      w: 24,
      h: 24,
      confidence: 0.9,
      rotation: 0,
      scale: 1,
    };
    const up = scaleCandidate(c, 2);
    expect(up.x).toBe(200);
    expect(up.y).toBe(400);
    expect(up.w).toBe(48);
    expect(candidateCenter(up)).toEqual({ x: 224, y: 424 });
    expect(up.confidence).toBe(0.9);
  });
});

describe("apply + batch undo", () => {
  const entry = requireCatalogEntry("recep-duplex-20");

  const cands: MatchCandidate[] = [
    { id: "m0", x: 100, y: 100, w: 24, h: 24, confidence: 0.97, rotation: 0, scale: 1 },
    { id: "m1", x: 340, y: 220, w: 24, h: 24, confidence: 0.88, rotation: 90, scale: 1 },
  ];

  it("creates devices at candidate centers with source and confidence", () => {
    const devices = matchesToDevices(cands, entry, "sheet-1", []);
    expect(devices.length).toBe(2);
    expect(devices[0].x).toBe(112);
    expect(devices[0].y).toBe(112);
    expect(devices[1].x).toBe(352);
    expect(devices[1].y).toBe(232);
    devices.forEach((d, i) => {
      expect(d.source).toBe("template_match");
      expect(d.confidence).toBe(cands[i].confidence);
      expect(d.sheet_id).toBe("sheet-1");
      expect(d.type).toBe("receptacle");
      expect(d.catalog_id).toBe("recep-duplex-20");
      expect(d.circuit_id).toBeNull();
    });
  });

  it("sequences auto-labels across the batch (JB-1, JB-2, …)", () => {
    const jbox = requireCatalogEntry("jbox-4sq");
    const devices = matchesToDevices(cands, jbox, "sheet-1", []);
    expect(devices[0].attrs.label).toBe("JB-1");
    expect(devices[1].attrs.label).toBe("JB-2");
  });

  it("batch undo removes all — and only — the batch", () => {
    const existing: Device[] = [
      {
        id: "keep-1",
        sheet_id: "sheet-1",
        type: "receptacle",
        catalog_id: "recep-duplex-20",
        x: 5,
        y: 5,
        attrs: {},
        circuit_id: null,
        created_at: new Date().toISOString(),
      },
    ];
    const batch = matchesToDevices(cands, entry, "sheet-1", existing);
    const all = [...existing, ...batch];
    const after = removeBatch(all, batch.map((d) => d.id));
    expect(after.length).toBe(1);
    expect(after[0].id).toBe("keep-1");
  });
});

describe("migration 014", () => {
  const sql = readFileSync(
    path.resolve(__dirname, "../../supabase/migrations/014_device_source.sql"),
    "utf8"
  );

  it("adds source (default manual) and confidence columns to devices", () => {
    expect(sql).toMatch(
      /alter table devices add column if not exists source text not null default 'manual'/
    );
    expect(sql).toMatch(/check \(source in \('manual', 'template_match'\)\)/);
    expect(sql).toMatch(
      /alter table devices add column if not exists confidence numeric/
    );
  });

  it("registers itself in schema_migrations", () => {
    expect(sql).toContain("insert into schema_migrations");
    expect(sql).toContain("014_device_source.sql");
  });
});
