import { redirect } from "next/navigation";

/**
 * The labor library was replaced by the Estimating DB (migration 012).
 * labor_items rows were migrated into assemblies (hours → level 1);
 * the table still exists but is no longer written to or shown.
 */
export default function LaborPage() {
  redirect("/estimating");
}
