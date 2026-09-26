def test_new_user_rejects_unknown_fields(client, admin_headers):
    resp = client.post(
        "/api/v1/users",
        headers=admin_headers,
        json={"email": "x@example.com", "password": "password123", "role": "operations", "is_superuser": True},
    )
    assert resp.status_code == 422


def test_user_patch_rejects_unknown_fields(client, admin_headers, operations_user):
    resp = client.patch(
        f"/api/v1/users/{operations_user.id}",
        headers=admin_headers,
        json={"created_by": "someone-else"},
    )
    assert resp.status_code == 422


def test_non_admin_cannot_change_a_role(client, reviewer_headers, operations_user):
    resp = client.patch(
        f"/api/v1/users/{operations_user.id}",
        headers=reviewer_headers,
        json={"role": "admin"},
    )
    assert resp.status_code == 403


def test_non_admin_cannot_escalate_their_own_role(client, reviewer_headers, reviewer_user):
    resp = client.patch(
        f"/api/v1/users/{reviewer_user.id}",
        headers=reviewer_headers,
        json={"role": "admin"},
    )
    assert resp.status_code == 403


def test_admin_can_change_a_role(client, admin_headers, operations_user):
    resp = client.patch(
        f"/api/v1/users/{operations_user.id}",
        headers=admin_headers,
        json={"role": "reviewer"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "reviewer"
