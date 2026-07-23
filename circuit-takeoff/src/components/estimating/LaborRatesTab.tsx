"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { withWriteTimeout } from "@/lib/write-guard";
import { Button } from "@/components/ui/Button";
import {
  blendedRate,
  loadedRate,
  seedLaborClassRows,
  type LaborClass,
  type RateTable,
} from "@/lib/pricing";

const inputCls = "rounded border border-perry-silver px-2 py-1.5 text-sm";
const cellInputCls = "rounded border border-perry-silver px-1.5 py-1 text-xs";

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function NumberCell({
  value,
  onSave,
  width = "w-20",
}: {
  value: number;
  onSave: (v: number) => void;
  width?: string;
}) {
  return (
    <input
      defaultValue={value}
      inputMode="decimal"
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= 0 && v !== value) {
          onSave(v);
        } else {
          e.target.value = String(value);
        }
      }}
      className={`${width} text-right tabular-nums ${cellInputCls}`}
    />
  );
}

export function LaborRatesTab({
  userId,
  tables,
  classes,
  busy,
  setBusy,
  refetch,
  showError,
}: {
  userId: string;
  tables: RateTable[];
  classes: LaborClass[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  refetch: () => Promise<void>;
  showError: (msg: string, retry?: () => void) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    tables.find((t) => t.is_default)?.id ?? tables[0]?.id ?? null
  );
  const [newName, setNewName] = useState("");

  const selected = tables.find((t) => t.id === selectedId) ?? tables[0] ?? null;
  const tableClasses = useMemo(
    () =>
      classes
        .filter((c) => c.rate_table_id === selected?.id)
        .sort((a, b) => a.class_name.localeCompare(b.class_name)),
    [classes, selected?.id]
  );
  const blended = useMemo(() => blendedRate(tableClasses), [tableClasses]);

  async function addTable() {
    const name = newName.trim();
    if (!name) {
      showError("Rate table name is required.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await withWriteTimeout(() =>
      supabase
        .from("rate_tables")
        .insert({
          user_id: userId,
          name,
          is_default: tables.length === 0, // first table becomes default
        })
        .select()
        .single()
    );
    if (error || !data) {
      setBusy(false);
      showError(error?.message ?? "Could not create rate table.", () =>
        void addTable()
      );
      return;
    }
    const table = data as RateTable;
    // Seed the standard classes — all editable/deletable.
    const { error: seedErr } = await withWriteTimeout(() =>
      supabase.from("labor_classes").insert(seedLaborClassRows(table.id))
    );
    setBusy(false);
    if (seedErr) showError(seedErr.message);
    setNewName("");
    setSelectedId(table.id);
    await refetch();
  }

  async function setDefault(id: string) {
    const supabase = createClient();
    const { error: clearErr } = await withWriteTimeout(() =>
      supabase
        .from("rate_tables")
        .update({ is_default: false })
        .eq("user_id", userId)
    );
    if (clearErr) {
      showError(clearErr.message);
      return;
    }
    const { error } = await withWriteTimeout(() =>
      supabase.from("rate_tables").update({ is_default: true }).eq("id", id)
    );
    if (error) showError(error.message);
    await refetch();
  }

  async function renameTable(id: string, name: string) {
    const { error } = await withWriteTimeout(() =>
      createClient().from("rate_tables").update({ name }).eq("id", id)
    );
    if (error) showError(error.message);
    await refetch();
  }

  async function deleteTable(id: string) {
    const { error } = await withWriteTimeout(() =>
      createClient().from("rate_tables").delete().eq("id", id)
    );
    if (error) showError(error.message);
    if (selectedId === id) setSelectedId(null);
    await refetch();
  }

  async function patchClass(id: string, patch: Partial<LaborClass>) {
    const { error } = await withWriteTimeout(() =>
      createClient().from("labor_classes").update(patch).eq("id", id)
    );
    if (error) showError(error.message);
    await refetch();
  }

  async function addClass() {
    if (!selected) return;
    const { error } = await withWriteTimeout(() =>
      createClient().from("labor_classes").insert({
        rate_table_id: selected.id,
        class_name: "New class",
        base_rate: 0,
        burden_pct: 0,
        burden_flat_per_hr: 0,
        is_field: true,
        crew_weight: 0,
      })
    );
    if (error) showError(error.message);
    await refetch();
  }

  async function removeClass(id: string) {
    const { error } = await withWriteTimeout(() =>
      createClient().from("labor_classes").delete().eq("id", id)
    );
    if (error) showError(error.message);
    await refetch();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-perry-silver bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          {tables.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                selected?.id === t.id
                  ? "border-perry-blue bg-perry-blue text-white"
                  : "border-perry-silver bg-white text-perry-industrial hover:border-perry-blue"
              }`}
            >
              {t.name}
              {t.is_default ? " ★" : ""}
            </button>
          ))}
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={'New table, e.g. "Non-union 2026"'}
            className={`${inputCls} w-56`}
          />
          <Button type="button" disabled={busy} onClick={() => void addTable()}>
            Add table
          </Button>
        </div>
        {!tables.length && (
          <p className="mt-3 text-sm text-gray-500">
            No rate tables yet — add one to price takeoffs. New tables are
            seeded with the standard classes (Foreman, Journeyman,
            Apprentice 1–5, Laborer, PM, Estimator), all editable.
          </p>
        )}
      </section>

      {selected && (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-perry-silver bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                key={selected.id}
                defaultValue={selected.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== selected.name) {
                    void renameTable(selected.id, v);
                  } else {
                    e.target.value = selected.name;
                  }
                }}
                className={`${inputCls} w-56 font-semibold`}
              />
              <label className="flex items-center gap-1.5 text-xs font-semibold text-perry-industrial">
                <input
                  type="radio"
                  checked={selected.is_default}
                  onChange={() => void setDefault(selected.id)}
                />
                Default table
              </label>
              <button
                type="button"
                onClick={() => void deleteTable(selected.id)}
                className="text-xs font-semibold text-perry-signal hover:underline"
              >
                Delete table
              </button>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Blended rate
              </p>
              <p className="font-display text-2xl tabular-nums text-perry-industrial">
                {blended.rate != null ? `${fmtMoney(blended.rate)}/hr` : "—"}
              </p>
              {blended.rate != null && !blended.usedWeights && (
                <p className="max-w-56 text-xs text-amber-700">
                  No crew weights set — showing the simple average of field
                  classes. Set crew weights below for a true blend.
                </p>
              )}
            </div>
          </section>

          <section className="overflow-x-auto rounded-lg border border-perry-silver bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-perry-silver bg-perry-white text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Class</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Base $/hr
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Burden %
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Flat $/hr
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Loaded $/hr
                  </th>
                  <th className="px-3 py-2 text-center font-semibold">Field</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Crew weight
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {tableClasses.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-perry-silver/60 last:border-0"
                  >
                    <td className="px-3 py-1.5">
                      <input
                        defaultValue={c.class_name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== c.class_name) {
                            void patchClass(c.id, { class_name: v });
                          } else {
                            e.target.value = c.class_name;
                          }
                        }}
                        className={`w-36 ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <NumberCell
                        value={c.base_rate}
                        onSave={(v) => void patchClass(c.id, { base_rate: v })}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <NumberCell
                        value={c.burden_pct}
                        onSave={(v) => void patchClass(c.id, { burden_pct: v })}
                        width="w-16"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <NumberCell
                        value={c.burden_flat_per_hr}
                        onSave={(v) =>
                          void patchClass(c.id, { burden_flat_per_hr: v })
                        }
                        width="w-16"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-perry-industrial">
                      {fmtMoney(loadedRate(c))}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={c.is_field}
                        onChange={(e) =>
                          void patchClass(c.id, { is_field: e.target.checked })
                        }
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <NumberCell
                        value={c.crew_weight}
                        onSave={(v) =>
                          void patchClass(c.id, { crew_weight: v })
                        }
                        width="w-16"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => void removeClass(c.id)}
                        className="text-xs font-semibold text-perry-signal hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {!tableClasses.length && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-8 text-center text-sm text-gray-500"
                    >
                      No classes in this table yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="border-t border-perry-silver px-3 py-2">
              <button
                type="button"
                onClick={() => void addClass()}
                className="text-xs font-semibold text-perry-blue hover:underline"
              >
                + Add class
              </button>
              <span className="ml-3 text-xs text-gray-500">
                loaded = base × (1 + burden%/100) + flat · blended = Σ(loaded
                × weight) / Σ(weight) over field classes
              </span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
