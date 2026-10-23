"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, requireUser } from "@/server/authz";
import { authMode } from "@/server/auth";
import { sql } from "@/server/db";
import { audit } from "@/server/audit";
import { addMember, removeMember } from "@/server/services/admin";
import { AccountError, changeOwnPassword, setMemberPassword } from "@/server/accounts";
import { generateTemporaryPassword } from "@/server/passwords";
import { SESSION_COOKIE } from "@/server/sessions";
import { rateLimit } from "@/server/rate-limit";

export interface SettingsState { ok?: boolean; error?: string; tempPassword?: string; email?: string }

export async function addMemberAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireStaff("member.manage");
  const p = z.object({ email: z.string().trim().email(), role: z.enum(["admin", "manager", "member"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const actor = { id: user.id, organizationId: user.organizationId };
  try {
    await addMember(sql, actor, p.data.email, p.data.role);
    if (authMode() === "password") {
      const [u] = await sql<{ id: string; password_hash: string | null }[]>`select id, password_hash from users where lower(email) = lower(${p.data.email})`;
      if (u && !u.password_hash) {
        const temp = generateTemporaryPassword();
        await setMemberPassword(sql, actor, u.id, temp);
        revalidatePath("/settings");
        return { ok: true, tempPassword: temp, email: p.data.email };
      }
    }
  } catch (e) { return { error: e instanceof Error ? e.message : "Could not add member" }; }
  revalidatePath("/settings");
  return { ok: true };
}

export async function resetMemberPasswordAction(userId: string): Promise<SettingsState> {
  const user = await requireStaff("member.manage");
  if (authMode() !== "password") return { error: "Passwords are managed by your identity provider." };
  const id = z.string().uuid().parse(userId);
  if (id === user.id) return { error: "Use “Change password” for your own account." };
  const temp = generateTemporaryPassword();
  try { await setMemberPassword(sql, { id: user.id, organizationId: user.organizationId }, id, temp); }
  catch (e) { return { error: e instanceof Error ? e.message : "Could not reset password" }; }
  const [u] = await sql<{ email: string }[]>`select email from users where id = ${id}`;
  return { ok: true, tempPassword: temp, email: u?.email };
}

const changeSchema = z.object({ current: z.string().min(1, "Enter your current password"), next: z.string(), confirm: z.string() })
  .refine((v) => v.next === v.confirm, { message: "New passwords do not match", path: ["confirm"] });

export async function changePasswordAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  if (authMode() !== "password") return { error: "Passwords are managed by your identity provider." };
  if (!rateLimit(`pwchange:${user.id}`, 5, 60_000).ok) return { error: "Too many attempts. Try again in a minute." };
  const p = changeSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  try {
    await changeOwnPassword(sql, user.id, p.data.current, p.data.next, (await cookies()).get(SESSION_COOKIE)?.value);
  } catch (e) {
    if (e instanceof AccountError) return { error: e.message };
    throw e;
  }
  if (user.organizationId) await audit(sql, { organizationId: user.organizationId, actorUserId: user.id, action: "user.password_changed", entityType: "user", entityId: user.id });
  return { ok: true };
}

export async function removeMemberAction(userId: string): Promise<SettingsState> {
  const user = await requireStaff("member.manage");
  try { await removeMember(sql, { id: user.id, organizationId: user.organizationId }, z.string().uuid().parse(userId)); }
  catch (e) { return { error: e instanceof Error ? e.message : "Could not remove member" }; }
  // Removed members lose access immediately.
  await sql`update auth_sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
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
