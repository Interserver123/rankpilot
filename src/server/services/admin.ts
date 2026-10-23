import type { OrgRole } from "@/lib/permissions";
import type { Sql } from "../db";
import { audit } from "../audit";
import type { Actor } from "./projects";

export interface BudgetInput {
  projectId: string | null;
  module: "organic" | "maps" | "llm" | "citations" | null;
  monthlyLimit: number;
  alertThresholdPct: number;
  onLimit: "block" | "require_approval";
}

export async function upsertBudget(sql: Sql, actor: Actor, b: BudgetInput) {
  await sql.begin(async (tx) => {
    if (b.projectId) {
      const [p] = await tx`select 1 from projects where id = ${b.projectId} and organization_id = ${actor.organizationId}`;
      if (!p) throw new Error("Project not found");
    }
    const [row] = await tx<{ id: string }[]>`
      insert into budgets (organization_id, project_id, module, monthly_limit, alert_threshold_pct, on_limit)
      values (${actor.organizationId}, ${b.projectId}, ${b.module}, ${b.monthlyLimit}, ${b.alertThresholdPct}, ${b.onLimit})
      on conflict (organization_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(module, ''))
      do update set monthly_limit = excluded.monthly_limit, alert_threshold_pct = excluded.alert_threshold_pct,
        on_limit = excluded.on_limit, updated_at = now()
      returning id`;
    await audit(tx, { organizationId: actor.organizationId, actorUserId: actor.id, action: "budget.saved", entityType: "budget", entityId: row!.id, metadata: { ...b } });
  });
}

export async function deleteBudget(sql: Sql, actor: Actor, budgetId: string) {
  await sql.begin(async (tx) => {
    const rows = await tx`delete from budgets where id = ${budgetId} and organization_id = ${actor.organizationId} returning id`;
    if (rows.length) await audit(tx, { organizationId: actor.organizationId, actorUserId: actor.id, action: "budget.deleted", entityType: "budget", entityId: budgetId });
  });
}

/** Adds (or re-roles) a staff member. They are linked to their login on first sign-in by email. */
export async function addMember(sql: Sql, actor: Actor, email: string, role: OrgRole) {
  await sql.begin(async (tx) => {
    const [existing] = await tx<{ id: string }[]>`select id from users where lower(email) = lower(${email})`;
    const userId = existing?.id ?? (await tx<{ id: string }[]>`insert into users (email, name) values (${email}, ${email.split("@")[0] ?? null}) returning id`)[0]!.id;
    const [other] = await tx`select 1 from organization_members where user_id = ${userId} and organization_id <> ${actor.organizationId}`;
    if (other) throw new Error("This user belongs to another organization");
    await tx`
      insert into organization_members (organization_id, user_id, role) values (${actor.organizationId}, ${userId}, ${role})
      on conflict (organization_id, user_id) do update set role = excluded.role`;
    await audit(tx, { organizationId: actor.organizationId, actorUserId: actor.id, action: "member.saved", entityType: "user", entityId: userId, metadata: { email, role } });
  });
}

export async function removeMember(sql: Sql, actor: Actor, userId: string) {
  if (userId === actor.id) throw new Error("You cannot remove yourself");
  await sql.begin(async (tx) => {
    const [{ admins } = { admins: 0 }] = await tx<{ admins: number }[]>`
      select count(*)::int as admins from organization_members where organization_id = ${actor.organizationId} and role = 'admin' and user_id <> ${userId}`;
    if (admins === 0) throw new Error("At least one administrator is required");
    await tx`delete from organization_members where organization_id = ${actor.organizationId} and user_id = ${userId}`;
    await tx`delete from project_assignments a using projects p where a.project_id = p.id and p.organization_id = ${actor.organizationId} and a.user_id = ${userId}`;
    await audit(tx, { organizationId: actor.organizationId, actorUserId: actor.id, action: "member.removed", entityType: "user", entityId: userId });
  });
}

export async function setAssignment(sql: Sql, actor: Actor, projectId: string, userId: string, assigned: boolean) {
  await sql.begin(async (tx) => {
    const [ok] = await tx`
      select 1 from projects p join organization_members m on m.organization_id = p.organization_id
      where p.id = ${projectId} and m.user_id = ${userId} and p.organization_id = ${actor.organizationId}`;
    if (!ok) throw new Error("Project or member not found");
    if (assigned) await tx`insert into project_assignments (project_id, user_id) values (${projectId}, ${userId}) on conflict do nothing`;
    else await tx`delete from project_assignments where project_id = ${projectId} and user_id = ${userId}`;
    await audit(tx, { organizationId: actor.organizationId, actorUserId: actor.id, action: assigned ? "assignment.added" : "assignment.removed", entityType: "project", entityId: projectId, metadata: { userId } });
  });
}
