"use client";

// Client-side pagination for every grid in the app. All lists here are
// fetched whole (no server paging behind them), so a page is just a slice
// of the array already in memory. Pair the hook with the bar:
//
//   const pager = usePagination(rows);
//   ...pager.pageItems.map(...)
//   <Pagination pager={pager} />

import { useState } from "react";
import { IconChevronRight } from "./icons";

export const PAGE_SIZES = [10, 25, 50, 100];

export interface Pager<T> {
  pageItems: T[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

export function usePagination<T>(items: T[] | null | undefined, initialPageSize = 25): Pager<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const all = items ?? [];
  const total = all.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // A delete or reload can shrink the list out from under the stored page,
  // so clamp on read rather than trusting it.
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;

  return {
    pageItems: all.slice(start, start + pageSize),
    page: current,
    pageCount,
    pageSize,
    total,
    setPage: (p) => setPage(Math.min(Math.max(1, p), pageCount)),
    setPageSize: (size) => {
      setPageSizeState(size);
      setPage(1);
    },
  };
}

const navButton =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-foreground-muted hover:bg-surface-soft hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

export function Pagination<T>({ pager, className = "" }: { pager: Pager<T>; className?: string }) {
  const { page, pageCount, pageSize, total, setPage, setPageSize } = pager;

  // Nothing to page through at even the smallest page size.
  if (total <= PAGE_SIZES[0]) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

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
                {s}
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
