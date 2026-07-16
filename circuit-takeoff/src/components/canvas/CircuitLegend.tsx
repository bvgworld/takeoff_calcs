"use client";

import type { Circuit } from "@/lib/types";
import { circuitHue } from "@/lib/routing";

export function CircuitLegend({
  circuits,
  className = "",
}: {
  circuits: Circuit[];
  className?: string;
}) {
  if (!circuits.length) return null;
  const ordered = [...circuits].sort((a, b) => a.number - b.number);
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
    </div>
  );
}
