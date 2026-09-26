"""Password hashing and JWT issuing/verification (ARCHITECTURE.md §11.1:
bcrypt + short-lived access JWT + rotating refresh token).

bcrypt directly, not passlib -- this app only ever uses bcrypt, so
passlib's multi-scheme CryptContext is an abstraction with one
implementation. PyJWT directly, not python-jose -- smaller, actively
maintained, and decode() below pins the algorithm explicitly so a token
can't switch algorithms on us.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import settings

_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False  # malformed stored hash -- treat as no match, not a crash


def create_access_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError (expired, bad signature, malformed) on any
    problem -- the caller (deps.get_current_user) turns that into a 401."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[_ALGORITHM])


def new_refresh_token() -> tuple[str, str]:
    """Returns (raw_token, token_hash). The raw token is what goes in the
    cookie; only its hash is ever stored, so reading the DB can't hand
    back a replayable session (same reasoning as password_hash)."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def refresh_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_days)
