"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  createRule,
  deleteRule,
  listRules,
  updateRule,
  type NewRule,
} from "@/app/lib/api";
import type {
  Enforcement,
  OnViolation,
  RuleType,
  SchemaColumn,
  ValidationRule,
} from "@/app/lib/types";

interface Props {
  datasetId: string;
  columns: SchemaColumn[];
}

const RULE_TYPES: { value: RuleType; label: string; scope: "column" | "row_or_dataset" }[] = [
  { value: "not_null", label: "Not null", scope: "column" },
  { value: "type_parse", label: "Type parses", scope: "column" },
  { value: "unique", label: "Unique (dataset)", scope: "row_or_dataset" },
  { value: "expression", label: "Expression", scope: "row_or_dataset" },
];

function emptyDraft(): NewRule {
  return {
    scope: "column",
    column: null,
    rule: "not_null",
    args: {},
    enforcement: "mandatory",
    on_violation: "keep",
  };
}

export function RuleEditor({ datasetId, columns }: Props) {
  const [rules, setRules] = useState<ValidationRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewRule>(emptyDraft());
  const [saving, setSaving] = useState(false);

  function refresh() {
    listRules(datasetId)
      .then(setRules)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load rules.")
      );
  }

  useEffect(refresh, [datasetId]);

  function onRuleTypeChange(rule: RuleType) {
    const meta = RULE_TYPES.find((r) => r.value === rule)!;
    setDraft((d) => ({
      ...d,
      rule,
      scope: meta.scope === "column" ? "column" : d.scope === "column" ? "row" : d.scope,
      column: meta.scope === "column" ? d.column : null,
      args: {},
    }));
  }

  async function submitDraft() {
    setSaving(true);
    setError(null);
    try {
      await createRule(datasetId, draft);
      setDraft(emptyDraft());
      setAdding(false);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save rule.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnforcement(rule: ValidationRule) {
    const enforcement: Enforcement =
      rule.enforcement === "mandatory" ? "move_on" : "mandatory";
    setRules((rs) =>
      rs
        ? rs.map((r) => (r.id === rule.id ? { ...r, enforcement } : r))
        : rs
    );
    try {
      await updateRule(datasetId, rule.id, { enforcement });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update rule.");
      refresh();
    }
  }

  async function changeOnViolation(rule: ValidationRule, on_violation: OnViolation) {
    setRules((rs) =>
      rs ? rs.map((r) => (r.id === rule.id ? { ...r, on_violation } : r)) : rs
    );
    try {
      await updateRule(datasetId, rule.id, { on_violation });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update rule.");
      refresh();
    }
  }

  async function remove(rule: ValidationRule) {
    setRules((rs) => (rs ? rs.filter((r) => r.id !== rule.id) : rs));
    try {
      await deleteRule(datasetId, rule.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete rule.");
      refresh();
    }
  }

  const selectedMeta = RULE_TYPES.find((r) => r.value === draft.rule)!;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Validation rules</h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs font-semibold text-primary hover:text-primary-dark"
          >
            + Add rule
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {rules === null && (
        <p className="text-xs text-foreground-muted">Loading rules…</p>
      )}

      {rules !== null && rules.length === 0 && !adding && (
        <p className="text-xs text-foreground-muted">
          No rules yet. Column and row rules ride the streaming chain; a
          mandatory dataset-scope rule (e.g. uniqueness) causes the run to
          stage before validating.
        </p>
      )}

      {rules !== null && rules.length > 0 && (
        <ul className="mb-3 flex flex-col divide-y divide-border">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="flex-1">
                <span className="font-medium">
                  {RULE_TYPES.find((r) => r.value === rule.rule)?.label ?? rule.rule}
                </span>
                {rule.column && (
                  <span className="text-foreground-muted"> · {rule.column}</span>
                )}
                {rule.rule === "expression" && typeof rule.args.expr === "string" && (
                  <code className="ml-2 rounded bg-surface-soft px-1.5 py-0.5 text-xs">
                    {rule.args.expr}
                  </code>
                )}
                {rule.rule === "unique" && Array.isArray(rule.args.columns) && (
                  <code className="ml-2 rounded bg-surface-soft px-1.5 py-0.5 text-xs">
                    {(rule.args.columns as string[]).join(", ")}
                  </code>
                )}
              </div>

              <label className="flex items-center gap-1.5 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={rule.enforcement === "mandatory"}
                  onChange={() => toggleEnforcement(rule)}
                  className="accent-primary"
                />
                Mandatory
              </label>

              {rule.enforcement === "move_on" && (
                <select
                  value={rule.on_violation}
                  onChange={(e) =>
                    changeOnViolation(rule, e.target.value as OnViolation)
                  }
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                >
                  <option value="keep">Keep row</option>
                  <option value="reject_row">Reject row</option>
                </select>
              )}

              <button
                type="button"
                onClick={() => remove(rule)}
                className="text-xs text-foreground-muted hover:text-danger"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-soft p-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Rule type
              <select
                value={draft.rule}
                onChange={(e) => onRuleTypeChange(e.target.value as RuleType)}
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
              >
                {RULE_TYPES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            {selectedMeta.scope === "column" && (
              <label className="flex flex-col gap-1 text-xs font-medium">
                Column
                <select
                  value={draft.column ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, column: e.target.value || null }))
                  }
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                >
                  <option value="">Select a column</option>
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {draft.rule === "unique" && (
              <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
                Columns (comma-separated)
                <input
                  type="text"
                  placeholder="guid, ledger"
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      scope: "dataset",
                      args: {
                        columns: e.target.value
                          .split(",")
                          .map((c) => c.trim())
                          .filter(Boolean),
                      },
                    }))
                  }
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                />
              </label>
            )}

            {draft.rule === "expression" && (
              <>
                <label className="flex flex-col gap-1 text-xs font-medium">
                  Scope
                  <select
                    value={draft.scope}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        scope: e.target.value as "row" | "dataset",
                      }))
                    }
                    className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                  >
                    <option value="row">Row</option>
                    <option value="dataset">Dataset</option>
                  </select>
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
                  Expression
                  <input
                    type="text"
                    placeholder="effective_date >= voucher_date"
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        args: { expr: e.target.value },
                      }))
                    }
                    className="rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-sm"
                  />
                </label>
              </>
            )}
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs font-medium">
              <input
                type="checkbox"
                checked={draft.enforcement === "mandatory"}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    enforcement: e.target.checked ? "mandatory" : "move_on",
                  }))
                }
                className="accent-primary"
              />
              Mandatory (halts the run at the gate)
            </label>
            {draft.enforcement === "move_on" && (
              <label className="flex items-center gap-1.5 text-xs font-medium">
                On violation
                <select
                  value={draft.on_violation}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      on_violation: e.target.value as OnViolation,
                    }))
                  }
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                >
                  <option value="keep">Keep row</option>
                  <option value="reject_row">Reject row</option>
                </select>
              </label>
            )}
          </div>

          {draft.scope === "dataset" && draft.enforcement === "mandatory" && (
            <p className="text-xs text-warning">
              Mandatory dataset-scope rules force the run to stage the full
              dataset before validating (§7.4).
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={submitDraft}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save rule"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setDraft(emptyDraft());
              }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-foreground-muted hover:bg-surface"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
