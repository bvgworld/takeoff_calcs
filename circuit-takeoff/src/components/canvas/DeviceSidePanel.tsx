"use client";

import type { Device } from "@/lib/types";
import { getCatalogEntry } from "@/lib/catalog";
import { resolveCatalogId } from "@/lib/devices";

type Props = {
  selected: Device[];
  onChangeLabel: (label: string) => void;
  onChangeWatts: (watts: number) => void;
  onChangeDimming: (dimming: boolean) => void;
};

export function DeviceSidePanel({
  selected,
  onChangeLabel,
  onChangeWatts,
  onChangeDimming,
}: Props) {
  if (!selected.length) {
    return (
      <p className="text-xs text-gray-500">
        Select a device to edit its label and attributes.
      </p>
    );
  }

  const d = selected[0];
  const entry = getCatalogEntry(resolveCatalogId(d));
  const multi = selected.length > 1;
  const allFixtures = selected.every((x) => x.type === "fixture");

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Catalog
        </p>
        <p className="text-sm font-semibold text-perry-industrial">
          {multi
            ? `${selected.length} devices`
            : entry?.label || d.type}
        </p>
        {!multi && (
          <p className="text-[11px] text-gray-500">{resolveCatalogId(d)}</p>
        )}
      </div>

      {!multi && (
        <label className="block text-[10px] font-semibold uppercase text-gray-500">
          Label
          <input
            value={d.attrs.label || ""}
            onChange={(e) => onChangeLabel(e.target.value)}
            className="mt-0.5 w-full rounded border border-perry-silver px-2 py-1 text-sm font-normal normal-case"
          />
        </label>
      )}

      {allFixtures && (
        <>
          <label className="block text-[10px] font-semibold uppercase text-gray-500">
            Watts
            <input
              type="number"
              min={1}
              value={d.attrs.watts ?? entry?.attrs.watts ?? 36}
              onChange={(e) => onChangeWatts(Number(e.target.value))}
              className="mt-0.5 w-full rounded border border-perry-silver px-2 py-1 text-sm font-normal normal-case"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-perry-industrial">
            <input
              type="checkbox"
              checked={!!d.attrs.dimming}
              onChange={(e) => onChangeDimming(e.target.checked)}
            />
            0-10V dimming (LV run)
          </label>
        </>
      )}
    </div>
  );
}
