import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectSettingsForm } from "@/components/projects/ProjectSettingsForm";
import { UploadSheetForm } from "@/components/projects/UploadSheetForm";
import { AppNav } from "@/components/auth/AppNav";
import type { Project, ProjectSettings, Sheet } from "@/lib/types";

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
        <h1 className="mt-2 font-display text-2xl text-perry-industrial">
          {p.name}
        </h1>

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
                <li className="rounded-lg border border-dashed border-perry-silver bg-white px-4 py-10 text-center text-sm text-gray-500">
                  No sheets yet. Upload a PDF plan page.
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
