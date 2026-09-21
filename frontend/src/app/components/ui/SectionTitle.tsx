import type { ReactNode } from "react";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
      {children}
    </h3>
  );
}
