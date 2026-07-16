import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectSettingsForm } from "@/components/projects/ProjectSettingsForm";
import { UploadSheetForm } from "@/components/projects/UploadSheetForm";
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
    .order("created_at", { ascending: true });

  const p = project as Project;

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
              <UploadSheetForm projectId={p.id} />
            </div>
            <ul className="space-y-2">
              {(sheets as Sheet[] | null)?.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/projects/${p.id}/sheets/${s.id}`}
                    className="flex items-center justify-between rounded-lg border border-perry-silver bg-white px-4 py-3 hover:border-perry-blue"
                  >
                    <span className="font-semibold text-perry-industrial">
                      {s.name}
                    </span>
                    <span className="text-xs text-gray-500">
                      {s.image_w}×{s.image_h}px
                    </span>
                  </Link>
                </li>
              ))}
              {!sheets?.length && (
                <li className="rounded-lg border border-dashed border-perry-silver bg-white px-6 py-12 text-center">
                  <p className="font-display text-lg text-perry-industrial">
                    Upload your first sheet
                  </p>
                  <p className="mt-2 text-sm text-gray-500">
                    Choose a PDF plan page. We&apos;ll rasterize it so you can
                    calibrate scale, stamp devices, and route circuits.
                  </p>
                </li>
              )}
            </ul>
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
