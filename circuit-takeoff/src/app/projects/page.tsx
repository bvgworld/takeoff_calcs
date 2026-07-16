import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewProjectForm } from "@/components/projects/NewProjectForm";
import { DeleteProjectButton } from "@/components/projects/DeleteProjectButton";
import { AppNav } from "@/components/auth/AppNav";
import type { Project } from "@/lib/types";

export default async function ProjectsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-screen bg-perry-white">
      <AppNav email={user.email} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-display text-2xl text-perry-industrial">
            Projects
          </h1>
          <NewProjectForm />
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {(projects as Project[] | null)?.map((p) => (
            <li key={p.id}>
              <div className="flex h-full flex-col rounded-lg border border-perry-silver bg-white p-4 hover:border-perry-blue">
                <Link href={`/projects/${p.id}`} className="flex-1">
                  <h2 className="font-display text-lg text-perry-industrial">
                    {p.name}
                  </h2>
                  <p className="mt-1 text-xs text-gray-500">
                    {new Date(p.created_at).toLocaleString()}
                  </p>
                </Link>
                <div className="mt-3 flex justify-end border-t border-perry-silver/60 pt-2">
                  <DeleteProjectButton
                    projectId={p.id}
                    projectName={p.name}
                  />
                </div>
              </div>
            </li>
          ))}
          {!projects?.length && (
            <li className="sm:col-span-2 rounded-lg border border-dashed border-perry-silver px-4 py-8 text-center text-sm text-gray-500">
              No projects yet. Create one to get started.
            </li>
          )}
        </ul>
      </main>
    </div>
  );
}
