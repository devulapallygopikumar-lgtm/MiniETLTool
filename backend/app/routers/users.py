from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import audit, models, schemas, security
from ..database import get_db
from ..deps import require_permission

router = APIRouter(
    prefix="/api/v1/users",
    tags=["users"],
    dependencies=[Depends(require_permission("user:manage"))],
)


def get_user_or_404(db: Session, user_id: str) -> models.User:
    user = db.get(models.User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    return user


@router.get("", response_model=list[schemas.UserOut])
def list_users(db: Session = Depends(get_db)):
    rows = db.query(models.User).order_by(models.User.created_at).all()
    return [schemas.UserOut.model_validate(u) for u in rows]


@router.post("", response_model=schemas.UserOut, status_code=201)
def create_user(body: schemas.NewUser, db: Session = Depends(get_db)):
    if db.query(models.User).filter_by(email=body.email).first() is not None:
        raise HTTPException(409, "A user with this email already exists")
    user = models.User(
        email=body.email,
        password_hash=security.hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    db.flush()
    audit.log(db, "user.created", "user", user.id, reason=f"role={body.role}")
    db.commit()
    db.refresh(user)
    return schemas.UserOut.model_validate(user)


@router.patch("/{user_id}", response_model=schemas.UserOut)
def update_user(user_id: str, body: schemas.UserPatch, db: Session = Depends(get_db)):
    user = get_user_or_404(db, user_id)
    patch = body.model_dump(exclude_unset=True)
    role_changed = "role" in patch and patch["role"] != user.role
    for key, value in patch.items():
        if key == "password":
            if value:
                user.password_hash = security.hash_password(value)
            continue
        setattr(user, key, value)
    if role_changed:
        audit.log(db, "user.role_changed", "user", user.id, reason=f"role={user.role}")
    else:
        audit.log(db, "user.updated", "user", user.id)
    db.commit()
    db.refresh(user)
    return schemas.UserOut.model_validate(user)


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: str, db: Session = Depends(get_db)):
    user = get_user_or_404(db, user_id)
    db.delete(user)
    audit.log(db, "user.deleted", "user", user_id, reason=f"email={user.email}")
    db.commit()
    return Response(status_code=204)
