"use client";

// Printable verification report for Tally In GO: every loan of the chosen
// status (Tallied / Not Tallied / all) as its own section -- file no, name,
// the tally figures, then that loan's ledger entries. Opened from the Tally
// card's Print buttons; use Print on this page (or Ctrl+P).

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ApiError, getTallyReport } from "@/app/lib/api";
import { Alert, Button } from "@/app/components/ui";
import type { LoanTallyReport, LoanTallyReportLoan, TallyReportStatus } from "@/app/lib/types";

const money = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? ""
    : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const TITLES: Record<TallyReportStatus, string> = {
  all: "All loans",
  Tallied: "Tallied loans",
  "Not Tallied": "Not Tallied loans",
};

// The ledger row the tally matched: same date and running balance.
function isMatchedRow(loan: LoanTallyReportLoan, e: Record<string, unknown>): boolean {
  return (
    loan.ledger_date !== null &&
    loan.running_total !== null &&
    text(e.date) === loan.ledger_date &&
    Math.abs(Number(e.running_balance) - loan.running_total) < 0.005
  );
}

function LoanSection({ loan, pageBreak }: { loan: LoanTallyReportLoan; pageBreak: boolean }) {
  const tallied = loan.status === "Tallied";
  return (
    <section className={`loan-section border-t-2 border-border pt-3 ${pageBreak ? "loan-section--break" : ""}`}>
      <header className="loan-head mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold">
          {loan.file_no} — {loan.name}
        </h2>
        <span className={`text-sm font-semibold ${tallied ? "text-success" : "text-danger"}`}>{loan.status}</span>
      </header>
      <dl className="mb-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-foreground-muted">Principal Outstanding</dt>
          <dd className="font-medium">{money(loan.principal_outstanding) || "—"}</dd>
        </div>
        <div>
          <dt className="text-foreground-muted">Ledger Date</dt>
          <dd className="font-medium">{loan.ledger_date ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-foreground-muted">Running Total</dt>
          <dd className="font-medium">{money(loan.running_total) || "—"}</dd>
        </div>
        <div>
          <dt className="text-foreground-muted">Difference</dt>
          <dd className="font-medium">{money(loan.difference) || "—"}</dd>
        </div>
      </dl>
      {loan.ledgers.length > 0 && (
        <p className="mb-2 text-xs text-foreground-muted">
          Ledger{loan.ledgers.length === 1 ? "" : "s"}: {loan.ledgers.map((l) => `${l.name} (${l.rows})`).join(" · ")}
        </p>
      )}

      {loan.entries.length === 0 ? (
        <p className="mb-3 text-xs text-foreground-muted">No ledger entries found for this loan.</p>
      ) : (
        <table className="mb-3 w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b-2 border-border bg-surface-soft">
              <th className="px-2 py-1 font-semibold">Date</th>
              <th className="px-2 py-1 font-semibold">Voucher No</th>
              <th className="px-2 py-1 font-semibold">Type</th>
              <th className="px-2 py-1 font-semibold">Ledger</th>
              <th className="px-2 py-1 text-right font-semibold">Debit</th>
              <th className="px-2 py-1 text-right font-semibold">Credit</th>
              <th className="px-2 py-1 text-right font-semibold">Running Balance</th>
              <th className="px-2 py-1 font-semibold">Narration</th>
            </tr>
          </thead>
          <tbody>
            {loan.entries.map((e, i) => {
              const matched = isMatchedRow(loan, e);
              return (
                <tr
                  key={i}
                  className={`border-b border-border align-top ${matched ? "tally-hit font-semibold" : ""}`}
                >
                  <td className="whitespace-nowrap px-2 py-1">{text(e.date)}</td>
                  <td className="px-2 py-1">{text(e.voucher_number)}</td>
                  <td className="px-2 py-1">{text(e.voucher_type)}</td>
                  <td className="px-2 py-1">{text(e.ledger_name)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">{money(e.debit)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">{money(e.credit)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">
                    {money(e.running_balance)}
                    {matched && <span title="Row matched to Principal Outstanding"> ◄</span>}
                  </td>
                  <td className="px-2 py-1">{text(e.narration)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ReportBody() {
  const params = useSearchParams();
  const raw = params.get("status");
  const status: TallyReportStatus = raw === "Tallied" || raw === "Not Tallied" ? raw : "all";

  const [report, setReport] = useState<LoanTallyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageBreak, setPageBreak] = useState(false);

  useEffect(() => {
    getTallyReport(status)
      .then(setReport)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to build the report."));
  }, [status]);

  // Only this report prints: everything else on the page is hidden (see the
  // print rules in globals.css). Landscape, since the ledger has many columns.
  useEffect(() => {
    document.body.classList.add("print-master");
    return () => document.body.classList.remove("print-master");
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <style>{`
        /* The row matched to Principal Outstanding: pale yellow, dark text in any
           theme, and forced to print (browsers drop backgrounds by default). */
        .tally-hit td {
          background-color: #fef9c3;
          color: #1c1917;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          .loan-head { break-after: avoid; }
          .loan-section--break { break-before: page; }
          tr { break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <h1 className="text-xl font-semibold">Tally verification report — {TITLES[status]}</h1>
        <label className="ml-auto flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={pageBreak} onChange={(e) => setPageBreak(e.target.checked)} />
          Start each loan on a new page
        </label>
        <Button onClick={() => window.print()} disabled={!report || report.loans.length === 0}>
          Print
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}
      {!error && report === null && (
        <p className="text-sm text-foreground-muted">Preparing the report — gathering every loan&apos;s ledger…</p>
      )}
      {report !== null && report.loans.length === 0 && (
        <p className="text-sm text-foreground-muted">
          Nothing to report{status === "all" ? "" : ` for ${status}`}. Run <b>Tally In GO</b> on the Loan details page
          first.
        </p>
      )}

      {report !== null && report.loans.length > 0 && (
        <div className="print-area flex flex-col gap-4">
          <div>
            <h1 className="hidden text-lg font-semibold print:block">Tally verification — {TITLES[status]}</h1>
            <p className="text-xs text-foreground-muted">
              {report.loans.length} loan{report.loans.length === 1 ? "" : "s"} · ledger entries per file no and name ·
              ◄ marks the row matched to Principal Outstanding · printed {new Date().toLocaleString()}
            </p>
          </div>
          {report.loans.map((loan, i) => (
            <LoanSection key={loan.file_no} loan={loan} pageBreak={pageBreak && i > 0} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TallyReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportBody />
    </Suspense>
  );
}
