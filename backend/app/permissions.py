"""The permission matrix from ARCHITECTURE.md §11.1, and how it maps onto
this codebase's actual routers -- reproduced here, not re-derived, per
Mini ETL RBAC Prompt.md §3/§6.

Permissions with no current endpoint (mapping:manage, duplicate:manage,
duplicate:resolve, record:edit, export:create, export:download) are
listed for completeness but deliberately unwired -- nothing in this
codebase represents a mapping editor, an interactive duplicate-resolution
flow, a per-row edit API, or export configuration yet. record:read_pii is
omitted entirely: no PII field exists anywhere in models.py today.
"""

from typing import Literal

Role = Literal["admin", "operations", "reviewer", "auditor"]

ROLES: tuple[Role, ...] = ("admin", "operations", "reviewer", "auditor")

_ADMIN = frozenset({"admin"})
_ADMIN_OPS = frozenset({"admin", "operations"})
_ADMIN_REVIEWER = frozenset({"admin", "reviewer"})
_ADMIN_OPS_REVIEWER = frozenset({"admin", "operations", "reviewer"})
_ALL = frozenset(ROLES)

PERMISSIONS: dict[str, frozenset[str]] = {
    # Admin only -- system configuration, users, roles, connections.
    "user:manage": _ADMIN,
    "tenant:manage": _ADMIN,
    "role_access:manage": _ADMIN,
    "product:manage": _ADMIN,
    "mapping:manage": _ADMIN,  # unwired -- no mapping editor endpoint exists
    "validation:manage": _ADMIN,
    "duplicate:manage": _ADMIN,  # unwired -- see module docstring
    "format_rule:manage": _ADMIN,
    "db_connection:manage": _ADMIN,
    # Every role can read.
    "product:read": _ALL,
    "mapping:read": _ALL,
    "db_connection:read": _ALL,
    "batch:read": _ALL,
    "record:read": _ALL,
    # Operations (+ Admin): upload, retry.
    "batch:upload": _ADMIN_OPS,
    "batch:retry": _ADMIN_OPS,
    # Reviewer (+ Admin): edit, approve, resolve.
    "record:edit": _ADMIN_OPS_REVIEWER,  # unwired -- no per-row edit API exists
    "record:approve": _ADMIN_REVIEWER,
    "batch:approve": _ADMIN_REVIEWER,
    "duplicate:resolve": _ADMIN_REVIEWER,  # unwired -- see module docstring
    # Everyone can export.
    "export:create": _ALL,  # unwired -- no export-configuration endpoint exists
    "export:download": _ALL,  # unwired -- see module docstring
    # Admin + Auditor: audit log.
    "audit:read": frozenset({"admin", "auditor"}),
}


def role_has(role: str, permission: str) -> bool:
    return role in PERMISSIONS.get(permission, frozenset())


def permissions_for(role: str) -> list[str]:
    return sorted(name for name, roles in PERMISSIONS.items() if role in roles)
