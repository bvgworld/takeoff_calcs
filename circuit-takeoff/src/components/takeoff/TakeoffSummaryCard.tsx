"use client";

import type { TakeoffSummary } from "@/lib/takeoff";

export function TakeoffSummaryCard({ summary }: { summary: TakeoffSummary }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-lg border border-perry-silver bg-white/95 px-3 py-2 shadow-sm">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        Takeoff
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-perry-industrial">
        <span>
          <span className="font-semibold">{summary.emtLf}</span> EMT LF
        </span>
        <span>
          <span className="font-semibold">{summary.mcLf}</span> MC LF
        </span>
        <span>
          <span className="font-semibold">{summary.wireLf}</span> wire LF
        </span>
        <span>
          <span className="font-semibold">{summary.deviceCount}</span> devices
        </span>
      </div>
    </div>
  );
}
