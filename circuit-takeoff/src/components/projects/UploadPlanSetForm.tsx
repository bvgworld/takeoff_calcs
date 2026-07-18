"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createClient } from "@/lib/supabase/client";
import {
  loadPdfDocument,
  rasterPdfPageFromDoc,
  renderPdfThumbnail,
  TARGET_DPI,
} from "@/lib/pdf";
import {
  buildSheetInserts,
  defaultSheetName,
  DISCIPLINE_LABELS,
  DISCIPLINES,
  planSetPath,
  sha256Hex,
  type Discipline,
  type PlanSetPageInput,
} from "@/lib/plan-sets";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const PNG_WARN_BYTES = 40 * 1024 * 1024;

type Phase = "idle" | "reading" | "picking" | "creating";

type PageState = {
  page: number;
  thumbUrl: string | null;
  checked: boolean;
  name: string;
  discipline: Discipline;
  level: string;
};

type CreateStatus = {
  page: number;
  name: string;
  status: "pending" | "rasterizing" | "uploading" | "done" | "error";
  detail?: string;
};

function isAlreadyExists(message: string): boolean {
  return /already exists|duplicate/i.test(message);
}

export function UploadPlanSetForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { showError } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const fileRef = useRef<File | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [pages, setPages] = useState<PageState[]>([]);
  const [statuses, setStatuses] = useState<CreateStatus[]>([]);
  const [warn, setWarn] = useState("");

  function reset() {
    docRef.current = null;
    fileRef.current = null;
    setPages([]);
    setStatuses([]);
    setWarn("");
    setMsg("");
    setPhase("idle");
  }

  async function onFilePicked(f: File | null) {
    if (!f) return;
    fileRef.current = f;
    setPhase("reading");
    setMsg("Reading PDF…");
    try {
      const doc = await loadPdfDocument(f);
      docRef.current = doc;
      const initial: PageState[] = Array.from(
        { length: doc.numPages },
        (_, i) => ({
          page: i + 1,
          thumbUrl: null,
          checked: false,
          name: defaultSheetName(f.name, i + 1),
          discipline: "power",
          level: "",
        })
      );
      setPages(initial);
      setPhase("picking");
      setMsg(
        `${doc.numPages} page${doc.numPages === 1 ? "" : "s"} — check the pages that become sheets.`
      );
      // Render thumbnails progressively so the grid fills in as it loads.
      for (let p = 1; p <= doc.numPages; p++) {
        try {
          const { dataUrl } = await renderPdfThumbnail(doc, p);
          setPages((prev) =>
            prev.map((x) => (x.page === p ? { ...x, thumbUrl: dataUrl } : x))
          );
        } catch {
          // Leave the placeholder; the page can still be selected.
        }
      }
    } catch (err) {
      console.error(err);
      reset();
      showError(err instanceof Error ? err.message : "Failed to read PDF");
    }
  }

  function patchPage(page: number, patch: Partial<PageState>) {
    setPages((prev) =>
      prev.map((x) => (x.page === page ? { ...x, ...patch } : x))
    );
  }

  function setStatus(page: number, patch: Partial<CreateStatus>) {
    setStatuses((prev) =>
      prev.map((s) => (s.page === page ? { ...s, ...patch } : s))
    );
  }

  async function createSheets() {
    const f = fileRef.current;
    const doc = docRef.current;
    const selected = pages.filter((p) => p.checked);
    if (!f || !doc || !selected.length) return;

    setPhase("creating");
    setWarn("");
    setStatuses(
      selected.map((p) => ({
        page: p.page,
        name: p.name.trim() || defaultSheetName(f.name, p.page),
        status: "pending",
      }))
    );

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      // The source PDF uploads ONCE, keyed by content hash.
      setMsg("Uploading plan set PDF…");
      const bytes = await f.arrayBuffer();
      const hash = (await sha256Hex(bytes)).slice(0, 16);
      const setPath = planSetPath(projectId, hash);
      const { error: pdfErr } = await supabase.storage
        .from("plans")
        .upload(setPath, f, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (pdfErr && !isAlreadyExists(pdfErr.message)) {
        throw new Error(
          `Storage (PDF): ${pdfErr.message}. If this is an RLS error, run supabase/migrations/003_storage_plans_fix_rls.sql in the Supabase SQL editor.`
        );
      }

      const { data: maxRow } = await supabase
        .from("sheets")
        .select("sort_order")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const startSortOrder =
        ((maxRow as { sort_order?: number } | null)?.sort_order ?? 0) + 1;

      const pageInputs: PlanSetPageInput[] = [];
      let bigPng = false;

      for (const p of selected) {
        setStatus(p.page, { status: "rasterizing" });
        setMsg(`Rasterizing page ${p.page} (~${TARGET_DPI} DPI)…`);
        const { blob, width, height, renderDpi } = await rasterPdfPageFromDoc(
          doc,
          p.page
        );
        if (blob.size > PNG_WARN_BYTES) bigPng = true;

        const sheetId = crypto.randomUUID();
        // First folder = auth user id so storage RLS from migration 001/003 matches.
        const imagePath = `${user.id}/${projectId}/${sheetId}/raster.png`;

        setStatus(p.page, { status: "uploading" });
        setMsg(`Uploading page ${p.page} raster…`);
        const { error: imgErr } = await supabase.storage
          .from("plans")
          .upload(imagePath, blob, {
            contentType: "image/png",
            upsert: false,
          });
        if (imgErr) {
          setStatus(p.page, { status: "error", detail: imgErr.message });
          throw new Error(`Storage (PNG p${p.page}): ${imgErr.message}`);
        }

        pageInputs.push({
          sheetId,
          pageNumber: p.page,
          name: p.name.trim() || defaultSheetName(f.name, p.page),
          discipline: p.discipline,
          level: p.level,
          imagePath,
          imageW: width,
          imageH: height,
          renderDpi,
        });
        setStatus(p.page, { status: "done" });
      }

      if (bigPng) {
        setWarn("One or more rasters exceeded 40 MB — uploads may be slow.");
      }

      setMsg("Saving sheets…");
      const rows = buildSheetInserts({
        projectId,
        sourcePdfPath: setPath,
        startSortOrder,
        pages: pageInputs,
      });
      const { error: rowErr } = await supabase.from("sheets").insert(rows);
      if (rowErr) throw new Error(`Database (sheets): ${rowErr.message}`);

      setMsg(`Created ${rows.length} sheet${rows.length === 1 ? "" : "s"}.`);
      reset();
      router.refresh();
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Upload failed";
      setPhase("picking");
      setMsg("");
      showError(message, () => void createSheets());
    }
  }

  const selectedCount = pages.filter((p) => p.checked).length;
  const busy = phase === "reading" || phase === "creating";

  return (
    <>
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
        disabled={busy || phase === "picking"}
        onClick={() => inputRef.current?.click()}
      >
        {phase === "reading" ? "Reading PDF…" : "Upload plans"}
      </Button>

      {(phase === "picking" || phase === "creating") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-perry-industrial/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-perry-silver px-5 py-3">
              <div>
                <h2 className="font-display text-lg text-perry-industrial">
                  Pick pages for this plan set
                </h2>
                <p className="text-xs text-gray-500">{msg}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={phase === "creating"}
                onClick={reset}
              >
                Cancel
              </Button>
            </div>

            {phase === "picking" ? (
              <div className="grid flex-1 gap-3 overflow-auto p-5 sm:grid-cols-2 lg:grid-cols-3">
                {pages.map((p) => (
                  <div
                    key={p.page}
                    className={`rounded-lg border p-2 ${
                      p.checked
                        ? "border-perry-blue bg-blue-50/40"
                        : "border-perry-silver bg-white"
                    }`}
                  >
                    <button
                      type="button"
                      className="block w-full"
                      onClick={() => patchPage(p.page, { checked: !p.checked })}
                    >
                      <div className="flex h-36 items-center justify-center overflow-hidden rounded bg-perry-white">
                        {p.thumbUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={p.thumbUrl}
                            alt={`Page ${p.page}`}
                            className="max-h-full max-w-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-gray-400">
                            Rendering…
                          </span>
                        )}
                      </div>
                    </button>
                    <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-perry-industrial">
                      <input
                        type="checkbox"
                        checked={p.checked}
                        onChange={(e) =>
                          patchPage(p.page, { checked: e.target.checked })
                        }
                      />
                      Page {p.page}
                    </label>
                    {p.checked && (
                      <div className="mt-2 space-y-1.5">
                        <input
                          type="text"
                          value={p.name}
                          onChange={(e) =>
                            patchPage(p.page, { name: e.target.value })
                          }
                          placeholder="Sheet name"
                          className="w-full rounded border border-perry-silver px-2 py-1 text-xs"
                        />
                        <div className="flex gap-1.5">
                          <select
                            value={p.discipline}
                            onChange={(e) =>
                              patchPage(p.page, {
                                discipline: e.target.value as Discipline,
                              })
                            }
                            className="flex-1 rounded border border-perry-silver bg-white px-1.5 py-1 text-xs"
                          >
                            {DISCIPLINES.map((d) => (
                              <option key={d} value={d}>
                                {DISCIPLINE_LABELS[d]}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={p.level}
                            onChange={(e) =>
                              patchPage(p.page, { level: e.target.value })
                            }
                            placeholder="Level"
                            className="w-24 rounded border border-perry-silver px-2 py-1 text-xs"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <ul className="flex-1 space-y-2 overflow-auto p-5">
                {statuses.map((s) => (
                  <li
                    key={s.page}
                    className="flex items-center justify-between rounded-md border border-perry-silver px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-perry-industrial">
                      p{s.page} · {s.name}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        s.status === "done"
                          ? "text-green-700"
                          : s.status === "error"
                            ? "text-perry-signal"
                            : "text-gray-500"
                      }`}
                    >
                      {s.status === "pending"
                        ? "Waiting"
                        : s.status === "rasterizing"
                          ? "Rasterizing…"
                          : s.status === "uploading"
                            ? "Uploading…"
                            : s.status === "done"
                              ? "Done"
                              : (s.detail ?? "Error")}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-perry-silver px-5 py-3">
              <span className="text-xs text-gray-500">
                {warn ||
                  (phase === "picking"
                    ? `${selectedCount} page${selectedCount === 1 ? "" : "s"} selected`
                    : "")}
              </span>
              {phase === "picking" && (
                <Button
                  type="button"
                  disabled={!selectedCount}
                  onClick={() => void createSheets()}
                >
                  Create {selectedCount || ""} sheet
                  {selectedCount === 1 ? "" : "s"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
