import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/auth/AppNav";
import { ExportCsvButton } from "@/components/takeoff/ExportCsvButton";
import { TakeoffView } from "@/components/takeoff/TakeoffView";
import { buildProjectTakeoff } from "@/lib/takeoff";
import type { LaborRow } from "@/lib/labor";
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
    .select("id,name,ft_per_px,discipline,level")
    .eq("project_id", params.id);

  const sheetList =
    (sheets as
      | Pick<Sheet, "id" | "name" | "ft_per_px" | "discipline" | "level">[]
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

  const { data: laborData } = await supabase
    .from("labor_items")
    .select("item_key,uom,hours_per_uom")
    .eq("user_id", user.id);
  const laborItems = (laborData as LaborRow[] | null) || [];
  const laborEnabled = laborItems.length > 0;

  const { lines, totals } = buildProjectTakeoff({
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
    ...(laborEnabled ? { laborItems } : {}),
  });

  const csvRows = [...lines, ...totals];
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
          <ExportCsvButton
            lines={csvRows}
            filename={`${safeName}_takeoff.csv`}
          />
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
            grandTotals={totals}
            laborEnabled={laborEnabled}
          />
        )}
      </main>
    </div>
  );
}
