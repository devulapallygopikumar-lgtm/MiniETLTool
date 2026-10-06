// PDF of the Tally grid: just the rows the grid shows (File No, Name,
// Principal Outstanding, Ledger Date, Running Total, Difference, Status), laid
// out like the verification report -- title block, dark table header, striped
// rows, coloured status, page footer. The ledger entries live in the Print
// report option, not here.

import type { LoanTallyRow } from "@/app/lib/types";

const GREEN: [number, number, number] = [21, 128, 61];
const RED: [number, number, number] = [185, 28, 28];
const GREY: [number, number, number] = [92, 92, 99];
const HEAD_FILL: [number, number, number] = [51, 65, 85];

// The PDF's built-in font only has Latin-1 glyphs; anything else would print as junk.
const safe = (v: unknown) =>
  (v === null || v === undefined ? "" : String(v)).replace(/₹/g, "Rs.").replace(/[^\x00-\xFF]/g, "?");

const money = (v: number | null) =>
  v === null || v === undefined
    ? ""
    : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `title` names the grid ("All loans", "Not Tallied loans", ...); `filename` has no extension. */
export async function exportTallyGridPdf(rows: LoanTallyRow[], title: string, filename: string) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;

  const tallied = rows.filter((r) => r.status === "Tallied").length;

  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(0);
  doc.text(`Tally - ${title}`, margin, 14);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...GREY);
  doc.text(
    `${rows.length} loan${rows.length === 1 ? "" : "s"}  |  ${tallied} Tallied, ${rows.length - tallied} Not Tallied  |  ` +
      `Difference = Principal Outstanding - Running Total  |  printed ${new Date().toLocaleString()}`,
    margin,
    19
  );

  autoTable(doc, {
    startY: 24,
    margin: { left: margin, right: margin, bottom: 14 },
    head: [["File No", "Name", "Principal Outstanding", "Ledger Date", "Running Total", "Difference", "Status"]],
    body: rows.map((r) => [
      safe(r.file_no),
      safe(r.name),
      money(r.principal_outstanding),
      safe(r.ledger_date),
      money(r.running_total),
      money(r.difference),
      r.status,
    ]),
    styles: { fontSize: 8.5, cellPadding: 2, textColor: 30, lineColor: [226, 226, 222], lineWidth: 0.1 },
    headStyles: { fillColor: HEAD_FILL, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [249, 249, 247] },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 40, halign: "right" },
      3: { cellWidth: 28 },
      4: { cellWidth: 36, halign: "right" },
      5: { cellWidth: 32, halign: "right" },
      6: { cellWidth: 28 },
    },
    // Right-align the numeric headings too, and colour the status.
    didParseCell: (data) => {
      if (data.section === "head" && [2, 4, 5].includes(data.column.index)) data.cell.styles.halign = "right";
      if (data.section === "body" && data.column.index === 6) {
        data.cell.styles.textColor = data.cell.raw === "Tallied" ? GREEN : RED;
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...GREY);
    doc.text("DataMigrationTool - Tally", margin, pageH - 6);
    doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 6, { align: "right" });
  }

  doc.save(`${filename}.pdf`);
}
