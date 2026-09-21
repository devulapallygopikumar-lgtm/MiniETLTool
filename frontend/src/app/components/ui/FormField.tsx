import type { ReactNode } from "react";

export function FormField({
  label,
  required,
  error,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium ${className}`}>
      <span>
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {error && <span className="text-xs font-normal text-danger">{error}</span>}
    </label>
  );
}
