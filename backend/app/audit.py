"""Append-only audit log (ARCHITECTURE.md §10, §20.3 hour 15): every state
change is written, nothing is ever updated or deleted."""

from sqlalchemy.orm import Session

from . import models

ACTOR = "local"  # single-user slice — no auth (§20.5)


def log(
    db: Session,
    action: str,
    resource_type: str,
    resource_id: str,
    outcome: str = "success",
    reason: str | None = None,
) -> None:
    db.add(
        models.AuditEvent(
            actor=ACTOR,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            outcome=outcome,
            reason=reason,
        )
    )
