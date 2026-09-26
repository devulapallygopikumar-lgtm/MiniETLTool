import type { DatasetState, RunState } from "@/app/lib/types";

type AnyState = DatasetState | RunState;

const STYLES: Record<string, string> = {
  discovered: "bg-surface-soft text-foreground-muted",
  queued: "bg-surface-soft text-foreground-muted",
  validating: "bg-warning-soft text-warning",
  running: "bg-warning-soft text-warning",
  awaiting_approval: "bg-warning-soft text-warning",
  transforming: "bg-warning-soft text-warning",
  loading: "bg-warning-soft text-warning",
  validation_failed: "bg-danger-soft text-danger",
  failed: "bg-danger-soft text-danger",
  cancelled: "bg-surface-soft text-foreground-muted",
  validated: "bg-success-soft text-success",
  approved: "bg-success-soft text-success",
  loaded: "bg-success-soft text-success",
  succeeded: "bg-success-soft text-success",
};

export function StateBadge({ state }: { state: AnyState }) {
  const style = STYLES[state] ?? "bg-surface-soft text-foreground-muted";
  const label = state.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${style}`}
    >
      {label}
    </span>
  );
}
