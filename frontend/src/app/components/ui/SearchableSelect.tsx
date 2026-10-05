"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

export type SearchableOption = { value: string; label: string; disabled?: boolean; title?: string };

type Pos = { top?: number; bottom?: number; left: number; minWidth: number };

// A select with a type-to-filter box, for any list long enough that scrolling
// a native <select> is a chore. The list is position:fixed so it isn't clipped
// by a card or table that scrolls/hides overflow.
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  required,
  title,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<Pos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function toggle() {
    if (open) return close();
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom;
      setPos(
        below < 260 && r.top > below
          ? { bottom: window.innerHeight - r.top + 4, left: r.left, minWidth: r.width }
          : { top: r.bottom + 4, left: r.left, minWidth: r.width }
      );
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !popRef.current?.contains(t)) close();
    }
    // A fixed list would drift away from its button if the page scrolled.
    function onScroll(e: Event) {
      if (!popRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function pick(o: SearchableOption) {
    if (o.disabled) return;
    onChange(o.value);
    close();
  }

  // Width utilities belong on the wrapper (which is what sits in the layout);
  // everything else styles the button like the native select it replaces.
  const wrapperWidth = className
    .split(/\s+/)
    .filter((c) => /^(w|min-w|max-w)-/.test(c))
    .join(" ");

  return (
    <div ref={rootRef} className={`relative inline-block min-w-[7rem] align-middle ${wrapperWidth}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        title={title}
        onClick={toggle}
        className={`flex w-full items-center justify-between gap-2 text-left disabled:opacity-60 ${className}`}
      >
        <span className={`truncate ${selected && selected.value !== "" ? "" : "text-foreground-muted"}`}>
          {selected && selected.value !== "" ? selected.label : selected?.label || placeholder}
        </span>
        <span aria-hidden className="text-xs text-foreground-muted">▾</span>
      </button>
      {required && (
        // Keeps native form validation: an empty value blocks submit.
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={value}
          onChange={() => {}}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      )}
      {open && pos && (
        <div
          ref={popRef}
          style={{ position: "fixed", ...pos }}
          // Most selects sit inside a <label>, and a click on a list item would
          // otherwise be forwarded by the label to the button -- re-opening
          // the list right after a pick closed it.
          onClick={(e) => {
            if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
          }}
          className="z-50 w-max max-w-[28rem] rounded-md border border-border bg-surface text-sm text-foreground shadow-lg"
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "Enter") {
                e.preventDefault();
                const first = matches.find((o) => !o.disabled);
                if (first) pick(first);
              }
            }}
            placeholder="Search…"
            className="w-full rounded-t-md border-b border-border bg-surface px-2 py-1.5 text-sm outline-none"
          />
          <ul role="listbox" className="max-h-60 overflow-auto py-1">
            {matches.length === 0 && <li className="px-2 py-1.5 text-foreground-muted">No matches</li>}
            {matches.map((o) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled}
                title={o.title}
                onClick={() => pick(o)}
                className={`px-2 py-1.5 ${
                  o.disabled ? "cursor-not-allowed text-foreground-muted" : "cursor-pointer hover:bg-surface-soft"
                } ${o.value === value ? "font-medium" : ""}`}
              >
                {o.label || " "}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function collectOptions(children: ReactNode, out: SearchableOption[]) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{
      value?: string | number;
      disabled?: boolean;
      title?: string;
      children?: ReactNode;
    }>;
    if (el.type === Fragment) return collectOptions(el.props.children, out);
    if (el.type !== "option") return;
    const label = textOf(el.props.children);
    out.push({
      value: el.props.value !== undefined ? String(el.props.value) : label,
      label,
      disabled: el.props.disabled,
      title: el.props.title,
    });
  });
}

/** Drop-in for a native `<select>` that has <option> children: same value /
 *  onChange(e.target.value) / disabled / required / title / className, plus a
 *  search box. */
export function Select({
  value,
  onChange,
  children,
  ...rest
}: {
  value: string | number;
  onChange: (e: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
  required?: boolean;
  title?: string;
  className?: string;
}) {
  const options: SearchableOption[] = [];
  collectOptions(children, options);
  return (
    <SearchableSelect
      value={String(value)}
      onChange={(v) => onChange({ target: { value: v } })}
      options={options}
      {...rest}
    />
  );
}
