"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/app/lib/auth-context";
import { Button } from "@/app/components/ui";

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase() || "?";
}

const LINKS = [
  { href: "/", label: "Datasets" },
  { href: "/upload", label: "Upload" },
  { href: "/final", label: "Final Datasets" },
  { href: "/process", label: "Process Data" },
  { href: "/target", label: "Target Dataset" },
  { href: "/audit", label: "Audit" },
];

function UserMenu() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (!user) return null;

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={`${user.email} (${user.role})`}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white transition-opacity hover:opacity-90"
      >
        {initials(user.email)}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 w-56 rounded-md border border-border bg-surface p-3 shadow-lg">
          <p className="truncate text-sm font-medium text-foreground">{user.email}</p>
          <span className="mt-1 inline-flex items-center rounded-full bg-surface-soft px-2.5 py-1 text-xs font-semibold capitalize text-foreground-muted">
            {user.role}
          </span>
          <div className="mt-3 border-t border-border pt-3">
            <Button
              variant="white"
              size="sm"
              className="w-full"
              onClick={() => logout().then(() => router.push("/login"))}
            >
              Sign out
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Nav() {
  const pathname = usePathname();
  const { user, can } = useAuth();

  // The landing page is the product's front door, not a working screen --
  // it owns its own header/wordmark rather than wearing this app chrome.
  // The login page owns its own minimal chrome too.
  if (pathname === "/landing" || pathname === "/login") return null;

  const links = can("user:manage") ? [...LINKS, { href: "/users", label: "Users" }] : LINKS;

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
          Meridian
        </Link>
        <nav className="flex flex-1 gap-1">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary-soft text-primary-dark"
                    : "text-foreground-muted hover:bg-surface-soft hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        {user ? (
          <UserMenu />
        ) : (
          <Button href="/login" variant="white" size="sm">
            Sign in
          </Button>
        )}
      </div>
    </header>
  );
}
