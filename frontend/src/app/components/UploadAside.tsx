"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { IconUpload } from "@/app/components/ui";
import { UploadPanel } from "@/app/components/UploadPanel";
import type { Dataset } from "@/app/lib/types";

const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 384;
const WIDTH_KEY = "datamigrationtool.upload.width";
const COLLAPSED_KEY = "datamigrationtool.upload.collapsed";

/** The upload panel beside the datasets grid: collapsible to a thin strip,
 *  and resizable by dragging its left edge (wide screens). Both settings are
 *  remembered per browser, and everything works without that storage. */
export function UploadAside({ onUploaded }: { onUploaded?: (created: Dataset[]) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) setWidth(saved);
    } catch {}
  }, []);

  function save(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }

  function setCollapsedSaved(next: boolean) {
    setCollapsed(next);
    save(COLLAPSED_KEY, next ? "1" : "0");
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    drag.current = { startX: e.clientX, startWidth: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    // The handle is on the left edge, so dragging left makes the panel wider.
    const next = drag.current.startWidth + (drag.current.startX - e.clientX);
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
  }

  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    save(WIDTH_KEY, String(width));
  }

  if (collapsed) {
    return (
      <aside className="shrink-0 lg:self-stretch">
        <button
          onClick={() => setCollapsedSaved(false)}
          title="Open upload panel"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground lg:h-full lg:w-11 lg:flex-col lg:justify-start lg:py-4"
        >
          <IconUpload className="h-4 w-4" />
          <span className="lg:[writing-mode:vertical-rl]">Upload</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="relative w-full shrink-0 lg:w-[var(--upload-w)]" style={{ "--upload-w": `${width}px` } as CSSProperties}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize upload panel"
        title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => {
          setWidth(DEFAULT_WIDTH);
          save(WIDTH_KEY, String(DEFAULT_WIDTH));
        }}
        className="absolute -left-3 top-0 hidden h-full w-2 cursor-col-resize rounded-full transition-colors hover:bg-primary/30 lg:block"
      />
      <UploadPanel onUploaded={onUploaded} onCollapse={() => setCollapsedSaved(true)} />
    </aside>
  );
}
