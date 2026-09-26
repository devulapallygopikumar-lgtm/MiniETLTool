"""Sweeps the permission matrix (Mini ETL RBAC Prompt.md §8): every
mutating endpoint, every role, asserting 403 for roles the matrix
excludes and something other than 403 for roles it allows. See
conftest.expect_roles for what "allowed" means here -- it's the
permission boundary, not full functional success (some allowed calls
still 404/409 on a fixture id that doesn't exist, which is fine)."""

from .conftest import expect_roles

ALL = {"admin", "operations", "reviewer", "auditor"}


def test_user_management_is_admin_only(client, headers_by_role):
    expect_roles(client, "GET", "/api/v1/users", {"admin"}, headers_by_role)
    expect_roles(
        client,
        "POST",
        "/api/v1/users",
        {"admin"},
        headers_by_role,
        json={"email": "new@example.com", "password": "password123", "role": "operations"},
    )


def test_upload_is_admin_and_operations_only(client, headers_by_role):
    csv_bytes = b"a,b\n1,2\n"
    expect_roles(
        client,
        "POST",
        "/api/v1/uploads",
        {"admin", "operations"},
        headers_by_role,
        files={"file": ("test.csv", csv_bytes, "text/csv")},
    )


def test_run_start_is_admin_and_operations_only(client, headers_by_role):
    expect_roles(
        client, "POST", "/api/v1/datasets/does-not-exist/run", {"admin", "operations"}, headers_by_role
    )


def test_run_approve_is_admin_and_reviewer_only(client, headers_by_role):
    expect_roles(client, "POST", "/api/v1/runs/does-not-exist/approve", {"admin", "reviewer"}, headers_by_role)


def test_process_create_is_admin_only(client, headers_by_role):
    expect_roles(
        client,
        "POST",
        "/api/v1/process",
        {"admin"},
        headers_by_role,
        json={"name": "x", "op": "sort", "source_dataset_id": "does-not-exist", "args": {}},
    )


def test_dataset_read_is_open_to_everyone(client, headers_by_role):
    expect_roles(client, "GET", "/api/v1/datasets", ALL, headers_by_role)


def test_dataset_delete_is_admin_only(client, headers_by_role):
    expect_roles(client, "DELETE", "/api/v1/datasets/does-not-exist", {"admin"}, headers_by_role)


def test_rules_read_is_open_but_manage_is_admin_only(client, headers_by_role):
    expect_roles(client, "GET", "/api/v1/datasets/does-not-exist/rules", ALL, headers_by_role)
    expect_roles(
        client,
        "POST",
        "/api/v1/datasets/does-not-exist/rules",
        {"admin"},
        headers_by_role,
        json={"scope": "row", "rule": "not_null"},
    )
    expect_roles(
        client, "DELETE", "/api/v1/datasets/does-not-exist/rules/does-not-exist", {"admin"}, headers_by_role
    )


def test_transforms_read_is_open_but_manage_is_admin_only(client, headers_by_role):
    expect_roles(client, "GET", "/api/v1/datasets/does-not-exist/transforms", ALL, headers_by_role)
    expect_roles(
        client,
        "POST",
        "/api/v1/datasets/does-not-exist/transforms",
        {"admin"},
        headers_by_role,
        json={"op": "dedupe"},
    )


def test_connections_read_is_open_but_manage_is_admin_only(client, headers_by_role):
    expect_roles(client, "GET", "/api/v1/connections", ALL, headers_by_role)
    expect_roles(
        client,
        "POST",
        "/api/v1/connections",
        {"admin"},
        headers_by_role,
        json={
            "name": "x",
            "kind": "postgres",
            "host": "localhost",
            "port": 5432,
            "database": "x",
            "username": "x",
            "password": "x",
        },
    )


def test_admin_reset_is_admin_only(client, headers_by_role):
    expect_roles(client, "POST", "/api/v1/admin/reset", {"admin"}, headers_by_role)


def test_audit_log_is_admin_and_auditor_only(client, headers_by_role):
    expect_roles(client, "GET", "/api/v1/audit-events", {"admin", "auditor"}, headers_by_role)


def test_every_mutating_endpoint_rejects_unauthenticated_requests(client):
    for method, path in [
        ("GET", "/api/v1/users"),
        ("POST", "/api/v1/uploads"),
        ("POST", "/api/v1/datasets/does-not-exist/run"),
        ("POST", "/api/v1/admin/reset"),
        ("GET", "/api/v1/audit-events"),
    ]:
        resp = client.request(method, path)
        assert resp.status_code == 401, f"{method} {path} should require auth, got {resp.status_code}"
