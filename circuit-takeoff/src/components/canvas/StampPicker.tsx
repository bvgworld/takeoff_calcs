"use client";

import { useMemo, useState } from "react";
import {
  STAMP_CATEGORIES,
  catalogByCategory,
  type CatalogCategory,
  type CatalogEntry,
} from "@/lib/catalog";

type Props = {
  activeCatalogId: string | null;
  onPick: (entry: CatalogEntry) => void;
};

export function StampPicker({ activeCatalogId, onPick }: Props) {
  const [openCat, setOpenCat] = useState<CatalogCategory | null>(null);
  const [q, setQ] = useState("");

  const options = useMemo(() => {
    if (!openCat) return [];
    const list = catalogByCategory(openCat);
    const qq = q.trim().toLowerCase();
    if (!qq) return list;
    return list.filter(
      (e) =>
        e.label.toLowerCase().includes(qq) ||
        e.id.toLowerCase().includes(qq)
    );
  }, [openCat, q]);

  return (
    <div className="relative flex flex-wrap items-center gap-1">
      {STAMP_CATEGORIES.map((c) => {
        const active =
          openCat === c.id ||
          (!!activeCatalogId &&
            catalogByCategory(c.id).some((e) => e.id === activeCatalogId));
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setOpenCat((prev) => (prev === c.id ? null : c.id));
              setQ("");
            }}
            className={`rounded-md px-2 py-1 text-xs font-semibold ${
              active
                ? "bg-perry-blue text-white"
                : "bg-perry-white text-perry-industrial hover:bg-perry-silver/30"
            }`}
          >
            {c.label}
          </button>
        );
      })}

      {openCat && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-lg border border-perry-silver bg-white p-2 shadow-lg">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search subtypes…"
            className="mb-2 w-full rounded border border-perry-silver px-2 py-1 text-xs"
          />
          <ul className="max-h-56 overflow-auto">
            {options.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-perry-white ${
                    e.id === activeCatalogId
                      ? "font-semibold text-perry-blue"
                      : "text-perry-industrial"
                  }`}
                  onClick={() => {
                    onPick(e);
                    setOpenCat(null);
                    setQ("");
                  }}
                >
                  {e.label}
                </button>
              </li>
            ))}
            {!options.length && (
              <li className="px-2 py-2 text-xs text-gray-500">No matches</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
