import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db";

export const SESSION_COOKIE = "rp_session";
export const SESSION_TTL_MS = 14 * 24 * 3600_000;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createSession(db: Db, userId: string, meta: { userAgent?: string | null; ip?: string | null } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db`insert into auth_sessions (user_id, token_hash, expires_at, user_agent, ip)
    values (${userId}, ${hashToken(token)}, ${expiresAt}, ${meta.userAgent?.slice(0, 300) ?? null}, ${meta.ip ?? null})`;
  return { token, expiresAt };
}

/** Returns the active user id for a session token, or null. */
export async function resolveSession(db: Db, token: string): Promise<string | null> {
  if (!token || token.length > 100) return null;
  const [s] = await db<{ id: string; user_id: string; last_used_at: Date }[]>`
    select s.id, s.user_id, s.last_used_at from auth_sessions s join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)} and s.revoked_at is null and s.expires_at > now() and u.status = 'active'`;
  if (!s) return null;
  if (Date.now() - s.last_used_at.getTime() > 3600_000) await db`update auth_sessions set last_used_at = now() where id = ${s.id}`;
  return s.user_id;
}

export async function revokeSession(db: Db, token: string) {
  await db`update auth_sessions set revoked_at = now() where token_hash = ${hashToken(token)} and revoked_at is null`;
}

export async function revokeUserSessions(db: Db, userId: string, exceptToken?: string) {
  await db`update auth_sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null
    ${exceptToken ? db`and token_hash <> ${hashToken(exceptToken)}` : db``}`;
}
