"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/server/authz";
import { sql } from "@/server/db";
import { deleteBudget, upsertBudget } from "@/server/services/admin";

export interface BudgetState { ok?: boolean; error?: string }

const schema = z.object({
  projectId: z.string().uuid().or(z.literal("")).transform((v) => v || null),
  module: z.enum(["organic", "maps", "llm", "citations"]).or(z.literal("")).transform((v) => v || null),
  monthlyLimit: z.coerce.number().min(0).max(1_000_000),
  alertThresholdPct: z.coerce.number().int().min(1).max(100),
  onLimit: z.enum(["block", "require_approval"]),
});

export async function saveBudgetAction(_prev: BudgetState, form: FormData): Promise<BudgetState> {
  const user = await requireStaff("budget.manage");
  const p = schema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  try {
    await upsertBudget(sql, { id: user.id, organizationId: user.organizationId }, p.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save budget" };
  }
  revalidatePath("/usage");
  return { ok: true };
}

export async function deleteBudgetAction(id: string) {
  const user = await requireStaff("budget.manage");
  await deleteBudget(sql, { id: user.id, organizationId: user.organizationId }, z.string().uuid().parse(id));
  revalidatePath("/usage");
}
