"use client";

import { FormEvent, useState } from "react";
import { parseDistanceFt } from "@/lib/scale";
import { Button } from "@/components/ui/Button";

type Props = {
  pixelDistance: number;
  onCancel: () => void;
  onConfirm: (feet: number) => void;
};

export function CalibrateDialog({
  pixelDistance,
  onCancel,
  onConfirm,
}: Props) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ft = parseDistanceFt(raw);
    if (ft == null) {
      setError('Could not parse. Try 25\', 25.5, or 25\'-6".');
      return;
    }
    if (pixelDistance < 1) {
      setError("Points are too close — click farther apart.");
      return;
    }
    onConfirm(ft);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-perry-industrial/40 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-perry-silver bg-white p-4 shadow-lg"
      >
        <h2 className="font-display text-lg text-perry-industrial">
          Calibrate scale
        </h2>
        <p className="mt-1 text-xs text-gray-600">
          Real-world distance between these points ({Math.round(pixelDistance)}{" "}
          px apart).
        </p>
        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-gray-500">
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
          <p className="mt-2 text-xs text-perry-signal">{error}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Save scale</Button>
        </div>
      </form>
    </div>
  );
}
