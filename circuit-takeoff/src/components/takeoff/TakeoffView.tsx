"use client";

import { useMemo, useState } from "react";
import {
  filterTakeoffLines,
  rollupTakeoffTotals,
  type TakeoffFilter,
  type TakeoffLine,
} from "@/lib/takeoff";
import {
  DISCIPLINE_BADGE,
  DISCIPLINE_LABELS,
  levelLabel,
} from "@/lib/plan-sets";
import type { Discipline } from "@/lib/types";

function isDiscipline(d: string): d is Discipline {
  return d in DISCIPLINE_LABELS;
}

function LinesTable({
  rows,
  circuitCell,
  boldQty = false,
}: {
  rows: TakeoffLine[];
  circuitCell?: string;
  boldQty?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-perry-silver bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-perry-silver bg-perry-white text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Item</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 font-semibold">UOM</th>
            <th className="px-3 py-2 font-semibold">Circuit</th>
            <th className="px-3 py-2 font-semibold">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.item}-${i}`}
              className="border-b border-perry-silver/60 last:border-0"
            >
              <td className="px-3 py-2 font-medium text-perry-industrial">
                {r.item}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${boldQty ? "font-semibold" : ""}`}
              >
                {r.qty}
              </td>
              <td className="px-3 py-2 text-gray-600">{r.uom}</td>
              <td className="px-3 py-2 text-gray-600">
                {circuitCell ?? r.circuit}
              </td>
              <td className="px-3 py-2 text-xs text-gray-500">{r.notes}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td
                colSpan={5}
                className="px-3 py-8 text-center text-sm text-gray-500"
              >
                No material quantities yet (route circuits first).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
        active
          ? "border-perry-blue bg-perry-blue text-white"
          : "border-perry-silver bg-white text-perry-industrial hover:border-perry-blue"
      }`}
    >
      {children}
    </button>
  );
}

export function TakeoffView({
  lines,
  grandTotals,
}: {
  lines: TakeoffLine[];
  grandTotals: TakeoffLine[];
}) {
  const [filter, setFilter] = useState<TakeoffFilter>({ kind: "all" });

  const disciplines = useMemo(
    () =>
      Array.from(new Set(lines.map((l) => l.discipline).filter(Boolean))) as
        string[],
    [lines]
  );
  const levels = useMemo(
    () =>
      Array.from(
        new Set(lines.map((l) => (l.discipline ? (l.level ?? "") : null)))
      ).filter((x): x is string => x !== null),
    [lines]
  );

  const filtered = filterTakeoffLines(lines, filter);
  const filteredTotals = rollupTakeoffTotals(filtered);
  const filterActive = filter.kind !== "all";

  // Sections: Level → Discipline (untagged lines go to "Project-wide").
  const sections = useMemo(() => {
    const map = new Map<string, { title: string; badge?: string; rows: TakeoffLine[] }>();
    for (const l of filtered) {
      const key = l.discipline
        ? `${l.level ?? ""}|${l.discipline}`
        : "__projectwide";
      let sec = map.get(key);
      if (!sec) {
        sec = l.discipline
          ? {
              title: levelLabel(l.level ?? ""),
              badge: l.discipline,
              rows: [],
            }
          : { title: "Project-wide", rows: [] };
        map.set(key, sec);
      }
      sec.rows.push(l);
    }
    return Array.from(map.values());
  }, [filtered]);

  return (
    <div className="mt-6 space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          active={filter.kind === "all"}
          onClick={() => setFilter({ kind: "all" })}
        >
          All
        </Chip>
        {disciplines.map((d) => (
          <Chip
            key={`d-${d}`}
            active={filter.kind === "discipline" && filter.discipline === d}
            onClick={() => setFilter({ kind: "discipline", discipline: d })}
          >
            {isDiscipline(d) ? DISCIPLINE_LABELS[d] : d}
          </Chip>
        ))}
        {levels.map((lv) => (
          <Chip
            key={`l-${lv}`}
            active={filter.kind === "level" && filter.level === lv}
            onClick={() => setFilter({ kind: "level", level: lv })}
          >
            {levelLabel(lv)}
          </Chip>
        ))}
      </div>

      {sections.map((sec, si) => {
        const byCircuit = new Map<string, TakeoffLine[]>();
        for (const l of sec.rows) {
          const list = byCircuit.get(l.circuit) || [];
          list.push(l);
          byCircuit.set(l.circuit, list);
        }
        return (
          <section key={si}>
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg text-perry-industrial">
              {sec.title}
              {sec.badge && isDiscipline(sec.badge) && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${DISCIPLINE_BADGE[sec.badge]}`}
                >
                  {DISCIPLINE_LABELS[sec.badge]}
                </span>
              )}
              {sec.rows[0]?.sheet && (
                <span className="text-xs font-normal text-gray-500">
                  {Array.from(new Set(sec.rows.map((r) => r.sheet))).join(", ")}
                </span>
              )}
            </h2>
            <div className="space-y-4">
              {Array.from(byCircuit.entries()).map(([ckt, rows]) => (
                <div key={ckt}>
                  <h3 className="mb-1 text-sm font-semibold text-perry-industrial">
                    {ckt}
                  </h3>
                  <LinesTable rows={rows} />
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {!sections.length && (
        <p className="text-sm text-gray-500">
          Nothing matches this filter.
        </p>
      )}

      {filterActive && (
        <section>
          <h2 className="mb-2 font-display text-lg text-perry-industrial">
            Filtered totals
          </h2>
          <LinesTable rows={filteredTotals} circuitCell="FILTERED" boldQty />
        </section>
      )}

      <section>
        <h2 className="mb-2 font-display text-lg text-perry-industrial">
          Project totals — entire project
        </h2>
        <LinesTable rows={grandTotals} circuitCell="TOTAL" boldQty />
      </section>
    </div>
  );
}
