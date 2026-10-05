"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/app/lib/auth-context";

// Public pages: everything else requires a signed-in user.
const PUBLIC_PATHS = ["/login", "/landing"];

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.includes(pathname ?? "");

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) router.replace("/login");
    else if (user && pathname === "/login") router.replace("/dashboard");
  }, [loading, user, isPublic, pathname, router]);

  // Render nothing protected until the session is confirmed.
  if (loading || (!user && !isPublic) || (user && pathname === "/login")) return null;
  return <>{children}</>;
}
