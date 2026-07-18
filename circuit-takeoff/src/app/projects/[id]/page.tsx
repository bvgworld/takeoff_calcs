import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectSettingsForm } from "@/components/projects/ProjectSettingsForm";
import { UploadPlanSetForm } from "@/components/projects/UploadPlanSetForm";
import { SheetIndex, type SheetCard } from "@/components/projects/SheetIndex";
import { AppNav } from "@/components/auth/AppNav";
import type { Project, ProjectSettings, Sheet } from "@/lib/types";

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
  return { title: data?.name || "Project" };
}

export default async function ProjectPage({
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

  const { data: sheets } = await supabase
    .from("sheets")
    .select("*")
    .eq("project_id", params.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const p = project as Project;
  const sheetRows = (sheets as Sheet[] | null) || [];

  // Thumbnails (signed raster URLs) + device counts per sheet.
  const { data: signed } = sheetRows.length
    ? await supabase.storage
        .from("plans")
        .createSignedUrls(
          sheetRows.map((s) => s.image_path),
          3600
        )
    : { data: null };
  const signedByPath = new Map(
    (signed || [])
      .filter((x) => x.signedUrl && !x.error)
      .map((x) => [x.path as string, x.signedUrl])
  );

  const counts = await Promise.all(
    sheetRows.map(async (s) => {
      const { count } = await supabase
        .from("devices")
        .select("*", { count: "exact", head: true })
        .eq("sheet_id", s.id);
      return count ?? 0;
    })
  );

  const cards: SheetCard[] = sheetRows.map((s, i) => ({
    id: s.id,
    name: s.name,
    discipline: s.discipline ?? "power",
    level: s.level ?? "",
    sort_order: s.sort_order ?? i + 1,
    ft_per_px: s.ft_per_px,
    image_w: s.image_w,
    image_h: s.image_h,
    thumbUrl: signedByPath.get(s.image_path) ?? null,
    deviceCount: counts[i],
  }));

  return (
    <div className="min-h-screen bg-perry-white">
      <AppNav email={user.email} />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Link
          href="/projects"
          className="text-xs font-medium text-perry-blue hover:underline"
        >
          ← Projects
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl text-perry-industrial">
            {p.name}
          </h1>
          <Link
            href={`/projects/${p.id}/takeoff`}
            className="rounded-md bg-perry-blue px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
          >
            View takeoff
          </Link>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg text-perry-industrial">
                Sheets
              </h2>
              <UploadPlanSetForm projectId={p.id} />
            </div>
            <SheetIndex projectId={p.id} sheets={cards} />
          </section>
          <aside>
            <h2 className="mb-3 font-display text-lg text-perry-industrial">
              Project settings
            </h2>
            <ProjectSettingsForm
              projectId={p.id}
              settings={p.settings as ProjectSettings}
            />
          </aside>
        </div>
      </main>
    </div>
  );
}
