// PDF of the Tally verification report -- the same content and layout as the
// printable report page (app/loan-details/report): one section per file no /
// name with its tally figures and ledger entries, the row matched to
// Principal Outstanding shaded pale yellow.

import type { LoanTallyReport, LoanTallyReportLoan, TallyReportStatus } from "@/app/lib/types";

const TITLES: Record<TallyReportStatus, string> = {
  all: "All loans",
  Tallied: "Tallied loans",
  "Not Tallied": "Not Tallied loans",
};

const PALE_YELLOW: [number, number, number] = [254, 249, 195];
const GREEN: [number, number, number] = [21, 128, 61];
const RED: [number, number, number] = [185, 28, 28];
const GREY: [number, number, number] = [92, 92, 99];
const HEAD_FILL: [number, number, number] = [51, 65, 85];

// The PDF's built-in font only has Latin-1 glyphs; anything else would print as junk.
const safe = (v: unknown) =>
  (v === null || v === undefined ? "" : String(v)).replace(/₹/g, "Rs.").replace(/[^\x00-\xFF]/g, "?");

const money = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? ""
    : Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function isMatchedRow(loan: LoanTallyReportLoan, e: Record<string, unknown>): boolean {
  return (
    loan.ledger_date !== null &&
    loan.running_total !== null &&
    String(e.date ?? "") === loan.ledger_date &&
    Math.abs(Number(e.running_balance) - loan.running_total) < 0.005
  );
}

export async function exportTallyReportPdf(report: LoanTallyReport, filename = "tally-report") {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  const bottom = pageH - 14; // leave room for the footer

  // Title block
  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(0);
  doc.text(`Tally verification - ${TITLES[report.status]}`, margin, 14);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...GREY);
  doc.text(
    `${report.loans.length} loan${report.loans.length === 1 ? "" : "s"}  |  ledger entries by file no and name  |  ` +
      `pale yellow row = matched to Principal Outstanding  |  printed ${new Date().toLocaleString()}`,
    margin,
    19
  );
  let y = 25;

  if (report.loans.length === 0) {
    doc.setFontSize(10).setTextColor(0);
    doc.text("Nothing to report. Run Tally In GO first.", margin, y + 6);
  }

  for (const loan of report.loans) {
    // Keep a loan's heading together with the first rows of its table.
    if (y + 42 > bottom) {
      doc.addPage();
      y = 12;
    }

    doc.setDrawColor(200).setLineWidth(0.4).line(margin, y, pageW - margin, y);
    y += 6;

    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(0);
    doc.text(safe(`${loan.file_no} - ${loan.name}`), margin, y);
    doc.setTextColor(...(loan.status === "Tallied" ? GREEN : RED));
    doc.text(loan.status, pageW - margin, y, { align: "right" });
    y += 5;

    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(40);
    doc.text(
      `Principal Outstanding: ${money(loan.principal_outstanding) || "-"}     ` +
        `Ledger Date: ${loan.ledger_date ?? "-"}     ` +
        `Running Total: ${money(loan.running_total) || "-"}     ` +
        `Difference: ${money(loan.difference) || "-"}`,
      margin,
      y
    );
    y += 4.5;

    if (loan.ledgers.length > 0) {
      doc.setFontSize(7.5).setTextColor(...GREY);
      const line = doc.splitTextToSize(
        safe(`Ledger${loan.ledgers.length === 1 ? "" : "s"}: ${loan.ledgers.map((l) => `${l.name} (${l.rows})`).join("  |  ")}`),
        pageW - margin * 2
      );
      doc.text(line, margin, y);
      y += line.length * 3.6 + 1;
    }

    if (loan.entries.length === 0) {
      doc.setFontSize(8.5).setTextColor(...GREY);
      doc.text("No ledger entries found for this loan.", margin, y + 3);
      y += 9;
      continue;
    }

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 14 },
      head: [["Date", "Voucher No", "Type", "Ledger", "Debit", "Credit", "Running Balance", "Narration"]],
      body: loan.entries.map((e) => [
        safe(e.date),
        safe(e.voucher_number),
        safe(e.voucher_type),
        safe(e.ledger_name),
        money(e.debit),
        money(e.credit),
        money(e.running_balance),
        safe(e.narration),
      ]),
      styles: { fontSize: 7.5, cellPadding: 1.6, textColor: 30, lineColor: [226, 226, 222], lineWidth: 0.1, valign: "top" },
      headStyles: { fillColor: HEAD_FILL, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [249, 249, 247] },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 20 },
        2: { cellWidth: 24 },
        3: { cellWidth: 52 },
        4: { cellWidth: 25, halign: "right" },
        5: { cellWidth: 25, halign: "right" },
        6: { cellWidth: 29, halign: "right" },
      },
      // The matched row: pale yellow, bold, whatever the stripe would be.
      didParseCell: (data) => {
        if (data.section === "body" && isMatchedRow(loan, loan.entries[data.row.index])) {
          data.cell.styles.fillColor = PALE_YELLOW;
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    // @ts-expect-error -- lastAutoTable is added to the doc by jspdf-autotable
    y = (doc.lastAutoTable?.finalY ?? y) + 8;
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...GREY);
    doc.text("DataMigrationTool - Tally verification", margin, pageH - 6);
    doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 6, { align: "right" });
  }

  doc.save(`${filename}.pdf`);
}
