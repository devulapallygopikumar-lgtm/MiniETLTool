# Running Mini ETL

How to set up, start, verify and operate the app locally. This is the
execution process, not the design — see [ARCHITECTURE.md](ARCHITECTURE.md)
for that.

The stack: FastAPI + SQLAlchemy + Alembic backend, Postgres, Next.js
frontend. No auth, single tenant, single user — everything below assumes
a local machine, not a shared environment.

## Prerequisites

- **Postgres 16** running as a service, reachable on whatever host/port
  you'll put in `DATABASE_URL`.
- **Python 3.12+** with `venv`.
- **Node.js 20+** with `npm`.

## One-time setup

### 1. Database

Create the database the backend will use (name matches `DATABASE_URL`'s
path below):

```sql
CREATE DATABASE mini_etl;
```

### 2. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
copy .env.example .env
```

Edit `.env` — at minimum, point `DATABASE_URL` at your Postgres instance:

```
DATABASE_URL=postgresql+psycopg://<user>:<password>@<host>:<port>/mini_etl
ALLOWED_ORIGIN=http://localhost:3000
UPLOAD_DIR=./data/uploads
SCHEMA_SAMPLE_ROWS=10000
ISSUE_SAMPLE_CAP=100
```

A password containing special characters (`@`, `#`, etc.) must be
URL-encoded in `DATABASE_URL` — e.g. `asa@123` becomes `asa%40123`.

Apply migrations:

```powershell
.\.venv\Scripts\alembic.exe upgrade head
```

### 3. Frontend

```powershell
cd frontend
npm install
copy .env.local.example .env.local   # optional -- defaults to http://localhost:8000
```

## Running it

Two processes, both need to be up. Run each in its own terminal (or
background them — see the Windows notes below if you do).

**Backend** (from `backend/`):

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host localhost --port 8000
```

**Frontend** — for local development, with hot reload:

```powershell
npm run dev
```

— or, to run the production build (what's actually deployed):

```powershell
npm run build
npm start -- -p 3000
```

## Verifying it's up

```powershell
Invoke-WebRequest http://localhost:8000/health         # -> {"status":"ok"}
Invoke-WebRequest http://localhost:3000/                # -> 200
```

Then open **http://localhost:3000** in a browser.

## Using it

1. **Upload** a CSV/Excel/XML file — the backend discovers one dataset per
   entity found in it (sheet, table, record type).
2. Open a dataset, optionally add **validation rules** and **transforms**,
   then **Run** it. A run stages, validates (opens/closes the gate),
   transforms, and loads — landing rows in both the `loaded_rows` table
   and a real typed Postgres table per dataset.
3. Once a dataset has loaded at least once it shows up under
   **Final Datasets**.
4. **Process Data** builds a new entity (sort/group-by/join/dedupe/window/
   pivot/unpivot) from one or two final datasets — the result is itself a
   new dataset that runs through the same pipeline.
5. **Target Dataset** is a registry of external RDBMS connections
   (Postgres/MySQL/SQL Server) you can save and test — metadata only for
   now, nothing loads into them yet.
6. **Audit** shows the full append-only history of what happened.

## Resetting data

- **Delete one dataset**: the Delete action on its row on the Datasets
  page — removes just that dataset and everything it owns.
- **Delete everything**: the Danger Zone at the bottom of the Datasets
  page — wipes every dataset, rule, transform, run and the entire audit
  log, back to an empty system. Confirms with an explicit yes/no before
  doing anything.

## Windows notes (from actually running this)

- **Prefer PowerShell over the Bash tool's Git Bash** for anything beyond
  file edits. In this environment Git Bash's `$PATH` sometimes carries raw
  Windows-style paths it can't resolve, so basics like `git`, `curl`, even
  `which` silently fail with "command not found" while PowerShell works
  fine against the exact same install.
- **`npm` is a `.cmd` file**, not a native exe — `Start-Process -FilePath
  npm` fails with "not a valid Win32 application". Wrap it:
  `Start-Process cmd.exe -ArgumentList "/c","npm start -- -p 3000 > out.log 2>&1"`.
- **Multiple local Postgres installs** can coexist on different ports
  (this machine has 9.1, 9.2 and 16 side by side) — double-check
  `DATABASE_URL`'s port against `Get-Service postgresql*` and the
  instance you actually intend to use, not just the Postgres default of
  5432.
- `next start` requires `next build` to have already produced a
  `.next/BUILD_ID` — running `start` against a stale or missing build
  serves old pages or fails outright. Rebuild after any frontend change
  before restarting the production server.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Frontend loads but every page shows "Could not reach the API" | Backend isn't running, or `NEXT_PUBLIC_API_BASE` / `ALLOWED_ORIGIN` don't match where each side actually is |
| `uvicorn` exits immediately | Postgres isn't running, or `DATABASE_URL` is wrong (bad port, unencoded special character in the password, database doesn't exist yet) |
| A run stays `queued` forever | The backend process handling `BackgroundTasks` died or was restarted mid-run — check the backend's own log, then re-run |
| New route/page returns 404 in production | Frontend is running `next start` against a build made before that page existed — rebuild |
