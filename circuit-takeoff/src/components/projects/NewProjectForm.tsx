"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { Button } from "@/components/ui/Button";

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("projects")
      .insert({
        name: name.trim(),
        user_id: user.id,
        settings: DEFAULT_SETTINGS,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    setName("");
    router.push(`/projects/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New project name"
        className="rounded-md border border-perry-silver px-3 py-1.5 text-sm"
      />
      <Button type="submit" disabled={busy}>
        Create
      </Button>
    </form>
  );
}
