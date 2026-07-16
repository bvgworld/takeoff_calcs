"use client";

import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const { showError } = useToast();

  async function deleteProject() {
    const supabase = createClient();
    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", projectId);
    if (error) {
      showError(error.message, () => void deleteProject());
      return;
    }
    router.refresh();
  }

  async function onDelete(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const ok = window.confirm(
      `Delete project “${projectName}”? This cannot be undone.`
    );
    if (!ok) return;
    await deleteProject();
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
