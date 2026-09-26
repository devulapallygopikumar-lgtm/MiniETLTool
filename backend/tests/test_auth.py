from .conftest import PASSWORD


def test_login_succeeds_with_correct_password(client, admin_user):
    resp = client.post("/api/v1/auth/login", json={"email": admin_user.email, "password": PASSWORD})
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["user"]["role"] == "admin"
    assert "password" not in body["user"] and "password_hash" not in body["user"]
    assert "refresh_token" in resp.cookies


def test_login_fails_with_wrong_password(client, admin_user):
    resp = client.post("/api/v1/auth/login", json={"email": admin_user.email, "password": "wrong"})
    assert resp.status_code == 401


def test_login_fails_for_unknown_email(client):
    resp = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": PASSWORD})
    assert resp.status_code == 401


def test_me_requires_a_token(client):
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401


def test_me_returns_the_authenticated_user_and_permissions(client, admin_headers):
    resp = client.get("/api/v1/auth/me", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["role"] == "admin"
    assert "user:manage" in body["permissions"]


def test_refresh_without_a_cookie_is_rejected(client):
    resp = client.post("/api/v1/auth/refresh")
    assert resp.status_code == 401


def test_refresh_rotates_the_token_and_old_one_cannot_be_reused(client, admin_user):
    login = client.post("/api/v1/auth/login", json={"email": admin_user.email, "password": PASSWORD})
    old_refresh_cookie = login.cookies["refresh_token"]

    first = client.post("/api/v1/auth/refresh", cookies={"refresh_token": old_refresh_cookie})
    assert first.status_code == 200

    # Reusing the now-rotated-away token is treated as a leak: rejected.
    reused = client.post("/api/v1/auth/refresh", cookies={"refresh_token": old_refresh_cookie})
    assert reused.status_code == 401


def test_logout_revokes_the_refresh_token(client, admin_user):
    login = client.post("/api/v1/auth/login", json={"email": admin_user.email, "password": PASSWORD})
    refresh_cookie = login.cookies["refresh_token"]

    logout = client.post("/api/v1/auth/logout", cookies={"refresh_token": refresh_cookie})
    assert logout.status_code == 204

    resp = client.post("/api/v1/auth/refresh", cookies={"refresh_token": refresh_cookie})
    assert resp.status_code == 401
