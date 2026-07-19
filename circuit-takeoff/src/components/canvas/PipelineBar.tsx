"use client";

/**
 * Process-flow step bar: Calibrate → Devices → Circuits → Routes → Takeoff.
 * Pure orientation — clicking a step focuses its stage UI; blocked steps
 * carry a reason. No routing/takeoff logic lives here.
 */

export type PipelineStage =
  | "calibrate"
  | "devices"
  | "circuits"
  | "routes"
  | "takeoff";

export type PipelineStep = {
  id: PipelineStage;
  label: string;
  done: boolean;
  /** Reason the step can't be worked yet, or null when available. */
  blocked: string | null;
};

export function PipelineBar({
  steps,
  active,
  onSelect,
}: {
  steps: PipelineStep[];
  active: PipelineStage;
  onSelect: (stage: PipelineStage) => void;
}) {
  return (
    <div className="absolute inset-x-0 top-0 z-30 flex h-9 items-center justify-center gap-1 border-b border-perry-silver bg-white/95 px-3 shadow-sm">
      {steps.map((s, i) => {
        const isActive = s.id === active;
        const blocked = !!s.blocked && !s.done;
        return (
          <span key={s.id} className="flex items-center gap-1">
            {i > 0 && <span className="text-xs text-perry-silver">→</span>}
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              title={blocked ? s.blocked ?? undefined : s.label}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                isActive
                  ? "bg-perry-blue text-white"
                  : blocked
                    ? "text-gray-400"
                    : "text-perry-industrial hover:bg-perry-white"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  s.done
                    ? "bg-green-600 text-white"
                    : isActive
                      ? "bg-white/25 text-white"
                      : blocked
                        ? "bg-gray-200 text-gray-400"
                        : "bg-perry-silver/50 text-perry-industrial"
                }`}
              >
                {s.done ? "✓" : i + 1}
              </span>
              {s.label}
              {blocked && (
                <span className="hidden text-[10px] font-normal text-gray-400 lg:inline">
                  · {s.blocked}
                </span>
              )}
            </button>
          </span>
        );
      })}
    </div>
  );
}
