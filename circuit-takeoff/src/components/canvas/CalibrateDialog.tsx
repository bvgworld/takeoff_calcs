"use client";

import { FormEvent, useState } from "react";
import {
  ARCH_SCALE_PRESETS,
  ENG_SCALE_PRESETS,
  SHORT_BASELINE_PX,
  SCALE_MISMATCH_WARN_PCT,
  ftPerPxFromPreset,
  isShortBaseline,
  scaleMismatchPct,
  parseDistanceFt,
  type ScalePreset,
} from "@/lib/scale";
import { Button } from "@/components/ui/Button";

type Props = {
  /** Null when opening for presets / before two points are picked. */
  pixelDistance: number | null;
  renderDpi: number | null;
  /** Current sheet ft_per_px (for preset-vs-current mismatch note). */
  currentFtPerPx: number | null;
  onCancel: () => void;
  onConfirmTwoPoint: (feet: number) => void;
  onConfirmPreset: (ftPerPx: number) => void;
  onPickPoints: () => void;
};

export function CalibrateDialog({
  pixelDistance,
  renderDpi,
  currentFtPerPx,
  onCancel,
  onConfirmTwoPoint,
  onConfirmPreset,
  onPickPoints,
}: Props) {
  const [tab, setTab] = useState<"two-point" | "preset">("two-point");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [presetKey, setPresetKey] = useState(
    `arch:${ARCH_SCALE_PRESETS[2].label}`
  );

  const allPresets: ScalePreset[] = [
    ...ARCH_SCALE_PRESETS,
    ...ENG_SCALE_PRESETS,
  ];

  function selectedPreset(): ScalePreset | undefined {
    return allPresets.find((p) => `${p.kind}:${p.label}` === presetKey);
  }

  let presetFtPerPx: number | null = null;
  if (renderDpi != null && renderDpi > 0) {
    const preset = selectedPreset();
    if (preset) {
      try {
        presetFtPerPx = ftPerPxFromPreset(preset, renderDpi);
      } catch {
        presetFtPerPx = null;
      }
    }
  }

  const mismatchPct =
    presetFtPerPx != null && currentFtPerPx != null
      ? scaleMismatchPct(presetFtPerPx, currentFtPerPx)
      : null;

  function onSubmitTwoPoint(e: FormEvent) {
    e.preventDefault();
    if (pixelDistance == null) {
      setError("Click two points on the plan first.");
      return;
    }
    const ft = parseDistanceFt(raw);
    if (ft == null) {
      setError('Could not parse. Try 25\', 25.5, or 25\'-6".');
      return;
    }
    if (pixelDistance < 1) {
      setError("Points are too close — click farther apart.");
      return;
    }
    onConfirmTwoPoint(ft);
  }

  function onApplyPreset() {
    if (renderDpi == null || !(renderDpi > 0)) return;
    const preset = selectedPreset();
    if (!preset) {
      setError("Choose a scale.");
      return;
    }
    try {
      onConfirmPreset(ftPerPxFromPreset(preset, renderDpi));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid scale");
    }
  }

  const presetsEnabled = renderDpi != null && renderDpi > 0;
  const shortBaseline = isShortBaseline(pixelDistance);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-perry-industrial/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-perry-silver bg-white p-4 shadow-lg">
        <h2 className="font-display text-lg text-perry-industrial">
          Calibrate scale
        </h2>

        <div className="mt-3 flex border-b border-perry-silver">
          <button
            type="button"
            onClick={() => {
              setTab("two-point");
              setError("");
            }}
            className={`flex-1 px-2 py-2 text-xs font-semibold ${
              tab === "two-point"
                ? "border-b-2 border-perry-blue text-perry-blue"
                : "text-gray-500"
            }`}
          >
            Two-point
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("preset");
              setError("");
            }}
            className={`flex-1 px-2 py-2 text-xs font-semibold ${
              tab === "preset"
                ? "border-b-2 border-perry-blue text-perry-blue"
                : "text-gray-500"
            }`}
          >
            Select drawing scale
          </button>
        </div>

        {tab === "two-point" ? (
          <form onSubmit={onSubmitTwoPoint} className="mt-3 space-y-3">
            {pixelDistance == null ? (
              <>
                <p className="text-xs text-gray-600">
                  Click two points on a known dimension on the plan, then enter
                  the real-world distance.
                </p>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={onCancel}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={onPickPoints}>
                    Click points on plan
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-600">
                  Real-world distance between these points (
                  {Math.round(pixelDistance)} px apart).
                </p>
                {shortBaseline && (
                  <p className="text-[11px] leading-snug text-amber-800">
                    Short baseline ({Math.round(pixelDistance)} px &lt;{" "}
                    {SHORT_BASELINE_PX} px) — small click error becomes large
                    scale error. Prefer a longer known dimension when possible.
                  </p>
                )}
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Distance (ft-in or decimal ft)
                  <input
                    autoFocus
                    value={raw}
                    onChange={(e) => {
                      setRaw(e.target.value);
                      setError("");
                    }}
                    placeholder={`25' · 25.5 · 25'-6"`}
                    className="mt-1 w-full rounded-md border border-perry-silver px-3 py-2 text-sm font-normal normal-case text-perry-industrial outline-none focus:outline focus:outline-2 focus:outline-perry-blue"
                  />
                </label>
                {error && (
                  <p className="text-xs text-perry-signal">{error}</p>
                )}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={onCancel}>
                    Cancel
                  </Button>
                  <Button type="submit">Save scale</Button>
                </div>
              </>
            )}
          </form>
        ) : (
          <div className="mt-3 space-y-3">
            {!presetsEnabled ? (
              <p className="text-xs text-perry-signal">
                Re-upload this sheet to enable scale presets.
              </p>
            ) : (
              <>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Drawing scale
                  <select
                    value={presetKey}
                    onChange={(e) => setPresetKey(e.target.value)}
                    className="mt-1 w-full rounded-md border border-perry-silver px-2 py-1.5 text-sm font-normal normal-case"
                  >
                    <optgroup label="Architectural">
                      {ARCH_SCALE_PRESETS.map((p) => (
                        <option key={p.label} value={`arch:${p.label}`}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Engineering">
                      {ENG_SCALE_PRESETS.map((p) => (
                        <option key={p.label} value={`eng:${p.label}`}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                <p className="text-[11px] leading-snug text-amber-800">
                  Preset scales are only accurate if the PDF is true-to-size.
                  Half-size sets are common — verify with the Measure tool
                  against a known dimension.
                </p>
                {mismatchPct != null &&
                  mismatchPct >= SCALE_MISMATCH_WARN_PCT && (
                    <p className="text-[11px] leading-snug text-amber-800">
                      Selected preset differs from the current calibration by{" "}
                      {mismatchPct.toFixed(0)}% (two-point and preset often
                      disagree on half-size or non–true-to-size PDFs). Measure
                      a known dimension to decide which to trust.
                    </p>
                  )}
              </>
            )}
            {error && <p className="text-xs text-perry-signal">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!presetsEnabled}
                onClick={onApplyPreset}
              >
                Apply scale
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
