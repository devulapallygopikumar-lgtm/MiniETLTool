"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, createUser, deleteUser, listUsers, updateUser } from "@/app/lib/api";
import { useAuth } from "@/app/lib/auth-context";
import { Alert, Breadcrumb, Button, Card, CardBody, CardHeader, FormField } from "@/app/components/ui";
import type { Role, User } from "@/app/lib/types";

const inputClass = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";
const ROLES: Role[] = ["admin", "operations", "reviewer", "auditor"];

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("operations");
  const [creating, setCreating] = useState(false);

  function refresh() {
    listUsers()
      .then(setUsers)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load users."));
  }

  useEffect(refresh, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await createUser({ email, password, role });
      setEmail("");
      setPassword("");
      setRole("operations");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create user.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRoleChange(u: User, newRole: Role) {
    try {
      await updateUser(u.id, { role: newRole });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update role.");
    }
  }

  async function handleActiveToggle(u: User) {
    try {
      await updateUser(u.id, { is_active: !u.is_active });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update user.");
    }
  }

  async function handleDelete(u: User) {
    try {
      await deleteUser(u.id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete user.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Breadcrumb items={[{ label: "Users" }]} />
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="text-sm text-foreground-muted">
          Four roles (ARCHITECTURE.md §11.1): Admin, Operations, Business Reviewer, Auditor.
          Role changes take effect on that user&apos;s next request.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <Card>
        <CardHeader title="Add a user" />
        <CardBody>
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <FormField label="Email" required>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </FormField>
            <FormField label="Password" required>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </FormField>
            <FormField label="Role">
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputClass}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </FormField>
            <Button type="submit" disabled={creating}>
              {creating ? "Adding…" : "Add user"}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="All users" />
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-foreground-muted">
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Active</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-foreground">{u.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u, e.target.value as Role)}
                    disabled={u.id === currentUser?.id}
                    title={u.id === currentUser?.id ? "You can't change your own role" : undefined}
                    className={inputClass}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <Button variant="white" size="sm" onClick={() => handleActiveToggle(u)}>
                    {u.is_active ? "Active" : "Disabled"}
                  </Button>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="white"
                    size="sm"
                    className="text-foreground-muted hover:text-danger"
                    disabled={u.id === currentUser?.id}
                    onClick={() => handleDelete(u)}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
