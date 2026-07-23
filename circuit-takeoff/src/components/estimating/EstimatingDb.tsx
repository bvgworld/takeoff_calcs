"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { withWriteTimeout } from "@/lib/write-guard";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { normalizeItemKey } from "@/lib/labor";
import {
  parseAssemblyCsv,
  parseItemCsv,
  type Assembly,
  type AssemblyItem,
  type AssemblyUom,
  type EstimatingItem,
  type ItemUom,
  type PricingMode,
} from "@/lib/estimating";
import {
  assemblyUnitPrice,
  blendedRate,
  type LaborClass,
  type RateTable,
} from "@/lib/pricing";
import { LaborRatesTab } from "./LaborRatesTab";

type AssemblyWithItems = Assembly & { assembly_items: AssemblyItem[] };

type Props = {
  userId: string;
  initialAssemblies: AssemblyWithItems[];
  initialItems: EstimatingItem[];
  initialRateTables: RateTable[];
  initialLaborClasses: LaborClass[];
};

const inputCls =
  "rounded border border-perry-silver px-2 py-1.5 text-sm";
const cellInputCls =
  "rounded border border-perry-silver px-1.5 py-1 text-xs";

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function EstimatingDb({
  userId,
  initialAssemblies,
  initialItems,
  initialRateTables,
  initialLaborClasses,
}: Props) {
  const { showError } = useToast();
  const [tab, setTab] = useState<"assemblies" | "materials" | "rates">(
    "assemblies"
  );
  const [assemblies, setAssemblies] =
    useState<AssemblyWithItems[]>(initialAssemblies);
  const [items, setItems] = useState<EstimatingItem[]>(initialItems);
  const [rateTables, setRateTables] = useState<RateTable[]>(initialRateTables);
  const [laborClasses, setLaborClasses] =
    useState<LaborClass[]>(initialLaborClasses);
  const [busy, setBusy] = useState(false);
  const [importReport, setImportReport] = useState<string | null>(null);

  const supabase = () => createClient();

  // Default-table blended rate — drives the computed unit price preview.
  const defaultBlended = useMemo(() => {
    const table =
      rateTables.find((t) => t.is_default) ?? rateTables[0] ?? null;
    if (!table) return null;
    return blendedRate(
      laborClasses.filter((c) => c.rate_table_id === table.id)
    );
  }, [rateTables, laborClasses]);

  async function refetchAssemblies() {
    const { data, error } = await supabase()
      .from("assemblies")
      .select("*, assembly_items(id,assembly_id,item_id,qty_per_uom)")
      .order("name", { ascending: true });
    if (error) {
      showError(error.message);
      return;
    }
    setAssemblies((data as AssemblyWithItems[]) || []);
  }

  async function refetchItems() {
    const { data, error } = await supabase()
      .from("items")
      .select("*")
      .order("name", { ascending: true });
    if (error) {
      showError(error.message);
      return;
    }
    setItems((data as EstimatingItem[]) || []);
  }

  async function refetchRates() {
    const [tables, cls] = await Promise.all([
      supabase()
        .from("rate_tables")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase().from("labor_classes").select("*"),
    ]);
    if (tables.error || cls.error) {
      showError((tables.error ?? cls.error)!.message);
      return;
    }
    setRateTables((tables.data as RateTable[]) || []);
    setLaborClasses((cls.data as LaborClass[]) || []);
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-2">
        {(
          [
            ["assemblies", "Assemblies"],
            ["materials", "Materials"],
            ["rates", "Labor rates"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setImportReport(null);
            }}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
              tab === t
                ? "border-perry-blue bg-perry-blue text-white"
                : "border-perry-silver bg-white text-perry-industrial hover:border-perry-blue"
            }`}
          >
            {label}
          </button>
        ))}
        {importReport && (
          <span className="text-xs font-semibold text-perry-industrial">
            {importReport}
          </span>
        )}
      </div>

      {tab === "assemblies" && (
        <AssembliesTab
          userId={userId}
          assemblies={assemblies}
          items={items}
          blendedRatePerHr={defaultBlended?.rate ?? null}
          busy={busy}
          setBusy={setBusy}
          setImportReport={setImportReport}
          refetch={refetchAssemblies}
          showError={showError}
        />
      )}
      {tab === "materials" && (
        <MaterialsTab
          userId={userId}
          items={items}
          busy={busy}
          setBusy={setBusy}
          setImportReport={setImportReport}
          refetch={refetchItems}
          showError={showError}
        />
      )}
      {tab === "rates" && (
        <LaborRatesTab
          userId={userId}
          tables={rateTables}
          classes={laborClasses}
          busy={busy}
          setBusy={setBusy}
          refetch={refetchRates}
          showError={showError}
        />
      )}
    </div>
  );
}

// ————————————————— Assemblies tab —————————————————

function AssembliesTab({
  userId,
  assemblies,
  items,
  blendedRatePerHr,
  busy,
  setBusy,
  setImportReport,
  refetch,
  showError,
}: {
  userId: string;
  assemblies: AssemblyWithItems[];
  items: EstimatingItem[];
  /** Default-table blended rate for the computed unit price preview. */
  blendedRatePerHr: number | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setImportReport: (s: string | null) => void;
  refetch: () => Promise<void>;
  showError: (msg: string, retry?: () => void) => void;
}) {
  const [form, setForm] = useState({ name: "", uom: "EA" as AssemblyUom });
  const [expanded, setExpanded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const itemsById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items]
  );

  async function addAssembly() {
    const name = form.name.trim();
    if (!name) {
      showError("Assembly name is required.");
      return;
    }
    setBusy(true);
    const { error } = await withWriteTimeout(() =>
      createClient()
        .from("assemblies")
        .upsert(
          {
            user_id: userId,
            name,
            name_normalized: normalizeItemKey(name),
            uom: form.uom,
            pricing_mode: "computed",
          },
          { onConflict: "user_id,name_normalized" }
        )
    );
    setBusy(false);
    if (error) {
      showError(error.message, () => void addAssembly());
      return;
    }
    setForm({ name: "", uom: "EA" });
    await refetch();
  }

  async function patchAssembly(id: string, patch: Partial<Assembly>) {
    const { error } = await withWriteTimeout(() =>
      createClient().from("assemblies").update(patch).eq("id", id)
    );
    if (error) {
      showError(error.message);
    }
    await refetch();
  }

  async function removeAssembly(id: string) {
    const { error } = await withWriteTimeout(() =>
      createClient().from("assemblies").delete().eq("id", id)
    );
    if (error) {
      showError(error.message);
    }
    await refetch();
  }

  async function addAssemblyItem(assemblyId: string, itemId: string) {
    const { error } = await withWriteTimeout(() =>
      createClient().from("assembly_items").insert({
        assembly_id: assemblyId,
        item_id: itemId,
        qty_per_uom: 1,
      })
    );
    if (error) showError(error.message);
    await refetch();
  }

  async function patchAssemblyItem(id: string, qty: number) {
    const { error } = await withWriteTimeout(() =>
      createClient()
        .from("assembly_items")
        .update({ qty_per_uom: qty })
        .eq("id", id)
    );
    if (error) showError(error.message);
    await refetch();
  }

  async function removeAssemblyItem(id: string) {
    const { error } = await withWriteTimeout(() =>
      createClient().from("assembly_items").delete().eq("id", id)
    );
    if (error) showError(error.message);
    await refetch();
  }

  async function importCsv(file: File) {
    setImportReport(null);
    const text = await file.text();
    const { rows, errors } = parseAssemblyCsv(text);
    if (!rows.length) {
      setImportReport(
        errors.length
          ? `Nothing imported — ${errors.length} bad line(s): ${errors[0]}`
          : "Nothing to import — file is empty."
      );
      return;
    }
    setBusy(true);
    const { error } = await withWriteTimeout(() =>
      createClient()
        .from("assemblies")
        .upsert(
          rows.map((r) => ({
            user_id: userId,
            name: r.name,
            name_normalized: normalizeItemKey(r.name),
            uom: r.uom,
            hours_l1: r.hours_l1,
            hours_l2: r.hours_l2,
            hours_l3: r.hours_l3,
            pricing_mode: r.pricing_mode,
            flat_price: r.flat_price,
          })),
          { onConflict: "user_id,name_normalized" }
        )
    );
    setBusy(false);
    if (error) {
      showError(error.message);
      return;
    }
    setImportReport(
      `Imported ${rows.length} assembl${rows.length === 1 ? "y" : "ies"}` +
        (errors.length ? ` · skipped ${errors.length} bad line(s)` : "")
    );
    await refetch();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-perry-silver bg-white p-4">
        <h2 className="font-display text-sm text-perry-industrial">
          Add assembly
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={'Name, e.g. 1/2" EMT'}
            className={`${inputCls} w-72`}
          />
          <select
            value={form.uom}
            onChange={(e) =>
              setForm({ ...form, uom: e.target.value as AssemblyUom })
            }
            className={inputCls}
          >
            <option value="EA">EA</option>
            <option value="LF">LF</option>
          </select>
          <Button type="button" disabled={busy} onClick={() => void addAssembly()}>
            Add
          </Button>
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
            Columns: name, uom, hours_l1, hours_l2, hours_l3, pricing_mode,
            flat_price — same normalized name overwrites.
          </span>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border border-perry-silver bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-perry-silver bg-perry-white text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">UOM</th>
              <th className="px-3 py-2 text-right font-semibold">Hrs L1</th>
              <th className="px-3 py-2 text-right font-semibold">Hrs L2</th>
              <th className="px-3 py-2 text-right font-semibold">Hrs L3</th>
              <th className="px-3 py-2 font-semibold">Pricing</th>
              <th className="px-3 py-2 text-right font-semibold">Flat $</th>
              <th className="px-3 py-2 text-right font-semibold">Unit $</th>
              <th className="px-3 py-2 text-right font-semibold">Items</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {assemblies.map((a) => (
              <AssemblyRow
                key={a.id}
                assembly={a}
                items={items}
                itemsById={itemsById}
                blendedRatePerHr={blendedRatePerHr}
                expanded={expanded === a.id}
                onToggle={() =>
                  setExpanded((cur) => (cur === a.id ? null : a.id))
                }
                onPatch={(patch) => void patchAssembly(a.id, patch)}
                onRemove={() => void removeAssembly(a.id)}
                onAddItem={(itemId) => void addAssemblyItem(a.id, itemId)}
                onPatchItem={(id, qty) => void patchAssemblyItem(id, qty)}
                onRemoveItem={(id) => void removeAssemblyItem(id)}
              />
            ))}
            {!assemblies.length && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-10 text-center text-sm text-gray-500"
                >
                  No assemblies yet — they are seeded automatically from the
                  takeoff engine on page load.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function HoursCell({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (v: number | null) => void;
}) {
  return (
    <td className="px-3 py-1.5 text-right">
      <input
        defaultValue={value ?? ""}
        inputMode="decimal"
        placeholder="—"
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (!raw) {
            if (value !== null) onSave(null);
            return;
          }
          const v = Number(raw);
          if (Number.isFinite(v) && v >= 0) {
            if (v !== value) onSave(v);
          } else {
            e.target.value = value == null ? "" : String(value);
          }
        }}
        className={`w-16 text-right tabular-nums ${cellInputCls}`}
      />
    </td>
  );
}

function AssemblyRow({
  assembly: a,
  items,
  itemsById,
  blendedRatePerHr,
  expanded,
  onToggle,
  onPatch,
  onRemove,
  onAddItem,
  onPatchItem,
  onRemoveItem,
}: {
  assembly: AssemblyWithItems;
  items: EstimatingItem[];
  itemsById: Map<string, EstimatingItem>;
  blendedRatePerHr: number | null;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<Assembly>) => void;
  onRemove: () => void;
  onAddItem: (itemId: string) => void;
  onPatchItem: (id: string, qty: number) => void;
  onRemoveItem: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const attachedIds = new Set(a.assembly_items.map((ai) => ai.item_id));
  const matches = search.trim()
    ? items
        .filter(
          (i) =>
            !attachedIds.has(i.id) &&
            i.name.toLowerCase().includes(search.trim().toLowerCase())
        )
        .slice(0, 8)
    : [];

  return (
    <>
      <tr className="border-b border-perry-silver/60 last:border-0">
        <td className="px-3 py-1.5 font-medium text-perry-industrial">
          {a.name}
        </td>
        <td className="px-3 py-1.5">
          <select
            value={a.uom}
            onChange={(e) => onPatch({ uom: e.target.value as AssemblyUom })}
            className={cellInputCls}
          >
            <option value="EA">EA</option>
            <option value="LF">LF</option>
          </select>
        </td>
        <HoursCell value={a.hours_l1} onSave={(v) => onPatch({ hours_l1: v })} />
        <HoursCell value={a.hours_l2} onSave={(v) => onPatch({ hours_l2: v })} />
        <HoursCell value={a.hours_l3} onSave={(v) => onPatch({ hours_l3: v })} />
        <td className="px-3 py-1.5">
          <select
            value={a.pricing_mode}
            onChange={(e) =>
              onPatch({ pricing_mode: e.target.value as PricingMode })
            }
            className={cellInputCls}
          >
            <option value="computed">Computed</option>
            <option value="flat">Flat</option>
          </select>
        </td>
        <td className="px-3 py-1.5 text-right">
          <input
            defaultValue={a.flat_price ?? ""}
            inputMode="decimal"
            placeholder="—"
            disabled={a.pricing_mode !== "flat"}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (!raw) {
                if (a.flat_price !== null) onPatch({ flat_price: null });
                return;
              }
              const v = Number(raw);
              if (Number.isFinite(v) && v >= 0) {
                if (v !== a.flat_price) onPatch({ flat_price: v });
              } else {
                e.target.value =
                  a.flat_price == null ? "" : String(a.flat_price);
              }
            }}
            className={`w-20 text-right tabular-nums ${cellInputCls} disabled:opacity-40`}
          />
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
          {(() => {
            // Preview at difficulty L1 with the default table's blended rate.
            const { unitPrice } = assemblyUnitPrice(
              a,
              1,
              blendedRatePerHr,
              itemsById
            );
            return unitPrice != null ? fmtMoney(unitPrice) : "—";
          })()}
        </td>
        <td className="px-3 py-1.5 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="text-xs font-semibold text-perry-blue hover:underline"
          >
            {a.assembly_items.length} item
            {a.assembly_items.length === 1 ? "" : "s"} {expanded ? "▾" : "▸"}
          </button>
        </td>
        <td className="px-3 py-1.5 text-right">
          <button
            type="button"
            onClick={onRemove}
            className="text-xs font-semibold text-perry-signal hover:underline"
          >
            Delete
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-perry-silver/60 bg-perry-white/60">
          <td colSpan={10} className="px-6 py-3">
            <div className="space-y-2">
              {a.assembly_items.map((ai) => {
                const item = itemsById.get(ai.item_id);
                return (
                  <div key={ai.id} className="flex items-center gap-3 text-sm">
                    <span className="w-64 truncate font-medium text-perry-industrial">
                      {item?.name ?? "(deleted item)"}
                    </span>
                    <span className="w-12 text-xs text-gray-500">
                      {item?.uom ?? ""}
                    </span>
                    <input
                      defaultValue={ai.qty_per_uom}
                      inputMode="decimal"
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (
                          Number.isFinite(v) &&
                          v > 0 &&
                          v !== ai.qty_per_uom
                        ) {
                          onPatchItem(ai.id, v);
                        } else {
                          e.target.value = String(ai.qty_per_uom);
                        }
                      }}
                      className={`w-20 text-right tabular-nums ${cellInputCls}`}
                    />
                    <span className="text-xs text-gray-500">
                      per {a.uom === "LF" ? "LF" : "each"}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveItem(ai.id)}
                      className="text-xs font-semibold text-perry-signal hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              {!a.assembly_items.length && (
                <p className="text-xs text-gray-500">
                  No items attached — computed price will be labor only.
                </p>
              )}
              <div className="relative max-w-sm">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search materials to add…"
                  className={`${inputCls} w-full`}
                />
                {matches.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded border border-perry-silver bg-white shadow">
                    {matches.map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => {
                          onAddItem(i.id);
                          setSearch("");
                        }}
                        className="block w-full px-2 py-1.5 text-left text-sm hover:bg-perry-white"
                      >
                        {i.name}{" "}
                        <span className="text-xs text-gray-500">
                          {i.uom} · {fmtMoney(i.cost_per_uom)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {search.trim() && !matches.length && (
                  <p className="mt-1 text-xs text-gray-500">
                    No materials match — add it on the Materials tab first.
                  </p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ————————————————— Materials tab —————————————————

const EMPTY_ITEM_FORM = {
  name: "",
  uom: "EA" as ItemUom,
  cost_per_uom: "",
  supplier: "",
  quote_date: "",
  notes: "",
};

function MaterialsTab({
  userId,
  items,
  busy,
  setBusy,
  setImportReport,
  refetch,
  showError,
}: {
  userId: string;
  items: EstimatingItem[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setImportReport: (s: string | null) => void;
  refetch: () => Promise<void>;
  showError: (msg: string, retry?: () => void) => void;
}) {
  const [form, setForm] = useState(EMPTY_ITEM_FORM);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addItem() {
    const name = form.name.trim();
    const cost = Number(form.cost_per_uom || 0);
    if (!name) {
      showError("Material name is required.");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      showError("Cost must be a non-negative number.");
      return;
    }
    setBusy(true);
    const { error } = await withWriteTimeout(() =>
      createClient()
        .from("items")
        .upsert(
          {
            user_id: userId,
            name,
            name_normalized: normalizeItemKey(name),
            uom: form.uom,
            cost_per_uom: cost,
            supplier: form.supplier.trim() || null,
            quote_date: form.quote_date || null,
            notes: form.notes.trim() || null,
          },
          { onConflict: "user_id,name_normalized,uom" }
        )
    );
    setBusy(false);
    if (error) {
      showError(error.message, () => void addItem());
      return;
    }
    setForm(EMPTY_ITEM_FORM);
    await refetch();
  }

  async function patchItem(id: string, patch: Partial<EstimatingItem>) {
    const { error } = await withWriteTimeout(() =>
      createClient().from("items").update(patch).eq("id", id)
    );
    if (error) showError(error.message);
    await refetch();
  }

  async function removeItem(id: string) {
    const { error } = await withWriteTimeout(() =>
      createClient().from("items").delete().eq("id", id)
    );
    if (error) showError(error.message);
    await refetch();
  }

  async function importCsv(file: File) {
    setImportReport(null);
    const text = await file.text();
    const { rows, errors } = parseItemCsv(text);
    if (!rows.length) {
      setImportReport(
        errors.length
          ? `Nothing imported — ${errors.length} bad line(s): ${errors[0]}`
          : "Nothing to import — file is empty."
      );
      return;
    }
    setBusy(true);
    const { error } = await withWriteTimeout(() =>
      createClient()
        .from("items")
        .upsert(
          rows.map((r) => ({
            user_id: userId,
            name: r.name,
            name_normalized: normalizeItemKey(r.name),
            uom: r.uom,
            cost_per_uom: r.cost_per_uom,
            supplier: r.supplier,
            quote_date: r.quote_date,
          })),
          { onConflict: "user_id,name_normalized,uom" }
        )
    );
    setBusy(false);
    if (error) {
      showError(error.message);
      return;
    }
    setImportReport(
      `Imported ${rows.length} material(s)` +
        (errors.length ? ` · skipped ${errors.length} bad line(s)` : "")
    );
    await refetch();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-perry-silver bg-white p-4">
        <h2 className="font-display text-sm text-perry-industrial">
          Add / update material
        </h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-[2fr_5rem_6rem_1fr_8rem_1fr_auto]">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={'Name, e.g. 1/2" EMT coupling'}
            className={inputCls}
          />
          <select
            value={form.uom}
            onChange={(e) =>
              setForm({ ...form, uom: e.target.value as ItemUom })
            }
            className={inputCls}
          >
            <option value="EA">EA</option>
            <option value="LF">LF</option>
            <option value="100LF">100LF</option>
          </select>
          <input
            value={form.cost_per_uom}
            onChange={(e) => setForm({ ...form, cost_per_uom: e.target.value })}
            placeholder="Cost"
            inputMode="decimal"
            className={`${inputCls} tabular-nums`}
          />
          <input
            value={form.supplier}
            onChange={(e) => setForm({ ...form, supplier: e.target.value })}
            placeholder="Supplier (optional)"
            className={inputCls}
          />
          <input
            type="date"
            value={form.quote_date}
            onChange={(e) => setForm({ ...form, quote_date: e.target.value })}
            className={inputCls}
          />
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes (optional)"
            className={inputCls}
          />
          <Button type="button" disabled={busy} onClick={() => void addItem()}>
            Save
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-3">
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
            Columns: name, uom, cost_per_uom, supplier, quote_date — same
            normalized name + uom overwrites.
          </span>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border border-perry-silver bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-perry-silver bg-perry-white text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">UOM</th>
              <th className="px-3 py-2 text-right font-semibold">Cost</th>
              <th className="px-3 py-2 font-semibold">Supplier</th>
              <th className="px-3 py-2 font-semibold">Quote date</th>
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
                  {i.name}
                </td>
                <td className="px-3 py-1.5 text-gray-600">{i.uom}</td>
                <td className="px-3 py-1.5 text-right">
                  <input
                    defaultValue={i.cost_per_uom}
                    inputMode="decimal"
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 0 && v !== i.cost_per_uom) {
                        void patchItem(i.id, { cost_per_uom: v });
                      } else {
                        e.target.value = String(i.cost_per_uom);
                      }
                    }}
                    className={`w-20 text-right tabular-nums ${cellInputCls}`}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    defaultValue={i.supplier ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null;
                      if (v !== (i.supplier ?? null)) {
                        void patchItem(i.id, { supplier: v });
                      }
                    }}
                    className={`w-28 ${cellInputCls}`}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="date"
                    defaultValue={i.quote_date ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value || null;
                      if (v !== (i.quote_date ?? null)) {
                        void patchItem(i.id, { quote_date: v });
                      }
                    }}
                    className={cellInputCls}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    defaultValue={i.notes ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null;
                      if (v !== (i.notes ?? null)) {
                        void patchItem(i.id, { notes: v });
                      }
                    }}
                    className={`w-full ${cellInputCls}`}
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
                  colSpan={7}
                  className="px-3 py-10 text-center text-sm text-gray-500"
                >
                  No materials yet — add one above or import a CSV. Attach
                  materials to assemblies on the Assemblies tab.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
