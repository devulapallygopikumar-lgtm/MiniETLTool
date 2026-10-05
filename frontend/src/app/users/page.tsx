"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, createUser, deleteUser, listDomains, listUsers, updateUser } from "@/app/lib/api";
import { useAuth } from "@/app/lib/auth-context";
import { Alert, Breadcrumb, Button, Card, CardBody, CardHeader, FormField, SortTh, Pagination, usePagination } from "@/app/components/ui";
import type { Domain, Role, User } from "@/app/lib/types";

const inputClass = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";
const ROLES: Role[] = ["admin", "operations", "reviewer", "auditor"];

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const pager = usePagination(users);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domainId, setDomainId] = useState("");
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
  useEffect(() => {
    listDomains().then(setDomains).catch(() => setDomains([]));
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await createUser({ email, password, role, domain_id: domainId || null });
      setEmail("");
      setPassword("");
      setRole("operations");
      setDomainId("");
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

  async function handleDomainChange(u: User, newDomainId: string) {
    try {
      await updateUser(u.id, { domain_id: newDomainId || null });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update domain.");
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
          Role changes take effect on that user&apos;s next request. Everyone except Admin sees only their own uploads; a user&apos;s domain decides which clients they can upload for.
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
            <FormField label="Domain">
              <select value={domainId} onChange={(e) => setDomainId(e.target.value)} className={inputClass}>
                <option value="">— none —</option>
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
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
              <SortTh pager={pager} col="email" className="px-4 py-3 font-medium">Email</SortTh>
              <SortTh pager={pager} col="role" className="px-4 py-3 font-medium">Role</SortTh>
              <SortTh pager={pager} col="domain_name" className="px-4 py-3 font-medium">Domain</SortTh>
              <SortTh pager={pager} col="is_active" className="px-4 py-3 font-medium">Active</SortTh>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {pager.pageItems.map((u) => (
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
                  <select
                    value={u.domain_id ?? ""}
                    onChange={(e) => handleDomainChange(u, e.target.value)}
                    className={inputClass}
                  >
                    <option value="">— none —</option>
                    {domains.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
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
        <Pagination pager={pager} className="px-4 py-3" />
      </Card>
    </div>
  );
}
