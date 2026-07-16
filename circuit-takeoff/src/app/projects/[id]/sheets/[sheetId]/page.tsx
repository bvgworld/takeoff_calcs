import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SheetWorkspace } from "@/components/sheet/SheetWorkspace";
import type { Circuit, Device, Project, Route, Sheet } from "@/lib/types";

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

  const { data: devices } = await supabase
    .from("devices")
    .select("*")
    .eq("sheet_id", params.sheetId);

  const { data: circuits } = await supabase
    .from("circuits")
    .select("*")
    .eq("sheet_id", params.sheetId);

  const cktIds = ((circuits as Circuit[]) || []).map((c) => c.id);
  let routeRows: Route[] = [];
  if (cktIds.length) {
    const { data } = await supabase
      .from("routes")
      .select("*")
      .in("circuit_id", cktIds);
    routeRows = (data as Route[]) || [];
  }

  const { data: signed } = await supabase.storage
    .from("plans")
    .createSignedUrl((sheet as Sheet).image_path, 60 * 60 * 4);

  return (
    <SheetWorkspace
      project={project as Project}
      sheet={sheet as Sheet}
      initialDevices={(devices as Device[]) || []}
      initialCircuits={(circuits as Circuit[]) || []}
      initialRoutes={routeRows}
      imageUrl={signed?.signedUrl || ""}
    />
  );
}
