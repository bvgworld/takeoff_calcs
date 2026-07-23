import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/auth/AppNav";
import { TakeoffView } from "@/components/takeoff/TakeoffView";
import { buildProjectTakeoff } from "@/lib/takeoff";
import { assemblyJoinReport, type Assembly, type AssemblyItem } from "@/lib/estimating";
import {
  blendedRate,
  type Difficulty,
  type LaborClass,
  type RateTable,
} from "@/lib/pricing";
import type {
  Circuit,
  Device,
  Project,
  ProjectSettings,
  Route,
  Sheet,
} from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const supabase = createClient();
  const { data } = await supabase
    .from("projects")
    .select("name")
    .eq("id", params.id)
    .maybeSingle();
  return { title: data?.name ? `${data.name} takeoff` : "Takeoff" };
}

export default async function TakeoffPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!project) notFound();

  const p = project as Project;
  const settings = {
    ...DEFAULT_SETTINGS,
    ...((p.settings as ProjectSettings) || {}),
  };

  const { data: sheets } = await supabase
    .from("sheets")
    .select("id,name,ft_per_px,discipline,level,difficulty")
    .eq("project_id", params.id);

  const sheetList =
    (sheets as
      | Pick<
          Sheet,
          "id" | "name" | "ft_per_px" | "discipline" | "level" | "difficulty"
        >[]
      | null) || [];
  const sheetIds = sheetList.map((s) => s.id);
  const ftPerPxBySheetId: Record<string, number> = {};
  for (const s of sheetList) {
    if (s.ft_per_px != null && s.ft_per_px > 0) {
      ftPerPxBySheetId[s.id] = s.ft_per_px;
    }
  }

  let circuits: Circuit[] = [];
  let devices: Device[] = [];
  let routes: Route[] = [];

  if (sheetIds.length) {
    const { data: cktData } = await supabase
      .from("circuits")
      .select("*")
      .in("sheet_id", sheetIds)
      .order("number", { ascending: true });
    circuits = (cktData as Circuit[]) || [];

    const { data: devData } = await supabase
      .from("devices")
      .select("*")
      .in("sheet_id", sheetIds);
    devices = (devData as Device[]) || [];

    const cktIds = circuits.map((c) => c.id);
    const powerRoutes =
      cktIds.length > 0
        ? (
            await supabase.from("routes").select("*").in("circuit_id", cktIds)
          ).data
        : [];
    const lvRoutes = (
      await supabase.from("routes").select("*").in("sheet_id", sheetIds)
    ).data;
    const byId = new Map<string, Route>();
    for (const r of [...((powerRoutes as Route[]) || []), ...((lvRoutes as Route[]) || [])]) {
      byId.set(r.id, r);
    }
    routes = Array.from(byId.values());
  }

  // Estimating DB join — assemblies keyed by normalized name, with item
  // lists for computed pricing. Hours + prices attach client-side in
  // TakeoffView (per-sheet difficulty changes live, no re-route).
  const { data: asmData } = await supabase
    .from("assemblies")
    .select(
      "name,name_normalized,uom,hours_l1,hours_l2,hours_l3,pricing_mode,flat_price, assembly_items(item_id,qty_per_uom)"
    )
    .eq("user_id", user.id);
  const assemblies =
    (asmData as
      | (Pick<
          Assembly,
          | "name"
          | "name_normalized"
          | "uom"
          | "hours_l1"
          | "hours_l2"
          | "hours_l3"
          | "pricing_mode"
          | "flat_price"
        > & { assembly_items: Pick<AssemblyItem, "item_id" | "qty_per_uom">[] })[]
      | null) || [];
  const laborEnabled = assemblies.length > 0;

  const { data: itemsData } = await supabase
    .from("items")
    .select("id,uom,cost_per_uom")
    .eq("user_id", user.id);
  const items =
    (itemsData as
      | { id: string; uom: "EA" | "LF" | "100LF"; cost_per_uom: number }[]
      | null) || [];

  // Rate table: project setting wins, else the default table, else first.
  const { data: rtData } = await supabase
    .from("rate_tables")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  const rateTables = (rtData as RateTable[] | null) || [];
  const rateTable =
    rateTables.find((t) => t.id === settings.rate_table_id) ||
    rateTables.find((t) => t.is_default) ||
    rateTables[0] ||
    null;

  let blended = null;
  if (rateTable) {
    const { data: lcData } = await supabase
      .from("labor_classes")
      .select("*")
      .eq("rate_table_id", rateTable.id);
    blended = blendedRate((lcData as LaborClass[] | null) || []);
  }

  const { lines } = buildProjectTakeoff({
    circuits,
    devices,
    routes,
    settings,
    ftPerPxBySheetId,
    sheets: sheetList.map((s) => ({
      id: s.id,
      name: s.name,
      discipline: s.discipline ?? "power",
      level: s.level ?? "",
    })),
  });

  const joinReport = laborEnabled
    ? assemblyJoinReport(lines, assemblies)
    : { missingKeys: [], computedNoHours: [] };

  const sheetDifficulty = Object.fromEntries(
    sheetList.map((s) => [
      s.id,
      {
        name: s.name,
        difficulty: ((s.difficulty ?? 1) as Difficulty) || 1,
      },
    ])
  );

  const safeName = p.name.replace(/[^\w.-]+/g, "_").slice(0, 48);
  const hasContent = lines.length > 0;

  return (
    <div className="min-h-screen bg-perry-white">
      <AppNav email={user.email} />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              href={`/projects/${p.id}`}
              className="text-xs font-medium text-perry-blue hover:underline"
            >
              ← {p.name}
            </Link>
            <h1 className="mt-2 font-display text-2xl text-perry-industrial">
              Takeoff
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Materials by circuit · branch method:{" "}
              {settings.branch_method.toUpperCase()} · waste {settings.waste_pct}
              %
            </p>
          </div>
        </div>

        {!hasContent ? (
          <div className="mt-10 rounded-lg border border-dashed border-perry-silver bg-white px-6 py-12 text-center">
            <p className="font-display text-lg text-perry-industrial">
              No takeoff yet
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Open a sheet, calibrate, stamp devices, create a circuit, then
              Route — or stamp LV devices (fire, data, thermostats). Quantities
              show up here automatically.
            </p>
            <Link
              href={`/projects/${p.id}`}
              className="mt-4 inline-block text-sm font-semibold text-perry-blue hover:underline"
            >
              ← Back to sheets
            </Link>
          </div>
        ) : (
          <TakeoffView
            lines={lines}
            laborEnabled={laborEnabled}
            joinReport={joinReport}
            csvFilename={`${safeName}_takeoff.csv`}
            pricing={{
              assemblies,
              items,
              blended,
              rateTableName: rateTable?.name ?? null,
              sheets: sheetDifficulty,
            }}
          />
        )}
      </main>
    </div>
  );
}
