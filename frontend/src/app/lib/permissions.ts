// Mirrors backend/app/permissions.py's matrix exactly (same reason
// schemas.py mirrors this file's types today). This only decides what
// the UI shows/hides -- the backend re-checks every one of these
// server-side on every request; nothing here is the real protection.

import type { Role } from "./types";

const ADMIN: Role[] = ["admin"];
const ADMIN_OPS: Role[] = ["admin", "operations"];
const ADMIN_REVIEWER: Role[] = ["admin", "reviewer"];
const ALL: Role[] = ["admin", "operations", "reviewer", "auditor"];

export const PERMISSIONS: Record<string, Role[]> = {
  "user:manage": ADMIN,
  "tenant:manage": ADMIN,
  "product:manage": ADMIN,
  "validation:manage": ADMIN,
  "format_rule:manage": ADMIN,
  "db_connection:manage": ADMIN,
  "product:read": ALL,
  "db_connection:read": ALL,
  "batch:read": ALL,
  "batch:upload": ADMIN_OPS,
  "batch:retry": ADMIN_OPS,
  "record:approve": ADMIN_REVIEWER,
  "batch:approve": ADMIN_REVIEWER,
  "audit:read": ["admin", "auditor"],
};

export function can(role: Role | undefined, permission: string): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] ?? []).includes(role);
}
