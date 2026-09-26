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
import { useAuth } from "@/app/lib/auth-context";
import type {
  Enforcement,
  OnViolation,
  RuleType,
  SchemaColumn,
  ValidationRule,
} from "@/app/lib/types";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  FormField,
  IconPlus,
  SegmentedToggle,
} from "@/app/components/ui";

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

const ENFORCEMENT_OPTIONS: { value: Enforcement; label: string }[] = [
  { value: "mandatory", label: "Mandatory" },
  { value: "move_on", label: "Move-on" },
];

const inputClass =
  "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";

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
  const { can } = useAuth();
  const canManage = can("validation:manage");
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
    if (!canManage) return;
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

  async function changeEnforcement(rule: ValidationRule, enforcement: Enforcement) {
    if (!canManage) return;
    setRules((rs) =>
      rs ? rs.map((r) => (r.id === rule.id ? { ...r, enforcement } : r)) : rs
    );
    try {
      await updateRule(datasetId, rule.id, { enforcement });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update rule.");
      refresh();
    }
  }

  async function changeOnViolation(rule: ValidationRule, on_violation: OnViolation) {
    if (!canManage) return;
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
    if (!canManage) return;
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
    <Card>
      <CardHeader
        title="Validation rules"
        actions={
          !adding && canManage && (
            <Button variant="white" size="sm" onClick={() => setAdding(true)}>
              <IconPlus />
              Add rule
            </Button>
          )
        }
      />

      <div className="p-4">
        {error && (
          <div className="mb-3">
            <Alert>{error}</Alert>
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
              <li key={rule.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
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

                <SegmentedToggle
                  name={`enforcement-${rule.id}`}
                  options={ENFORCEMENT_OPTIONS}
                  value={rule.enforcement}
                  onChange={(v) => changeEnforcement(rule, v)}
                />

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

                {canManage && (
                  <Button
                    variant="white"
                    size="sm"
                    className="border-0 !px-0 !py-0 text-foreground-muted hover:bg-transparent hover:text-danger"
                    onClick={() => remove(rule)}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-soft p-3">
            <div className="flex flex-wrap gap-3">
              <FormField label="Rule type">
                <select
                  value={draft.rule}
                  onChange={(e) => onRuleTypeChange(e.target.value as RuleType)}
                  className={inputClass}
                >
                  {RULE_TYPES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </FormField>

              {selectedMeta.scope === "column" && (
                <FormField label="Column">
                  <select
                    value={draft.column ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, column: e.target.value || null }))
                    }
                    className={inputClass}
                  >
                    <option value="">Select a column</option>
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}

              {draft.rule === "unique" && (
                <FormField label="Columns (comma-separated)" className="flex-1">
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
                    className={inputClass}
                  />
                </FormField>
              )}

              {draft.rule === "expression" && (
                <>
                  <FormField label="Scope">
                    <select
                      value={draft.scope}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          scope: e.target.value as "row" | "dataset",
                        }))
                      }
                      className={inputClass}
                    >
                      <option value="row">Row</option>
                      <option value="dataset">Dataset</option>
                    </select>
                  </FormField>
                  <FormField label="Expression" className="flex-1">
                    <input
                      type="text"
                      placeholder="effective_date >= voucher_date"
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          args: { expr: e.target.value },
                        }))
                      }
                      className={`${inputClass} font-mono`}
                    />
                  </FormField>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground-muted">
                  Enforcement
                </span>
                <SegmentedToggle
                  name="draft-enforcement"
                  options={ENFORCEMENT_OPTIONS}
                  value={draft.enforcement}
                  onChange={(v) => setDraft((d) => ({ ...d, enforcement: v }))}
                />
              </div>
              {draft.enforcement === "move_on" && (
                <FormField label="On violation">
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
                </FormField>
              )}
            </div>

            {draft.scope === "dataset" && draft.enforcement === "mandatory" && (
              <Alert variant="warning">
                Mandatory dataset-scope rules force the run to stage the full
                dataset before validating (§7.4).
              </Alert>
            )}

            <div className="flex gap-2">
              <Button size="sm" disabled={saving} onClick={submitDraft}>
                {saving ? "Saving…" : "Save rule"}
              </Button>
              <Button
                variant="white"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  setDraft(emptyDraft());
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
