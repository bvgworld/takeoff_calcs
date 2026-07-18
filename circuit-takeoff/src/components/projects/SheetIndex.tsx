"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import {
  DISCIPLINE_BADGE,
  DISCIPLINE_LABELS,
  groupSheetsByLevel,
  levelLabel,
} from "@/lib/plan-sets";
import type { Discipline, Sheet } from "@/lib/types";

export type SheetCard = Pick<
  Sheet,
  | "id"
  | "name"
  | "discipline"
  | "level"
  | "sort_order"
  | "ft_per_px"
  | "image_w"
  | "image_h"
> & {
  thumbUrl: string | null;
  deviceCount: number;
};

function subgroupKey(s: { level: string; discipline: Discipline }): string {
  return `${s.level.trim()}|${s.discipline}`;
}

export function SheetIndex({
  projectId,
  sheets: initialSheets,
}: {
  projectId: string;
  sheets: SheetCard[];
}) {
  const { showError } = useToast();
  const [sheets, setSheets] = useState(initialSheets);
  const draggedId = useRef<string | null>(null);

  const groups = groupSheetsByLevel(sheets);

  async function persistOrder(next: SheetCard[]) {
    const changed = next.filter((s) => {
      const prev = sheets.find((x) => x.id === s.id);
      return prev && prev.sort_order !== s.sort_order;
    });
    setSheets(next);
    if (!changed.length) return;
    const supabase = createClient();
    for (const s of changed) {
      const { error } = await supabase
        .from("sheets")
        .update({ sort_order: s.sort_order })
        .eq("id", s.id);
      if (error) {
        showError(error.message, () => void persistOrder(next));
        return;
      }
    }
  }

  function dropOn(targetId: string) {
    const fromId = draggedId.current;
    draggedId.current = null;
    if (!fromId || fromId === targetId) return;
    const from = sheets.find((s) => s.id === fromId);
    const target = sheets.find((s) => s.id === targetId);
    if (!from || !target) return;
    // Reorder only within the same level+discipline group.
    if (subgroupKey(from) !== subgroupKey(target)) return;

    // Rebuild the global display order with `from` moved to target's slot,
    // then reassign sort_order 1..N across the whole project.
    const flat = groupSheetsByLevel(sheets).flatMap((g) => g.sheets);
    const without = flat.filter((s) => s.id !== fromId);
    const at = without.findIndex((s) => s.id === targetId);
    without.splice(at, 0, from);
    const next = without.map((s, i) => ({ ...s, sort_order: i + 1 }));
    void persistOrder(next);
  }

  if (!sheets.length) {
    return (
      <div className="rounded-lg border border-dashed border-perry-silver bg-white px-6 py-12 text-center">
        <p className="font-display text-lg text-perry-industrial">
          Upload your plan set
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Upload the whole PDF once, pick the pages that matter, and tag each
          with a discipline and level. Then calibrate, stamp devices, and route
          circuits.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.level || "__none"}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {levelLabel(g.level)}
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {g.sheets.map((s) => (
              <li
                key={s.id}
                draggable
                onDragStart={() => {
                  draggedId.current = s.id;
                }}
                onDragOver={(e) => {
                  const from = sheets.find(
                    (x) => x.id === draggedId.current
                  );
                  if (from && subgroupKey(from) === subgroupKey(s)) {
                    e.preventDefault();
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOn(s.id);
                }}
              >
                <Link
                  href={`/projects/${projectId}/sheets/${s.id}`}
                  className="flex gap-3 rounded-lg border border-perry-silver bg-white p-3 hover:border-perry-blue"
                >
                  <div className="flex h-20 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-perry-white">
                    {s.thumbUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={s.thumbUrl}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] text-gray-400">
                        {s.image_w}×{s.image_h}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate font-semibold text-perry-industrial">
                        {s.name}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${DISCIPLINE_BADGE[s.discipline]}`}
                      >
                        {DISCIPLINE_LABELS[s.discipline]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {s.deviceCount} device{s.deviceCount === 1 ? "" : "s"}
                    </p>
                    <p
                      className={`mt-1 text-[11px] font-medium ${
                        s.ft_per_px && s.ft_per_px > 0
                          ? "text-green-700"
                          : "text-amber-700"
                      }`}
                    >
                      {s.ft_per_px && s.ft_per_px > 0
                        ? "Calibrated"
                        : "Not calibrated"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
