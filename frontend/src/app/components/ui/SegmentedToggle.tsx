// A small button-group radio control — the visual pattern behind the ERP
// style guide's "erp-radio-button-group": each option renders as a pill,
// not a bare native radio, with the active one filled.

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  name,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  name?: string;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-surface-soft p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <label
            key={opt.value}
            className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-primary text-white"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={active}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}
