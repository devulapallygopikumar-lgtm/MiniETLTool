"""Auth/permission FastAPI dependencies, matching the existing
Depends(get_db) pattern used everywhere else in this codebase."""

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import models
from .database import get_db
from .permissions import role_has
from .security import decode_access_token

import jwt as _pyjwt

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.User:
    if creds is None:
        raise HTTPException(401, "Missing bearer token")
    try:
        payload = decode_access_token(creds.credentials)
    except _pyjwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = db.get(models.User, payload.get("sub"))
    if user is None or not user.is_active:
        raise HTTPException(401, "Invalid or expired token")
    return user


def require_permission(permission: str):
    """Depends factory: 403 if current_user's role lacks `permission`.
    Never trusts a client-supplied role -- always the token's decoded
    identity, re-checked against the DB user's *current* role."""

    def _check(current_user: models.User = Depends(get_current_user)) -> models.User:
        if not role_has(current_user.role, permission):
            raise HTTPException(403, f"Missing permission: {permission}")
        return current_user

    return _check


def require_maker_checker(current_user: models.User, resource_created_by: str | None) -> None:
    """403 if current_user is the same person who created the resource
    they're trying to approve -- the maker-checker rule (ARCHITECTURE.md
    §11.1 / Mini ETL RBAC Prompt.md §3): two *distinct* actors, enforced
    server-side against the resource's stored created_by, never a
    client-supplied actor."""
    if resource_created_by is not None and current_user.id == resource_created_by:
        raise HTTPException(403, "The uploader of a run cannot also approve it")
