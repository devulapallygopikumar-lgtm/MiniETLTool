"""Fallback for seeding the first Admin user when migration 0009 ran
without ADMIN_EMAIL/ADMIN_PASSWORD set (see that migration's docstring).
Idempotent: does nothing if a user with this email already exists.

Usage:
    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... python scripts/create_admin.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_password  # noqa: E402


def main() -> None:
    email = os.environ.get("ADMIN_EMAIL")
    password = os.environ.get("ADMIN_PASSWORD")
    if not email or not password:
        print("Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment.", file=sys.stderr)
        sys.exit(1)

    db = SessionLocal()
    try:
        if db.query(User).filter_by(email=email).first() is not None:
            print(f"A user with email {email} already exists -- nothing to do.")
            return
        user = User(email=email, password_hash=hash_password(password), role="admin")
        db.add(user)
        db.commit()
        print(f"Created admin user {email} ({user.id}).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
