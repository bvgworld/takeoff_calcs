/**
 * Web Worker for symbol template matching. Loads opencv.js (WASM) lazily
 * on first message — the ~10 MB chunk is only ever fetched when the user
 * enters symbol search, and matching never blocks the main thread.
 */

import {
  findSymbolMatches,
  resolveCv,
  scaleCandidate,
  type Cv,
  type ImageDataLike,
  type MatchCandidate,
  type Rect,
} from "@/lib/symbol-match";
// Static import is safe here: this whole file is a worker chunk that the
// browser only fetches when the user enters symbol search, so opencv.js
// (WASM, ~10 MB) never loads on normal page views. The package default-
// exports a thenable that resolves once the WASM runtime initializes;
// dynamic import() would mis-coerce it during module-namespace interop.
import cvReady from "@techstark/opencv-js";

export type SymbolMatchRequest = {
  type: "match";
  image: ImageDataLike;
  /** Template rect in the same (possibly downscaled) space as `image`. */
  templateRect: Rect;
  /** Multiply result coords by this to get full-res raster pixels. */
  coordScale: number;
};

export type SymbolMatchResponse =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; candidates: MatchCandidate[] }
  | { type: "error"; message: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SymbolMatchRequest>) => void) | null;
  postMessage: (msg: SymbolMatchResponse) => void;
};

let cvPromise: Promise<Cv> | null = null;

function loadCv(): Promise<Cv> {
  if (!cvPromise) cvPromise = resolveCv(cvReady);
  return cvPromise;
}

ctx.onmessage = async (e: MessageEvent<SymbolMatchRequest>) => {
  const msg = e.data;
  if (msg.type !== "match") return;
  try {
    const cv = await loadCv();
    const candidates = await findSymbolMatches(
      cv,
      msg.image,
      msg.templateRect,
      {
        onProgress: (done, total) =>
          ctx.postMessage({ type: "progress", done, total }),
      }
    );
    ctx.postMessage({
      type: "result",
      candidates: candidates.map((c) => scaleCandidate(c, msg.coordScale)),
    });
  } catch (err) {
    ctx.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
