import type { GateState } from "@/app/lib/types";

const STYLES: Record<GateState, string> = {
  open: "bg-success-soft text-success",
  closed: "bg-danger-soft text-danger",
  pending: "bg-surface-soft text-foreground-muted",
};

const LABELS: Record<GateState, string> = {
  open: "Validation passed",
  closed: "Validation failed",
  pending: "Not validated yet",
};

export function GateBadge({ state }: { state: GateState }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${STYLES[state]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          state === "open"
            ? "bg-success"
            : state === "closed"
            ? "bg-danger"
            : "bg-foreground-muted"
        }`}
      />
      {LABELS[state]}
    </span>
  );
}
