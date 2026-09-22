// A plain, read-only grid over an arbitrary row shape — used for both the
// raw source preview and the final-loaded-data preview. Not the full
// record review grid from ARCHITECTURE.md §15.1 (inline edit, bulk
// actions, detail drawer are all cut per §20.5); this is its seed.

type Row = Record<string, unknown>;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function DataGrid({ rows, columns }: { rows: Row[]; columns?: string[] }) {
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));

  if (rows.length === 0) {
    return <p className="text-xs text-foreground-muted">No rows to show.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
          <tr>
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-soft">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-1.5 text-foreground-muted">
                  {cellText(row[c]) || <span className="text-border">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
