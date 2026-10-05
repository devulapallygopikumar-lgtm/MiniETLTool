"use client";

import { ThemeMenu } from "@/app/components/ThemeMenu";
import { Logo } from "@/app/components/Logo";
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

interface NavItem {
  href: string;
  label: string;
  show: (can: (permission: string) => boolean) => boolean;
}

// Sidebar order. "Discovered" is the page that used to be "Final Datasets";
// "New Entity" the old "Process Data"; "Target Connection" the old
// "Target Dataset".
const ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", show: () => true },
  { href: "/users", label: "Users", show: (can) => can("user:manage") },
  { href: "/clients", label: "Clients", show: () => true },
  { href: "/", label: "Uploads / Datasets", show: () => true },
  { href: "/final", label: "Discovered", show: () => true },
  { href: "/process", label: "New Entity", show: () => true },
  { href: "/target", label: "Target Connection", show: () => true },
  { href: "/mapping", label: "Mapping", show: () => true },
  { href: "/loan-details", label: "Loan details", show: () => true },
  { href: "/audit", label: "Audit", show: () => true },
  { href: "/drop", label: "Drop Datasets", show: (can) => can("dataset:delete") },
];

const COLLAPSE_KEY = "datamigrationtool.sidebar.collapsed";

function UserMenu({ collapsed }: { collapsed: boolean }) {
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
        className="flex w-full items-center gap-2 rounded-md p-1.5 text-left transition-colors hover:bg-surface-soft"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
          {initials(user.email)}
        </span>
        {!collapsed && (
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{user.email}</span>
            <span className="block text-xs capitalize text-foreground-muted">{user.role}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-md border border-border bg-surface p-3 shadow-lg">
          <p className="truncate text-sm font-medium text-foreground">{user.email}</p>
          <span className="mt-1 inline-flex items-center rounded-full bg-surface-soft px-2.5 py-1 text-xs font-semibold capitalize text-foreground-muted">
            {user.role}
          </span>
          {user.domain_name && (
            <p className="mt-2 text-xs text-foreground-muted">Domain: {user.domain_name}</p>
          )}
          <div className="mt-3 border-t border-border pt-3">
            <ThemeMenu />
          </div>
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
  const [collapsed, setCollapsed] = useState(false);

  // Remembered per browser; never required for the sidebar to work.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
  }, []);

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  }

  // The landing page is the product's front door, not a working screen --
  // it owns its own header/wordmark rather than wearing this app chrome.
  // The login page owns its own minimal chrome too.
  if (pathname === "/landing" || pathname === "/login" || !user) return null;

  const items = ITEMS.filter((item) => item.show(can));

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      <div className={`flex items-center py-3 ${collapsed ? "justify-center px-2" : "justify-between px-4"}`}>
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <Logo size={28} />
            DataMigrationTool
          </Link>
        )}
        <button
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-soft hover:text-foreground"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
          </svg>
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary-soft text-primary-dark"
                  : "text-foreground-muted hover:bg-surface-soft hover:text-foreground"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-semibold ${
                  active ? "bg-primary text-white" : "bg-surface-soft"
                }`}
              >
                {item.label[0]}
              </span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-2">
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
