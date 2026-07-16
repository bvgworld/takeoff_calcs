"use client";

import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();

  async function onDelete(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const ok = window.confirm(
      `Delete project “${projectName}”? This cannot be undone.`
    );
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", projectId);
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="!text-perry-signal !text-xs"
      onClick={onDelete}
    >
      Delete
    </Button>
  );
}
