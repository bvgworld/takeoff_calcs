"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pdfFirstPageToPng } from "@/lib/pdf";
import { Button } from "@/components/ui/Button";

export function UploadSheetForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setMsg("Rasterizing PDF…");
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { blob, width, height } = await pdfFirstPageToPng(file, 150);
      setMsg("Uploading…");

      const stamp = crypto.randomUUID();
      const base = `${user.id}/${projectId}/${stamp}`;
      const pdfPath = `${base}.pdf`;
      const imagePath = `${base}.png`;

      const { error: pdfErr } = await supabase.storage
        .from("plans")
        .upload(pdfPath, file, { contentType: "application/pdf" });
      if (pdfErr) throw pdfErr;

      const { error: imgErr } = await supabase.storage
        .from("plans")
        .upload(imagePath, blob, { contentType: "image/png" });
      if (imgErr) throw imgErr;

      const name = file.name.replace(/\.pdf$/i, "") || "Sheet";
      const { data: sheet, error: rowErr } = await supabase
        .from("sheets")
        .insert({
          project_id: projectId,
          name,
          pdf_path: pdfPath,
          image_path: imagePath,
          image_w: width,
          image_h: height,
        })
        .select("id")
        .single();
      if (rowErr) throw rowErr;

      router.push(`/projects/${projectId}/sheets/${sheet.id}`);
      router.refresh();
    } catch (err) {
      console.error(err);
      setMsg(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        disabled={busy}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Working…" : "Upload PDF"}
      </Button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </div>
  );
}
