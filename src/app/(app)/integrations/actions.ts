"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/server/authz";
import { sql } from "@/server/db";
import { audit } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";
import { providerSpec, removeProviderCredentials, saveProviderCredentials } from "@/server/providers/credentials";
import { testProviderConnection, testYepApiSearch, type SearchTestResult } from "@/server/providers/test-connection";

export interface KeyState { ok?: boolean; error?: string; message?: string }

function providerId(form: FormData): string {
  const id = String(form.get("provider") ?? "");
  if (!providerSpec(id)) throw new Error("Unknown provider");
  return id;
}

export async function saveKeysAction(_prev: KeyState, form: FormData): Promise<KeyState> {
  const user = await requireStaff("integration.manage");
  if (!rateLimit(`keys:${user.id}`, 20, 60_000).ok) return { error: "Too many attempts. Try again in a minute." };
  try {
    const id = providerId(form);
    const submitted = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
    await saveProviderCredentials(sql, id, user.id, submitted);
    const changed = providerSpec(id)!.fields.filter((f) => (submitted[f.key] ?? "").trim()).map((f) => f.key);
    // Field names only: never the values.
    await audit(sql, { organizationId: user.organizationId, actorUserId: user.id, action: "integration.saved", entityType: "provider", entityId: null, metadata: { provider: id, fields: changed } });
    revalidatePath("/integrations");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save" };
  }
}

export async function testKeysAction(_prev: KeyState, form: FormData): Promise<KeyState> {
  const user = await requireStaff("integration.manage");
  if (!rateLimit(`keytest:${user.id}`, 10, 60_000).ok) return { error: "Too many tests. Try again in a minute." };
  try {
    const r = await testProviderConnection(providerId(form));
    return r.ok ? { ok: true, message: r.message } : { error: r.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Test failed" };
  }
}

export async function removeKeysAction(_prev: KeyState, form: FormData): Promise<KeyState> {
  const user = await requireStaff("integration.manage");
  try {
    const id = providerId(form);
    const removed = await removeProviderCredentials(sql, id);
    if (removed) await audit(sql, { organizationId: user.organizationId, actorUserId: user.id, action: "integration.removed", entityType: "provider", entityId: null, metadata: { provider: id } });
    revalidatePath("/integrations");
    return { ok: true, message: removed ? "Saved keys removed." : "Nothing was saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not remove" };
  }
}

export interface SearchTestState { result?: SearchTestResult; error?: string }

export async function testSearchAction(_prev: SearchTestState, form: FormData): Promise<SearchTestState> {
  const user = await requireStaff("integration.manage");
  if (!rateLimit(`searchtest:${user.id}`, 10, 60_000).ok) return { error: "Too many tests. Try again in a minute." };
  const t = (k: string) => String(form.get(k) ?? "").trim().slice(0, 120);
  const keyword = t("keyword");
  if (!keyword) return { error: "Enter a keyword." };
  const device = t("device") === "mobile" ? "mobile" : "desktop";
  const result = await testYepApiSearch({ keyword, countryCode: (t("country") || "US").toUpperCase().slice(0, 2), region: t("region"), city: t("city"), device, domain: t("domain") });
  await audit(sql, { organizationId: user.organizationId, actorUserId: user.id, action: "integration.search_test", entityType: "provider", entityId: null, metadata: { provider: "yepapi", keyword } });
  return { result };
}
