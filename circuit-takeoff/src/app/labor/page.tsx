import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/auth/AppNav";
import { LaborLibrary } from "@/components/labor/LaborLibrary";
import type { LaborItem } from "@/lib/labor";

export const metadata: Metadata = {
  title: "Labor library",
};

export default async function LaborPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("labor_items")
    .select("*")
    .order("item_key", { ascending: true });

  return (
    <div className="min-h-screen bg-perry-white">
      <AppNav email={user.email} />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="font-display text-2xl text-perry-industrial">
          Labor library
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-600">
          Enter your company&apos;s labor units or values from a labor manual
          your company is licensed to use. Item names must match takeoff item
          names exactly (e.g. &ldquo;1/2&quot; EMT&rdquo;) to join onto the
          takeoff hours column.
        </p>
        <LaborLibrary
          userId={user.id}
          initialItems={(data as LaborItem[] | null) || []}
        />
      </main>
    </div>
  );
}
