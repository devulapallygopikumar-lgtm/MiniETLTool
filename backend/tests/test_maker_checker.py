import pytest

from app import models
from app.config import settings


@pytest.fixture
def maker_checker_on(monkeypatch):
    """The rule is off by default for now; these tests switch it on."""
    monkeypatch.setattr(settings, "maker_checker", True)


def _awaiting_approval_run(db_session, created_by: str, user=None) -> models.Run:
    """`user`, if given, is put in a domain that owns the dataset's client --
    domain visibility is what lets a non-admin reach the run at all."""
    client_id = None
    if user is not None:
        domain = models.Domain(name=f"d-{created_by}")
        db_session.add(domain)
        db_session.flush()
        user.domain_id = domain.id
        client = models.Client(domain_id=domain.id, name="c")
        db_session.add(client)
        db_session.flush()
        client_id = client.id
    dataset = models.Dataset(
        client_id=client_id,
        name="test dataset",
        source_filename="test.csv",
        format="csv",
        entity_name="test",
        state="awaiting_approval",
        gate_state="open",
        row_count=None,
        columns_json=[],
        created_by=created_by,
    )
    db_session.add(dataset)
    db_session.flush()

    mapping = models.Mapping(
        dataset_id=dataset.id,
        version=1,
        source_path="",
        source_format="csv",
        entity_spec_json={},
        schema_json=[],
        target_table=f"dataset_{dataset.id.replace('-', '_')}",
    )
    db_session.add(mapping)
    db_session.flush()

    run = models.Run(
        dataset_id=dataset.id,
        mapping_id=mapping.id,
        mapping_version=1,
        state="awaiting_approval",
        gate_state="open",
        created_by=created_by,
    )
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)
    return run


def test_uploader_cannot_approve_their_own_run(client, db_session, admin_user, admin_headers, maker_checker_on):
    run = _awaiting_approval_run(db_session, created_by=admin_user.id)

    resp = client.post(f"/api/v1/runs/{run.id}/approve", headers=admin_headers)

    assert resp.status_code == 403


def test_a_different_approver_can_approve(client, db_session, operations_user, admin_user, admin_headers):
    run = _awaiting_approval_run(db_session, created_by=operations_user.id)

    resp = client.post(f"/api/v1/runs/{run.id}/approve", headers=admin_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["approved_by"] == admin_user.id


def test_operations_cannot_approve_their_own_run(
    client, db_session, operations_user, operations_headers, maker_checker_on
):
    run = _awaiting_approval_run(db_session, created_by=operations_user.id, user=operations_user)

    resp = client.post(f"/api/v1/runs/{run.id}/approve", headers=operations_headers)

    # Operations holds batch:approve, so this 403 is the maker-checker rule.
    assert resp.status_code == 403


def test_with_maker_checker_off_the_starter_can_approve(client, db_session, admin_user, admin_headers):
    run = _awaiting_approval_run(db_session, created_by=admin_user.id)

    resp = client.post(f"/api/v1/runs/{run.id}/approve", headers=admin_headers)

    assert resp.status_code == 200
