import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/auth/AppNav";
import { ExportCsvButton } from "@/components/takeoff/ExportCsvButton";
import { buildProjectTakeoff } from "@/lib/takeoff";
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
  const settings = (p.settings as ProjectSettings) || DEFAULT_SETTINGS;

  const { data: sheets } = await supabase
    .from("sheets")
    .select("id,name,ft_per_px")
    .eq("project_id", params.id);

  const sheetList =
    (sheets as Pick<Sheet, "id" | "name" | "ft_per_px">[] | null) || [];
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
    if (cktIds.length) {
      const { data: routeData } = await supabase
        .from("routes")
        .select("*")
        .in("circuit_id", cktIds);
      routes = (routeData as Route[]) || [];
    }
  }

  const { lines, totals } = buildProjectTakeoff({
    circuits,
    devices,
    routes,
    settings,
    ftPerPxBySheetId,
  });

  const byCircuit = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byCircuit.get(line.circuit) || [];
    list.push(line);
    byCircuit.set(line.circuit, list);
  }

  const csvRows = [...lines, ...totals];
  const safeName = p.name.replace(/[^\w.-]+/g, "_").slice(0, 48);

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

        {!circuits.length ? (
          <div className="mt-10 rounded-lg border border-dashed border-perry-silver bg-white px-6 py-12 text-center">
            <p className="font-display text-lg text-perry-industrial">
              No takeoff yet
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Open a sheet, calibrate, stamp devices, create a circuit, then
              Route. Quantities will show up here automatically.
            </p>
            <Link
              href={`/projects/${p.id}`}
              className="mt-4 inline-block text-sm font-semibold text-perry-blue hover:underline"
            >
              ← Back to sheets
            </Link>
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            {Array.from(byCircuit.entries()).map(([ckt, rows]) => (
              <section key={ckt}>
                <h2 className="mb-2 font-display text-lg text-perry-industrial">
                  {ckt}
                </h2>
                <div className="overflow-x-auto rounded-lg border border-perry-silver bg-white">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-perry-silver bg-perry-white text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Item</th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Qty
                        </th>
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
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.qty}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{r.uom}</td>
                          <td className="px-3 py-2 text-gray-600">
                            {r.circuit}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {r.notes}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}

            <section>
              <h2 className="mb-2 font-display text-lg text-perry-industrial">
                Project totals
              </h2>
              <div className="overflow-x-auto rounded-lg border border-perry-silver bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-perry-silver bg-perry-white text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="px-3 py-2 text-right font-semibold">
                        Qty
                      </th>
                      <th className="px-3 py-2 font-semibold">UOM</th>
                      <th className="px-3 py-2 font-semibold">Circuit</th>
                      <th className="px-3 py-2 font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.map((r, i) => (
                      <tr
                        key={`total-${r.item}-${i}`}
                        className="border-b border-perry-silver/60 last:border-0"
                      >
                        <td className="px-3 py-2 font-medium text-perry-industrial">
                          {r.item}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {r.qty}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{r.uom}</td>
                        <td className="px-3 py-2 text-gray-600">TOTAL</td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {r.notes}
                        </td>
                      </tr>
                    ))}
                    {!totals.length && (
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
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
