"use client";

import { useState } from "react";
import {
  catalogByCategory,
  STAMP_CATEGORIES,
} from "@/lib/catalog";
import {
  MATCH_THRESHOLD_MAX,
  MATCH_THRESHOLD_MIN,
  type MatchCandidate,
} from "@/lib/symbol-match";

export type SymbolSearchStatus = "matching" | "results" | "error";

export type SymbolSearchView = {
  status: SymbolSearchStatus;
  progress: { done: number; total: number } | null;
  candidates: MatchCandidate[];
  threshold: number;
  error?: string;
};

type Props = {
  search: SymbolSearchView;
  checkedCount: number;
  /** Pre-select the last stamped subtype in the Apply-as picker. */
  lastCatalogId: string;
  applying: boolean;
  onThreshold: (v: number) => void;
  onApply: (catalogId: string) => void;
  onCancel: () => void;
};

/**
 * Floating review panel for "Find similar" template matching. Nothing is
 * ever stamped without this review step — Apply is the only path.
 */
export function SymbolSearchPanel({
  search,
  checkedCount,
  lastCatalogId,
  applying,
  onThreshold,
  onApply,
  onCancel,
}: Props) {
  const [catalogId, setCatalogId] = useState(lastCatalogId);

  return (
    <div className="rounded-lg border border-perry-silver bg-white p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-sm text-perry-industrial">
          Find similar
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-1.5 text-xs font-semibold text-gray-500 hover:bg-perry-silver/30"
        >
          ✕
        </button>
      </div>

      {search.status === "matching" && (
        <div>
          <p className="text-xs text-gray-600">
            Matching 4 rotations × 3 scales…
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-perry-silver/40">
            <div
              className="h-full bg-perry-blue transition-all"
              style={{
                width: search.progress
                  ? `${Math.round((search.progress.done / search.progress.total) * 100)}%`
                  : "5%",
              }}
            />
          </div>
        </div>
      )}

      {search.status === "error" && (
        <p className="text-xs text-perry-signal">
          {search.error || "Matching failed."}
        </p>
      )}

      {search.status === "results" && (
        <div className="space-y-3">
          <p className="text-xs text-gray-600">
            {search.candidates.length} candidate
            {search.candidates.length === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold text-perry-industrial">
              {checkedCount} checked
            </span>
            {search.candidates.length > 0 &&
              " — click a box on the plan to toggle it"}
          </p>

          <label className="block text-xs text-gray-600">
            Confidence threshold{" "}
            <span className="font-semibold tabular-nums text-perry-industrial">
              {search.threshold.toFixed(2)}
            </span>
            <input
              type="range"
              min={MATCH_THRESHOLD_MIN}
              max={MATCH_THRESHOLD_MAX}
              step={0.01}
              value={search.threshold}
              onChange={(e) => onThreshold(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>

          <label className="block text-xs text-gray-600">
            Apply as…
            <select
              value={catalogId}
              onChange={(e) => setCatalogId(e.target.value)}
              className="mt-1 w-full rounded border border-perry-silver px-2 py-1 text-xs"
            >
              {STAMP_CATEGORIES.map((cat) => (
                <optgroup key={cat.id} label={cat.label}>
                  {catalogByCategory(cat.id).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={checkedCount === 0 || applying}
              onClick={() => onApply(catalogId)}
              className="flex-1 rounded-md bg-perry-blue px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {applying
                ? "Stamping…"
                : `Stamp ${checkedCount} device${checkedCount === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md bg-perry-white px-2 py-1.5 text-xs font-semibold text-perry-industrial hover:bg-perry-silver/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
