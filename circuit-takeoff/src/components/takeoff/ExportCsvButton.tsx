"use client";

import { takeoffToCsv, type TakeoffLine } from "@/lib/takeoff";
import { Button } from "@/components/ui/Button";

export function ExportCsvButton({
  lines,
  filename,
}: {
  lines: TakeoffLine[];
  filename: string;
}) {
  return (
    <Button
      type="button"
      onClick={() => {
        const csv = takeoffToCsv(lines);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      Export CSV
    </Button>
  );
}
