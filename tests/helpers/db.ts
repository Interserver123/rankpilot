import postgres from "postgres";
import { migrate } from "../../scripts/migrate";
import { closeSql, getSql } from "@/server/db";

export const TEST_DB_URL = process.env.DATABASE_URL_TEST;
export const hasTestDb = Boolean(TEST_DB_URL);

/** Recreates the public schema and applies all migrations. */
export async function resetDatabase() {
  const admin = postgres(TEST_DB_URL!, { max: 1, onnotice: () => {} });
  await admin.unsafe("drop schema if exists public cascade; create schema public;");
  await admin.end();
  await migrate(TEST_DB_URL!, () => {});
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.PROVIDER_MOCK_ENABLED = "true";
  return getSql();
}

export async function teardown() {
  await closeSql();
}

export async function createOrgWithAdmin(sql: postgres.Sql, email = "admin@agency.test") {
  const [org] = await sql<{ id: string }[]>`insert into organizations (name, slug) values ('Agency', ${`agency-${Math.random().toString(36).slice(2, 8)}`}) returning id`;
  const [user] = await sql<{ id: string }[]>`insert into users (email, authentication_user_id) values (${email}, ${`dev:${email}`}) returning id`;
  await sql`insert into organization_members (organization_id, user_id, role) values (${org!.id}, ${user!.id}, 'admin')`;
  return { organizationId: org!.id, id: user!.id };
}

export const weekly = { enabled: true, intervalValue: 7, intervalUnit: "day" as const, preferredRunTime: "06:00" };
export const off = { ...weekly, enabled: false };
