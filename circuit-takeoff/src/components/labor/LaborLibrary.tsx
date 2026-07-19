"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { withWriteTimeout } from "@/lib/write-guard";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import {
  parseLaborCsv,
  type LaborItem,
  type LaborSource,
} from "@/lib/labor";

type Props = {
  userId: string;
  initialItems: LaborItem[];
};

const EMPTY_FORM = {
  item_key: "",
  uom: "LF",
  hours_per_uom: "",
  source: "company" as LaborSource,
  notes: "",
};

export function LaborLibrary({ userId, initialItems }: Props) {
  const { showError } = useToast();
  const [items, setItems] = useState<LaborItem[]>(initialItems);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [importReport, setImportReport] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refetch() {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("labor_items")
      .select("*")
      .order("item_key", { ascending: true });
    if (error) {
      showError(error.message);
      return;
    }
    setItems((data as LaborItem[]) || []);
  }

  async function addItem() {
    const hours = Number(form.hours_per_uom);
    if (!form.item_key.trim()) {
      showError("Item key is required.");
      return;
    }
    if (!Number.isFinite(hours) || hours < 0) {
      showError("Hours per UOM must be a non-negative number.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await withWriteTimeout(() =>
      supabase.from("labor_items").upsert(
        {
          user_id: userId,
          item_key: form.item_key.trim(),
          uom: form.uom,
          hours_per_uom: hours,
          source: form.source,
          notes: form.notes.trim() || null,
        },
        { onConflict: "user_id,item_key" }
      )
    );
    setBusy(false);
    if (error) {
      showError(error.message, () => void addItem());
      return;
    }
    setForm(EMPTY_FORM);
    await refetch();
  }

  async function updateItem(id: string, patch: Partial<LaborItem>) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...patch } : i))
    );
    const supabase = createClient();
    const { error } = await withWriteTimeout(() =>
      supabase.from("labor_items").update(patch).eq("id", id)
    );
    if (error) {
      showError(error.message);
      await refetch();
    }
  }

  async function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    const supabase = createClient();
    const { error } = await withWriteTimeout(() =>
      supabase.from("labor_items").delete().eq("id", id)
    );
    if (error) {
      showError(error.message);
      await refetch();
    }
  }

  async function importCsv(file: File) {
    setImportReport(null);
    const text = await file.text();
    const { rows, errors } = parseLaborCsv(text);
    if (!rows.length) {
      setImportReport(
        errors.length
          ? `Nothing imported — ${errors.length} bad line(s): ${errors[0]}`
          : "Nothing to import — file is empty."
      );
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await withWriteTimeout(() =>
      supabase.from("labor_items").upsert(
        rows.map((r) => ({
          user_id: userId,
          item_key: r.item_key,
          uom: r.uom,
          hours_per_uom: r.hours_per_uom,
        })),
        { onConflict: "user_id,item_key" }
      )
    );
    setBusy(false);
    if (error) {
      showError(error.message);
      return;
    }
    setImportReport(
      `Imported ${rows.length} item(s)` +
        (errors.length ? ` · skipped ${errors.length} bad line(s)` : "")
    );
    await refetch();
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-lg border border-perry-silver bg-white p-4">
        <h2 className="font-display text-sm text-perry-industrial">
          Add / update item
        </h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-[2fr_5rem_6rem_7rem_2fr_auto]">
          <input
            value={form.item_key}
            onChange={(e) => setForm({ ...form, item_key: e.target.value })}
            placeholder={'Item key, e.g. 1/2" EMT'}
            className="rounded border border-perry-silver px-2 py-1.5 text-sm"
          />
          <select
            value={form.uom}
            onChange={(e) => setForm({ ...form, uom: e.target.value })}
            className="rounded border border-perry-silver px-2 py-1.5 text-sm"
          >
            <option value="LF">LF</option>
            <option value="EA">EA</option>
          </select>
          <input
            value={form.hours_per_uom}
            onChange={(e) =>
              setForm({ ...form, hours_per_uom: e.target.value })
            }
            placeholder="Hrs/UOM"
            inputMode="decimal"
            className="rounded border border-perry-silver px-2 py-1.5 text-sm tabular-nums"
          />
          <select
            value={form.source}
            onChange={(e) =>
              setForm({ ...form, source: e.target.value as LaborSource })
            }
            className="rounded border border-perry-silver px-2 py-1.5 text-sm"
          >
            <option value="company">Company</option>
            <option value="licensed">Licensed</option>
          </select>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes (optional)"
            className="rounded border border-perry-silver px-2 py-1.5 text-sm"
          />
          <Button type="button" disabled={busy} onClick={() => void addItem()}>
            Save
          </Button>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importCsv(f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          Import CSV
        </Button>
        <span className="text-xs text-gray-500">
          Columns: item_key, uom, hours_per_uom — existing items with the
          same key are overwritten.
        </span>
        {importReport && (
          <span className="text-xs font-semibold text-perry-industrial">
            {importReport}
          </span>
        )}
      </section>

      <section className="overflow-x-auto rounded-lg border border-perry-silver bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-perry-silver bg-perry-white text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Item key</th>
              <th className="px-3 py-2 font-semibold">UOM</th>
              <th className="px-3 py-2 text-right font-semibold">Hrs/UOM</th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Notes</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr
                key={i.id}
                className="border-b border-perry-silver/60 last:border-0"
              >
                <td className="px-3 py-1.5 font-medium text-perry-industrial">
                  {i.item_key}
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={i.uom}
                    onChange={(e) =>
                      void updateItem(i.id, { uom: e.target.value })
                    }
                    className="rounded border border-perry-silver px-1.5 py-1 text-xs"
                  >
                    <option value="LF">LF</option>
                    <option value="EA">EA</option>
                  </select>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <input
                    defaultValue={i.hours_per_uom}
                    inputMode="decimal"
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (
                        Number.isFinite(v) &&
                        v >= 0 &&
                        v !== i.hours_per_uom
                      ) {
                        void updateItem(i.id, { hours_per_uom: v });
                      } else {
                        e.target.value = String(i.hours_per_uom);
                      }
                    }}
                    className="w-20 rounded border border-perry-silver px-1.5 py-1 text-right text-xs tabular-nums"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={i.source}
                    onChange={(e) =>
                      void updateItem(i.id, {
                        source: e.target.value as LaborSource,
                      })
                    }
                    className="rounded border border-perry-silver px-1.5 py-1 text-xs"
                  >
                    <option value="company">Company</option>
                    <option value="licensed">Licensed</option>
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <input
                    defaultValue={i.notes ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null;
                      if (v !== (i.notes ?? null)) {
                        void updateItem(i.id, { notes: v });
                      }
                    }}
                    className="w-full rounded border border-perry-silver px-1.5 py-1 text-xs"
                  />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => void removeItem(i.id)}
                    className="text-xs font-semibold text-perry-signal hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-10 text-center text-sm text-gray-500"
                >
                  No labor items yet — add one above or import a CSV.
                  Takeoffs show an Hours column once items exist.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
