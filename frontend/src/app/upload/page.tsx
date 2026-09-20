"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ApiError, uploadFile } from "@/app/lib/api";
import type { Dataset } from "@/app/lib/types";

const ACCEPTED = ".csv,.tsv,.xlsx,.xls,.xml";

export default function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Dataset[]>([]);

  function pickFile(f: File | null) {
    setFile(f);
    setStatus("idle");
    setError(null);
  }

  async function handleUpload() {
    if (!file) return;
    setStatus("uploading");
    setError(null);
    try {
      const result = await uploadFile(file);
      setCreated(result.datasets);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof ApiError ? err.message : "Upload failed. Try again."
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Upload a source</h1>
        <p className="text-sm text-foreground-muted">
          CSV, Excel or XML. Each sheet, table or record type discovered
          becomes its own dataset with its own mapping (ARCHITECTURE.md §4.5).
        </p>
      </div>

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
        className={`cursor-pointer rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors ${
          dragging
            ? "border-primary bg-primary-soft"
            : "border-border bg-surface hover:bg-surface-soft"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div>
            <p className="font-medium">{file.name}</p>
            <p className="text-sm text-foreground-muted">
              {(file.size / 1024).toFixed(1)} KB — click to choose a different
              file
            </p>
          </div>
        ) : (
          <div>
            <p className="font-medium">Drop a file here, or click to browse</p>
            <p className="text-sm text-foreground-muted">
              Accepted: {ACCEPTED}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!file || status === "uploading"}
          onClick={handleUpload}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "uploading" ? "Uploading…" : "Upload and discover"}
        </button>
        {status === "done" && (
          <span className="text-sm font-medium text-success">
            {created.length} dataset{created.length === 1 ? "" : "s"} created
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {status === "done" && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Datasets created</h2>
          <ul className="flex flex-col gap-2">
            {created.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/datasets/${d.id}`}
                  className="text-sm font-medium text-primary hover:text-primary-dark"
                >
                  {d.name}
                </Link>
                <span className="ml-2 text-xs text-foreground-muted">
                  {d.entity_name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
