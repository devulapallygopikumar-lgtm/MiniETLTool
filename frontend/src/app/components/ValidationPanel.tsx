import Link from "next/link";
import { GateBadge } from "@/app/components/GateBadge";
import type { GateState, ValidationResult } from "@/app/lib/types";

interface Props {
  gateState: GateState;
  results: ValidationResult[];
  runId: string | null;
  live?: boolean;
}

export function ValidationPanel({ gateState, results, runId, live }: Props) {
  const mandatoryBlocking = results.filter(
    (r) => r.enforcement === "mandatory" && r.violations > 0
  );
  const columnHeat = results
    .filter((r) => r.scope === "column" && r.column && r.violations > 0)
    .sort((a, b) => b.violations - a.violations);
  const maxViolations = columnHeat[0]?.violations ?? 0;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 lg:sticky lg:top-4 lg:self-start">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Validation gate</h2>
        <GateBadge state={gateState} />
      </div>

      {gateState === "closed" && (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
          {mandatoryBlocking.length} mandatory rule
          {mandatoryBlocking.length === 1 ? "" : "s"} blocking. Nothing has
          been transformed or loaded.
        </p>
      )}
      {gateState === "open" && (
        <p className="rounded-md bg-success-soft px-3 py-2 text-xs text-success">
          All mandatory rules pass.
        </p>
      )}
      {gateState === "pending" && (
        <p className="rounded-md bg-surface-soft px-3 py-2 text-xs text-foreground-muted">
          No run yet — validation results appear after the first run.
        </p>
      )}

      {live && runId && (
        <Link
          href={`/runs/${runId}`}
          className="text-xs font-semibold text-primary hover:text-primary-dark"
        >
          Watch live run →
        </Link>
      )}

      {results.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            Rules
          </h3>
          <ul className="flex flex-col gap-1.5">
            {[...results]
              .sort((a, b) => {
                const aBlocking = a.enforcement === "mandatory" && a.violations > 0;
                const bBlocking = b.enforcement === "mandatory" && b.violations > 0;
                if (aBlocking !== bBlocking) return aBlocking ? -1 : 1;
                return b.violations - a.violations;
              })
              .map((r) => (
                <li
                  key={r.rule_id}
                  className="flex items-center justify-between rounded-md bg-surface-soft px-2.5 py-1.5 text-xs"
                >
                  <span className="truncate">
                    <span className="font-medium">{r.rule}</span>
                    {r.column && (
                      <span className="text-foreground-muted"> · {r.column}</span>
                    )}
                  </span>
                  <span
                    className={`ml-2 shrink-0 font-semibold ${
                      r.violations > 0
                        ? r.enforcement === "mandatory"
                          ? "text-danger"
                          : "text-warning"
                        : "text-success"
                    }`}
                  >
                    {r.violations}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {columnHeat.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            Column heat
          </h3>
          <ul className="flex flex-col gap-1.5">
            {columnHeat.map((r) => (
              <li key={r.rule_id} className="text-xs">
                <div className="mb-0.5 flex justify-between">
                  <span>{r.column}</span>
                  <span className="text-foreground-muted">{r.violations}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-soft">
                  <div
                    className="h-full rounded-full bg-danger"
                    style={{
                      width: `${(r.violations / maxViolations) * 100}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
