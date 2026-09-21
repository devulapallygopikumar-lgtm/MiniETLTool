# Mini ETL — backend

FastAPI + Postgres engine for the two-day vertical slice (see
`../ARCHITECTURE.md` §20). Single tenant, no auth, one machine — upload a
CSV/Excel/XML file, get one dataset per entity, run it through validation
and, on an open gate, load it.

## Getting started

Requires Python 3.11+ and a Postgres database.

```bash
python -m venv .venv
.venv/Scripts/activate        # or `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt

cp .env.example .env          # point DATABASE_URL at your Postgres instance
alembic upgrade head

uvicorn app.main:app --reload --host localhost --port 8000
```

`--host localhost` matters: uvicorn's default host is IPv4-only
(`127.0.0.1`), but on a machine where `localhost` resolves to IPv6 first
(common on Windows), a browser hitting `::1:8000` would find nothing
listening there. Passing the hostname `localhost` (not the literal IP) has
uvicorn resolve it and bind both `127.0.0.1` and `::1`.

The frontend (`../frontend`) expects the API at `http://localhost:8000` by
default (`NEXT_PUBLIC_API_BASE`).

## Structure

| Path | Purpose |
|---|---|
| `app/models.py` | The six tables from §20.3 hour 1, plus the staging/reject/load row stores |
| `app/readers/` | CSV, Excel (one dataset per sheet), XML (streaming, tag-frequency entity discovery) — all normalize to `dict[str, str \| None]` rows (§4.3) |
| `app/validation.py` | The four rule types from §20.2, evaluated over the staged row set, producing the gate decision (§7.3) |
| `app/expressions.py` | The `expression` rule's small DSL — `between`, `~` (regex), `in`, comparisons, `sum(col) op value` control totals |
| `app/runner.py` | Discovery (fan-out) and run orchestration: parse → stage → validate → gate → load (§20.3 hour 7) |
| `app/routers/` | The REST surface consumed by `frontend/src/app/lib/api.ts` |

## What's deliberately not here yet

Per §20.5: auth/RBAC, a real job queue (runs execute as a FastAPI background
task), scheduling/incremental extraction, checkpointing, upsert/SCD2, the
mapping designer, and multi-tenancy beyond a seeded `tenant_id` column kept
for the hook it provides later (§20.6).

## A note on the XML reader

Tally-style exports are not strictly well-formed XML — they carry numeric
character references to control points (`&#4;`) that XML 1.0 disallows.
`app/readers/xml_reader.py` strips only those before parsing. Entity
discovery is a frequency heuristic (a tag that repeats and has element
children is a record type), not a configured `record_xpath` — good enough
for the slice, and the config-driven version from §4.3 is a natural
next step if a source needs more control.
