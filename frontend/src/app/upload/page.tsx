"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ApiError, uploadFile } from "@/app/lib/api";
import { useAuth } from "@/app/lib/auth-context";
import { Alert, Breadcrumb, Button, Card, CardBody, CardHeader, IconUpload } from "@/app/components/ui";
import type { Dataset } from "@/app/lib/types";

const ACCEPTED = ".csv,.tsv,.xlsx,.xls,.xml";

export default function UploadPage() {
  const { can } = useAuth();
  const canUpload = can("batch:upload");
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
    if (!file || !canUpload) return;
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
      <div className="flex flex-col gap-1">
        <Breadcrumb items={[{ label: "Datasets", href: "/" }, { label: "Upload" }]} />
        <h1 className="text-xl font-semibold">Upload a source</h1>
        <p className="text-sm text-foreground-muted">
          CSV, Excel or XML. Each sheet, table or record type discovered
          becomes its own dataset with its own mapping (ARCHITECTURE.md §4.5).
        </p>
      </div>

      {!canUpload && (
        <Alert>Your role doesn&apos;t include upload access -- ask an Admin or Operations user to upload.</Alert>
      )}

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (canUpload) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!canUpload) return;
              const f = e.dataTransfer.files?.[0];
              if (f) pickFile(f);
            }}
            onClick={() => canUpload && inputRef.current?.click()}
            aria-disabled={!canUpload}
            className={`rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors ${
              !canUpload
                ? "cursor-not-allowed border-border bg-surface-soft opacity-60"
                : dragging
                ? "cursor-pointer border-primary bg-primary-soft"
                : "cursor-pointer border-border bg-surface-soft hover:bg-border/30"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              disabled={!canUpload}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <IconUpload className="mx-auto mb-2 h-6 w-6 text-foreground-muted" />
            {file ? (
              <div>
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-foreground-muted">
                  {(file.size / 1024).toFixed(1)} KB — click to choose a
                  different file
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
            <Button
              disabled={!file || !canUpload || status === "uploading"}
              onClick={handleUpload}
            >
              {status === "uploading" ? "Uploading…" : "Upload and discover"}
            </Button>
            {status === "done" && (
              <span className="text-sm font-medium text-success">
                {created.length} dataset{created.length === 1 ? "" : "s"} created
              </span>
            )}
          </div>

          {error && <Alert>{error}</Alert>}
        </CardBody>
      </Card>

      {status === "done" && (
        <Card>
          <CardHeader title="Datasets created" />
          <CardBody>
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
          </CardBody>
        </Card>
      )}
    </div>
  );
}
