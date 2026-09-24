"use client";

// The same "grid rules" DataGrid applies (collapsible, scrollable, a
// clearly visible border, capped to the screen instead of stretching the
// page) for the simpler list tables elsewhere in the app -- Datasets,
// Final Datasets, Audit, Target Dataset, Process Data, run history, a
// run's validation results. A drop-in replacement for `<Card><CardHeader
// .../><table>...</table></Card>`.

import { useState, type ReactNode } from "react";
import { IconChevronRight } from "./icons";

export function CollapsibleCard({
  title,
  actions,
  footer,
  children,
  maxHeight = "60vh",
  defaultCollapsed = false,
  className = "",
}: {
  title: ReactNode;
  actions?: ReactNode;
  /** Rendered below the scroll area, e.g. a <Pagination> bar. */
  footer?: ReactNode;
  children: ReactNode;
  maxHeight?: string;
  defaultCollapsed?: boolean;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className={`rounded-lg border-2 border-border bg-surface overflow-hidden ${className}`}>
      <div className="flex items-center gap-3 border-b-2 border-border bg-surface-soft px-4 py-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex min-w-0 items-center gap-2 text-sm font-semibold"
        >
          <IconChevronRight
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
          <span className="truncate">{title}</span>
        </button>
        <span className="flex-1" />
        {actions}
      </div>
      {!collapsed && (
        <div className="overflow-auto" style={{ maxHeight }}>
          {children}
        </div>
      )}
      {!collapsed && footer && (
        <div className="border-t-2 border-border bg-surface-soft px-4 py-2 empty:hidden">{footer}</div>
      )}
    </div>
  );
}
