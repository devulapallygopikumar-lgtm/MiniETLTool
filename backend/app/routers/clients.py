"""Client details under a domain. Admin manages any domain's clients;
anyone who can upload manages clients of their own domain only."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from .. import audit, models, schemas
from ..database import get_db
from ..deps import get_current_user, require_permission

router = APIRouter(prefix="/api/v1/clients", tags=["clients"])
_write = [Depends(require_permission("batch:upload"))]
_delete = [Depends(require_permission("client:delete"))]


def _visible_or_404(db: Session, client_id: str, user: models.User) -> models.Client:
    client = db.get(models.Client, client_id)
    # 404, not 403, for another domain's client.
    if client is None or (user.role != "admin" and client.domain_id != user.domain_id):
        raise HTTPException(404, "Client not found")
    return client


@router.get("", response_model=list[schemas.ClientOut])
def list_clients(
    domain_id: str | None = Query(None),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(models.Client)
    if current_user.role != "admin":
        query = query.filter(models.Client.domain_id == current_user.domain_id)
    elif domain_id:
        query = query.filter(models.Client.domain_id == domain_id)
    return query.order_by(models.Client.name).all()


@router.post("", response_model=schemas.ClientOut, status_code=201, dependencies=_write)
def create_client(
    body: schemas.NewClient,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    domain_id = body.domain_id if current_user.role == "admin" else current_user.domain_id
    if domain_id is None or db.get(models.Domain, domain_id) is None:
        raise HTTPException(422, "A domain is required (ask an admin to assign you to one)")
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Client name is required")
    if db.query(models.Client).filter(models.Client.domain_id == domain_id, models.Client.name.ilike(name)).first():
        raise HTTPException(409, "This domain already has a client with that name")
    client = models.Client(
        domain_id=domain_id,
        name=name,
        contact_name=body.contact_name,
        contact_email=body.contact_email,
        contact_phone=body.contact_phone,
        notes=body.notes,
    )
    db.add(client)
    db.flush()
    audit.log(db, "client.created", "client", client.id, reason=f"name={name}")
    db.commit()
    db.refresh(client)
    return client


@router.patch("/{client_id}", response_model=schemas.ClientOut, dependencies=_write)
def update_client(
    client_id: str,
    body: schemas.ClientPatch,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client = _visible_or_404(db, client_id, current_user)
    for key, value in body.model_dump(exclude_unset=True).items():
        if key == "name":
            value = (value or "").strip()
            if not value:
                raise HTTPException(422, "Client name is required")
        setattr(client, key, value)
    audit.log(db, "client.updated", "client", client.id)
    db.commit()
    db.refresh(client)
    return client


@router.delete("/{client_id}", status_code=204, dependencies=_delete)
def delete_client(
    client_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client = _visible_or_404(db, client_id, current_user)
    if db.query(models.Dataset).filter_by(client_id=client_id).first():
        raise HTTPException(409, "This client has uploads -- it can't be deleted")
    db.delete(client)
    audit.log(db, "client.deleted", "client", client_id, reason=f"name={client.name}")
    db.commit()
    return Response(status_code=204)
