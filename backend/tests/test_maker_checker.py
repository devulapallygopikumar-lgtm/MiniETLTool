from app import models


def _awaiting_approval_run(db_session, created_by: str) -> models.Run:
    dataset = models.Dataset(
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


def test_uploader_cannot_approve_their_own_run(client, db_session, reviewer_user, reviewer_headers):
    run = _awaiting_approval_run(db_session, created_by=reviewer_user.id)

    resp = client.post(f"/api/v1/runs/{run.id}/approve", headers=reviewer_headers)

    assert resp.status_code == 403


def test_a_different_approver_can_approve(client, db_session, reviewer_user, admin_user, admin_headers):
    run = _awaiting_approval_run(db_session, created_by=reviewer_user.id)

    resp = client.post(f"/api/v1/runs/{run.id}/approve", headers=admin_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["approved_by"] == admin_user.id


def test_operations_lacks_the_approve_permission_regardless_of_ownership(
    client, db_session, operations_user, operations_headers
):
    run = _awaiting_approval_run(db_session, created_by=operations_user.id)

    resp = client.post(f"/api/v1/runs/{run.id}/approve", headers=operations_headers)

    # Operations doesn't hold batch:approve at all -- 403 here is the plain
    # permission check, not (only) maker-checker.
    assert resp.status_code == 403
