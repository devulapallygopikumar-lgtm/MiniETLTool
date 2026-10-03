"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  createClient,
  createDomain,
  deleteClient,
  deleteDomain,
  listClients,
  listDomains,
} from "@/app/lib/api";
import { useAuth } from "@/app/lib/auth-context";
import { Alert, Breadcrumb, Button, Card, CardBody, CardHeader, FormField } from "@/app/components/ui";
import type { Client, Domain } from "@/app/lib/types";

const inputClass = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";

export default function ClientsPage() {
  const { user, can } = useAuth();
  const isAdmin = can("user:manage");
  const canWrite = can("batch:upload");
  const canDelete = can("client:delete");
  const [domains, setDomains] = useState<Domain[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [domainName, setDomainName] = useState("");
  const [form, setForm] = useState({ name: "", contact_name: "", contact_email: "", contact_phone: "", notes: "" });
  const [clientDomainId, setClientDomainId] = useState("");

  function fail(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
  }

  function refresh() {
    listDomains().then(setDomains).catch((e) => fail(e, "Failed to load domains."));
    listClients().then(setClients).catch((e) => fail(e, "Failed to load clients."));
  }

  useEffect(refresh, []);

  async function handleAddDomain(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createDomain(domainName);
      setDomainName("");
      refresh();
    } catch (err) {
      fail(err, "Failed to add domain.");
    }
  }

  async function handleAddClient(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createClient({
        ...form,
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        notes: form.notes || null,
        domain_id: isAdmin ? clientDomainId : undefined,
      });
      setForm({ name: "", contact_name: "", contact_email: "", contact_phone: "", notes: "" });
      refresh();
    } catch (err) {
      fail(err, "Failed to add client.");
    }
  }

  async function handleDeleteClient(c: Client) {
    setError(null);
    try {
      await deleteClient(c.id);
      refresh();
    } catch (err) {
      fail(err, "Failed to delete client.");
    }
  }

  async function handleDeleteDomain(d: Domain) {
    setError(null);
    try {
      await deleteDomain(d.id);
      refresh();
    } catch (err) {
      fail(err, "Failed to delete domain.");
    }
  }

  const noDomain = !isAdmin && !user?.domain_id;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Breadcrumb items={[{ label: "Clients" }]} />
        <h1 className="text-xl font-semibold">Clients</h1>
        <p className="text-sm text-foreground-muted">
          Domain → Client → Uploads. Every upload belongs to a client of your domain.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {noDomain && <Alert>You aren&apos;t assigned to a domain yet -- ask an Admin to assign you one.</Alert>}

      {isAdmin && (
        <Card>
          <CardHeader title="Domains" />
          <CardBody className="flex flex-col gap-3">
            <form onSubmit={handleAddDomain} className="flex flex-wrap items-end gap-3">
              <FormField label="New domain" required>
                <input required value={domainName} onChange={(e) => setDomainName(e.target.value)} className={inputClass} />
              </FormField>
              <Button type="submit">Add domain</Button>
            </form>
            <ul className="flex flex-wrap gap-2">
              {domains.map((d) => (
                <li key={d.id} className="flex items-center gap-2 rounded-full bg-surface-soft px-3 py-1 text-sm">
                  {d.name}
                  <button
                    onClick={() => handleDeleteDomain(d)}
                    className="text-foreground-muted hover:text-danger"
                    title="Delete (only if it has no users or clients)"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {canWrite && !noDomain && (
        <Card>
          <CardHeader title="Add a client" />
          <CardBody>
            <form onSubmit={handleAddClient} className="flex flex-wrap items-end gap-3">
              {isAdmin && (
                <FormField label="Domain" required>
                  <select required value={clientDomainId} onChange={(e) => setClientDomainId(e.target.value)} className={inputClass}>
                    <option value="">Select…</option>
                    {domains.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </FormField>
              )}
              <FormField label="Client name" required>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
              </FormField>
              <FormField label="Contact">
                <input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className={inputClass} />
              </FormField>
              <FormField label="Email">
                <input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className={inputClass} />
              </FormField>
              <FormField label="Phone">
                <input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className={inputClass} />
              </FormField>
              <FormField label="Notes">
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClass} />
              </FormField>
              <Button type="submit">Add client</Button>
            </form>
          </CardBody>
        </Card>
      )}

      {domains.map((d) => {
        const rows = clients.filter((c) => c.domain_id === d.id);
        return (
          <Card key={d.id}>
            <CardHeader title={`${d.name} — ${rows.length} client${rows.length === 1 ? "" : "s"}`} />
            {rows.length === 0 ? (
              <p className="px-4 py-4 text-sm text-foreground-muted">No clients yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-foreground-muted">
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 font-medium">Notes</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium">{c.name}</td>
                      <td className="px-4 py-3 text-foreground-muted">
                        {[c.contact_name, c.contact_email, c.contact_phone].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-foreground-muted">{c.notes ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        {canDelete && (
                          <Button
                            variant="white"
                            size="sm"
                            className="text-foreground-muted hover:text-danger"
                            onClick={() => handleDeleteClient(c)}
                          >
                            Delete
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        );
      })}
    </div>
  );
}
