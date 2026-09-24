"use client";

// A plain, read-only grid over an arbitrary row shape — used for both the
// raw source preview and the final-loaded-data preview. Not the full
// record review grid from ARCHITECTURE.md §15.1 (inline edit, bulk
// actions, detail drawer are all cut per §20.5); this is its seed.
//
// Grid rules applied wherever this is used: a collapsible panel (to save
// vertical space on a page with several grids), client-side pagination,
// and CSV/Excel/PDF export of every row loaded into this grid instance
// (all pages, not just the visible one) -- but not the full dataset,
// since there's no full-download endpoint behind this.

import { useState } from "react";
import { Button, IconChevronRight, IconDownload, Pagination, usePagination } from "@/app/components/ui";

type Row = Record<string, unknown>;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}

function downloadBlob(content: BlobPart, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(rows: Row[], cols: string[], filename: string) {
  const lines = [
    cols.map(csvEscape).join(","),
    ...rows.map((r) => cols.map((c) => csvEscape(cellText(r[c]))).join(",")),
  ];
  downloadBlob(lines.join("\n"), "text/csv;charset=utf-8", `${filename}.csv`);
}

async function exportExcel(rows: Row[], cols: string[], filename: string) {
  const XLSX = await import("xlsx");
  const data = rows.map((r) => Object.fromEntries(cols.map((c) => [c, cellText(r[c])])));
  const sheet = XLSX.utils.json_to_sheet(data, { header: cols });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  XLSX.writeFile(book, `${filename}.xlsx`);
}

async function exportPdf(rows: Row[], cols: string[], filename: string) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: cols.length > 6 ? "landscape" : "portrait" });
  autoTable(doc, {
    head: [cols],
    body: rows.map((r) => cols.map((c) => cellText(r[c]))),
    styles: { fontSize: 6, cellPadding: 1.5 },
    horizontalPageBreak: true,
  });
  doc.save(`${filename}.pdf`);
}

export function DataGrid({
  rows,
  columns,
  title,
}: {
  rows: Row[];
  columns?: string[];
  title?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);
  const pager = usePagination(rows);
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const filename = (title ?? "data").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "data";

  if (rows.length === 0) {
    return <p className="text-xs text-foreground-muted">No rows to show.</p>;
  }

  async function runExport(kind: "csv" | "excel" | "pdf") {
    if (kind === "csv") {
      exportCsv(rows, cols, filename);
      return;
    }
    setExporting(kind);
    try {
      if (kind === "excel") await exportExcel(rows, cols, filename);
      else await exportPdf(rows, cols, filename);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-foreground"
        >
          <IconChevronRight className={`h-3.5 w-3.5 transition-transform ${collapsed ? "" : "rotate-90"}`} />
          {rows.length.toLocaleString()} row{rows.length === 1 ? "" : "s"}
          {collapsed ? " (collapsed)" : ""}
        </button>
        <div className="flex gap-1.5">
          <Button variant="white" size="sm" onClick={() => runExport("csv")}>
            <IconDownload />
            CSV
          </Button>
          <Button variant="white" size="sm" disabled={exporting === "excel"} onClick={() => runExport("excel")}>
            <IconDownload />
            {exporting === "excel" ? "Exporting…" : "Excel"}
          </Button>
          <Button variant="white" size="sm" disabled={exporting === "pdf"} onClick={() => runExport("pdf")}>
            <IconDownload />
            {exporting === "pdf" ? "Exporting…" : "PDF"}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="max-w-full overflow-auto rounded-md border-2 border-border" style={{ maxHeight: "60vh" }}>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                {cols.map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap border-b-2 border-r border-border px-3 py-2 font-medium last:border-r-0"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map((row, i) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-soft">
                  {cols.map((c) => (
                    <td
                      key={c}
                      className="whitespace-nowrap border-r border-border px-3 py-1.5 text-foreground-muted last:border-r-0"
                    >
                      {cellText(row[c]) || <span className="text-border">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!collapsed && <Pagination pager={pager} />}
    </div>
  );
}
