Act as a **Senior Full-Stack Engineer and Security Architect** extending an existing, already-running application.

You are working inside **Mini ETL** (`D:\Gopi\Projects\Data Migration\Mini ETL`, repo `devulapallygopikumar-lgtm/MiniETLTool`). Read `ARCHITECTURE.md` §8 (Multi-tenant SaaS model), §11 (Security), and §20.5–20.8 (what was cut from the two-day build and the order to add it back) before touching any code — this prompt exists to implement a slice of what those sections already designed, not to invent a new model.

## CRITICAL INSTRUCTION

**Do NOT rebuild, rewrite, or replace the existing application.** The engine (readers, transforms, validation gate, runner) is out of scope and must not change. This task touches only: auth, the four-role permission system, the audit log's actor field, and the routers/pages that need a permission check added.

---

# 1. What already exists (verified — confirm before relying on it, do not re-derive from scratch)

```text
Backend:            FastAPI (uvicorn), routers under backend/app/routers/*.py,
                     prefix pattern: APIRouter(prefix="/api/v1/<resource>", tags=[...])
Frontend:            Next.js App Router, all pages 'use client', src/app/<feature>/
Database:            PostgreSQL
ORM:                 SQLAlchemy 2.0 (Mapped[...] declarative style), backend/app/models.py
Migrations:          Alembic, backend/migrations/versions/, sequential (0001..0008 exist —
                     next one is 0009_*)
Authentication:      NONE. backend/app/audit.py hardcodes ACTOR = "local" with the comment
                     "single-user slice — no auth (§20.5)". There is no User model, no
                     login route, no session/token handling anywhere in the codebase.
Authorization:       NONE. No role checks exist on any endpoint.
Current "tenant" model: every table has a tenant_id column defaulting to
                     settings.default_tenant_id = "default" (backend/app/config.py).
                     This is the deliberate §20.6-#1 hook for future multi-tenancy — it is
                     NOT real multi-tenancy yet (no RLS, no per-request resolution, no
                     tenant switching). Do not build out §8's tenancy tiers, billing,
                     quotas, or RLS in this task — that is explicitly a separate ~4-week
                     project (§20.8 step 9). Leave tenant_id exactly as it is; just don't
                     break it.
Validation:          Pydantic v2 schemas in backend/app/schemas.py.
Error handling:      raise HTTPException(<status>, "<message>") inline in routers; helper
                     functions named get_<x>_or_404(db, id) exist per router (see
                     datasets.py:33). Follow this pattern, don't introduce a new one.
Audit:               backend/app/audit.py -> audit.log(db, action, resource_type,
                     resource_id, outcome="success", reason=None) writes an AuditEvent row.
                     Already wired into most mutating endpoints. Extend it; do not replace it.
API client:          frontend/src/app/lib/api.ts (fetch calls) and types.ts (shared types).
                     All new backend calls must be added here, per the project's own
                     CLAUDE.md convention — never inline fetch() in a page.
Testing:             NONE. No pytest, no jest test script, no test files outside
                     site-packages. package.json has no "test" script.
Backend deps
(requirements.txt):  fastapi, uvicorn, sqlalchemy, psycopg, alembic, pydantic-settings,
                     openpyxl, xlrd, pymysql, python-tds. No password-hashing or JWT
                     library is present — you will need to add exactly two:
                     passlib[bcrypt] (or bcrypt directly) and python-jose[cryptography]
                     (or pyjwt). Justify the pick in your Phase 2 plan; don't add both.
```

**Relevant existing modules to modify:** `backend/app/main.py` (router registration), `backend/app/models.py`, `backend/app/schemas.py`, `backend/app/audit.py`, every router in `backend/app/routers/` that performs a mutation, `frontend/src/app/lib/api.ts`, `frontend/src/app/lib/types.ts`, `frontend/src/app/layout.tsx`.

**New files you will likely need:** an auth router, a users/roles admin router, a `deps.py` (or similar) holding the auth/permission FastAPI dependencies, a new Alembic migration, a frontend login page, a frontend auth context/hook, and (since none exists) a `backend/tests/` directory with pytest + `httpx.AsyncClient`/`TestClient`.

Before writing code, re-verify this section against the actual files — this is a snapshot from inspection, not a guarantee it is still accurate by the time you run.

---

# 2. Objective

Add **real authentication** and the **four-role permission system Mini ETL's own architecture already specifies** in `ARCHITECTURE.md` §11.1, replacing the hardcoded `ACTOR = "local"`. This is *not* a new design — implement the one already written down. Full multi-tenancy (§8) is explicitly deferred; this task only needs to work correctly for the single seeded tenant that exists today, in a way that does not block multi-tenancy from landing later.

Do NOT introduce the generic "Client / Domain / Task / Developer" ownership hierarchy sometimes used for RBAC prompts — those entities do not exist in this application and inventing them would create a parallel object model next to the real one (Tenant → Connection / SourceBundle → Dataset → Mapping → Run → Batch/Record). Map every requirement onto the nouns that actually exist.

---

# 3. Roles and permissions (from ARCHITECTURE.md §11.1 — reproduced here as the spec)

Four roles, global per user (not scoped to a sub-resource like a "domain" — this system is flatter than a domain-assignment model, which is why there is no per-resource admin-assignment table):

```text
Admin              System configuration, users, roles, connections. Full access.
Operations         Uploads files, triggers/retries processing, manages batches.
Business Reviewer  Reviews records, corrects and approves or rejects. Cannot upload.
Auditor            Read-only across records, audit log and reports. Changes nothing.
```

Permission matrix (names are the ones to use in code — mirror the existing style of short, colon-namespaced strings):

| Permission | Admin | Operations | Reviewer | Auditor |
|---|---|---|---|---|
| `tenant:manage`, `user:manage`, `role_access:manage` | ✓ | – | – | – |
| `product:manage`, `mapping:manage`, `validation:manage`, `duplicate:manage`, `format_rule:manage`, `db_connection:manage` | ✓ | – | – | – |
| `product:read`, `mapping:read`, `db_connection:read`, `batch:read`, `record:read` | ✓ | ✓ | ✓ | ✓ |
| `batch:upload`, `batch:retry` | ✓ | ✓ | – | – |
| `record:edit` | ✓ | ✓ | ✓ | – |
| `record:approve`, `batch:approve` | ✓ | – | ✓ | – |
| `duplicate:resolve` | ✓ | – | ✓ | – |
| `export:create`, `export:download` | ✓ | ✓ | ✓ | ✓ |
| `audit:read` | ✓ | – | – | ✓ |

Map these permission names onto the *actual* current routers/resources: `datasets.py`, `uploads.py`, `process.py`, `runs.py`, `rules.py`, `transforms.py`, `connections.py`, `admin.py`, `audit_events.py`. Where today's domain model doesn't yet have a literal "batch" or "record" object (check — the doc is ahead of the two-day slice in places), apply the closest existing equivalent (e.g. an upload/run) and note the mapping explicitly in your Phase 2 plan rather than silently renaming things.

**Two rules beyond the table, both already specified in the architecture doc — implement both:**

1. **Maker-checker on approval.** A batch/run needing approval requires two *distinct* actors holding `batch:approve` / `record:approve`; the user who uploaded/created it cannot be one of the approvers, even if they hold the permission. This is the one place resource *ownership* (not just role) gates access — enforce it server-side by comparing the authenticated user's id against the resource's `created_by`, never by trusting a client-supplied actor.
2. **`record:read_pii` does not exist yet** — masked/encrypted PAN/Aadhaar values are stored, but nothing currently gates who can see them unmasked. **Decision point, do not silently decide it yourself:** either (a) add this permission now and gate the relevant field(s), or (b) explicitly continue deferring it and say so in your Phase 2 plan. Do not ship PII-unmasking behavior without the user confirming which.

---

# 4. What replaces "Client / Domain / Task" from a generic RBAC prompt

| Generic concept | Mini ETL reality | Implication |
|---|---|---|
| Client | `tenant_id` (single seeded value today) | Don't build tenant CRUD or switching; just don't hardcode around the existing column. |
| Domain + Admin-assigned-to-Domain | Does not exist — roles are global per tenant, not per sub-resource | Do not add a `DomainAdminAssignment`-shaped table. If a future need for scoped admin access arises, that's a separate design decision, not part of this task. |
| Task + Developer assignment | Does not exist — closest analogs are a Dataset/Mapping/Run/Batch, and there is no "assignee" field on any of them today | Do not invent a Task entity. If a role needs "my items" filtering later, filter by `created_by` on the real entities — not in scope unless the user asks. |
| IDOR across Domains | No Domain to leak across. The real IDOR surface here is: (a) maker-checker self-approval bypass (§3), and (b) once real multi-tenancy lands, cross-tenant reads — out of scope now but don't write query code that would make adding a tenant filter later harder (e.g. avoid raw SQL that bypasses the ORM's tenant_id column without reason). | Test maker-checker bypass explicitly (§8). |

---

# 5. Database changes

Inspect `backend/app/models.py` and the latest migration (`0008_preview_row_count.py`) before writing `0009_*`.

Add, following the existing `Mapped[...]` / `mapped_column(...)` style already used throughout `models.py`:

```text
User            id, email (unique, not null), password_hash, role (enum: admin,
                operations, reviewer, auditor), is_active, created_at
RefreshToken    (or equivalent session mechanism — pick one, justify it; a short-lived
                access JWT + rotating refresh token is what §11.1 specifies)
```

- Add a `created_by` (nullable FK to `users.id`) on whichever entity actually represents an uploaded/reviewable unit today (check `Run`/`Dataset` — the doc calls it "batch," the code may not) — needed to enforce maker-checker (§3) and to correctly attribute existing audit events going forward.
- `AuditEvent.actor` currently stores the literal string `"local"` — change its population (not necessarily its column type) to the authenticated user's id/email; do not remove or restructure the existing `AuditEvent` table.
- Migration must not be destructive: existing rows have no `created_by` and no user to attribute to — backfill with `NULL`, not a fabricated user.
- **Bootstrapping problem to solve explicitly:** there is no signup flow and no existing user to promote. Seed exactly one Admin user (e.g. via an idempotent step in the migration reading credentials from environment variables, or a one-off management script — pick one and say why) so the system isn't unusably locked after this ships. Never hardcode a password in the migration.

---

# 6. API requirements

Add, under `backend/app/routers/`, following the existing `prefix="/api/v1/<resource>"` convention:

```http
POST /api/v1/auth/login        -> issues access + refresh token
POST /api/v1/auth/refresh
POST /api/v1/auth/logout       -> revokes the refresh token
GET  /api/v1/auth/me           -> current user + role + permissions
```

```http
GET    /api/v1/users           Admin only (user:manage)
POST   /api/v1/users           Admin only
PATCH  /api/v1/users/{id}      Admin only — role changes go through here, not through
                                any endpoint a non-admin can reach
DELETE /api/v1/users/{id}      Admin only
```

Then, on every existing mutating endpoint, add the matching permission dependency (§7) — do not skip any:

- `uploads.py` -> `batch:upload`
- `process.py` / `runs.py` retry-type actions -> `batch:retry`
- approval-shaped actions (check `runs.py`/`process.py` for anything gate/review-shaped) -> `batch:approve` / `record:approve` + maker-checker check
- `rules.py`, `transforms.py`, `connections.py` manage endpoints -> the matching `*:manage` permission
- `admin.py` (`/reset`) -> `Admin` only, and this is exactly the kind of destructive, no-undo action worth double-checking against the maker-checker/role model even though it's single-actor by nature
- `audit_events.py` reads -> `audit:read`
- all `GET` list/detail endpoints -> the matching `*:read` permission (every role has read access to *something*; Auditor's should end up strictly read-only across the board)

Reject unknown/extra fields on all write endpoints (Pydantic `model_config = {"extra": "forbid"}` or the v2 equivalent already idiomatic for the codebase) so a client cannot smuggle `role`, `created_by`, or `tenant_id` into a body meant only to update, say, a record's content.

---

# 7. Authorization dependencies

Create reusable FastAPI dependencies (new file, e.g. `backend/app/deps.py`), matching the existing `Depends(get_db)` pattern already used everywhere:

```text
get_current_user(...)          decodes/validates the access token, 401 if missing/invalid
require_permission(perm: str)  -> Depends factory; 403 if current_user's role lacks perm
require_maker_checker(...)     for approval endpoints: loads the resource, 403 if
                                current_user.id == resource.created_by
```

Never trust: request-body role, request-body tenant_id, request-body created_by/actor, or any frontend-hidden control. Authorization is server-side only, on every request, using the token's decoded identity — never a client-supplied id.

---

# 8. Testing (net-new — none exists today)

Add `pytest` + `httpx` (for FastAPI's `TestClient`) to `requirements.txt` and create `backend/tests/`. This is the standard, expected choice for a FastAPI project with zero existing test tooling — not an unjustified new dependency.

At minimum:

**Admin:** can create users, can change roles, can access everything.
**Operations:** can upload/retry; cannot approve; cannot manage users/connections/rules.
**Business Reviewer:** can approve/edit records; cannot upload; cannot manage users.
**Auditor:** can read everything including audit log; cannot mutate anything, anywhere — write a parametrized test that hits every mutating endpoint as Auditor and asserts 403.

**Security-specific:**
- Maker-checker bypass: the uploader of a batch attempts to approve their own batch -> 403, even though they may hold `batch:approve` through role overlap.
- Mass assignment: a Reviewer PATCHes a record body that also includes `"role": "admin"` or `"created_by": "<other-user>"` -> those fields are silently ignored or the request is rejected, and the user's actual role/the record's actual owner is unchanged.
- Privilege escalation: a non-Admin calls `PATCH /api/v1/users/{id}` (their own id or another's) attempting to change `role` -> 403.
- Unauthenticated access to any endpoint -> 401, not a leak of whether the resource exists (see §9).

---

# 9. Error handling

Reuse the existing inline `HTTPException(status, "message")` style. Consistent codes:

```text
401  missing/invalid/expired token
403  authenticated but lacking the required permission, or maker-checker violation
404  resource not found — and prefer 404 over 403 when revealing existence would leak
     information beyond what the role should know (match get_<x>_or_404 pattern already
     used in datasets.py)
422  Pydantic validation errors (already FastAPI's default — don't change it)
```

Never leak whether an id exists in a 403 vs 404 distinction beyond what's already the codebase's convention.

---

# 10. Frontend

Extend, don't replace:

- `frontend/src/app/lib/api.ts` — add `login`, `logout`, `refresh`, `me` calls; attach the access token to every existing call's headers here, centrally, not per-page.
- `frontend/src/app/lib/types.ts` — add `User`, `Role`, `Permission` types.
- New `frontend/src/app/login/` page, styled consistently with existing pages (check `src/app/upload/` or `src/app/datasets/` for the current component/styling conventions before writing new markup).
- An auth context (React context + a hook, e.g. `useAuth()`) that holds the current user/role from `/auth/me`, wraps `layout.tsx`.
- Gate mutation controls (upload button, approve button, rule/connection management, user admin) by permission in this context — but every one of those actions must still be rejected server-side even if UI gating is somehow bypassed. Auditor's UI should show everything and let them click nothing that mutates.

---

# 11. Implementation process

Same five phases, applied to the above — **inspect first, plan second, implement minimally, verify, then a final security pass** focused on: auth correctness, the four-role permission matrix, maker-checker enforcement, mass assignment, privilege escalation, and audit logging of every sensitive action (login, role change, user creation, approval, the existing `/admin/reset`).

---

# 12. Constraints carried over unchanged

Do NOT: rewrite the engine/readers/transforms/validation gate, replace SQLAlchemy or Alembic, invent Client/Domain/Task entities, build out §8's full multi-tenancy/billing/RLS in this pass, trust any client-supplied role/tenant/owner field, or leave any existing mutating endpoint without a permission check.

---

# 13. Final deliverable

Same reporting shape as a standard implementation report: changed files with why, new files with purpose, the migration and its safety, the permission matrix as actually wired up (endpoint -> permission), the maker-checker and mass-assignment protections added, the new tests, and an honest PASS/FAIL/NOT RUN for tests, typecheck, lint, build, and migration — say explicitly if something couldn't be verified rather than assuming it passed.
