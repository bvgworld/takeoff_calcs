import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SheetViewer } from "@/components/canvas/SheetViewer";
import type { Project, ProjectSettings, Sheet } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { normalizeRotation } from "@/lib/rotation";

export async function generateMetadata({
  params,
}: {
  params: { id: string; sheetId: string };
}): Promise<Metadata> {
  const supabase = createClient();
  const [{ data: project }, { data: sheet }] = await Promise.all([
    supabase.from("projects").select("name").eq("id", params.id).maybeSingle(),
    supabase
      .from("sheets")
      .select("name")
      .eq("id", params.sheetId)
      .maybeSingle(),
  ]);
  const title = [sheet?.name, project?.name].filter(Boolean).join(" · ");
  return { title: title || "Sheet" };
}

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
    .select("*")
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
  const p = project as Project;

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
              supabase/migrations/003_storage_plans_fix_rls.sql
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
      initialRotation={normalizeRotation(s.rotation ?? 0)}
      initialRenderDpi={s.render_dpi ?? null}
      settings={(p.settings as ProjectSettings) || DEFAULT_SETTINGS}
      title={`${p.name} · ${s.name}`}
      backHref={`/projects/${p.id}`}
    />
  );
}
