import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type Variant = "primary" | "secondary" | "white" | "outline" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-dark",
  secondary: "bg-surface-soft text-foreground hover:bg-border",
  white: "border border-border bg-surface text-foreground hover:bg-surface-soft",
  outline: "border border-border bg-transparent text-foreground hover:bg-surface-soft",
  danger: "bg-danger text-white hover:opacity-90",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-5 py-2.5 text-sm gap-2",
};

const ICON_ONLY_SIZE_CLASSES: Record<Size, string> = {
  sm: "p-1.5",
  md: "p-2",
  lg: "p-2.5",
};

interface SharedProps {
  variant?: Variant;
  size?: Size;
  iconOnly?: boolean;
  children?: ReactNode;
}

function classes({ variant = "primary", size = "md", iconOnly }: SharedProps) {
  return [
    "inline-flex items-center justify-center rounded-md font-semibold transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANT_CLASSES[variant],
    iconOnly ? ICON_ONLY_SIZE_CLASSES[size] : SIZE_CLASSES[size],
  ].join(" ");
}

type ButtonProps = SharedProps &
  ComponentPropsWithoutRef<"button"> & { href?: undefined };

type LinkProps = SharedProps &
  ComponentPropsWithoutRef<typeof Link> & { href: string };

export function Button({
  variant,
  size,
  iconOnly,
  className,
  href,
  ...props
}: ButtonProps | LinkProps) {
  const cls = `${classes({ variant, size, iconOnly })} ${className ?? ""}`;
  if (href !== undefined) {
    return <Link className={cls} {...(props as ComponentPropsWithoutRef<typeof Link>)} href={href} />;
  }
  return <button type="button" className={cls} {...(props as ComponentPropsWithoutRef<"button">)} />;
}
