"use client";

import type { Device } from "@/lib/types";

type Props = {
  selected: Device[];
  onChangeLabel: (label: string) => void;
  onChangeWatts: (watts: number) => void;
};

export function DeviceSidePanel({
  selected,
  onChangeLabel,
  onChangeWatts,
}: Props) {
  if (selected.length === 0) {
    return (
      <aside className="absolute bottom-0 right-0 top-0 z-20 w-64 border-l border-perry-silver bg-white p-4 shadow-sm">
        <h2 className="font-display text-sm text-perry-industrial">Selection</h2>
        <p className="mt-3 text-xs text-gray-500">
          Click a device to select. Shift-click to multi-select. Drag to move.
          Delete key removes.
        </p>
      </aside>
    );
  }

  const types = Array.from(new Set(selected.map((d) => d.type)));
  const allFixtures = selected.every((d) => d.type === "fixture");
  const sameLabel = selected.every(
    (d) => (d.attrs.label || "") === (selected[0].attrs.label || "")
  );
  const labelValue = sameLabel ? selected[0].attrs.label || "" : "";
  const sameWatts = selected.every(
    (d) => (d.attrs.watts ?? 36) === (selected[0].attrs.watts ?? 36)
  );
  const wattsValue = sameWatts ? String(selected[0].attrs.watts ?? 36) : "";

  return (
    <aside className="absolute bottom-0 right-0 top-0 z-20 w-64 overflow-auto border-l border-perry-silver bg-white p-4 shadow-sm">
      <h2 className="font-display text-sm text-perry-industrial">Selection</h2>
      <p className="mt-1 text-xs text-gray-500">
        {selected.length > 1
          ? `${selected.length} devices`
          : types[0]}
      </p>

      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-gray-500">
        Type
        <div className="mt-1 text-sm font-normal normal-case text-perry-industrial">
          {types.join(", ")}
          {selected.length > 1 ? ` · ${selected.length}` : ""}
        </div>
      </label>

      <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-gray-500">
        Label
        <input
          value={labelValue}
          placeholder={sameLabel ? "" : "(mixed)"}
          onChange={(e) => onChangeLabel(e.target.value)}
          className="mt-1 w-full rounded-md border border-perry-silver px-2 py-1.5 text-sm font-normal normal-case"
        />
      </label>

      {allFixtures && (
        <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-gray-500">
          Watts
          <input
            type="number"
            min={1}
            max={2000}
            value={wattsValue}
            placeholder={sameWatts ? "" : "(mixed)"}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) onChangeWatts(n);
            }}
            className="mt-1 w-full rounded-md border border-perry-silver px-2 py-1.5 text-sm font-normal normal-case"
          />
        </label>
      )}
    </aside>
  );
}
