import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLog


def record_audit(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    entity_type: str,
    entity_id: uuid.UUID | None,
    action: str,
    before: dict | None = None,
    after: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            workspace_id=workspace_id,
            actor_user_id=actor_user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            before=before,
            after=after,
        )
    )
