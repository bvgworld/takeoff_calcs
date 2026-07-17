"use client";

import type { Circuit } from "@/lib/types";
import { circuitHue } from "@/lib/routing";
import { LV_COLORS } from "@/lib/lv-routing";

export function CircuitLegend({
  circuits,
  className = "",
  showLv = true,
}: {
  circuits: Circuit[];
  className?: string;
  showLv?: boolean;
}) {
  const ordered = [...circuits].sort((a, b) => a.number - b.number);
  const lvEntries = showLv
    ? ([
        { key: "dimming", label: "Dimming", color: LV_COLORS.dimming },
        { key: "fire", label: "Fire", color: LV_COLORS.fire },
        { key: "data", label: "Data", color: LV_COLORS.data },
        { key: "stat", label: "T-stat stub", color: LV_COLORS.stat },
      ] as const)
    : [];

  if (!ordered.length && !lvEntries.length) return null;

  return (
    <div
      className={`flex max-w-[calc(100%-18rem)] flex-wrap items-center gap-1.5 ${className}`}
      aria-label="Circuit color legend"
    >
      {ordered.map((c) => (
        <span
          key={c.id}
          className="inline-flex items-center gap-1.5 rounded-md border border-perry-silver bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-perry-industrial shadow-sm"
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: circuitHue(c.number) }}
            aria-hidden
          />
          Ckt {c.number}
        </span>
      ))}
      {lvEntries.map((e) => (
        <span
          key={e.key}
          className="inline-flex items-center gap-1.5 rounded-md border border-perry-silver bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-perry-industrial shadow-sm"
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{
              backgroundColor: e.color,
              backgroundImage:
                e.key !== "stat"
                  ? `repeating-linear-gradient(90deg, ${e.color} 0 3px, transparent 3px 5px)`
                  : undefined,
            }}
            aria-hidden
          />
          {e.label}
        </span>
      ))}
    </div>
  );
}
