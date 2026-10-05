"use client";

// Client-side paging + sorting for every grid in the app. All lists here are
// fetched whole (no server paging behind them), so sorting and paging just
// reorder/slice the array already in memory. Pair the hook with the bar and
// sortable headers:
//
//   const pager = usePagination(rows);
//   <SortTh pager={pager} col="name">Name</SortTh>
//   ...pager.pageItems.map(...)
//   <Pagination pager={pager} />

import { useMemo, useState, type ReactNode } from "react";
import { IconChevronRight } from "./icons";

export const ALL_ROWS = 0; // page size meaning "every row on one page"
export const PAGE_SIZES = [10, 25, 50, 100, ALL_ROWS];

export type SortDir = "asc" | "desc";

export interface Pager<T> {
  pageItems: T[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  sortKey: string | null;
  sortDir: SortDir;
  /** Click cycle per column: ascending -> descending -> unsorted. */
  toggleSort: (key: string, value?: (item: T) => unknown) => void;
}

function blank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Blanks always last; numbers numerically; everything else as text with
 *  natural number ordering ("Run 2" before "Run 10"). */
function compare(a: unknown, b: unknown): number {
  if (blank(a) || blank(b)) return blank(a) ? (blank(b) ? 0 : 1) : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function usePagination<T>(items: T[] | null | undefined, initialPageSize = 25): Pager<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [sort, setSort] = useState<{ key: string; dir: SortDir; value?: (item: T) => unknown } | null>(null);

  const all = useMemo(() => {
    const list = items ?? [];
    if (!sort) return list;
    const get = sort.value ?? ((item: T) => (item as Record<string, unknown>)[sort.key]);
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((x, y) => {
      const vx = get(x);
      const vy = get(y);
      // Keep blanks at the bottom in both directions.
      if (blank(vx) || blank(vy)) return compare(vx, vy);
      return sign * compare(vx, vy);
    });
  }, [items, sort]);

  const total = all.length;
  const size = pageSize === ALL_ROWS ? Math.max(total, 1) : pageSize;
  const pageCount = Math.max(1, Math.ceil(total / size));

  // A delete or reload can shrink the list out from under the stored page,
  // so clamp on read rather than trusting it.
  const current = Math.min(page, pageCount);
  const start = (current - 1) * size;

  return {
    pageItems: all.slice(start, start + size),
    page: current,
    pageCount,
    pageSize,
    total,
    setPage: (p) => setPage(Math.min(Math.max(1, p), pageCount)),
    setPageSize: (s) => {
      setPageSizeState(s);
      setPage(1);
    },
    sortKey: sort?.key ?? null,
    sortDir: sort?.dir ?? "asc",
    toggleSort: (key, value) => {
      setSort((prev) =>
        prev?.key !== key ? { key, dir: "asc", value } : prev.dir === "asc" ? { key, dir: "desc", value } : null
      );
      setPage(1);
    },
  };
}

/** A header cell that sorts its grid. `value` picks what to sort by when
 *  it isn't simply item[col] (formatted or derived columns). */
export function SortTh<T>({
  pager,
  col,
  value,
  className = "px-4 py-3 font-medium",
  children,
}: {
  pager: Pager<T>;
  col: string;
  value?: (item: T) => unknown;
  className?: string;
  children: ReactNode;
}) {
  const active = pager.sortKey === col;
  return (
    <th className={className} aria-sort={active ? (pager.sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => pager.toggleSort(col, value)}
        title="Sort"
        className={`inline-flex items-center gap-1 uppercase tracking-[inherit] hover:text-foreground ${
          active ? "text-foreground" : ""
        }`}
      >
        {children}
        <span aria-hidden className={`text-[10px] ${active ? "" : "opacity-30"}`}>
          {active ? (pager.sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

const navButton =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-foreground-muted hover:bg-surface-soft hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

export function Pagination<T>({ pager, className = "" }: { pager: Pager<T>; className?: string }) {
  const { page, pageCount, pageSize, total, setPage, setPageSize } = pager;

  // Nothing to page through at even the smallest page size.
  if (total <= PAGE_SIZES[0]) return null;

  const size = pageSize === ALL_ROWS ? total : pageSize;
  const first = (page - 1) * size + 1;
  const last = Math.min(page * size, total);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-muted ${className}`}
    >
      <span>
        {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-foreground"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s === ALL_ROWS ? "All" : s}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={navButton}
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            title="Previous page"
          >
            <IconChevronRight className="h-3.5 w-3.5 rotate-180" />
          </button>
          <span className="min-w-[4.5rem] text-center">
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            className={navButton}
            onClick={() => setPage(page + 1)}
            disabled={page >= pageCount}
            aria-label="Next page"
            title="Next page"
          >
            <IconChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
