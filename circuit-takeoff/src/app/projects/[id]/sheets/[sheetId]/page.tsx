import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SheetViewer } from "@/components/canvas/SheetViewer";
import type { Project, Sheet } from "@/lib/types";

export default async function SheetPage({
  params,
}: {
  params: { id: string; sheetId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", params.id)
    .single();
  if (!project) notFound();

  const { data: sheet } = await supabase
    .from("sheets")
    .select("*")
    .eq("id", params.sheetId)
    .eq("project_id", params.id)
    .single();
  if (!sheet) notFound();

  const s = sheet as Sheet;
  const p = project as Pick<Project, "id" | "name">;

  const { data: signed } = await supabase.storage
    .from("plans")
    .createSignedUrl(s.image_path, 60 * 60 * 4);

  if (!signed?.signedUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-perry-white p-6">
        <div className="text-center">
          <p className="text-sm text-perry-signal">
            Could not load sheet image URL. If uploads fail, run{" "}
            <code className="text-xs">
              supabase/migrations/002_storage_plans_by_project.sql
            </code>
            .
          </p>
          <Link
            href={`/projects/${p.id}`}
            className="mt-3 inline-block text-sm text-perry-blue"
          >
            ← Back to project
          </Link>
        </div>
      </div>
    );
  }

  return (
    <SheetViewer
      sheetId={s.id}
      imageUrl={signed.signedUrl}
      imageW={s.image_w}
      imageH={s.image_h}
      initialFtPerPx={s.ft_per_px}
      title={`${p.name} · ${s.name}`}
      backHref={`/projects/${p.id}`}
    />
  );
}
