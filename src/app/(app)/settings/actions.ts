"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/server/authz";
import { sql } from "@/server/db";
import { audit } from "@/server/audit";
import { addMember, removeMember } from "@/server/services/admin";

export interface SettingsState { ok?: boolean; error?: string }

export async function addMemberAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireStaff("member.manage");
  const p = z.object({ email: z.string().trim().email(), role: z.enum(["admin", "manager", "member"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  try { await addMember(sql, { id: user.id, organizationId: user.organizationId }, p.data.email, p.data.role); }
  catch (e) { return { error: e instanceof Error ? e.message : "Could not add member" }; }
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeMemberAction(userId: string): Promise<SettingsState> {
  const user = await requireStaff("member.manage");
  try { await removeMember(sql, { id: user.id, organizationId: user.organizationId }, z.string().uuid().parse(userId)); }
  catch (e) { return { error: e instanceof Error ? e.message : "Could not remove member" }; }
  revalidatePath("/settings");
  return { ok: true };
}

export async function renameOrgAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireStaff("member.manage");
  const name = z.string().trim().min(1).max(120).safeParse(form.get("name"));
  if (!name.success) return { error: "Enter a name" };
  await sql`update organizations set name = ${name.data} where id = ${user.organizationId}`;
  await audit(sql, { organizationId: user.organizationId, actorUserId: user.id, action: "organization.renamed", entityType: "organization", entityId: user.organizationId, metadata: { name: name.data } });
  revalidatePath("/settings");
  return { ok: true };
}
