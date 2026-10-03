"""Domains: the grouping users belong to. Admin-managed; everyone else can
only read their own domain (so the UI can show it)."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import audit, models, schemas
from ..database import get_db
from ..deps import get_current_user, require_permission

router = APIRouter(prefix="/api/v1/domains", tags=["domains"])
_admin = [Depends(require_permission("user:manage"))]


def _get_or_404(db: Session, domain_id: str) -> models.Domain:
    domain = db.get(models.Domain, domain_id)
    if domain is None:
        raise HTTPException(404, "Domain not found")
    return domain


@router.get("", response_model=list[schemas.DomainOut])
def list_domains(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(models.Domain)
    if current_user.role != "admin":
        query = query.filter(models.Domain.id == current_user.domain_id)
    return query.order_by(models.Domain.name).all()


@router.post("", response_model=schemas.DomainOut, status_code=201, dependencies=_admin)
def create_domain(body: schemas.NewDomain, db: Session = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Domain name is required")
    if db.query(models.Domain).filter(models.Domain.name.ilike(name)).first():
        raise HTTPException(409, "A domain with this name already exists")
    domain = models.Domain(name=name)
    db.add(domain)
    db.flush()
    audit.log(db, "domain.created", "domain", domain.id, reason=f"name={name}")
    db.commit()
    db.refresh(domain)
    return domain


@router.patch("/{domain_id}", response_model=schemas.DomainOut, dependencies=_admin)
def rename_domain(domain_id: str, body: schemas.NewDomain, db: Session = Depends(get_db)):
    domain = _get_or_404(db, domain_id)
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Domain name is required")
    clash = db.query(models.Domain).filter(models.Domain.name.ilike(name), models.Domain.id != domain_id).first()
    if clash:
        raise HTTPException(409, "A domain with this name already exists")
    domain.name = name
    audit.log(db, "domain.renamed", "domain", domain.id, reason=f"name={name}")
    db.commit()
    db.refresh(domain)
    return domain


@router.delete("/{domain_id}", status_code=204, dependencies=_admin)
def delete_domain(domain_id: str, db: Session = Depends(get_db)):
    domain = _get_or_404(db, domain_id)
    if db.query(models.User).filter_by(domain_id=domain_id).first() or domain.clients:
        raise HTTPException(409, "Domain still has users or clients -- move or remove them first")
    db.delete(domain)
    audit.log(db, "domain.deleted", "domain", domain_id, reason=f"name={domain.name}")
    db.commit()
    return Response(status_code=204)
