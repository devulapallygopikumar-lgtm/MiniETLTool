"""A registry of saved RDBMS connections (Target Dataset menu). Metadata
only for now -- nothing in the pipeline reads from these yet; see
app/models.py's Connection docstring."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import audit, db_connections, models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/v1/connections", tags=["connections"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def to_out(c: models.Connection) -> schemas.ConnectionOut:
    return schemas.ConnectionOut(
        id=c.id,
        name=c.name,
        kind=c.kind,
        host=c.host,
        port=c.port,
        database=c.database,
        username=c.username,
        schema_name=c.schema_name,
        created_at=c.created_at,
        last_tested_at=c.last_tested_at,
        last_test_ok=c.last_test_ok,
        last_test_error=c.last_test_error,
    )


def get_connection_or_404(db: Session, connection_id: str) -> models.Connection:
    conn = db.get(models.Connection, connection_id)
    if conn is None:
        raise HTTPException(404, "Connection not found")
    return conn


@router.get("", response_model=list[schemas.ConnectionOut])
def list_connections(db: Session = Depends(get_db)):
    rows = db.query(models.Connection).order_by(models.Connection.created_at.desc()).all()
    return [to_out(c) for c in rows]


@router.post("", response_model=schemas.ConnectionOut, status_code=201)
def create_connection(body: schemas.NewConnection, db: Session = Depends(get_db)):
    conn = models.Connection(
        name=body.name,
        kind=body.kind,
        host=body.host,
        port=body.port,
        database=body.database,
        username=body.username,
        password=body.password,
        schema_name=body.schema_name,
    )
    db.add(conn)
    db.flush()
    audit.log(db, "connection.created", "connection", conn.id, reason=f"kind={body.kind}")
    db.commit()
    db.refresh(conn)
    return to_out(conn)


@router.patch("/{connection_id}", response_model=schemas.ConnectionOut)
def update_connection(connection_id: str, body: schemas.ConnectionPatch, db: Session = Depends(get_db)):
    conn = get_connection_or_404(db, connection_id)
    patch = body.model_dump(exclude_unset=True)
    for key, value in patch.items():
        if key == "password" and not value:
            continue  # blank password on edit leaves the stored one unchanged
        setattr(conn, key, value)
    audit.log(db, "connection.updated", "connection", conn.id)
    db.commit()
    db.refresh(conn)
    return to_out(conn)


@router.delete("/{connection_id}", status_code=204)
def delete_connection(connection_id: str, db: Session = Depends(get_db)):
    conn = get_connection_or_404(db, connection_id)
    db.delete(conn)
    audit.log(db, "connection.deleted", "connection", connection_id)
    db.commit()
    return Response(status_code=204)


@router.post("/{connection_id}/test", response_model=schemas.ConnectionTestResult)
def test_connection(connection_id: str, db: Session = Depends(get_db)):
    conn = get_connection_or_404(db, connection_id)
    ok, message = db_connections.test_connection(conn)

    conn.last_tested_at = _now()
    conn.last_test_ok = ok
    conn.last_test_error = None if ok else message
    audit.log(
        db, "connection.tested", "connection", conn.id,
        outcome="success" if ok else "denied", reason=None if ok else message,
    )
    db.commit()

    return schemas.ConnectionTestResult(ok=ok, message=message)
