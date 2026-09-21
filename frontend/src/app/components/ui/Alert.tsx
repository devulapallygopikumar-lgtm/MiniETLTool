import type { ReactNode } from "react";
import { IconCheckCircle, IconInfo, IconWarning, IconXCircle } from "./icons";

type Variant = "danger" | "success" | "warning" | "info";

const VARIANT_CLASSES: Record<Variant, string> = {
  danger: "border-danger/30 bg-danger-soft text-danger",
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  info: "border-border bg-surface-soft text-foreground-muted",
};

const VARIANT_ICONS: Record<Variant, ReactNode> = {
  danger: <IconXCircle />,
  success: <IconCheckCircle />,
  warning: <IconWarning />,
  info: <IconInfo />,
};

export function Alert({
  variant = "danger",
  title,
  children,
}: {
  variant?: Variant;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-md border px-4 py-3 text-sm ${VARIANT_CLASSES[variant]}`}
      role="alert"
    >
      <span className="mt-0.5 shrink-0">{VARIANT_ICONS[variant]}</span>
      <div>
        {title && <div className="font-semibold">{title}</div>}
        <div className={title ? "text-foreground-muted" : ""}>{children}</div>
      </div>
    </div>
  );
}
