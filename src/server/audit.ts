import type { Db } from "./db";

export async function audit(
  db: Db,
  e: { organizationId: string; actorUserId: string | null; action: string; entityType: string; entityId: string | null; metadata?: Record<string, unknown> },
) {
  await db`
    insert into audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata_json)
    values (${e.organizationId}, ${e.actorUserId}, ${e.action}, ${e.entityType}, ${e.entityId}, ${db.json((e.metadata ?? {}) as never)})`;
}
