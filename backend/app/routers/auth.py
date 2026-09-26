"""Login/refresh/logout/me (ARCHITECTURE.md §11.1). The access token goes
in the JSON body (kept in memory by the frontend, never localStorage);
the refresh token goes in an httpOnly cookie -- a JS-readable token would
be exactly what an XSS payload would go looking for."""

from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import audit, models, permissions, schemas, security
from ..config import settings
from ..database import get_db
from ..deps import get_current_user

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

_COOKIE_NAME = "refresh_token"
_COOKIE_PATH = "/api/v1/auth"


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    # secure=False: this app has no TLS-terminating layer of its own in
    # the single-tenant/local deployment this slice targets. A real
    # deployment puts a TLS proxy in front and flips this (ARCHITECTURE.md
    # §11.1) -- not made configurable here since nothing in this repo
    # would ever set it differently yet.
    response.set_cookie(
        _COOKIE_NAME,
        raw_token,
        max_age=settings.refresh_token_days * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=False,
        path=_COOKIE_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(_COOKIE_NAME, path=_COOKIE_PATH)


def _issue_tokens(db: Session, user: models.User, response: Response) -> schemas.TokenOut:
    raw_refresh, refresh_hash = security.new_refresh_token()
    db.add(
        models.RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            expires_at=security.refresh_token_expiry(),
        )
    )
    _set_refresh_cookie(response, raw_refresh)
    access = security.create_access_token(user.id, user.role)
    return schemas.TokenOut(access_token=access, user=schemas.UserOut.model_validate(user))


@router.post("/login", response_model=schemas.TokenOut)
def login(body: schemas.LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(models.User).filter_by(email=body.email).first()
    if user is None or not user.is_active or not security.verify_password(body.password, user.password_hash):
        audit.log(db, "auth.login", "user", "unknown", outcome="denied", reason=f"email={body.email}")
        db.commit()
        raise HTTPException(401, "Invalid email or password")

    token = _issue_tokens(db, user, response)
    audit.log(db, "auth.login", "user", user.id)
    db.commit()
    return token


@router.post("/refresh", response_model=schemas.TokenOut)
def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    if refresh_token is None:
        raise HTTPException(401, "No refresh token")

    token_hash = security.hash_refresh_token(refresh_token)
    row = db.query(models.RefreshToken).filter_by(token_hash=token_hash).first()

    if row is None:
        raise HTTPException(401, "Invalid refresh token")

    if row.revoked_at is not None:
        # Reuse of an already-rotated-away token: the raw token leaked.
        # Revoke every session for this user, not just this one.
        db.query(models.RefreshToken).filter_by(user_id=row.user_id, revoked_at=None).update(
            {"revoked_at": datetime.now(timezone.utc)}
        )
        audit.log(db, "auth.refresh_reuse_detected", "user", row.user_id, outcome="denied")
        db.commit()
        _clear_refresh_cookie(response)
        raise HTTPException(401, "Refresh token already used -- all sessions revoked")

    if row.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(401, "Refresh token expired")

    user = db.get(models.User, row.user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "Invalid refresh token")

    row.revoked_at = datetime.now(timezone.utc)
    token = _issue_tokens(db, user, response)
    db.commit()
    return token


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    if refresh_token is not None:
        token_hash = security.hash_refresh_token(refresh_token)
        row = db.query(models.RefreshToken).filter_by(token_hash=token_hash).first()
        if row is not None and row.revoked_at is None:
            row.revoked_at = datetime.now(timezone.utc)
            audit.log(db, "auth.logout", "user", row.user_id)
            db.commit()
    _clear_refresh_cookie(response)
    return None


@router.get("/me", response_model=schemas.MeOut)
def me(current_user: models.User = Depends(get_current_user)):
    return schemas.MeOut(
        user=schemas.UserOut.model_validate(current_user),
        permissions=permissions.permissions_for(current_user.role),
    )
