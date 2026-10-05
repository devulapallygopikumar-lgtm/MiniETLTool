"use client";

import { Select } from "@/app/components/ui/SearchableSelect";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError, listClients, listDomains, uploadFile } from "@/app/lib/api";
import { Alert, Button, Card, CardBody, CardHeader, IconUpload } from "@/app/components/ui";
import type { Client, Dataset, Domain } from "@/app/lib/types";

const ACCEPTED = ".csv,.tsv,.xlsx,.xlsm,.xls,.xml";

/** Pick a client, drop a file, discover datasets. `onUploaded` lets the page
 *  beside it refresh its grid. Callers only render this for users who can
 *  upload; the backend re-checks that on every request. */
export function UploadPanel({
  onUploaded,
  onCollapse,
}: {
  onUploaded?: (created: Dataset[]) => void;
  onCollapse?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Dataset[]>([]);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [clientId, setClientId] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [startRow, setStartRow] = useState(""); // blank = auto-detect
  const [trim, setTrim] = useState(true);
  const isExcel = !!file && /\.(xlsx|xlsm|xls)$/i.test(file.name);

  useEffect(() => {
    listClients().then(setClients).catch(() => setClients([]));
    listDomains().then(setDomains).catch(() => setDomains([]));
  }, []);
  const domainName = (id: string) => domains.find((d) => d.id === id)?.name ?? "";

  function pickFile(f: File | null) {
    setFile(f);
    setStatus("idle");
    setError(null);
  }

  async function handleUpload() {
    if (!file || !clientId) return;
    setStatus("uploading");
    setError(null);
    try {
      const result = await uploadFile(
        file,
        clientId,
        isExcel ? { hasHeader, startRow: startRow ? Math.max(1, parseInt(startRow, 10) || 1) : null, trim } : undefined
      );
      setCreated(result.datasets);
      setStatus("done");
      setFile(null);
      onUploaded?.(result.datasets);
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Upload failed. Try again.");
    }
  }

  return (
    <Card>
      <CardHeader
        title="Upload a source"
        actions={
          onCollapse && (
            <button
              onClick={onCollapse}
              aria-label="Collapse upload panel"
              title="Collapse"
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-soft hover:text-foreground"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          )
        }
      />
      <CardBody className="flex flex-col gap-4">
        <p className="text-xs text-foreground-muted">
          CSV, Excel or XML. Each sheet, table or record type discovered becomes its own dataset.
        </p>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Client
          <Select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-normal"
          >
            <option value="">Select a client…</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {domainName(c.domain_id) ? `${domainName(c.domain_id)} › ` : ""}
                {c.name}
              </option>
            ))}
          </Select>
          {clients !== null && clients.length === 0 && (
            <span className="text-xs font-normal text-foreground-muted">
              No clients yet.{" "}
              <Link href="/clients" className="text-primary hover:text-primary-dark">
                Add a client
              </Link>{" "}
              first.
            </span>
          )}
        </label>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) pickFile(f);
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging ? "border-primary bg-primary-soft" : "border-border bg-surface-soft hover:bg-border/30"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <IconUpload className="mx-auto mb-2 h-6 w-6 text-foreground-muted" />
          {file ? (
            <div>
              <p className="break-all text-sm font-medium">{file.name}</p>
              <p className="text-xs text-foreground-muted">
                {(file.size / 1024).toFixed(1)} KB — click to choose a different file
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium">Drop a file here, or click to browse</p>
              <p className="text-xs text-foreground-muted">Accepted: {ACCEPTED}</p>
            </div>
          )}
        </div>

        {isExcel && (
          <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
            <legend className="px-1 text-xs font-medium text-foreground-muted">Excel options</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              First row contains column names
            </label>
            <label className="flex items-center gap-2">
              <span>{hasHeader ? "Header row number" : "Data starts at row"}</span>
              <input
                type="number"
                min={1}
                value={startRow}
                placeholder="Auto"
                onChange={(e) => setStartRow(e.target.value)}
                className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
              Trim spaces around cell values
            </label>
            <span className="text-xs text-foreground-muted">
              Applies to every sheet. Leave the row number blank to auto-detect it (title rows above the header are skipped); blank rows are always ignored.
            </span>
          </fieldset>
        )}

        <Button disabled={!file || !clientId || status === "uploading"} onClick={handleUpload}>
          {status === "uploading" ? "Uploading…" : "Upload and discover"}
        </Button>

        {error && <Alert>{error}</Alert>}

        {status === "done" && (
          <span className="text-sm font-medium text-success">
            {created.length} dataset{created.length === 1 ? "" : "s"} added to the grid.
          </span>
        )}
      </CardBody>
    </Card>
  );
}
