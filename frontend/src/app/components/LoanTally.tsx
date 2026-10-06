"use client";

// Result of "Tally All": one row per file no -- the Principal Outstanding
// given in the master data against the ledger running total it was matched
// to (see backend app/routers/loan_tally.py for how the row is picked).
// Optionally grouped by Status, one grid per group.

import { useState } from "react";
import { DataGrid } from "@/app/components/DataGrid";
import { SegmentedToggle } from "@/app/components/ui";
import { exportTallyGridPdf } from "@/app/lib/tallyReportPdf";
import type { LoanTallyRow } from "@/app/lib/types";

const COLUMNS = [
  "File No",
  "Name",
  "Principal Outstanding",
  "Ledger Date",
  "Running Total",
  "Difference",
  "Status",
];

// Not Tallied first: that's the group someone has to act on.
const STATUS_ORDER: LoanTallyRow["status"][] = ["Not Tallied", "Tallied"];

const money = (v: number | null) =>
  v === null || v === undefined ? "" : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const toGridRow = (r: LoanTallyRow) => ({
  "File No": r.file_no,
  Name: r.name,
  "Principal Outstanding": money(r.principal_outstanding),
  "Ledger Date": r.ledger_date ?? "",
  "Running Total": money(r.running_total),
  Difference: money(r.difference),
  Status: r.status,
});

// The grid's PDF button: just this grid's rows, in the report's look.
const gridPdf = (rows: LoanTallyRow[], title: string) => async () =>
  exportTallyGridPdf(rows, title, `tally-${title.toLowerCase().replace(/\s+/g, "-")}`);

type View = "none" | "status";

export function LoanTally({ rows }: { rows: LoanTallyRow[] }) {
  const [view, setView] = useState<View>("none");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-foreground-muted">
        <span>Group by</span>
        <SegmentedToggle<View>
          name="tally-group"
          value={view}
          onChange={setView}
          options={[
            { value: "none", label: "None" },
            { value: "status", label: "Status" },
          ]}
        />
      </div>

      {view === "none" ? (
        <DataGrid rows={rows.map(toGridRow)} columns={COLUMNS} title="loan-tally" showAll pdfExport={gridPdf(rows, "All loans")} />
      ) : (
        STATUS_ORDER.map((status) => {
          const group = rows.filter((r) => r.status === status);
          if (group.length === 0) return null;
          return (
            <section key={status} className="flex flex-col gap-2">
              <h3
                className={`flex items-center gap-2 text-sm font-semibold ${
                  status === "Tallied" ? "text-success" : "text-danger"
                }`}
              >
                {status}
                <span className="rounded-full bg-surface-soft px-2 py-0.5 text-xs font-medium text-foreground-muted">
                  {group.length}
                </span>
              </h3>
              <DataGrid
                rows={group.map(toGridRow)}
                columns={COLUMNS}
                title={`loan-tally-${status.toLowerCase().replace(/\s+/g, "-")}`}
                showAll
                pdfExport={gridPdf(group, `${status} loans`)}
              />
            </section>
          );
        })
      )}
    </div>
  );
}
