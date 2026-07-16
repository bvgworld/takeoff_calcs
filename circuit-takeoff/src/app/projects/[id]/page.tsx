import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectSettingsForm } from "@/components/projects/ProjectSettingsForm";
import { AppNav } from "@/components/auth/AppNav";
import type { Project, ProjectSettings } from "@/lib/types";

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
            <h2 className="font-display text-lg text-perry-industrial">
              Sheets
            </h2>
            <div className="mt-3 rounded-lg border border-dashed border-perry-silver bg-white px-4 py-10 text-center text-sm text-gray-500">
              No sheets yet.
            </div>
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
