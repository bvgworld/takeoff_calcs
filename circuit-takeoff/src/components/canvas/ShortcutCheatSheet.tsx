"use client";

const SHORTCUTS: [string, string][] = [
  ["V", "Select tool"],
  ["S", "Stamp tool (last subtype)"],
  ["Space", "Toggle select / stamp"],
  ["M", "Measure"],
  ["N", "New circuit (then click devices to paint)"],
  ["1–9", "Arm nth circuit for painting"],
  ["Delete", "Delete selected devices"],
  ["⌘ / Ctrl + Z", "Undo"],
  ["Esc", "Cancel / back to select"],
  ["?", "Toggle this cheat sheet"],
];

export function ShortcutCheatSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-perry-industrial/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-perry-industrial">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-perry-blue hover:underline"
          >
            Close
          </button>
        </div>
        <ul className="mt-3 space-y-1.5">
          {SHORTCUTS.map(([key, desc]) => (
            <li key={key} className="flex items-center gap-3 text-sm">
              <kbd className="min-w-[4.5rem] rounded border border-perry-silver bg-perry-white px-1.5 py-0.5 text-center text-xs font-semibold text-perry-industrial">
                {key}
              </kbd>
              <span className="text-gray-600">{desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
