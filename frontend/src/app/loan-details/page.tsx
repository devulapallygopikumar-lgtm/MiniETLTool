"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, getLoanLedger, getLoanMaster, listLoanContacts } from "@/app/lib/api";
import { Alert, Breadcrumb, Button, Card, CardBody, CardHeader } from "@/app/components/ui";
import { Select } from "@/app/components/ui/SearchableSelect";
import { DataGrid } from "@/app/components/DataGrid";
import type { LoanContact, LoanLedgerMatch, LoanMaster } from "@/app/lib/types";

const selectClass = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm";

// "pan_no" -> "Pan No", "s__no" -> "S No", "guarantor___1" -> "Guarantor 1"
const label = (column: string) =>
  column
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

// Case-insensitive, numbers in natural order: "CL-2" before "CL-10".
const sorted = (values: string[]) =>
  [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

// Long free-text columns get a whole row to themselves.
const FULL_WIDTH = new Set(["address", "address_2", "address_3"]);

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default function LoanDetailsPage() {
  const [contacts, setContacts] = useState<LoanContact[] | null>(null);
  const [name, setName] = useState("");
  const [fileNo, setFileNo] = useState("");

  const [master, setMaster] = useState<LoanMaster | null>(null);
  const [ledger, setLedger] = useState<LoanLedgerMatch | null>(null);
  const [showing, setShowing] = useState<{ name: string; fileNo: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listLoanContacts()
      .then(setContacts)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load names."));
  }, []);

  // The two combos filter each other: a chosen name limits the file nos to
  // that name's, and a chosen file no limits the names to its owner(s).
  const nameOptions = useMemo(
    () => sorted([...new Set((contacts ?? []).filter((c) => !fileNo || c.file_no === fileNo).map((c) => c.name))]),
    [contacts, fileNo]
  );
  const fileOptions = useMemo(
    () => sorted([...new Set((contacts ?? []).filter((c) => !name || c.name === name).map((c) => c.file_no))]),
    [contacts, name]
  );

  // Print only the master data card (see the print rules in globals.css).
  function printMaster() {
    document.body.classList.add("print-master");
    window.print();
    document.body.classList.remove("print-master");
  }

  useEffect(() => {
    const undo = () => document.body.classList.remove("print-master");
    window.addEventListener("afterprint", undo);
    return () => window.removeEventListener("afterprint", undo);
  }, []);

  function clearResult() {
    setMaster(null);
    setLedger(null);
    setShowing(null);
    setError(null);
  }

  function pickName(next: string) {
    setName(next);
    clearResult();
    if (!next) return;
    const files = (contacts ?? []).filter((c) => c.name === next).map((c) => c.file_no);
    if (fileNo && !files.includes(fileNo)) setFileNo("");
    if (files.length === 1) setFileNo(files[0]);
  }

  function pickFile(next: string) {
    setFileNo(next);
    clearResult();
    if (!next) return;
    const owners = [...new Set((contacts ?? []).filter((c) => c.file_no === next).map((c) => c.name))];
    if (name && !owners.includes(name)) setName("");
    if (owners.length === 1) setName(owners[0]);
  }

  async function show() {
    if (!name || !fileNo) return;
    setLoading(true);
    clearResult();
    try {
      const [m, l] = await Promise.all([getLoanMaster(name, fileNo), getLoanLedger(name, fileNo)]);
      setMaster(m);
      setLedger(l);
      setShowing({ name, fileNo });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load loan details.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Breadcrumb items={[{ label: "Loan details" }]} />
        <h1 className="text-xl font-semibold">Loan details</h1>
        <p className="text-sm text-foreground-muted">
          Pick a name and file no to see the loan&apos;s master data and its ledger entries.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <Card>
        <CardHeader title="Select loan" />
        <CardBody className="grid grid-cols-1 items-end gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
            Name
            <Select value={name} onChange={(e) => pickName(e.target.value)} disabled={!contacts} className={selectClass}>
              <option value="">{contacts ? `Select… (${nameOptions.length})` : "Loading…"}</option>
              {nameOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
            File no
            <Select value={fileNo} onChange={(e) => pickFile(e.target.value)} disabled={!contacts} className={selectClass}>
              <option value="">{contacts ? `Select… (${fileOptions.length})` : "Loading…"}</option>
              {fileOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button onClick={show} disabled={!name || !fileNo || loading}>
              {loading ? "Loading…" : "Show"}
            </Button>
            <Button
              variant="white"
              disabled={!name && !fileNo}
              onClick={() => {
                setName("");
                setFileNo("");
                clearResult();
              }}
            >
              Clear
            </Button>
          </div>
        </CardBody>
      </Card>

      {master && showing && (
        <div className="print-area">
          <Card>
            <CardHeader
              title={`Master data — ${showing.name} · ${showing.fileNo}`}
              actions={
                <span className="print:hidden">
                  <Button variant="white" size="sm" onClick={printMaster}>
                    Print
                  </Button>
                </span>
              }
            />
            <CardBody className="grid grid-flow-dense grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-x-4 print:gap-y-2">
              {master.columns.map((c) => (
                <label
                  key={c}
                  className={`flex flex-col gap-1 text-xs font-medium text-foreground-muted ${
                    FULL_WIDTH.has(c) ? "sm:col-span-2 lg:col-span-3 print:col-span-3" : ""
                  }`}
                >
                  {label(c)}
                  <input
                    readOnly
                    value={text(master.row[c])}
                    title={text(master.row[c])}
                    className="rounded-md border border-border bg-surface-soft px-2 py-1.5 text-sm font-normal text-foreground print:hidden"
                  />
                  {/* Print shows plain text, so long values wrap instead of being cut off like in a textbox. */}
                  <span className="hidden min-h-5 break-words border-b border-border pb-0.5 text-sm font-normal text-foreground print:block">
                    {text(master.row[c])}
                  </span>
                </label>
              ))}
            </CardBody>
          </Card>
        </div>
      )}

      {ledger && showing && (
        <Card>
          <CardHeader title="Ledger entries" />
          <CardBody className="flex flex-col gap-3">
            {ledger.method ? (
              <>
                <div className="flex flex-col gap-1 text-sm">
                  <span>
                    Matched by: <span className="font-medium">{ledger.method.label}</span>
                  </span>
                  {ledger.tried.length > 0 && (
                    <span className="text-xs text-foreground-muted">
                      No match with: {ledger.tried.map((t) => t.label).join("; ")}
                    </span>
                  )}
                  <span className="text-xs text-foreground-muted">
                    Ledger{ledger.ledgers.length === 1 ? "" : "s"}:{" "}
                    {ledger.ledgers.map((l) => `${l.name} (${l.rows})`).join(" · ")}
                  </span>
                </div>
                {ledger.truncated && (
                  <Alert variant="warning">Showing only the first {ledger.rows.length.toLocaleString()} entries.</Alert>
                )}
                <DataGrid rows={ledger.rows} title={`${showing.fileNo}-ledger`} showAll wrap maxHeight="120vh" />
              </>
            ) : (
              <p className="text-sm text-foreground-muted">
                No ledger entries matched &ldquo;{showing.name}&rdquo; / &ldquo;{showing.fileNo}&rdquo; with any
                method: {ledger.tried.map((t) => t.label).join("; ")}.
              </p>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
