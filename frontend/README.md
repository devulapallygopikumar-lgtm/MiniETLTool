# Meridian — frontend

Next.js App Router client for the ETL & reporting platform, scoped to the
two-day vertical slice (see `../ARCHITECTURE.md` §20). Single tenant, no
auth — every page is `'use client'` and talks to the backend only through
`src/app/lib/api.ts`.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # point NEXT_PUBLIC_API_BASE at the API
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app degrades
gracefully with a connection-error banner if the backend isn't running yet.

## Structure

| Path | Purpose |
|---|---|
| `src/app/lib/types.ts` | Data model trimmed to what the slice's API returns |
| `src/app/lib/api.ts` | The only place that calls `fetch()` against the backend |
| `src/app/page.tsx` | Dataset list, gate status per dataset (§20.4) |
| `src/app/upload/page.tsx` | Upload → discovery → one dataset per entity (§4.5) |
| `src/app/datasets/[id]/page.tsx` | Dataset page: docked validation panel + rule editor + schema |
| `src/app/runs/[id]/page.tsx` | Run monitor: poll every 2s, per-rule results, failing-row sample, reject download |
| `src/app/audit/page.tsx` | Append-only audit log viewer |
| `src/app/components/` | `ValidationPanel` (gate + rule table + column heat), `RuleEditor` (Mandatory/Move-on), badges |

## What's deliberately not here yet

Per §20.5: auth/RBAC, the full record review grid, analytical dashboards,
the DAG mapping designer, mapplets, schedules, multi-tenancy. The API client
and data model already carry the hooks called out in §20.6 (`gate_state`,
rule `enforcement`, etc.) so these slot in later without rework.
