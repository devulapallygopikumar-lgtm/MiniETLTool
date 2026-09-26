import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import models  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.security import create_access_token, hash_password  # noqa: E402

# In-memory SQLite, shared across connections via StaticPool -- models.py's
# JsonType already anticipates this ("plain JSON elsewhere (e.g. if a test
# ever points this at SQLite)"). These tests only assert the permission
# boundary (status codes), not full pipeline correctness, so the
# Postgres-only SQL in target_tables.py/derived.py is never exercised here.
_engine = create_engine(
    "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
_TestSessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)

PASSWORD = "password123"


@pytest.fixture(autouse=True)
def db_session():
    Base.metadata.create_all(_engine)
    session = _TestSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(_engine)


@pytest.fixture(autouse=True)
def _override_get_db(db_session):
    def _get_db():
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def _stub_background_pipeline(monkeypatch):
    """start_run/approve_run hand the actual pipeline to BackgroundTasks,
    which TestClient runs for real -- through runner.py's own SessionLocal
    (the app's real configured database), not this file's SQLite override.
    Letting that fire in tests would reach the developer's real Postgres
    DB. These tests only assert the permission/API boundary, never
    pipeline completion, so the pipeline itself is stubbed out."""
    from app.routers import runs

    monkeypatch.setattr(runs, "execute_run", lambda run_id: None)
    monkeypatch.setattr(runs, "execute_run_after_approval", lambda run_id: None)


@pytest.fixture
def client():
    return TestClient(app)


def make_user(db_session, role: str, email: str | None = None) -> models.User:
    user = models.User(
        email=email or f"{role}@example.com",
        password_hash=hash_password(PASSWORD),
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def auth_headers(user: models.User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}


@pytest.fixture
def admin_user(db_session):
    return make_user(db_session, "admin")


@pytest.fixture
def operations_user(db_session):
    return make_user(db_session, "operations")


@pytest.fixture
def reviewer_user(db_session):
    return make_user(db_session, "reviewer")


@pytest.fixture
def auditor_user(db_session):
    return make_user(db_session, "auditor")


@pytest.fixture
def admin_headers(admin_user):
    return auth_headers(admin_user)


@pytest.fixture
def operations_headers(operations_user):
    return auth_headers(operations_user)


@pytest.fixture
def reviewer_headers(reviewer_user):
    return auth_headers(reviewer_user)


@pytest.fixture
def auditor_headers(auditor_user):
    return auth_headers(auditor_user)


@pytest.fixture
def headers_by_role(admin_headers, operations_headers, reviewer_headers, auditor_headers):
    return {
        "admin": admin_headers,
        "operations": operations_headers,
        "reviewer": reviewer_headers,
        "auditor": auditor_headers,
    }


def expect_roles(client, method: str, path: str, allowed: set[str], headers_by_role: dict, **kwargs):
    """Calls `path` as every role; asserts 403 for roles *not* in `allowed`
    and something other than 403 for roles that are. Doesn't assert an
    exact success code -- some allowed calls 404/409 on missing fixture
    data (e.g. a dataset id that doesn't exist), which is fine: it still
    proves the *permission* check passed before the business logic ran."""
    for role, headers in headers_by_role.items():
        resp = client.request(method, path, headers=headers, **kwargs)
        if role in allowed:
            assert resp.status_code != 403, f"{role} unexpectedly forbidden from {method} {path}"
        else:
            assert resp.status_code == 403, f"{role} unexpectedly allowed {method} {path} ({resp.status_code})"
