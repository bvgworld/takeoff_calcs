"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { withWriteTimeout } from "@/lib/write-guard";
import { useToast } from "@/components/ui/Toast";
import {
  filterTakeoffLines,
  rollupTakeoffTotals,
  takeoffToCsv,
  type TakeoffFilter,
  type TakeoffLine,
} from "@/lib/takeoff";
import {
  DISCIPLINE_BADGE,
  DISCIPLINE_LABELS,
  levelLabel,
} from "@/lib/plan-sets";
import { totalLaborHours } from "@/lib/labor";
import type { AssemblyJoinReport } from "@/lib/estimating";
import {
  priceTakeoffLines,
  totalExtPrice,
  DIFFICULTY_LABELS,
  type BlendedRate,
  type Difficulty,
  type PricingInputs,
} from "@/lib/pricing";
import { Button } from "@/components/ui/Button";
import type { Discipline } from "@/lib/types";

function isDiscipline(d: string): d is Discipline {
  return d in DISCIPLINE_LABELS;
}

function fmtHours(h: number): string {
  return h.toFixed(2);
}

function fmtMoney(v: number): string {
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const DIFFICULTIES: Difficulty[] = [1, 2, 3];

function LinesTable({
  rows,
  circuitCell,
  boldQty = false,
  showHours = false,
  showPrices = false,
}: {
  rows: TakeoffLine[];
  circuitCell?: string;
  boldQty?: boolean;
  showHours?: boolean;
  showPrices?: boolean;
}) {
  const colCount = 5 + (showHours ? 1 : 0) + (showPrices ? 2 : 0);
  return (
    <div className="overflow-x-auto rounded-lg border border-perry-silver bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-perry-silver bg-perry-white text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Item</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 font-semibold">UOM</th>
            {showHours && (
              <th className="px-3 py-2 text-right font-semibold">Hours</th>
            )}
            {showPrices && (
              <>
                <th className="px-3 py-2 text-right font-semibold">Unit $</th>
                <th className="px-3 py-2 text-right font-semibold">Ext $</th>
              </>
            )}
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
              {showHours && (
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                  {r.hours != null ? fmtHours(r.hours) : "—"}
                  {r.hours_estimated && (
                    <span
                      title="Estimated — no hours entered for this difficulty; hours_l1 × default multiplier used"
                      className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700"
                    >
                      est
                    </span>
                  )}
                </td>
              )}
              {showPrices && (
                <>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {r.unit_price != null ? fmtMoney(r.unit_price) : "—"}
                    {r.priced_flat && (
                      <span
                        title="Flat price override — hours and items ignored"
                        className="ml-1 rounded bg-perry-blue/10 px-1 text-[10px] font-semibold text-perry-blue"
                      >
                        F
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {r.ext_price != null ? fmtMoney(r.ext_price) : "—"}
                  </td>
                </>
              )}
              <td className="px-3 py-2 text-gray-600">
                {circuitCell ?? r.circuit}
              </td>
              <td className="px-3 py-2 text-xs text-gray-500">{r.notes}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td
                colSpan={colCount}
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

function TotalsLine({
  label,
  rows,
  showPrices,
}: {
  label: string;
  rows: TakeoffLine[];
  showPrices: boolean;
}) {
  return (
    <p className="mt-2 text-right text-sm font-semibold tabular-nums text-perry-industrial">
      {label} hours: {fmtHours(totalLaborHours(rows))}
      {showPrices && <> · {label} total: {fmtMoney(totalExtPrice(rows))}</>}
    </p>
  );
}

export function TakeoffView({
  lines,
  laborEnabled = false,
  joinReport,
  pricing,
  csvFilename,
}: {
  /** Unpriced takeoff lines — quantities only. Pricing happens here. */
  lines: TakeoffLine[];
  /** True when the user has assemblies — shows the Hours column. */
  laborEnabled?: boolean;
  /** Missing-assembly-data report (keys with no assembly, computed w/o hours). */
  joinReport?: AssemblyJoinReport;
  pricing?: {
    assemblies: PricingInputs["assemblies"];
    items: { id: string; uom: "EA" | "LF" | "100LF"; cost_per_uom: number }[];
    blended: BlendedRate | null;
    rateTableName: string | null;
    /** sheetId → { name, difficulty } for the per-section toggle. */
    sheets: Record<string, { name: string; difficulty: Difficulty }>;
  };
  csvFilename: string;
}) {
  const { showError } = useToast();
  const [filter, setFilter] = useState<TakeoffFilter>({ kind: "all" });
  const [difficultyBySheet, setDifficultyBySheet] = useState<
    Record<string, Difficulty>
  >(() =>
    Object.fromEntries(
      Object.entries(pricing?.sheets ?? {}).map(([id, s]) => [
        id,
        s.difficulty,
      ])
    )
  );

  const itemsById = useMemo(
    () => new Map((pricing?.items ?? []).map((i) => [i.id, i])),
    [pricing?.items]
  );

  const showPrices = !!pricing && pricing.blended?.rate != null;

  // Live pricing — changing a sheet's difficulty recomputes hours and
  // ext $ here with no re-route and no quantity change.
  const priced = useMemo(() => {
    if (!pricing || !laborEnabled) return lines;
    return priceTakeoffLines(lines, {
      assemblies: pricing.assemblies,
      itemsById,
      blendedRatePerHr: pricing.blended?.rate ?? null,
      difficultyBySheetId: difficultyBySheet,
    });
  }, [lines, pricing, itemsById, difficultyBySheet, laborEnabled]);

  const grandTotals = useMemo(() => rollupTakeoffTotals(priced), [priced]);

  async function setSheetDifficulty(sheetId: string, d: Difficulty) {
    const prev = difficultyBySheet[sheetId];
    setDifficultyBySheet((cur) => ({ ...cur, [sheetId]: d }));
    const { error } = await withWriteTimeout(() =>
      createClient().from("sheets").update({ difficulty: d }).eq("id", sheetId)
    );
    if (error) {
      setDifficultyBySheet((cur) => ({ ...cur, [sheetId]: prev }));
      showError(error.message, () => void setSheetDifficulty(sheetId, d));
    }
  }

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

  const filtered = filterTakeoffLines(priced, filter);
  const filteredTotals = rollupTakeoffTotals(filtered);
  const filterActive = filter.kind !== "all";

  // Sections: Level → Discipline (untagged lines go to "Project-wide").
  const sections = useMemo(() => {
    const map = new Map<
      string,
      { title: string; badge?: string; rows: TakeoffLine[] }
    >();
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-gray-600">
          {pricing?.rateTableName ? (
            <>
              Rates: <span className="font-semibold">{pricing.rateTableName}</span>
              {pricing.blended?.rate != null && (
                <>
                  {" · blended "}
                  <span className="font-semibold tabular-nums">
                    {fmtMoney(pricing.blended.rate)}/hr
                  </span>
                  {!pricing.blended.usedWeights && (
                    <span className="ml-1 text-amber-700">
                      (no crew weights — simple average)
                    </span>
                  )}
                </>
              )}
            </>
          ) : (
            laborEnabled && (
              <>
                No rate table —{" "}
                <a href="/estimating" className="font-semibold underline">
                  create one in the Estimating DB
                </a>{" "}
                to price this takeoff.
              </>
            )
          )}
        </div>
        <Button
          type="button"
          onClick={() => {
            const csv = takeoffToCsv([...priced, ...grandTotals], {
              rateTable: pricing?.rateTableName ?? "",
            });
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = csvFilename;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export CSV
        </Button>
      </div>

      {laborEnabled &&
        joinReport &&
        (joinReport.missingKeys.length > 0 ||
          joinReport.computedNoHours.length > 0) && (
          <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {joinReport.missingKeys.length > 0 && (
              <p>
                {joinReport.missingKeys.length} takeoff key
                {joinReport.missingKeys.length === 1 ? " has" : "s have"} no
                assembly: {joinReport.missingKeys.slice(0, 5).join(", ")}
                {joinReport.missingKeys.length > 5 ? ", …" : ""} — open the{" "}
                <a href="/estimating" className="font-semibold underline">
                  Estimating DB
                </a>{" "}
                to seed them.
              </p>
            )}
            {joinReport.computedNoHours.length > 0 && (
              <p>
                {joinReport.computedNoHours.length} assembl
                {joinReport.computedNoHours.length === 1 ? "y is" : "ies are"}{" "}
                in computed mode with no hours:{" "}
                {joinReport.computedNoHours.slice(0, 5).join(", ")}
                {joinReport.computedNoHours.length > 5 ? ", …" : ""} — set
                hours in the{" "}
                <a href="/estimating" className="font-semibold underline">
                  Estimating DB
                </a>
                .
              </p>
            )}
          </div>
        )}

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
        const sectionSheets = Array.from(
          new Set(sec.rows.map((r) => r.sheetId).filter(Boolean))
        ) as string[];
        return (
          <section key={si}>
            <h2 className="mb-3 flex flex-wrap items-center gap-2 font-display text-lg text-perry-industrial">
              {sec.title}
              {sec.badge && isDiscipline(sec.badge) && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${DISCIPLINE_BADGE[sec.badge]}`}
                >
                  {DISCIPLINE_LABELS[sec.badge]}
                </span>
              )}
              {pricing &&
                sectionSheets.map((sid) => (
                  <span
                    key={sid}
                    className="flex items-center gap-1 text-xs font-normal text-gray-500"
                  >
                    {pricing.sheets[sid]?.name ?? ""}
                    <span className="flex overflow-hidden rounded border border-perry-silver">
                      {DIFFICULTIES.map((d) => (
                        <button
                          key={d}
                          type="button"
                          title={`Difficulty ${DIFFICULTY_LABELS[d]}`}
                          onClick={() => void setSheetDifficulty(sid, d)}
                          className={`px-1.5 py-0.5 text-[10px] font-semibold ${
                            (difficultyBySheet[sid] ?? 1) === d
                              ? "bg-perry-blue text-white"
                              : "bg-white text-perry-industrial hover:bg-perry-silver/30"
                          }`}
                        >
                          {DIFFICULTY_LABELS[d]}
                        </button>
                      ))}
                    </span>
                  </span>
                ))}
              {!pricing && sec.rows[0]?.sheet && (
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
                  <LinesTable
                    rows={rows}
                    showHours={laborEnabled}
                    showPrices={showPrices}
                  />
                </div>
              ))}
            </div>
            {laborEnabled && (
              <TotalsLine
                label="Section"
                rows={sec.rows}
                showPrices={showPrices}
              />
            )}
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
          <LinesTable
            rows={filteredTotals}
            circuitCell="FILTERED"
            boldQty
            showHours={laborEnabled}
            showPrices={showPrices}
          />
          {laborEnabled && (
            <TotalsLine
              label="Filtered"
              rows={filteredTotals}
              showPrices={showPrices}
            />
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 font-display text-lg text-perry-industrial">
          Project totals — entire project
        </h2>
        <LinesTable
          rows={grandTotals}
          circuitCell="TOTAL"
          boldQty
          showHours={laborEnabled}
          showPrices={showPrices}
        />
        {laborEnabled && (
          <TotalsLine
            label="Project"
            rows={grandTotals}
            showPrices={showPrices}
          />
        )}
      </section>
    </div>
  );
}
