"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getPdfPageCount, rasterPdfPage } from "@/lib/pdf";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

type Phase =
  | "idle"
  | "reading"
  | "pick-page"
  | "rasterizing"
  | "uploading-pdf"
  | "uploading-png"
  | "saving"
  | "error";

export function UploadSheetForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { showError } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(1);

  async function onFilePicked(f: File | null) {
    if (!f) return;
    setFile(f);
    setPhase("reading");
    setMsg("Reading PDF…");
    setProgress(5);
    try {
      const n = await getPdfPageCount(f);
      setPageCount(n);
      setPage(1);
      if (n > 1) {
        setPhase("pick-page");
        setMsg(`${n} pages — choose which page to use as the sheet.`);
        setProgress(10);
      } else {
        await runUpload(f, 1);
      }
    } catch (err) {
      console.error(err);
      setPhase("error");
      setMsg(err instanceof Error ? err.message : "Failed to read PDF");
    }
  }

  async function runUpload(f: File, pageNumber: number) {
    setPhase("rasterizing");
    setMsg(`Rasterizing page ${pageNumber} (~150 DPI)…`);
    setProgress(20);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { blob, width, height } = await rasterPdfPage(f, pageNumber, 150);
      setProgress(45);

      const sheetId = crypto.randomUUID();
      // First folder = auth user id so storage RLS from migration 001/003 matches.
      const base = `${user.id}/${projectId}/${sheetId}`;
      const pdfPath = `${base}/source.pdf`;
      const imagePath = `${base}/raster.png`;

      setPhase("uploading-pdf");
      setMsg("Uploading PDF…");
      const { error: pdfErr } = await supabase.storage
        .from("plans")
        .upload(pdfPath, f, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (pdfErr) {
        throw new Error(
          `Storage (PDF): ${pdfErr.message}. If this is an RLS error, run supabase/migrations/003_storage_plans_fix_rls.sql in the Supabase SQL editor.`
        );
      }
      setProgress(70);

      setPhase("uploading-png");
      setMsg("Uploading PNG…");
      const { error: imgErr } = await supabase.storage
        .from("plans")
        .upload(imagePath, blob, {
          contentType: "image/png",
          upsert: false,
        });
      if (imgErr) {
        throw new Error(`Storage (PNG): ${imgErr.message}`);
      }
      setProgress(90);

      setPhase("saving");
      setMsg("Saving sheet…");
      const name =
        (f.name.replace(/\.pdf$/i, "") || "Sheet") +
        (pageCount > 1 ? ` · p${pageNumber}` : "");

      const { data: sheet, error: rowErr } = await supabase
        .from("sheets")
        .insert({
          id: sheetId,
          project_id: projectId,
          name,
          pdf_path: pdfPath,
          image_path: imagePath,
          image_w: width,
          image_h: height,
        })
        .select("id")
        .single();
      if (rowErr) {
        throw new Error(`Database (sheets): ${rowErr.message}`);
      }

      setProgress(100);
      setMsg("Done");
      router.push(`/projects/${projectId}/sheets/${sheet.id}`);
      router.refresh();
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Upload failed";
      setPhase("error");
      setMsg(message);
      showError(message, () => {
        if (file) void runUpload(file, pageNumber);
      });
    }
  }

  const busy =
    phase === "reading" ||
    phase === "rasterizing" ||
    phase === "uploading-pdf" ||
    phase === "uploading-png" ||
    phase === "saving";

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          void onFilePicked(f);
        }}
      />
      <Button
        type="button"
        disabled={busy || phase === "pick-page"}
        onClick={() => inputRef.current?.click()}
      >
        Upload sheet
      </Button>

      {phase === "pick-page" && file && (
        <div className="w-full max-w-sm rounded-lg border border-perry-silver bg-white p-3 text-left shadow-sm">
          <p className="text-xs text-gray-600">{msg}</p>
          <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Page
            <select
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-perry-silver px-2 py-1.5 text-sm font-normal normal-case"
            >
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Page {n} of {pageCount}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPhase("idle");
                setFile(null);
                setMsg("");
                setProgress(0);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void runUpload(file, page)}
            >
              Rasterize & upload
            </Button>
          </div>
        </div>
      )}

      {busy && (
        <div className="w-full max-w-sm">
          <div className="h-1.5 overflow-hidden rounded-full bg-perry-silver/40">
            <div
              className="h-full bg-perry-blue transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">{msg}</p>
        </div>
      )}

      {phase === "error" && (
        <p className="max-w-sm text-xs text-perry-signal">{msg}</p>
      )}
    </div>
  );
}
