import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/auth/AppNav";
import { EstimatingDb } from "@/components/estimating/EstimatingDb";
import {
  seedAssemblyRows,
  type Assembly,
  type AssemblyItem,
  type EstimatingItem,
} from "@/lib/estimating";
import type { LaborClass, RateTable } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Estimating DB",
};

type AssemblyWithItems = Assembly & { assembly_items: AssemblyItem[] };

export default async function EstimatingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const fetchAssemblies = async () =>
    (
      await supabase
        .from("assemblies")
        .select("*, assembly_items(id,assembly_id,item_id,qty_per_uom)")
        .order("name", { ascending: true })
    ).data as AssemblyWithItems[] | null;

  let assemblies = (await fetchAssemblies()) || [];

  // Seed: one assembly for every takeoff key the engine can generate.
  // Idempotent — normalized-key conflicts are ignored, user data wins.
  const existing = new Set(assemblies.map((a) => a.name_normalized));
  const seedRows = seedAssemblyRows(user.id, existing);
  if (seedRows.length) {
    const { error } = await supabase
      .from("assemblies")
      .upsert(seedRows, {
        onConflict: "user_id,name_normalized",
        ignoreDuplicates: true,
      });
    if (!error) assemblies = (await fetchAssemblies()) || assemblies;
  }

  const { data: itemsData } = await supabase
    .from("items")
    .select("*")
    .order("name", { ascending: true });

  const { data: rtData } = await supabase
    .from("rate_tables")
    .select("*")
    .order("created_at", { ascending: true });
  const { data: lcData } = await supabase.from("labor_classes").select("*");

  return (
    <div className="min-h-screen bg-perry-white">
      <AppNav email={user.email} />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="font-display text-2xl text-perry-industrial">
          Estimating DB
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-600">
          Assemblies are what gets stamped and taken off — each carries labor
          hours per difficulty level and a list of material items. Enter your
          company&apos;s labor units or values from a labor manual your
          company is licensed to use.
        </p>
        <EstimatingDb
          userId={user.id}
          initialAssemblies={assemblies}
          initialItems={(itemsData as EstimatingItem[] | null) || []}
          initialRateTables={(rtData as RateTable[] | null) || []}
          initialLaborClasses={(lcData as LaborClass[] | null) || []}
        />
      </main>
    </div>
  );
}
